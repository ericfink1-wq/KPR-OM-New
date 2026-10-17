import { db, dealsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger";
import { rebuildCompsIndex } from "./compsIndex";

// Closings Eric confirmed (10/17/26) for owned centers already marked Sold with no
// closing date. Applied on startup, FILL-BLANKS ONLY: a field someone has since entered
// is never overwritten, so this is safe to leave in place and re-run on every boot.
// Pending sales are deliberately NOT recorded anywhere (Eric: the site isn't updated
// until a deal has officially sold).
export interface RecordedSale { id: string; name: string; txnSaleDate: string; txnBuyer?: string }

export const RECORDED_SALES: RecordedSale[] = [
  { id: "1781018389244-8qtnfqj", name: "Pompano Marketplace", txnSaleDate: "2026-07-28", txnBuyer: "Kimco" },
  { id: "1781018408735-iawdlv1", name: "Sunshine Plaza", txnSaleDate: "2026-07-28", txnBuyer: "Kimco" },
  { id: "1782135445555-qd67vrz", name: "Shops at Crossroads", txnSaleDate: "2026-06-29" },
];

const blank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

/** The fields to fill on one deal, or null when there's nothing to do. Pure. */
export function salePatch(data: Record<string, unknown>, sale: RecordedSale): Record<string, string> | null {
  if (data.status !== "Sold") return null; // only finish a sale already marked closed
  const patch: Record<string, string> = {};
  if (blank(data.txnSaleDate)) patch.txnSaleDate = sale.txnSaleDate;
  if (sale.txnBuyer && blank(data.txnBuyer)) patch.txnBuyer = sale.txnBuyer;
  return Object.keys(patch).length ? patch : null;
}

export async function applyRecordedSales(): Promise<number> {
  const byId = new Map(RECORDED_SALES.map(s => [s.id, s]));
  const rows = await db.select().from(dealsTable).where(inArray(dealsTable.id, [...byId.keys()]));
  let n = 0;
  for (const r of rows) {
    const data = r.data as Record<string, unknown>;
    const patch = salePatch(data, byId.get(r.id)!);
    if (!patch) continue;
    const next = { ...data, ...patch };
    await db.update(dealsTable).set({ data: next, updatedAt: new Date() }).where(inArray(dealsTable.id, [r.id]));
    rebuildCompsIndex(r.id, next).catch(() => {});
    logger.info({ dealId: r.id, patch }, "Recorded confirmed sale closing");
    n++;
  }
  return n;
}
