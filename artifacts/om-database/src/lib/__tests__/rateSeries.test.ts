import { describe, it, expect } from "vitest";
import { changeStats, valueOn, toChartRows, inRange, seriesKeyForRow, rangeStart, compareStart, fmtBp, businessDaysApart, type SeriesTuple } from "../rateSeries";

// Prints with a published holiday "no print" (null) and two long holes.
const S: SeriesTuple[] = [
  ["2025-10-22", 4.30, 0, null], ["2025-12-31", 3.95, 0, null], ["2026-01-02", 3.90, 0, null],
  ["2026-09-21", 3.60, 0, null], ["2026-09-25", 3.62, 0, null], ["2026-10-12", null, 0, null], ["2026-10-13", 3.85, 0, null],
  ["2026-10-16", 3.88, 1, 4], ["2026-10-22", 3.90, 0, null], ["2026-10-23", 3.92, 0, null],
];

describe("change stats (bp)", () => {
  const c = changeStats(S);
  it("1-day vs the previous real print; 1W / 1M / YTD / 1Y vs the print in force on that date", () => {
    expect(c.latest).toEqual({ date: "2026-10-23", v: 3.92 });
    expect([c.d1, c.w1, c.m1, c.ytd, c.y1]).toEqual([2, 4, 32, -3, -38]);
  });
  it("52-week high / low over the last year only (the 10/22/25 print is just outside)", () => {
    expect(c.hi52).toEqual({ date: "2025-12-31", v: 3.95 });
    expect(c.lo52).toEqual({ date: "2026-09-21", v: 3.60 });
    expect(c.partialYear).toBe(false);
  });
  it("no good print within 3 business days → null, never a guess", () => {
    expect(valueOn(S, "2026-09-10")).toBeNull();                 // nearest are 1/2/26 and 9/21/26 — both too far
    expect(valueOn(S, "2026-10-12")).toEqual({ date: "2026-10-13", v: 3.85 });   // 10/12 is a no-print day → nearest good one
    const short: SeriesTuple[] = S.slice(-3);
    const s = changeStats(short);
    expect([s.m1, s.y1, s.ytd]).toEqual([null, null, null]);
    expect(s.partialYear).toBe(true);
    expect(s.firstDate).toBe("2026-10-16");
  });
  it("formats bp", () => { expect([fmtBp(2), fmtBp(-38), fmtBp(0), fmtBp(null)]).toEqual(["+2.0 bp", "−38 bp", "0.0 bp", "—"]); });
});

describe("gaps stay gaps", () => {
  const rows = toChartRows(S);
  it("a published no-print day is null; a hole > 5 days gets a null break row; nothing is filled in", () => {
    expect(rows.find(r => r.date === "2026-10-12")!.v).toBeNull();
    expect(rows.filter(r => r.v == null).map(r => r.date)).toEqual(["2025-10-23", "2026-01-03", "2026-09-26", "2026-10-12", "2026-10-17"]);   // 10/16 → 10/22 is a 6-day hole
    expect(rows.filter(r => r.v != null)).toHaveLength(9);
    expect(rows.find(r => r.date === "2026-10-16")).toMatchObject({ thin: true, n: 4 });
  });
  it("ranges count back from the latest print", () => {
    expect(rangeStart("2026-10-23", "1W")).toBe("2026-10-16");
    expect(rangeStart("2026-10-23", "3M")).toBe("2026-07-23");
    expect(rangeStart("2026-10-23", "Max")).toBeNull();
    expect(inRange(rows, "1W").map(r => r.date)).toEqual(["2026-10-16", "2026-10-17", "2026-10-22", "2026-10-23"]);
    expect(compareStart([S, [["2026-10-20", 1, 0, null]]], "1M")).toBe("2026-09-23");
  });
});

describe("which history a panel row charts", () => {
  it("maps every row type; estimates and unlisted tenors get none", () => {
    expect([
      seriesKeyForRow("sofr", "SOFR (overnight)"), seriesKeyForRow("sofr", "30-Day Average SOFR"), seriesKeyForRow("sofr", "SOFR Term – 1 Month"),
      seriesKeyForRow("term", "SOFR Swap – 1M Term – 5 Year"), seriesKeyForRow("ois", "SOFR Swap – 10 Year"), seriesKeyForRow("ois", "SOFR Swap – 3 Year (est.)"),
      seriesKeyForRow("treasury", "30-Yr"), seriesKeyForRow("treasury", "1-Mo"),
    ]).toEqual(["SOFR", "SOFR30", "termsofr1m", "term:5", "ois:10", null, "DGS30", null]);
  });
});

describe("nearest good point within 3 business days (Eric, 10/26/26)", () => {
  it("counts business days (weekends don't count)", () => {
    expect([businessDaysApart("2026-10-16", "2026-10-19"), businessDaysApart("2026-10-19", "2026-10-16"), businessDaysApart("2026-10-16", "2026-10-16"), businessDaysApart("2026-10-14", "2026-10-21")]).toEqual([1, 1, 0, 5]);
  });
  it("a simply-missing day uses the nearest print either side; ties go to the earlier one", () => {
    const P: SeriesTuple[] = [["2026-10-14", 4.0, 0, null], ["2026-10-16", 4.2, 0, null], ["2026-10-23", 4.5, 0, null]];
    expect(valueOn(P, "2026-10-15")).toEqual({ date: "2026-10-14", v: 4.0 });   // 1 bday each side → earlier
    expect(valueOn(P, "2026-10-21")).toEqual({ date: "2026-10-23", v: 4.5 });   // 2 bdays after beats 3 before
    expect(valueOn(P, "2026-10-28")).toEqual({ date: "2026-10-23", v: 4.5 });   // 3 bdays back
    expect(valueOn(P, "2026-10-29")).toBeNull();                                 // 4 bdays — too far
    expect(valueOn(P, "2026-10-21", "onOrBefore")).toEqual({ date: "2026-10-16", v: 4.2 });   // year-end mode looks back only (10/23 is nearer)
    expect(valueOn(P, "2026-10-13", "onOrBefore")).toBeNull();
  });
  it("the 10/19/26 bad print can't drive the 1-week change, the high/low or the 1-day change", () => {
    const P: SeriesTuple[] = [
      ["2026-10-14", 4.718, 0, 19, null], ["2026-10-15", 4.63, 0, 14, null], ["2026-10-16", 4.603, 0, 11, null],
      ["2026-10-19", 4.068, 1, 58, "Thin close (58 trades) — 57 bp below the neighbouring days"],
      ["2026-10-20", 4.652, 0, 10, null], ["2026-10-21", 4.671, 0, 13, null], ["2026-10-22", 4.492, 0, 15, null], ["2026-10-23", 4.525, 0, 8, null],
      ["2026-10-26", 4.531, 0, 5, null],
    ];
    const c = changeStats(P);
    expect(c.w1).toBe(-7.2);                        // 4.531 vs 10/16 (4.603): 10/19 is bad, so the nearest good print (tie with 10/20 → the earlier)
    expect(c.d1).toBe(0.6);                         // vs 10/23 — never vs a flagged print
    expect(c.lo52).toEqual({ date: "2026-10-22", v: 4.492 });
    expect(c.excluded).toBe(1);
    expect(toChartRows(P).find(r => r.date === "2026-10-19")!.flag).toMatch(/Thin close/);
  });
});
