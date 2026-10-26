import { describe, it, expect } from "vitest";
import { rateOn, historySeries, compareInterest, expectedForMonth, afterHedge, forwardView, rateMarkers, TERM_PROXY_NOTE, type RateTerms, type HedgeLeg, type GlRow, type IndexPoint } from "../rateDetail";
import type { AmRecord } from "../assetMgmt";

const rec = (id: string, data: Record<string, unknown> = {}): AmRecord => ({ id, kind: "swap", dealId: "d", data, sourceNote: null, updatedBy: null, updatedAt: "2026-10-01" });
const leg = (o: Partial<HedgeLeg>): HedgeLeg => ({ id: "w", label: "Swap", counterparty: "Wells", notional: null, fixedSwapRatePct: null, allInPct: null, effective: null, maturity: null, pending: false, record: rec("w"), ...o });
const terms = (o: Partial<RateTerms>): RateTerms => ({
  dealId: "d", property: "P", loanLabel: null, lender: "L", record: null, rateClass: "floating", index: "1M Term SOFR", daily: false,
  spreadBps: 200, floorPct: null, caps: [], fixedRatePct: null, balance: 10_000_000, closing: "2024-01-01", maturity: "2030-01-01",
  amortizing: false, extensionOptions: null, extensionNotice: null, swaps: [], pending: null, ...o,
});

describe("rate on a date — floors, caps, swaps", () => {
  it("floating = index + spread; the floor binds below it", () => {
    const t = terms({ floorPct: 3 });
    expect(rateOn(t, "2025-01-01", 4.3)).toMatchObject({ unhedged: 6.3, effective: 6.3, regime: "floating" });
    expect(rateOn(t, "2025-01-01", 1.0)).toMatchObject({ unhedged: 5, effective: 5 });
  });
  it("a live cap limits the index to the strike; after expiry it floats again", () => {
    const t = terms({ rateClass: "capped", caps: [{ strikePct: 4, notional: null, expiry: "2026-02-01", text: "" }] });
    expect(rateOn(t, "2025-06-01", 5.3)).toMatchObject({ unhedged: 7.3, effective: 6, regime: "cap" });
    expect(rateOn(t, "2026-03-01", 5.3)).toMatchObject({ effective: 7.3, regime: "floating" });
  });
  it("full swap = flat all-in while live; partial swap blends (Overland-style $16.35M of $18.66M)", () => {
    const full = terms({ rateClass: "swapped", swaps: [leg({ notional: 10_000_000, allInPct: 6.25, effective: "2024-01-01", maturity: "2028-01-01" })] });
    expect(rateOn(full, "2026-01-01", 4.0)).toMatchObject({ effective: 6.25, unhedged: 6, regime: "swap" });
    expect(rateOn(full, "2029-01-01", 4.0)).toMatchObject({ effective: 6, regime: "floating" });         // hedge over, loan still running
    const part = terms({ rateClass: "swapped", balance: 18_660_000, swaps: [leg({ notional: 16_350_000, allInPct: 6.0, effective: "2024-01-01", maturity: "2030-02-15" })] });
    const r = rateOn(part, "2026-01-01", 4.0);
    expect(r.regime).toBe("partial swap");
    expect(r.effective).toBeCloseTo((16_350_000 * 6 + 2_310_000 * 6) / 18_660_000, 4);
    expect(rateOn(part, "2026-01-01", 5.0).effective).toBeCloseTo((16_350_000 * 6 + 2_310_000 * 7) / 18_660_000, 4);
  });
  it("terms pending → build + unhedged index line, but NO effective rate", () => {
    const t = terms({ rateClass: "swapped", pending: "swap terms pending", swaps: [leg({ pending: true })] });
    expect(rateOn(t, "2026-01-01", 4.0)).toEqual({ unhedged: 6, effective: null, regime: null });
    const h = historySeries(t, [["2026-01-02", 4.0]], { to: "2026-10-26" });
    expect(h[0].effective).toBeNull();
    expect(h[0].unhedged).toBe(6);
  });
  it("outside the loan's life there is no rate at all", () => {
    expect(rateOn(terms({}), "2023-06-01", 4).effective).toBeNull();
  });
});

describe("history series — gaps stay gaps; Term SOFR proxy", () => {
  const sofr: IndexPoint[] = [["2026-09-01", 4.3], ["2026-09-02", null], ["2026-09-03", 4.31], ["2026-09-20", 4.2], ["2026-10-23", 3.92]];
  it("a missing print is null and a >5-day hole gets a break row (never interpolated)", () => {
    const h = historySeries(terms({ daily: true, index: "Daily Simple SOFR" }), sofr, { to: "2026-10-26" });
    expect(h.find(r => r.date === "2026-09-02")!.index).toBeNull();
    expect(h.some(r => r.date === "2026-09-04" && r.index == null)).toBe(true);
    expect(h.filter(r => r.index != null).map(r => r.index)).toEqual([4.3, 4.31, 4.2, 3.92]);
  });
  it("a Term SOFR loan takes today's 1M Term SOFR spot as the latest point, flagged; the proxy note says so", () => {
    const h = historySeries(terms({}), sofr, { to: "2026-10-26", termSpot: { rate: 3.95, asOf: "2026-10-26" } });
    expect(h[h.length - 1]).toMatchObject({ date: "2026-10-26", index: 3.95, termSpot: true });
    expect(TERM_PROXY_NOTE).toBe("Daily SOFR shown as proxy for 1M Term SOFR; typically within ~5-10 bp");
    const daily = historySeries(terms({ daily: true }), sofr, { to: "2026-10-26", termSpot: { rate: 3.95, asOf: "2026-10-26" } });
    expect(daily.some(r => r.termSpot)).toBe(false);
  });
  it("markers: closing, swap start/end, extension window + date", () => {
    const m = rateMarkers(terms({ extensionOptions: "1 x 12 mo", extensionNotice: { start: "2029-07-01", end: "2029-10-01" }, swaps: [leg({ effective: "2024-02-15", maturity: "2028-02-15" })] }));
    expect(m.map(x => x.kind)).toEqual(["closing", "swap-start", "swap-end", "ext-window", "extension"]);
  });
});

describe("after the hedge ends", () => {
  it("Overland: swap ends 2/15/30, loan 7/15/31 → 17 months unhedged", () => {
    const t = terms({ rateClass: "swapped", daily: true, maturity: "2031-07-15", swaps: [leg({ notional: 10_000_000, allInPct: 6, maturity: "2030-02-15" })] });
    expect(afterHedge(t, null, new Date("2026-10-26T12:00:00Z"))[0]).toMatch(/Swap ends 2\/15\/30, loan matures 7\/15\/31 — 17 months unhedged/);
  });
  it("Westwood: 6/15/30 vs 6/30/30 → 15 days", () => {
    const t = terms({ rateClass: "swapped", maturity: "2030-06-30", swaps: [leg({ notional: 10_000_000, allInPct: 6, maturity: "2030-06-15" })] });
    expect(afterHedge(t, null, new Date("2026-10-26T12:00:00Z"))[0]).toMatch(/15 days unhedged/);
  });
  it("forward view floats after the swap ends and reports annual interest", () => {
    const rates = { sofrOvernight: { rate: 3.92, date: "2026-10-23" }, sofr: { rows: [{ label: "Term SOFR 1 Month", value: 3.95, asOf: "2026-10-26" }] },
      termSwapCurve: { points: [{ tenor: 1, rate: 3.7 }, { tenor: 2, rate: 3.6 }, { tenor: 5, rate: 3.7 }, { tenor: 10, rate: 4.0 }], asOf: "2026-10-26" },
      swaps: { rows: [] }, treasuries: { rows: [] } } as never;
    const t = terms({ rateClass: "swapped", maturity: "2031-07-15", swaps: [leg({ notional: 10_000_000, allInPct: 6, effective: "2024-01-01", maturity: "2030-02-15" })] });
    const f = forwardView(t, rates, new Date("2026-10-26T12:00:00Z"))!;
    expect(f.months.find(m => m.date === "2029-01-01")!.effective).toBe(6);
    const after = f.months.find(m => m.date === "2030-06-01")!;
    expect(after.regime).toBe("floating");
    expect(after.effective).toBeCloseTo(after.index! + 2, 6);
    expect(f.years.find(y => y.year === 2028)!.interest).toBeCloseTo(10_000_000 * 0.06 * 366 / 360, -2);
    expect(f.years[0].partial).toBe(true);
  });
});

// Cooks Corner (Datex entity brunswic) — REAL 1st Mortgage Interest + Swap Credits postings
// (GeneralLedgerSummaries, Basis A, BalanceForward N, pulled 10/26/26). WT billed SOFR only from
// the Aug-25 accrual through Mar-26 (posted Sep-25 … Apr-26), then posted the catch-up in May-26.
// Loan terms here are a fixture sized to the full coupon Datex shows from Jun-26 on.
const GL: GlRow[] = ([
  ["202508", 94514.87, null], ["202509", 65758.44, -7455.92], ["202510", 62564.02, -6142.23], ["202511", 62445.77, -4143.25],
  ["202512", 58234.6, -1812.81], ["202601", 58494.64, -192.12], ["202602", 55878.43, 2424.09], ["202603", 50086.53, 2573.81],
  ["202604", 55397.36, 2905.16], ["202605", 366153.9, 2853.39], ["202606", 90615.55, 3182.02], ["202607", 87270.33, 3501.51],
  ["202608", 90575.83, 3221.75], ["202609", 91465.47, 2332.1],
] as Array<[string, number, number | null]>).map(([period, mi, sc]) => ({ entityId: "brunswic", period, mortgageInterest: mi, swapCredits: sc }));
const cooks = terms({ rateClass: "swapped", balance: 17_700_000, closing: "2025-07-01", maturity: "2030-07-01",
  swaps: [leg({ notional: 17_700_000, fixedSwapRatePct: 3.9042, allInPct: 6.1542, effective: "2025-07-01", maturity: "2030-07-01" })] });

describe("actual vs expected interest (Datex)", () => {
  const c = compareInterest([cooks], GL, [], { inDatex: true });
  it("expected = balance × all-in × actual/360 for the PRIOR month (posting lag)", () => {
    expect(expectedForMonth([cooks], "202605", []).amount).toBeCloseTo(17_700_000 * 0.061542 * 31 / 360, 0);
    expect(c.months.find(m => m.period === "202606")!.accrual).toBe("202605");
  });
  it("flags the eight underbilled months and the May-26 catch-up; nothing else", () => {
    expect(c.months.filter(m => m.flagged).map(m => m.period)).toEqual(["202509", "202510", "202511", "202512", "202601", "202602", "202603", "202604", "202605"]);
    expect(c.months.filter(m => m.flagged && m.gap! < 0)).toHaveLength(8);
    const may = c.months.find(m => m.period === "202605")!;
    expect(may.gap!).toBeGreaterThan(270_000);
    expect(may.actual).toBeCloseTo(369007.29, 2);                        // swap credits netted
  });
  it("says the cumulative gap nets to ~0", () => {
    expect(c.notes.join(" ")).toMatch(/Underbilled 8 months \(Sep-25 – Apr-26, .* short\), then a .* catch-up posted May-26\. The cumulative gap nets to ~\$0/);
    expect(Math.abs(c.months.find(m => m.period === "202605")!.cumulativeGap!)).toBeLessThan(2500);
  });
  it("no closing date → starts at the swap's effective date (earlier postings were the old loan)", () => {
    const old: GlRow[] = [{ entityId: "brunswic", period: "202503", mortgageInterest: 60003.91, swapCredits: null }, ...GL];
    const r = compareInterest([{ ...cooks, closing: null }], old, [], { inDatex: true });
    expect(r.months[0].period).toBe("202508");
    expect(r.notes.join(" ")).toMatch(/compared from the swap's effective date \(7\/1\/25\)/);
  });
  it("a property not in Datex says so; one in Datex but not loaded yet says that", () => {
    expect(compareInterest([cooks], null, [], { inDatex: false }).notes).toEqual(["No Datex ledger for this property."]);
    expect(compareInterest([cooks], null, [], { inDatex: true }).status).toBe("not-loaded");
  });
  it("a floating month with no index print is left blank, never guessed", () => {
    const fl = terms({ daily: true, balance: 10_000_000, closing: "2026-01-01" });
    const r = compareInterest([fl], [{ entityId: "x", period: "202603", mortgageInterest: 50_000, swapCredits: null }], [], { inDatex: true });
    expect(r.months[0]).toMatchObject({ expected: null, expectedWhy: "index history missing for this month", flagged: false });
    expect(r.notes.join(" ")).toMatch(/Daily SOFR/);
  });
});
