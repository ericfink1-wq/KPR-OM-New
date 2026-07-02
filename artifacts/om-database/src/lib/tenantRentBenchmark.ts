// Brand RENT benchmark — flags a tenant whose IN-PLACE rent PSF is materially above
// or below the same chain's median rent across the whole deal database (self-
// improving, like the SF and SALES benchmarks). Comparing a Ross to OTHER Ross
// leases is the real "is this rent unusually high/low for this chain?" signal.
//
// POLARITY (KPR is the BUYER): BELOW-chain rent is FAVORABLE — embedded mark-to-
// market and you're not overpaying for inflated income (green). ABOVE-chain rent is
// a PREMIUM RISK — it can reset DOWN at renewal (or the tenant leaves) and it
// INFLATES in-place NOI, so a buyer capping that NOI overpays (red). This is the
// opposite polarity from SALES (where high = strong = green) on purpose: you want
// LOW rent and HIGH sales. Whether a below-market rent is capturable still depends
// on options/term/sales — the tooltip says so; the flag only marks the deviation.
// Deterministic — code, never the model.
import type { Deal, Tenant } from "./idb";
import { tenantKey, isVacant, isNAPTenant, brandBenchmarkKey } from "./utils";

const MIN_OTHER_LOCATIONS = 2;   // need ≥2 OTHER locations (3 total) for a meaningful chain median
const HIGH_RATIO = 1.25;         // ≥25% above the chain median → "way above" (premium)
const LOW_RATIO = 0.75;          // ≤25% below → "way below" (below market)

export interface BrandRentObs { dealId: string; rentPSF: number }
export type BrandRentPsfIndex = Map<string, BrandRentObs[]>;

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

// One observation per (deal, brand+format) — the brand's in-place rent PSF at that
// center. Format-aware (via brandBenchmarkKey) so a fuel-pad / ATM kiosk benchmarks
// against its own kind, never against the full-store median.
export function buildBrandRentPsfIndex(allDeals: Deal[]): BrandRentPsfIndex {
  const idx: BrandRentPsfIndex = new Map();
  for (const d of allDeals || []) {
    if (!d || d.trashedAt) continue;
    const perBrand = new Map<string, number>();
    for (const t of d.tenants || []) {
      if (!t || isVacant(t.name) || isNAPTenant(t)) continue;
      const key = brandBenchmarkKey(t.canonicalName || t.name, t.sf);
      const psf = num(t.rentPerSF);
      if (!key || psf == null) continue;
      perBrand.set(key, Math.max(perBrand.get(key) ?? 0, psf));
    }
    for (const [key, psf] of perBrand) {
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key)!.push({ dealId: d.id, rentPSF: psf });
    }
  }
  return idx;
}

export interface RentFlag {
  direction: "above" | "below";
  pct: number;        // signed % vs chain median (+ = above)
  label: string;      // short badge, e.g. "+53% vs chain"
  tip: string;        // full explanation with the underwriting read
}

// Compare ONE tenant's in-place rent PSF to its chain median (OTHER deals' locations).
// Returns null when there's no benchmark (too few other locations) or it's in range.
export function flagTenantRent(
  tenant: Tenant, currentDealId: string, index: BrandRentPsfIndex,
): RentFlag | null {
  if (isVacant(tenant.name) || isNAPTenant(tenant)) return null;
  const psf = num(tenant.rentPerSF);
  if (psf == null) return null;
  const key = brandBenchmarkKey(tenant.canonicalName || tenant.name, tenant.sf);
  if (!key) return null;
  const others = (index.get(key) ?? []).filter((o) => o.dealId !== currentDealId).map((o) => o.rentPSF);
  if (others.length < MIN_OTHER_LOCATIONS) return null;

  const med = median(others);
  if (med <= 0) return null;
  const ratio = psf / med;
  if (ratio < HIGH_RATIO && ratio > LOW_RATIO) return null;

  const pct = Math.round((ratio - 1) * 100);
  const above = ratio >= HIGH_RATIO;
  const brand = tenant.canonicalName || tenant.name || "this brand";
  const locs = `${others.length} other ${brand} location${others.length > 1 ? "s" : ""} in your database`;
  return {
    direction: above ? "above" : "below",
    pct,
    label: `${pct > 0 ? "+" : ""}${pct}% vs chain`,
    tip: above
      ? `$${psf.toFixed(2)}/SF is ${pct}% ABOVE the ~$${med.toFixed(2)}/SF median across ${locs} — an above-market PREMIUM. It can reset down at renewal (or the tenant leaves) and it inflates in-place NOI, so a buyer capping that NOI overpays. Verify the tenant's sales/occupancy cost support the premium; if they don't, treat it as rollover / mark-to-market downside.`
      : `$${psf.toFixed(2)}/SF is ${Math.abs(pct)}% BELOW the ~$${med.toFixed(2)}/SF median across ${locs} — a below-market/favorable basis (you're not overpaying for inflated income). Whether it's capturable mark-to-market upside depends on remaining term, renewal options, and sales — a below-market lease locked by cheap options is secure income, not upside.`,
  };
}

// Convenience: build a tenantKey→flag map for one deal's roster (used by the roster table).
export function buildRentFlags(deal: Deal, index: BrandRentPsfIndex): Map<string, RentFlag> {
  const out = new Map<string, RentFlag>();
  for (const t of deal.tenants || []) {
    const f = flagTenantRent(t, deal.id, index);
    if (f) out.set(tenantKey(t.canonicalName || t.name), f);
  }
  return out;
}
