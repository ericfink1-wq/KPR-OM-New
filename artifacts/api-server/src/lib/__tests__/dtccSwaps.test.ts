import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { extractSofrSwaps, buildCurve, parseCsv, parseManualCurve } from "../dtccSwaps";

// The REAL DTCC 10/15 + 10/16 files (SOFR rows, the columns we read), against Chatham's
// logged-in closes for both days (10/16 was a ~3 bp rally). Target: within 1 bp at 2Y–10Y.
const csv = gunzipSync(readFileSync(resolve(__dirname, "fixtures/dtcc-sofr-2026-10-15.csv.gz"))).toString("utf8");
const csv16 = gunzipSync(readFileSync(resolve(__dirname, "fixtures/dtcc-sofr-2026-10-16.csv.gz"))).toString("utf8");
const CHATHAM: Record<string, Record<number, number>> = {
  "2026-10-15": { 1: 4.495, 2: 4.62, 3: 4.638, 5: 4.628, 7: 4.648, 10: 4.708, 30: 4.797 },
  "2026-10-16": { 1: 4.456, 2: 4.577, 3: 4.600, 5: 4.598, 7: 4.625, 10: 4.694, 15: 4.820, 30: 4.798 },
};

describe("DTCC SOFR swap curve", () => {
  const curve = buildCurve(extractSofrSwaps(csv, "ois"), { curveDate: "2026-10-15" });
  for (const [date, text] of [["2026-10-15", csv], ["2026-10-16", csv16]] as const) {
    it(`${date}: within 1 bp of Chatham's close at every tenor Chatham gave (3:00–5:00pm ET, executed that day)`, () => {
      const c = buildCurve(extractSofrSwaps(text, "ois"), { curveDate: date });
      for (const [t, mark] of Object.entries(CHATHAM[date])) {
        const p = c.points.find(x => x.tenor === Number(t))!;
        expect(p, `tenor ${t}`).toBeTruthy();
        // Thin tenors (1Y, 15Y on 10/16) use day median + neighbours' move into the close.
        const tol = 0.01;
        expect(Math.abs(p.rate - mark), `${date} ${t}Y: ${p.rate} vs Chatham ${mark}`).toBeLessThan(tol);
        expect(p.p25).toBeLessThanOrEqual(p.rate); expect(p.p75).toBeGreaterThanOrEqual(p.rate);
        expect(["close-window", "day+drift"]).toContain(p.method);
      }
    });
  }
  it("a file dated D never lets trades EXECUTED on another day into D's curve (the 10/16 miss)", () => {
    const ms = (iso: string) => Date.parse(iso);
    const mk = (iso: string, rate: number) => ({ tenor: 5, rate, execMs: ms(iso), notional: 10e6 });
    // Prior day's 3–5pm ET prints at 4.63; the day's own close at 4.60.
    const trades = [...Array(8)].map((_, i) => mk(`2026-10-15T20:${10 + i}:00Z`, 4.63)).concat([...Array(6)].map((_, i) => mk(`2026-10-16T20:${10 + i}:00Z`, 4.60)));
    expect(buildCurve(trades, { curveDate: "2026-10-16" }).points[0].rate).toBe(4.6);
    expect(buildCurve(trades).points[0].rate).toBe(4.63);   // without the date: the bug
  });
  it("drops exact duplicate reports of one trade", () => {
    const t = { tenor: 5, rate: 4.62, execMs: Date.parse("2026-10-16T20:00:00Z"), notional: 300e6 };
    const c = buildCurve([t, t, t, ...[...Array(5)].map((_, i) => ({ ...t, rate: 4.6, execMs: t.execMs + (i + 1) * 60000 }))], { curveDate: "2026-10-16" });
    expect(c.points[0].n).toBe(6);
  });
  it("keeps Term SOFR swaps separate from the OIS curve", () => {
    const term = extractSofrSwaps(csv, "term"), ois = extractSofrSwaps(csv, "ois");
    expect(term.length).toBeGreaterThan(0);
    expect(ois.length).toBeGreaterThan(500);
  });
  it("parses quoted CSV fields with commas", () => {
    expect(parseCsv('a,b\n"1,000","x ""y"""\n').rows).toEqual([["1,000", 'x "y"']]);
  });
  it("reads a pasted curve", () => {
    expect(parseManualCurve("1Y 4.495%  2Y 4.62 5-Year: 4.628\n10 yr 4.708")).toEqual([
      { tenor: 1, rate: 4.495 }, { tenor: 2, rate: 4.62 }, { tenor: 5, rate: 4.628 }, { tenor: 10, rate: 4.708 }]);
  });
});

import { filesToBackfill } from "../rateCurves";
describe("which DTCC files to load", () => {
  const e = (d: string, rowCount: number) => ({ fileName: `CFTC_CUMULATIVE_RATES_${d.replace(/-/g, "_")}.zip`, fullFilePath: "", dissemDTM: "", sliceId: 0, rowCount });
  it("takes the newest full day plus each month's last full trading day, skipping thin weekend files", () => {
    const idx = [e("2026-10-17", 40), e("2026-10-16", 20724), e("2026-10-15", 25611), e("2026-02-28", 120), e("2026-02-27", 21000), e("2026-01-31", 300), e("2026-01-30", 19000)];
    expect(filesToBackfill(idx, new Set()).map(x => x.fileName)).toEqual([
      "CFTC_CUMULATIVE_RATES_2026_10_16.zip", "CFTC_CUMULATIVE_RATES_2026_02_27.zip", "CFTC_CUMULATIVE_RATES_2026_01_30.zip"]);
  });
  it("skips what's already stored", () => {
    const idx = [e("2026-10-16", 20724), e("2026-09-30", 21000)];
    expect(filesToBackfill(idx, new Set(["2026-10-16|ois"])).map(x => x.fileName)).toEqual(["CFTC_CUMULATIVE_RATES_2026_09_30.zip"]);
  });
});
