import { describe, it, expect } from "vitest";
import { snapshotPoints, isThin, oisByDate, swapSeries, termSofrSeries, pickCurveDate, overlayTargets, curveOn, screenOutliers, businessDayTest, type StoredRow } from "../swapHistory";
import { dailyFilesToBackfill, coverageOf } from "../rateCurves";

const eod = (d: string, pts: Array<[number, number, string, number]>): StoredRow => ({ curve_date: d, kind: "ois", points: pts.map(([tenor, rate, method, n]) => ({ tenor, rate, method, n, m: 3 })) });

describe("daily snapshot of what the panel showed", () => {
  it("one point per series + tenor with trade count and the thin-close flag", () => {
    const ois = { kind: "dtcc-eod", asOf: "2026-10-23T21:00:00Z", curveDate: "2026-10-23", source: "", enteredBy: null, trades: 9, tradesUsed: 9,
      points: [{ tenor: 1, rate: 3.71, n: 3, method: "day+drift" }, { tenor: 5, rate: 3.62, n: 41, method: "close-window" }] } as never;
    const term = { points: [{ tenor: 1, rate: 3.69 }, { tenor: 5, rate: 3.6 }] } as never;
    expect(snapshotPoints(ois, term)).toEqual([
      { s: "ois", t: 1, r: 3.71, n: 3, thin: true }, { s: "ois", t: 5, r: 3.62, n: 41, thin: false },
      { s: "term", t: 1, r: 3.69, n: null, thin: true }, { s: "term", t: 5, r: 3.6, n: null, thin: false },
    ]);
    expect([isThin("close-window"), isThin("latest-2h"), isThin("day"), isThin(undefined)]).toEqual([false, true, true, false]);
  });
  it("a pasted / Chatham curve is never flagged thin (no trade method)", () => {
    const ois = { kind: "chatham", curveDate: "2026-10-23", points: [{ tenor: 5, rate: 3.6 }] } as never;
    expect(snapshotPoints(ois, null)[0].thin).toBe(false);
  });
});

describe("series from stored rows", () => {
  const rows: StoredRow[] = [
    eod("2026-10-20", [[5, 3.6, "close-window", 40], [10, 3.9, "close-window", 30]]),
    eod("2026-10-21", [[5, 3.62, "day", 4]]),                        // thin, and no 10Y that day
    { curve_date: "2026-10-22", kind: "panel-snapshot", points: [{ s: "ois", t: 5, r: 3.64, n: 12, thin: false }] },
    eod("2026-10-23", [[5, 3.65, "close-window", 50]]),
    { curve_date: "2026-10-23", kind: "chatham", points: { ois: [{ tenor: 5, rate: 3.66 }, { tenor: 10, rate: 3.95 }], term: [{ tenor: 5, rate: 3.633 }], termSofr1m: 3.9518 } },
  ];
  it("per date: Chatham mark > DTCC close > snapshot; a missing tenor is simply absent (gap, not filled)", () => {
    expect(swapSeries(rows, "ois", 5)).toEqual([["2026-10-20", 3.6, 0, 40, null], ["2026-10-21", 3.62, 1, 4, null], ["2026-10-22", 3.64, 0, 12, null], ["2026-10-23", 3.66, 0, null, null]]);
    expect(swapSeries(rows, "ois", 10).map(p => p[0])).toEqual(["2026-10-20", "2026-10-23"]);
    expect(oisByDate(rows).get("2026-10-23")!.src).toBe("chatham");
  });
  it("Term is derived per day from that day's OIS; a Chatham mark's own Term column wins on its date", () => {
    const t = swapSeries(rows, "term", 5);
    expect(t.map(p => p[0])).toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(t[3][1]).toBe(3.633);
    expect(t[0][1]).toBeLessThan(3.6);                  // monthly compounding + a negative basis sits below OIS
    expect(t[1][2]).toBe(1);                            // thin close carries over
  });
  it("1M Term SOFR spot history = Chatham marks only", () => {
    expect(termSofrSeries(rows)).toEqual([["2026-10-23", 3.9518, 0, null, null]]);
  });
  it("curveOn gives that day's OIS and Term curves", () => {
    const c = curveOn(rows, "2026-10-20")!;
    expect(c.ois.map(p => p.tenor)).toEqual([5, 10]);
    expect(c.term).toHaveLength(2);
    expect(curveOn(rows, "2026-01-01")).toBeNull();
  });
});

describe("curve overlay date picking", () => {
  const dates = ["2025-10-24", "2026-09-25", "2026-10-16", "2026-10-23"];
  it("latest stored day on or before the target, never more than 7 days earlier", () => {
    expect(pickCurveDate(dates, "2026-10-16")).toBe("2026-10-16");
    expect(pickCurveDate(dates, "2026-10-18")).toBe("2026-10-16");      // Sunday → Friday
    expect(pickCurveDate(dates, "2026-10-12")).toBeNull();               // nothing within a week
    expect(pickCurveDate(dates, "2025-10-01")).toBeNull();               // before history starts
  });
  it("1W / 1M / 1Y targets from the curve date (month-end safe)", () => {
    expect(overlayTargets("2026-10-23").map(t => t.target)).toEqual(["2026-10-16", "2026-09-23", "2025-10-23"]);
    expect(overlayTargets("2026-03-31")[1].target).toBe("2026-02-28");
  });
});

describe("daily DTCC backfill", () => {
  const f = (d: string, rowCount: number) => ({ fileName: `CFTC_CUMULATIVE_RATES_${d.replace(/-/g, "_")}.zip`, fullFilePath: "x", dissemDTM: "", sliceId: 1, rowCount });
  it("every full trading day in the window not already stored, newest first; weekend stubs skipped", () => {
    const cum = [f("2026-10-23", 21000), f("2026-10-24", 130), f("2026-10-22", 20000), f("2026-10-21", 19000), f("2025-09-01", 20000)];
    const got = dailyFilesToBackfill(cum, new Set(["2026-10-22|ois"]), 370, Date.parse("2026-10-26T12:00:00Z")).map(e => e.fileName);
    expect(got).toEqual(["CFTC_CUMULATIVE_RATES_2026_10_23.zip", "CFTC_CUMULATIVE_RATES_2026_10_21.zip"]);
  });
});

// REAL DTCC closes (rate / trades in the close / method), 10/14–10/23/26, as the backfill read them.
const REAL: Array<[string, Array<[number, number, string, number]>]> = [
  ["2026-10-14", [[3, 4.711, "close-window", 9], [5, 4.718, "close-window", 19], [7, 4.735, "close-window", 8]]],
  ["2026-10-15", [[3, 4.62, "close-window", 10], [5, 4.63, "close-window", 14], [7, 4.65, "close-window", 9]]],
  ["2026-10-16", [[3, 4.602, "close-window", 11], [5, 4.603, "close-window", 11], [7, 4.629, "close-window", 7]]],
  ["2026-10-19", [[3, 4.65, "close-window", 10], [5, 4.068, "day+drift", 58], [7, 4.686, "close-window", 6]]],
  ["2026-10-20", [[3, 4.661, "close-window", 11], [5, 4.652, "close-window", 10], [7, 4.675, "day", 27]]],
  ["2026-10-21", [[3, 4.684, "close-window", 8], [5, 4.671, "close-window", 13], [7, 4.681, "day", 25]]],
  ["2026-10-22", [[3, 4.508, "close-window", 9], [5, 4.492, "close-window", 15], [7, 4.52, "close-window", 8]]],
  ["2026-10-23", [[3, 4.55, "close-window", 8], [5, 4.525, "close-window", 8], [7, 4.56, "close-window", 7]]],
];
const realRows = REAL.map(([d, pts]) => eod(d, pts));

describe("outlier screen", () => {
  const s = swapSeries(realRows, "ois", 5);
  it("flags the 10/19/26 5Y (4.068% from 58 identical all-day prints; 3Y 4.650, 7Y 4.686) with the reason", () => {
    const bad = s.find(p => p[0] === "2026-10-19")!;
    expect(bad[4]).toMatch(/^Thin close \(58 trades.*bp below the neighbouring days and .*bp below the adjacent tenors/);
    expect(s.filter(p => p[4]).map(p => p[0])).toEqual(["2026-10-19"]);
  });
  it("a real market move is NOT flagged — 10/22 fell 18 bp with every tenor moving together", () => {
    expect(s.find(p => p[0] === "2026-10-22")![4]).toBeNull();
    expect(swapSeries(realRows, "ois", 3).every(p => !p[4])).toBe(true);
  });
  it("the Term series carries the flag (it is derived from that day's OIS)", () => {
    expect(swapSeries(realRows, "term", 5).find(p => p[0] === "2026-10-19")![4]).toMatch(/Thin close/);
  });
  it("thin but in line → kept; a full close far off both references → flagged as a spike; thin and only 10 bp off → kept", () => {
    const day = (d: string, r5: number, method = "close-window") => ({ date: d, points: new Map([[3, { rate: 4.6, n: 10, thin: false }], [5, { rate: r5, n: 10, thin: method !== "close-window" }], [7, { rate: 4.62, n: 10, thin: false }]]) });
    const base = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-16", "2026-10-19", "2026-10-20"].map(d => day(d, 4.61));
    expect(screenOutliers([...base, day("2026-10-15", 4.65, "day")]).size).toBe(0);          // thin, 4 bp off
    expect(screenOutliers([...base, day("2026-10-15", 4.71, "day")]).size).toBe(0);          // thin, 10 bp off
    expect(screenOutliers([...base, day("2026-10-15", 4.80, "day")]).get("2026-10-15|5")).toMatch(/^Thin close/);   // thin, 19 bp off
    expect(screenOutliers([...base, day("2026-10-15", 4.80)]).size).toBe(0);                 // full close, 19 bp — could be real
    expect(screenOutliers([...base, day("2026-10-15", 4.95)]).get("2026-10-15|5")).toMatch(/^Isolated spike/);       // full close, 34 bp off both
  });
});

describe("coverage", () => {
  it("counts every full trading day DTCC still publishes, filled vs missing", () => {
    const f = (d: string, rowCount: number) => ({ fileName: `CFTC_CUMULATIVE_RATES_${d.replace(/-/g, "_")}.zip`, fullFilePath: "x", dissemDTM: "", sliceId: 1, rowCount });
    const c = coverageOf([f("2026-10-22", 20000), f("2026-10-23", 20000), f("2026-10-24", 100), f("2026-10-21", 20000)], new Set(["2026-10-22|ois", "2026-10-23|ois"]), 370, Date.parse("2026-10-26T12:00:00Z"));
    expect(c).toMatchObject({ firstDate: "2026-10-22", lastDate: "2026-10-23", daysFilled: 2, daysAvailable: 3, daysMissing: 1, missing: ["2026-10-21"] });
  });
});

describe("US business days = the days the NY Fed published SOFR", () => {
  const isBd = businessDayTest(["2026-01-16", "2026-01-20", "2026-10-23"]);
  it("a holiday file (MLK Day 1/19/26: one 5Y trade at 1.68%) is not a US close — left out of the series", () => {
    expect([isBd("2026-01-19"), isBd("2026-01-20"), isBd("2026-10-24"), isBd("2026-10-26")]).toEqual([false, true, false, true]);   // 10/26: after the last print, a weekday
    const rows = [eod("2026-01-16", [[5, 3.57, "close-window", 30]]), eod("2026-01-19", [[5, 1.68, "day", 1]]), eod("2026-01-20", [[5, 3.58, "close-window", 30]])];
    expect(swapSeries(rows, "ois", 5, isBd).map(p => p[0])).toEqual(["2026-01-16", "2026-01-20"]);
  });
  it("holiday and weekend files are never downloaded or counted as missing", () => {
    const f = (d: string) => ({ fileName: `CFTC_CUMULATIVE_RATES_${d.replace(/-/g, "_")}.zip`, fullFilePath: "x", dissemDTM: "", sliceId: 1, rowCount: 20000 });
    const cum = [f("2026-01-16"), f("2026-01-19"), f("2026-01-20"), f("2026-02-14")];
    expect(dailyFilesToBackfill(cum, new Set(), 370, Date.parse("2026-01-25T00:00:00Z"), isBd).map(e => e.fileName)).toEqual(["CFTC_CUMULATIVE_RATES_2026_01_20.zip", "CFTC_CUMULATIVE_RATES_2026_01_16.zip"]);
    expect(coverageOf(cum, new Set(["2026-01-16|ois"]), 370, Date.parse("2026-02-20T00:00:00Z"), isBd)).toMatchObject({ daysAvailable: 2, daysFilled: 1, missing: ["2026-01-20"] });
  });
});
