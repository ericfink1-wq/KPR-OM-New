import { describe, it, expect } from "vitest";
import { sanitizeLoan, sanitizeSwap, planImport, readImportText, resolveDeal, cleanBldgIds, normIndex, datexLoanToRecord, isoDate, headlineNamesBrand, isPrefEquityRow } from "../assetMgmt";
import { reduceSalesHistory, glaTieOut, buildLiveBlock } from "../datexImport";

const OWNED = [
  { id: "d-bens", name: "Plaza at Bensalem", bldgIds: ["bensalem"] },
  { id: "d-cooks", name: "Cooks Corner Shopping Center", bldgIds: ["brunswic"] },
  { id: "d-rock", name: "Rockaway Centers", bldgIds: ["rockcom", "rockcrt", "rockplz"] },
];

describe("loan / swap records", () => {
  it("reads the MTM-report style seed (rate as % or as fraction, spread as % or bps)", () => {
    const s = sanitizeSwap({ notional: "13,650,000", swapRate: "4.08%", spread: "2.36", maturity: "2/1/2030", index: "USD-SOFR CME Term 1M", counterparty: "M&T" });
    expect(s).toMatchObject({ notional: 13_650_000, fixedSwapRatePct: 4.08, spreadBps: 236, maturityDate: "2030-02-01", index: "1M CME Term SOFR" });
    expect(sanitizeSwap({ fixedRate: 0.019555 }).fixedSwapRatePct).toBeCloseTo(1.9555, 4);
  });
  it("keeps Daily Simple SOFR distinct (Overland / ONB)", () => {
    expect(normIndex("Daily Simple SOFR")).toBe("Daily Simple SOFR");
    expect(normIndex("SOFR compounded in arrears")).toBe("Daily Simple SOFR");
  });
  it("never invents values: blanks and junk are omitted, not zeroed", () => {
    const l = sanitizeLoan({ lender: "", originalBalance: "n/a", dscrCovenant: 40, maturityDate: "soon" });
    expect(l).toEqual({});
  });
  it("dates: ISO or US style only", () => {
    expect(isoDate("12/11/28")).toBe("2028-12-11");
    expect(isoDate("Dec 2028")).toBeUndefined();
  });
});

describe("import", () => {
  it("resolves by dealId, Datex bldgId or EXACT owned name — never a fuzzy guess", () => {
    expect(resolveDeal({ bldgId: "rockplz" }, OWNED)).toEqual({ dealId: "d-rock" });
    expect(resolveDeal({ property: "plaza at bensalem" }, OWNED)).toEqual({ dealId: "d-bens" });
    expect("problem" in resolveDeal({ property: "Bensalem" }, OWNED)).toBe(true);
    expect("problem" in resolveDeal({ dealId: "not-owned" }, OWNED)).toBe(true);
  });
  it("JSON seed: creates, then re-import updates the same rows (stable ids)", () => {
    const text = JSON.stringify({
      loans: [{ property: "Plaza at Bensalem", lender: "M&T", originalBalance: 13650000, maturityDate: "2030-02-01", rateType: "swapped", index: "Term SOFR", spreadBps: 236, source: "Loan summary (Drive)" }],
      swaps: [{ bldgId: "bensalem", counterparty: "M&T", notional: 13650000, fixedSwapRatePct: 4.08, maturityDate: "2030-02-01", source: "Derivative Advisors MTM 6/9/26" }],
    });
    const p1 = planImport(text, OWNED, new Set());
    expect(p1.rejected).toEqual([]);
    expect(p1.rows.map(r => [r.kind, r.action, r.sourceNote])).toEqual([["loan", "create", "Loan summary (Drive)"], ["swap", "create", "Derivative Advisors MTM 6/9/26"]]);
    const p2 = planImport(text, OWNED, new Set(p1.rows.map(r => r.id)));
    expect(p2.rows.every(r => r.action === "update")).toBe(true);
  });
  it("CSV with a kind column; rows missing the essentials are rejected with a reason", () => {
    const csv = "kind,property,lender,originalBalance,maturityDate\nloan,Cooks Corner Shopping Center,Bank X,17540000,8/1/2028\nloan,Cooks Corner Shopping Center,Bank Y,,\n";
    const p = planImport(csv, OWNED, new Set());
    expect(p.rows).toHaveLength(1);
    expect(p.rejected[0].problem).toMatch(/balance/);
  });
  it("says what it needs when the paste isn't usable", () => {
    expect(readImportText("hello").problem).toMatch(/kind/);
    expect(readImportText("{bad").problem).toMatch(/JSON/);
  });
  it("building ids: short codes only", () => {
    expect(cleanBldgIds(["Keene ", "keene", "rockcom"])).toEqual(["keene", "rockcom"]);
    expect(cleanBldgIds(["Monadnock Marketplace"])).toBeNull();
  });
  it("Datex loan rows: inactive or empty ones are dropped", () => {
    expect(datexLoanToRecord({ LoanId: 7, Inactive: true, InitializeAmount: 1 })).toBeNull();
    expect(datexLoanToRecord({ LoanId: 8, Lender: "PNC", InitializeAmount: 20e6, DueDate: "2029-06-01T00:00:00" })?.data).toMatchObject({ lender: "PNC", originalBalance: 20e6, maturityDate: "2029-06-01", datexLoanId: 8 });
  });
});

describe("Datex snapshot v2", () => {
  it("sales: sums the last 12 REPORTED months — the Michaels @ keene trap", () => {
    // Reported monthly through 2025-12, then stopped. Rolling12Sales as of 2026-10 would sum only
    // the 2 stale months still in its window; the right answer is the full 2025 year.
    const rows = Array.from({ length: 12 }, (_, i) => ({ tenantId: "t0000123", period: `2025${String(i + 1).padStart(2, "0")}`, amount: 257_500, reportingType: "RPT" }));
    const s = reduceSalesHistory(rows, "202610").get("t0000123")!;
    expect(s).toMatchObject({ sales12: 3_090_000, months: 12, from: "202501", to: "202512", staleMonths: 10, partial: false });
  });
  it("sales: superseded rows, 190001 and negatives are ignored; RPT beats an estimate", () => {
    const s = reduceSalesHistory([
      { tenantId: "t1", period: "202609", amount: 100, reportingType: "EST" }, { tenantId: "t1", period: "202609", amount: 120, reportingType: "RPT" },
      { tenantId: "t1.0.00011", period: "202609", amount: 999 }, { tenantId: "t2", period: "190001", amount: 50 }, { tenantId: "t3", period: "202609", amount: -5 },
    ], "202610");
    expect(s.get("t1")).toMatchObject({ sales12: 120, months: 1, partial: true });
    expect(s.has("t2") || s.has("t3") || s.has("t1.0.00011")).toBe(false);
  });
  it("GLA tie-out: roster (live + vacant) vs Occupancy.TotalGLA, warns beyond 2%", () => {
    expect(glaTieOut([{ sf: 200_000 }], [{ sf: 100_386 }], 300_386)).toMatchObject({ rosterGLA: 300_386, ties: true });
    expect(glaTieOut([{ sf: 340_824 }], [], 300_386).ties).toBe(false);
  });
  it("NOI is flipped from Datex's credit sign; A/R buckets must be consistent", () => {
    const ok = buildLiveBlock({ dealId: "d", bldgIds: ["keene"], totalGLA: 1000, occupiedGLA: 900,
      financials: { period: "202609", noiYtdActual: -2_131_321.98, noiYtdBudget: -2_216_021.02 }, arAging: { over60: 5000, over90: 3000 } }, "2026-10-18", { bldgIds: ["keene"] });
    expect("block" in ok && ok.block.financials).toMatchObject({ period: "202609", noiYtdActual: 2_131_322, noiYtdBudget: 2_216_021 });
    const bad = buildLiveBlock({ dealId: "d", bldgIds: ["keene"], arAging: { over60: 100, over90: 5000 } }, "2026-10-18", { bldgIds: ["keene"] });
    expect("problem" in bad).toBe(true);
  });
  it("tenant rows carry sales12 and a never-reports flag", () => {
    const r = buildLiveBlock({ dealId: "d", bldgIds: ["keene"], tenants: [
      { tenantId: "a", name: "Michaels", sf: 21000, annualRent: 210000, annualNNN: 84000, lastSalesPeriod: "202512" },
      { tenantId: "b", name: "Bank", sf: 3000, annualRent: 90000, lastSalesPeriod: "190001" },
    ], salesHistory: [{ tenantId: "a", period: "202512", amount: 300000 }] }, "2026-10-18", { bldgIds: ["keene"] });
    const t = ("block" in r ? r.block.tenants : []) as Array<Record<string, unknown>>;
    expect(t[0].sales12).toMatchObject({ sales12: 300000, staleMonths: 10 });
    expect(t[1].salesNeverReported).toBe(true);
  });
});

describe("credit-watch headlines", () => {
  it("only headlines that name the brand count", () => {
    expect(headlineNamesBrand("Fred Meyer to close 3 stores in Oregon", "Fred Meyer")).toBe(true);
    expect(headlineNamesBrand("Grocery store closures a result of government intervention", "Fred Meyer")).toBe(false);
    expect(headlineNamesBrand("Five Below raises guidance", "Five Below")).toBe(true);
    expect(headlineNamesBrand("Rossmann closes stores", "Ross")).toBe(false);
    expect(headlineNamesBrand("Ross's store count grows", "Ross")).toBe(true);
  });
});

describe("seed follow-ups (10/18/26)", () => {
  it("keeps covenants / prepayment / open questions / confidence / loanLabel text, flattening lists and objects", () => {
    const l = sanitizeLoan({ lender: "KeyBank", loanLabel: "Town Court", covenants: { dscr: "1.25x tested quarterly", cashTrap: "1.10x" }, prepayment: "Open after 24 mo; 1% fee before", openQuestions: ["Confirm extension fee", "Recourse carve-outs?"], confidence: "medium" });
    expect(l).toMatchObject({ loanLabel: "Town Court", covenants: "dscr: 1.25x tested quarterly; cashTrap: 1.10x", prepayment: "Open after 24 mo; 1% fee before", openQuestions: "Confirm extension fee; Recourse carve-outs?", confidence: "medium" });
  });
  it("a swap without notional or maturity saves as terms pending, with its own id", () => {
    const p = planImport(JSON.stringify({ swaps: [
      { bldgId: "rockcom", counterparty: "Wells Fargo", fixedSwapRatePct: 3.1, loanLabel: "Commons" },
      { bldgId: "rockcom", counterparty: "Wells Fargo", loanLabel: "Town Plaza" },
      { bldgId: "rockcom" },
    ] }), OWNED, new Set());
    expect(p.rows.map(r => r.data.termsPending)).toEqual([true, true]);
    expect(new Set(p.rows.map(r => r.id)).size).toBe(2);
    expect(p.rejected[0].problem).toMatch(/counterparty/);
  });
  it("preferred equity: its own section, routed out of loans only when a label SAYS so", () => {
    expect(isPrefEquityRow({ loanLabel: "Loan 2", instrument: "Preferred equity" })).toBe(true);
    expect(isPrefEquityRow({ lender: "Kimco", loanLabel: "Loan 1" })).toBe(false);
    const p = planImport(JSON.stringify({
      loans: [{ bldgId: "rockplz", lender: "Kimco", loanLabel: "Town Plaza", type: "pref equity", originalBalance: 5_000_000, allInRatePct: 9.25 }],
      preferredEquity: [{ property: "Plaza at Bensalem", investor: "Kimco", amount: "10,600,000", ratePct: "9.25%" }],
    }), OWNED, new Set());
    expect(p.rejected).toEqual([]);
    expect(p.rows.map(r => [r.kind, r.data.amount, r.data.ratePct])).toEqual([["pref", 5_000_000, 9.25], ["pref", 10_600_000, 9.25]]);
  });
});
