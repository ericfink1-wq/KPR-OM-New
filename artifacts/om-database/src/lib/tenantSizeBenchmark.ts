// Brand "prototype" size benchmark — flags a tenant whose square footage is way
// off the typical footprint for THAT retailer, measured from every other location
// of the same brand across the whole deal database (self-improving, like comps).
//
// Why brand-median, not a roster average: a center mixes a 30,000 SF anchor with
// 1,500 SF inlines, so an average is meaningless. Comparing a Five Below to OTHER
// Five Belows is the real "is this store unusually large/small (or a SF typo)?"
// signal. All deterministic — computed in code, never the model.

import type { Deal, Tenant } from "./idb";
import { tenantKey, isVacant, isNAPTenant, brandBenchmarkKey } from "./utils";
import { tjxComboRead } from "./tjxCombo";

const MIN_OTHER_LOCATIONS = 2;   // need ≥2 OTHER locations (3 total) for a meaningful brand prototype
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
      // Key includes the tenant's FORMAT so a brand's ATMs / fuel pads benchmark
      // against their own kind, never dragging the full-store median.
      const key = brandBenchmarkKey(t.canonicalName || t.name, t.sf);
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
  combo?: boolean;   // this is a likely TJX combo box, NOT a size anomaly
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

  // TJX combo boxes: an explicit two-banner box ("Marshalls / HomeGoods") is a KNOWN
  // combo, so it is not a size anomaly at all — suppress the flag (the roster shows a
  // "combo" chip instead). A single-banner TJX name on a combo-sized box is a LIKELY
  // combo — surface that read (one lease, two banners) rather than a misleading
  // "oversized / possible SF error." This fires even with no brand prototype, so it
  // works on the common case where the rent roll names only one banner.
  const combo = tjxComboRead(tenant.canonicalName || tenant.name, tenant.sf);
  if (combo.isCombo) return null;
  if (combo.likely) {
    return { severity: "watch", direction: "above", combo: true, label: "likely combo", tip: combo.note };
  }

  const key = brandBenchmarkKey(tenant.canonicalName || tenant.name, tenant.sf);
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

// Deal-level red flag for the analysis section — summarizes every tenant whose SF is
// off its brand prototype. Mirrors the {severity, description} shape of the other
// derived flags (expense-recovery, unsigned-lease, sales-trend).
export interface DerivedFlag { severity: "high" | "medium" | "low"; description: string }

export function deriveSizeOutlierFlag(deal: Deal, index: BrandSizeIndex): DerivedFlag | null {
  const hits: { name: string; f: SizeFlag }[] = [];
  for (const t of deal.tenants || []) {
    const f = flagTenantSize(t, deal.id, index);
    // A TJX combo box is an expected two-banner store, not a footprint anomaly or SF
    // error — keep it off the deal-level "SF off prototype" red flag (the roster chip
    // and its tooltip carry the combo read instead).
    if (f && !f.combo) hits.push({ name: t.canonicalName || t.name || "Tenant", f });
  }
  if (!hits.length) return null;
  // A wildly off footprint (≥2.2× or ≤0.4×) is more likely a SF entry error → medium;
  // otherwise a low-severity "unusual store, verify" note.
  const extreme = hits.some((h) => /(\+[2-9]\d\d%|\+1\d\d%)|−[5-9]\d%/.test(h.f.label));
  const list = hits.map((h) => `${h.name} (${h.f.label})`).join(", ");
  return {
    severity: extreme ? "medium" : "low",
    description:
      `Square footage off brand prototype: ${hits.length} tenant${hits.length > 1 ? "s" : ""} ` +
      `(${list}) ${hits.length > 1 ? "are" : "is"} materially larger/smaller than the typical footprint for ${hits.length > 1 ? "their brands" : "its brand"} across the database. ` +
      `Verify each — an unusual store, or a possible SF entry error (which would distort rent PSF, occupancy and recovery math).`,
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
