import { describe, it, expect } from "vitest";
import { isNonGLA, isHoldover, reimbursementChips, passedOptionNotices, getRecency } from "../utils";
import { rosterTotals } from "../rosterTotals";
import { identicalSalesYears } from "../../components/TenantSalesPanel";
import type { Tenant, Deal } from "../idb";

const TODAY = new Date("2026-10-18T12:00:00Z");

describe("non-GLA rows are not vacancy (Overland's 90 SF utility closet)", () => {
  it("detects ATMs, utility space, licenses and sub-150 SF vacant slivers — not real shops", () => {
    expect(isNonGLA({ name: "Commerce Bank ATM", sf: 0 })).toBe(true);
    expect(isNonGLA({ name: "Vacant", sf: 90 })).toBe(true);
    expect(isNonGLA({ name: "Utility Room", sf: 90 })).toBe(true);
    expect(isNonGLA({ name: "T-Mobile", sf: 0, leaseType: "License" })).toBe(true);
    expect(isNonGLA({ name: "Vacant", sf: 1200 })).toBe(false);
    expect(isNonGLA({ name: "Great Clips", sf: 1200 })).toBe(false);
  });
  it("roster totals: the closet drops out of GLA and vacancy; the ATM's rent still counts", () => {
    const rows = [
      { name: "Schnucks", sf: 60000, annualRent: 600000 },
      { name: "Vacant", sf: 90 },
      { name: "Commerce Bank ATM", sf: 0, annualRent: 12000 },
      { name: "Vacant", sf: 2000 },
    ] as Tenant[];
    const t = rosterTotals(rows, undefined, TODAY.getTime());
    expect([t.vacantCount, t.totalSF, t.annualRent, t.tenantCount]).toEqual([1, 62000, 612000, 2]);
  });
});

describe("holdover, option notices, chips", () => {
  it("an expired lease still on the roll is a holdover", () => {
    expect(isHoldover({ name: "Commerce Bank ATM", leaseExpiry: "2026-07-31" }, TODAY)).toBe(true);
    expect(isHoldover({ name: "Schnucks", leaseExpiry: "2031-01-31" }, TODAY)).toBe(false);
    expect(isHoldover({ name: "Vacant", leaseExpiry: "2020-01-01" }, TODAY)).toBe(false);
  });
  it("passed notice dates from the abstract and from the roster text; exercised ones skipped", () => {
    const got = passedOptionNotices({ renewalOptions: "1 x 5 yrs; notice due 4/30/26" }, { options: [
      { number: "1", noticeDate: "2026-04-30", status: "available" }, { number: "2", noticeDate: "2025-01-31", status: "exercised" }, { number: "3", noticeDate: "2031-04-30" },
    ] }, TODAY);
    expect(got).toEqual([{ option: "1", noticeDate: "2026-04-30", source: "abstract" }]);
    expect(passedOptionNotices({ renewalOptions: "2 x 5 yr, notice 180 days prior; notice by 03/01/2026" }, null, TODAY)).toEqual([{ option: "Option", noticeDate: "2026-03-01", source: "roster" }]);
  });
  it("recovery chips only say what the text says", () => {
    expect(reimbursementChips("Tenant pays pro rata share of CAM; controllable CAM capped at 5% non-cumulative; 15% administrative fee; tenant audit right")).toEqual(["cap 5%", "admin 15%", "audit", "non-cumulative", "controllables", "pro rata"]);
    expect(reimbursementChips("NNN")).toEqual([]);
  });
  it("no AGING chip on owned or sold deals", () => {
    expect(getRecency({ status: "Owned", omDate: "2025-01-01" } as Deal)).toBeNull();
    expect(getRecency({ status: "Prospect", omDate: new Date(Date.now() - 7 * 30 * 86_400_000).toISOString() } as Deal)?.label).toBe("AGING");
  });
});

describe("tenant sales: identical year-over-year figures", () => {
  it("flags Schnucks 2024 = 2025 = $23.4M exactly; a real change is fine", () => {
    expect(identicalSalesYears({ 2025: { annualSales: 23_400_000 }, 2024: { annualSales: 23_400_000 }, 2023: { annualSales: 22_100_000 } })).toEqual([2025, 2024]);
    expect(identicalSalesYears({ 2025: { annualSales: 23_500_000 }, 2024: { annualSales: 23_400_000 } })).toBeNull();
  });
});
