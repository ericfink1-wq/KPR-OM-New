import { describe, it, expect } from "vitest";
import { pdfWidths, toAggColumns, safeFileName, n0, m0, m2, type ExportCol } from "../tableExport";

// NOTE: rendering TablePDF to real PDF bytes is verified by scripts/verify-pdf.mjs
// (esbuild-bundled), NOT here — vitest.config.ts is deliberately plugin-free and so
// cannot transform .tsx. Keep that script in sync if the PDF props change.

const cols: ExportCol[] = [
  { header: "Property", width: 26, tone: "bold", text: r => String(r.property ?? "—") },
  { header: "SF", width: 10, align: "right", text: r => n0(r.sf), value: r => (r.sf as number) ?? "", fmt: "#,##0" },
  { header: "Rent", width: 14, align: "right", text: r => m0(r.rent), value: r => (r.rent as number) ?? "", fmt: "$#,##0" },
];
const rows = [
  { property: "Winterville Commons", sf: 50887, rent: 1043184 },
  { property: "Brier Creek", sf: 46522, rent: 709931 },
];

describe("one column spec drives both exports", () => {
  it("normalises PDF widths to 100%", () => {
    expect(pdfWidths(cols).map(parseFloat).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it("keeps Excel values NUMERIC so the sheet can sum them", () => {
    const agg = toAggColumns(cols);
    expect(agg.map(c => c.header)).toEqual(["Property", "SF", "Rent"]);
    expect(agg[1].get(rows[0])).toBe(50887);
    expect(agg[2].get(rows[0])).toBe(1043184);
    expect(agg[1].fmt).toBe("#,##0");
  });

  it("uses the formatted text in the PDF but the raw number in Excel", () => {
    expect(cols[2].text(rows[0])).toBe("$1,043,184");
    expect(toAggColumns(cols)[2].get(rows[0])).toBe(1043184);
  });

  it("falls back to the PDF text when a column has no Excel value", () => {
    expect(toAggColumns(cols)[0].get({})).toBe("—");
  });
});

describe("formatters render blanks, not junk", () => {
  it("shows an em dash for missing / zero / non-numeric", () => {
    for (const v of [null, undefined, "", 0, NaN, "abc"]) {
      expect(n0(v === 0 ? null : v)).toBe("—");
      expect(m0(v)).toBe("—");
      expect(m2(v)).toBe("—");
    }
  });
  it("formats real values", () => {
    expect(n0(50887)).toBe("50,887");
    expect(m0(1043184)).toBe("$1,043,184");
    expect(m2(13.2)).toBe("$13.20");
  });
});

describe("safeFileName", () => {
  it("strips characters an OS will reject and collapses spaces", () => {
    expect(safeFileName('Lowes Foods / "NC*"')).toBe("Lowes_Foods_-_-NC--");
    expect(safeFileName("")).toBe("export");
  });
  it("truncates very long names", () => {
    expect(safeFileName("x".repeat(200)).length).toBe(80);
  });
});

describe("Excel columns auto-size to content", () => {
  const cs: ExportCol[] = [
    { header: "Recorded As", width: 24, text: r => String(r.brand ?? "") },
    { header: "SF", width: 11, align: "right", text: r => n0(r.sf), value: r => (r.sf as number) ?? "", fmt: "#,##0" },
  ];
  const short = [{ brand: "Food Lion", sf: 34928 }];
  const long = [{ brand: "Food Lion (subleased to Little Giant Farmers Market)", sf: 34928 }];

  it("widens a column when the data is long, up to the cap", () => {
    const w = toAggColumns(cs, long)[0].width;
    expect(w).toBeGreaterThan(toAggColumns(cs, short)[0].width);
    // the value is 52 chars; the column stops at the 46-char cap rather than
    // producing an unwieldy sheet (Excel lets the reader widen it from there)
    expect(w).toBe(46);
  });

  it("never goes below a readable floor (so numbers don't render as ###)", () => {
    expect(toAggColumns(cs, short)[1].width).toBeGreaterThanOrEqual(9);
  });

  it("caps runaway widths", () => {
    expect(toAggColumns(cs, [{ brand: "x".repeat(500), sf: 1 }])[0].width).toBeLessThanOrEqual(46);
  });

  it("falls back to the declared width when no rows are given", () => {
    expect(toAggColumns(cs)[0].width).toBe(24);
  });

  it("still keeps values numeric after auto-sizing", () => {
    expect(toAggColumns(cs, short)[1].get(short[0])).toBe(34928);
  });
});
