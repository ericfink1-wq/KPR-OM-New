import { describe, it, expect } from "vitest";
import { findComparableDeals, similarityScore, anchorBrands, isOwnedDeal } from "../comparables";

// Retrieval (#2): the library-grounding that lets the analysis reason from KPR's actual
// past deals. These lock the deterministic similarity so a comp is a real precedent.

const grocery = (over: Record<string, unknown> = {}) => ({
  propertyName: "Maple Grocery Center", centerType: "Grocery-Anchored Neighborhood Center",
  state: "NJ", city: "Edison", totalSF: 120000, capRate: 6.5,
  tenants: [{ name: "Kroger #423", sf: 48000, isAnchor: true }, { name: "Subway", sf: 1800 }],
  ...over,
});

describe("anchorBrands", () => {
  it("captures flagged anchors and big boxes, normalizing store numbers", () => {
    const a = anchorBrands(grocery());
    expect(a.has("kroger")).toBe(true);
    expect(a.has("subway")).toBe(false); // 1,800 SF inline, not flagged
  });
});

describe("similarityScore", () => {
  it("scores a same-type, same-anchor, same-state deal highly", () => {
    const target = grocery({ propertyName: "Target Center" });
    const cand = grocery({ propertyName: "Other Kroger Center", totalSF: 110000 });
    expect(similarityScore(target, cand)).toBeGreaterThan(60);
  });
  it("scores an unrelated deal low", () => {
    const target = grocery();
    const cand = { propertyName: "Power Plaza", centerType: "Power Center", state: "TX",
      totalSF: 500000, tenants: [{ name: "Best Buy", sf: 45000, isAnchor: true }] };
    expect(similarityScore(target, cand)).toBeLessThan(20);
  });
});

describe("findComparableDeals", () => {
  it("returns the most-similar deals, excludes the target itself, respects min score", () => {
    const target = grocery({ id: "t1", propertyName: "Subject Center" });
    const library = [
      { id: "t1", ...grocery({ propertyName: "Subject Center" }) }, // self — excluded
      grocery({ id: "c1", propertyName: "Sister Kroger", totalSF: 115000 }), // strong
      grocery({ id: "c2", propertyName: "Distant Kroger", state: "CA", city: "LA", totalSF: 95000 }), // good
      { id: "c3", propertyName: "Strip Mall", centerType: "Unanchored Strip", state: "FL",
        totalSF: 18000, tenants: [{ name: "Nail Salon", sf: 1400 }] }, // below min
    ];
    const comps = findComparableDeals(target, library, 3);
    expect(comps.map((c) => c.propertyName)).not.toContain("Subject Center");
    expect(comps.map((c) => c.propertyName)).not.toContain("Strip Mall");
    expect(comps[0].propertyName).toBe("Sister Kroger");
    expect(comps[0].sharedAnchors).toContain("kroger");
  });
  it("boosts an owned precedent over an equivalent OM-only comp", () => {
    const target = grocery({ id: "t1" });
    const owned = grocery({ id: "o1", propertyName: "Owned Kroger", isOwnTransaction: true, totalSF: 120000 });
    const omOnly = grocery({ id: "m1", propertyName: "Broker Kroger", totalSF: 120000 });
    const comps = findComparableDeals(target, [owned, omOnly], 2);
    expect(comps[0].propertyName).toBe("Owned Kroger");
    expect(comps[0].isOwned).toBe(true);
  });
});

describe("isOwnedDeal", () => {
  it("detects owned via flag, status, or realized txn fields", () => {
    expect(isOwnedDeal({ isOwnTransaction: true })).toBe(true);
    expect(isOwnedDeal({ status: "Owned" })).toBe(true);
    expect(isOwnedDeal({ acqNOIAtClose: 800000 })).toBe(true);
    expect(isOwnedDeal({ propertyName: "Just an OM" })).toBe(false);
  });
});
