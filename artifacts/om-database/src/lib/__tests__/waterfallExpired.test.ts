import { describe, it, expect } from "vitest";
import { collapsePastYears, EXPIRED_LABEL } from "../../components/PortfolioAnalytics";

describe("lease waterfall: past years collapse into one Expired bucket", () => {
  const b = (year: string, pct: number, rent: number, n: number) => ({ year, pct, annualRent: rent, tenantCount: n });
  it("sums every year before the current one", () => {
    const out = collapsePastYears([b("2020", 1, 100, 1), b("2025", 2.5, 250, 3), b("2026", 10, 1000, 9), b("Unknown", 4, 400, 2)], 2026);
    expect(out.map(d => d.year)).toEqual([EXPIRED_LABEL, "2026", "Unknown"]);
    expect(out[0]).toMatchObject({ pct: 3.5, annualRent: 350, tenantCount: 4 });
  });
  it("leaves data with no past years alone", () => {
    const d = [b("2026", 5, 1, 1)];
    expect(collapsePastYears(d, 2026)).toBe(d);
  });
});
