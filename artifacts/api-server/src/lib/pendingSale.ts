import { db, dealsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { updateDealSafely } from "./dealWrite";
import { logger } from "./logger";

// NO PENDING-SALE DATA, ANYWHERE (Eric, 10/17/26): "an owned property stays Owned until
// the sale actually closes, then becomes Sold with its closing date." The short-lived
// sale-stage feature is gone, and its data is deleted: the legacy sale* keys on every
// deal, and the buyer / sale price / sale date on any deal still Owned (on an Owned
// property those can only describe a sale that hasn't closed).
export const LEGACY_SALE_KEYS = ["saleStage", "saleExpectedClosing", "saleDeposit", "saleDepositStatus", "salePsaDate", "saleDiligenceEnd"] as const;
export const OWNED_SALE_KEYS = ["txnBuyer", "txnSalePrice", "txnSaleDate"] as const;

/** Remove pending-sale data in place. Returns the keys removed. Pure. */
export function stripPendingSaleData(d: Record<string, unknown>): string[] {
  const removed: string[] = [];
  for (const k of LEGACY_SALE_KEYS) if (k in d) { delete d[k]; removed.push(k); }
  if (d.status === "Owned") for (const k of OWNED_SALE_KEYS) if (k in d) { delete d[k]; removed.push(k); }
  return removed;
}

/** One sweep over stored deals (startup). Idempotent: once clean, it finds nothing. */
export async function purgePendingSaleData(): Promise<number> {
  const keys = sql.raw(LEGACY_SALE_KEYS.map(k => `'${k}'`).join(","));
  const ownedKeys = sql.raw(OWNED_SALE_KEYS.map(k => `'${k}'`).join(","));
  const rows = await db.select().from(dealsTable).where(sql`${dealsTable.data} ?| array[${keys}] OR (${dealsTable.data}->>'status' = 'Owned' AND ${dealsTable.data} ?| array[${ownedKeys}])`);
  let n = 0;
  for (const r of rows) {
    let removed: string[] = [];
    // Re-read before writing (dealWrite.ts): only the removed keys change.
    await updateDealSafely(r.id, (fresh) => {
      removed = stripPendingSaleData({ ...fresh });
      return removed.length ? Object.fromEntries(removed.map(k => [k, undefined])) : null;
    });
    if (!removed.length) continue;
    logger.info({ dealId: r.id, removed }, "Deleted pending-sale data");
    n++;
  }
  return n;
}
