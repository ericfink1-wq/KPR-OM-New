import { db, dealsTable } from "@workspace/db";
import { isTombstoned } from "./dealTombstone";
import { inArray, sql } from "drizzle-orm";
import { updateDealSafely } from "./dealWrite";
import { autoMaintainDealData } from "./dealMaintenance";
import { logger } from "./logger";
import { rebuildCompsIndex } from "./compsIndex";

// Closings Eric confirmed (10/17/26) for owned centers already marked Sold with no
// closing date. Applied on startup, FILL-BLANKS ONLY: a field someone has since entered
// is never overwritten, so this is safe to leave in place and re-run on every boot.
// Pending sales are deliberately NOT recorded anywhere (Eric: the site isn't updated
// until a deal has officially sold).
export interface RecordedSale {
  id: string; name: string; txnSaleDate: string; txnBuyer?: string; txnSalePrice?: number;
  // KPR's original purchase, when Eric supplied it with the sale.
  txnCloseDate?: string; txnPurchasePrice?: number;
  // Eric confirmed the closing for a deal still marked Owned → flip it to Sold (same fields the
  // Mark Sold dialog writes). Only ever flips Owned → Sold; any other status is left alone.
  markSold?: boolean;
}

export const RECORDED_SALES: RecordedSale[] = [
  // Sale prices from Eric 10/17/26 (Pompano $53.0M, Sunshine $56.0M, Crossroads $38.75M).
  { id: "1781018389244-8qtnfqj", name: "Pompano Marketplace", txnSaleDate: "2026-07-28", txnBuyer: "Kimco", txnSalePrice: 53000000 },
  // Bolton: closing date + original acquisition from Eric 10/17/26.
  { id: "kpr-sold-bolton-plaza", name: "Bolton Plaza", txnSaleDate: "2026-04-21", txnSalePrice: 22875000, txnCloseDate: "2019-08-01", txnPurchasePrice: 18050000 },
  { id: "1781018408735-iawdlv1", name: "Sunshine Plaza", txnSaleDate: "2026-07-28", txnBuyer: "Kimco", txnSalePrice: 56000000 },
  { id: "1782135445555-qd67vrz", name: "Shops at Crossroads", txnSaleDate: "2026-06-29", txnSalePrice: 38750000 },
  // Somerset Square (Glastonbury CT): closed 10/20/26 to Asana Partners for $29.0M (Eric, 10/20/26).
  { id: "1781012306039-nsu4bu9", name: "Somerset Square", txnSaleDate: "2026-10-20", txnBuyer: "Asana Partners", txnSalePrice: 29000000, markSold: true },
];

const blank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "") || (typeof v === "number" && !(v > 0));

/** The fields to fill on one deal, or null when there's nothing to do. Pure. */
export function salePatch(data: Record<string, unknown>, sale: RecordedSale): Record<string, string | number> | null {
  const flip = sale.markSold === true && data.status === "Owned";
  if (data.status !== "Sold" && !flip) return null; // only finish a sale already marked closed (or one Eric confirmed closed)
  const patch: Record<string, string | number> = {};
  if (flip) patch.status = "Sold";
  const fill = (k: keyof RecordedSale) => { const v = sale[k]; if (v != null && v !== "" && typeof v !== "boolean" && blank(data[k])) patch[k] = v as string | number; };
  fill("txnSaleDate"); fill("txnBuyer"); fill("txnSalePrice"); fill("txnCloseDate"); fill("txnPurchasePrice");
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
    // Through the normal write-time maintenance, so the Sold-record audit flags refresh too.
    const next = autoMaintainDealData({ ...data, ...patch }).data;
    await db.update(dealsTable).set({ data: next, updatedAt: new Date() }).where(inArray(dealsTable.id, [r.id]));
    rebuildCompsIndex(r.id, next).catch(() => {});
    logger.info({ dealId: r.id, patch }, "Recorded confirmed sale closing");
    n++;
  }
  // Refresh the audit on every Sold deal now, so a missing closing date / sale price is
  // flagged at once (Sunshine Plaza, Shops at Crossroads) instead of at the next daily sweep.
  const sold = await db.select().from(dealsTable).where(sql`${dealsTable.data}->>'status' = 'Sold' AND ${dealsTable.data}->>'trashedAt' IS NULL`);
  for (const r of sold) {
    await updateDealSafely(r.id, (fresh) => { const m = autoMaintainDealData({ ...fresh }); return m.auditAdded || m.auditCleared ? m.data : null; });
  }
  return n;
}

// Owned/Sold properties missing from the library entirely (Eric, 10/17/26). Created once,
// under a FIXED id (so a restart never duplicates one), only when no live record with the
// same name exists. Facts come from Eric or Datex only; nothing is estimated. A sold
// sale is only given a closing date Eric stated to the day (Bolton: 2026-04-21, given 10/17).
export interface MissingProperty { id: string; data: Record<string, unknown> }

export const MISSING_PROPERTIES: MissingProperty[] = [
  { id: "kpr-owned-fred-meyer-bend", data: {
    propertyName: "Fred Meyer Bend", city: "Bend", state: "OR", assetType: "Retail", status: "Owned",
    notes: "Owned property added by hand (10/17/26) — no offering memorandum or rent roll on file yet. Upload one to fill in the details.",
  } },
  { id: "kpr-sold-bolton-plaza", data: {
    // Address / GLA from Datex (Buildings: bolton). Price + month from Eric.
    propertyName: "Bolton Plaza", address: "661 Blanding Boulevard", city: "Orange Park", state: "FL", zip: "32073",
    totalSF: 174037, assetType: "Retail", status: "Sold", txnSalePrice: 22875000, txnSaleDate: "2026-04-21",
    txnCloseDate: "2019-08-01", txnPurchasePrice: 18050000,
    notes: "KPR bought it 2019-08-01 for $18,050,000 and sold it 2026-04-21 for $22,875,000. Added by hand (10/17/26); no offering memorandum on file.",
  } },
];

export async function addMissingProperties(): Promise<number> {
  let n = 0;
  for (const p of MISSING_PROPERTIES) {
    const name = String(p.data.propertyName);
    const [hit] = await db.select({ n: sql<number>`count(*)::int` }).from(dealsTable).where(
      sql`${dealsTable.id} = ${p.id} OR (lower(trim(${dealsTable.data}->>'propertyName')) = lower(${name}) AND ${dealsTable.data}->>'trashedAt' IS NULL)`);
    if ((hit?.n ?? 0) > 0) continue;
    if (await isTombstoned(p.id)) continue;   // deleted on purpose → never re-added at startup
    const now = new Date().toISOString();
    const data = autoMaintainDealData({ ...p.data, uploadedAt: now, tenants: [] }).data;
    await db.insert(dealsTable).values({ id: p.id, data }).onConflictDoNothing();
    rebuildCompsIndex(p.id, data).catch(() => {});
    logger.info({ dealId: p.id, name }, "Added missing owned/sold property");
    n++;
  }
  return n;
}

// SINGLE-TENANT OWNED PROPERTIES NOT IN DATEX (Eric, 10/19/26). Fred Meyer Bend has no Datex
// building, so the Properties tab says "single-tenant · not in Datex" instead of "not mapped",
// and it gets a one-row roster (the tenant only — no SF, rent or dates are invented; those
// stay blank until a lease or rent roll is uploaded). Applied once: only fills an EMPTY roster.
export const SINGLE_TENANT_NOT_IN_DATEX: Array<{ id: string; tenant: Record<string, unknown>; mapNote: string }> = [
  { id: "kpr-owned-fred-meyer-bend", mapNote: "Single-tenant (Fred Meyer) — not in Datex",
    tenant: { name: "Fred Meyer", parentCompany: "Kroger", isAnchor: true, notes: "Single tenant (per Eric, 10/19/26). SF, rent and lease dates not on file yet — upload the lease or a rent roll." } },
];
export async function applySingleTenantProperties(): Promise<number> {
  let n = 0;
  for (const p of SINGLE_TENANT_NOT_IN_DATEX) {
    const [row] = await db.select().from(dealsTable).where(sql`${dealsTable.id} = ${p.id}`).limit(1);
    if (!row) continue;
    const name = String((row.data as Record<string, unknown>).propertyName ?? "");
    await db.execute(sql`INSERT INTO datex_building_map (deal_id, property_name, bldg_ids, note, updated_by)
      VALUES (${p.id}, ${name}, '[]'::jsonb, ${p.mapNote}, 'seed: single-tenant')
      ON CONFLICT (deal_id) DO UPDATE SET note = EXCLUDED.note WHERE jsonb_array_length(datex_building_map.bldg_ids) = 0 AND (datex_building_map.note IS NULL OR datex_building_map.note NOT LIKE 'Single-tenant%')`);
    const wrote = await updateDealSafely(p.id, fresh => {
      if (Array.isArray(fresh.tenants) && fresh.tenants.length) return null;
      return { tenants: [{ ...p.tenant, sf: (fresh.totalSF as number) ?? null, annualRent: null, rentSchedule: "not on file" }], occupancy: 100, centerType: fresh.centerType ?? "Single-Tenant",
        tenantsSource: "single-tenant (entered by KPR)", tenantsManual: true, tenantsAsOf: new Date().toISOString().slice(0, 10) };
    });
    if (wrote) n++;
  }
  return n;
}

// ANSWERED REVIEW QUESTIONS (Eric, 10/19/26): "AI capture — Recourse" on these three owned
// deals is answered by the loan documents. Open recourse questions are RESOLVED (never deleted)
// with the answer, and a blank debtRecourse is filled. Matched by property name.
export const ANSWERED_RECOURSE: Array<{ name: RegExp; answer: string }> = [
  { name: /mattatuck/i, answer: "Non-recourse with a carve-out (bad-boy) guaranty by Katz / Kaufthal, per the loan documents." },
  { name: /concordia/i, answer: "Non-recourse with a carve-out (bad-boy) guaranty by Katz / Kaufthal, per the loan documents." },
  { name: /providence/i, answer: "Non-recourse with a carve-out (bad-boy) guaranty by Katz / Kaufthal, per the loan documents." },
];
export function resolveRecourseQuestions(data: Record<string, unknown>, answer: string, now = new Date().toISOString()): Record<string, unknown> | null {
  const qs = Array.isArray(data.reviewQuestions) ? (data.reviewQuestions as Array<Record<string, unknown>>) : [];
  let hit = 0;
  const next = qs.map(q => {
    if (q?.resolvedAt || !/recourse/i.test(`${q?.field ?? ""}`)) return q;
    hit++;
    return { ...q, resolvedAt: now, resolvedBy: "Eric (10/19/26)", resolution: answer };
  });
  const fill = !String(data.debtRecourse ?? "").trim();
  if (!hit && !fill) return null;
  return { reviewQuestions: next, ...(fill ? { debtRecourse: answer } : {}) };
}
export async function applyAnsweredRecourse(): Promise<number> {
  const rows = await db.select().from(dealsTable).where(sql`${dealsTable.data}->>'status' = 'Owned' AND ${dealsTable.data}->>'trashedAt' IS NULL`);
  let n = 0;
  for (const r of rows) {
    const name = String((r.data as Record<string, unknown>).propertyName ?? "");
    const a = ANSWERED_RECOURSE.find(x => x.name.test(name));
    if (a && await updateDealSafely(r.id, fresh => resolveRecourseQuestions(fresh, a.answer))) n++;
  }
  return n;
}
