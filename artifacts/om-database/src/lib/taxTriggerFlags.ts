// Live, token-free red flags for the forward-looking property-tax TRIGGERS beyond the
// ordinary sale reset (which deriveReassessmentFlag already covers): loss of exemption
// on a non-profit/government seller, agricultural/greenbelt rollback, abatement burn-off,
// and scheduled statutory changes. Derived from the same deterministic engine the Tax
// Reassessment card uses (assessTaxTriggers), so the flags and the card never diverge.
//
// Only HIGH/MEDIUM triggers become red flags; LOW ones (e.g. a value-add reno note, a
// favorable ratio phase-down) stay informational on the card to avoid noise.
import type { Deal } from "./idb";
import type { DerivedFlag } from "./expenseRisk";
import { assessTaxTriggers, reconcileTaxCapture } from "./taxReassessment";

export function deriveTaxTriggerFlags(deal: Deal): DerivedFlag[] {
  const price = Number(deal.txnPurchasePrice ?? deal.askingPrice ?? 0) || 0;
  const check = reconcileTaxCapture(deal);
  const holdYears = Number(deal.acqHoldPeriod) || (Array.isArray(deal.cashFlowProjection) ? deal.cashFlowProjection.length : 0) || 10;

  const triggers = assessTaxTriggers({
    state: deal.state,
    county: deal.marketGeo?.county ?? null,
    acquisitionPrice: price || null,
    currentAnnualTaxes: check.taxes ?? null,
    currentAssessedValue: check.assessed ?? null,
    nonAdValoremAnnual: check.nonAdValorem ?? null,
    sellerName: deal.txnSeller ?? deal.seller ?? null,
    sellerTaxExempt: deal.sellerTaxExempt ?? null,
    agOrGreenbeltAssessed: deal.agOrGreenbeltAssessed ?? null,
    taxAbatement: deal.taxAbatement ?? null,
    specialAssessments: deal.specialAssessments ?? null,
    renovationYear: deal.renovationYear ?? null,
    acqStrategy: deal.acqStrategy ?? null,
    notes: deal.notes ?? null,
    holdYears,
  });

  return triggers
    .filter((t) => t.severity === "high" || t.severity === "medium")
    .map((t) => ({ severity: t.severity as DerivedFlag["severity"], description: `${t.title}: ${t.message}` }));
}
