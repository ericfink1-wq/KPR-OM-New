import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getUserPrefs, saveLoanSizerPrefs, sanitizeLoanSizer } from "../lib/userPrefs";

const router = Router();

// The signed-in user's own settings. The user comes from the SESSION only — a userId in
// the body or query is ignored, so nobody can read or change another person's settings.
router.get("/me/prefs", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try { res.json(await getUserPrefs(String(userId))); }
  catch (err) { req.log.error({ err }, "Failed to load user prefs"); res.status(500).json({ error: "Couldn't load your settings" }); }
});

router.put("/me/prefs/loan-sizer", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try { res.json(await saveLoanSizerPrefs(String(userId), sanitizeLoanSizer(req.body))); }
  catch (err) { req.log.error({ err }, "Failed to save user prefs"); res.status(500).json({ error: "Couldn't save your settings" }); }
});

export default router;
