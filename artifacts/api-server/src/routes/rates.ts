import { Router } from "express";
import { fetchTodaysRates, debugIronhound, type RatesPayload } from "../lib/rates";
import { saveManualCurve, saveChathamMark, refreshSwapCurves, backfillDailyCurves, curveCoverage, getSwapCurves } from "../lib/rateCurves";
import { saveCurveSnapshot } from "../lib/swapHistory";
import { parseManualCurve, parseChathamMark } from "../lib/dtccSwaps";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { getIndexHistory, HISTORY_SERIES, type HistorySeries } from "../lib/rateHistory";
import { loadCurveRows, swapSeries, termSofrSeries, pickCurveDate, overlayTargets, curveOn, oisByDate, businessDayTest } from "../lib/swapHistory";
/** US business days from the NY Fed SOFR history (cached 12 h); weekdays if it can't be read. */
const businessDays = async () => businessDayTest(await getIndexHistory("SOFR").then(h => h.points.filter(p => p[1] != null).map(p => p[0])).catch(() => null));

const router = Router();

// Rates only update once a day from the official sources, so cache the result
// for an hour to avoid hammering Treasury / NY Fed on every page open.
let cache: { at: number; data: RatesPayload } | null = null;
const TTL_MS = 10 * 60 * 1000;   // swaps now update intraday (DTCC slices)

// GET /api/rates — current benchmark rates (Treasuries, SOFR, indicative swaps).
// PUBLIC: these are official public market figures (US Treasury, NY Fed SOFR,
// indicative swaps) with no KPR-proprietary data — intentionally not auth-gated,
// so the panel works even if the browser session has lapsed (a logged-out
// session was surfacing a misleading "Not authenticated" here, and the Refresh
// button silently 401'd, leaving a stale timestamp on screen).
router.get("/rates", async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    if (!force && cache && Date.now() - cache.at < TTL_MS) {
      res.json(cache.data);
      return;
    }
    const data = await fetchTodaysRates(force);
    cache = { at: Date.now(), data };
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch rates");
    // Serve stale cache if we have it, rather than failing outright.
    if (cache) { res.json(cache.data); return; }
    res.status(502).json({ error: "Couldn't fetch rates right now — try again shortly." });
  }
});

// POST /api/rates/daily-close — the SCHEDULED daily close (Eric, 10/26/26). Called by the GitHub
// Actions job .github/workflows/rates-daily-close.yml every business evening after DTCC publishes
// the day's end-of-day file (and a morning retry), whether or not anyone has the site open. Each
// call: top up today's curves, ingest up to ~45 s of missing daily DTCC files (the year backfill
// runs in batches — the job calls again while `remaining` > 0), save the day's snapshot. Public
// market data only — no KPR data in or out, so no login; single-flight and bounded.
let closeRun: Promise<unknown> | null = null;
router.post("/rates/daily-close", async (req, res) => {
  if (closeRun) { res.status(429).json({ error: "already running — try again in a minute" }); return; }
  const budget = Math.min(55_000, Math.max(5_000, Number(req.query.budgetMs) || 45_000));
  closeRun = (async () => {
    const t0 = Date.now();
    const refresh = await refreshSwapCurves(15_000, true).catch(e => ({ error: String(e) }));
    const isBd = await businessDays();
    const ingested = await backfillDailyCurves(Math.max(5_000, budget - (Date.now() - t0)), isBd);
    const curves = await getSwapCurves();
    const saved = await saveCurveSnapshot(curves.ois, curves.term, true);
    const coverage = await curveCoverage(isBd);
    return { ok: true, refresh, ingested, snapshotSaved: saved, snapshotDate: curves.ois?.curveDate ?? null, remaining: coverage.daysMissing, coverage, ms: Date.now() - t0 };
  })();
  try { res.json(await closeRun); }
  catch (err) { req.log.warn({ err }, "daily close failed"); res.status(500).json({ error: err instanceof Error ? err.message : "daily close failed" }); }
  finally { closeRun = null; }
});
// GET /api/rates/coverage — how much daily swap history is stored (no login; public data).
router.get("/rates/coverage", async (_req, res) => {
  try { res.json(await curveCoverage(await businessDays())); } catch (err) { res.status(502).json({ error: err instanceof Error ? err.message : "coverage failed" }); }
});

// GET /api/rates/history?series=SOFR,DGS10 — daily index history for the rate detail panel
// (FRED + NY Fed, cached server-side, refreshed at most every 12 h). Never Term SOFR (CME-licensed).
router.get("/rates/history", requireAuth, async (req, res) => {
  const want = String(req.query.series ?? "SOFR").split(",").map(x => x.trim().toUpperCase()).filter((x): x is HistorySeries => x in HISTORY_SERIES);
  if (!want.length) { res.status(400).json({ error: `series must be one of ${Object.keys(HISTORY_SERIES).join(", ")}` }); return; }
  try {
    const out = await Promise.all(want.map(s => getIndexHistory(s, req.query.refresh === "1" && !!req.session.isAdmin)));
    res.json({ series: out });
  } catch (err) {
    req.log.warn({ err }, "rate history failed");
    res.status(502).json({ error: "Couldn't load rate history right now." });
  }
});

// GET /api/rates/series?key=SOFR|SOFR30|DGS2|…|ois:5|term:5|termsofr1m — one series' daily
// history for the Today's Rates tap-to-chart rows. points = [date, value|null, thin 0/1, trades|null];
// a null value is a published "no print" (FRED "."), shown as a gap — nothing is interpolated.
router.get("/rates/series", requireAuth, async (req, res) => {
  const key = String(req.query.key ?? "").trim();
  try {
    const idx = key.toUpperCase();
    if (idx in HISTORY_SERIES) {
      const h = await getIndexHistory(idx as HistorySeries);
      res.json({ key, label: h.label, source: h.source, asOf: h.asOf, fetchedAt: h.fetchedAt, collected: false, points: h.points.map(([d, v]) => [d, v, 0, null]) });
      return;
    }
    const m = /^(ois|term):(\d{1,2})$/.exec(key);
    if (!m && key !== "termsofr1m") { res.status(400).json({ error: "unknown series" }); return; }
    const rows = await loadCurveRows();
    const pts = m ? swapSeries(rows, m[1] as "ois" | "term", Number(m[2]), await businessDays()) : termSofrSeries(rows);
    const label = m ? `${m[1] === "ois" ? "SOFR OIS (annual/annual)" : "SOFR Swap – 1M Term"} – ${m[2]} Year` : "1M Term SOFR (Chatham marks)";
    const source = m
      ? (m[1] === "ois" ? "DTCC public swap trades — the panel's close method, backfilled from DTCC's end-of-day files (about a year back); a pasted Chatham mark wins on its date" : "Derived each day from that day's SOFR OIS close, exactly as the panel derives today's curve (Term-vs-OIS basis; a Chatham mark's own Term column wins on its date)")
      : "Chatham marks pasted by KPR only — 1M Term SOFR history is CME-licensed and is never scraped";
    res.json({ key, label, source, asOf: pts.length ? pts[pts.length - 1][0] : null, collected: true, collectedSince: pts[0]?.[0] ?? null, points: pts });
  } catch (err) {
    req.log.warn({ err }, "rate series failed");
    res.status(502).json({ error: "Couldn't load that history right now." });
  }
});

// GET /api/rates/curve-overlay — today's swap curves (OIS + 1M Term) and the stored curve
// nearest-before 1 week / 1 month / 1 year earlier (none within 7 days → null, said so).
router.get("/rates/curve-overlay", requireAuth, async (req, res) => {
  try {
    const rows = await loadCurveRows();
    const isBd = await businessDays();
    const dates = [...oisByDate(rows, isBd).keys()].sort();
    const latest = dates[dates.length - 1] ?? null;
    if (!latest) { res.json({ latest: null, curves: [] }); return; }
    const curves = [{ key: "Today", target: latest, date: latest }, ...overlayTargets(latest).map(t => ({ key: t.key, target: t.target, date: pickCurveDate(dates, t.target) }))]
      .map(c => ({ ...c, curve: c.date ? curveOn(rows, c.date) : null }));
    res.json({ latest, firstDate: dates[0], curves });
  } catch (err) {
    req.log.warn({ err }, "curve overlay failed");
    res.status(502).json({ error: "Couldn't load past curves right now." });
  }
});

// GET /api/rates/debug-ironhound — temporary diagnostic for the Iron Hound scrape.
// No auth: returns only Iron Hound's PUBLIC page info (no KPR data) so it can be
// opened directly in a browser. Remove this route once the scrape works.
router.get("/rates/debug-ironhound", async (_req, res) => {
  res.json(await debugIronhound());
});

// POST /api/rates/swap-curve — paste today's curve (e.g. from Chatham). Stamped with who
// and when; it is shown instead of the DTCC curve until DTCC has newer trades.
router.post("/rates/swap-curve", requireAuth, async (req, res) => {
  try {
    const body = (req.body ?? {}) as { text?: string; source?: string };
    const points = parseManualCurve(String(body.text ?? ""));
    if (points.length < 2) { res.status(400).json({ error: "Couldn't read at least two tenors — paste lines like \"5Y 4.63\"." }); return; }
    await saveManualCurve(points, req.session.userEmail || "unknown user", String(body.source ?? "").slice(0, 80));
    cache = null;
    res.json({ ok: true, points });
  } catch (err) {
    req.log.error({ err }, "Failed to save pasted swap curve");
    res.status(500).json({ error: "Couldn't save the curve" });
  }
});

// Chatham mark: text copied from cf.com/rates/us by a person (never scraped — login wall +
// CME licensing notice). /preview parses only, so the user sees exactly what will be saved;
// saving is admin-only (there is no separate capital-markets role) and stamped with who.
router.post("/rates/chatham-mark/preview", requireAuth, (req, res) => {
  res.json(parseChathamMark(String((req.body ?? {}).text ?? "").slice(0, 20000)));
});
router.post("/rates/chatham-mark", requireAdmin, async (req, res) => {
  try {
    const m = parseChathamMark(String((req.body ?? {}).text ?? "").slice(0, 20000));
    if (m.ois.length < 2) { res.status(400).json({ error: "Couldn't read at least two annual/annual (OIS) tenors — check the pasted text.", parsed: m }); return; }
    const out = await saveChathamMark(m, req.session.userEmail || "unknown user");
    cache = null;
    res.json({ ok: true, ...out, parsed: m });
  } catch (err) {
    req.log.error({ err }, "Failed to save Chatham mark");
    res.status(500).json({ error: "Couldn't save the Chatham mark" });
  }
});

export default router;
