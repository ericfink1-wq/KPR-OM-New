// Cross-check the tax forecast against COMPARABLE properties in our own database.
//
// True "post-sale tax bills from comps" don't exist in our data — a comp record carries
// the sale price / cap / PSF, not the buyer's subsequent tax bill — so fabricating one
// would violate the no-fabrication rule. The honest, database-grounded equivalent is the
// EFFECTIVE TAX RATE (annual ad-valorem taxes ÷ market value): a property's tax burden
// expressed as a rate, which IS comparable across deals. We benchmark the subject's rate
// against peer deals in the same state, giving an independent second read on whether the
// forecast's assessed/stepped-up figure is reasonable. ("Use the database to get smarter.")
import type { Deal } from "./idb";
import { getTaxJurisdiction } from "./taxReassessment";

export interface RateBenchmark {
  n: number;            // peer deals used
  medianPct: number;
  p25Pct: number;
  p75Pct: number;
  state: string;
}

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Effective ad-valorem tax rate on MARKET value, as a %. Nets out non-ad-valorem
// charges; derives market from the assessor's market value, or assessed ÷ ratio.
export function effectiveTaxRatePct(deal: Pick<Deal, "state" | "currentAnnualTaxes" | "currentMarketValue" | "currentAssessedValue" | "nonAdValoremAnnual">): number | null {
  const taxes = numOrNull(deal.currentAnnualTaxes);
  if (taxes == null) return null;
  const nav = numOrNull(deal.nonAdValoremAnnual);
  const adVal = nav != null && nav < taxes ? taxes - nav : taxes;
  const ratio = getTaxJurisdiction(deal.state)?.assessmentRatioCommercialPct ?? null;
  const assessed = numOrNull(deal.currentAssessedValue);
  const market = numOrNull(deal.currentMarketValue)
    ?? (assessed != null && ratio != null && ratio > 0 ? assessed / (ratio / 100) : null);
  if (market == null || market <= 0) return null;
  const rate = (adVal / market) * 100;
  // Sanity band — exclude obvious capture errors (a 0.1% or 8% effective rate is junk).
  return rate >= 0.2 && rate <= 6 ? rate : null;
}

const quantile = (sorted: number[], q: number): number => {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
};

// Median/p25/p75 effective rate across peer deals in the same state (subject excluded).
export function benchmarkEffectiveTaxRate(deals: Deal[], state: string | null | undefined, excludeId?: string): RateBenchmark | null {
  const st = (state || "").trim().toUpperCase();
  if (!st) return null;
  const rates = deals
    .filter((d) => d.id !== excludeId && (d.state || "").trim().toUpperCase() === st && !d.trashedAt)
    .map((d) => effectiveTaxRatePct(d))
    .filter((r): r is number => r != null)
    .sort((a, b) => a - b);
  if (rates.length < 3) return null; // not enough peers to be meaningful
  return {
    n: rates.length,
    medianPct: Math.round(quantile(rates, 0.5) * 1000) / 1000,
    p25Pct: Math.round(quantile(rates, 0.25) * 1000) / 1000,
    p75Pct: Math.round(quantile(rates, 0.75) * 1000) / 1000,
    state: st,
  };
}

export interface RateCrossCheck {
  benchmark: RateBenchmark;
  subjectRatePct: number;
  verdict: "in_line" | "below" | "above";
  message: string;
}

// Compare the SUBJECT's effective rate to the peer benchmark and phrase the read.
export function crossCheckTaxRate(
  subject: { ratePct: number | null },
  benchmark: RateBenchmark | null,
): RateCrossCheck | null {
  if (!benchmark || subject.ratePct == null) return null;
  const s = subject.ratePct;
  const { medianPct, p25Pct, p75Pct, n, state } = benchmark;
  const band = `${p25Pct.toFixed(2)}–${p75Pct.toFixed(2)}%`;
  const peers = `${n} comparable ${state} ${n === 1 ? "property" : "properties"} in your database (median ${medianPct.toFixed(2)}%)`;
  if (s < p25Pct * 0.85) {
    return { benchmark, subjectRatePct: s, verdict: "below",
      message: `This center's effective tax rate (~${s.toFixed(2)}% of value) sits BELOW ${peers}, range ${band}. It may be under-assessed today — so a reassessment/step-up could be LARGER than modeled. Worth confirming the assessor's value isn't stale.` };
  }
  if (s > p75Pct * 1.15) {
    return { benchmark, subjectRatePct: s, verdict: "above",
      message: `This center's effective tax rate (~${s.toFixed(2)}% of value) is ABOVE ${peers}, range ${band}. It's already taxed heavily for the state — a further step-up may be limited, or there's an appeal opportunity.` };
  }
  return { benchmark, subjectRatePct: s, verdict: "in_line",
    message: `This center's effective tax rate (~${s.toFixed(2)}% of value) is in line with ${peers}, range ${band} — the forecast's tax basis looks reasonable against your portfolio.` };
}
