// Global search ranking — pure, so the ORDER Eric asked for is pinned by tests
// rather than by whoever last edited the component.
//
// Three result kinds, ranked deliberately:
//   1. DEAL   — the property itself; always the most specific thing you can open.
//   2. PARENT — a company that owns brands in the library (TJX, Ahold Delhaize).
//               It is a roll-up of many tenant rows, so it outranks any single one,
//               but never a named property.
//   3. TENANT — one brand at one center.
// A parent has no row of its own in any table (it's derived from the roster via the
// curated PARENT_COMPANIES map), so unless it is indexed here it can never be found
// by search at all — which is exactly the gap this closes.
import type { Deal } from "./idb";
import { isVacant, isNAPTenant, parentCompany, tenantLabel, tenantKey } from "./utils";

export interface DealHit { kind: "deal"; dealId: string; title: string; sub: string; where: string }
export interface ParentHit { kind: "parent"; parentName: string; title: string; sub: string; where: string }
export interface TenantHit { kind: "tenant"; dealId: string; title: string; sub: string; where: string }
export type Hit = DealHit | ParentHit | TenantHit;

export const MIN_QUERY = 2;
const MAX_DEALS = 30, MAX_PARENTS = 12, MAX_TENANTS = 40;

function s(v: unknown): string { return typeof v === "string" ? v : v == null ? "" : String(v); }

export function buildSearchHits(deals: Deal[], query: string): Hit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_QUERY) return [];

  const dealHits: DealHit[] = [];
  const tenantHits: TenantHit[] = [];
  // parentKey -> { display name, brand label by tenantKey, distinct deal ids }
  const parents = new Map<string, { name: string; brands: Map<string, string>; deals: Set<string> }>();

  for (const d of deals) {
    if (d.trashedAt) continue;
    const name = s(d.propertyName) || s(d.address) || "Untitled deal";
    const loc = [s(d.city), s(d.state)].filter(Boolean).join(", ");

    const dealHay = [d.propertyName, d.address, d.city, d.state, d.market, d.notes, d.dealThesis, d.dealReview, d.assetType, d.centerType]
      .map(s).join(" ").toLowerCase();
    if (dealHay.includes(needle)) {
      dealHits.push({ kind: "deal", dealId: d.id, title: name, sub: [loc, d.status].filter(Boolean).join(" · "), where: "Deal" });
    }

    const seen = new Set<string>();
    for (const t of d.tenants || []) {
      if (!t || isVacant(t.name) || isNAPTenant(t)) continue;
      const brand = s(t.canonicalName || t.name);
      if (!brand) continue;

      // one tenant row per brand per center
      const k = brand.toLowerCase();
      if (!seen.has(k) && k.includes(needle)) {
        seen.add(k);
        tenantHits.push({ kind: "tenant", dealId: d.id, title: brand, sub: `in ${name}`, where: "Tenant" });
      }

      // Index every brand under its parent regardless of whether the brand itself
      // matched — searching "tjx" must find HomeGoods' parent even though no tenant
      // is literally named "TJX".
      const parent = parentCompany(t.name, t.parentCompany);
      if (!parent) continue;
      const pk = parent.toLowerCase();
      let entry = parents.get(pk);
      if (!entry) { entry = { name: parent, brands: new Map(), deals: new Set() }; parents.set(pk, entry); }
      entry.brands.set(tenantKey(brand), tenantLabel(brand, t.canonicalName));
      entry.deals.add(d.id);
    }
  }

  const parentHits: ParentHit[] = [];
  for (const p of parents.values()) {
    const brands = [...p.brands.values()];
    const nameMatch = p.name.toLowerCase().includes(needle);
    const matchedBrands = brands.filter(b => b.toLowerCase().includes(needle));
    if (!nameMatch && matchedBrands.length === 0) continue;
    // Lead the subtitle with the brands that actually matched — that's what was typed.
    const pool = matchedBrands.length ? matchedBrands : brands;
    const shown = pool.slice(0, 4);
    const more = pool.length - shown.length;
    const n = p.deals.size;
    parentHits.push({
      kind: "parent", parentName: p.name, title: p.name, where: "Parent",
      sub: `${shown.join(", ")}${more > 0 ? ` +${more} more` : ""} · ${n} ${n === 1 ? "property" : "properties"}`,
    });
  }
  // A parent matched by its OWN name outranks one reached only through a brand;
  // ties break on breadth (more properties = more relevant), then name for stability.
  parentHits.sort((a, b) => {
    const ax = a.title.toLowerCase().includes(needle) ? 0 : 1;
    const bx = b.title.toLowerCase().includes(needle) ? 0 : 1;
    if (ax !== bx) return ax - bx;
    const an = Number(a.sub.match(/(\d+) propert/)?.[1] ?? 0);
    const bn = Number(b.sub.match(/(\d+) propert/)?.[1] ?? 0);
    return bn - an || a.title.localeCompare(b.title);
  });

  return [
    ...dealHits.slice(0, MAX_DEALS),
    ...parentHits.slice(0, MAX_PARENTS),
    ...tenantHits.slice(0, MAX_TENANTS),
  ];
}
