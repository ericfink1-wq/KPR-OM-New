// SALE-COMP DUPLICATES (Eric, 10/17/26: "Possible duplicates rose from 42 to 50. Merge the
// true duplicates. Keep resales of the same property (different sale dates) as separate
// comps."). Pure — the caller applies the plan.
//
// Two rows are the SAME TRADE only when everything agrees: the same property (name or
// address), the same state when both have one, and
//   • both dated → within 31 days, and prices within 2% when both are priced;
//   • a date missing → both priced within 1% (and sizes within 2% when both sized).
// Anything looser is left for a person: a resale (dates further apart) is a separate comp by
// definition, and two of KPR's own trades are never merged (they're re-derived from the deal).

export interface CompLike {
  id: number; name: string | null; address: string | null; state: string | null;
  saleDate: string | null; salePrice: number | null; sf: number | null; capRate: number | null;
  isManual: boolean; isOwnTransaction: boolean;
  [k: string]: unknown;
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
const within = (a: number | null, b: number | null, pct: number) =>
  a != null && b != null && a > 0 && b > 0 && Math.abs(a - b) / Math.min(a, b) <= pct / 100;
const days = (a: string | null, b: string | null) => {
  if (!a || !b) return null;
  const x = Date.parse(a), y = Date.parse(b);
  return isNaN(x) || isNaN(y) ? null : Math.abs(x - y) / 86_400_000;
};

export const tierOf = (r: CompLike) => (r.isOwnTransaction ? 2 : r.isManual ? 1 : 0);

/** Same property, different sale dates (> 31 days apart) — a resale, never a duplicate. */
export function isResale(a: CompLike, b: CompLike): boolean {
  const d = days(a.saleDate, b.saleDate);
  return d != null && d > 31;
}

export function sameTrade(a: CompLike, b: CompLike): boolean {
  if (a.isOwnTransaction && b.isOwnTransaction) return false;
  const sameName = !!norm(a.name) && norm(a.name) === norm(b.name);
  const sameAddr = !!norm(a.address) && norm(a.address) === norm(b.address);
  if (!sameName && !sameAddr) return false;
  if (a.state && b.state && a.state.trim().toUpperCase() !== b.state.trim().toUpperCase()) return false;
  const d = days(a.saleDate, b.saleDate);
  if (d != null) {
    if (d > 31) return false;                                            // a resale
    if (a.salePrice != null && b.salePrice != null && !within(a.salePrice, b.salePrice, 2)) return false;
    return true;
  }
  if (!within(a.salePrice, b.salePrice, 1)) return false;
  if (a.sf != null && b.sf != null && !within(a.sf, b.sf, 2)) return false;
  return true;
}

const filled = (r: CompLike) => Object.values(r).filter(v => v != null && v !== "").length;

export interface MergeGroup { keep: CompLike; remove: CompLike[] }

/** Groups of rows that are one trade. The keeper is the best source (KPR's own > broker/
 *  manual > OM), then the most complete row; every other member must match the KEEPER
 *  itself, so a chain of near-matches can never pull in a different trade. */
export function planCompMerges(rows: CompLike[]): MergeGroup[] {
  const parent = new Map<number, number>();
  const find = (x: number): number => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    if (sameTrade(rows[i], rows[j])) parent.set(find(rows[i].id), find(rows[j].id));
  }
  const groups = new Map<number, CompLike[]>();
  for (const r of rows) { const k = find(r.id); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const out: MergeGroup[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => tierOf(b) - tierOf(a) || filled(b) - filled(a) || a.id - b.id);
    const keep = sorted[0];
    const remove = sorted.slice(1).filter(r => !r.isOwnTransaction && sameTrade(keep, r));
    if (remove.length) out.push({ keep, remove });
  }
  return out;
}

const FILLABLE = ["address", "state", "market", "saleDate", "saleDateRaw", "salePrice", "capRate", "pricePerSf", "sf", "occupancy", "anchor", "propertyType", "buyer", "seller"] as const;
/** Blanks on the keeper that a removed copy can fill (only applied to a broker/manual keeper). */
export function fillFrom(keep: CompLike, remove: CompLike[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k of FILLABLE) {
    if (keep[k] != null && keep[k] !== "") continue;
    const v = remove.map(r => r[k]).find(x => x != null && x !== "");
    if (v != null) patch[k] = v;
  }
  return patch;
}
