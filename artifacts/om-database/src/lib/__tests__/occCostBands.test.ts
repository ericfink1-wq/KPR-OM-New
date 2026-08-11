import { describe, it, expect } from "vitest";
import { gradeOccupancyCost, occCostBand, classifyTenant } from "../retailCategory";

describe("brand in the parenthetical DBA still classifies (legal entity outside)", () => {
  // The name is usually "Legal Entity, LLC (Brand)" — the brand lives in the parens,
  // so the classifier must read inside them or it dumps the tenant into "Other".
  it("Wakefern Food Corp. (ShopRite) → Grocery, and 4% reads elevated (not 'Healthy for Other')", () => {
    expect(classifyTenant("Wakefern Food Corp. (ShopRite)").category).toBe("Grocery & Necessity");
    const g = gradeOccupancyCost("Wakefern Food Corp. (ShopRite)", 4);
    expect(g?.category).toBe("Grocery & Necessity");
    expect(g?.tier).toBe("watch"); // grocery amber=5 → 4% is elevated, not healthy-Other-green
  });
  it("Doherty Bread, LLC (Panera Bread Bakery Café) → Restaurant & Food", () => {
    expect(classifyTenant("Doherty Bread, LLC (Panera Bread Bakery Café)").category).toBe("Restaurant & Food");
  });
  it("Filove Inc. (European Wax Center) → Personal Services", () => {
    expect(classifyTenant("Filove Inc. (European Wax Center)").category).toBe("Personal Services");
  });
  it("Bodymind LI LLC (Bodybar Pilates) → Fitness", () => {
    expect(classifyTenant("Bodymind LI LLC (Bodybar Pilates)").category).toBe("Fitness");
  });
  it("still classifies when the brand is OUTSIDE the parens", () => {
    expect(classifyTenant("Chipotle Mexican Grill of Colorado, LLC (Chipotle Mexican Grill)").category).toBe("Restaurant & Food");
    expect(classifyTenant("The TJ Maxx Companies, Inc. (T.J. Maxx or Marshalls)").category).toBe("Off-Price & Discount");
  });
});

describe("sector-relative occupancy-cost grading", () => {
  it("a grocer at 4% is ELEVATED (not green), and green at 2%", () => {
    const g4 = gradeOccupancyCost("ShopRite", 4);
    expect(g4?.category).toBe("Grocery & Necessity");
    expect(g4?.tier).toBe("watch");
    expect(g4?.color).toBe("#c97a18");
    expect(gradeOccupancyCost("ShopRite", 2)?.tier).toBe("healthy");
    expect(gradeOccupancyCost("ShopRite", 6)?.tier).toBe("stressed");
  });

  it("apparel tolerates much more — 12% is healthy, grocer's-red territory", () => {
    const a = gradeOccupancyCost("Old Navy", 12);
    expect(a?.category).toBe("Apparel & Soft Goods");
    expect(a?.tier).toBe("healthy");
    expect(gradeOccupancyCost("Old Navy", 19)?.tier).toBe("stressed");
  });

  it("off-price: Ocean State Job Lot at 8.4% is elevated, not green", () => {
    const o = gradeOccupancyCost("Ocean State Job Lot", 8.4);
    expect(o?.category).toBe("Off-Price & Discount");
    expect(o?.tier).toBe("watch");
  });

  it("same occ cost, different verdict by sector (the whole point)", () => {
    expect(gradeOccupancyCost("Hannaford", 4.5)?.tier).toBe("watch");     // grocery: elevated
    expect(gradeOccupancyCost("Foot Locker", 4.5)?.tier).toBe("healthy"); // apparel: fine
  });

  it("returns null for missing / non-positive / non-finite occ cost", () => {
    expect(gradeOccupancyCost("Hannaford", null)).toBeNull();
    expect(gradeOccupancyCost("Hannaford", 0)).toBeNull();
    expect(gradeOccupancyCost("Hannaford", NaN)).toBeNull();
  });

  it("unknown tenant falls back to the generic band", () => {
    const g = gradeOccupancyCost("Some Local Shop LLC", 12);
    expect(g?.category).toBe("Other");
    expect(g?.tier).toBe("watch"); // Other: green 10 / amber 15
  });

  it("occCostBand exposes the band + category for closure-risk scaling", () => {
    expect(occCostBand("Hannaford")).toEqual({ green: 3, amber: 5, category: "Grocery & Necessity" });
    expect(occCostBand("Planet Fitness").category).toBe("Fitness");
  });
});
