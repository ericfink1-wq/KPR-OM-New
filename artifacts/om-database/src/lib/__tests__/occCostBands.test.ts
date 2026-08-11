import { describe, it, expect } from "vitest";
import { gradeOccupancyCost, occCostBand } from "../retailCategory";

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
