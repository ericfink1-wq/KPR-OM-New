// Global search ranking — pure, so the ORDER Eric asked for is pinned by tests
// rather than by whoever last edited the component.
//
// Four result kinds, ranked deliberately from most-specific to broadest, with the
// per-property rows LAST because they are the noisiest (one per center):
//   1. DEAL     — the property itself.
//   2. TENANT   — the brand's roll-up page ("Lowes Foods across 11 properties").
//                 This is the page you actually want when you type a retailer's
//                 name, so it sits directly under the deals.
//   3. PARENT   — the holdco above the brand (TJX, Ahold Delhaize).
//   4. LOCATION — that brand at ONE center; opens that deal.
// Neither the brand roll-up nor the parent has a row of its own in any table (both
// are derived from the roster), so unless they are indexed here they cannot be
// reached by search at all — which is exactly the gap this closes.
import type { Deal } from "./idb";
import { isVacant, isNAPTenant, parentCompany, tenantLabel, tenantKey } from "./utils";

export interface DealHit { kind: "deal"; dealId: string; title: string; sub: string; where: string }
export interface TenantPageHit { kind: "tenantPage"; tenantName: string; title: string; sub: string; where: string }
export interface ParentHit { kind: "parent"; parentName: string; title: string; sub: string; where: string }
export interface LocationHit { kind: "location"; dealId: string; title: string; sub: string; where: string }
export type Hit = DealHit | TenantPageHit | ParentHit | LocationHit;

export const MIN_QUERY = 2;
const MAX_DEALS = 30, MAX_BRANDS = 12, MAX_PARENTS = 8, MAX_LOCATIONS = 40;

function s(v: unknown): string { return typeof v === "string" ? v : v == null ? "" : String(v); }

/** "11 properties · NC, SC" — breadth first, then where. */
function spread(nDeals: number, states: Set<string>): string {
  const st = [...states].filter(Boolean).sort();
  const where = st.length ? ` · ${st.slice(0, 3).join(", ")}${st.length > 3 ? ` +${st.length - 3}` : ""}` : "";
  return `${nDeals} ${nDeals === 1 ? "property" : "properties"}${where}`;
}

export function buildSearchHits(deals: Deal[], query: string): Hit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_QUERY) return [];

  const dealHits: DealHit[] = [];
  const locationHits: LocationHit[] = [];
  // tenantKey -> the brand roll-up behind the tenant overview page
  const brands = new Map<string, {
    label: string; nav: string; aliases: Set<string>; deals: Set<string>; states: Set<string>;
  }>();
  // parentKey -> the holdco roll-up
  const parents = new Map<string, { name: string; brands: Map<string, string>; deals: Set<string>; states: Set<string> }>();

  for (const d of deals) {
    if (d.trashedAt) continue;
    const name = s(d.propertyName) || s(d.address) || "Untitled deal";
    const loc = [s(d.city), s(d.state)].filter(Boolean).join(", ");
    const st = s(d.state).toUpperCase();

    const dealHay = [d.propertyName, d.address, d.city, d.state, d.market, d.notes, d.dealThesis, d.dealReview, d.assetType, d.centerType]
      .map(s).join(" ").toLowerCase();
    if (dealHay.includes(needle)) {
      dealHits.push({ kind: "deal", dealId: d.id, title: name, sub: [loc, d.status].filter(Boolean).join(" · "), where: "Deal" });
    }

    const seen = new Set<string>();
    for (const t of d.tenants || []) {
      if (!t || isVacant(t.name) || isNAPTenant(t)) continue;
      const raw = s(t.canonicalName || t.name);
      if (!raw) continue;

      // ── brand roll-up (the tenant overview page) ──────────────────────────────
      // Keyed exactly as TenantView keys itself, and navigated with a raw name from
      // the group, so the page opens on the same set of rows we counted here.
      const bk = tenantKey(raw);
      if (bk) {
        let b = brands.get(bk);
        if (!b) { b = { label: tenantLabel(raw, t.canonicalName), nav: raw, aliases: new Set(), deals: new Set(), states: new Set() }; brands.set(bk, b); }
        b.aliases.add(s(t.name).toLowerCase());
        b.aliases.add(raw.toLowerCase());
        b.deals.add(d.id);
        if (st) b.states.add(st);
      }

      // ── this brand at THIS center ────────────────────────────────────────────
      const k = raw.toLowerCase();
      if (!seen.has(k) && k.includes(needle)) {
        seen.add(k);
        locationHits.push({ kind: "location", dealId: d.id, title: raw, sub: `in ${name}`, where: "Location" });
      }

      // ── holdco roll-up ───────────────────────────────────────────────────────
      // Indexed regardless of whether the brand matched, so "tjx" finds HomeGoods'
      // parent even though no tenant is literally named TJX.
      const parent = parentCompany(t.name, t.parentCompany);
      if (!parent) continue;
      const pk = parent.toLowerCase();
      let p = parents.get(pk);
      if (!p) { p = { name: parent, brands: new Map(), deals: new Set(), states: new Set() }; parents.set(pk, p); }
      p.brands.set(bk, tenantLabel(raw, t.canonicalName));
      p.deals.add(d.id);
      if (st) p.states.add(st);
    }
  }

  const brandHits: TenantPageHit[] = [];
  for (const b of brands.values()) {
    const hay = [b.label.toLowerCase(), ...b.aliases];
    if (!hay.some(h => h.includes(needle))) continue;
    brandHits.push({
      kind: "tenantPage", tenantName: b.nav, title: b.label, where: "Tenant",
      sub: spread(b.deals.size, b.states),
    });
  }

  const parentHits: ParentHit[] = [];
  for (const p of parents.values()) {
    const brandList = [...p.brands.values()];
    const nameMatch = p.name.toLowerCase().includes(needle);
    const matched = brandList.filter(x => x.toLowerCase().includes(needle));
    if (!nameMatch && matched.length === 0) continue;
    // Lead the subtitle with the brands that actually matched — that's what was typed.
    const pool = matched.length ? matched : brandList;
    const shown = pool.slice(0, 3);
    const more = pool.length - shown.length;
    parentHits.push({
      kind: "parent", parentName: p.name, title: p.name, where: "Parent",
      sub: `${shown.join(", ")}${more > 0 ? ` +${more}` : ""} · ${spread(p.deals.size, p.states)}`,
    });
  }

  // Within a tier: something whose NAME starts with what you typed beats a mere
  // substring, then breadth (more properties = more likely what you meant).
  const rank = <T extends { title: string; sub: string }>(a: T, b: T) => {
    const t = (x: T) => x.title.toLowerCase().startsWith(needle) ? 0 : x.title.toLowerCase().includes(needle) ? 1 : 2;
    const n = (x: T) => Number(x.sub.match(/(\d+) propert/)?.[1] ?? 0);
    return t(a) - t(b) || n(b) - n(a) || a.title.localeCompare(b.title);
  };
  brandHits.sort(rank);
  parentHits.sort(rank);

  return [
    ...dealHits.slice(0, MAX_DEALS),
    ...brandHits.slice(0, MAX_BRANDS),
    ...parentHits.slice(0, MAX_PARENTS),
    ...locationHits.slice(0, MAX_LOCATIONS),
  ];
}
