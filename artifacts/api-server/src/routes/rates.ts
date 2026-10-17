import { Router } from "express";
import { fetchTodaysRates, debugIronhound, type RatesPayload } from "../lib/rates";
import { saveManualCurve, saveChathamMark } from "../lib/rateCurves";
import { parseManualCurve, parseChathamMark } from "../lib/dtccSwaps";
import { requireAuth, requireAdmin } from "../middleware/auth";

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
