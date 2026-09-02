import { describe, it, expect } from "vitest";
import { buildSearchHits } from "../globalSearch";
import { tenantKey } from "../utils";
import type { Deal } from "../idb";

const deal = (id: string, propertyName: string, city: string, state: string,
               tenants: Array<Record<string, unknown>>): Deal =>
  ({ id, propertyName, city, state, status: "Prospect", tenants } as unknown as Deal);

// Mirrors the real library: Lowes Foods across many centers, plus TJX banners
// (HomeGoods/Marshalls roll up to TJX Companies via the curated parent map).
const deals = [
  deal("d1", "Winterville Commons", "Winterville", "NC", [
    { name: "Lowes Foods", sf: 50887, annualRent: 1043184 },
    { name: "HomeGoods", sf: 22209, annualRent: 233195 },
  ]),
  deal("d2", "Village at Sandhill Marketplace", "Columbia", "SC", [
    { name: "Lowes Foods", sf: 60807, annualRent: 726571 },
  ]),
  deal("d3", "Brier Creek", "Raleigh", "NC", [
    { name: "Lowes Foods", sf: 46522, annualRent: 709931 },
    { name: "Marshalls", sf: 25000, annualRent: 300000 },
  ]),
  deal("d4", "Lowes Foods Plaza", "Clemmons", "NC", []),   // a DEAL named for the brand
];

const kinds = (q: string) => buildSearchHits(deals, q).map(h => h.kind);

describe("result tiers — Eric's spec", () => {
  it("orders deal > tenant page > parent > per-property location", () => {
    const k = kinds("lowes foods");
    expect(k[0]).toBe("deal");                    // "Lowes Foods Plaza"
    expect(k[1]).toBe("tenantPage");              // the brand roll-up page
    expect(k.indexOf("tenantPage")).toBeLessThan(k.indexOf("location"));
    expect(k.filter(x => x === "location")).toHaveLength(3);
  });

  it("puts the brand page above the parent company", () => {
    const k = kinds("homegoods");
    expect(k.indexOf("tenantPage")).toBeLessThan(k.indexOf("parent"));
    expect(k.indexOf("parent")).toBeLessThan(k.indexOf("location"));
  });

  it("a brand with no known parent still gets its page above its locations", () => {
    const k = kinds("lowes foods");
    expect(k).not.toContain("parent");            // Lowes Foods has no curated holdco
    expect(k).toContain("tenantPage");
  });
});

describe("the tenant overview page is reachable", () => {
  it("emits ONE roll-up row for the brand, not one per property", () => {
    const pages = buildSearchHits(deals, "lowes foods").filter(h => h.kind === "tenantPage");
    expect(pages).toHaveLength(1);
    expect(pages[0].title).toBe("Lowes Foods");
  });

  it("counts distinct properties and states in the subtitle", () => {
    const p = buildSearchHits(deals, "lowes foods").find(h => h.kind === "tenantPage")!;
    expect(p.sub).toContain("3 properties");
    expect(p.sub).toContain("NC");
    expect(p.sub).toContain("SC");
  });

  it("navigates with a name that keys to the SAME group we counted", () => {
    // TenantView resolves its rows by tenantKey(tenantName); if the nav string keyed
    // differently the page would open on a different (or empty) set.
    const p = buildSearchHits(deals, "lowes foods").find(h => h.kind === "tenantPage")!;
    if (p.kind !== "tenantPage") throw new Error("wrong kind");
    const matched = deals.flatMap(d => (d.tenants || []).filter(t => tenantKey(t.name) === tenantKey(p.tenantName)));
    expect(matched).toHaveLength(3);
  });

  it("works for a partial query", () => {
    expect(buildSearchHits(deals, "lowes").some(h => h.kind === "tenantPage")).toBe(true);
    expect(buildSearchHits(deals, "marsh").find(h => h.kind === "tenantPage")?.title).toBe("Marshalls");
  });

  it("ranks a prefix match above a mere substring, then by breadth", () => {
    const d = [
      deal("a", "C1", "Raleigh", "NC", [{ name: "Ross Dress for Less", sf: 21985, annualRent: 251728 }]),
      deal("b", "C2", "Raleigh", "NC", [{ name: "Ross Dress for Less", sf: 20000, annualRent: 240000 }]),
      deal("c", "C3", "Raleigh", "NC", [{ name: "Fitness Cross", sf: 30000, annualRent: 300000 }]),
    ];
    const titles = buildSearchHits(d, "ross").filter(h => h.kind === "tenantPage").map(h => h.title);
    expect(titles[0]).toBe("Ross Dress for Less");
  });
});

describe("parent companies stay findable", () => {
  it("finds a holdco by its own name when no tenant is called that", () => {
    const p = buildSearchHits(deals, "tjx").find(h => h.kind === "parent");
    expect(p?.title).toBe("TJX Companies");
    expect(buildSearchHits(deals, "tjx").some(h => h.kind === "tenantPage")).toBe(false);
  });
  it("dedupes one holdco across many deals into a single row", () => {
    expect(buildSearchHits(deals, "tjx").filter(h => h.kind === "parent")).toHaveLength(1);
  });
});

describe("guards", () => {
  it("returns nothing under the minimum query length", () => {
    expect(buildSearchHits(deals, "l")).toEqual([]);
    expect(buildSearchHits(deals, "  ")).toEqual([]);
  });
  it("skips trashed deals", () => {
    const trashed = [{ ...(deals[0] as object), trashedAt: "2026-01-01" } as unknown as Deal];
    expect(buildSearchHits(trashed, "lowes foods")).toEqual([]);
  });
  it("ignores vacant and NAP rows", () => {
    const d = [deal("x", "Some Center", "Raleigh", "NC", [
      { name: "Vacant", sf: 5000 },
      { name: "Lowes Foods", sf: 20000, annualRent: 210000, isNAP: true },
    ])];
    expect(buildSearchHits(d, "lowes foods")).toEqual([]);
    expect(buildSearchHits(d, "vacant")).toEqual([]);
  });
});
