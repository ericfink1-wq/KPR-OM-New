import { describe, it, expect } from "vitest";
import { findFocusDeals, buildFocusContext } from "../analystRetrieval";
import type { Deal, Tenant } from "../idb";

const mkDeal = (id: string, name: string, over: Partial<Deal> = {}, tenants: Tenant[] = []): Deal =>
  ({ id, propertyName: name, tenants, ...over } as unknown as Deal);

const library: Deal[] = [
  mkDeal("d1", "Trussville Promenade", { city: "Birmingham", state: "AL", status: "Prospect" },
    [{ name: "Regal Cinemas", sf: 63260 }, { name: "Walmart", sf: 203742 }]),
  mkDeal("d2", "Haymarket Village Center", { city: "Haymarket", state: "VA", status: "Owned" },
    [{ name: "Giant Food", sf: 55000 }]),
  mkDeal("d3", "Maple Plaza", { city: "Trenton", state: "NJ", status: "Passed", aka: ["Maple Crossing"] },
    [{ name: "Dollar Tree", sf: 10000 }]),
  mkDeal("d4", "Sunset Commons", { city: "Phoenix", state: "AZ", status: "Owned" },
    [{ name: "Dollar Tree", sf: 9500 }]),
];

describe("findFocusDeals", () => {
  it("matches by property name (distinctive tokens, filler ignored)", () => {
    const m = findFocusDeals("how is trussville doing on rollover?", library);
    expect(m.map(x => x.deal.id)).toEqual(["d1"]);
    expect(m[0].via).toBe("name");
  });

  it("matches by alias (aka)", () => {
    const m = findFocusDeals("what did we think of Maple Crossing?", library);
    expect(m.map(x => x.deal.id)).toContain("d3");
  });

  it("matches by city", () => {
    const m = findFocusDeals("show me our Birmingham exposure", library);
    expect(m.map(x => x.deal.id)).toEqual(["d1"]);
    expect(m[0].via).toBe("city");
  });

  it("matches by tenant brand, owned deals first", () => {
    const m = findFocusDeals("compare Dollar Tree rents", library);
    expect(m.map(x => x.deal.id)).toEqual(["d4", "d3"]); // Owned (d4) before Passed (d3)
    expect(m.every(x => x.via === "tenant")).toBe(true);
  });

  it("returns nothing for a cross-portfolio question naming no deal", () => {
    expect(findFocusDeals("which deals have the highest cap rate?", library)).toEqual([]);
    expect(findFocusDeals("hi", library)).toEqual([]);
  });

  it("skips trashed deals and respects the cap", () => {
    const trashed = mkDeal("d9", "Trussville Annex", { city: "Birmingham", trashedAt: "2026-01-01" } as Partial<Deal>);
    expect(findFocusDeals("trussville", [...library, trashed]).map(x => x.deal.id)).toEqual(["d1"]);
    const many = Array.from({ length: 20 }, (_, i) => mkDeal(`m${i}`, `Center ${i}`, { city: "Springfield" }));
    expect(findFocusDeals("all our springfield deals", many).length).toBeLessThanOrEqual(8);
  });
});

describe("buildFocusContext", () => {
  it("returns '' when nothing matches", () => {
    expect(buildFocusContext("what is the portfolio WALT?", library)).toBe("");
  });

  it("emits complete deal data (full roster + heavy fields), minus plumbing", () => {
    const rich = mkDeal("d5", "Riverdale Station", {
      city: "Riverdale", status: "Owned",
      cashFlowProjection: [{ label: "Yr1", noi: 1000000 }],
      notes: "long narrative",
      fileName: "should-not-appear.pdf",
      analysisStale: true,
    } as Partial<Deal>, [{ name: "Kroger", sf: 60000, rentPerSF: 9.5 }]);
    const block = buildFocusContext("tell me about riverdale station", [rich]);
    expect(block).toContain("FULL DETAIL FOR THIS QUESTION");
    expect(block).toContain("cashFlowProjection");
    expect(block).toContain("Kroger");
    expect(block).toContain("long narrative");
    expect(block).not.toContain("should-not-appear.pdf");
    expect(block).not.toContain("analysisStale");
  });

  it("bounds the block size and says so instead of silently dropping", () => {
    // Deals with ~30K chars of notes each — 8 match, but only ~3 fit the 90K budget.
    const big = Array.from({ length: 8 }, (_, i) =>
      mkDeal(`b${i}`, `Lakeside ${i} Center`, { city: "Lakeside", notes: "x".repeat(30_000) } as Partial<Deal>));
    const block = buildFocusContext("everything about our lakeside deals", big);
    expect(block.length).toBeLessThan(100_000);
    expect(block).toMatch(/omitted for size/);
  });
});
