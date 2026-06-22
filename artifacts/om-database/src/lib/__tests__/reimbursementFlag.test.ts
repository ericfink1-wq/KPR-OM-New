import { describe, it, expect } from "vitest";
import { reimbursementFlag } from "../utils";

// Real reimbursement strings from Belden Park Crossings (and the general patterns),
// so "fixed CAM read as NNN" can't regress again.
describe("reimbursementFlag — FIXED CAM vs NNN", () => {
  const fixedCam = [
    "Taxes & Insurance: PRS; CAM: Fixed (Year 1 CAM charges are $2.15 per square foot, increase 3% each calendar year)",   // HomeSense / Sierra
    "Taxes: PRS Fixed; CAM: Fixed (initially $2,500/yr, currently $2,750/yr, increasing 10% every 5 calendar years); Insurance: Fixed", // Raising Cane's
    "CAM Fixed at $2.00/SF",
    "Net; CAM is fixed",
    "Fixed CAM (net)",
    "Fixed-CAM",
  ];
  const nnn = [
    "Net; CAP on CAM: 5% p.a. on controllable",        // Fresh Thyme / Cost Plus / Barnes & Noble
    "Net; CAP on CAM: 3.5% p.a. on controllable",       // Old Navy
    "CAM & Taxes: PRS; Insurance: Fixed",               // PetSmart — CAM is pro-rata; only insurance fixed
    "NNN",
    "Net",
    "NNN; Insurance: Fixed (currently $0.73 PSF)",      // Ulta — fixed INSURANCE, not CAM
    "NNN; admin fee 10% of CAM; mgmt fee in CAM",
  ];

  it.each(fixedCam)("classifies as FIXED CAM: %s", (s) => {
    expect(reimbursementFlag(s)?.label).toBe("FIXED CAM");
  });
  it.each(nnn)("classifies as NNN (not fixed): %s", (s) => {
    expect(reimbursementFlag(s)?.label).toBe("NNN");
  });
  it("still flags a genuine gross lease", () => {
    expect(reimbursementFlag("Modified gross — landlord pays all expenses")?.label).toBe("GROSS");
  });
});

describe("reimbursementFlag — modified gross / base-year stop is NOT NNN", () => {
  const modGross = [
    "Modified gross: real estate tax and insurance increases only above a base year (2016), each capped at 5% annually", // Watson's Pools
    "Modified gross — tenant pays increases over base year",
    "Base year stop; tenant pays expense increases above the 2016 base year",
    "Expense stop at base year; tenant pays excess over base",
  ];
  it.each(modGross)("classifies as MOD GROSS: %s", (s) => {
    expect(reimbursementFlag(s)?.label).toBe("MOD GROSS");
  });
  it("keeps a pro-rata lease with a base-year CAM cap as NNN", () => {
    // The base year here is only the controllable-CAM cap reference — tenant still
    // pays its full pro-rata share, so this stays NNN (not modified gross).
    expect(reimbursementFlag("NNN; tenant pays pro-rata share; controllable CAM capped 5% over base year 2016")?.label).toBe("NNN");
  });
});
