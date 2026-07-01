// RENEWAL RISK — a lease expiring is only a risk if the tenant might actually
// leave (or use the renewal to beat rent down). This module scores each occupied
// tenant's likelihood of renewing from signals the library already holds, so the
// rollover chart can show WHICH expirations to worry about, and the deal can carry
// one number: base rent genuinely at risk over the next 36 months.
//
// Signal order (strongest first): occupancy cost (rent as % of sales — the single
// best retail renewal predictor), YoY sales trend, watchlist/bankruptcy status,
// dark-store flag, below-market rent or below-market options (a tenant paying
// under market virtually always stays), lease execution status, credit, and the
// category's e-commerce resistance. Sales/sale-price coverage in the library is
// thin, so every score carries a confidence tier and the math degrades gracefully:
// with no sales data it leans on watchlist/credit/category alone at low confidence.
// Deterministic, token-free.
import type { Deal, Tenant } from "./idb";
import { isVacant, isNAPTenant, tenantKey, buildLatestSales, type LatestSale, parseLeaseDate } from "./utils";
import { classifyTenant } from "./retailCategory";
import { isInvestmentGrade } from "./tenantCredit";
import { assessOptionOverhang, type BrandRentIndex } from "./renewalOptionOverhang";
import type { WatchMap } from "./useWatchlist";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type RenewalRiskBand = "secure" | "likely" | "uncertain" | "at-risk";

export interface TenantRenewalRisk {
  band: RenewalRiskBand;
  probability: number;            // 0–100 rough renewal probability (banded, not precise)
  drivers: string[];              // plain-English reasons, strongest first
  confidence: "high" | "medium" | "low";
}

export const RISK_BAND_META: Record<RenewalRiskBand, { label: string; color: string }> = {
  secure: { label: "Secure", color: "#3f7a1f" },
  likely: { label: "Likely renews", color: "#8cbf63" },
  uncertain: { label: "Uncertain", color: "#e0a93e" },
  "at-risk": { label: "At risk", color: "#c4432b" },
};

interface AssessOpts {
  latestSale?: LatestSale | null;       // resolved sales/occ-cost (buildLatestSales)
  watchStatus?: string | null;          // watchlist status for this brand, if any
  marketMedianRentPSF?: number | null;  // brand median from the library (other deals)
}

// Score one occupied tenant. Never returns null — an unknown tenant is scored at
// the base rate with low confidence, which is the honest answer.
export function assessRenewalRisk(t: Tenant, opts: AssessOpts = {}): TenantRenewalRisk {
  let score = 65; // base retail renewal rate — most tenants renew
  const drivers: string[] = [];
  let strongSignals = 0;

  // Occupancy cost: stated on the roster, or resolved (recoveries-aware) from the
  // sales panel. NEVER derived from base÷sales alone (house rule).
  let occ = opts.latestSale?.occupancyCost ?? num(t.occupancyCost);
  if (occ != null && occ > 0 && occ < 1) occ = occ * 100; // fraction slip
  if (occ != null && occ > 0) {
    strongSignals++;
    if (occ < 8) { score += 20; drivers.push(`occupancy cost ${occ.toFixed(1)}% — cheap rent, near-certain renewal (and room to push rent)`); }
    else if (occ <= 12) { score += 8; drivers.push(`occupancy cost ${occ.toFixed(1)}% — healthy`); }
    else if (occ <= 15) { score -= 10; drivers.push(`occupancy cost ${occ.toFixed(1)}% — getting heavy`); }
    else if (occ <= 20) { score -= 25; drivers.push(`occupancy cost ${occ.toFixed(1)}% — stressed; renewal leverage sits with the tenant`); }
    else { score -= 40; drivers.push(`occupancy cost ${occ.toFixed(1)}% — generally unsustainable`); }
  }

  // YoY sales trend (uploaded sales history or OM prior-year sales).
  const latest = opts.latestSale?.salesPSF ?? num(t.salesPSF);
  const prior = num(t.priorSalesPSF);
  if (latest != null && prior != null && prior > 0) {
    const yoy = ((latest - prior) / prior) * 100;
    if (yoy < -10) { score -= 12; drivers.push(`sales down ${Math.abs(yoy).toFixed(0)}% YoY`); strongSignals++; }
    else if (yoy > 8) { score += 5; drivers.push(`sales up ${yoy.toFixed(0)}% YoY`); }
  }

  // Watchlist / distress status (bankruptcy news beats every model).
  const ws = (opts.watchStatus || "").toLowerCase();
  if (ws === "liquidating") { score -= 55; drivers.unshift("liquidating (watchlist)"); strongSignals++; }
  else if (ws === "bankruptcy") { score -= 45; drivers.unshift("in bankruptcy (watchlist)"); strongSignals++; }
  else if (ws === "distressed") { score -= 25; drivers.unshift("distressed (watchlist)"); strongSignals++; }
  else if (ws === "watch") { score -= 10; drivers.push("on the retailer watchlist"); }

  // A dark store is paying rent but not operating — it will not renew.
  if (t.isDark) { score -= 40; drivers.unshift("dark store — open lease, closed store"); strongSignals++; }

  // Below-market rent: a tenant paying well under market almost always stays.
  const inPlace = num(t.rentPerSF);
  const median = opts.marketMedianRentPSF ?? null;
  if (inPlace != null && inPlace > 0 && median != null && median > 0) {
    const gap = ((median - inPlace) / median) * 100;
    if (gap >= 20) { score += 15; drivers.push(`rent ~${Math.round(gap)}% below the brand's library median — strong incentive to stay`); }
    else if (gap <= -20) { score -= 10; drivers.push(`rent ~${Math.round(-gap)}% ABOVE the brand's library median — renewal likely contested`); }
  }
  // Below-market fixed options are a lock: the tenant will exercise.
  const oh = assessOptionOverhang(t, median);
  if (oh?.status === "encumbered") { score += 15; drivers.push("holds below-market renewal options — will exercise (income secure, upside locked)"); }

  // Lease not yet executed — the "expiration" isn't even contractual yet.
  if (t.leaseStatus === "loi" || t.leaseStatus === "proposed") { score -= 15; drivers.push("lease not yet executed (LOI/proposed)"); }

  // Softer priors: credit and category e-commerce resistance.
  if (isInvestmentGrade(t.canonicalName || t.name || "", t.creditRating)) { score += 6; drivers.push("investment-grade credit"); }
  const cls = classifyTenant(t.canonicalName || t.name || "");
  if (cls.resistance >= 70) score += 4;
  else if (cls.resistance <= 40) { score -= 5; drivers.push("e-commerce-exposed category"); }

  const probability = Math.max(5, Math.min(95, Math.round(score)));
  const band: RenewalRiskBand =
    probability >= 75 ? "secure" : probability >= 55 ? "likely" : probability >= 35 ? "uncertain" : "at-risk";
  const confidence: TenantRenewalRisk["confidence"] =
    strongSignals >= 2 ? "high" : strongSignals === 1 ? "medium" : "low";
  return { band, probability, drivers, confidence };
}

// Build a per-tenant risk map for a deal, keyed by the tenant OBJECT (the roster
// array is passed around by reference, so identity keys can't collide the way
// name keys do when a brand has two suites).
export function buildRenewalRiskIndex(
  deal: Deal,
  opts: { watch?: WatchMap | null; rentIndex?: BrandRentIndex | null } = {},
): Map<Tenant, TenantRenewalRisk> {
  const out = new Map<Tenant, TenantRenewalRisk>();
  const sales = buildLatestSales(deal);
  for (const t of deal.tenants || []) {
    if (!t || isVacant(t.name) || isNAPTenant(t)) continue;
    const key = tenantKey(t.canonicalName || t.name || "");
    const bench = opts.rentIndex && key ? opts.rentIndex.get(key, deal.id) : null;
    out.set(t, assessRenewalRisk(t, {
      latestSale: key ? sales.get(key) ?? null : null,
      watchStatus: key ? opts.watch?.get(key)?.status ?? null : null,
      marketMedianRentPSF: bench?.median ?? null,
    }));
  }
  return out;
}

// Base rent genuinely at risk in the next `months`: for each occupied tenant whose
// lease expires inside the window (or already has), rent × (1 − renewal probability).
export interface RentAtRisk {
  atRisk: number;            // $ / yr expected to be lost/contested
  expiring: number;          // $ / yr expiring in the window at all
  totalRent: number;         // occupied base rent
  pctOfRent: number | null;  // atRisk ÷ totalRent
  tenantsInWindow: number;
}

export function computeRentAtRisk(
  deal: Deal,
  risks: Map<Tenant, TenantRenewalRisk>,
  months = 36,
): RentAtRisk {
  const ref = (deal.tenantsAsOf && parseLeaseDate(deal.tenantsAsOf)) || new Date();
  const horizon = ref.getTime() + months * 30.4375 * 86_400_000;
  let atRisk = 0, expiring = 0, totalRent = 0, tenantsInWindow = 0;
  for (const t of deal.tenants || []) {
    if (!t || isVacant(t.name) || isNAPTenant(t)) continue;
    const rent = num(t.annualRent) || 0;
    totalRent += rent;
    const exp = parseLeaseDate(t.leaseExpiry);
    if (!exp || exp.getTime() > horizon || rent <= 0) continue;
    tenantsInWindow++;
    expiring += rent;
    const r = risks.get(t);
    const p = r ? r.probability / 100 : 0.65;
    atRisk += rent * (1 - p);
  }
  return {
    atRisk,
    expiring,
    totalRent,
    pctOfRent: totalRent > 0 ? (atRisk / totalRent) * 100 : null,
    tenantsInWindow,
  };
}
