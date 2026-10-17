import { describe, it, expect } from "vitest";
import { sanitizeLoanSizer } from "../userPrefs";

describe("loan-sizer prefs sanitizer", () => {
  it("keeps the starred base and the last-used inputs", () => {
    expect(sanitizeLoanSizer({ defaultBase: "swap-5", spreadBps: 200, premiumBps: 15, cushionBps: 25, dscr: 1.3, debtYieldPct: 9, ltvPct: 65, io: false, amortYears: 30 }))
      .toEqual({ defaultBase: "swap-5", spreadBps: 200, premiumBps: 15, cushionBps: 25, dscr: 1.3, debtYieldPct: 9, ltvPct: 65, io: false, amortYears: 30 });
  });
  it("allows clearing the default with null", () => {
    expect(sanitizeLoanSizer({ defaultBase: null })).toEqual({ defaultBase: null });
  });
  it("drops unknown keys, wrong types and out-of-range values", () => {
    expect(sanitizeLoanSizer({ userId: "someone-else", defaultBase: "<script>", spreadBps: "200", dscr: 99, ltvPct: -5, io: "yes", amortYears: NaN, extra: { a: 1 } })).toEqual({});
  });
  it("tolerates garbage bodies", () => {
    for (const b of [null, undefined, 5, "x", [1, 2]]) expect(sanitizeLoanSizer(b)).toEqual({});
  });
});
