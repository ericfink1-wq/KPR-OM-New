import { Router } from "express";
import { getHouseView, saveHouseView, ensureHouseViewTable } from "../lib/houseView";
import { rebuildHouseView } from "../lib/extract";
import { requireAuth, requireAdmin } from "../middleware/auth";

const router = Router();

// GET /api/house-view — the current distilled House View (any logged-in user).
router.get("/house-view", requireAuth, async (req, res) => {
  try {
    await ensureHouseViewTable();
    res.json(await getHouseView());
  } catch (err) {
    req.log.error({ err }, "Failed to load house view");
    res.status(500).json({ error: "Failed to load House View" });
  }
});

// PUT /api/house-view — manually edit the House View (admin). Hand-edits don't
// touch the distilled-from-N-reviews metadata.
router.put("/house-view", requireAdmin, async (req, res) => {
  try {
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    await saveHouseView(content, req.session.userEmail || "admin");
    res.json({ ok: true, ...(await getHouseView()) });
  } catch (err) {
    req.log.error({ err }, "Failed to save house view");
    res.status(500).json({ error: "Failed to save House View" });
  }
});

// POST /api/house-view/rebuild — re-distill the House View from every deal's review
// (admin; one Haiku pass).
router.post("/house-view/rebuild", requireAdmin, async (req, res) => {
  try {
    const result = await rebuildHouseView(req.session.userEmail || "admin");
    res.json({ ok: true, ...(await getHouseView()), ...result });
  } catch (err) {
    req.log.error({ err }, "Failed to rebuild house view");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to rebuild House View" });
  }
});

export default router;
