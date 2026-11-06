import { describe, it, expect } from "vitest";
import { parsePrepayText, resolvePrepayTerms, computePayoff, schedule, paymentDates, treasuryCurve, type LoanInput } from "../payoffEngine";
import type { RatesPayload } from "../api";

// Today's Rates on 11/5/26 (US Treasury constant maturities).
const T = [["1-Mo", 4.03], ["3-Mo", 4.17], ["6-Mo", 4.19], ["1-Yr", 4.28], ["2-Yr", 4.46], ["3-Yr", 4.53], ["5-Yr", 4.59], ["7-Yr", 4.7], ["10-Yr", 4.84], ["30-Yr", 5.25]] as const;
const rates = (shift = 0): RatesPayload => ({
  treasuries: { rows: T.map(([label, value]) => ({ label, value: value + shift, asOf: "2026-11-05" })), asOf: "2026-11-05", source: "US Treasury" },
  sofr: { rows: [], asOf: null, source: "" }, swaps: { rows: [{ label: "SOFR Swap – 2 Year", value: 3.6, asOf: null }, { label: "SOFR Swap – 5 Year", value: 3.7, asOf: null }], asOf: null, source: "", spreadBps: 0 },
  fetchedAt: "2026-11-05T00:00:00Z",
});

// Lakeland Park Center's Wells Fargo CMBS loan, verbatim from the deal record.
const LAKELAND_TEXT = "Defeasance permitted after Defeasance Lockout Release Date. Defeasance Lockout Release Date means the earlier to occur of (i) the third anniversary of the Monthly Payment Date immediately following the Closing Date and (ii) the date that is two (2) years from the 'startup day' (within the meaning of Section 860G(a)(9) of the IRS Code) of the REMIC Trust established in connection with the last Securitization involving any portion of or interest in the Loan.";
const ctx = { originationDate: "2024-10-18", maturityDate: "2029-11-11", paymentDay: 11, securitizationDate: null };
const lakeland = (over: Partial<LoanInput> = {}, sec: string | null = null): LoanInput => ({
  name: "Lakeland Park Center", balance: 24_000_000, balanceAsOf: null, originalBalance: 24_000_000, ratePct: 6.477, rateIsFixed: true,
  originationDate: "2024-10-18", maturityDate: "2029-11-11", ioUntil: null, amortYears: null, ioFullTerm: true, paymentDay: 11, spreadBps: null, fees: null,
  terms: resolvePrepayTerms({}, LAKELAND_TEXT, { ...ctx, securitizationDate: sec }, "read from the loan's prepayment terms", false), swaps: [], ...over,
});

describe("reading Lakeland Park's prepayment wording", () => {
  it("defeasance; lockout = 3rd anniversary of the first payment date (11/11/2024 → 11/11/2027), flagged as possibly earlier", () => {
    const p = parsePrepayText(LAKELAND_TEXT, ctx);
    expect(p.kind).toBe("defeasance");
    expect(p.lockoutEnd).toBe("2027-11-11");
    expect(p.lockoutNote).toMatch(/could be EARLIER: 2 years after the loan was securitized/);
    expect(p.openDate).toBeNull();
    expect(p.stepdown).toBeNull();
  });
  it("with the securitization date, the earlier prong wins", () => {
    expect(parsePrepayText(LAKELAND_TEXT, { ...ctx, securitizationDate: "2024-12-05" }).lockoutEnd).toBe("2026-12-05");
  });
});

describe("defeasance on Lakeland Park (interest-only, 6.477%, $24.0M, 11/5/26 Treasuries)", () => {
  it("is locked out before 11/11/2027 and prices the first permitted date instead", () => {
    const r = computePayoff(lakeland(), rates(), "2026-12-11");
    expect(r.status).toBe("locked");
    expect(r.earliestDate).toBe("2027-11-11");
    expect(r.atEarliest?.status).toBe("ok");
  });
  it("Dec 2026 (once securitized 12/5/24): bond portfolio ≈ $1.31M over the balance, to maturity", () => {
    const r = computePayoff(lakeland({}, "2024-12-05"), rates(), "2026-12-11");
    expect(r.status).toBe("ok");
    expect(r.runsTo).toBe("2029-11-11");
    // Independent check (semiannual Treasury discounting of 35 monthly coupons + the balloon): $1,311,113.
    expect(Math.abs(r.premium! - 1_311_113)).toBeLessThan(2_000);
    expect(r.fees).toBe(150_000);
    expect(r.net).toBe(r.premium! + 150_000);
    expect(r.cashToRetire).toBe(24_000_000 + r.net!);
    expect(r.assumptions.join(" ")).toMatch(/No open date on file/);
  });
  it("an open date 3 months early shortens the run and lowers the cost (≈ $1.22M)", () => {
    const L = lakeland({ terms: resolvePrepayTerms({ prepayOpenDate: "2029-08-11" }, LAKELAND_TEXT, { ...ctx, securitizationDate: "2024-12-05" }, "x", false) });
    const r = computePayoff(L, rates(), "2026-12-11");
    expect(r.runsTo).toBe("2029-08-11");
    expect(Math.abs(r.premium! - 1_217_211)).toBeLessThan(2_000);
  });
  it("rates up 25 bp → cheaper; your quote replaces the default fees", () => {
    const r = computePayoff(lakeland({ fees: 90_000 }, "2024-12-05"), rates(), "2026-12-11");
    expect(r.fees).toBe(90_000);
    expect(r.sensitivity!.up25!).toBeLessThan(r.net!);
    expect(r.sensitivity!.down25!).toBeGreaterThan(r.net!);
  });
  it("Treasuries above the note → the bonds cost LESS than the balance: a gain, not a cost", () => {
    const r = computePayoff(lakeland({}, "2024-12-05"), rates(3), "2026-12-11");
    expect(r.premium!).toBeLessThan(0);
  });
  it("on or after maturity: par", () => {
    expect(computePayoff(lakeland(), rates(), "2029-11-11").status).toBe("matured");
  });
});

describe("other prepayment structures", () => {
  const base = (text: string, over: Partial<LoanInput> = {}, data: Record<string, unknown> = {}): LoanInput => lakeland({
    terms: resolvePrepayTerms(data, text, ctx, "text", false), ...over });
  it("step-down 5/4/3/2/1 by loan year", () => {
    const L = base("Prepayment premium of 5/4/3/2/1% of the amount prepaid");
    expect(L.terms.kind).toBe("stepdown");
    const r = computePayoff(L, rates(), "2026-12-11");           // loan year 3
    expect(r.premium).toBe(720_000);
  });
  it("greater of 1% and yield maintenance — never below the floor, never negative", () => {
    const L = base("Prepayable subject to the greater of (i) 1% and (ii) yield maintenance, Treasury flat");
    expect(L.terms.kind).toBe("yield_maintenance");
    expect(L.terms.floorPct).toBe(1);
    const r = computePayoff(L, rates(), "2026-12-11");
    expect(r.premium!).toBeGreaterThan(240_000);
    expect(computePayoff(L, rates(3), "2026-12-11").premium).toBe(240_000);    // YM ≈ 0 → the 1% floor
  });
  it("open at par in the last 3 months", () => {
    const L = base("Yield maintenance, open at par during the last three (3) months of the term");
    expect(L.terms.openDate).toBe("2029-08-11");
    expect(computePayoff(L, rates(), "2029-09-01").status).toBe("open");
    expect(computePayoff(L, rates(), "2029-09-01").net).toBe(0);
  });
  it("flat premium and exit fee", () => {
    const L = base("1% prepayment premium; exit fee of 0.50%");
    const r = computePayoff(L, rates(), "2026-12-11");
    expect(r.premium).toBe(240_000);
    expect(r.fees).toBe(120_000);
  });
  it("lockout in months from closing", () => {
    expect(parsePrepayText("24-month lockout, then yield maintenance", ctx).lockoutEnd).toBe("2026-10-18");
  });
  it("no terms on a fixed loan → asks for them; a floating loan is assumed open (labelled)", () => {
    expect(computePayoff(base(""), rates(), "2026-12-11").status).toBe("needs");
    const f = resolvePrepayTerms({}, null, ctx, "text", true);
    expect(f.kind).toBe("open");
    expect(f.source).toMatch(/assumed/);
  });
  it("entered terms beat the wording", () => {
    const t = resolvePrepayTerms({ prepayType: "yield maintenance", prepayFloorPct: 1 }, LAKELAND_TEXT, ctx, "text", false);
    expect(t.kind).toBe("yield_maintenance");
    expect(t.source).toBe("entered terms");
    expect(t.lockoutEnd).toBe("2027-11-11");
  });
  it("a pay-fixed swap in the money is netted as a gain", () => {
    const L = base("open at par", { swaps: [{ label: "Wells", notional: 24_000_000, fixedRatePct: 3.0, maturity: "2029-11-11", index: "Daily Simple SOFR", payFixed: true }] });
    const r = computePayoff(L, rates(), "2026-12-11");
    expect(r.swap).toBeGreaterThan(0);
    expect(r.net).toBe(-r.swap);
  });
});

describe("schedule", () => {
  it("amortizing balance rolls down; IO stays flat", () => {
    const io = schedule(lakeland(), "2026-12-11", "2029-11-11")!;
    expect(io.balanceAtPayoff).toBe(24_000_000);
    expect(io.flows).toHaveLength(35);
    const am = schedule(lakeland({ ioFullTerm: false, amortYears: 30, balance: null }), "2026-12-11", "2029-11-11")!;
    expect(am.balanceAtPayoff).toBeLessThan(24_000_000);
    expect(am.balanceAtPayoff).toBeGreaterThan(23_000_000);
  });
  it("payment dates clamp to month end and never include the start date", () => {
    expect(paymentDates("2026-01-31", "2026-04-30", 31)).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(paymentDates("2026-12-11", "2027-02-11", 11)).toEqual(["2027-01-11", "2027-02-11"]);
  });
  it("reads every Treasury tenor", () => { expect(treasuryCurve(rates())).toHaveLength(10); });
});
