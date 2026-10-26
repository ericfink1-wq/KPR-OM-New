import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { fetchWithTimeout } from "./http";

// INDEX HISTORY for the rate detail panel (Eric, 10/26/26). Public, key-free sources only:
// FRED's fredgraph.csv (SOFR since 2018-04-03, DGS10) for the long history, topped up with the
// NY Fed's own SOFR API (FRED lags it by a day). 1M Term SOFR history is CME-licensed, so it is
// NEVER fetched or scraped — the panel charts Daily SOFR as a labelled proxy.
// Stored in the existing rate_curves table (kind "index-history", id `history|<SERIES>`,
// points = [[YYYY-MM-DD, rate | null], …]) — NO new table. A missing print stays null so the
// chart shows a gap instead of a drawn-in line.

// Today's Rates panel (10/26/26) added the 30-Day Average SOFR and the Treasury tenors.
export type HistorySeries = "SOFR" | "SOFR30" | "DGS1" | "DGS2" | "DGS3" | "DGS5" | "DGS7" | "DGS10" | "DGS30";
interface SeriesMeta { label: string; fredId: string; from: string; source: string; nyFed?: { path: string; field: string; type: string } }
const tsy = (y: number): SeriesMeta => ({ label: `${y}-Year Treasury (constant maturity)`, fredId: `DGS${y}`, from: "2018-01-01", source: `FRED (DGS${y}, U.S. Treasury constant maturity)` });
export const HISTORY_SERIES: Record<HistorySeries, SeriesMeta> = {
  SOFR: { label: "SOFR (overnight, NY Fed)", fredId: "SOFR", from: "2018-04-02", source: "NY Fed SOFR (FRED as backup)", nyFed: { path: "sofr", field: "percentRate", type: "SOFR" } },
  SOFR30: { label: "30-Day Average SOFR (NY Fed)", fredId: "SOFR30DAYAVG", from: "2018-05-02", source: "NY Fed SOFR Averages (FRED as backup)", nyFed: { path: "sofrai", field: "average30day", type: "SOFRAI" } },
  DGS1: tsy(1), DGS2: tsy(2), DGS3: tsy(3), DGS5: tsy(5), DGS7: tsy(7), DGS10: tsy(10), DGS30: tsy(30),
};
export type HistoryPoint = [string, number | null];
export interface HistoryView { series: HistorySeries; label: string; source: string; asOf: string | null; fetchedAt: string | null; points: HistoryPoint[] }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const sane = (v: number) => Number.isFinite(v) && v > -5 && v < 30;

/** fredgraph.csv → points. "." (or blank) = no print that day → null, never dropped or filled. */
export function parseFredCsv(text: string): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [d, raw] = line.split(",").map(x => (x ?? "").trim());
    if (!ISO.test(d ?? "")) continue;
    const v = raw === "" || raw === "." ? null : Number(raw);
    out.push([d, v != null && sane(v) ? v : null]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** NY Fed refRates JSON → points (SOFR's percentRate by default; the averages endpoint's average30day). */
export function parseNyFed(json: unknown, field = "percentRate", type = "SOFR"): HistoryPoint[] {
  const rows = (json as { refRates?: Array<Record<string, unknown>> })?.refRates ?? [];
  return rows.filter(r => (!r.type || r.type === type) && ISO.test(String(r.effectiveDate ?? "")) && typeof r[field] === "number" && sane(r[field] as number))
    .map(r => [String(r.effectiveDate), r[field] as number] as HistoryPoint).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** Later sources win per date; a real value never gets overwritten by a null. */
export function mergePoints(...sets: HistoryPoint[][]): HistoryPoint[] {
  const m = new Map<string, number | null>();
  for (const set of sets) for (const [d, v] of set) if (v != null || !m.has(d)) m.set(d, v);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

const STALE_MS = 12 * 3_600_000;
const inflight = new Map<HistorySeries, Promise<HistoryView>>();

async function readStored(series: HistorySeries): Promise<{ points: HistoryPoint[]; as_of: string; source: string } | null> {
  const r = await db.execute(sql`SELECT points, as_of, source FROM rate_curves WHERE id = ${`history|${series}`}`);
  const row = (r.rows as Array<{ points: HistoryPoint[]; as_of: string; source: string }>)[0];
  return row ? { points: Array.isArray(row.points) ? row.points : [], as_of: new Date(row.as_of).toISOString(), source: row.source } : null;
}

// FRED's edge rejects some clients (a bare "node" user agent gets a 503/403), so identify the
// app and retry a couple of times.
const UA = { "user-agent": "KPR-OM/1.0 (+https://kpr-oms.replit.app)", accept: "text/csv,application/json,*/*" };
async function getText(url: string, tries = 3): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetchWithTimeout(url, 15_000, { headers: UA }); if (r.ok) return await r.text(); } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 600 * (i + 1)));
  }
  return null;
}
/** SOFR + 30-day average: the NY Fed's own API (the official source; its search returns the whole
 *  history in one call), FRED as the backup. Treasuries: FRED. `complete` = the long history came back. */
async function fetchSeries(series: HistorySeries, stored: HistoryPoint[]): Promise<{ points: HistoryPoint[]; complete: boolean }> {
  const meta = HISTORY_SERIES[series];
  let fed: HistoryPoint[] = [], fred: HistoryPoint[] = [];
  if (meta.nyFed) {
    const t = await getText(`https://markets.newyorkfed.org/api/rates/secured/${meta.nyFed.path}/search.json?startDate=${meta.from}&endDate=${new Date().toISOString().slice(0, 10)}`, 2);
    try { fed = t ? parseNyFed(JSON.parse(t), meta.nyFed.field, meta.nyFed.type) : []; } catch { fed = []; }
  }
  if (!meta.nyFed || fed.length < 1000) {
    const t = await getText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${meta.fredId}&cosd=${meta.from}`);
    fred = t ? parseFredCsv(t) : [];
  }
  if (!fred.length && !fed.length) throw new Error(`no ${series} history returned`);
  // FRED's "." days stay null; the NY Fed fills any day it has a print for.
  return { points: mergePoints(stored, fred, fed), complete: fed.length >= 1000 || fred.length >= 1000 };
}
const RETRY_MS = 15 * 60_000;

/** Cached daily: refetches when the stored copy is >12 h old; on any failure serves what is stored. */
export function getIndexHistory(series: HistorySeries, force = false): Promise<HistoryView> {
  const running = inflight.get(series);
  if (running) return running;
  const p = (async (): Promise<HistoryView> => {
    const meta = HISTORY_SERIES[series];
    const stored = await readStored(series).catch(() => null);
    let points = stored?.points ?? [], fetchedAt = stored?.as_of ?? null;
    if (force || !stored || Date.now() - Date.parse(stored.as_of) > STALE_MS) {
      try {
        const got = await fetchSeries(series, points);
        points = got.points;
        // An incomplete pull is stored but stamped old enough to be retried in 15 minutes.
        fetchedAt = new Date(Date.now() - (got.complete ? 0 : STALE_MS - RETRY_MS)).toISOString();
        const last = [...points].reverse().find(x => x[1] != null)?.[0] ?? fetchedAt.slice(0, 10);
        await db.execute(sql`INSERT INTO rate_curves (id, curve_date, kind, as_of, source, points)
          VALUES (${`history|${series}`}, ${last}, 'index-history', ${fetchedAt}, ${meta.source}, ${JSON.stringify(points)}::jsonb)
          ON CONFLICT (id) DO UPDATE SET curve_date = EXCLUDED.curve_date, as_of = EXCLUDED.as_of, source = EXCLUDED.source, points = EXCLUDED.points`);
      } catch { /* keep the stored copy */ }
    }
    const asOf = [...points].reverse().find(x => x[1] != null)?.[0] ?? null;
    return { series, label: meta.label, source: meta.source, asOf, fetchedAt, points };
  })().finally(() => inflight.delete(series));
  inflight.set(series, p);
  return p;
}
