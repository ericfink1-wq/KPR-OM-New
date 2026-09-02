import { describe, it, expect } from "vitest";
import { buildSearchHits } from "../globalSearch";
import type { Deal } from "../idb";

const deal = (id: string, propertyName: string, city: string, state: string,
               tenants: Array<Record<string, unknown>>): Deal =>
  ({ id, propertyName, city, state, status: "Prospect", tenants } as unknown as Deal);

// Mirrors the real library: HomeGoods/Marshalls roll up to TJX via the curated
// PARENT_COMPANIES map; Food Lion rolls up to Ahold Delhaize.
const deals = [
  deal("d1", "Village at Sandhill Marketplace", "Columbia", "SC", [
    { name: "HomeGoods", sf: 22209, annualRent: 233195 }, { name: "Food Lion", sf: 38000, annualRent: 400000 },
  ]),
  deal("d2", "Brier Creek", "Raleigh", "NC", [
    { name: "Marshalls", sf: 25000, annualRent: 300000 }, { name: "HomeGoods", sf: 21000, annualRent: 250000 },
  ]),
  deal("d3", "TJX Distribution Center", "Charlotte", "NC", []),
];

const kinds = (q: string) => buildSearchHits(deals, q).map(h => h.kind);

describe("result ordering — Eric's spec: parent above tenants, below deals", () => {
  it("puts every DEAL first, then PARENT, then individual TENANT rows", () => {
    const k = kinds("homegoods");
    expect(k).toContain("parent");
    expect(k).toContain("tenant");
    const firstParent = k.indexOf("parent");
    const firstTenant = k.indexOf("tenant");
    const lastDeal = k.lastIndexOf("deal");
    if (lastDeal >= 0) expect(lastDeal).toBeLessThan(firstParent);
    expect(firstParent).toBeLessThan(firstTenant);
  });

  it("a deal whose NAME matches still outranks the parent company", () => {
    const hits = buildSearchHits(deals, "tjx");
    expect(hits[0].kind).toBe("deal");
    expect(hits[0].title).toBe("TJX Distribution Center");
    expect(hits[1].kind).toBe("parent");
    expect(hits[1].title).toBe("TJX Companies");
  });
});

describe("parent companies are findable at all", () => {
  it("finds a parent by its OWN name even though no tenant is called that", () => {
    const hits = buildSearchHits(deals, "ahold");
    const p = hits.find(h => h.kind === "parent");
    expect(p?.title).toBe("Ahold Delhaize");
    expect(hits.some(h => h.kind === "tenant")).toBe(false);  // no tenant literally named "ahold"
  });

  it("finds a parent through one of its BRANDS — the Lowes-Foods case", () => {
    const p = buildSearchHits(deals, "marshalls").find(h => h.kind === "parent");
    expect(p?.title).toBe("TJX Companies");
  });

  it("subtitle leads with the matched brand and counts distinct properties", () => {
    const p = buildSearchHits(deals, "homegoods").find(h => h.kind === "parent");
    expect(p!.sub).toContain("HomeGoods");
    expect(p!.sub).toContain("2 properties");   // d1 + d2, not 2 tenant rows
  });

  it("dedupes one parent across many deals into a SINGLE row", () => {
    expect(buildSearchHits(deals, "tjx").filter(h => h.kind === "parent")).toHaveLength(1);
  });

  it("carries the parent name for navigation", () => {
    const p = buildSearchHits(deals, "tjx").find(h => h.kind === "parent");
    expect(p).toMatchObject({ kind: "parent", parentName: "TJX Companies" });
  });
});

describe("guards", () => {
  it("returns nothing under the minimum query length", () => {
    expect(buildSearchHits(deals, "t")).toEqual([]);
    expect(buildSearchHits(deals, "  ")).toEqual([]);
  });
  it("skips trashed deals", () => {
    const trashed = [{ ...(deals[0] as object), trashedAt: "2026-01-01" } as unknown as Deal];
    expect(buildSearchHits(trashed, "homegoods")).toEqual([]);
  });
  it("ignores vacant and NAP rows", () => {
    const d = [deal("x", "Some Center", "Raleigh", "NC", [
      { name: "Vacant", sf: 5000 }, { name: "HomeGoods", sf: 20000, annualRent: 210000, isNAP: true },
    ])];
    expect(buildSearchHits(d, "homegoods")).toEqual([]);
    expect(buildSearchHits(d, "vacant")).toEqual([]);
  });
  it("a brand with no known parent produces a tenant row but no parent row", () => {
    const d = [deal("y", "Some Center", "King", "NC", [{ name: "Classic Jewelers", sf: 3914, annualRent: 68495 }])];
    const hits = buildSearchHits(d, "classic jewelers");
    expect(hits.some(h => h.kind === "tenant")).toBe(true);
    expect(hits.some(h => h.kind === "parent")).toBe(false);
  });
});
