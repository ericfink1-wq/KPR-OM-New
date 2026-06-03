import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { extractionLessonsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { ensureExtractionLessonsTable, getActiveLessons, type LessonScope } from "../lib/extractionLessons";

const router: IRouter = Router();
const SCOPES = ["all", "om", "rent-roll", "lease-options", "sales", "flyer", "swap"];

// GET /api/extraction-lessons?scope=om — list active lessons (any signed-in user;
// the client extraction paths read these to inject into prompts).
router.get("/extraction-lessons", requireAuth, async (req, res) => {
  try {
    const scope = (typeof req.query.scope === "string" && SCOPES.includes(req.query.scope) ? req.query.scope : "all") as LessonScope;
    const rows = await getActiveLessons(scope);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list extraction lessons");
    res.status(500).json({ error: "Failed to list extraction lessons" });
  }
});

// POST /api/extraction-lessons  { scope, lesson } — add a rule (admin only).
router.post("/extraction-lessons", requireAdmin, async (req, res) => {
  try {
    await ensureExtractionLessonsTable();
    const body = req.body as Record<string, unknown>;
    const lesson = typeof body.lesson === "string" ? body.lesson.trim() : "";
    const scope = (typeof body.scope === "string" && SCOPES.includes(body.scope)) ? body.scope : "all";
    if (!lesson) { res.status(400).json({ error: "Rule text is required." }); return; }
    if (lesson.length > 2000) { res.status(400).json({ error: "Rule is too long (keep it under 2000 characters)." }); return; }
    const [row] = await db.insert(extractionLessonsTable).values({
      id: `les_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      scope, lesson, active: true,
      createdBy: req.session.userEmail || "admin",
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to add extraction lesson");
    res.status(500).json({ error: "Failed to add extraction lesson" });
  }
});

// DELETE /api/extraction-lessons/:id — remove a rule (admin only).
router.delete("/extraction-lessons/:id", requireAdmin, async (req, res) => {
  try {
    await ensureExtractionLessonsTable();
    await db.delete(extractionLessonsTable).where(eq(extractionLessonsTable.id, String(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete extraction lesson");
    res.status(500).json({ error: "Failed to delete extraction lesson" });
  }
});

export default router;
