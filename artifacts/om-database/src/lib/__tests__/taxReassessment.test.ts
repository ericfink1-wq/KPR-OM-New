import { describe, it, expect } from "vitest";
import { estimateReassessment, getTaxJurisdiction, TAX_JURISDICTIONS } from "../taxReassessment";

describe("taxReassessment ruleset", () => {
  it("covers 51 jurisdictions (50 states + DC)", () => {
    expect(Object.keys(TAX_JURISDICTIONS).length).toBe(51);
    expect(getTaxJurisdiction("dc")?.stateName).toBe("District of Columbia");
  });
  it("classifies the acquisition-reset states correctly", () => {
    expect(getTaxJurisdiction("CA")?.saleTriggersReassessment).toBe("yes");
    expect(getTaxJurisdiction("CA")?.reassessmentBasis).toBe("acquisition_price");
    expect(getTaxJurisdiction("MI")?.reassessmentBasis).toBe("equalized_value");
    expect(getTaxJurisdiction("SC")?.saleTriggersReassessment).toBe("yes");
    expect(getTaxJurisdiction("OH")?.saleTriggersReassessment).toBe("no");
    expect(getTaxJurisdiction("TX")?.saleTriggersReassessment).toBe("no");
  });
});

describe("estimateReassessment", () => {
  it("CA (Prop 13): resets to purchase price → step-up using the property's real rate", () => {
    const r = estimateReassessment({ state: "CA", acquisitionPrice: 10_000_000, currentAssessedValue: 4_000_000, currentAnnualTaxes: 50_000 });
    expect(r.resetsOnSale).toBe(true);
    expect(r.effectiveRateOnAssessed).toBeCloseTo(0.0125, 6);
    expect(r.estPostSaleAssessed).toBe(10_000_000);   // ratio 100%
    expect(r.estPostSaleTaxes).toBe(125_000);         // 10M × 1.25%
    expect(r.estAnnualStepUp).toBe(75_000);
    expect(r.stepUpPct).toBe(150);
  });

  it("MI: uncaps to SEV (50% of price)", () => {
    const r = estimateReassessment({ state: "MI", acquisitionPrice: 10_000_000, currentAssessedValue: 2_000_000, currentAnnualTaxes: 30_000 });
    expect(r.resetsOnSale).toBe(true);
    expect(r.estPostSaleAssessed).toBe(5_000_000);    // 10M × 50%
    expect(r.estPostSaleTaxes).toBe(75_000);          // 5M × 1.5%
    expect(r.estAnnualStepUp).toBe(45_000);
  });

  it("SC: ATI exemption trims the post-sale value 25%", () => {
    const base = estimateReassessment({ state: "SC", acquisitionPrice: 10_000_000, currentAssessedValue: 300_000, currentAnnualTaxes: 30_000 });
    const exempt = estimateReassessment({ state: "SC", acquisitionPrice: 10_000_000, currentAssessedValue: 300_000, currentAnnualTaxes: 30_000, applyScAtiExemption: true });
    expect(base.estPostSaleAssessed).toBe(600_000);   // 10M × 6%
    expect(exempt.estPostSaleAssessed).toBe(450_000); // × 0.75
  });

  it("OH (no reset): no sale-time step-up, but flags the next-cycle move when buying above assessed", () => {
    const r = estimateReassessment({ state: "OH", acquisitionPrice: 10_000_000, currentAssessedValue: 2_000_000, currentAnnualTaxes: 80_000 });
    expect(r.resetsOnSale).toBe(false);
    expect(r.estAnnualStepUp).toBeNull();
    expect(r.impliedCurrentMarket).toBeCloseTo(5_714_285.7, 0); // 2M ÷ 35%
    expect(r.estNextCycleTaxes).toBe(140_000);         // (10M × 35%) × 4%
    expect(r.estNextCycleStepUp).toBe(60_000);
  });

  it("GA: buyer-favorable ceiling — never an upward step-up", () => {
    const r = estimateReassessment({ state: "GA", acquisitionPrice: 10_000_000, currentAssessedValue: 2_000_000, currentAnnualTaxes: 50_000 });
    expect(r.resetsOnSale).toBe(false);
    expect(r.estAnnualStepUp).toBeNull();
    expect(r.headline).toMatch(/caps next year/i);
  });

  it("uncodified state → graceful fallback, not a crash", () => {
    const r = estimateReassessment({ state: "ZZ", acquisitionPrice: 10_000_000, currentAssessedValue: 1, currentAnnualTaxes: 1 });
    expect(r.codified).toBe(false);
    expect(r.jurisdiction).toBeNull();
    expect(r.headline).toMatch(/isn't codified/i);
  });
});
