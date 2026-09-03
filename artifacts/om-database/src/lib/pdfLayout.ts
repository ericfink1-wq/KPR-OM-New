// AUTO-FIT TABLE LAYOUT for the PDF exports.
//
// Hardcoded percentage column widths can't work: every export carries different
// content. The Food Lion tenant export showed all three failure modes at once —
// "$593,776" ran straight into "Jan-2009" (no gutter), "Little Giant Farmers
// Market" hyphenated mid-word into "Gi-ant", and the "Recorded As" column hogged
// width while 14 of its 15 values were just "Food Lion".
//
// So the exporter MEASURES the real content (see pdfMetrics) and sizes columns to
// it, then RE-CHECKS the result and shrinks the font a step at a time until every
// cell fits inside its budget. Same routine for every page, so a comps export and a
// tenant export come out equally clean.
import { measureText, measureLongestWord, wrappedLineCount } from "./pdfMetrics";
import type { ExportCol } from "./tableExport";

/** Horizontal breathing room inside each cell — this is what stops "$593,776Jan-2009". */
export const CELL_PAD = 4;
/** Never render a data column narrower than this (points) — below it nothing is legible. */
const MIN_COL = 26;
/** A single freak-long value shouldn't blow out a column; size to this percentile. */
const TARGET_PCTL = 0.9;
/** Font sizes to try, largest first. */
const FONT_STEPS = [7.5, 7, 6.5, 6, 5.5];
/** A body cell may wrap to at most this many lines before we shrink the font. */
const MAX_LINES = 2;

export interface FittedColumn { col: ExportCol; width: number }
export interface TableLayout {
  columns: FittedColumn[];
  fontSize: number;
  headerFontSize: number;
  /** Cells that still wrap (>1 line) at the chosen size — informational, not an error. */
  wrappedCells: number;
  /** True when even the smallest step couldn't fit everything in MAX_LINES. */
  overflowed: boolean;
}

const pctl = (sorted: number[], p: number): number => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
};

/**
 * Size `columns` to `availableWidth` (points) for the given rows.
 *
 * 1. Natural width per column = max(header, 90th-percentile cell) + padding, but never
 *    below the widest single WORD (a column narrower than that would hyphenate) and
 *    never below MIN_COL.
 * 2. Slack is handed to the columns that would still wrap, largest deficit first, so
 *    extra room goes where it removes a wrap rather than padding an already-fine column.
 * 3. If the naturals don't fit, shrink the widest-above-minimum columns proportionally.
 * 4. Re-measure; if any cell still needs more than MAX_LINES, drop a font step and redo.
 */
export function fitColumns(
  columns: ExportCol[],
  rows: Record<string, unknown>[],
  availableWidth: number,
): TableLayout {
  let last: TableLayout | null = null;

  for (const fontSize of FONT_STEPS) {
    const headerFontSize = Math.max(5.5, fontSize - 0.8);
    const texts = columns.map(c => rows.map(r => { try { return c.text(r); } catch { return ""; } }));

    const natural = columns.map((c, i) => {
      const head = measureText(c.header.toUpperCase(), headerFontSize, true);
      const widths = texts[i].map(t => measureText(t, fontSize, c.tone === "bold")).sort((a, b) => a - b);
      const longestWord = Math.max(
        measureLongestWord(c.header.toUpperCase(), headerFontSize, true),
        ...texts[i].map(t => measureLongestWord(t, fontSize, c.tone === "bold")), 0,
      );
      const target = Math.max(head, pctl(widths, TARGET_PCTL), longestWord);
      return Math.max(MIN_COL, target + CELL_PAD * 2);
    });
    // The most any column could ever want (its longest single value).
    const maxWant = columns.map((c, i) => {
      const w = Math.max(
        measureText(c.header.toUpperCase(), headerFontSize, true),
        ...texts[i].map(t => measureText(t, fontSize, c.tone === "bold")), 0,
      );
      return w + CELL_PAD * 2;
    });

    let widths = natural.slice();
    const total = widths.reduce((a, b) => a + b, 0);

    if (total < availableWidth) {
      // Give slack to whoever still wants more, proportional to what they're short.
      let slack = availableWidth - total;
      const deficit = widths.map((w, i) => Math.max(0, maxWant[i] - w));
      const totalDeficit = deficit.reduce((a, b) => a + b, 0);
      if (totalDeficit > 0) {
        const give = Math.min(slack, totalDeficit);
        widths = widths.map((w, i) => w + (deficit[i] / totalDeficit) * give);
        slack -= give;
      }
      if (slack > 0) {
        // Everything already fits on one line — spread the rest evenly so the table
        // fills the page instead of huddling on the left.
        widths = widths.map(w => w + slack / widths.length);
      }
    } else if (total > availableWidth) {
      // Shrink what's above the floor, proportional to how much room each has to give.
      let excess = total - availableWidth;
      for (let guard = 0; guard < 6 && excess > 0.01; guard++) {
        const room = widths.map(w => Math.max(0, w - MIN_COL));
        const totalRoom = room.reduce((a, b) => a + b, 0);
        if (totalRoom <= 0) break;
        const cut = Math.min(excess, totalRoom);
        widths = widths.map((w, i) => w - (room[i] / totalRoom) * cut);
        excess -= cut;
      }
    }

    // Re-check the fit we actually produced.
    let wrappedCells = 0, worst = 1;
    columns.forEach((c, i) => {
      const inner = widths[i] - CELL_PAD * 2;
      for (const t of texts[i]) {
        const lines = wrappedLineCount(t, inner, fontSize, c.tone === "bold");
        if (lines > 1) wrappedCells++;
        if (lines > worst) worst = lines;
      }
    });

    const layout: TableLayout = {
      columns: columns.map((col, i) => ({ col, width: widths[i] })),
      fontSize, headerFontSize, wrappedCells, overflowed: worst > MAX_LINES,
    };
    last = layout;
    if (!layout.overflowed) return layout;
  }
  return last!;   // smallest step; still marked overflowed so the caller can say so
}
