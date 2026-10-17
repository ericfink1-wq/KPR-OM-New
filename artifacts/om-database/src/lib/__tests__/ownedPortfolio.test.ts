import { describe, it, expect } from "vitest";
import { getOwnedProperties, isOwned } from "../ownedPortfolio";
import type { Deal } from "../idb";

const d = (o: Partial<Deal>) => ({ id: Math.random().toString(36), propertyName: "X", status: "Owned", uploadedAt: "2026-01-01", ...o }) as Deal;

describe("getOwnedProperties — the one owned definition", () => {
  it("Owned only — Sold, Under Contract and deleted deals never count", () => {
    const deals = [d({ propertyName: "A" }), d({ propertyName: "B", status: "Sold" }), d({ propertyName: "C", status: "Under Contract" }), d({ propertyName: "D", trashedAt: "2026-02-01" } as Partial<Deal>)];
    expect(getOwnedProperties(deals).map(x => x.propertyName)).toEqual(["A"]);
    expect(isOwned({ status: "Owned", trashedAt: "x" })).toBe(false);
  });
  it("collapses the same property recorded twice (University Hills: Centennial vs Denver, both CO)", () => {
    const a = d({ propertyName: "University Hills", city: "Centennial", state: "CO", tenants: [{ name: "x" }] as Deal["tenants"] });
    const b = d({ propertyName: "University Hills Shopping Center".slice(0, 16), city: "Denver", state: "CO", tenants: [{ name: "x" }, { name: "y" }] as Deal["tenants"] });
    const owned = getOwnedProperties([a, b]);
    expect(owned).toHaveLength(1);
    expect(owned[0].city).toBe("Denver"); // keeps the more complete record
  });
  it("keeps two genuinely different same-name centers in different states", () => {
    expect(getOwnedProperties([d({ propertyName: "Central Plaza", state: "MO" }), d({ propertyName: "Central Plaza", state: "TX" })])).toHaveLength(2);
  });
});
