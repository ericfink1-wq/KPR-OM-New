import { Router } from "express";
import { resolveJurisdiction } from "../lib/jurisdiction";
import { fetchWithTimeout } from "../lib/http";

import { requireAuth } from "../middleware/auth";

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/closing/suggest?q=...
// Live address autocomplete for the closing-cost estimator. Proxies the free
// OpenStreetMap (Nominatim) US address search — NO API key, NO LLM tokens. Returns
// up to 6 candidates, each with a display label, a clean one-line address (to feed
// /closing/resolve) and the 2-letter state (drives the tax jurisdiction immediately).
// Always 200s with { suggestions: [...] } so the client degrades gracefully.
// ---------------------------------------------------------------------------
router.get("/closing/suggest", requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 4) { res.json({ suggestions: [] }); return; }
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=us&q=${encodeURIComponent(q)}`;
    const resp = await fetchWithTimeout(url, 8_000, {
      headers: { "User-Agent": "KPR-OM-Database/1.0 (ericfink1@gmail.com)" },
    });
    if (!resp.ok) { res.json({ suggestions: [] }); return; }
    const arr = (await resp.json()) as Array<{ display_name?: string; address?: Record<string, string> }>;
    const suggestions = (arr || []).map((h) => {
      const a = h.address || {};
      const iso = a["ISO3166-2-lvl4"] || "";
      const state = /^US-([A-Z]{2})$/.test(iso) ? iso.slice(3) : "";
      const line1 = [a.house_number, a.road].filter(Boolean).join(" ");
      const city = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || "";
      const oneLine = [line1, city, a.state, a.postcode].filter(Boolean).join(", ");
      return { label: h.display_name || oneLine, address: oneLine || h.display_name || "", state };
    }).filter((s) => s.address);
    res.json({ suggestions });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch address suggestions");
    res.json({ suggestions: [] });
  }
});

// ---------------------------------------------------------------------------
// GET /api/closing/resolve?address=...
// Resolve a street address to its exact taxing jurisdiction (county /
// municipality / place / school district) for the closing-cost estimator.
// Always 200s with { matched: boolean, ... } so the client degrades gracefully.
// ---------------------------------------------------------------------------
router.get("/closing/resolve", requireAuth, async (req, res) => {
  try {
    const address = String(req.query.address ?? "").trim();
    if (!address) { res.json({ matched: false }); return; }
    const result = await resolveJurisdiction(address);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to resolve jurisdiction");
    res.json({ matched: false });
  }
});

export default router;
