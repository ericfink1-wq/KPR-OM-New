// Live, token-free red flag for a property-tax REASSESSMENT, derived from the same
// deterministic estimator the Tax Reassessment card uses (lib/taxReassessment). When
// buying the center likely resets the assessment to the purchase price — or a
// scheduled cycle will step a recently-sold commercial parcel toward market — and the
// resulting tax bill jumps materially, that erodes NOI and belongs in the risk list.
//
// Per the deal-team policy: flag on the TAX-INCREASE %, never present an uncertain
// estimate as fact (low estimator confidence -> softer wording + capped severity), and
// never invent numbers — the flag only fires when the OM gave us the current assessed
// value and tax bill to size the step-up against.
import type { Deal } from "./idb";
import type { DerivedFlag } from "./expenseRisk";
import { estimateReassessment, reconcileTaxCapture } from "./taxReassessment";

const FLAG_PCT = 25;   // minimum tax-bill increase to flag
const HIGH_PCT = 50;   // a >= 50% jump is a high-severity hit

const fmt$ = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;

export function deriveReassessmentFlag(deal: Deal): DerivedFlag | null {
  const price = Number(deal.txnPurchasePrice ?? deal.askingPrice ?? 0) || 0;
  if (!deal.state || !price) return null;
  const check = reconcileTaxCapture(deal);
  const assessed = Number(check.assessed ?? 0) || 0;
  const taxes = Number(check.taxes ?? deal.expenseBreakdown?.realEstateTax ?? 0) || 0;

  const r = estimateReassessment({
    state: deal.state,
    county: deal.marketGeo?.county ?? null,
    acquisitionPrice: price,
    currentAssessedValue: assessed || null,
    currentAnnualTaxes: taxes || null,
    nonAdValoremAnnual: check.nonAdValorem ?? null,
  });

  // No current bill to size the step-up against — but if this jurisdiction resets on
  // sale, the risk is real and uncaptured, so nudge to go get the assessor record
  // rather than staying silent. (Where the jurisdiction never reassesses, no nudge.)
  if (!assessed || !taxes) {
    if (!r.resetsOnSale) return null;
    return {
      severity: "low",
      description: `Property-tax basis not captured — the OM didn't disclose the current assessed value / tax bill, and ${deal.state} reassesses on sale, so the post-close tax bill could step up materially. Pull the assessor record / OM tax page to size the reassessment risk.`,
    };
  }

  // Prefer the sale-time reset; otherwise the next scheduled cycle's step toward market.
  const saleReset = r.resetsOnSale && r.estPostSaleTaxes != null && r.stepUpPct != null;
  const pct = saleReset
    ? (r.stepUpPct as number)
    : (r.estNextCycleStepUp != null && taxes > 0 ? (r.estNextCycleStepUp / taxes) * 100 : null);
  if (pct == null || pct < FLAG_PCT) return null;

  const dollarStep = saleReset ? r.estAnnualStepUp : r.estNextCycleStepUp;
  const estTaxes = saleReset ? r.estPostSaleTaxes : r.estNextCycleTaxes;
  const lowConf = r.confidence === "low";
  const severity: DerivedFlag["severity"] = (pct >= HIGH_PCT && !lowConf) ? "high" : "medium";

  const trigger = saleReset
    ? "Purchasing this center likely triggers a property-tax reassessment"
    : "A scheduled reassessment will step this recently-sold commercial parcel toward market";
  const size = `RE taxes estimated to rise ~${Math.round(pct)}%`
    + (dollarStep != null ? ` (+${fmt$(dollarStep)}/yr` : "")
    + (estTaxes != null ? `${dollarStep != null ? ", " : " ("}to ~${fmt$(estTaxes)}/yr)` : (dollarStep != null ? ")" : ""));
  const close = lowConf
    ? " — a rough estimate for this jurisdiction; confirm the basis with the assessor/counsel."
    : " — underwrite the post-sale tax bill and verify with the assessor.";

  return { severity, description: `${trigger}: ${size}, eroding NOI${close}` };
}
