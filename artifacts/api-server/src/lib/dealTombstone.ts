// Deleted deals STAY deleted (Eric, 10/19/26). Deal 1792431501111-hp3bsxm ("500 A Hawk Ridge
// Dr") was hard-deleted via DELETE /deals/:id → 200, then came back ~20 min later under the
// SAME id: PUT /deals/:id is an upsert, so any late save from a tab that still held the deal
// (the upload queue's deferred image / analysis saves, an open deal page, a retry) re-inserted
// it. Every delete now leaves a TOMBSTONE, and every path that can INSERT a deal row refuses a
// tombstoned id (410 Gone). Background jobs only UPDATE (a deleted row → 0 rows → no index
// rebuild). Only an explicit admin restore (backup restore, snapshot restore) clears one.
//
// Stored in am_records (kind `deal_tombstone`, id `deal_tombstone:<dealId>`) — NO new table.
// That kind is not in ENTRY_KINDS, so the Asset Mgmt record list never returns it.
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

export const TOMBSTONE_KIND = "deal_tombstone";
export const tombstoneId = (dealId: string) => `${TOMBSTONE_KIND}:${dealId}`;

/** The id part of a deal write URL (/deals/<id> or /deals/<id>/…), or null. Collection routes
 *  that share the prefix (/deals/import, /deals/ingest, …) are never tombstoned, so they pass. */
export function dealIdFromPath(path: string): string | null {
  const m = /^\/deals\/([^/?#]+)(?:\/|$)/.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function tombstoneDeal(dealId: string, by: string | null, reason: string): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO am_records (id, kind, deal_id, data, source_note, updated_by)
      VALUES (${tombstoneId(dealId)}, ${TOMBSTONE_KIND}, ${dealId}, ${JSON.stringify({ deletedAt: new Date().toISOString(), reason })}::jsonb, ${reason}, ${by})
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, source_note = EXCLUDED.source_note, updated_by = EXCLUDED.updated_by, updated_at = now()`);
  } catch (err) { logger.error({ err, dealId }, "tombstone write failed"); }
}

/** Is this id deleted for good? A DB error answers false (the old behaviour) rather than blocking saves. */
export async function isTombstoned(dealId: string): Promise<boolean> {
  try {
    const r = await db.execute(sql`SELECT 1 FROM am_records WHERE id = ${tombstoneId(dealId)} LIMIT 1`);
    return (r.rows?.length ?? 0) > 0;
  } catch { return false; }
}

/** The tombstoned subset of `ids` (one query). */
export async function tombstonedAmong(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  try {
    const keys = sql.join(ids.map(i => sql`${tombstoneId(i)}`), sql`, `);
    const r = await db.execute(sql`SELECT deal_id FROM am_records WHERE kind = ${TOMBSTONE_KIND} AND id IN (${keys})`);
    return new Set((r.rows as Array<{ deal_id: string }>).map(x => x.deal_id));
  } catch { return new Set(); }
}

/** An explicit admin restore brings the id back. */
export async function clearTombstone(dealId: string): Promise<void> {
  try { await db.execute(sql`DELETE FROM am_records WHERE id = ${tombstoneId(dealId)}`); } catch { /* best-effort */ }
}

export const GONE_BODY = { error: "This deal was deleted. It can't be saved again under the same id.", code: "deal_deleted", deleted: true };

/** Express guard for every write under /deals/<id>: a tombstoned id gets 410 Gone.
 *  `?restoreDeleted=1` from an admin (backup restore) clears the tombstone and lets the write through. */
export async function refuseDeletedDealWrites(
  req: { method: string; path: string; query?: Record<string, unknown>; session?: { isAdmin?: boolean } },
  res: { status: (n: number) => { json: (b: unknown) => unknown } },
  next: () => void,
): Promise<void> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" || req.method === "DELETE") { next(); return; }
  const id = dealIdFromPath(req.path);
  if (!id || !(await isTombstoned(id))) { next(); return; }
  if (req.query?.restoreDeleted === "1" && req.session?.isAdmin) { await clearTombstone(id); next(); return; }
  res.status(410).json(GONE_BODY);
}
