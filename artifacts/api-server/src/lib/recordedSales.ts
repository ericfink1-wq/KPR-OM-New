import { db, dealsTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { autoMaintainDealData } from "./dealMaintenance";
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

// Owned/Sold properties missing from the library entirely (Eric, 10/17/26). Created once,
// under a FIXED id (so a restart never duplicates one), only when no live record with the
// same name exists. Facts come from Eric or Datex only; nothing is estimated. A sold
// property Eric gave only a month for (Bolton: "April 2026") gets NO closing date — the
// red "no closing date" flag asks for the exact day instead of us picking one.
export interface MissingProperty { id: string; data: Record<string, unknown> }

export const MISSING_PROPERTIES: MissingProperty[] = [
  { id: "kpr-owned-fred-meyer-bend", data: {
    propertyName: "Fred Meyer Bend", city: "Bend", state: "OR", assetType: "Retail", status: "Owned",
    notes: "Owned property added by hand (10/17/26) — no offering memorandum or rent roll on file yet. Upload one to fill in the details.",
  } },
  { id: "kpr-sold-bolton-plaza", data: {
    // Address / GLA from Datex (Buildings: bolton). Price + month from Eric.
    propertyName: "Bolton Plaza", address: "661 Blanding Boulevard", city: "Orange Park", state: "FL", zip: "32073",
    totalSF: 174037, assetType: "Retail", status: "Sold", txnSalePrice: 22875000,
    notes: "Sold April 2026 for $22,875,000 (exact closing date not yet recorded). Added by hand (10/17/26); no offering memorandum on file.",
  } },
];

export async function addMissingProperties(): Promise<number> {
  let n = 0;
  for (const p of MISSING_PROPERTIES) {
    const name = String(p.data.propertyName);
    const [hit] = await db.select({ n: sql<number>`count(*)::int` }).from(dealsTable).where(
      sql`${dealsTable.id} = ${p.id} OR (lower(trim(${dealsTable.data}->>'propertyName')) = lower(${name}) AND ${dealsTable.data}->>'trashedAt' IS NULL)`);
    if ((hit?.n ?? 0) > 0) continue;
    const now = new Date().toISOString();
    const data = autoMaintainDealData({ ...p.data, uploadedAt: now, tenants: [] }).data;
    await db.insert(dealsTable).values({ id: p.id, data }).onConflictDoNothing();
    rebuildCompsIndex(p.id, data).catch(() => {});
    logger.info({ dealId: p.id, name }, "Added missing owned/sold property");
    n++;
  }
  return n;
}
