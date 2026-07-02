// ABOVE-MARKET RENT → ROLLOVER / MARK-TO-MARKET DOWNSIDE. The mirror of the
// below-market read: a tenant paying well ABOVE the brand's library median is a
// premium that may not survive renewal — at the next expiry/option the rent can
// reset DOWN toward market, or the tenant leaves — and the above-market rent
// INFLATES current NOI, so a buyer capping that NOI overpays for income that rolls
// off. It is NOT "upside." Whether it's a real risk turns on SUSTAINABILITY: a
// store with strong sales / low occupancy cost can afford the premium (skip it);
// weak sales / high occupancy cost, or a reset inside the hold with no sales to
// confirm, is the risk. Deterministic, token-free. Sales coverage is thin, so the
// common output is a measured "verify sales support the premium," not a hard call.
import type { Deal, Tenant } from "./idb";
import type { DerivedFlag } from "./expenseRisk";
import { isVacant, isNAPTenant, tenantKey, parseLeaseDate, buildLatestSales } from "./utils";
import type { BrandRentIndex } from "./renewalOptionOverhang";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const ABOVE_PCT = 25;            // >= this % above the brand median = "materially above"
const MIN_ANNUAL_PREMIUM = 25_000; // ignore trivial premiums
const OCC_SUSTAINABLE = 10;      // occupancy cost <= this = premium is earned (skip)
const OCC_STRESSED = 15;         // occupancy cost >= this = premium likely unsustainable
const HOLD_YEARS = 7;            // reset within this window = can hit KPR during the hold

type Sustainability = "at-risk" | "verify";

interface AboveHit {
  name: string;
  inPlace: number;
  median: number;
  locations: number;
  premiumPct: number;
  annualPremium: number;   // (inPlace − median) × SF — the $ above market at risk at reset
  occCost: number | null;
  resetYear: number | null;
  nearTerm: boolean;       // reset within the hold
  isAnchor: boolean;
  rentShare: number | null;
  kind: Sustainability;
}

export function deriveAboveMarketRolldownFlag(deal: Deal, rentIndex: BrandRentIndex): DerivedFlag | null {
  const tenants = (deal.tenants || []).filter((t): t is Tenant => !!t && !isVacant(t.name) && !isNAPTenant(t));
  if (tenants.length === 0) return null;
  const totalRent = tenants.reduce((s, t) => s + (num(t.annualRent) || 0), 0);
  const sales = buildLatestSales(deal);
  const refYear = ((deal.tenantsAsOf && parseLeaseDate(deal.tenantsAsOf)) || new Date()).getFullYear();

  const hits: AboveHit[] = [];
  for (const t of tenants) {
    const inPlace = num(t.rentPerSF);
    const sf = num(t.sf);
    if (inPlace == null || inPlace <= 0 || sf == null || sf <= 0) continue;
    const key = tenantKey(t.canonicalName || t.name || "");
    const bench = rentIndex.get(key, deal.id);
    if (!bench) continue;
    const premiumPct = ((inPlace - bench.median) / bench.median) * 100;
    if (premiumPct < ABOVE_PCT) continue;
    const annualPremium = (inPlace - bench.median) * sf;
    if (annualPremium < MIN_ANNUAL_PREMIUM) continue;

    // Resolved occupancy cost (recoveries-aware) → stated fallback; normalize fraction.
    let occ = sales.get(key)?.occupancyCost ?? num(t.occupancyCost);
    if (occ != null && occ > 0 && occ < 1) occ = occ * 100;

    // A store that clearly earns the premium (low occupancy cost) is not a risk — skip.
    if (occ != null && occ <= OCC_SUSTAINABLE) continue;

    const exp = parseLeaseDate(t.leaseExpiry);
    const remTerm = num(t.remainingTermYears);
    const resetYear = exp ? exp.getFullYear() : null;
    const nearTerm =
      (exp != null && (exp.getFullYear() - refYear) <= HOLD_YEARS) ||
      (remTerm != null && remTerm <= HOLD_YEARS);

    const kind: Sustainability = occ != null && occ >= OCC_STRESSED ? "at-risk" : "verify";
    const rentShare = totalRent > 0 ? ((num(t.annualRent) || 0) / totalRent) * 100 : null;

    // A long-locked "verify" (no sales, reset well past the hold) is an exit-NOI note,
    // not an in-hold risk — only surface it for a material anchor/large position.
    if (kind === "verify" && !nearTerm && !t.isAnchor && (rentShare == null || rentShare < 10)) continue;

    hits.push({
      name: t.canonicalName || t.name || "Tenant", inPlace, median: bench.median, locations: bench.locations,
      premiumPct, annualPremium, occCost: occ ?? null, resetYear, nearTerm, isAnchor: !!t.isAnchor, rentShare, kind,
    });
  }
  if (hits.length === 0) return null;

  hits.sort((a, b) => b.annualPremium - a.annualPremium);
  const anyAtRisk = hits.some((h) => h.kind === "at-risk");
  const material = hits.some((h) => h.isAnchor || (h.rentShare != null && h.rentShare >= 10));
  const anyNearAtRisk = hits.some((h) => h.kind === "at-risk" && h.nearTerm);
  const severity: DerivedFlag["severity"] =
    anyNearAtRisk && material ? "high"
    : anyAtRisk || (material && hits.some((h) => h.nearTerm)) ? "medium"
    : "low";

  const fmt = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}K`;
  const parts = hits.slice(0, 3).map((h) => {
    const reset = h.resetYear ? `; resets ~${h.resetYear}${h.nearTerm ? " (in hold)" : ""}` : "";
    const sustain = h.kind === "at-risk"
      ? `occupancy cost ${h.occCost!.toFixed(0)}% suggests the premium is hard to sustain`
      : "confirm the tenant's sales support the premium";
    return `${h.name} at $${h.inPlace.toFixed(2)}/SF is +${Math.round(h.premiumPct)}% above the ~$${h.median.toFixed(2)} median across ${h.locations} library leases — ${sustain}${reset} (~${fmt(h.annualPremium)}/yr of rent above market)`;
  });
  return {
    severity,
    description: `Above-market rent — mark-to-market DOWNSIDE, not upside: ${parts.join("; ")}. At renewal the premium can reset toward market or the tenant leaves, and it inflates in-place NOI (a buyer capping that NOI overpays). Brand medians are from your own library (directional) — check sales/occupancy cost and the reset date.`,
  };
}
