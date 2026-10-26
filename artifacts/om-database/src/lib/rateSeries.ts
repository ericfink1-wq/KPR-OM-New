// TODAY'S RATES — tap-to-chart math (Eric, 10/26/26). Pure; tested in rateSeries.test.ts.
// A series is [date, value | null, thin 0/1, trades | null] — null value = a published "no print"
// day. Nothing here interpolates: a missing day stays missing, and a hole longer than
// GAP_DAYS gets an explicit break row so the line is not drawn across it.

export type SeriesTuple = [string, number | null, 0 | 1, number | null];
export interface ChartRow { t: number; date: string; v: number | null; thin?: boolean; n?: number | null }
const DAY = 86_400_000;
export const GAP_DAYS = 5;
const ms = (iso: string) => Date.parse(iso + "T00:00:00Z");
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addMonths = (d: string, k: number): string => {
  const x = new Date(d + "T00:00:00Z"); const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + k);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last));
  return x.toISOString().slice(0, 10);
};

/** Chart rows; a published no-print day stays null, and a hole > GAP_DAYS gets a null break row. */
export function toChartRows(points: SeriesTuple[]): ChartRow[] {
  const out: ChartRow[] = [];
  let prev: string | null = null;
  for (const [d, v, thin, n] of points) {
    if (prev && ms(d) - ms(prev) > GAP_DAYS * DAY) out.push({ t: ms(prev) + DAY, date: iso(ms(prev) + DAY), v: null });
    out.push({ t: ms(d), date: d, v, ...(thin ? { thin: true } : {}), ...(n != null ? { n } : {}) });
    prev = d;
  }
  return out;
}

export type RangeKey = "1W" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "Max";
export const RANGES: RangeKey[] = ["1W", "1M", "3M", "6M", "1Y", "5Y", "Max"];
/** First date shown for a range, counted back from the series' latest date. */
export function rangeStart(latest: string, r: RangeKey): string | null {
  switch (r) {
    case "1W": return iso(ms(latest) - 7 * DAY);
    case "1M": return addMonths(latest, -1);
    case "3M": return addMonths(latest, -3);
    case "6M": return addMonths(latest, -6);
    case "1Y": return addMonths(latest, -12);
    case "5Y": return addMonths(latest, -60);
    default: return null;
  }
}
export function inRange(rows: ChartRow[], r: RangeKey): ChartRow[] {
  const last = [...rows].reverse().find(x => x.v != null);
  if (!last) return rows;
  const from = rangeStart(last.date, r);
  return from ? rows.filter(x => x.date >= from) : rows;
}

// ── Change stats ─────────────────────────────────────────────────────────────
export interface ChangeStats {
  latest: { date: string; v: number } | null;
  d1: number | null; w1: number | null; m1: number | null; ytd: number | null; y1: number | null;   // bp
  hi52: { date: string; v: number } | null; lo52: { date: string; v: number } | null;
  /** History doesn't reach a full year back — the 52-week figures cover only what exists. */
  partialYear: boolean; firstDate: string | null;
}
const LOOKBACK_TOL_DAYS = 7;
/** The value in force on a date: the latest real print on or before it, if within 7 days.
 *  Further back than that there is no comparable figure — null, never a guess. */
export function valueOn(points: SeriesTuple[], target: string): { date: string; v: number } | null {
  let best: { date: string; v: number } | null = null;
  for (const [d, v] of points) if (v != null && d <= target && (!best || d > best.date)) best = { date: d, v };
  return best && (ms(target) - ms(best.date)) / DAY <= LOOKBACK_TOL_DAYS ? best : null;
}
const bp = (now: number, then: { v: number } | null) => (then ? Math.round((now - then.v) * 1000) / 10 : null);
export function changeStats(points: SeriesTuple[]): ChangeStats {
  const real = points.filter((p): p is [string, number, 0 | 1, number | null] => p[1] != null);
  const firstDate = real[0]?.[0] ?? null;
  if (!real.length) return { latest: null, d1: null, w1: null, m1: null, ytd: null, y1: null, hi52: null, lo52: null, partialYear: true, firstDate };
  const [d0, v0] = real[real.length - 1];
  const prev = real.length > 1 ? { v: real[real.length - 2][1] } : null;
  const yearAgo = addMonths(d0, -12);
  const win = real.filter(p => p[0] > yearAgo);
  const hi = win.reduce((a, p) => (p[1] > a[1] ? p : a)), lo = win.reduce((a, p) => (p[1] < a[1] ? p : a));
  return {
    latest: { date: d0, v: v0 },
    d1: bp(v0, prev),
    w1: bp(v0, valueOn(real, iso(ms(d0) - 7 * DAY))),
    m1: bp(v0, valueOn(real, addMonths(d0, -1))),
    ytd: bp(v0, valueOn(real, `${Number(d0.slice(0, 4)) - 1}-12-31`)),
    y1: bp(v0, valueOn(real, yearAgo)),
    hi52: { date: hi[0], v: hi[1] }, lo52: { date: lo[0], v: lo[1] },
    partialYear: !firstDate || firstDate > yearAgo, firstDate,
  };
}
export const fmtBp = (x: number | null) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(Math.abs(x) >= 10 ? 0 : 1)} bp`);

// ── Panel row → series key ───────────────────────────────────────────────────
/** Which history a Today's Rates row charts; null = no history for it (e.g. an estimate). */
export function seriesKeyForRow(section: "sofr" | "term" | "ois" | "treasury", label: string): string | null {
  if (section === "sofr") {
    if (/term.*1\s*month/i.test(label)) return "termsofr1m";
    if (/30-day/i.test(label)) return "SOFR30";
    if (/overnight/i.test(label)) return "SOFR";
    return null;
  }
  if (/\(est\.\)/i.test(label)) return null;
  const m = /(\d{1,2})\s*Year/i.exec(label);
  if (section === "term") return m ? `term:${m[1]}` : null;
  if (section === "ois") return m ? `ois:${m[1]}` : null;
  const t = /^(\d{1,2})-Yr$/.exec(label.trim());
  return t && ["1", "2", "3", "5", "7", "10", "30"].includes(t[1]) ? `DGS${t[1]}` : null;
}

// ── Compare: each series keeps its OWN dates (no cross-series nulls) ─────────
export function compareRows(points: SeriesTuple[], r: RangeKey, from?: string | null): ChartRow[] {
  const rows = inRange(toChartRows(points), r);
  return from ? rows.filter(x => x.date >= from) : rows;
}
/** Common range start for an overlay: the latest date among the series' range starts. */
export function compareStart(all: SeriesTuple[][], r: RangeKey): string | null {
  const lasts = all.map(p => [...p].reverse().find(x => x[1] != null)?.[0]).filter((x): x is string => !!x);
  if (!lasts.length) return null;
  const latest = lasts.sort()[lasts.length - 1];
  return rangeStart(latest, r);
}
