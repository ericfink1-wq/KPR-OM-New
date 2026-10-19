import { describe, it, expect } from "vitest";
import { isProposedTenant, nextRentStep, optionsState, buildMarketIndex, scrubRoster } from "../rosterScrub";
import type { Deal, Tenant } from "../idb";

const TODAY = new Date("2026-10-18T12:00:00Z");
const T = (x: Partial<Tenant>): Tenant => x as Tenant;

describe("proposed / unsigned tenants", () => {
  it("leaseStatus or the broker's marker in the name", () => {
    expect(isProposedTenant(T({ name: "Geico [Unsigned]" }))).toBe(true);
    expect(isProposedTenant(T({ name: "Chipotle", leaseType: "PROPOSED" }))).toBe(true);
    expect(isProposedTenant(T({ name: "Starbucks", leaseStatus: "loi" }))).toBe(true);
    expect(isProposedTenant(T({ name: "Prospect Bank" }))).toBe(false);
    expect(isProposedTenant(T({ name: "Kroger" }))).toBe(false);
  });
});

describe("next rent step, compactly", () => {
  it("first FUTURE step only, in $/SF, any common date format", () => {
    expect(nextRentStep(T({ rentSchedule: "2025-01-01 $25.00; 2027-01-01 $27.00; 2032-01-01 $29.70", sf: 2000 }), TODAY)).toEqual({ date: "2027-01-01", psf: 27, label: "→ $27.00 Jan-27" });
    expect(nextRentStep(T({ rentSchedule: "Feb-2028: $54,000/yr", sf: 2000 }), TODAY)?.label).toBe("→ $27.00 Feb-28");
    expect(nextRentStep(T({ rentSchedule: "flat" }), TODAY)).toBeNull();
    // King Soopers: the roll prints the CURRENT rate through expiry — that is flat, not a step.
    expect(nextRentStep(T({ rentSchedule: "2030-03-31 $10.96", rentPerSF: 10.96, sf: 60000 }), TODAY)?.label).toBe("Flat to Mar-30");
    expect(nextRentStep(T({ rentSchedule: "2028-03-01 $10.96; 2030-03-01 $12.06", rentPerSF: 10.96, sf: 60000 }), TODAY)?.label).toBe("→ $12.06 Mar-30");
  });
  it("options: 'none' only when the roll says so; blank is unknown", () => {
    expect(optionsState(T({ renewalOptions: "None" }))).toBe("none");
    expect(optionsState(T({ renewalOptions: "2 x 5 yrs" }))).toBe("some");
    expect(optionsState(T({}))).toBe("unknown");
  });
});

describe("roster scrub", () => {
  const lib: Deal[] = ["a", "b", "c"].map((id, i) => ({ id, state: "PA", tenants: [
    { name: "Starbucks", sf: 2000, rentPerSF: 50 + i, salesPSF: 900 }, { name: "Five Below", sf: 9000, rentPerSF: 18 },
  ] } as unknown as Deal));
  const subject = { id: "s", state: "PA", totalSF: 20000, tenants: [
    { name: "Starbucks", sf: 2000, rentPerSF: 38, annualRent: 76000, leaseExpiry: "2027-06-30", renewalOptions: "None", salesPSF: 700, occupancyCost: 9 },
    { name: "Five Below", sf: 9000, rentPerSF: 24, annualRent: 216000, leaseExpiry: "2033-01-31", renewalOptions: "3 x 5", reimbursementMethod: "Gross" },
    { name: "Geico [Unsigned]", sf: 1500, rentPerSF: 30, annualRent: 45000, leaseExpiry: "2031-12-31" },
    { name: "Vacant", sf: 7500 },
  ] } as unknown as Deal;
  const idx = buildMarketIndex([...lib, subject]);
  it("flags each row and benchmarks against the same brand elsewhere (never itself)", () => {
    const { rows } = scrubRoster(subject, idx, { today: TODAY });
    const sb = rows.find(r => r.tenant.name === "Starbucks")!, fb = rows.find(r => r.tenant.name === "Five Below")!;
    expect(sb.bench).toMatchObject({ rentMedian: 51, rentN: 3, basis: "brand", salesMedian: 900 });
    expect(sb.flags).toEqual(["below", "expiring", "noOptions"]);
    expect(sb.mtm).toBe(26000);
    expect(fb.flags).toEqual(["above", "gross"]);
    expect(rows.find(r => r.tenant.name?.startsWith("Geico"))!.flags).toContain("proposed");
  });
  it("proposed space is out of occupancy, rent and concentration by default — shown as pipeline", () => {
    const { summary: s } = scrubRoster(subject, idx, { today: TODAY });
    expect([s.leasedSF, s.leasedPct, s.inPlaceRent, s.tenantCount]).toEqual([11000, 55, 292000, 2]);
    expect(s.proposed).toEqual({ n: 1, sf: 1500, rent: 45000 });
    expect([s.belowN, s.belowAnnual, s.aboveN, s.aboveAnnual]).toEqual([1, 26000, 1, -54000]);   // reported separately, never netted
    expect(s.roll12Pct).toBe(26);   // Starbucks expires inside 12 months
    expect(s.noOptionsN).toBe(1);
    const inc = scrubRoster(subject, idx, { today: TODAY, includeProposed: true }).summary;
    expect([inc.leasedSF, inc.inPlaceRent]).toEqual([12500, 337000]);
  });
});

import { standardRentRollRows, standardSummaryRows, STANDARD_COLUMNS } from "../kprStandardExport";
describe("KPR Standard Rent Roll — fixed columns for every OM", () => {
  const lib: Deal[] = ["a", "b", "c"].map((id, i) => ({ id, state: "PA", tenants: [{ name: "Starbucks", sf: 2000, rentPerSF: 50 + i }] } as unknown as Deal));
  const subject = { id: "s", state: "PA", totalSF: 5000, propertyName: "Test Plaza", tenants: [
    { name: "Starbucks", suite: "A", sf: 2000, rentPerSF: 38, annualRent: 76000, leaseExpiry: "2027-06-30", rentSchedule: "2027-01-01 $40.00" },
    { name: "Geico [Unsigned]", suite: "B", sf: 1500, rentPerSF: 30, annualRent: 45000 },
    { name: "Vacant", suite: "C", sf: 1500 },
  ] } as unknown as Deal;
  it("every row has every column, in the fixed order, with status, share, benchmark and flags", () => {
    const sc = scrubRoster(subject, buildMarketIndex([...lib, subject]), { today: TODAY });
    const rows = standardRentRollRows(subject, sc, TODAY);
    expect(rows.every(r => r.length === STANDARD_COLUMNS.length)).toBe(true);
    const col = (name: typeof STANDARD_COLUMNS[number]) => STANDARD_COLUMNS.indexOf(name);
    expect(rows.map(r => r[col("Status")])).toEqual(["In place", "Proposed / unsigned", "Vacant"]);
    expect(rows[0][col("% of base rent")]).toBe(100);
    expect(rows[1][col("% of base rent")]).toBeNull();
    expect(rows[0][col("Market rent / SF")]).toBe(51);
    expect(rows[0][col("Next rent step")]).toBe("$40.00 Jan-27");
    expect(String(rows[0][col("Flags")])).toMatch(/Below mkt/);
    expect(standardSummaryRows(subject, sc.summary).find(r => r[0].startsWith("Proposed"))?.[1]).toBe("1 tenants · 1,500 SF · $45,000/yr");
  });
});

import { benchmarkBasisText } from "../rosterScrub";
describe("Mkt rent tooltip text (n= moved out of the cell)", () => {
  it("names the basis and the sample size in words", () => {
    expect(benchmarkBasisText({ rentMedian: 9.04, rentN: 5, basis: "brand", basisLabel: "same brand, 5 other centers", salesMedian: null, salesN: 0 })).toBe("Same-brand benchmark, 5 other centers · median $9.04/SF");
    expect(benchmarkBasisText({ rentMedian: 18.5, rentN: 36, basis: "category", basisLabel: "Grocery, 10–25K SF", salesMedian: 420, salesN: 3 })).toBe("Category benchmark (Grocery, 10–25K SF), 36 leases · median $18.50/SF · chain median sales $420/SF (3 reporting)");
    expect(benchmarkBasisText({ rentMedian: 22, rentN: 133, basis: "market", basisLabel: "PA <5K SF", salesMedian: null, salesN: 0 })).toBe("Market benchmark (PA <5K SF), 133 leases · median $22.00/SF");
    expect(benchmarkBasisText({ rentMedian: null, rentN: 0, basis: null, basisLabel: "no benchmark", salesMedian: null, salesN: 0 })).toBe("No market benchmark");
  });
});
