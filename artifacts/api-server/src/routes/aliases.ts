import { Router } from "express";
import { db } from "@workspace/db";
import { tenantAliasesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { requireAuth } from "../middleware/auth";

const router = Router();

// GET /api/aliases — returns { rawName → canonicalName } flat map
router.get("/aliases", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(tenantAliasesTable);
    const map: Record<string, string> = {};
    for (const r of rows) map[r.rawName] = r.canonicalName;
    res.json(map);
  } catch (err) {
    req.log.error({ err }, "Failed to load tenant aliases");
    res.status(500).json({ error: "Failed to load tenant aliases" });
  }
});

// POST /api/aliases — upsert a batch of aliases
router.post("/aliases", requireAuth, async (req, res) => {
  try {
    const entries = req.body as { rawName: string; canonicalName: string; notes?: string }[];
    if (!Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ error: "Body must be a non-empty array of { rawName, canonicalName }" });
      return;
    }
    for (const { rawName, canonicalName, notes } of entries) {
      if (typeof rawName !== "string" || typeof canonicalName !== "string") continue;
      await db.insert(tenantAliasesTable)
        .values({ rawName, canonicalName, notes: notes ?? null })
        .onConflictDoUpdate({
          target: tenantAliasesTable.rawName,
          set: { canonicalName, notes: notes ?? null, updatedAt: new Date() },
        });
    }
    res.json({ ok: true, count: entries.length });
  } catch (err) {
    req.log.error({ err }, "Failed to upsert tenant aliases");
    res.status(500).json({ error: "Failed to upsert tenant aliases" });
  }
});

// DELETE /api/aliases/:rawName — remove a single alias mapping
router.delete("/aliases/:rawName", requireAuth, async (req, res) => {
  try {
    const rawName = decodeURIComponent(String(req.params.rawName));
    await db.delete(tenantAliasesTable).where(eq(tenantAliasesTable.rawName, rawName));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete tenant alias");
    res.status(500).json({ error: "Failed to delete tenant alias" });
  }
});

export default router;
