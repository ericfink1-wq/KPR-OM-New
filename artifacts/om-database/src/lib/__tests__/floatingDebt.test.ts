import { describe, it, expect } from "vitest";
import { buildDebtRows, debtTotals, buildSwapRows, loanSpreadBps, loanFloorPct, loanRateCaps, type AmRecord } from "../assetMgmt";
import type { Deal } from "../idb";
import type { RatesPayload } from "../api";

const today = new Date("2026-10-19T12:00:00Z");
const rates = { treasuries: { rows: [], asOf: null, source: "" }, sofr: { rows: [{ label: "SOFR Term – 1 Month", value: 3.95, asOf: "2026-10-17" }], asOf: null, source: "" },
  swaps: { rows: [{ label: "SOFR Swap – 1 Year", value: 3.6 }, { label: "SOFR Swap – 5 Year", value: 3.5 }], asOf: "2026-10-17", source: "", spreadBps: 0 },
  sofrOvernight: { rate: 4.01, date: "2026-10-17" }, fetchedAt: "" } as unknown as RatesPayload;
const rec = (id: string, kind: AmRecord["kind"], dealId: string, data: Record<string, unknown>): AmRecord => ({ id, kind, dealId, data, sourceNote: null, updatedBy: null, updatedAt: "" });
const deals = [{ id: "c1", propertyName: "Cedar A" }, { id: "c2", propertyName: "Bloomfield" }, { id: "o", propertyName: "Overland Plaza" }, { id: "f", propertyName: "Fixed Ctr" }] as unknown as Deal[];

describe("floating loans priced off the curve", () => {
  it("reads spread, floor and caps from text", () => {
    const d = { index: "1M Term SOFR + 220 bps, 2.75% floor", covenants: "DY 7.5%. Rate caps: Cedar $335M @5.25% to 2/1/28; Cedar $68.5M @4.50% to 2/1/27" };
    expect(loanSpreadBps(d)).toBe(220);
    expect(loanFloorPct(d)).toBe(2.75);
    const caps = loanRateCaps(d);
    expect(caps.map(c => [c.strikePct, c.notional, c.expiry])).toEqual([[5.25, 335e6, "2028-02-01"], [4.5, 68.5e6, "2027-02-01"]]);
    expect(loanRateCaps({ notes: "CAM cap 5% on controllables; cap rate 7.25%" })).toEqual([]);
  });
  it("all-in = max(spot, floor) + spread; capped loans classed separately; tile splits", () => {
    const recs = [
      rec("l1", "loan", "c1", { lender: "HPS/Guardian", currentBalance: 30e6, index: "1M Term SOFR + 220 bps", floor: "2.75%", notes: "Rate cap $335M @5.25% to 2/1/28" }),
      rec("l2", "loan", "c2", { lender: "HPS/Guardian", currentBalance: 11.5e6, rateType: "floating", index: "1M CME Term SOFR", spreadBps: 220, indexFloorPct: 4.25 }),
      rec("l3", "loan", "f", { currentBalance: 10e6, fixedRatePct: 5 }),
    ];
    const rows = buildDebtRows(recs, deals, rates, today);
    const a = rows.find(r => r.dealId === "c1")!, b = rows.find(r => r.dealId === "c2")!;
    expect(a.allInPct).toBe(6.15); expect(a.estimated).toBe(true); expect(a.rateClass).toBe("capped"); expect(a.cappedMaxPct).toBe(7.45);
    expect(b.allInPct).toBe(6.45); expect(b.allInSource).toMatch(/floor/); expect(b.rateClass).toBe("floating");
    const t = debtTotals(rows, []);
    expect(t.rateCoveragePct).toBe(100);
    expect(t.byClass).toMatchObject({ fixedOrSwappedPct: 19, cappedPct: 58, floatingPct: 22, estimatedLoans: 2 });
  });
  it("an expired cap no longer counts", () => {
    const rows = buildDebtRows([rec("l", "loan", "c2", { currentBalance: 1, index: "Term SOFR + 220 bps", notes: "cap 4.50% to 2/1/26" })], deals, rates, today);
    expect(rows[0].rateClass).toBe("floating");
  });
  it("a stale termsPending flag never blocks pricing; Daily SOFR swaps price off OIS", () => {
    const w = buildSwapRows([rec("s", "swap", "o", { termsPending: true, notional: 10e6, fixedSwapRatePct: 3.2, allInFixedPct: 5.1, effectiveDate: "2024-01-01", maturityDate: "2029-01-01", index: "Daily Simple SOFR" })], new Map([["o", "Overland Plaza"]]), rates, today)[0];
    expect(w.termsPending).toBe(false);
    expect(w.curve).toBe("SOFR (annual/annual)");
    expect(w.mtm).not.toBeNull();
  });
});

import { noiVsBudget } from "../assetMgmt";
describe("NOI vs budget", () => {
  it("mid-year acquisition = partial-year budget, not coloured", () => {
    const r = noiVsBudget({ noiYtdActual: 610_000, noiYtdBudget: 94_000, period: "202609", basis: "C" }, "2026-08-15")!;
    expect(r.partial).toBe(true); expect(r.colour).toBeNull(); expect(r.variancePct).toBeNull(); expect(r.partialNote).toMatch(/2 of 9 months/);
  });
  it("way-off budget without a close date is held back too", () => {
    expect(noiVsBudget({ noiYtdActual: 600_000, noiYtdBudget: 94_000, period: "202609" }, null)!.partial).toBe(true);
  });
  it("like-for-like variance is coloured", () => {
    const r = noiVsBudget({ noiYtdActual: 900_000, noiYtdBudget: 1_000_000, period: "202609", basis: "A" }, "2019-03-01")!;
    expect([r.variancePct, r.colour, r.basis]).toEqual([-10, "red", "Accrual"]);
  });
});

import { keyDebtDeadlines, collapsePortfolioCovenants, type CriticalDate } from "../assetMgmt";
describe("Dates tab debt deadlines", () => {
  const ds = Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, propertyName: `Cedar ${i}` })).concat([{ id: "prov", propertyName: "Providence Town Center" }, { id: "som", propertyName: "Somerset Square" }, { id: "bl", propertyName: "Bloomfield" }]) as unknown as Deal[];
  const recs = [
    ...Array.from({ length: 13 }, (_, i) => rec(`l${i}`, "loan", `c${i}`, { lender: "HPS / Guardian", loanLabel: "Cedar Portfolio Loan", covenants: "Rate caps: Cap A $335M @5.25% to 2/1/28; Cap B $68.5M @4.50% to 2/1/27" })),
    rec("lp", "loan", "prov", { lender: "Bank", extensionOptions: "One 1-yr extension; notice window 11/19/26 – 1/3/27", maturityDate: "2027-04-03" }),
    rec("ls", "loan", "som", { lender: "Bank", currentBalance: 9e6, maturityDate: "2026-11-01" }),
    rec("lb", "loan", "bl", { lender: "Bank", notes: "Rate cap $11.5M @4.50% to 2/1/27" }),
  ];
  it("pins caps (grouped), the extension window and near maturities", () => {
    const k = keyDebtDeadlines(ds, recs, today);
    expect(k.map(x => [x.kind, x.date, x.properties.length])).toEqual([
      ["Loan maturity", "2026-11-01", 1], ["Extension notice window", "2026-11-19", 1], ["Rate cap expires", "2027-02-01", 13], ["Rate cap expires", "2027-02-01", 1], ["Loan maturity", "2027-04-03", 1], ["Rate cap expires", "2028-02-01", 13],
    ]);
    expect(k.find(x => x.properties.length === 13)!.title).toMatch(/^Cedar portfolio \(13 properties\)/);
  });
  it("collapses a covenant repeated across the portfolio", () => {
    const items: CriticalDate[] = Array.from({ length: 13 }, (_, i) => ({ date: "2026-12-31", days: 73, type: "Covenant test", dealId: `c${i}`, property: `Cedar ${i}`, tenant: null, description: "Debt yield ≥ 7.50%", source: "Covenant", owner: null }));
    const out = collapsePortfolioCovenants(items, recs, ds);
    expect(out).toHaveLength(1); expect(out[0].property).toBe("Cedar portfolio (13 properties)");
  });
});
