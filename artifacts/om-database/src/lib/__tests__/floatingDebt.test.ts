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

import { stripStoreSuffix, brandFamilyKey } from "../tenantCredit";
describe("store numbers stripped", () => {
  it("one brand = one row", () => {
    expect(stripStoreSuffix("Walgreens #5282")).toBe("Walgreens");
    expect(stripStoreSuffix("Sleep Number #11194")).toBe("Sleep Number");
    expect(stripStoreSuffix("CVS Store 1234")).toBe("CVS");
    expect(stripStoreSuffix("Ulta - 512")).toBe("Ulta");
    expect(stripStoreSuffix("Dollar Tree 04516")).toBe("Dollar Tree");
    expect(stripStoreSuffix("Regal 14")).toBe("Regal 14");
    expect(stripStoreSuffix("Five Below")).toBe("Five Below");
    expect(brandFamilyKey("WALGREENS #5282")).toBe(brandFamilyKey("Walgreens"));
  });
});

import { headlineAffectsUs, buildCreditWatch } from "../assetMgmt";
describe("credit watch headlines by location", () => {
  it("drops a headline naming only states we're not in", () => {
    expect(headlineAffectsUs("PNC to close 12 Colorado branches", new Set(["PA", "OH"]))).toBe(false);
    expect(headlineAffectsUs("PNC to close Pennsylvania branches", new Set(["PA"]))).toBe(true);
    expect(headlineAffectsUs("Big Lots files for Chapter 11", new Set(["PA"]))).toBe(true);
    expect(headlineAffectsUs("Store closures across West Virginia", new Set(["VA"]))).toBe(false);
  });
  it("flags the brand only on a relevant headline", () => {
    const d = [{ id: "a", propertyName: "A", state: "PA", tenants: [{ name: "PNC Bank #12", annualRent: 50000 }] }] as unknown as Deal[];
    const { rows } = buildCreditWatch(d, [], [], [{ brand: "PNC Bank", level: "distressed", headline: "PNC store closures in Colorado", scannedAt: "x", hits: [{ level: "distressed", headline: "PNC store closures in Colorado" }] }]);
    expect(rows[0].brand).toMatch(/^pnc bank$/i); expect(rows[0].status).toBe("OK"); expect(rows[0].newsDropped).toBe(1);
  });
});

import { buildPrefRows, prefTotals } from "../assetMgmt";
describe("preferred equity current pay vs all-in", () => {
  it("per-year dollars from amount × rate; missing current pay stays null, not 0; debt rate untouched", () => {
    const ds = [{ id: "r", propertyName: "Rockaway" }] as unknown as Deal[];
    const rows = buildPrefRows([
      rec("p1", "pref", "r", { investor: "Kimco", loanLabel: "Town Plaza", amount: 10_000_000, ratePct: 9.25, currentPayPct: 8.25, accruedPct: 1.0, redemptionDate: "2028-07-10" }),
      rec("p2", "pref", "r", { investor: "X", amount: 4_000_000, ratePct: 10, accrualPct: 1.5 }),
    ], ds, today);
    const a = rows.find(r => r.record.id === "p1")!, b = rows.find(r => r.record.id === "p2")!;
    expect([a.annualCurrentPay, a.annualAccrual]).toEqual([825_000, 100_000]);
    expect([b.currentPayPct, b.annualCurrentPay, b.accruedPct, b.annualAccrual]).toEqual([null, null, 1.5, 60_000]);
    const t = prefTotals(rows);
    expect([t.annualCurrentPay, t.annualAccrual, t.currentPayCovered]).toEqual([825_000, 160_000, 1]);
    expect(debtTotals(buildDebtRows([], ds, rates, today), []).weightedRatePct).toBeNull();
  });
});

import { recordSources } from "../assetMgmt";
describe("record sources", () => {
  it("counts documents, lists missing ones, drops non-http links", () => {
    const r = rec("l", "loan", "c1", { sources: [{ title: "Note", url: "https://drive.google.com/x" }, { title: "Bad", url: "javascript:1" }, { docType: "x" }], missingDocs: ["Executed note not in folder", ""] });
    const out = recordSources(r);
    expect(out.count).toBe(2);
    expect(out.sources[1].url).toBeUndefined();
    expect(out.missing).toEqual(["Executed note not in folder"]);
    expect(recordSources(rec("e", "loan", "c1", {})).count).toBe(0);
  });
});

describe("swapped / partly swapped loans + IO / Amort (Andy, 10/19/26)", () => {
  const ds = [{ id: "p", propertyName: "Pointe Plaza" }, { id: "b", propertyName: "Plaza at Bensalem" }, { id: "r", propertyName: "Rockaway" }, { id: "x", propertyName: "Solo" }] as unknown as Deal[];
  it("partial swap blends: swapped part at the swap all-in, the rest at curve SOFR + spread, marked ~", () => {
    const rows = buildDebtRows([
      rec("lp", "loan", "p", { currentBalance: 26e6, rateType: "floating", index: "1M Term SOFR", spreadBps: 200, maturityDate: "2030-01-01" }),
      rec("sp", "swap", "p", { notional: 23.5e6, fixedSwapRatePct: 3.8, spreadBps: 200, maturityDate: "2030-01-01" }),
    ], ds, rates, today);
    const r = rows[0];
    expect(r.rateClass).toBe("swapped");
    expect(r.partlySwapped).toEqual({ swapped: 23.5e6, balance: 26e6 });
    expect(r.allInBasis).toBe("blended");
    expect(r.estimated).toBe(true);
    expect(r.allInPct).toBeCloseTo((23.5 * 5.8 + 2.5 * (3.95 + 2)) / 26, 3);
    expect(r.allInSource).toMatch(/blended/);
  });
  it("a fully swapped loan is unchanged: swap all-in, not estimated", () => {
    const r = buildDebtRows([
      rec("lr", "loan", "r", { currentBalance: 22.72e6, rateType: "floating", spreadBps: 175, loanLabel: "Commons", maturityDate: "2031-01-01" }),
      rec("sr", "swap", "r", { notional: 22.72e6, fixedSwapRatePct: 3.6, spreadBps: 175, loanLabel: "Commons", maturityDate: "2031-01-01" }),
    ], ds, rates, today)[0];
    expect(r.allInPct).toBeCloseTo(5.35, 4); expect(r.allInBasis).toBe("swap"); expect(r.estimated).toBe(false); expect(r.partlySwapped).toBeNull();
  });
  it("rateType floating/fixed + a linked live swap → uses the swap, never curve SOFR + spread (Bensalem → Swapped +236)", () => {
    for (const rateType of ["floating", "fixed"]) {
      const r = buildDebtRows([
        rec("lb", "loan", "b", { currentBalance: 13.65e6, rateType, fixedRatePct: rateType === "fixed" ? 6.44 : undefined, index: "1M Term SOFR + 236 bps", loanLabel: "M&T loan", maturityDate: "2030-02-01" }),
        rec("sb", "swap", "b", { notional: 13.65e6, fixedSwapRatePct: 4.08, spreadBps: 236, loanLabel: "M&T Senior", maturityDate: "2030-02-01" }),
      ], ds, rates, today)[0];
      expect(r.rateClass).toBe("swapped");
      expect(r.spreadBps).toBe(236);
      expect(r.allInPct).toBeCloseTo(6.44, 4);
      expect(r.allInBasis).toBe("swap");
      expect(r.estimated).toBe(false);
    }
  });
  it("a matured swap no longer overrides the loan", () => {
    const r = buildDebtRows([
      rec("lx", "loan", "x", { currentBalance: 10e6, rateType: "floating", spreadBps: 200 }),
      rec("sx", "swap", "x", { notional: 10e6, fixedSwapRatePct: 3, spreadBps: 200, maturityDate: "2025-01-01" }),
    ], ds, rates, today)[0];
    expect(r.rateClass).toBe("floating"); expect(r.allInBasis).toBe("curve est.");
  });
  it("IO / Amort label from ioUntil|ioEndDate + amortYears + maturity", () => {
    const lbl = (data: Record<string, unknown>) => buildDebtRows([rec("l", "loan", "x", data)], ds, rates, today)[0].ioAmort;
    expect(lbl({ ioEndDate: "2030-01-15", amortYears: 25, maturityDate: "2032-01-15" })).toBe("IO to Jan 2030, then 25-yr");
    expect(lbl({ ioUntil: "2029-03-01", amortYears: 30, maturityDate: "2031-03-01" })).toBe("IO to Mar 2029, then 30-yr");
    expect(lbl({ ioUntil: "2031-03-01", maturityDate: "2031-03-01" })).toBe("IO full term");
    expect(lbl({ amortization: "IO", maturityDate: "2031-03-01" })).toBe("IO full term");
    expect(lbl({ amortYears: 30, amortization: "amortizing" })).toBe("30-yr amort");
    expect(lbl({ lender: "X" })).toBeNull();
  });
});

describe("partly swapped regression — Pointe Plaza + Overland Plaza (live 93a7abe showed '—')", () => {
  const ds = [{ id: "pp", propertyName: "Pointe Plaza" }, { id: "op", propertyName: "Overland Plaza" }] as unknown as Deal[];
  // Shapes as imported: no spreadBps on the loan; the swap carries all-in + swap rate.
  const pointe = (loanExtra: Record<string, unknown> = {}, swapExtra: Record<string, unknown> = {}) => [
    rec("lpp", "loan", "pp", { lender: "BankUnited", currentBalance: 26_000_000, rateType: "floating", index: "1M Term SOFR", maturityDate: "2031-01-01", ...loanExtra }),
    rec("spp", "swap", "pp", { counterparty: "BankUnited", notional: 23_500_000, fixedSwapRatePct: 3.45, allInFixedPct: 5.10, maturityDate: "2031-01-01", ...swapExtra }),
  ];
  const overland = (loanExtra: Record<string, unknown> = {}) => [
    rec("lop", "loan", "op", { lender: "ONB", currentBalance: 18_655_000, rateType: "floating", index: "Daily Simple SOFR", maturityDate: "2030-06-01", ...loanExtra }),
    rec("sop", "swap", "op", { counterparty: "ONB", notional: 16_345_000, fixedSwapRatePct: 4.16, allInFixedPct: 5.91, index: "Daily Simple SOFR", maturityDate: "2030-06-01" }),
  ];
  const pointeExpected = (23.5 * 5.10 + 2.5 * (3.95 + 1.65)) / 26;          // 1M Term 3.95 + 165
  const overlandExpected = (16.345 * 5.91 + 2.31 * (4.01 + 1.75)) / 18.655;  // overnight 4.01 + 175
  const one = (recs: AmRecord[]) => buildDebtRows(recs, ds, rates, today)[0];
  it("Pointe: spread from the swap (all-in − swap rate) → ~5.15% blended", () => {
    const r = one(pointe());
    expect(r.allInPct).toBeCloseTo(pointeExpected, 3);
    expect(r.allInPct!).toBeGreaterThan(5.1); expect(r.allInPct!).toBeLessThan(5.2);
    expect(r.allInBasis).toBe("blended"); expect(r.estimated).toBe(true); expect(r.spreadBps).toBe(165);
  });
  it("Overland: Daily Simple SOFR remainder at overnight SOFR + 175 → ~5.9% blended", () => {
    const r = one(overland({ spreadBps: 175 }));
    expect(r.allInPct).toBeCloseTo(overlandExpected, 3);
    expect(r.allInPct!).toBeGreaterThan(5.85); expect(r.allInPct!).toBeLessThan(6.0);
    expect(r.allInBasis).toBe("blended");
    expect(one(overland()).allInPct).toBeCloseTo(overlandExpected, 3); // spread derived from the swap too
  });
  it("loan spread read from raw columns / text: spread 165, '1.65%', '165 over 1M Term SOFR', swap spreadBps", () => {
    for (const extra of [{ spread: 165 }, { spread: 1.65 }, { margin: "165 bps" }, { index: "165 over 1M Term SOFR" }, { notes: "x", index: "1M Term SOFR + 1.65%" }, { margin: "1M Term SOFR + 165 bps" }]) {
      expect(one(pointe(extra, { fixedSwapRatePct: undefined })).allInPct).toBeCloseTo(pointeExpected, 3);
    }
    expect(one(pointe({}, { fixedSwapRatePct: undefined, spreadBps: 165 })).allInPct).toBeCloseTo(pointeExpected, 3);
  });
  it("swap with only notional + all-in (no swap rate yet) still prices the loan; no SOFR rate at all → '—' with the reason", () => {
    const r = one(pointe({ spreadBps: 165 }, { fixedSwapRatePct: undefined }));
    expect(r.allInPct).toBeCloseTo(pointeExpected, 3);
    const none = buildDebtRows(pointe({ spreadBps: 165 }), ds, null, today)[0];
    expect(none.allInPct).toBeNull(); expect(none.allInSource).toMatch(/can't be priced/);
  });
  it("any SOFR variant falls back to 1M Term when overnight is missing", () => {
    const noOn = { ...rates, sofrOvernight: null } as unknown as RatesPayload;
    const r = buildDebtRows(overland({ spreadBps: 175 }), ds, noOn, today)[0];
    expect(r.allInPct).toBeCloseTo((16.345 * 5.91 + 2.31 * (3.95 + 1.75)) / 18.655, 3);
    expect(r.allInSource).toMatch(/1M Term SOFR/);
  });
});
