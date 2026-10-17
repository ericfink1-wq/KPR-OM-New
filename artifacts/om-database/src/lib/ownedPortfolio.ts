// THE definition of "what KPR owns" — every page that shows an owned count, an owned
// filter or an owned roll-up calls getOwnedProperties(), so the home page, Portfolio
// Analytics, Critical Dates, brand pages etc. can never disagree again (Eric, 10/16/26:
// home said 39, /api/deals had 40, Portfolio Analytics said 42 — each page had its own
// filter: some counted Sold as owned, some counted deleted deals, none de-duplicated).
//
// Rules:
//  • status === "Owned" only. A property stays Owned until its sale CLOSES (nothing about
//    a pending sale is recorded); then it becomes Sold.
//  • Deleted (trashed) deals never count.
//  • One record per PROPERTY: same name + (same address, same GLA+state, or same
//    state) collapses to the most complete record (most tenants, then most recent).
import type { Deal } from "./idb";
import { sameProperty } from "./portfolioAudit";

export function isOwned(d: { status?: string | null; trashedAt?: unknown }): boolean {
  return !d.trashedAt && d.status === "Owned";
}

const normName = (s: unknown) => String(s ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const normState = (s: unknown) => String(s ?? "").trim().toLowerCase();

function better(a: Deal, b: Deal): Deal {
  const ta = (a.tenants || []).length, tb = (b.tenants || []).length;
  if (ta !== tb) return ta > tb ? a : b;
  const ua = Date.parse(String(a.updatedAt ?? a.uploadedAt ?? "")) || 0;
  const ub = Date.parse(String(b.updatedAt ?? b.uploadedAt ?? "")) || 0;
  return ub > ua ? b : a;
}

/** Collapse records that are the same physical property; keeps the best record of each. */
export function dedupeProperties<T extends Deal>(deals: T[]): T[] {
  const clusters: T[][] = [];
  for (const d of deals) {
    const n = normName(d.propertyName);
    const hit = n ? clusters.find(c => c.some(x => normName(x.propertyName) === n
      && (sameProperty(x, d) || (normState(x.state) !== "" && normState(x.state) === normState(d.state))))) : undefined;
    if (hit) hit.push(d); else clusters.push([d]);
  }
  return clusters.map(c => c.reduce((a, b) => better(a, b) as T));
}

/** Every currently-owned property, once. */
export function getOwnedProperties<T extends Deal>(deals: T[]): T[] {
  return dedupeProperties((deals || []).filter(isOwned));
}
