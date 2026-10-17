import { describe, it, expect } from "vitest";
import { parseTenYearSeries, monthEnds } from "../rates";

const entry = (d: string, v: string) => `<entry><content><m:properties><d:NEW_DATE m:type="Edm.DateTime">${d}T00:00:00</d:NEW_DATE><d:BC_10YEAR m:type="Edm.Double">${v}</d:BC_10YEAR></m:properties></content></entry>`;
describe("10-yr Treasury month-end series", () => {
  const xml = `<feed>${entry("2026-08-28", "4.20")}${entry("2026-08-31", "4.25")}${entry("2026-09-30", "4.10")}${entry("2026-10-15", "4.05")}${entry("2025-01-31", "4.50")}</feed>`;
  it("parses every entry", () => expect(parseTenYearSeries(xml)).toHaveLength(5));
  it("keeps the last trading day of each month, trailing 12 months", () => {
    const out = monthEnds(parseTenYearSeries(xml), 12, new Date("2026-10-17T12:00:00Z"));
    expect(out).toEqual([{ month: "2026-08", value: 4.25 }, { month: "2026-09", value: 4.1 }, { month: "2026-10", value: 4.05 }]);
  });
});
