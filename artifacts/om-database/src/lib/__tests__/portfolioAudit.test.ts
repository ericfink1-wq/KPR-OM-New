import { describe, it, expect } from "vitest";
import { runPortfolioAudit } from "../portfolioAudit";
import type { Deal } from "../idb";

const deal = (over: Partial<Deal>): Deal => ({ id: over.id || "d", propertyName: over.propertyName || "Deal", ...over } as Deal);

describe("runPortfolioAudit", () => {
  const deals: Deal[] = [
    deal({ id: "belden", propertyName: "Belden", state: "OH",
      currentAssessedValue: 12_242_500, currentAnnualTaxes: 287_986, // OH market-as-assessed swap
      tenants: [
        { name: "HomeSense", sf: 27889, annualRent: 446224, leaseExpiry: "2036-09-01", reimbursementMethod: "Taxes & Insurance: PRS; CAM: Fixed (Year 1 $2.15/SF, +3%/yr)" } as any,
        { name: "Fresh Thyme", sf: 29576, annualRent: 520538, leaseExpiry: "2027-09-01", reimbursementMethod: "Net; CAP on CAM: 5% p.a. on controllable" } as any,
        { name: "Urban Air", sf: 10120, annualRent: 190000, leaseExpiry: "2030-08-01", reimbursementMethod: "Gross" } as any,
        { name: "Vacant", sf: 5600 } as any,
      ] }),
    deal({ id: "clean", propertyName: "Clean Deal", state: "TX", currentAssessedValue: 10_000_000, currentAnnualTaxes: 250_000,
      tenants: [{ name: "Target", sf: 120000, annualRent: 1, leaseExpiry: "2040-01-01", reimbursementMethod: "NNN" } as any] }),
  ];
  const a = runPortfolioAudit(deals);

  it("counts fixed-CAM and gross separately, grouped by deal", () => {
    expect(a.fixedCamCount).toBe(1);   // HomeSense
    expect(a.grossCount).toBe(1);      // Urban Air
    const belden = a.reimbDeals.find((g) => g.dealName === "Belden")!;
    expect(belden.fixedCam.map((t) => t.tenant)).toEqual(["HomeSense"]);
    expect(belden.gross.map((t) => t.tenant)).toEqual(["Urban Air"]);
    // pro-rata + vacant excluded
    expect(belden.fixedCam.concat(belden.gross).some((t) => t.tenant === "Fresh Thyme" || t.tenant === "Vacant")).toBe(false);
  });

  it("flags the OH market-as-assessed swap as a high tax finding", () => {
    expect(a.tax.some((t) => t.dealName === "Belden" && t.severity === "high" && /MARKET value was captured/i.test(t.message))).toBe(true);
    expect(a.tax.some((t) => t.dealName === "Clean Deal")).toBe(false);
  });

  it("scans active deals", () => { expect(a.dealsScanned).toBe(2); });
});
