import { describe, it, expect } from "vitest";
import { parseChathamMark, chathamBasis, defaultTermBasisBp, annualToMonthly, deriveTermCurve } from "../dtccSwaps";

// Chatham 10/16/26 close (logged in): annual/annual column + 1M Term 5Y as relayed.
const OIS_1016: Record<number, number> = { 1: 4.456, 2: 4.577, 3: 4.600, 5: 4.598, 7: 4.625, 10: 4.694, 30: 4.798 };

describe("Chatham mark paste", () => {
  it("two separate tables with headers, plus the 1M Term SOFR spot and the date", () => {
    const text = `U.S. Market Rates  As of 10/16/2026
1-Month Term SOFR 3.97183%
1M Term SOFR Swap Rates
Tenor Rate Change
1 Year 4.367% -0.035
2 Year 4.483% -0.040
5 Year 4.501% -0.027
SOFR Swap Rates (annual/annual)
Tenor Rate Change
1 Year 4.456% -0.039
2 Year 4.577% -0.043
5 Year 4.598% -0.030`;
    const m = parseChathamMark(text);
    expect(m.date).toBe("2026-10-16");
    expect(m.termSofr1m).toBe(3.97183);
    expect(m.term).toEqual([{ tenor: 1, rate: 4.367 }, { tenor: 2, rate: 4.483 }, { tenor: 5, rate: 4.501 }]);
    expect(m.ois).toEqual([{ tenor: 1, rate: 4.456 }, { tenor: 2, rate: 4.577 }, { tenor: 5, rate: 4.598 }]);
    expect(m.warnings).toEqual([]);
  });

  it("one combined table — the column order comes from the header", () => {
    const m = parseChathamMark("October 16, 2026\nTenor  SOFR (annual/annual)  1M Term SOFR\n5 Years  4.598%  4.501%\n10 Years 4.694% 4.588%");
    expect(m.date).toBe("2026-10-16");
    expect(m.ois).toEqual([{ tenor: 5, rate: 4.598 }, { tenor: 10, rate: 4.694 }]);
    expect(m.term).toEqual([{ tenor: 5, rate: 4.501 }, { tenor: 10, rate: 4.588 }]);
  });

  it("flags a pasted pair whose columns look swapped/mixed rather than saving it quietly", () => {
    const m = parseChathamMark("1M Term SOFR Swap\n5 Year 4.700%\nSOFR annual/annual\n5 Year 4.598%");
    expect(m.warnings.some(w => w.includes("5Y"))).toBe(true);
  });

  it("a mark's own columns give the basis, which then drives the derived curve", () => {
    const b = chathamBasis({ ois: [{ tenor: 5, rate: 4.598 }], term: [{ tenor: 5, rate: 4.501 }] });
    expect(b[0][0]).toBe(5);
    expect(b[0][1]).toBeCloseTo((4.501 - annualToMonthly(4.598)) * 100, 0);
    const t = deriveTermCurve([{ tenor: 5, rate: 4.598 }], [], b);
    expect(t[0].rate).toBeCloseTo(4.501, 3);
    expect(t[0].basisSource).toBe("chatham");
  });
});

describe("tenor-specific default basis (Chatham 10/15 + 10/16 average)", () => {
  it("uses the measured points and interpolates between them", () => {
    expect(defaultTermBasisBp(1)).toBe(-1.2);
    expect(defaultTermBasisBp(5)).toBe(-0.35);
    expect(Math.abs(defaultTermBasisBp(4) - -0.425)).toBeLessThan(0.006);
    expect(defaultTermBasisBp(30)).toBe(-0.2);
  });
  it("with the 10/16 Chatham OIS, the derived 5Y Term lands on Chatham's 4.501", () => {
    const t = deriveTermCurve(Object.entries(OIS_1016).map(([k, v]) => ({ tenor: Number(k), rate: v })), []);
    expect(Math.abs(t.find(p => p.tenor === 5)!.rate - 4.501) * 100).toBeLessThan(0.5);
  });
});
