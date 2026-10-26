import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { deriveTermCurve, chathamBasis, businessDaysBetween } from "./dtccSwaps";
import { ensureRateCurvesTable, basisSamples, type CurveView, type TermCurveView } from "./rateCurves";

// DAILY HISTORY OF EVERY SWAP TENOR THE TODAY'S RATES PANEL SHOWS (Eric, 10/26/26).
// Two sources, both already in rate_curves (NO new table):
//  • the DTCC end-of-day curves (`<date>|ois`), backfilled a year back with the panel's own method;
//  • a daily SNAPSHOT of what the panel actually showed (`<date>|snapshot`, kind panel-snapshot):
//    one point per series + tenor with its trade count and the thin-close flag.
// Per date the OIS rate is: a Chatham mark that day > the DTCC end-of-day close > the snapshot
// (intraday / pasted). The 1M Term SOFR swap curve for each date is DERIVED from that day's OIS
// exactly as the live panel does (deriveTermCurve + the trailing Term-basis window; a Chatham
// mark's own Term column wins where it lists the tenor). 1M Term SOFR SPOT history = Chatham
// pastes only — it is CME-licensed and never scraped. No interpolation anywhere: a day with no
// value is simply absent (the chart breaks over holes).

export interface SnapPoint { s: "ois" | "term"; t: number; r: number; n: number | null; thin: boolean }
/** "close-window" = enough trades in the 3:00–5:00pm ET close. Anything else (latest-2h, day,
 *  day+drift) is a THIN close. A pasted / Chatham curve carries no method → not flagged. */
export const isThin = (method: unknown): boolean => typeof method === "string" && method !== "close-window";

/** What the panel shows right now, as snapshot points (one per series + tenor). */
export function snapshotPoints(ois: CurveView | null, term: TermCurveView | null): SnapPoint[] {
  const out: SnapPoint[] = [];
  const thinAt = new Map<number, boolean>();
  for (const p of ois?.points ?? []) {
    const thin = ois!.kind === "dtcc-eod" || ois!.kind === "dtcc-intraday" ? isThin(p.method) : false;
    thinAt.set(p.tenor, thin);
    out.push({ s: "ois", t: p.tenor, r: p.rate, n: p.n ?? null, thin });
  }
  for (const p of term?.points ?? []) out.push({ s: "term", t: p.tenor, r: p.rate, n: null, thin: thinAt.get(p.tenor) ?? false });
  return out;
}

let lastSave = 0;
/** Upsert today's snapshot (keyed by the CURVE's date, so a later refresh the same day replaces
 *  it). Throttled to once per 10 minutes per instance; never throws. */
export async function saveCurveSnapshot(ois: CurveView | null, term: TermCurveView | null, force = false): Promise<boolean> {
  if (!ois || !ois.points.length || (!force && Date.now() - lastSave < 10 * 60_000)) return false;
  lastSave = Date.now();
  try {
    await ensureRateCurvesTable();
    const pts = snapshotPoints(ois, term);
    const src = `panel snapshot · ${ois.kind === "chatham" ? "Chatham mark" : ois.kind === "manual" ? "pasted curve" : ois.kind === "dtcc-intraday" ? "DTCC intraday" : "DTCC end-of-day"}`;
    await db.execute(sql`INSERT INTO rate_curves (id, curve_date, kind, as_of, source, points)
      VALUES (${`${ois.curveDate}|snapshot`}, ${ois.curveDate}, 'panel-snapshot', ${ois.asOf}, ${src}, ${JSON.stringify(pts)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET as_of = EXCLUDED.as_of, source = EXCLUDED.source, points = EXCLUDED.points`);
    return true;
  } catch { return false; }
}

// ── Building a series from stored rows (pure) ────────────────────────────────
export interface StoredRow { curve_date: string; kind: string; points: unknown }
interface OisDay { date: string; points: Map<number, { rate: number; n: number | null; thin: boolean }>; src: "chatham" | "dtcc" | "snapshot"; chathamTerm?: Map<number, number> }
/** US bond-market business days = the days the NY Fed published SOFR (it publishes on every one and
 *  no other). A date after the latest print counts if it is a weekday (today's SOFR comes tomorrow). */
export function businessDayTest(sofrDates: string[] | null): (date: string) => boolean {
  if (!sofrDates?.length) return d => { const w = new Date(d + "T00:00:00Z").getUTCDay(); return w !== 0 && w !== 6; };
  const set = new Set(sofrDates), last = sofrDates.reduce((a, b) => (b > a ? b : a), "");
  return d => set.has(d) || (d > last && ![0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay()));
}
/** Per date, the OIS curve the panel would have shown (Chatham mark > DTCC end-of-day > snapshot).
 *  A DTCC file for a US holiday (Thanksgiving, MLK, Presidents' Day…) is not a US close: the few
 *  trades in it gave 1.68% for the 5Y on 1/19/26 — such days are left out when `isBusinessDay` is given. */
export function oisByDate(rows: StoredRow[], isBusinessDay?: (date: string) => boolean): Map<string, OisDay> {
  const out = new Map<string, OisDay>();
  const rank = { chatham: 3, dtcc: 2, snapshot: 1 } as const;
  for (const r of rows) {
    const date = String(r.curve_date).slice(0, 10);
    if (isBusinessDay && r.kind !== "chatham" && !isBusinessDay(date)) continue;
    let day: OisDay | null = null;
    if (r.kind === "chatham") {
      const m = r.points as { ois?: Array<{ tenor: number; rate: number }>; term?: Array<{ tenor: number; rate: number }> };
      if ((m.ois?.length ?? 0) >= 2) day = { date, src: "chatham", points: new Map(m.ois!.map(p => [p.tenor, { rate: p.rate, n: null, thin: false }])), chathamTerm: new Map((m.term ?? []).map(p => [p.tenor, p.rate])) };
    } else if (r.kind === "ois") {
      const pts = r.points as Array<{ tenor: number; rate: number; n?: number; method?: string }>;
      day = { date, src: "dtcc", points: new Map(pts.map(p => [p.tenor, { rate: p.rate, n: p.n ?? null, thin: isThin(p.method) }])) };
    } else if (r.kind === "panel-snapshot") {
      const pts = (r.points as SnapPoint[]).filter(p => p.s === "ois");
      if (pts.length) day = { date, src: "snapshot", points: new Map(pts.map(p => [p.t, { rate: p.r, n: p.n, thin: p.thin }])) };
    }
    if (!day) continue;
    const cur = out.get(date);
    if (!cur || rank[day.src] > rank[cur.src]) out.set(date, day);
  }
  return out;
}

/** date, rate, thin 0/1, trades, outlier reason (null = good). */
export type SwapSeriesPoint = [string, number, 0 | 1, number | null, string | null];

// ── Outlier screen (Eric, 10/26/26 — the 10/19/26 5Y OIS printed 4.068% from 58 identical
// all-day prints while 3Y was 4.650% and 7Y 4.686%; it drove a "+45 bp" 1-week change) ──────
// Each tenor/day is compared with two independent references:
//   • TIME — the median of the same tenor over the 3 trading days before and after;
//   • CURVE — the same day's adjacent tenors (interpolated), plus that tenor's usual
//     offset from them over the same neighbouring days (so a normal curve hump isn't "off").
// Flagged when it is a THIN close (too few trades in the 3:00–5:00pm ET window) AND more than
// OUTLIER_BP off BOTH references, or — however many trades — more than SPIKE_BP off both.
// A real market move shifts the neighbouring tenors too, so it passes the curve test.
// Flagged points stay on the chart (hollow, with the reason) but never feed change stats.
export const OUTLIER_BP = 15, SPIKE_BP = 25, NEIGHBOUR_DAYS = 3;
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
type DayPts = { date: string; points: Map<number, { rate: number; n: number | null; thin: boolean }> };
/** Same-day curve estimate at `t` from the nearest tenors either side (or the nearest one at an edge). */
function curveAt(day: DayPts, t: number): number | null {
  const ts = [...day.points.keys()].filter(x => x !== t).sort((a, b) => a - b);
  const lo = [...ts].reverse().find(x => x < t), hi = ts.find(x => x > t);
  if (lo != null && hi != null) { const a = day.points.get(lo)!.rate, b = day.points.get(hi)!.rate; return a + (b - a) * ((t - lo) / (hi - lo)); }
  const near = lo ?? hi;
  return near != null ? day.points.get(near)!.rate : null;
}
/** Outlier reason per `${date}|${tenor}` (absent = good). Pure. */
export function screenOutliers(days: DayPts[]): Map<string, string> {
  const out = new Map<string, string>();
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (let i = 0; i < sorted.length; i++) {
    const d = sorted[i];
    const nb = [...sorted.slice(Math.max(0, i - NEIGHBOUR_DAYS), i), ...sorted.slice(i + 1, i + 1 + NEIGHBOUR_DAYS)];
    for (const [t, p] of d.points) {
      const timeRef = median(nb.map(x => x.points.get(t)?.rate).filter((v): v is number => v != null));
      const here = curveAt(d, t);
      const offsets = nb.map(x => { const r = x.points.get(t)?.rate, c = curveAt(x, t); return r != null && c != null ? r - c : null; }).filter((v): v is number => v != null);
      const curveRef = here != null ? here + (median(offsets) ?? 0) : null;
      const dT = timeRef != null ? (p.rate - timeRef) * 100 : null, dC = curveRef != null ? (p.rate - curveRef) * 100 : null;
      const off = (lim: number) => (dT == null || Math.abs(dT) > lim) && (dC == null || Math.abs(dC) > lim) && (dT != null || dC != null);
      const thinBad = p.thin && off(OUTLIER_BP), spike = off(SPIKE_BP);
      if (!thinBad && !spike) continue;
      const parts = [dT != null ? `${Math.abs(dT).toFixed(0)} bp ${dT > 0 ? "above" : "below"} the neighbouring days` : null, dC != null ? `${Math.abs(dC).toFixed(0)} bp ${dC > 0 ? "above" : "below"} the adjacent tenors that day` : null].filter(Boolean).join(" and ");
      out.set(`${d.date}|${t}`, `${p.thin ? `Thin close${p.n != null ? ` (${p.n} trade${p.n === 1 ? "" : "s"}, read from outside the 3–5pm window)` : ""}` : "Isolated spike"} — ${parts}. Left out of the change figures and the high/low.`);
    }
  }
  return out;
}
type TermRow = { curve_date: string; kind: string; points: Array<{ tenor: number; rate: number; n?: number; m?: number }> };
/** The 1M Term SOFR swap curve for one day, derived from that day's OIS exactly as the live
 *  panel derives it: trailing Term-basis window, the Chatham mark in force (≤ 60 business days)
 *  recalibrating the basis, and a Chatham mark's own Term column winning where it lists the tenor. */
function termForDay(d: OisDay, rows: StoredRow[]): Map<number, number> {
  const termRows = rows.filter(r => r.kind === "term" || r.kind === "ois") as TermRow[];
  const marks = rows.filter(r => r.kind === "chatham").map(r => ({ date: String(r.curve_date).slice(0, 10), pts: r.points as never }))
    .filter(m => m.date <= d.date && businessDaysBetween(m.date, d.date) <= 60).sort((a, b) => (a.date < b.date ? 1 : -1));
  const basis = marks[0] ? chathamBasis(marks[0].pts) : [];
  const derived = deriveTermCurve([...d.points.entries()].map(([t, v]) => ({ tenor: t, rate: v.rate })), basisSamples(termRows, d.date), basis.length >= 2 ? basis : null);
  const out = new Map(derived.map(p => [p.tenor, p.rate]));
  for (const [t, r] of d.chathamTerm ?? []) out.set(t, r);
  return out;
}
/** One tenor's daily history for "ois" or "term". The Term curve is derived from the day's OIS,
 *  so an OIS outlier flags the Term point too (a Chatham mark's own Term column is never flagged). */
export function swapSeries(rows: StoredRow[], series: "ois" | "term", tenor: number, isBusinessDay?: (date: string) => boolean): SwapSeriesPoint[] {
  const days = [...oisByDate(rows, isBusinessDay).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const flags = screenOutliers(days.filter(d => d.src !== "chatham"));
  const out: SwapSeriesPoint[] = [];
  for (const d of days) {
    const p = d.points.get(tenor), flag = flags.get(`${d.date}|${tenor}`) ?? null;
    if (series === "ois") { if (p) out.push([d.date, p.rate, p.thin ? 1 : 0, p.n, flag]); continue; }
    if (d.chathamTerm?.has(tenor)) { out.push([d.date, d.chathamTerm.get(tenor)!, 0, null, null]); continue; }
    const r = p ? termForDay(d, rows).get(tenor) : undefined;
    if (r != null) out.push([d.date, r, p?.thin ? 1 : 0, null, flag]);
  }
  return out;
}
/** 1M Term SOFR spot — Chatham pastes only (CME-licensed; never scraped). */
export function termSofrSeries(rows: StoredRow[]): SwapSeriesPoint[] {
  return rows.filter(r => r.kind === "chatham" && typeof (r.points as { termSofr1m?: unknown }).termSofr1m === "number")
    .map(r => [String(r.curve_date).slice(0, 10), (r.points as { termSofr1m: number }).termSofr1m, 0, null, null] as SwapSeriesPoint)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// ── Curve overlay: today vs 1 week / 1 month / 1 year ago ───────────────────
const addDays = (iso: string, k: number) => new Date(Date.parse(iso + "T00:00:00Z") + k * 86_400_000).toISOString().slice(0, 10);
const addMonths = (iso: string, k: number) => { const d = new Date(iso + "T00:00:00Z"); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + k); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10); };
/** The comparison date for an overlay: the latest stored date ON OR BEFORE the target (a
 *  weekend/holiday target falls back to the prior trading day), but never more than `tolDays`
 *  earlier — beyond that there is no curve for that point in time and we say so (null). */
export function pickCurveDate(dates: string[], target: string, tolDays = 7): string | null {
  let best: string | null = null;
  for (const d of dates) if (d <= target && (!best || d > best)) best = d;
  if (!best) return null;
  return (Date.parse(target) - Date.parse(best)) / 86_400_000 <= tolDays ? best : null;
}
export function overlayTargets(curveDate: string): Array<{ key: "1W" | "1M" | "1Y"; target: string }> {
  return [{ key: "1W", target: addDays(curveDate, -7) }, { key: "1M", target: addMonths(curveDate, -1) }, { key: "1Y", target: addMonths(curveDate, -12) }];
}
export function curveOn(rows: StoredRow[], date: string): { ois: Array<{ tenor: number; rate: number; thin: boolean }>; term: Array<{ tenor: number; rate: number }> } | null {
  const day = oisByDate(rows).get(date);
  if (!day) return null;
  const tenors = [...day.points.keys()].sort((a, b) => a - b);
  const term = termForDay(day, rows);
  return {
    ois: tenors.map(t => ({ tenor: t, rate: day.points.get(t)!.rate, thin: day.points.get(t)!.thin })),
    term: [...term.entries()].sort((a, b) => a[0] - b[0]).map(([tenor, rate]) => ({ tenor, rate })),
  };
}

// ── DB reads ─────────────────────────────────────────────────────────────────
export async function loadCurveRows(): Promise<StoredRow[]> {
  await ensureRateCurvesTable();
  const r = await db.execute(sql`SELECT curve_date::text AS curve_date, kind, points FROM rate_curves WHERE kind IN ('ois', 'term', 'chatham', 'panel-snapshot') ORDER BY curve_date`);
  return r.rows as unknown as StoredRow[];
}
