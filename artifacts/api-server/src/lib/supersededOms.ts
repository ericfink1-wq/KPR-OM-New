import { db, dealsTable, dealImagesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { recordHistory } from "./propertyHistory";

// AN OLDER OM SUPERSEDED BY A NEWER ONE for the same property (Eric, 10/17/26: "we have an
// older OM that now is covered by a new OM — newer info is always best"). The NEWER record
// stays as the deal; the older one goes to Trash (restorable). Only what a PERSON entered
// on the older record carries over, and only where the newer record is blank — never the
// old OM's own figures (roster, NOI, its loan balance…), which the newer OM replaces.
export interface Superseded { keep: string; retire: string; property: string; why: string }

export const SUPERSEDED_OMS: Superseded[] = [
  { property: "New Garden Crossing", keep: "1788365563290-3yq0gsx", retire: "1788365547238-wc2ic4z",
    why: "Feb 2021 OM superseded by the 2026 OM (same address, same 168,950 SF)" },
];

// Human-entered fields only: KPR's own terms + notes + operator data.
const HUMAN_KEY = /^(acq|debt|pref|txn|disp)/;
const HUMAN_EXTRA = ["userNotes", "dealThesis", "dealReview", "verified", "aka", "propertyGroupId",
  "ownershipStructure", "tenantSalesHistory", "datexLive", "prepayTerms", "interestRateSwap", "customAmortSchedule"];
const blank = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0)
  || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** Pure: the fields to copy from the retired record onto the kept one. */
export function carryOver(keep: Record<string, unknown>, retire: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(retire)) {
    if (!(HUMAN_KEY.test(k) || HUMAN_EXTRA.includes(k))) continue;
    if (!blank(v) && blank(keep[k])) out[k] = v;
  }
  return out;
}

export async function retireSupersededOms(): Promise<number> {
  let n = 0;
  for (const s of SUPERSEDED_OMS) {
    const rows = await db.select().from(dealsTable).where(inArray(dealsTable.id, [s.keep, s.retire]));
    const keep = rows.find(r => r.id === s.keep), old = rows.find(r => r.id === s.retire);
    if (!keep || !old) continue;
    const kd = keep.data as Record<string, unknown>, od = old.data as Record<string, unknown>;
    if (kd.trashedAt) continue; // the keeper was deleted — leave it to a person
    // History first (Eric, 10/17/26: newer wins, but keep what happened). Runs even when the
    // older record was already retired on an earlier boot, so it backfills once.
    const next: Record<string, unknown> = { ...kd };
    const recorded = recordHistory(od, next, undefined, `superseded:${s.retire}`);
    if (od.trashedAt) {
      if (recorded) await db.update(dealsTable).set({ data: next, updatedAt: new Date() }).where(eq(dealsTable.id, s.keep));
      continue;
    }
    const patch = carryOver(kd, od);
    const now = new Date().toISOString();
    if (Object.keys(patch).length || recorded) await db.update(dealsTable).set({ data: { ...next, ...patch }, updatedAt: new Date() }).where(eq(dealsTable.id, s.keep));
    // Cover photo: keep the newer one's; borrow the older one's only if the newer has none.
    try {
      const imgs = await db.select().from(dealImagesTable).where(inArray(dealImagesTable.id, [s.keep, s.retire]));
      const ki = imgs.find(i => i.id === s.keep), oi = imgs.find(i => i.id === s.retire);
      if (oi?.cover && !ki?.cover) {
        await db.insert(dealImagesTable).values({ id: s.keep, cover: oi.cover, coverThumb: oi.coverThumb })
          .onConflictDoUpdate({ target: dealImagesTable.id, set: { cover: oi.cover, coverThumb: oi.coverThumb } });
      }
    } catch { /* images are best-effort */ }
    await db.update(dealsTable).set({ data: { ...od, trashedAt: now, trashedReason: `superseded by a newer OM (${s.keep}): ${s.why}` }, updatedAt: new Date() }).where(eq(dealsTable.id, s.retire));
    logger.info({ property: s.property, kept: s.keep, retired: s.retire, carried: Object.keys(patch) }, "Retired a superseded OM");
    n++;
  }
  return n;
}
