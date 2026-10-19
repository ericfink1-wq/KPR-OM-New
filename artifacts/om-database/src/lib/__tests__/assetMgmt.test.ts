import { describe, it, expect } from "vitest";
import { buildDebtRows, buildSwapRows, debtTotals, buildPrefRows, prefTotals, annualDebtService, nextCovenantTest, buildCovenantRows, planVsActual, optionLabel, sinceAcquisition, driveLinks, marketSwapRate, buildCriticalDates, buildCreditWatch, buildSalesRows, omVsToday, daysUntil, type AmRecord } from "../assetMgmt";
import type { Deal } from "../idb";
import type { RatesPayload } from "../api";

const TODAY = new Date("2026-10-18T12:00:00Z");
const rates = {
  treasuries: { rows: [{ label: "10-Yr", value: 4.1, asOf: "2026-10-16" }], asOf: "2026-10-16", source: "" },
  sofr: { rows: [{ label: "SOFR Term – 1 Month", value: 3.97183, asOf: "2026-10-16" }], asOf: "2026-10-16", source: "" },
  swaps: { rows: [{ label: "SOFR Swap – 1 Year", value: 4.456, asOf: "x" }, { label: "SOFR Swap – 5 Year", value: 4.598, asOf: "x" }], asOf: "x", source: "", spreadBps: 0 },
  termSwapCurve: { derived: true, fromKind: "dtcc-eod", asOf: "2026-10-16", curveDate: "2026-10-16", source: "", basisWindowDays: 20,
    points: [{ tenor: 1, rate: 4.358, oisRate: 0, monthly: 0, basisBp: 0, basisSource: "default", basisPrints: 0 }, { tenor: 5, rate: 4.501, oisRate: 0, monthly: 0, basisBp: 0, basisSource: "default", basisPrints: 0 }] },
  fetchedAt: "",
} as unknown as RatesPayload;

const deal = (id: string, extra: Partial<Deal> = {}): Deal => ({ id, propertyName: id.toUpperCase(), status: "Owned", ...extra } as Deal);
const rec = (id: string, kind: AmRecord["kind"], dealId: string, data: Record<string, unknown>, sourceNote: string | null = null): AmRecord => ({ id, kind, dealId, data, sourceNote, updatedBy: null, updatedAt: "" });

describe("swap curve lookup", () => {
  it("prices off 1M Term SOFR by default and annual/annual for Daily Simple SOFR", () => {
    expect(marketSwapRate(rates, 3, "1M CME Term SOFR")).toMatchObject({ rate: 4.43, curve: "1M Term SOFR" });
    expect(marketSwapRate(rates, 5, "Daily Simple SOFR")).toMatchObject({ rate: 4.598, curve: "SOFR (annual/annual)" });
  });
});

describe("debt & swaps", () => {
  const deals = [deal("bens"), deal("wtby")];
  const records = [
    rec("loan:b", "loan", "bens", { lender: "M&T", originalBalance: 13_650_000, maturityDate: "2030-02-01", rateType: "swapped", spreadBps: 236 }, "Loan summary"),
    rec("swap:b", "swap", "bens", { counterparty: "M&T", notional: 13_650_000, fixedSwapRatePct: 4.08, spreadBps: 236, maturityDate: "2030-02-01", index: "1M CME Term SOFR" }, "Derivative Advisors MTM 6/9/26"),
    rec("loan:w", "loan", "wtby", { lender: "Webster", originalBalance: 24_000_000, maturityDate: "2027-03-01", rateType: "floating", spreadBps: 220, index: "1M CME Term SOFR" }),
    rec("datex-loan:9", "loan", "wtby", { lender: "Webster", originalBalance: 24_000_000, maturityDate: "2027-03-01" }, "Datex Loans #9"),
  ];
  const rows = buildDebtRows(records, deals, rates, TODAY);
  it("all-in = swap fixed + spread for a swapped loan (Bensalem 4.08% + 2.36% = 6.44%)", () => {
    const b = rows.find(r => r.dealId === "bens")!;
    expect(b.allInPct).toBeCloseTo(6.44, 4);
    expect(b.allInSource).toBe("swap fixed + spread");
  });
  it("floating = live 1M Term SOFR spot + spread; flags a maturity inside 12 months red", () => {
    const w = rows.find(r => r.record.id === "loan:w")!;
    expect(w.allInPct).toBeCloseTo(3.97183 + 2.2, 4);
    expect(w.flag).toBe("red");
  });
  it("a Datex-seeded loan is superseded where an entered loan exists — never double-counted", () => {
    expect(rows.find(r => r.record.id === "datex-loan:9")!.superseded).toBe(true);
    const t = debtTotals(rows, buildSwapRows(records, new Map(), rates, TODAY));
    expect(t.totalDebt).toBe(37_650_000);
    expect(t.pctFixedOrHedged).toBe(36);
    expect(t.wall).toEqual([{ year: 2027, amount: 24_000_000 }, { year: 2030, amount: 13_650_000 }]);
  });
  it("swap MTM uses the same engine as the deal page, on the remaining term", () => {
    const sw = buildSwapRows(records, new Map([["bens", "Bensalem"]]), rates, TODAY)[0];
    expect(sw.curve).toBe("1M Term SOFR");
    expect(sw.remainingYears).toBeCloseTo(3.29, 1);
    expect(sw.mtm).toBeGreaterThan(0);   // locked 4.08% below today's ~4.45% Term swap → an asset
  });
});

describe("critical dates", () => {
  const d = deal("keene", { tenants: [{ name: "Michaels", sf: 21000, annualRent: 210000, leaseExpiry: "2027-01-31" }] as Deal["tenants"] });
  (d as unknown as Record<string, unknown>).datexLive = { asOf: "2026-10-15", assetManager: "Jon Smith", tenants: [{ name: "Michaels", sf: 21000, annualRent: 210000, leaseExpiry: "2027-02-28" }] };
  it("Datex lease expiries win over the OM, with source and owner; loans, swaps and entered dates join in", () => {
    const { items } = buildCriticalDates([d], [
      rec("loan:k", "loan", "keene", { lender: "KeyBank", originalBalance: 20e6, maturityDate: "2027-06-01", extensionNoticeDate: "2027-03-01" }),
      rec("date:k", "date", "keene", { date: "2026-12-01", type: "Co-tenancy", tenant: "Ulta", description: "Opening co-tenancy outside date" }, "lease §12"),
    ], [], TODAY);
    expect(items.map(i => [i.type, i.date, i.owner])).toEqual([
      ["Co-tenancy", "2026-12-01", "Jon Smith"], ["Lease expiry", "2027-02-28", "Jon Smith"], ["Extension notice", "2027-03-01", "Jon Smith"], ["Loan maturity", "2027-06-01", "Jon Smith"],
    ]);
    expect(items[1].source).toMatch(/^Datex/);
    expect(items[0].days).toBe(44);
  });
  it("option notice dates come from lease abstracts; exercised options are skipped", () => {
    const { items } = buildCriticalDates([d], [], [{ dealId: "keene", tenantName: "Michaels", options: [{ number: "1st", noticeDate: "2026-11-01", status: "available" }, { number: "2nd", noticeDate: "2026-11-15", status: "exercised" }] } as never], TODAY);
    expect(items.filter(i => i.type === "Option notice").map(i => i.description)).toEqual(["Option 1"]);
  });
  it("days are whole calendar days", () => { expect(daysUntil("2026-10-19", TODAY)).toBe(1); });
});

describe("credit watch", () => {
  const a = deal("a", { tenants: [{ name: "Joann", sf: 20000, annualRent: 200000, isAnchor: true }, { name: "Starbucks", sf: 2000, annualRent: 100000 }] as Deal["tenants"] });
  // Datex's standardized NationalTenant groups spelling variants the OM rosters split.
  const b = deal("b");
  (b as unknown as Record<string, unknown>).datexLive = { asOf: "2026-10-15", tenants: [{ name: "JOANN FABRICS #2231", nationalTenant: "Joann", sf: 18000, annualRent: 150000 }] };
  it("groups a brand across properties, shares of rent, and status from watchlist then news", () => {
    const { rows, totalRent } = buildCreditWatch([a, b], [], [{ brand: "Joann", status: "watch" }], [{ brand: "Starbucks", level: "distressed", headline: "Starbucks to close 400 stores" }]);
    expect(totalRent).toBe(450000);
    const j = rows[0];
    expect([j.locations.length, j.rent, j.pctOfRent, j.status]).toEqual([2, 350000, 77.78, "Watch"]);
    expect(rows[1].status).toBe("Store closures announced");
  });
});

describe("tenant sales & occupancy cost", () => {
  it("12-month sales from Datex history, occupancy cost incl. recoveries, stale and at-risk flags, vs benchmark", () => {
    const d = deal("keene");
    (d as unknown as Record<string, unknown>).datexLive = { asOf: "2026-10-15", tenants: [
      { name: "Michaels", sf: 21000, annualRent: 210000, annualNNN: 84000, sales12: { sales12: 3_090_000, months: 12, from: "202501", to: "202512", staleMonths: 10, partial: false } },
      { name: "Nail Spa", sf: 1200, annualRent: 36000, annualNNN: 12000, sales12: { sales12: 250_000, months: 12, from: "202510", to: "202609", staleMonths: 1, partial: false } },
      { name: "TD Bank", sf: 3000, annualRent: 90000, salesNeverReported: true },
    ] };
    const { rows } = buildSalesRows(d, [{ brand: "Michaels", medianSalesPerSf: 160, salesCount: 30 } as never]);
    const nail = rows.find(r => r.tenant === "Nail Spa")!, m = rows.find(r => r.tenant === "Michaels")!;
    expect(nail).toMatchObject({ occCostPct: 19.2, atRisk: true });
    expect(m).toMatchObject({ salesPSF: 147.14, occCostPct: 9.5, atRisk: false, period: "01/2025–12/2025", vsBenchmarkPct: -8 });
    expect(m.flags[0]).toMatch(/10 months ago/);
    expect(rows.find(r => r.tenant === "TD Bank")!.flags).toEqual(["never reports"]);
  });
  it("OM vs today", () => {
    const d = deal("x", { occupancy: 92, noi: 2_000_000, totalSF: 100000 });
    (d as unknown as Record<string, unknown>).datexLive = { occupancyPct: 88.5, totalGLA: 101000, financials: { period: "202609", noiTtmActual: 1_900_000 } };
    expect(omVsToday(d).map(r => [r.label, r.om, r.today])).toEqual([["Occupancy", 92, 88.5], ["GLA", 100000, 101000], ["In-place base rent", null, null], ["NOI", 2_000_000, 1_900_000]]);
  });
});

describe("labels, pending swaps, preferred equity", () => {
  const deals = [deal("rock")];
  const records = [
    rec("loan:c", "loan", "rock", { lender: "Wells", loanLabel: "Commons", originalBalance: 30e6, maturityDate: "2029-01-01", rateType: "swapped", spreadBps: 200 }),
    rec("loan:t", "loan", "rock", { lender: "Wells", loanLabel: "Town Court", originalBalance: 20e6, maturityDate: "2029-01-01", rateType: "swapped", spreadBps: 210 }),
    rec("swap:c", "swap", "rock", { counterparty: "Wells", loanLabel: "Commons", notional: 30e6, fixedSwapRatePct: 3.5, spreadBps: 200, maturityDate: "2029-01-01" }),
    rec("swap:t", "swap", "rock", { counterparty: "Wells", loanLabel: "Town Court", termsPending: true }),
    rec("pref:1", "pref", "rock", { investor: "Kimco", loanLabel: "Town Plaza", amount: 10e6, ratePct: 9.25 }),
    rec("pref:2", "pref", "rock", { investor: "Kimco", loanLabel: "Town Court", amount: 7e6, ratePct: 9.25 }),
  ];
  const rows = buildDebtRows(records, deals, rates, TODAY);
  it("swaps attach by loan label; a pending swap is shown but never priced or used for the all-in", () => {
    const c = rows.find(r => r.loanLabel === "Commons")!, t = rows.find(r => r.loanLabel === "Town Court")!;
    expect(c.swaps.map(w => w.record.id)).toEqual(["swap:c"]);
    expect(c.allInPct).toBeCloseTo(5.5, 4);
    expect(t.swaps[0]).toMatchObject({ termsPending: true, mtm: null, marketRatePct: null });
    expect(t.allInPct).toBeNull();
  });
  it("preferred equity stays out of total debt and the weighted rate", () => {
    const tot = debtTotals(rows, buildSwapRows(records, new Map(), rates, TODAY));
    expect(tot.totalDebt).toBe(50e6);
    expect(prefTotals(buildPrefRows(records, deals, TODAY))).toMatchObject({ total: 17e6, count: 2, weightedRatePct: 9.25 });
  });
});

describe("owned deal page: debt service, covenants, plan vs actual", () => {
  it("debt service is interest-only inside the IO period (Overland, IO to 1/15/2030), amortizing after", () => {
    const loan = { amortization: "IO", ioUntil: "2030-01-15", amortYears: 30 };
    expect(annualDebtService(17_000_000, 6.44, loan, TODAY)).toEqual({ amount: 1_094_800, basis: "interest only to 2030-01-15" });
    const after = annualDebtService(17_000_000, 6.44, loan, new Date("2030-06-01T12:00:00Z"));
    expect(after.amount).toBe(1_281_380);   // 30-yr level payment, $106,782/mo
    // A covenant tested on a 25-yr amortization ignores the IO period.
    expect(annualDebtService(10_000_000, 6, loan, TODAY, 25).basis).toMatch(/25-yr amortization \(covenant test basis\)/);
  });
  it("next test date: from the first test, each 12/31, or the next quarter end", () => {
    expect(nextCovenantTest({ testFrequency: "quarterly", firstTestDate: "2027-03-31" }, TODAY)).toBe("2027-03-31");
    expect(nextCovenantTest({ testFrequency: "quarterly", firstTestDate: "2026-06-30" }, TODAY)).toBe("2026-12-31");
    expect(nextCovenantTest({ testFrequency: "annual", testMonthDay: "12-31" }, TODAY)).toBe("2026-12-31");
    expect(nextCovenantTest({ testFrequency: "quarterly" }, TODAY)).toBe("2026-12-31");
    expect(nextCovenantTest({}, TODAY)).toBeNull();
  });
  it("DSCR headroom from Datex trailing NOI over IO-aware debt service; tenant triggers land on the calendar", () => {
    const d = deal("ovl", { noi: 2_300_000 });
    (d as unknown as Record<string, unknown>).datexLive = { asOf: "2026-10-15", financials: { period: "202609", noiTtmActual: 2_310_000 } };
    const records = [
      rec("loan:o", "loan", "ovl", { lender: "ONB", originalBalance: 17_000_000, rateType: "fixed", fixedRatePct: 6.44, amortization: "IO", ioUntil: "2030-01-15", maturityDate: "2030-01-15" }),
      rec("cov:1", "covenant", "ovl", { loanId: "loan:o", type: "DSCR", threshold: 1.25, testFrequency: "quarterly", firstTestDate: "2027-03-31" }),
      rec("cov:2", "covenant", "ovl", { loanId: "loan:o", type: "cash-sweep", linkedTenant: "Schnucks", triggerDate: "2029-09-29", trigger: "Sweep if Schnucks not extended" }),
    ];
    const rows = buildCovenantRows(d, records, buildDebtRows(records, [d], rates, TODAY), TODAY);
    const dscr = rows.find(r => r.type === "DSCR")!;
    expect(dscr).toMatchObject({ actual: 2.11, status: "ok", nextTest: "2027-03-31" });
    expect(dscr.headroomPct).toBeCloseTo(68.8, 1);
    expect(dscr.actualBasis).toMatch(/Datex trailing 12 months to 202609 ÷ \$1\.09M debt service \(interest only/);
    expect(rows.find(r => r.type === "cash-sweep")).toMatchObject({ status: "info", triggerDate: "2029-09-29" });
    const cal = buildCriticalDates([d], records, [], TODAY).items;
    expect(cal.filter(i => i.type.startsWith("Covenant")).map(i => [i.type, i.date, i.tenant])).toEqual([["Covenant test", "2027-03-31", null], ["Covenant trigger", "2029-09-29", "Schnucks"]]);
  });
  it("plan vs actual: underwritten NOI at purchase vs Datex, with variance", () => {
    const d = deal("p", { noi: 2_000_000, occupancy: 95 });
    (d as unknown as Record<string, unknown>).datexLive = { asOf: "2026-10-15", occupancyPct: 92.5, financials: { period: "202609", noiTtmActual: 2_100_000, noiYtdActual: 1_500_000, noiYtdBudget: 1_550_000 } };
    const rows = planVsActual(d, [rec("acq:p", "acquisition", "p", { noiAtPurchase: 1_950_000, closeDate: "2024-05-01" })]);
    expect(rows[0]).toMatchObject({ plan: 1_950_000, actual: 2_100_000, variance: 150_000, variancePct: 7.7 });
    expect(rows[1]).toMatchObject({ plan: 1_550_000, actual: 1_500_000, variancePct: -3.2 });
    expect(rows.find(r => r.label === "Occupancy")).toMatchObject({ plan: 95, actual: 92.5, variance: -2.5 });
  });
  it("labels and links", () => {
    expect(optionLabel({ number: "1", ratePSF: 17.6 })).toBe("Option 1 · $17.60/SF");
    expect(optionLabel({ number: "2nd Renewal", length: "5 yrs" })).toBe("2nd Renewal · 5 yrs");
    expect(driveLinks(rec("l", "loan", "x", { sourceDocs: [{ id: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123", name: "Loan agreement" }] }))).toEqual([{ url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123/view", name: "Loan agreement" }]);
    const t = sinceAcquisition(deal("q", { txnCloseDate: "2024-05-01", txnPurchasePrice: 28_700_000 } as Partial<Deal>), [], TODAY);
    expect(t[0].text).toBe("KPR closed the acquisition for $28.70M");
  });
});
