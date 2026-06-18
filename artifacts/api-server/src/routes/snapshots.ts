import { Router } from "express";
import { db } from "@workspace/db";
import { dealsTable, dealSourcesTable, snapshotsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

import { requireAuth, requireAdmin } from "../middleware/auth";

const router = Router();

export async function createSnapshot(
  reason: string,
): Promise<{ id: number; createdAt: Date } | { skipped: true }> {
  if (reason === "auto") {
    const lastAuto = await db
      .select({ createdAt: snapshotsTable.createdAt })
      .from(snapshotsTable)
      .where(eq(snapshotsTable.reason, "auto"))
      .orderBy(desc(snapshotsTable.createdAt))
      .limit(1);
    if (lastAuto.length > 0) {
      const ageMs = Date.now() - lastAuto[0].createdAt.getTime();
      // Once a day: skip if the last auto snapshot is under 24h old.
      if (ageMs < 24 * 60 * 60 * 1000) return { skipped: true };
    }
  }

  if (reason === "before-delete") {
    const newest = await db
      .select({ createdAt: snapshotsTable.createdAt })
      .from(snapshotsTable)
      .orderBy(desc(snapshotsTable.createdAt))
      .limit(1);
    if (newest.length > 0) {
      const ageMs = Date.now() - newest[0].createdAt.getTime();
      if (ageMs < 5 * 60 * 1000) return { skipped: true };
    }
  }

  const deals = await db
    .select({ id: dealsTable.id, data: dealsTable.data })
    .from(dealsTable);
  const sources = await db
    .select({ id: dealSourcesTable.id, sourceText: dealSourcesTable.sourceText })
    .from(dealSourcesTable);

  const [row] = await db
    .insert(snapshotsTable)
    .values({ reason, dealCount: deals.length, data: { deals, sources } })
    .returning({ id: snapshotsTable.id, createdAt: snapshotsTable.createdAt });

  const all = await db
    .select({ id: snapshotsTable.id })
    .from(snapshotsTable)
    .orderBy(desc(snapshotsTable.createdAt));
  const toDelete = all.slice(30);
  for (const { id } of toDelete) {
    await db.delete(snapshotsTable).where(eq(snapshotsTable.id, id));
  }

  return row;
}

// POST /api/snapshots
router.post("/snapshots", requireAuth, async (req, res) => {
  try {
    const reason = (req.body as { reason?: string }).reason ?? "manual";
    const result = await createSnapshot(reason);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to create snapshot");
    res.status(500).json({ error: "Failed to create snapshot" });
  }
});

// GET /api/snapshots (admin only)
router.get("/snapshots", requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: snapshotsTable.id,
        createdAt: snapshotsTable.createdAt,
        reason: snapshotsTable.reason,
        dealCount: snapshotsTable.dealCount,
      })
      .from(snapshotsTable)
      .orderBy(desc(snapshotsTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list snapshots");
    res.status(500).json({ error: "Failed to list snapshots" });
  }
});

// POST /api/snapshots/:id/restore (admin only)
router.post("/snapshots/:id/restore", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid snapshot id" });
      return;
    }

    await createSnapshot("before-restore-rollback");

    const [snap] = await db
      .select()
      .from(snapshotsTable)
      .where(eq(snapshotsTable.id, id));
    if (!snap) {
      res.status(404).json({ error: "Snapshot not found" });
      return;
    }

    const { deals, sources } = snap.data as {
      deals: { id: string; data: Record<string, unknown> }[];
      sources: { id: string; sourceText: string | null }[];
    };

    let restored = 0;
    let updated = 0;

    for (const deal of deals) {
      const existing = await db
        .select({ id: dealsTable.id })
        .from(dealsTable)
        .where(eq(dealsTable.id, deal.id));
      if (existing.length > 0) {
        await db
          .update(dealsTable)
          .set({ data: deal.data, updatedAt: new Date() })
          .where(eq(dealsTable.id, deal.id));
        updated++;
      } else {
        await db.insert(dealsTable).values({ id: deal.id, data: deal.data });
        restored++;
      }
    }

    for (const source of sources) {
      if (!source.id) continue;
      await db
        .insert(dealSourcesTable)
        .values({ id: source.id, sourceText: source.sourceText ?? null })
        .onConflictDoUpdate({
          target: dealSourcesTable.id,
          set: { sourceText: source.sourceText ?? null },
        });
    }

    res.json({ restored, updated });
  } catch (err) {
    req.log.error({ err }, "Failed to restore snapshot");
    res.status(500).json({ error: "Failed to restore snapshot" });
  }
});

export default router;
