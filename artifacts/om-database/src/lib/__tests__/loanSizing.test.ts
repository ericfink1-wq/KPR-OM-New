import { describe, it, expect } from "vitest";
import { sizeLoan, mortgageConstant, baseRateOptions } from "../loanSizing";

describe("loan sizing", () => {
  it("adds the spreads to the base and names the binding constraint", () => {
    const s = sizeLoan({ basePct: 4.708, spreadBps: 175, premiumBps: 15, cushionBps: 25, noi: 2_100_000, price: 32_000_000, dscr: 1.3, debtYieldPct: 9, ltvPct: 65, amortYears: 30 });
    expect(s.allIn).toBeCloseTo(6.858, 3);
    const dscrLoan = 2_100_000 / 1.3 / mortgageConstant(6.858, 30);
    expect(s.loans.find(l => l.by === "DSCR")!.amount).toBeCloseTo(dscrLoan, 0);
    expect(s.loans.find(l => l.by === "Debt yield")!.amount).toBeCloseTo(23_333_333, -1);
    expect(s.loans.find(l => l.by === "LTV")!.amount).toBe(20_800_000);
    expect(s.binding).toBe("DSCR");                       // ~$20.4M < $20.8M LTV < $23.3M DY
    expect(s.max).toBeCloseTo(dscrLoan, 0);
  });
  it("interest only uses the rate as the constant", () => {
    expect(mortgageConstant(6, null)).toBe(0.06);
    const io = sizeLoan({ basePct: 4, spreadBps: 200, premiumBps: 0, cushionBps: 0, noi: 1_000_000, price: null, dscr: 1.25, debtYieldPct: 0, ltvPct: 0, amortYears: null });
    expect(io.loans.map(l => l.by)).toEqual(["DSCR"]);
    expect(io.max).toBeCloseTo(1_000_000 / 1.25 / 0.06, 0);
  });
  it("offers each base rate, null where today's source has none", () => {
    const opts = baseRateOptions({
      treasuries: { rows: [{ label: "10-Yr", value: 4.1, asOf: "2026-10-16" }], asOf: "2026-10-16", source: "" },
      sofr: { rows: [{ label: "SOFR Term – 1 Month", value: 4.31, asOf: null }], asOf: null, source: "" },
      swaps: { rows: [], asOf: null, source: "", spreadBps: 0 },
      swapCurve: { kind: "dtcc-eod", asOf: "x", curveDate: "2026-10-16", source: "", enteredBy: null, trades: 1, tradesUsed: 1, points: [{ tenor: 10, rate: 4.715 }] },
      sofrOvernight: { rate: 3.89, date: "2026-10-15" }, fetchedAt: "",
    });
    const v = (id: string) => opts.find(o => o.id === id)!.value;
    expect([v("sofr-on"), v("term-1m"), v("swap-10"), v("swap-5"), v("ust-10"), v("ust-2")]).toEqual([3.89, 4.31, 4.715, null, 4.1, null]);
  });
});
