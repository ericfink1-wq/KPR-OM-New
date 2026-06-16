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
