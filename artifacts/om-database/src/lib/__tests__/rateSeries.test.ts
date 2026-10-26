import { describe, it, expect } from "vitest";
import { changeStats, valueOn, toChartRows, inRange, seriesKeyForRow, rangeStart, compareStart, fmtBp, type SeriesTuple } from "../rateSeries";

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
  it("no comparable print within 7 days → null, never a guess", () => {
    expect(valueOn(S, "2026-09-19")).toBeNull();                 // last print before is 1/2/26
    expect(valueOn(S, "2026-10-12")).toBeNull();                 // 10/12 is a no-print day; 9/25 is 17 days back
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
