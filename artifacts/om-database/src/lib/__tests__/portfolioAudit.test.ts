import { describe, it, expect } from "vitest";
import { runPortfolioAudit } from "../portfolioAudit";
import type { Deal } from "../idb";

const deal = (over: Partial<Deal>): Deal => ({ id: over.id || "d", propertyName: over.propertyName || "Deal", ...over } as Deal);

describe("runPortfolioAudit", () => {
  const deals: Deal[] = [
    deal({ id: "belden", propertyName: "Belden", state: "OH",
      // OH market-as-assessed swap: $12.24M 'assessed' at 2.4% rate → flagged
      currentAssessedValue: 12_242_500, currentAnnualTaxes: 287_986,
      tenants: [
        { name: "HomeSense", sf: 27889, annualRent: 446224, leaseExpiry: "2036-09-01", reimbursementMethod: "Taxes & Insurance: PRS; CAM: Fixed (Year 1 $2.15/SF, +3%/yr)" } as any,
        { name: "Fresh Thyme", sf: 29576, annualRent: 520538, leaseExpiry: "2027-09-01", reimbursementMethod: "Net; CAP on CAM: 5% p.a. on controllable" } as any,
        { name: "Vacant", sf: 5600 } as any,
      ] }),
    deal({ id: "clean", propertyName: "Clean Deal", state: "TX", currentAssessedValue: 10_000_000, currentAnnualTaxes: 250_000,
      tenants: [{ name: "Target", sf: 120000, annualRent: 1, leaseExpiry: "2040-01-01", reimbursementMethod: "NNN" } as any] }),
  ];

  it("finds the fixed-CAM tenant but not the pro-rata or vacant ones", () => {
    const a = runPortfolioAudit(deals);
    const names = a.reimbursement.map((r) => r.tenant);
    expect(names).toContain("HomeSense");
    expect(names).not.toContain("Fresh Thyme");
    expect(names).not.toContain("Vacant");
    expect(a.reimbursement.find((r) => r.tenant === "HomeSense")!.label).toBe("FIXED CAM");
  });

  it("flags the OH market-as-assessed swap as a high tax finding", () => {
    const a = runPortfolioAudit(deals);
    expect(a.tax.some((t) => t.dealName === "Belden" && t.severity === "high" && /MARKET value was captured/i.test(t.message))).toBe(true);
    expect(a.tax.some((t) => t.dealName === "Clean Deal")).toBe(false);
  });

  it("scans active deals", () => {
    expect(runPortfolioAudit(deals).dealsScanned).toBe(2);
  });
});
