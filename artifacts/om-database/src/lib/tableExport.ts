// ONE column definition that drives BOTH the PDF and the Excel export, so the two
// can never drift apart. Any table page in the app can be made shareable by
// describing its columns once and handing them to <ExportButtons>.
import type { AggColumn } from "./exportExcel";

export interface ExportCol {
  header: string;
  /**
   * FALLBACK width in characters, used for Excel when no rows are supplied to
   * `toAggColumns`. The PDF ignores it entirely — pdfLayout measures the real
   * content and sizes columns to fit (see fitColumns).
   */
  width: number;
  align?: "left" | "right";
  /** Visual weight in the PDF only. */
  tone?: "bold" | "body" | "faint" | "money";
  /** Cell text for the PDF (already formatted). */
  text: (r: Record<string, unknown>) => string;
  /** Raw value for Excel — defaults to `text`. Numbers stay numeric so Excel can sum them. */
  value?: (r: Record<string, unknown>) => string | number | "";
  /** Excel number format, e.g. "$#,##0.00". */
  fmt?: string;
}

/**
 * Adapt the shared spec to the Excel writer. Pass `rows` and each column is sized to
 * its actual content (clamped to something readable) — a column left too narrow
 * renders numbers as "###", which is the spreadsheet version of the cramped-column
 * problem the PDF had.
 */
export function toAggColumns(cols: ExportCol[], rows?: Record<string, unknown>[]): AggColumn[] {
  const MIN_CH = 9, MAX_CH = 46;
  return cols.map(c => {
    let width = c.width;
    if (rows?.length) {
      let longest = c.header.length;
      for (const r of rows) {
        let t: string;
        try { t = String(c.value ? c.value(r) : c.text(r)); } catch { t = ""; }
        if (t.length > longest) longest = t.length;
      }
      width = Math.min(MAX_CH, Math.max(MIN_CH, longest + 2));
    }
    return {
      header: c.header,
      width,
      fmt: c.fmt,
      get: (r: Record<string, unknown>) => (c.value ? c.value(r) : c.text(r)),
    };
  });
}

/** Percent widths for the PDF, normalised to sum to 100. */
export function pdfWidths(cols: ExportCol[]): string[] {
  const total = cols.reduce((a, c) => a + c.width, 0) || 1;
  return cols.map(c => `${(c.width / total) * 100}%`);
}

/** Safe filename fragment. */
export function safeFileName(s: string, max = 80): string {
  return String(s || "export").replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, "_").slice(0, max);
}

export const n0 = (v: unknown): string => {
  const n = Number(v);
  return v == null || v === "" || !isFinite(n) ? "—" : Math.round(n).toLocaleString();
};
export const m0 = (v: unknown): string => {
  const n = Number(v);
  return v == null || v === "" || !isFinite(n) || n === 0 ? "—" : `$${Math.round(n).toLocaleString()}`;
};
export const m2 = (v: unknown): string => {
  const n = Number(v);
  return v == null || v === "" || !isFinite(n) || n === 0 ? "—" : `$${n.toFixed(2)}`;
};
export const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === "" || !isFinite(n) ? null : n;
};
