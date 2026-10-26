import { describe, it, expect } from "vitest";
import { parseFredCsv, parseNyFed, mergePoints } from "../rateHistory";

describe("index history parsing (FRED + NY Fed)", () => {
  it("FRED '.' (no print) stays null — never dropped, never filled", () => {
    expect(parseFredCsv("observation_date,SOFR\n2026-10-02,3.88\n2026-10-12,.\n2026-10-13,3.91\n")).toEqual([["2026-10-02", 3.88], ["2026-10-12", null], ["2026-10-13", 3.91]]);
  });
  it("NY Fed rows; a later source fills a date but a null never overwrites a real print", () => {
    const fed = parseNyFed({ refRates: [{ effectiveDate: "2026-10-23", type: "SOFR", percentRate: 3.92 }, { effectiveDate: "2026-10-22", type: "SOFR", percentRate: 3.9 }] });
    expect(fed).toEqual([["2026-10-22", 3.9], ["2026-10-23", 3.92]]);
    expect(mergePoints([["2026-10-22", 3.9]], [["2026-10-22", null], ["2026-10-23", 3.92]])).toEqual([["2026-10-22", 3.9], ["2026-10-23", 3.92]]);
  });
});
