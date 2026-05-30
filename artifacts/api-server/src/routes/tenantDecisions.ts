import { Router } from "express";
import { db } from "@workspace/db";
import { tenantDecisionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { requireAuth } from "../middleware/auth";

const router = Router();

// GET /api/tenant-decisions — all saved merge/dismiss decisions
router.get("/tenant-decisions", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(tenantDecisionsTable);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to load tenant decisions");
    res.status(500).json({ error: "Failed to load tenant decisions" });
  }
});

// POST /api/tenant-decisions — upsert one decision
router.post("/tenant-decisions", requireAuth, async (req, res) => {
  try {
    const b = req.body as {
      id?: string; type?: string; nameA?: string | null; nameB?: string | null;
      canonical?: string | null; variants?: string[] | null;
    };
    if (!b.id || (b.type !== "merge" && b.type !== "dismiss")) {
      res.status(400).json({ error: "id and type ('merge'|'dismiss') are required" });
      return;
    }
    const values = {
      id: b.id, type: b.type,
      nameA: b.nameA ?? null, nameB: b.nameB ?? null,
      canonical: b.canonical ?? null,
      variants: Array.isArray(b.variants) ? b.variants : null,
    };
    await db.insert(tenantDecisionsTable).values(values).onConflictDoUpdate({
      target: tenantDecisionsTable.id,
      set: { type: values.type, nameA: values.nameA, nameB: values.nameB, canonical: values.canonical, variants: values.variants, updatedAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save tenant decision");
    res.status(500).json({ error: "Failed to save tenant decision" });
  }
});

// DELETE /api/tenant-decisions/:id — remove a decision (restore the pair)
router.delete("/tenant-decisions/:id", requireAuth, async (req, res) => {
  try {
    const id = decodeURIComponent(String(req.params.id));
    await db.delete(tenantDecisionsTable).where(eq(tenantDecisionsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete tenant decision");
    res.status(500).json({ error: "Failed to delete tenant decision" });
  }
});

export default router;
