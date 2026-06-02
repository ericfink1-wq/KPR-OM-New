import { Router } from "express";
import { fetchTodaysRates, debugIronhound, type RatesPayload } from "../lib/rates";

const router = Router();

// Rates only update once a day from the official sources, so cache the result
// for an hour to avoid hammering Treasury / NY Fed on every page open.
let cache: { at: number; data: RatesPayload } | null = null;
const TTL_MS = 60 * 60 * 1000;

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
    const data = await fetchTodaysRates();
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

export default router;
