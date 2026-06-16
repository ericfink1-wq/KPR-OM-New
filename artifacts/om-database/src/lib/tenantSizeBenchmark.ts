// Brand "prototype" size benchmark — flags a tenant whose square footage is way
// off the typical footprint for THAT retailer, measured from every other location
// of the same brand across the whole deal database (self-improving, like comps).
//
// Why brand-median, not a roster average: a center mixes a 30,000 SF anchor with
// 1,500 SF inlines, so an average is meaningless. Comparing a Five Below to OTHER
// Five Belows is the real "is this store unusually large/small (or a SF typo)?"
// signal. All deterministic — computed in code, never the model.

import type { Deal, Tenant } from "./idb";
import { tenantKey, isVacant, isNAPTenant } from "./utils";

const MIN_OTHER_LOCATIONS = 3;   // need ≥3 other locations of the brand for a meaningful prototype
const HIGH_RATIO = 1.6;          // ≥60% larger than the brand median → "way above"
const LOW_RATIO = 0.55;          // ≤45% smaller → "way below"

export interface BrandSizeObs { dealId: string; sf: number }
export type BrandSizeIndex = Map<string, BrandSizeObs[]>;

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// One observation per (deal, brand) — the brand's total SF in that center — so a
// chain with two suites in one center counts once and doesn't skew its own median.
export function buildBrandSizeIndex(allDeals: Deal[]): BrandSizeIndex {
  const idx: BrandSizeIndex = new Map();
  for (const d of allDeals || []) {
    if (!d || d.trashedAt) continue;
    const perBrand = new Map<string, number>();
    for (const t of d.tenants || []) {
      if (!t || isVacant(t.name) || isNAPTenant(t)) continue;
      const key = tenantKey(t.canonicalName || t.name);
      const sf = num(t.sf);
      if (!key || sf == null) continue;
      perBrand.set(key, (perBrand.get(key) ?? 0) + sf);
    }
    for (const [key, sf] of perBrand) {
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key)!.push({ dealId: d.id, sf });
    }
  }
  return idx;
}

export interface SizeFlag {
  severity: "watch";
  direction: "above" | "below";
  label: string;     // short badge, e.g. "+85% vs proto"
  tip: string;       // full explanation
}

// Compare ONE tenant's SF to its brand prototype (median of OTHER deals' locations).
// Returns null when there's no benchmark (too few other locations) or it's in range.
export function flagTenantSize(
  tenant: Tenant, currentDealId: string, index: BrandSizeIndex,
): SizeFlag | null {
  if (isVacant(tenant.name) || isNAPTenant(tenant)) return null;
  const sf = num(tenant.sf);
  if (sf == null) return null;
  const key = tenantKey(tenant.canonicalName || tenant.name);
  if (!key) return null;
  const others = (index.get(key) ?? []).filter((o) => o.dealId !== currentDealId).map((o) => o.sf);
  if (others.length < MIN_OTHER_LOCATIONS) return null;

  const med = median(others);
  if (med <= 0) return null;
  const ratio = sf / med;
  if (ratio < HIGH_RATIO && ratio > LOW_RATIO) return null;

  const pct = Math.round((ratio - 1) * 100);
  const above = ratio >= HIGH_RATIO;
  const brand = tenant.canonicalName || tenant.name || "this brand";
  return {
    severity: "watch",
    direction: above ? "above" : "below",
    label: `${pct > 0 ? "+" : ""}${pct}% vs proto`,
    tip: `${sf.toLocaleString()} SF is ${Math.abs(pct)}% ${above ? "above" : "below"} the ~${Math.round(med).toLocaleString()} SF median across ${others.length} other ${brand} location${others.length > 1 ? "s" : ""} in your database. Verify — an unusual footprint, or a possible SF error.`,
  };
}

// Convenience: build a tenantKey→flag map for one deal's roster (used by the roster table).
export function buildSizeFlags(deal: Deal, index: BrandSizeIndex): Map<string, SizeFlag> {
  const out = new Map<string, SizeFlag>();
  for (const t of deal.tenants || []) {
    const f = flagTenantSize(t, deal.id, index);
    if (f) out.set(tenantKey(t.canonicalName || t.name), f);
  }
  return out;
}
