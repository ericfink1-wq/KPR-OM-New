import { describe, it, expect } from "vitest";
import { annualToMonthly, termBasis, deriveTermCurve, businessDaysBetween, defaultTermBasisBp } from "../dtccSwaps";
import { basisSamples, termSourceLabel } from "../rateCurves";

describe("1M Term SOFR swap curve derived from OIS", () => {
  it("annual→monthly conversion matches Chatham's 1M Term column within ~1bp (10/15/26)", () => {
    expect(annualToMonthly(4.495)).toBeCloseTo(4.405, 3);
    expect(annualToMonthly(4.620)).toBeCloseTo(4.525, 3);
    const t = deriveTermCurve([{ tenor: 1, rate: 4.495 }, { tenor: 2, rate: 4.620 }], []);
    expect(Math.abs(t[0].rate - 4.391) * 100).toBeLessThan(1);   // 4.395 vs Chatham 4.391
    expect(Math.abs(t[1].rate - 4.517) * 100).toBeLessThan(1);   // 4.515 vs Chatham 4.517
    expect(t.every(p => p.basisBp === defaultTermBasisBp(p.tenor) && p.basisSource === "default")).toBe(true);
  });

  it("the 9/30 wrong-sign print (5Y ~+17bp above OIS) never moves the curve", () => {
    const oisRate = 4.62, termPrint = 4.80;
    const diff = (termPrint - annualToMonthly(oisRate)) * 100;   // ~+27bp vs converted OIS
    const b = termBasis([{ date: "2026-09-30", tenor: 5, diffBp: diff, n: 10 }], 5);
    expect(b).toMatchObject({ bp: defaultTermBasisBp(5), source: "default", prints: 0 });
  });

  it("thin prints (<5 in the window) keep the default", () => {
    expect(termBasis([{ date: "d", tenor: 5, diffBp: -3, n: 2 }, { date: "e", tenor: 5, diffBp: -2.5, n: 2 }], 5).source).toBe("default");
  });

  it("≥5 clean prints are used, as a median, clamped to ±5bp", () => {
    expect(termBasis([{ date: "d", tenor: 5, diffBp: -0.6, n: 4 }, { date: "e", tenor: 5, diffBp: -1.4, n: 3 }], 5)).toMatchObject({ bp: -0.6, source: "measured", prints: 7 });
    expect(termBasis([{ date: "d", tenor: 7, diffBp: 4.9, n: 6 }], 7).bp).toBe(4.9);
    expect(termBasis([{ date: "d", tenor: 7, diffBp: -5, n: 6 }], 7).bp).toBe(-5);
  });

  it("day-medians 5–10bp off converted OIS are contamination, not basis (the 9/30 3Y/5Y case)", () => {
    expect(termBasis([{ date: "2026-09-30", tenor: 3, diffBp: -7.5, n: 7 }], 3).source).toBe("default");
    expect(termBasis([{ date: "2026-09-30", tenor: 5, diffBp: 9.2, n: 10 }], 5).source).toBe("default");
  });

  it("covers every OIS tenor, carrying the inputs for the breakdown", () => {
    const ois = [1, 2, 3, 5, 7, 10, 15, 30].map(t => ({ tenor: t, rate: 4.5 + t / 100, n: 10, p25: 4.49 + t / 100, p75: 4.51 + t / 100 }));
    const t = deriveTermCurve(ois, []);
    expect(t.map(p => p.tenor)).toEqual([1, 2, 3, 5, 7, 10, 15, 30]);
    for (const p of t) { expect(p.rate).toBeLessThan(p.oisRate); expect(p.p25!).toBeLessThan(p.rate); expect(p.p75!).toBeGreaterThan(p.rate); }
  });

  it("basis samples: only days inside the trailing 20 business days, paired with that day's OIS", () => {
    const rows = [
      { curve_date: "2026-10-16", kind: "ois", points: [{ tenor: 5, rate: 4.626 }] },
      { curve_date: "2026-10-16", kind: "term", points: [{ tenor: 5, rate: annualToMonthly(4.626) - 0.008, n: 6, m: 2 }] },
      { curve_date: "2026-10-15", kind: "ois", points: [{ tenor: 5, rate: 4.628 }] },
      { curve_date: "2026-10-15", kind: "term", points: [{ tenor: 5, rate: annualToMonthly(4.628) + 0.03, n: 9 }] },     // old method (no m) — ignored
      { curve_date: "2026-09-10", kind: "ois", points: [{ tenor: 5, rate: 4.5 }] },
      { curve_date: "2026-09-10", kind: "term", points: [{ tenor: 5, rate: annualToMonthly(4.5) + 0.04, n: 9, m: 2 }] },   // >20 bdays old
      { curve_date: "2026-10-14", kind: "term", points: [{ tenor: 5, rate: 4.4, n: 9, m: 2 }] },                             // no OIS that day
    ];
    const s = basisSamples(rows, "2026-10-16");
    expect(s).toHaveLength(1);
    expect(s[0].diffBp).toBeCloseTo(-0.8, 6);
    expect(businessDaysBetween("2026-09-18", "2026-10-16")).toBe(20);
  });

  it("labels the source plainly", () => {
    const t = { derived: true as const, fromKind: "dtcc-eod" as const, asOf: "x", curveDate: "2026-10-16", source: "", basisWindowDays: 20,
      points: deriveTermCurve([{ tenor: 5, rate: 4.626 }], []) };
    expect(termSourceLabel(t)).toBe("Derived from DTCC SOFR OIS (2026-10-16), converted to monthly + Term basis by tenor (5Y −0.35bp)");
    expect(termSourceLabel(t, "2026-10-16")).toBe("Derived from DTCC SOFR OIS (2026-10-16), converted to monthly + Term basis by tenor from the Chatham mark of 2026-10-16");
  });
});
