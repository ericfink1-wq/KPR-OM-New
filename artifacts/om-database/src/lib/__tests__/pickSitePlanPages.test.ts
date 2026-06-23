import { describe, it, expect } from "vitest";
import { pickSitePlanPages } from "../pdfExtract";

// A real site plan: a graphic page titled "Site Plan" with a handful of suite-SF
// labels (few text items).
const sitePlan = (page: number) => ({
  page,
  text: "SITE PLAN Anchor 25,000 SF Shop A 1,200 SF Shop B 2,400 SF Pad 1 4,000 SF Roosevelt Rd",
  itemCount: 70,
});
// A rent roll: FULL of "<n> SF" tokens but a dense table (hundreds of text items).
const rentRoll = (page: number) => ({
  page,
  text: "RENT ROLL Tenant Suite SF Rent Jewel 55,024 SF Chase 4,860 SF ATI 5,635 SF Lease Expiration",
  itemCount: 480,
});
const leaseExpiration = (page: number) => ({
  page,
  text: "LEASE EXPIRATION REPORT 1,200 SF 2,400 SF 5,000 SF 8,000 SF 9,000 SF 10,000 SF cumulative",
  itemCount: 520,
});
const toc = (page: number) => ({ page, text: "TABLE OF CONTENTS Site Plan 8 Rent Roll 30 Tenancy 33", itemCount: 40 });

describe("pickSitePlanPages", () => {
  it("returns exactly the one real site-plan page", () => {
    expect(pickSitePlanPages([toc(2), rentRoll(30), sitePlan(8)])).toEqual([8]);
  });

  it("does NOT pull the rent roll / lease-expiration table alongside the plan", () => {
    // The old logic took the top 3 scoring pages and bundled these SF-heavy tables.
    expect(pickSitePlanPages([sitePlan(6), rentRoll(7), leaseExpiration(8)])).toEqual([6]);
  });

  it("ignores the table of contents even though it says 'Site Plan'", () => {
    expect(pickSitePlanPages([toc(2)])).toEqual([]);
  });

  it("captures a genuine adjacent two-page site-plan spread", () => {
    expect(pickSitePlanPages([sitePlan(10), sitePlan(11)])).toEqual([10, 11]);
  });

  it("does not treat two NON-adjacent plan-ish pages as a spread (returns one)", () => {
    expect(pickSitePlanPages([sitePlan(6), sitePlan(12)])).toEqual([6]);
  });

  it("returns nothing when no page looks like a plan", () => {
    expect(pickSitePlanPages([rentRoll(30), { page: 5, text: "MARKET OVERVIEW prose prose prose", itemCount: 300 }])).toEqual([]);
  });

  it("prefers the graphic plan over a narrative page that merely mentions the site plan", () => {
    const narrative = { page: 4, text: "the site plan on the following page shows the layout " .repeat(20), itemCount: 420 };
    expect(pickSitePlanPages([narrative, sitePlan(5)])).toEqual([5]);
  });
});
