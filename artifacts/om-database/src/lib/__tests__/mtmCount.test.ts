import { describe, it, expect } from "vitest";
import { isBelowMarket, countsInUpside } from "../mtmCount";

describe("Mark-to-Market counting (Rockaway Target, 10/17/26)", () => {
  const target = { gapPct: 68, percentile: 67, locations: 3 };   // $5.09 vs $16.00, n=3
  it("a store above the 50th percentile is never below market", () => {
    expect(isBelowMarket(target, 15)).toBe(false);
    expect(isBelowMarket({ gapPct: 40, percentile: 50, locations: 12 }, 15)).toBe(false);
  });
  it("a thin sample is shown but its dollars aren't counted", () => {
    const thin = { gapPct: 40, percentile: 0, locations: 3 };
    expect(isBelowMarket(thin, 15)).toBe(true);
    expect(countsInUpside(thin)).toBe(false);
    expect(countsInUpside({ gapPct: 40, percentile: 10, locations: 5 })).toBe(true);
  });
  it("still respects the threshold", () => {
    expect(isBelowMarket({ gapPct: 10, percentile: 20, locations: 9 }, 15)).toBe(false);
  });
});
