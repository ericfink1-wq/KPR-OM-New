import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import { fetchWithTimeout } from "./http";
import { logger } from "./logger";
import { extractSofrSwaps, buildCurve, nyDate, nyMinutes, annualToMonthly, deriveTermCurve, businessDaysBetween, TERM_CLEAN_TOL_BP, TERM_BASIS_DEFAULT_BP, type CurveKind, type CurvePoint, type SwapTrade, type BasisSample, type TermPoint } from "./dtccSwaps";

// Stored SOFR swap curves (see dtccSwaps.ts for how a curve is read off DTCC's trades).
// One row per curve: `${YYYY-MM-DD}|${kind}` where kind is ois / term (end-of-day files),
// ois-live / term-live (today's intraday slices), or manual (pasted from Chatham etc.).
// Runtime-created table → ALSO declared in lib/db/src/schema/rateCurves.ts and mirrored in
// lib/db/scripts/ensure-runtime-tables.mjs (see CLAUDE.md: a table only in prod gets DROPPED).

let ready: Promise<void> | null = null;
export function ensureRateCurvesTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS rate_curves (
          id text PRIMARY KEY,
          curve_date date NOT NULL,
          kind text NOT NULL,
          as_of timestamptz NOT NULL DEFAULT now(),
          source text NOT NULL DEFAULT '',
          points jsonb NOT NULL,
          entered_by text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    })().catch(err => { ready = null; throw err; });
  }
  return ready;
}

const BASE = "https://kgc0418-tdw-data-0.s3.amazonaws.com";
interface IndexEntry { fileName: string; fullFilePath: string; dissemDTM: string; sliceId: number; rowCount?: number }

let indexCache: { at: number; cum: IndexEntry[]; slice: IndexEntry[] } | null = null;
async function loadIndex(): Promise<{ cum: IndexEntry[]; slice: IndexEntry[] }> {
  if (indexCache && Date.now() - indexCache.at < 5 * 60_000) return indexCache;
  const get = async (name: string) => {
    const r = await fetchWithTimeout(`${BASE}/dashboard/${name}`, 15_000);
    if (!r.ok) throw new Error(`DTCC ${name} HTTP ${r.status}`);
    const j = await r.json() as Record<string, IndexEntry[]>;
    return Array.isArray(j.CFTC_IR) ? j.CFTC_IR : [];
  };
  const [cum, slice] = await Promise.all([get("Cumulative.json"), get("Slice.json")]);
  indexCache = { at: Date.now(), cum, slice };
  return indexCache;
}

async function downloadCsv(url: string): Promise<string> {
  const r = await fetchWithTimeout(url, 45_000);
  if (!r.ok) throw new Error(`DTCC file HTTP ${r.status}`);
  const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
  const name = Object.keys(files).find(n => n.toLowerCase().endsWith(".csv"));
  if (!name) throw new Error("DTCC zip has no CSV");
  return strFromU8(files[name]);
}

const fileDate = (fileName: string): string | null => {
  const m = /(\d{4})_(\d{2})_(\d{2})/.exec(fileName);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

async function upsert(id: string, curveDate: string, kind: string, asOf: string, source: string, points: unknown, enteredBy: string | null = null) {
  await db.execute(sql`INSERT INTO rate_curves (id, curve_date, kind, as_of, source, points, entered_by)
    VALUES (${id}, ${curveDate}, ${kind}, ${asOf}, ${source}, ${JSON.stringify(points)}::jsonb, ${enteredBy})
    ON CONFLICT (id) DO UPDATE SET as_of = EXCLUDED.as_of, source = EXCLUDED.source, points = EXCLUDED.points, entered_by = EXCLUDED.entered_by`);
}

async function storedIds(): Promise<Set<string>> {
  const r = await db.execute(sql`SELECT id FROM rate_curves`);
  return new Set((r.rows as Array<{ id: string }>).map(x => x.id));
}

// Term SOFR swap PRINTS are only used to measure the Term-vs-OIS basis now (the curve itself
// is derived from OIS — see deriveTermCurve). They're thin and mixed with loan-hedge prints
// at all-in rates (two 2Y prints at 7.5% on 10/16), so only prints within 10 bp of the same
// day's OIS curve CONVERTED TO MONTHLY are kept; the 5-print minimum is applied across the
// trailing window when the basis is measured, not per day.
const termOpts = (ois: ReturnType<typeof buildCurve>) => ({ anchor: new Map(ois.points.map(p => [p.tenor, annualToMonthly(p.rate)])), anchorTol: TERM_CLEAN_TOL_BP / 100, minTrades: 1 });

/** One end-of-day DTCC file → the day's OIS and Term SOFR curves. */
async function ingestEod(e: IndexEntry): Promise<void> {
  const date = fileDate(e.fileName);
  if (!date) return;
  const csv = await downloadCsv(e.fullFilePath);
  const ois = buildCurve(extractSofrSwaps(csv, "ois"));
  const term = buildCurve(extractSofrSwaps(csv, "term"), termOpts(ois));
  for (const [kind, c] of [["ois", ois], ["term", term]] as const) {
    if (!c.points.length) continue;
    await upsert(`${date}|${kind}`, date, kind, c.lastTradeAt ?? `${date}T21:00:00Z`, `DTCC end-of-day ${date} (${c.trades} trades)`, c.points);
  }
}

// Today's intraday slices, kept per slice so each 15-minute refresh only downloads new ones.
const sliceTrades = new Map<number, { date: string; ois: SwapTrade[]; term: SwapTrade[] }>();
async function ingestIntraday(slices: IndexEntry[], deadline: number): Promise<number> {
  const today = nyDate(Date.now());
  const todays = slices.filter(s => nyDate(Date.parse(s.dissemDTM)) === today);
  for (const s of todays) {
    if (sliceTrades.has(s.sliceId) || Date.now() > deadline) continue;
    try {
      const csv = await downloadCsv(s.fullFilePath);
      sliceTrades.set(s.sliceId, { date: today, ois: extractSofrSwaps(csv, "ois"), term: extractSofrSwaps(csv, "term") });
    } catch (err) { logger.warn({ err, file: s.fileName }, "DTCC slice download failed"); }
  }
  for (const [id, v] of sliceTrades) if (v.date !== today) sliceTrades.delete(id);
  const mine = [...sliceTrades.values()].filter(v => v.date === today);
  let oisLive: ReturnType<typeof buildCurve> | null = null;
  for (const kind of ["ois", "term"] as CurveKind[]) {
    const trades = mine.flatMap(v => v[kind]).filter(t => nyDate(t.execMs) === today);
    const c = kind === "ois" ? (oisLive = buildCurve(trades)) : buildCurve(trades, termOpts(oisLive!));
    if (c.points.length) await upsert(`${today}|${kind}-live`, today, `${kind}-live`, c.lastTradeAt ?? new Date().toISOString(), `DTCC intraday ${today} (${c.trades} trades so far)`, c.points);
  }
  return mine.length;
}

/** The newest file of each of the last 12 months (for the sparkline), newest day first. */
// Weekend/holiday files exist but carry a handful of trades (2/28/26 had one SOFR swap), so
// only a full trading day's file counts — a weekday file runs to ~20,000 rows.
const FULL_DAY_ROWS = 5000;
export function filesToBackfill(cum: IndexEntry[], have: Set<string>, months = 12): IndexEntry[] {
  const dated = cum.map(e => ({ e, d: fileDate(e.fileName) }))
    .filter((x): x is { e: IndexEntry; d: string } => !!x.d && (x.e.rowCount == null || x.e.rowCount >= FULL_DAY_ROWS))
    .sort((a, b) => (a.d < b.d ? 1 : -1));
  const want: IndexEntry[] = [];
  if (dated[0] && !have.has(`${dated[0].d}|ois`)) want.push(dated[0].e);
  const seenMonth = new Set<string>();
  for (const x of dated) {
    const m = x.d.slice(0, 7);
    if (seenMonth.has(m)) continue;
    seenMonth.add(m);
    if (seenMonth.size > months) break;
    if (!have.has(`${x.d}|ois`) && !want.includes(x.e)) want.push(x.e);
  }
  return want;
}

let running: Promise<RefreshResult> | null = null;
let lastRun = 0;
export interface RefreshResult { eodIngested: number; intradaySlices: number; skipped?: string; error?: string }

/** Bring stored curves up to date within a time budget — at most every 10 minutes unless
 *  forced. Single-flight per instance; safe to call from any request (the live host only
 *  runs code while it answers one), and from the 15-minute timer. */
export function refreshSwapCurves(budgetMs = 20_000, force = false): Promise<RefreshResult> {
  if (running) return running;
  if (!force && Date.now() - lastRun < 10 * 60_000) return Promise.resolve({ eodIngested: 0, intradaySlices: 0, skipped: "refreshed recently" });
  lastRun = Date.now();
  running = (async (): Promise<RefreshResult> => {
    const deadline = Date.now() + budgetMs;
    const out: RefreshResult = { eodIngested: 0, intradaySlices: 0 };
    try {
      await ensureRateCurvesTable();
      const { cum, slice } = await loadIndex();
      const have = await storedIds();
      for (const e of filesToBackfill(cum, have)) {
        if (Date.now() > deadline - 5000) break;
        try { await ingestEod(e); out.eodIngested++; } catch (err) { logger.warn({ err, file: e.fileName }, "DTCC EOD ingest failed"); }
      }
      // Intraday during New York trading hours on weekdays, at most every 15 minutes.
      const now = Date.now(), dow = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
      const mins = nyMinutes(now);
      // Slices already read are kept in memory, so each pass only downloads the new ones.
      if (dow >= 1 && dow <= 5 && mins >= 7 * 60 && mins <= 18 * 60 + 30) out.intradaySlices = await ingestIntraday(slice, deadline);
    } catch (err) { out.error = err instanceof Error ? err.message : String(err); logger.warn({ err }, "Swap curve refresh failed"); }
    return out;
  })().finally(() => { running = null; });
  return running;
}

interface Row { id: string; curve_date: string; kind: string; as_of: string; source: string; points: Array<CurvePoint | { tenor: number; rate: number }>; entered_by: string | null }
export interface CurveView {
  kind: "dtcc-eod" | "dtcc-intraday" | "manual";
  asOf: string; curveDate: string; source: string; enteredBy: string | null;
  points: Array<{ tenor: number; rate: number; n?: number; nDay?: number; p25?: number; p75?: number; method?: string }>;
  trades: number | null;        // every qualifying trade that day
  tradesUsed: number | null;    // the ones the rates were read from (close window / latest 3h)
}
/** The 1M Term SOFR swap curve, derived from the OIS curve on show (see deriveTermCurve). */
export interface TermCurveView {
  derived: true; fromKind: CurveView["kind"]; asOf: string; curveDate: string; source: string;
  points: TermPoint[]; basisWindowDays: number;
}
export interface SwapCurvesPayload { ois: CurveView | null; term: TermCurveView | null; termPrints: CurveView | null; manualAvailable: CurveView | null; history: Array<{ month: string; y5: number | null; y10: number | null }> }

const BASIS_WINDOW_BDAYS = 20;
/** Term-minus-converted-OIS samples from stored days within the trailing 20 business days. */
export function basisSamples(rows: Array<{ curve_date: string; kind: string; points: Array<{ tenor: number; rate: number; n?: number }> }>, asOfDate: string): BasisSample[] {
  const oisByDate = new Map<string, Map<number, number>>();
  for (const r of rows) if (r.kind === "ois" || r.kind === "ois-live") {
    const d = String(r.curve_date).slice(0, 10);
    if (r.kind === "ois-live" && oisByDate.has(d)) continue;          // end-of-day wins
    oisByDate.set(d, new Map(r.points.map(p => [p.tenor, p.rate])));
  }
  const out: BasisSample[] = [], seen = new Set<string>();
  for (const r of rows) {
    if (r.kind !== "term" && r.kind !== "term-live") continue;
    const d = String(r.curve_date).slice(0, 10);
    if (d > asOfDate || businessDaysBetween(d, asOfDate) >= BASIS_WINDOW_BDAYS) continue;
    if (seen.has(d) && r.kind === "term-live") continue;
    const ois = oisByDate.get(d); if (!ois) continue;
    for (const p of r.points) {
      const o = ois.get(p.tenor); if (o == null) continue;
      out.push({ date: d, tenor: p.tenor, diffBp: (p.rate - annualToMonthly(o)) * 100, n: p.n ?? 1 });
    }
    seen.add(d);
  }
  return out;
}

export function termSourceLabel(t: TermCurveView): string {
  const measured = t.points.filter(p => p.basisSource === "measured");
  const basis = measured.length
    ? `Term basis ${TERM_BASIS_DEFAULT_BP.toFixed(1)}bp default; measured from DTCC Term SOFR prints at ${measured.map(p => `${p.tenor}Y ${p.basisBp >= 0 ? "+" : ""}${p.basisBp.toFixed(1)}bp (${p.basisPrints})`).join(", ")}`
    : `Term basis (${TERM_BASIS_DEFAULT_BP.toFixed(1)}bp)`;
  const from = t.fromKind === "manual" ? "a pasted SOFR OIS curve" : "DTCC SOFR OIS";
  return `Derived from ${from} (${t.curveDate}), converted to monthly + ${basis}`;
}

const toView = (r: Row): CurveView => {
  const kind = r.kind === "manual" ? "manual" : r.kind.endsWith("-live") ? "dtcc-intraday" : "dtcc-eod";
  const pts = r.points as CurveView["points"];
  const trades = kind === "manual" ? null : pts.reduce((s, p) => s + (p.nDay ?? p.n ?? 0), 0);
  const tradesUsed = kind === "manual" ? null : pts.reduce((s, p) => s + (p.n ?? 0), 0);
  return { kind, asOf: new Date(r.as_of).toISOString(), curveDate: String(r.curve_date).slice(0, 10), source: r.source, enteredBy: r.entered_by, points: pts, trades, tradesUsed };
};

/** The curve to show: the most recent of DTCC (end-of-day or intraday) and a pasted curve —
 *  a pasted curve wins until DTCC has something newer. Plus the monthly history. */
export async function getSwapCurves(): Promise<SwapCurvesPayload> {
  await ensureRateCurvesTable();
  const r = await db.execute(sql`SELECT id, curve_date::text AS curve_date, kind, as_of, source, points, entered_by FROM rate_curves WHERE curve_date >= (now() - interval '400 days')::date ORDER BY as_of DESC`);
  const rows = r.rows as unknown as Row[];
  const newest = (kinds: string[]) => rows.find(x => kinds.includes(x.kind)) ?? null;
  const dtcc = newest(["ois", "ois-live"]), manual = newest(["manual"]);
  const pickOis = manual && (!dtcc || Date.parse(manual.as_of) > Date.parse(dtcc.as_of)) ? manual : dtcc;
  const termRow = newest(["term", "term-live"]);
  const oisView = pickOis ? toView(pickOis) : null;
  let term: TermCurveView | null = null;
  if (oisView && oisView.points.length) {
    const t: TermCurveView = { derived: true, fromKind: oisView.kind, asOf: oisView.asOf, curveDate: oisView.curveDate, source: "",
      points: deriveTermCurve(oisView.points, basisSamples(rows, oisView.curveDate)), basisWindowDays: BASIS_WINDOW_BDAYS };
    t.source = termSourceLabel(t);
    term = t;
  }
  const byMonth = new Map<string, Row>();
  for (const x of rows) if (x.kind === "ois") { const m = x.curve_date.slice(0, 7); const cur = byMonth.get(m); if (!cur || x.curve_date > cur.curve_date) byMonth.set(m, x); }
  const at = (x: Row, t: number) => (x.points.find(p => p.tenor === t)?.rate ?? null) as number | null;
  const history = [...byMonth.keys()].sort().slice(-12).map(m => ({ month: m, y5: at(byMonth.get(m)!, 5), y10: at(byMonth.get(m)!, 10) }));
  return { ois: oisView, term, termPrints: termRow ? toView(termRow) : null, manualAvailable: manual ? toView(manual) : null, history };
}

export async function saveManualCurve(points: Array<{ tenor: number; rate: number }>, enteredBy: string, source: string): Promise<void> {
  await ensureRateCurvesTable();
  const today = nyDate(Date.now());
  await upsert(`${today}|manual`, today, "manual", new Date().toISOString(), source || "Pasted curve", points, enteredBy);
}

/** SOFR overnight — NY Fed (free, official). */
export async function fetchSofrOvernight(): Promise<{ rate: number; date: string } | null> {
  const r = await fetchWithTimeout("https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json", 12_000);
  if (!r.ok) return null;
  const j = await r.json() as { refRates?: Array<{ effectiveDate?: string; percentRate?: number }> };
  const x = j.refRates?.[0];
  return x && typeof x.percentRate === "number" && x.effectiveDate ? { rate: x.percentRate, date: x.effectiveDate } : null;
}
