import { db, dealsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// SAFE WRITES FOR LONG SWEEPS.
//
// Several maintenance passes read EVERY deal up front and then write each one back over the
// following minutes. Each write reconstructs the whole record from the copy read at the
// start, so anything another process changed in between is silently reverted. Over 320 deals
// those loops run for minutes, which is a wide window.
//
// It is not theoretical. A Datex import wrote live blocks to 38 deals at 17:28:11; a sweep
// already in flight then wrote five of them back from its pre-import copy, and those five
// lost the block with no error anywhere. The data simply was not there afterwards.
//
// The fix is to re-read the row immediately before writing and apply only the keys this pass
// actually changed onto the CURRENT record, instead of writing a whole stale object. The
// window shrinks from minutes to microseconds, and — more importantly — a concurrent change
// to a DIFFERENT field is preserved rather than reverted.

/**
 * Re-read one deal and merge a patch onto its CURRENT data.
 *
 * `patch` is called with the freshly-read record and returns the keys to change, or null to
 * skip the write entirely. Returning a whole object is fine; only the keys present are set,
 * so untouched fields keep whatever another process has since written to them.
 */
export async function updateDealSafely(
  id: string,
  patch: (fresh: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<boolean> {
  const [row] = await db.select().from(dealsTable).where(eq(dealsTable.id, id)).limit(1);
  if (!row) return false;                       // deleted mid-sweep — skip, don't resurrect it
  const fresh = row.data as Record<string, unknown>;
  const changes = patch(fresh);
  if (!changes) return false;
  await db.update(dealsTable)
    .set({ data: { ...fresh, ...changes }, updatedAt: new Date() })
    .where(eq(dealsTable.id, id));
  return true;
}
