// Today's Rates — fetches benchmark interest rates from FREE, OFFICIAL sources,
// no API key required:
//   • Treasury yields (par yield curve) — U.S. Treasury fiscaldata API, daily.
//   • 1-month SOFR (30-day Average SOFR) — NY Fed markets API, daily.
//   • 3/5/7yr SOFR swaps — INDICATIVE: matching-tenor Treasury + an adjustable
//     swap spread (there is no free, official real-time SOFR swap feed; ICE Swap
//     Rate is licensed). Clearly labelled indicative so it's never mistaken for a
//     live quote; a paid feed can be dropped in later.
import { fetchWithTimeout } from "./http";

export interface RateRow {
  label: string;
  value: number | null;       // percent, e.g. 4.27
  asOf: string | null;        // ISO date the source published this
  note?: string;              // e.g. "indicative"
}
export interface RatesPayload {
  treasuries: { rows: RateRow[]; asOf: string | null; source: string };
  sofr: { rows: RateRow[]; asOf: string | null; source: string };
  swaps: { rows: RateRow[]; asOf: string | null; source: string; spreadBps: number };
  fetchedAt: string;          // ISO timestamp of this server fetch
}

// Default indicative swap spreads over the matching Treasury (bps). Rough,
// adjustable; only used for the indicative swap estimate.
const DEFAULT_SWAP_SPREADS: Record<string, number> = { "3": 18, "5": 22, "7": 26 };

// ── Treasury par yield curve — Treasury's official daily par-yield XML feed
//    (home.treasury.gov, free, no key, stable documented field names). ─────────
async function fetchTreasuries(): Promise<{ rows: RateRow[]; asOf: string | null }> {
  const year = new Date().getUTCFullYear();
  const url =
    `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  const r = await fetchWithTimeout(url, 12_000);
  if (!r.ok) throw new Error(`Treasury HTTP ${r.status}`);
  const xml = await r.text();
  // The feed is an Atom XML with one <entry> per day; we want the LAST entry.
  // Each entry's <m:properties> holds NEW_DATE plus BC_* tenor fields. Parse the
  // last entry's properties without an XML lib (the format is stable & flat).
  const entries = xml.split(/<entry[\s>]/i);
  const last = entries[entries.length - 1] || "";
  const get = (tag: string): string | null => {
    const m = last.match(new RegExp(`<d:${tag}[^>]*>([^<]*)</d:${tag}>`, "i"));
    return m ? m[1].trim() : null;
  };
  const num = (tag: string): number | null => {
    const v = get(tag);
    const n = v == null || v === "" ? NaN : Number(v);
    return isNaN(n) ? null : n;
  };
  const dateRaw = get("NEW_DATE");
  const asOf = dateRaw ? dateRaw.slice(0, 10) : null;
  const rows: RateRow[] = [
    { label: "1-Mo",  value: num("BC_1MONTH"),  asOf },
    { label: "3-Mo",  value: num("BC_3MONTH"),  asOf },
    { label: "6-Mo",  value: num("BC_6MONTH"),  asOf },
    { label: "1-Yr",  value: num("BC_1YEAR"),   asOf },
    { label: "2-Yr",  value: num("BC_2YEAR"),   asOf },
    { label: "3-Yr",  value: num("BC_3YEAR"),   asOf },
    { label: "5-Yr",  value: num("BC_5YEAR"),   asOf },
    { label: "7-Yr",  value: num("BC_7YEAR"),   asOf },
    { label: "10-Yr", value: num("BC_10YEAR"),  asOf },
    { label: "30-Yr", value: num("BC_30YEAR"),  asOf },
  ];
  if (rows.every(r => r.value == null)) throw new Error("Treasury: parsed no yields");
  return { rows, asOf };
}

// ── 1-month SOFR — NY Fed 30-Day Average SOFR (free, no key) ──────────────────
async function fetchSofr(): Promise<{ rows: RateRow[]; asOf: string | null }> {
  // NY Fed publishes SOFR averages (30/90/180-day) + the SOFR index.
  const url = "https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json";
  const r = await fetchWithTimeout(url, 12_000);
  if (!r.ok) throw new Error(`NY Fed SOFR HTTP ${r.status}`);
  const j = await r.json() as { refRates?: Array<Record<string, unknown>> };
  const rec = j.refRates?.[0];
  if (!rec) throw new Error("SOFR: no data");
  const asOf = (rec.effectiveDate as string) ?? null;
  const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? null : n; };
  const rows: RateRow[] = [
    { label: "SOFR (overnight)", value: num(rec.percentRate), asOf },
    { label: "30-Day Avg SOFR (1-mo floating)", value: num(rec.average30day), asOf },
    { label: "90-Day Avg SOFR", value: num(rec.average90day), asOf },
  ];
  return { rows, asOf };
}

export async function fetchTodaysRates(spreadOverrides?: Record<string, number>): Promise<RatesPayload> {
  const spreads = { ...DEFAULT_SWAP_SPREADS, ...(spreadOverrides ?? {}) };
  const [tres, sofr] = await Promise.allSettled([fetchTreasuries(), fetchSofr()]);

  const treasuries = tres.status === "fulfilled" ? tres.value : { rows: [] as RateRow[], asOf: null };
  const sofrData = sofr.status === "fulfilled" ? sofr.value : { rows: [] as RateRow[], asOf: null };

  // Indicative SOFR swaps = matching-tenor Treasury + spread (bps).
  const tByLabel = new Map(treasuries.rows.map(r => [r.label, r.value]));
  const swapTenors: Array<{ key: string; label: string; tenor: string }> = [
    { key: "3", label: "3-Yr SOFR Swap", tenor: "3-Yr" },
    { key: "5", label: "5-Yr SOFR Swap", tenor: "5-Yr" },
    { key: "7", label: "7-Yr SOFR Swap", tenor: "7-Yr" },
  ];
  const swapRows: RateRow[] = swapTenors.map(({ key, label, tenor }) => {
    const t = tByLabel.get(tenor) ?? null;
    const spread = spreads[key] ?? 0;
    const value = t != null ? Math.round((t + spread / 100) * 1000) / 1000 : null;
    return { label, value, asOf: treasuries.asOf, note: "indicative" };
  });

  return {
    treasuries: { rows: treasuries.rows, asOf: treasuries.asOf, source: "U.S. Treasury (par yield curve)" },
    sofr: { rows: sofrData.rows, asOf: sofrData.asOf, source: "NY Fed (SOFR)" },
    swaps: { rows: swapRows, asOf: treasuries.asOf, source: "Indicative: Treasury + swap spread", spreadBps: 0 },
    fetchedAt: new Date().toISOString(),
  };
}
