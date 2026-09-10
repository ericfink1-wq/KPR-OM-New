import { describe, it, expect } from "vitest";
import { RECENCY_HORIZON_YEARS, recencyWeight, weightedQuantile, weightedSpread } from "../mcpTools";

// Eric's rule (9/10/26): in retail, past about ten years a data point is fairly stale.
// "Fairly stale" is a fade, not a wall — so influence decays across the horizon rather
// than dropping off a cliff at an arbitrary birthday.

describe("recency weight", () => {
  it("gives a current capture full weight", () => {
    expect(recencyWeight(2026, 2026)).toBe(1);
  });
  it("halves at the horizon's midpoint", () => {
    expect(recencyWeight(2021, 2026)).toBeCloseTo(0.5, 5);
  });
  it("reaches zero at the horizon, without a cliff before it", () => {
    expect(recencyWeight(2026 - RECENCY_HORIZON_YEARS, 2026)).toBe(0);
    // The year before the horizon still counts for something — a fade, not a wall.
    expect(recencyWeight(2026 - RECENCY_HORIZON_YEARS + 1, 2026)).toBeGreaterThan(0);
  });
  it("never goes negative past the horizon", () => {
    expect(recencyWeight(1990, 2026)).toBe(0);
  });
  it("treats a future-dated capture as current rather than over-weighting it", () => {
    expect(recencyWeight(2030, 2026)).toBe(1);
  });
  it("still counts an unknown vintage, but weakly", () => {
    const w = recencyWeight(null, 2026);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(1);
  });
});

describe("weighted quantile", () => {
  it("matches the plain median when every weight is equal", () => {
    const entries = [10, 20, 30, 40, 50].map(v => ({ value: v, weight: 1 }));
    expect(weightedQuantile(entries, 0.5)).toBe(30);
  });
  it("pulls the median toward the heavily weighted values", () => {
    // Four cheap old leases against one expensive recent one: unweighted the median is
    // cheap, but with the recent lease dominating it must move up.
    const entries = [
      { value: 10, weight: 0.05 }, { value: 11, weight: 0.05 },
      { value: 12, weight: 0.05 }, { value: 13, weight: 0.05 },
      { value: 30, weight: 1 },
    ];
    expect(weightedQuantile(entries, 0.5)).toBe(30);
  });
  it("ignores zero-weight (fully stale) entries", () => {
    const entries = [{ value: 999, weight: 0 }, { value: 20, weight: 1 }];
    expect(weightedQuantile(entries, 0.5)).toBe(20);
  });
  it("returns null when everything is stale", () => {
    expect(weightedQuantile([{ value: 5, weight: 0 }], 0.5)).toBeNull();
  });
  it("returns null on an empty set rather than a fabricated zero", () => {
    expect(weightedQuantile([], 0.5)).toBeNull();
  });
});

describe("weighted spread", () => {
  const now = 2026;
  it("reports both medians and the horizon counts", () => {
    const r = weightedSpread([
      { value: 14, year: 2016 },   // exactly at the horizon — zero weight
      { value: 20, year: 2024 },
      { value: 22, year: 2025 },
    ], now)!;
    expect(r.n).toBe(3);
    expect(r.nWithinHorizon).toBe(2);
    expect(r.nStale).toBe(1);
    expect(r.unweightedMedian).toBe(20);
    // The stale 2016 capture must not drag the weighted figure down.
    expect(r.median!).toBeGreaterThanOrEqual(20);
  });
  it("shows divergence when rents have moved", () => {
    // Old captures cheap, recent captures dear: the weighted median must sit ABOVE the
    // unweighted one, which is precisely the signal that rents have risen.
    const r = weightedSpread([
      { value: 10, year: 2017 }, { value: 11, year: 2018 }, { value: 12, year: 2019 },
      { value: 28, year: 2025 }, { value: 30, year: 2026 },
    ], now)!;
    expect(r.median!).toBeGreaterThan(r.unweightedMedian!);
  });
  it("keeps min and max unweighted so the true range is never hidden", () => {
    const r = weightedSpread([
      { value: 5, year: 2010 },    // stale, but it really happened
      { value: 25, year: 2025 },
    ], now)!;
    expect(r.min).toBe(5);
    expect(r.max).toBe(25);
  });
  it("returns null for an empty set", () => {
    expect(weightedSpread([], now)).toBeNull();
  });
});

// ── vacancy labelling ───────────────────────────────────────────────────────
// Measured on the real 301-deal corpus: 513 rows begin "Vacant" and a further 141 begin
// "Available", none of which carry rent. Matching only /^vacant/ counted those 141 as
// operating tenants and inflated every denominator built on the roster.
import { isVacantName } from "../mcpTools";

describe("vacancy name matching", () => {
  it("catches the labels the corpus actually uses", () => {
    for (const n of ["Vacant", "VACANT", "vacant suite 12", "Available", "AVAILABLE",
                     "available - 2,400 SF", "Vacancy", "White Box", "Dark Space"]) {
      expect(isVacantName(n), `${n} should read as vacant`).toBe(true);
    }
  });
  it("does not swallow real tenants whose names merely start similarly", () => {
    for (const n of ["Availity Health", "Vacanti Salon", "Availa Bank", "Darkhorse Tavern",
                     "Starbucks", "PetSmart", "Five Below"]) {
      expect(isVacantName(n), `${n} is a real tenant`).toBe(false);
    }
  });
  it("handles leading whitespace and empty values", () => {
    expect(isVacantName("   Vacant")).toBe(true);
    expect(isVacantName(null)).toBe(false);
    expect(isVacantName(undefined)).toBe(false);
    expect(isVacantName("")).toBe(false);
  });
});
