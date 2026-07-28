import { describe, it, expect } from "vitest";
import { estimateReassessment, getTaxJurisdiction, reconcileTaxCapture, TAX_JURISDICTIONS } from "../taxReassessment";

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

  it("SC: a mislabeled APPRAISED value entered as 'assessed' still shows the reset RISE, not a fake drop", () => {
    // Real case: $52M purchase, 6% commercial ratio, $755,782 taxes, and the OM's $23M
    // APPRAISED value entered in the assessed box. Dividing $23M by 6% implies a $383M
    // market > the $52M price — that's the mislabel signal. Treated as market, the reset
    // raises taxes to ~$1.71M (+126%), not the old bogus -86% drop.
    const r = estimateReassessment({ state: "SC", acquisitionPrice: 52_000_000, currentAssessedValue: 23_000_000, currentAnnualTaxes: 755_782 });
    expect(r.resetsOnSale).toBe(true);
    expect(r.estPostSaleTaxes!).toBeGreaterThan(1_600_000);
    expect(r.estPostSaleTaxes!).toBeLessThan(1_800_000);
    expect(r.estAnnualStepUp!).toBeGreaterThan(0);          // RISES, never a decrease
    expect(r.stepUpPct!).toBeGreaterThan(100);
    expect(r.detail.some((d) => /almost certainly the APPRAISED/i.test(d))).toBe(true);
    expect(r.confidence).toBe("low");
  });

  it("SC: a CORRECTLY-entered assessed value is left alone (no mislabel misfire)", () => {
    // assessed = price × 6% = $3.12M — the normal path, no market-value override.
    const r = estimateReassessment({ state: "SC", acquisitionPrice: 52_000_000, currentAssessedValue: 3_120_000, currentAnnualTaxes: 755_782 });
    expect(r.detail.some((d) => /almost certainly the APPRAISED/i.test(d))).toBe(false);
    expect(r.estPostSaleAssessed).toBe(3_120_000);          // 52M × 6%, ratio applied once
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

  it("uncodified-state estimate → graceful fallback, not a crash", () => {
    const r = estimateReassessment({ state: "ZZ", acquisitionPrice: 10_000_000, currentAssessedValue: 1, currentAnnualTaxes: 1 });
    expect(r.codified).toBe(false);
    expect(r.jurisdiction).toBeNull();
    expect(r.headline).toMatch(/isn't codified/i);
  });
});

describe("reconcileTaxCapture (fringe-case guards)", () => {
  it("prefers the deterministic parcel sum over the stated total", () => {
    const c = reconcileTaxCapture({
      state: "OH", currentAssessedValue: 999, currentAnnualTaxes: 999,
      taxParcels: [{ assessedValue: 1_000_000, annualTaxes: 30_000 }, { assessedValue: 500_000, annualTaxes: 15_000 }],
    });
    expect(c.parcelCount).toBe(2);
    expect(c.assessed).toBe(1_500_000);
    expect(c.taxes).toBe(45_000);
    expect(c.assessedSource).toBe("parcels");
  });

  it("flags a parcel sum that disagrees with the captured total (a dropped parcel)", () => {
    const c = reconcileTaxCapture({
      state: "OH", currentAnnualTaxes: 30_000,   // looks like only the Main parcel
      taxParcels: [{ annualTaxes: 30_000 }, { annualTaxes: 12_000 }],
    });
    // parcel sum 42k vs stated 30k → high warning
    expect(c.warnings.some((w) => w.severity === "high" && /parcel/i.test(w.message))).toBe(true);
  });

  it("flags capturing MARKET value where assessed/taxable was expected (OH 35%)", () => {
    const c = reconcileTaxCapture({ state: "OH", currentAssessedValue: 48_000_000, currentMarketValue: 48_500_000, currentAnnualTaxes: 1_300_000 });
    expect(c.impliedRatioPct).toBeGreaterThan(95);
    expect(c.warnings.some((w) => w.severity === "high" && /market value/i.test(w.message))).toBe(true);
  });

  it("does NOT false-alarm when assessed correctly reflects the state ratio", () => {
    const c = reconcileTaxCapture({ state: "OH", currentAssessedValue: 17_000_000, currentMarketValue: 48_500_000, currentAnnualTaxes: 1_300_000 });
    expect(c.warnings.some((w) => /market value/i.test(w.message))).toBe(false); // ~35% implied
  });

  it("flags a tax abatement as an acquisition risk", () => {
    const c = reconcileTaxCapture({ state: "TX", taxAbatement: { present: true, type: "PILOT", expiry: "2031" } });
    expect(c.warnings.some((w) => w.severity === "high" && /abatement|survives the sale/i.test(w.message))).toBe(true);
  });
});

describe("county overrides", () => {
  it("IL: Cook County overrides the 33⅓% state default to 25% + adds a note", () => {
    const base = estimateReassessment({ state: "IL", acquisitionPrice: 10_000_000, currentAssessedValue: 2_000_000, currentAnnualTaxes: 100_000 });
    const cook = estimateReassessment({ state: "IL", county: "Cook County", acquisitionPrice: 10_000_000, currentAssessedValue: 2_000_000, currentAnnualTaxes: 100_000 });
    expect(base.jurisdiction?.assessmentRatioCommercialPct).toBeCloseTo(33.33, 1);
    expect(cook.jurisdiction?.assessmentRatioCommercialPct).toBe(25);
    expect(cook.detail.some((d) => /Cook County/i.test(d))).toBe(true);
  });
  it("unknown county falls back to the state framework", () => {
    const r = estimateReassessment({ state: "IL", county: "DuPage County", acquisitionPrice: 10_000_000 });
    expect(r.jurisdiction?.assessmentRatioCommercialPct).toBeCloseTo(33.33, 1);
  });
});

describe("market-as-assessed swap caught without a market column (the 32 East/OH case)", () => {
  it("flags an OH 'assessed' value that is actually the market value", () => {
    // OM table: Assessed $4,284,880, Market $12,242,500, taxes $287,986. The market
    // value got captured as assessed → implied rate on 'assessed' is ~2.4% (too low for OH 35%).
    const c = reconcileTaxCapture({ state: "OH", currentAssessedValue: 12_242_500, currentAnnualTaxes: 287_986 });
    expect(c.warnings.some((w) => w.severity === "high" && /MARKET value was captured/i.test(w.message))).toBe(true);
  });
  it("does NOT flag the correctly-captured OH assessed value", () => {
    const c = reconcileTaxCapture({ state: "OH", currentAssessedValue: 4_284_880, currentAnnualTaxes: 287_986 });
    expect(c.warnings.some((w) => /MARKET value was captured/i.test(w.message))).toBe(false);
  });
  it("with the correct assessed value, the engine shows the big reassessment step-up", () => {
    const r = estimateReassessment({ state: "OH", acquisitionPrice: 35_000_000, currentAssessedValue: 4_284_880, currentAnnualTaxes: 287_986 });
    expect(r.resetsOnSale).toBe(false);          // OH doesn't reset on sale...
    expect(r.impliedCurrentMarket).toBeCloseTo(12_242_514, -3); // ~$12.24M implied market
    expect(r.estNextCycleStepUp).not.toBeNull();
    expect(r.estNextCycleStepUp!).toBeGreaterThan(400_000); // ...but the next cycle is a huge jump
  });
});
