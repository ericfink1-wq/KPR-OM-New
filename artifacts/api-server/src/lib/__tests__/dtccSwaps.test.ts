import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { extractSofrSwaps, buildCurve, parseCsv, parseManualCurve } from "../dtccSwaps";

// The REAL DTCC 10/15/26 file (SOFR rows, the columns we read), against Chatham's
// published 10/15 close — the accuracy bar Chrome Claude measured in the browser.
const csv = gunzipSync(readFileSync(resolve(__dirname, "fixtures/dtcc-sofr-2026-10-15.csv.gz"))).toString("utf8");
const CHATHAM_1015: Record<number, number> = { 1: 4.495, 2: 4.62, 3: 4.638, 5: 4.628, 7: 4.648, 10: 4.708, 30: 4.797 };

describe("DTCC SOFR swap curve", () => {
  const curve = buildCurve(extractSofrSwaps(csv, "ois"));
  it("lands within 1.5 bp of Chatham's close at every tenor (filtered close-window median)", () => {
    for (const [t, c] of Object.entries(CHATHAM_1015)) {
      const p = curve.points.find(x => x.tenor === Number(t))!;
      expect(p, `tenor ${t}`).toBeTruthy();
      expect(Math.abs(p.rate - c), `tenor ${t}: ${p.rate} vs ${c}`).toBeLessThan(0.015);
      expect(p.method).toBe("close-window");
      expect(p.n).toBeGreaterThanOrEqual(5);
      expect(p.p25).toBeLessThanOrEqual(p.rate); expect(p.p75).toBeGreaterThanOrEqual(p.rate);
    }
  });
  it("10/16: off-market prints in the close window don't drag the 30Y (was 4.649 vs a 4.788 day median)", () => {
    const csv16 = gunzipSync(readFileSync(resolve(__dirname, "fixtures/dtcc-sofr-2026-10-16.csv.gz"))).toString("utf8");
    const c16 = buildCurve(extractSofrSwaps(csv16, "ois"));
    const DAY_1016: Record<number, number> = { 1: 4.477, 2: 4.606, 3: 4.62, 5: 4.63, 7: 4.649, 10: 4.713, 30: 4.788 };  // Chrome Claude's day medians
    for (const [t, m] of Object.entries(DAY_1016)) expect(Math.abs(c16.points.find(p => p.tenor === Number(t))!.rate - m), `tenor ${t}`).toBeLessThan(0.015);
    // Term SOFR swaps: anchored to the OIS curve, so the 7.5% loan-hedge prints never show.
    const term = buildCurve(extractSofrSwaps(csv16, "term"), { anchor: new Map(c16.points.map(p => [p.tenor, p.rate])), anchorTol: 0.5, minTrades: 5 });
    for (const p of term.points) expect(Math.abs(p.rate - c16.points.find(x => x.tenor === p.tenor)!.rate)).toBeLessThan(0.5);
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
