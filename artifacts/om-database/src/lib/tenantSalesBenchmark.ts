// Brand "prototype" SALES benchmark — flags a tenant whose sales PSF is way off the
// typical productivity for THAT retailer, measured from every other location of the
// same brand across the whole deal database (self-improving, like the SF benchmark).
//
// Why brand-median, not a roster average: a grocery anchor doing $600/SF and a
// quick-serve pad at $900/SF are both "normal" for their brands — averaging them is
// meaningless. Comparing a Chipotle to OTHER Chipotles is the real "is this store
// unusually strong/weak (or a sales typo)?" signal. LOW sales is the underwriting
// concern (a struggling, occupancy-cost-stressed store at risk of going dark); HIGH
// sales is a strength worth confirming. All deterministic — code, never the model.

import type { Deal, Tenant } from "./idb";
import { tenantKey, isVacant, isNAPTenant } from "./utils";

const MIN_OTHER_LOCATIONS = 2;   // need ≥2 OTHER locations (3 total) for a meaningful brand prototype
const HIGH_RATIO = 1.6;          // ≥60% above the brand median → "way above"
const LOW_RATIO = 0.55;          // ≤45% below → "way below"

export interface BrandSalesObs { dealId: string; salesPSF: number }
export type BrandSalesIndex = Map<string, BrandSalesObs[]>;

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

// One observation per (deal, brand) — the brand's sales PSF at that center. Sales PSF
// is already normalized per square foot, so multiple suites of one chain in a single
// center are deduped to one observation (the max reported) and don't skew the median.
export function buildBrandSalesIndex(allDeals: Deal[]): BrandSalesIndex {
  const idx: BrandSalesIndex = new Map();
  for (const d of allDeals || []) {
    if (!d || d.trashedAt) continue;
    const perBrand = new Map<string, number>();
    for (const t of d.tenants || []) {
      if (!t || isVacant(t.name) || isNAPTenant(t)) continue;
      const key = tenantKey(t.canonicalName || t.name);
      const psf = num(t.salesPSF);
      if (!key || psf == null) continue;
      perBrand.set(key, Math.max(perBrand.get(key) ?? 0, psf));
    }
    for (const [key, psf] of perBrand) {
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key)!.push({ dealId: d.id, salesPSF: psf });
    }
  }
  return idx;
}

export interface SalesFlag {
  severity: "watch";
  direction: "above" | "below";
  label: string;     // short badge, e.g. "−62% vs proto"
  tip: string;       // full explanation
}

// Compare ONE tenant's sales PSF to its brand prototype (median of OTHER deals' locations).
// Returns null when there's no benchmark (too few other locations) or it's in range.
export function flagTenantSales(
  tenant: Tenant, currentDealId: string, index: BrandSalesIndex,
): SalesFlag | null {
  if (isVacant(tenant.name) || isNAPTenant(tenant)) return null;
  const psf = num(tenant.salesPSF);
  if (psf == null) return null;
  const key = tenantKey(tenant.canonicalName || tenant.name);
  if (!key) return null;
  const others = (index.get(key) ?? []).filter((o) => o.dealId !== currentDealId).map((o) => o.salesPSF);
  if (others.length < MIN_OTHER_LOCATIONS) return null;

  const med = median(others);
  if (med <= 0) return null;
  const ratio = psf / med;
  if (ratio < HIGH_RATIO && ratio > LOW_RATIO) return null;

  const pct = Math.round((ratio - 1) * 100);
  const above = ratio >= HIGH_RATIO;
  const brand = tenant.canonicalName || tenant.name || "this brand";
  return {
    severity: "watch",
    direction: above ? "above" : "below",
    label: `${pct > 0 ? "+" : ""}${pct}% vs proto`,
    tip: `$${Math.round(psf).toLocaleString()}/SF sales ${above ? "is" : "is"} ${Math.abs(pct)}% ${above ? "above" : "below"} the ~$${Math.round(med).toLocaleString()}/SF median across ${others.length} other ${brand} location${others.length > 1 ? "s" : ""} in your database. ${above ? "Confirm — a standout performer, or a possible sales overstatement." : "Verify — an underperforming store (occupancy-cost stress, go-dark risk), or a possible sales error."}`,
  };
}

// Deal-level red flag for the analysis section — summarizes every tenant whose sales PSF
// is off its brand prototype. Mirrors the {severity, description} shape of the other
// derived flags (size-outlier, expense-recovery, unsigned-lease, sales-trend).
export interface DerivedFlag { severity: "high" | "medium" | "low"; description: string }

export function deriveSalesOutlierFlag(deal: Deal, index: BrandSalesIndex): DerivedFlag | null {
  const hits: { name: string; f: SalesFlag }[] = [];
  for (const t of deal.tenants || []) {
    const f = flagTenantSales(t, deal.id, index);
    if (f) hits.push({ name: t.canonicalName || t.name || "Tenant", f });
  }
  if (!hits.length) return null;
  // A weak performer (well below brand norm) is the real underwriting concern → medium;
  // tenants only above the norm are a positive note → low.
  const anyBelow = hits.some((h) => h.f.direction === "below");
  const list = hits.map((h) => `${h.name} (${h.f.label})`).join(", ");
  return {
    severity: anyBelow ? "medium" : "low",
    description:
      `Tenant sales off brand prototype: ${hits.length} tenant${hits.length > 1 ? "s" : ""} ` +
      `(${list}) ${hits.length > 1 ? "have" : "has"} sales PSF materially ${anyBelow ? "below/above" : "above"} the typical productivity for ${hits.length > 1 ? "their brands" : "its brand"} across the database. ` +
      `${anyBelow ? "A store well below its brand norm signals occupancy-cost stress / go-dark risk — check the lease for kickout or co-tenancy outs. " : ""}Verify each — an unusual store, or a possible sales-figure error.`,
  };
}

// Convenience: build a tenantKey→flag map for one deal's roster (used by the roster table).
export function buildSalesFlags(deal: Deal, index: BrandSalesIndex): Map<string, SalesFlag> {
  const out = new Map<string, SalesFlag>();
  for (const t of deal.tenants || []) {
    const f = flagTenantSales(t, deal.id, index);
    if (f) out.set(tenantKey(t.canonicalName || t.name), f);
  }
  return out;
}
