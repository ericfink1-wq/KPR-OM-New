import { describe, it, expect } from "vitest";
import { parseRecoveryTerms, calcTenantRecoveries, expensePoolsFromDeal, resolvePercentRent } from "../recoveryCalc";
import { estimateRecoveries, computeOccupancyCost, statedReimbursementFlag } from "../utils";

// Strings below are VERBATIM reimbursementMethod / leaseType values from the live
// library — the parser is tested on what OMs actually say, not tidied fixtures.
const k = (m: string, lt = "") => {
  const r = parseRecoveryTerms({ reimbursementMethod: m, leaseType: lt });
  const f = (t: typeof r.cam) => t.kind === "prorata" ? "PR" : t.kind === "none" ? "--" : t.kind === "fixedPsf" ? `$${t.psf}/sf` : t.kind === "fixedAnnual" ? `$${t.amount}/yr` : "??";
  return `${f(r.cam)} ${f(r.tax)} ${f(r.ins)}`;
};

describe("parseRecoveryTerms — reads what the roll actually says", () => {
  it("plain NNN / pro-rata variants → all three pro-rata", () => {
    for (const m of ["NNN", "Pro-Rata Share NNN; 5% CAM Cap", "Net; CAP on CAM 5% cumulative", "PRS (RET, INS, CAM); no MGT, no ADM, no CAP", "NNN — pro-rata CAM/tax/insurance (NMRK underwrites $5.05 PSF recoveries)"])
      expect(k(m, "NNN"), m).toBe("PR PR PR");
  });
  it("gross leases → nothing recovered, including 'no NNN recoveries' phrasing", () => {
    for (const [m, lt] of [["Gross", "Gross"], ["GROSS (No Reimbursements)", "Gross"], ["Gross — no NNN recoveries shown in NMRK underwriting", "Gross"], ["", "Gross (no recoveries billed per OM)"], ["CAM: Does Not Reimburse; INS: Does Not Reimburse; RET: Does Not Reimburse; MGMT FEE: Does Not Reimburse", "Gross"]])
      expect(k(m, lt), `${m} | ${lt}`).toBe("-- -- --");
  });
  it("'gross sales' in a percentage-rent description is not a gross lease, but 'recoveries excluded' is no recoveries", () => {
    expect(k("", "Percentage rent in lieu of base rent (8% of gross sales); recoveries excluded")).toBe("-- -- --");
    expect(k("8% of gross sales over breakpoint", "NNN")).toBe("PR PR PR");
  });
  it("fixed CAM with a stated amount is used as stated; the rest by its own words", () => {
    expect(k("Fixed CAM ($6.01psf with 3% annual increases); NNN RE Taxes", "NNN")).toBe("$6.01/sf PR ??"); // insurance not stated
    expect(k("Fixed CAM ($3.79psf with 3% annual increases); NNN RE Taxes; Insurance PRS", "NNN")).toBe("$3.79/sf PR PR");
    expect(k("Fixed CAM contribution of $2,121.80/yr, increasing 3% annually", "CAM contribution only")).toBe("$2121.8/yr -- --");
    expect(k("Pro-Rata Share of RET; Fixed CAM/INS ($41,500/yr with 3% annual increases)", "NNN")).toBe("$41500/yr PR --");
  });
  it("a fixed charge with NO amount is unknown — never back-filled as pro-rata by the lease-type column", () => {
    for (const m of ["ROSS Fixed CAM", "Fixed CAM", "Pro-Rata Share of RET; Fixed CAM/INS", "Fixed CAM + Insurance + RET"])
      expect(k(m, "NNN").startsWith("??"), m).toBe(true);
  });
  it("names only the buckets the text names", () => {
    expect(k("CFA Tax Only", "NNN")).toBe("-- PR --");
    expect(k("Marshalls(Net CAM & Tax)", "NNN")).toBe("PR PR ??");
    expect(k("MCDs (Net CAM & Ins) - pays RE taxes directly to taxing authority; participant in CID", "NNN")).toBe("PR ?? PR");
    expect(k("Pays PRS of RET; self-maintains & insures", "NNN")).toBe("?? PR ??");
  });
  it("PRS TICAM = taxes, insurance and CAM", () => {
    expect(k("PRS TICAM + mgmt", "NNN")).toBe("PR PR PR");
    expect(k("PRS TICAM; reimburses taxes off 211,985 SF", "NNN")).toBe("PR ?? PR");
  });
  it("modified gross is only calculated when every bucket is stated", () => {
    expect(k("", "Modified Gross")).toBe("?? ?? ??");
    expect(k("Fixed CAM ($2.70psf); Fixed RE Tax ($2.39psf)", "Modified Gross")).toBe("$2.7/sf $2.39/sf ??");
    expect(k("CAM: NNN; RET: NNN; INS: Does Not Reimburse", "Modified Gross")).toBe("PR PR --");
  });
  it("blocks structures a GLA pro-rata can't price", () => {
    for (const m of ["NNN 3% Cap (Less Majors)", "NNN+MF 5% Cap; 15% Admin Fee; reimbursements after anchors", "Fixed CAM ($2.39psf with 2% annual increases); RE Tax Base Year ($618,651)", "Ross (proprietary recovery structure)"])
      expect(parseRecoveryTerms({ reimbursementMethod: m, leaseType: "NNN" }).blocker, m).not.toBeNull();
  });
  it("reads admin fee, mgmt-in-CAM and a stated share", () => {
    expect(parseRecoveryTerms({ reimbursementMethod: "PRS (RET, INS, CAM, MGT); 15% ADM cap", leaseType: "NNN" })).toMatchObject({ adminFeePct: 15, mgmtInCam: true });
    expect(parseRecoveryTerms({ reimbursementMethod: "NNN + 10%", leaseType: "NNN" }).adminFeePct).toBe(10);
    expect(parseRecoveryTerms({ reimbursementMethod: "Schnucks(NNN No MF+10% @ 30.06%)", leaseType: "NNN" })).toMatchObject({ adminFeePct: 10, mgmtInCam: false, proRataPct: 30.06 });
  });
});

// Northtowne Shopping Center's real OM expense budget (JLL, p.76/85).
const NORTHTOWNE = {
  totalSF: 388143,
  nnnRecoveries: 258591,
  expenseBreakdown: { CAM: 532783, Insurance: 78767, "Management Fee": 89510, "Real Estate Taxes": 322078, "Total Operating Expenses": 1112420, "Capital Reserves (below the line)": 77629 },
};

describe("calcTenantRecoveries — bucket by bucket, with the fully-NNN eyeball check", () => {
  const pools = expensePoolsFromDeal(NORTHTOWNE);
  it("picks the OM's buckets and ignores totals / below-the-line", () => {
    expect(pools).toEqual({ cam: 532783, tax: 322078, ins: 78767, mgmt: 89510, gla: 388143 });
  });
  it("plain NNN = pro-rata of all three; equals its own fully-NNN reference", () => {
    const c = calcTenantRecoveries({ reimbursementMethod: "", leaseType: "NNN", sf: 8000 }, pools); // Pet Supplies Plus
    expect(c.value).toBe(19243);
    expect(c.fullNnn).toBe(19243);
  });
  it("a tenant paying CAM + tax but not insurance lands BELOW fully-NNN by exactly its insurance share", () => {
    const c = calcTenantRecoveries({ reimbursementMethod: "CAM: NNN; RET: NNN; INS: Does Not Reimburse", leaseType: "Modified Gross", sf: 8000 }, pools);
    expect(c.value).toBe(Math.round(8000 / 388143 * (532783 + 322078)));
    expect(Math.abs(c.fullNnn! - c.value! - 8000 / 388143 * 78767)).toBeLessThanOrEqual(1);
  });
  it("gross = $0, unknown bucket = no number with the reason", () => {
    expect(calcTenantRecoveries({ leaseType: "Gross (no recoveries billed per OM)", sf: 47495 }, pools).value).toBe(0);
    const u = calcTenantRecoveries({ leaseType: "Modified Gross", sf: 4573 }, pools);
    expect(u.value).toBeNull();
    expect(u.why).toMatch(/modified gross/);
  });
  it("admin fee lands on CAM only", () => {
    const c = calcTenantRecoveries({ reimbursementMethod: "NNN + 15% Admin (not on INS)", leaseType: "NNN", sf: 8000 }, pools);
    const share = 8000 / 388143;
    expect(c.value).toBe(Math.round(share * 532783 * 1.15 + share * 322078 + share * 78767));
  });
});

describe("percentage rent", () => {
  it("formula when breakpoint + rate are known; withheld when a clause exists but can't be priced", () => {
    expect(resolvePercentRent({ percentageRentRate: 4, percentageRentBreakpoint: 3000000 }, 3916994)).toEqual({ amount: 36680, how: "formula" });
    expect(resolvePercentRent({ percentageRentRate: 8, leaseType: "Percentage rent in lieu of base rent (8% of gross sales)" }, 504132)).toEqual({ amount: 40331, how: "formula" });
    expect(resolvePercentRent({ percentageRentClause: "6% over natural breakpoint" }, 1000000)).toBeUndefined();
    expect(resolvePercentRent({}, 1000000)).toEqual({ amount: 0, how: "none" });
  });
});

describe("estimateRecoveries + occupancy cost — the Northtowne case", () => {
  const tenants = [
    { name: "Ollie's", sf: 47495, annualRent: 236525, leaseType: "Gross (no recoveries billed per OM)" },
    { name: "Burger King", sf: 3670, annualRent: 145002, leaseType: "Gross (no recoveries billed per OM)" },
    { name: "Arby's", sf: 4573, annualRent: 85012, leaseType: "Modified Gross" },
    { name: "Pet Supplies Plus", sf: 8000, annualRent: 114400, leaseType: "NNN" },
  ];
  it("gross tenants get an exact occupancy cost: base ÷ sales (Ollie's ties to the OM's own 7.0%)", () => {
    const est = estimateRecoveries({ ...NORTHTOWNE, tenants });
    const oc = computeOccupancyCost(tenants[0], est.byName.get("ollies"), 3384227);
    expect(oc?.occ).toBe(7.0);
    expect(oc?.breakdown.reimbMethod).toBe("gross");
  });
  it("modified gross with nothing stated gets NO number, and says why", () => {
    const est = estimateRecoveries({ ...NORTHTOWNE, tenants });
    expect(est.byName.has("arbys")).toBe(false);
    expect(est.unresolved.get("arbys")).toMatch(/modified gross/);
  });
  it("withholds calculated figures when they'd add up to more than the OM says the center collects", () => {
    const heavy = [...tenants, { name: "Hobby Lobby", sf: 51200, annualRent: 192000, leaseType: "NNN" }, { name: "Marshalls", sf: 22427, annualRent: 185023, leaseType: "NNN" }, { name: "Ross", sf: 25299, annualRent: 145469, leaseType: "NNN" }, { name: "Big Box", sf: 120000, annualRent: 400000, leaseType: "NNN" }];
    const est = estimateRecoveries({ ...NORTHTOWNE, tenants: heavy });
    expect(est.reconciliation?.verdict).toBe("high");
    expect(est.byName.has("pet supplies plus")).toBe(false);
    expect(est.byName.get("ollies")?.value).toBe(0); // gross $0 is a fact, not a calculation — kept
    expect(est.note).toMatch(/withheld/);
  });
  it("falls back to a share of the OM's total only for plain NNN when the OM gives no expense breakdown", () => {
    const est = estimateRecoveries({ totalSF: 100000, nnnRecoveries: 50000, tenants: [{ name: "A", sf: 10000, leaseType: "NNN", annualRent: 1 }, { name: "B", sf: 10000, leaseType: "Modified Gross", annualRent: 1 }] });
    expect(est.byName.get("a")).toMatchObject({ value: 50000, method: "centerSpread" });
    expect(est.byName.has("b")).toBe(false);
  });
});

describe("statedReimbursementFlag — the roster badge agrees with the occupancy-cost math", () => {
  it("every bucket excluded is GROSS even without the word 'gross' (Ollie's at Northtowne)", () => {
    expect(statedReimbursementFlag("CAM: excluded; Mgmt fee: excluded; RE taxes: excluded; Insurance: excluded", "")?.label).toBe("GROSS");
  });
  it("some buckets excluded is PARTIAL, not NNN", () => {
    const f = statedReimbursementFlag("CAM: excluded; Mgmt fee: excluded; RE taxes: pro rata share; Insurance: excluded", "NNN");
    expect(f?.label).toBe("PARTIAL");
    expect(f?.tip).toMatch(/reimburses RE tax/);
  });
  it("plain NNN / fixed CAM keep their existing badges", () => {
    expect(statedReimbursementFlag("CAM: pro rata share; RE taxes: pro rata share; Insurance: pro rata share", "")?.label).toBe("NNN");
    expect(statedReimbursementFlag("Fixed CAM ($6.01psf with 3% annual increases); NNN RE Taxes; Insurance PRS", "NNN")?.label).toBe("FIXED CAM");
  });
});
