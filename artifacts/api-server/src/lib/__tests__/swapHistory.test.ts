import { describe, it, expect } from "vitest";
import { snapshotPoints, isThin, oisByDate, swapSeries, termSofrSeries, pickCurveDate, overlayTargets, curveOn, type StoredRow } from "../swapHistory";
import { dailyFilesToBackfill } from "../rateCurves";

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
    expect(swapSeries(rows, "ois", 5)).toEqual([["2026-10-20", 3.6, 0, 40], ["2026-10-21", 3.62, 1, 4], ["2026-10-22", 3.64, 0, 12], ["2026-10-23", 3.66, 0, null]]);
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
    expect(termSofrSeries(rows)).toEqual([["2026-10-23", 3.9518, 0, null]]);
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
