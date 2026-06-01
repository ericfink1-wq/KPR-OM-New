// Today's Rates — benchmark interest rates:
//   • Treasury yields (par yield curve) — U.S. Treasury, official daily, free.
//   • 1-month Term SOFR + 5yr/10yr SOFR swaps — scraped from Iron Hound's public
//     "Today's Market" board (ironhound.com). These are the forward-looking Term
//     SOFR and ICE-based swap rates loans quote off of; there is no free official
//     API for them. If the scrape fails, SOFR falls back to the free NY Fed
//     30-day average and swaps are omitted (better empty than wrong).
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

// ── Iron Hound "Today's Market" board — scrape the public homepage for the
//    forward-looking rates with no free official feed: 1-month Term SOFR and the
//    5yr / 10yr SOFR swaps. Sent with a browser User-Agent to clear bot blocks. ─
const IRONHOUND_URL = "https://ironhound.com/";
interface IronhoundData { termSofr1mo: number | null; swap5: number | null; swap10: number | null; asOf: string | null }

async function fetchIronhound(): Promise<IronhoundData> {
  const r = await fetchWithTimeout(IRONHOUND_URL, 12_000, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!r.ok) throw new Error(`Iron Hound HTTP ${r.status}`);
  const html = await r.text();

  // For each labelled row, grab the FIRST percentage that follows the label
  // (that's the "LAST" column; the second % is the day's change). Whitespace is
  // made flexible so HTML between the label and value doesn't matter.
  const grab = (label: string): number | null => {
    const escaped = label.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&").replace(/\s+/g, "\\s*");
    const m = html.match(new RegExp(escaped + "[\\s\\S]{0,400}?(-?\\d+\\.\\d+)\\s*%", "i"));
    if (!m) return null;
    const n = Number(m[1]);
    return isNaN(n) || n <= 0 || n > 15 ? null : n; // sanity range for a rate %
  };

  // "TODAY'S MARKET … June 1st 2026, 2:33 PM" → ISO when parseable, else raw.
  let asOf: string | null = null;
  const dm = html.match(/TODAY'?S\s*MARKET[\s\S]{0,250}?([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?[\s,]+\d{4}[^<\n]*)/i);
  if (dm) {
    const cleaned = dm[1].replace(/(\d{1,2})(st|nd|rd|th)/i, "$1").trim();
    const d = new Date(cleaned);
    asOf = isNaN(d.getTime()) ? dm[1].trim() : d.toISOString();
  }

  return {
    termSofr1mo: grab("SOFR TERM - 1 MONTH"),
    swap5: grab("SOFR SWAP - 5 YEAR"),
    swap10: grab("SOFR SWAP - 10 YEAR"),
    asOf,
  };
}

// Diagnostic: shows exactly what the server gets back from ironhound.com so we
// can tell apart "blocked", "JavaScript-rendered" and "parser missed it".
// Reachable at GET /api/rates/debug-ironhound. Safe to remove once it works.
export async function debugIronhound(): Promise<Record<string, unknown>> {
  try {
    const r = await fetchWithTimeout(IRONHOUND_URL, 12_000, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const html = await r.text();
    const idx = html.search(/SOFR\s*TERM|TODAY'?S\s*MARKET|SOFR\s*SWAP/i);
    const snippet = idx >= 0 ? html.slice(Math.max(0, idx - 80), idx + 320) : html.slice(0, 500);
    const parsed = await fetchIronhound().catch(e => ({ error: e instanceof Error ? e.message : String(e) }));
    return {
      ok: r.ok,
      status: r.status,
      htmlLength: html.length,
      contentType: r.headers.get("content-type"),
      hasTodaysMarket: /TODAY'?S\s*MARKET/i.test(html),
      hasSofrTerm: /SOFR\s*TERM/i.test(html),
      hasSofrSwap: /SOFR\s*SWAP/i.test(html),
      snippet,
      parsed,
    };
  } catch (e) {
    return { fetchError: e instanceof Error ? e.message : String(e) };
  }
}

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
  // The 30-/90-/180-day compounded averages live on the SOFR Averages & Index
  // endpoint ("sofrai"). The plain overnight "sofr" endpoint carries NO average
  // fields — so reading average30day off it always returned null, which is why
  // the 1-month row rendered "—" (the date still populated from effectiveDate).
  const url = "https://markets.newyorkfed.org/api/rates/secured/sofrai/last/1.json";
  const r = await fetchWithTimeout(url, 12_000);
  if (!r.ok) throw new Error(`NY Fed SOFR HTTP ${r.status}`);
  const j = await r.json() as Record<string, unknown>;
  // Be tolerant of the wrapper key: secured-rate endpoints return `refRates`,
  // but fall back to the first array in the payload just in case it changes.
  const arr = (Array.isArray(j.refRates) ? j.refRates : Object.values(j).find(v => Array.isArray(v))) as Array<Record<string, unknown>> | undefined;
  const rec = arr?.[0];
  if (!rec) throw new Error("SOFR: no data");
  const asOf = (rec.effectiveDate as string) ?? null;
  const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? null : n; };
  const rows: RateRow[] = [
    { label: "30-Day Avg SOFR (1-mo)", value: num(rec.average30day), asOf },
    { label: "90-Day Avg SOFR", value: num(rec.average90day), asOf },
  ];
  return { rows, asOf };
}

export async function fetchTodaysRates(): Promise<RatesPayload> {
  const [tres, sofr, iron] = await Promise.allSettled([fetchTreasuries(), fetchSofr(), fetchIronhound()]);

  const treasuries = tres.status === "fulfilled" ? tres.value : { rows: [] as RateRow[], asOf: null };
  const sofrData = sofr.status === "fulfilled" ? sofr.value : { rows: [] as RateRow[], asOf: null };
  const iron2 = iron.status === "fulfilled" ? iron.value : { termSofr1mo: null, swap5: null, swap10: null, asOf: null };

  // SOFR row: prefer Iron Hound's true 1-month Term SOFR (what loans quote off);
  // fall back to the free NY Fed 30-day average if the scrape didn't return it.
  let sofrRows: RateRow[];
  let sofrAsOf: string | null;
  let sofrSource: string;
  if (iron2.termSofr1mo != null) {
    sofrRows = [{ label: "SOFR Term – 1 Month", value: iron2.termSofr1mo, asOf: iron2.asOf }];
    sofrAsOf = iron2.asOf;
    sofrSource = "Iron Hound (Term SOFR)";
  } else {
    sofrRows = sofrData.rows.filter(r => r.label.includes("30-Day"));
    sofrAsOf = sofrData.asOf;
    sofrSource = "NY Fed 30-day avg (Term SOFR unavailable)";
  }

  // SOFR swaps: Iron Hound 5yr & 10yr (omitted entirely if the scrape failed —
  // better to show nothing than a wrong estimate).
  const swapRows: RateRow[] = [];
  if (iron2.swap5 != null) swapRows.push({ label: "SOFR Swap – 5 Year", value: iron2.swap5, asOf: iron2.asOf });
  if (iron2.swap10 != null) swapRows.push({ label: "SOFR Swap – 10 Year", value: iron2.swap10, asOf: iron2.asOf });
  const swapsSource = swapRows.length ? "Iron Hound" : "Unavailable — no free live swap feed";

  return {
    treasuries: { rows: treasuries.rows, asOf: treasuries.asOf, source: "U.S. Treasury (par yield curve)" },
    sofr: { rows: sofrRows, asOf: sofrAsOf, source: sofrSource },
    swaps: { rows: swapRows, asOf: iron2.asOf, source: swapsSource, spreadBps: 0 },
    fetchedAt: new Date().toISOString(),
  };
}
