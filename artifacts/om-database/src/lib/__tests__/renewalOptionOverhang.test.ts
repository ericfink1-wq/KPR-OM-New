import { describe, it, expect } from "vitest";
import {
  parseRenewalOptions,
  assessOptionOverhang,
  buildBrandRentIndex,
  deriveOptionOverhangNote,
} from "../renewalOptionOverhang";
import type { Deal, Tenant } from "../idb";

describe("parseRenewalOptions", () => {
  it("returns null for empty/undisclosed", () => {
    expect(parseRenewalOptions(null)).toBeNull();
    expect(parseRenewalOptions("")).toBeNull();
    expect(parseRenewalOptions("   ")).toBeNull();
  });

  it("recognizes explicit none", () => {
    for (const s of ["None", "none", "N/A", "No remaining options", "No renewal options", "Options: none"]) {
      const p = parseRenewalOptions(s);
      expect(p, s).not.toBeNull();
      expect(p!.none, s).toBe(true);
    }
  });

  it("parses 'N x M-year' shorthand", () => {
    const p = parseRenewalOptions("4 x 5-year options at FMV")!;
    expect(p.optionCount).toBe(4);
    expect(p.termYears).toBe(5);
    expect(p.totalOptionYears).toBe(20);
    expect(p.basis).toBe("fmv");
  });

  it("parses word-number counts with stated fixed rents", () => {
    const p = parseRenewalOptions("Two (2) five-year options at $14.50 and $15.95")!;
    expect(p.optionCount).toBe(2);
    expect(p.termYears).toBe(5);
    expect(p.basis).toBe("fixed");
    expect(p.optionRentsPSF).toEqual([14.5, 15.95]);
    expect(p.firstOptionRentPSF).toBe(14.5);
  });

  it("parses digit counts and single rents", () => {
    const p = parseRenewalOptions("3 5-year renewal options at $10.50/SF")!;
    expect(p.optionCount).toBe(3);
    expect(p.termYears).toBe(5);
    expect(p.firstOptionRentPSF).toBe(10.5);
  });

  it("ignores dollar figures outside a plausible PSF band (annual rents)", () => {
    const p = parseRenewalOptions("One 5-year option; option rent $150,000 per annum")!;
    expect(p.optionRentsPSF).toEqual([]);
    expect(p.basis).toBe("unknown");
  });

  it("parses percentage bumps", () => {
    const p = parseRenewalOptions("2 remaining options with 10% increases")!;
    expect(p.optionCount).toBe(2);
    expect(p.bumpPct).toBe(10);
    expect(p.basis).toBe("pct-bump");
  });

  it("recognizes CPI and flat bases", () => {
    expect(parseRenewalOptions("Two 5-yr options at CPI")!.basis).toBe("cpi");
    expect(parseRenewalOptions("One 5-year option, flat")!.basis).toBe("flat");
  });
});

describe("assessOptionOverhang", () => {
  const tenant = (over: Partial<Tenant>): Tenant => ({ name: "Dollar Tree", rentPerSF: 9, sf: 10000, annualRent: 90000, ...over });

  it("null when the OM discloses nothing", () => {
    expect(assessOptionOverhang(tenant({ renewalOptions: null }), 14)).toBeNull();
  });

  it("none / fmv are not encumbered", () => {
    expect(assessOptionOverhang(tenant({ renewalOptions: "None" }), 14)!.status).toBe("none");
    expect(assessOptionOverhang(tenant({ renewalOptions: "3 x 5-yr at fair market value" }), 14)!.status).toBe("market");
  });

  it("fixed options far below market are encumbered", () => {
    const oh = assessOptionOverhang(tenant({ renewalOptions: "Two 5-year options at $9.50" }), 14)!;
    expect(oh.status).toBe("encumbered");
    expect(oh.optionRentPSF).toBe(9.5);
    expect(oh.gapPct).toBeGreaterThan(15);
  });

  it("flat options use the in-place rent as the option rate", () => {
    const oh = assessOptionOverhang(tenant({ renewalOptions: "One 5-year option, flat", rentPerSF: 9 }), 14)!;
    expect(oh.status).toBe("encumbered");
    expect(oh.optionRentPSF).toBe(9);
  });

  it("bump options project the in-place rent forward", () => {
    const oh = assessOptionOverhang(tenant({ renewalOptions: "2 options with 10% increases", rentPerSF: 10 }), 14)!;
    expect(oh.optionRentPSF).toBeCloseTo(11);
    expect(oh.status).toBe("encumbered");
  });

  it("fixed options above market are embedded growth, not overhang", () => {
    const oh = assessOptionOverhang(tenant({ renewalOptions: "One 5-year option at $16.00" }), 14)!;
    expect(oh.status).toBe("above-market");
  });

  it("options with no readable rate and no market median are unknown", () => {
    const oh = assessOptionOverhang(tenant({ renewalOptions: "Three 5-year options" }), 14)!;
    expect(oh.status).toBe("unknown");
  });
});

describe("buildBrandRentIndex + deriveOptionOverhangFlag", () => {
  const mkDeal = (id: string, tenants: Tenant[]): Deal => ({ id, propertyName: id, tenants } as unknown as Deal);
  const otherDeals = [
    mkDeal("d2", [{ name: "Dollar Tree", rentPerSF: 14, sf: 10000, annualRent: 140000 }]),
    mkDeal("d3", [{ name: "Dollar Tree", rentPerSF: 15, sf: 10000, annualRent: 150000 }]),
    mkDeal("d4", [{ name: "Dollar Tree", rentPerSF: 13, sf: 10000, annualRent: 130000 }]),
  ];

  it("notes a below-market lease locked by cheap fixed options as neutral income, not a risk", () => {
    const subject = mkDeal("d1", [
      { name: "Dollar Tree", rentPerSF: 9, sf: 10000, annualRent: 90000, renewalOptions: "Two 5-year options at $9.50" },
    ]);
    const idx = buildBrandRentIndex([subject, ...otherDeals]);
    const note = deriveOptionOverhangNote(subject, idx);
    expect(note).not.toBeNull();
    expect(note!.summary).toMatch(/Dollar Tree/);
    expect(note!.summary).toMatch(/9\.50/);
    // Framed as secure/sticky income, and no concern for a healthy tenant.
    expect(note!.summary).toMatch(/sticky|durable|secure/i);
    expect(note!.concern).toBeNull();
  });

  it("does not note FMV options or above-market leases", () => {
    const fmv = mkDeal("d1", [
      { name: "Dollar Tree", rentPerSF: 9, sf: 10000, annualRent: 90000, renewalOptions: "Two 5-year options at FMV" },
    ]);
    expect(deriveOptionOverhangNote(fmv, buildBrandRentIndex([fmv, ...otherDeals]))).toBeNull();

    const atMarket = mkDeal("d1", [
      { name: "Dollar Tree", rentPerSF: 14, sf: 10000, annualRent: 140000, renewalOptions: "Two 5-year options at $9.50" },
    ]);
    expect(deriveOptionOverhangNote(atMarket, buildBrandRentIndex([atMarket, ...otherDeals]))).toBeNull();
  });

  it("excludes the subject deal from its own benchmark and needs 2+ other locations", () => {
    const subject = mkDeal("d1", [
      { name: "Rare Tenant", rentPerSF: 9, sf: 10000, annualRent: 90000, renewalOptions: "Two 5-year options at $9.50" },
    ]);
    const oneOther = mkDeal("d2", [{ name: "Rare Tenant", rentPerSF: 15, sf: 10000, annualRent: 150000 }]);
    expect(deriveOptionOverhangNote(subject, buildBrandRentIndex([subject, oneOther]))).toBeNull();
  });

  it("raises a concern only when a locked tenant shows distress (high occupancy cost)", () => {
    const healthy = mkDeal("d1", [
      { name: "Dollar Tree", rentPerSF: 9, sf: 10000, annualRent: 90000, occupancyCost: 6, renewalOptions: "Two 5-year options at $9.50" },
    ]);
    expect(deriveOptionOverhangNote(healthy, buildBrandRentIndex([healthy, ...otherDeals]))!.concern).toBeNull();

    const distressed = mkDeal("d1", [
      { name: "Dollar Tree", rentPerSF: 9, sf: 10000, annualRent: 90000, occupancyCost: 18, renewalOptions: "Two 5-year options at $9.50" },
    ]);
    expect(deriveOptionOverhangNote(distressed, buildBrandRentIndex([distressed, ...otherDeals]))!.concern).toMatch(/occupancy cost|renewal risk/i);
  });

  it("raises an anchor growth-cap concern when a dominant anchor is locked below market", () => {
    const subject = mkDeal("d1", [
      { name: "Dollar Tree", rentPerSF: 9, sf: 40000, annualRent: 360000, isAnchor: true, renewalOptions: "Four 5-year options at $9.25" },
      { name: "Inline", rentPerSF: 20, sf: 5000, annualRent: 100000 },
    ]);
    const note = deriveOptionOverhangNote(subject, buildBrandRentIndex([subject, ...otherDeals]));
    expect(note!.concern).toMatch(/caps the center's income growth|growth/i);
  });
});
