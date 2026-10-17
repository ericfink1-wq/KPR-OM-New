import { describe, it, expect } from "vitest";
import { normalizeComp, isSaleComp, isPortfolioAllocation } from "../compNormalize";

// Every case below is a real row from the live comps table (Eric's 10/16/26 review).
describe("normalizeComp", () => {
  it("occupancy stored as a fraction → percent", () => {
    expect(normalizeComp({ occupancy: 1 }).row.occupancy).toBe(100);
    expect(normalizeComp({ occupancy: 0.97 }).row.occupancy).toBe(97);
    expect(normalizeComp({ occupancy: 95.2 }).row.occupancy).toBe(95.2);
  });
  it("price/SF is always price ÷ SF", () => {
    // Irmo: stated $912/SF, really ~$193
    const r = normalizeComp({ salePrice: 19_300_000, sf: 100_000, pricePerSf: 912 }).row;
    expect(r.pricePerSf).toBe(193);
    // within rounding → untouched
    expect(normalizeComp({ salePrice: 42_700_000, sf: 145_676, pricePerSf: 293 }).changes).toEqual([]);
    // no SF → stated PSF kept
    expect(normalizeComp({ salePrice: 7_500_000, sf: null, pricePerSf: 250 }).row.pricePerSf).toBe(250);
  });
  it("a number in City is cleared; a fake state is cleared or recovered", () => {
    expect(normalizeComp({ market: "376,462" }).row.market).toBeNull();
    expect(normalizeComp({ market: "Pinole, CA", state: "—" }).row.state).toBe("CA");
    expect(normalizeComp({ market: "Monterey", state: "XX" }).row.state).toBeNull();
    expect(normalizeComp({ market: "Boise, ID", state: null }).row.state).toBe("ID");
  });
  it("strategy words leave the Anchor column", () => {
    const r = normalizeComp({ anchor: "Burlington Value-Add" }).row;
    expect(r.anchor).toBe("Burlington");
    expect(r.sourceNotes).toContain("Value-Add");
    expect(normalizeComp({ anchor: "Opportunistic" }).row.anchor).toBeNull();
    expect(normalizeComp({ anchor: "CorePower Yoga" }).row.anchor).toBe("CorePower Yoga");
  });
  it("an anchor glued onto the Type is split out", () => {
    const r = normalizeComp({ propertyType: "Grocery Anchored Kings Food Markets", anchor: null }).row;
    expect(r.propertyType).toBe("Grocery Anchored");
    expect(r.anchor).toBe("Kings Food Markets");
    expect(normalizeComp({ propertyType: "Grocery-Anchored Lifestyle" }).changes).toEqual([]);
    expect(normalizeComp({ propertyType: "Power Center - Grocery Anchored" }).changes).toEqual([]);
  });
  it("typos", () => {
    expect(normalizeComp({ anchor: "Dick's Sporting Good sRoss" }).row.anchor).toBe("Dick's Sporting Goods, Ross");
    expect(normalizeComp({ market: "Potttstown, PA" }).row.market).toBe("Pottstown, PA");
    expect(normalizeComp({ market: "Longviw, TX" }).row.market).toBe("Longview, TX");
    expect(normalizeComp({ anchor: "ShopRIte" }).row.anchor).toBe("ShopRite");
  });
  it("leaves a clean row alone", () => {
    expect(normalizeComp({ name: "X", market: "Nashville, TN", state: "TN", salePrice: 88_000_000, sf: 324_000, pricePerSf: 272, capRate: 5.9, occupancy: 100, anchor: "Best Buy", propertyType: "Power Center" }).changes).toEqual([]);
  });
});

describe("classification", () => {
  it("no price and no date = competitive set", () => {
    expect(isSaleComp({ salePrice: null, saleDate: null })).toBe(false);
    expect(isSaleComp({ salePrice: 0, saleDate: null })).toBe(false);
    expect(isSaleComp({ salePrice: null, saleDate: "2025-01-01" })).toBe(true);
    expect(isSaleComp({ salePrice: 5_000_000, saleDate: null })).toBe(true);
  });
  it("portfolio allocations", () => {
    expect(isPortfolioAllocation({ name: "Academy Plaza", sourceNotes: "KPR acquisition, seller: Cedar Realty Trust · portfolio allocation" })).toBe(true);
    expect(isPortfolioAllocation({ name: "ShopRite Portfolio", sourceNotes: null })).toBe(true);
    expect(isPortfolioAllocation({ name: "Academy Plaza", sourceNotes: "KPR acquisition" })).toBe(false);
  });
});
