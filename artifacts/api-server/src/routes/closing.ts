import { Router } from "express";
import { resolveJurisdiction } from "../lib/jurisdiction";

const router = Router();

function requireAuth(req: Parameters<Router>[0], res: Parameters<Router>[1], next: Parameters<Router>[2]) {
  if (!req.session.authenticated) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

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
