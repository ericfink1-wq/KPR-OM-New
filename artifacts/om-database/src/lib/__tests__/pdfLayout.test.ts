import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fitColumns, CELL_PAD } from "../pdfLayout";
import { measureText, measureLongestWord, wrappedLineCount } from "../pdfMetrics";
import { rollupColumns } from "../rollupColumns";
import type { ExportCol } from "../tableExport";

// The REAL Food Lion tenant export — the one whose columns collided. Long tenant
// name, long sales strings, right-aligned money butting against a left-aligned date.
const FL = JSON.parse(readFileSync(join(__dirname, "../../../scripts/fixtures/food-lion.json"), "utf8")) as unknown[][];
const rows = FL.map(([property, brand, market, sf, rentPSF, annualRent, start, expiry, sales]) =>
  ({ property, brand, market, sf, rentPSF, annualRent, start, expiry, sales } as Record<string, unknown>));
const COLS = rollupColumns("Recorded As");
const AVAILABLE = 792 - 26 * 2 - 4 * 2;   // LETTER landscape minus page + row padding

describe("text metrics", () => {
  it("measures Helvetica widths (a digit string is 0.556em per char)", () => {
    expect(measureText("00000", 10)).toBeCloseTo(0.556 * 10 * 5, 5);
    expect(measureText("", 10)).toBe(0);
  });
  it("bold is wider than regular for the same text", () => {
    expect(measureText("Property", 8, true)).toBeGreaterThan(measureText("Property", 8, false));
  });
  it("finds the widest single word", () => {
    expect(measureLongestWord("a Supercalifragilistic b", 8))
      .toBeCloseTo(measureText("Supercalifragilistic", 8), 5);
  });
  it("counts wrapped lines on spaces only", () => {
    const w = measureText("aaa bbb", 8);
    expect(wrappedLineCount("aaa bbb", w + 1, 8)).toBe(1);
    expect(wrappedLineCount("aaa bbb", measureText("aaa", 8) + 1, 8)).toBe(2);
  });
});

describe("Food Lion export — the layout that was broken", () => {
  const layout = fitColumns(COLS, rows, AVAILABLE);

  it("fits every cell on ONE line (no wrapping, no hyphenation needed)", () => {
    expect(layout.overflowed).toBe(false);
    expect(layout.wrappedCells).toBe(0);
  });

  it("uses the full page width without exceeding it", () => {
    const total = layout.columns.reduce((a, c) => a + c.width, 0);
    expect(total).toBeLessThanOrEqual(AVAILABLE + 0.5);
    expect(total).toBeGreaterThan(AVAILABLE * 0.97);
  });

  it("leaves a real gutter so $593,776 can't touch Jan-2009", () => {
    // the exact collision from the reported PDF
    const rent = layout.columns.find(c => c.col.header === "Annual Rent")!;
    const start = layout.columns.find(c => c.col.header === "Start")!;
    expect(rent.col.align).toBe("right");
    // the money column must hold its widest value PLUS padding on both sides
    const widest = Math.max(...rows.map(r => measureText(rent.col.text(r), layout.fontSize)));
    expect(rent.width).toBeGreaterThanOrEqual(widest + CELL_PAD * 2 - 0.01);
    expect(start.width).toBeGreaterThan(0);
    expect(CELL_PAD).toBeGreaterThan(0);
  });

  it("gives the long sublease name enough room instead of hyphenating it", () => {
    const brand = layout.columns.find(c => c.col.header === "Recorded As")!;
    const longest = "Food Lion (subleased to Little Giant Farmers Market)";
    expect(wrappedLineCount(longest, brand.width - CELL_PAD * 2, layout.fontSize)).toBe(1);
  });

  it("does not let the one long value starve the numeric columns", () => {
    for (const h of ["SF", "Rent / SF", "Annual Rent", "Start", "Expiry"]) {
      const c = layout.columns.find(x => x.col.header === h)!;
      const widest = Math.max(...rows.map(r => measureText(c.col.text(r), layout.fontSize)));
      expect(c.width).toBeGreaterThanOrEqual(widest + CELL_PAD * 2 - 0.01);
    }
  });
});

describe("fitColumns holds up on the awkward cases", () => {
  const simple: ExportCol[] = [
    { header: "A", width: 10, text: r => String(r.a ?? "") },
    { header: "B", width: 10, align: "right", text: r => String(r.b ?? "") },
  ];

  it("handles an empty row set without dividing by zero", () => {
    const l = fitColumns(simple, [], AVAILABLE);
    expect(l.columns).toHaveLength(2);
    expect(l.columns.reduce((a, c) => a + c.width, 0)).toBeCloseTo(AVAILABLE, 1);
  });

  it("shrinks the font rather than overflowing when content is huge", () => {
    const many: ExportCol[] = Array.from({ length: 14 }, (_, i) => ({
      header: `Column ${i}`, width: 10, text: (r: Record<string, unknown>) => String(r[`c${i}`] ?? ""),
    }));
    const wide = [Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`c${i}`, "Rocky Mount, NC 28034"]))];
    const l = fitColumns(many, wide, AVAILABLE);
    expect(l.fontSize).toBeLessThan(7.5);              // it stepped down
    expect(l.columns.reduce((a, c) => a + c.width, 0)).toBeLessThanOrEqual(AVAILABLE + 0.5);
  });

  it("never renders a column below the legibility floor", () => {
    const l = fitColumns(simple, [{ a: "x".repeat(400), b: "1" }], AVAILABLE);
    for (const c of l.columns) expect(c.width).toBeGreaterThanOrEqual(26);
  });

  it("reports overflowed=true when even the smallest font can't fit it", () => {
    const one: ExportCol[] = [{ header: "X", width: 10, text: () => "Q".repeat(4000) }];
    expect(fitColumns(one, [{}], AVAILABLE).overflowed).toBe(true);
  });

  it("is deterministic — same input, same widths", () => {
    const a = fitColumns(COLS, rows, AVAILABLE).columns.map(c => c.width);
    const b = fitColumns(COLS, rows, AVAILABLE).columns.map(c => c.width);
    expect(a).toEqual(b);
  });

  it("adapts when the content changes (short data => different widths)", () => {
    const short = rows.map(r => ({ ...r, brand: "Food Lion", sales: "—" }));
    const wide = fitColumns(COLS, rows, AVAILABLE).columns.find(c => c.col.header === "Recorded As")!.width;
    const narrow = fitColumns(COLS, short, AVAILABLE).columns.find(c => c.col.header === "Recorded As")!.width;
    expect(narrow).toBeLessThan(wide);
  });
});
