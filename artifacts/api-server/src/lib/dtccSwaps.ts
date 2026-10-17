// SOFR SWAP CURVE FROM DTCC PUBLIC DATA (Eric, 10/17/26 — company-wide priority).
//
// DTCC's free CFTC public price dissemination feed publishes every reported US swap trade:
// an end-of-day CUMULATIVE file per day (≈00:15 UTC the next morning) and intraday SLICES
// every few minutes. We take the plain-vanilla, spot-starting USD SOFR swaps and read the
// curve off the trades themselves — no vendor, no scrape.
//
// TERMS: DTCC's public dissemination data is published for transparency; we use it for
// internal underwriting reference only and label every figure with its source and trade
// count. It is not a dealer quote.
//
// Rules (from Chrome Claude's tested spec, checked against Chatham's 10/15 close):
//   Action type = NEWT · Notional currency-Leg 1 = USD · UPI Underlier Name contains SOFR
//   (OIS / compound = the standard curve; "CME Term" = Term SOFR swaps, kept separately) ·
//   not part of a package · fixed rate from Leg 1 or Leg 2 (decimal) · spot-starting
//   (Effective Date −3…+7 days of execution) · tenor = (Expiration − Effective)/365.25
//   within 0.05y of 1/2/3/5/7/10/15/30.
//   Rate = median per tenor, with n and p25–p75. MEASURED on 10/15: the median of trades
//   executed 1:00–4:30pm ET lands within 0.1–0.7 bp of Chatham's close at every tenor (the
//   whole-day median was 0.3–1.6 bp off; notional-weighting did not help). So the close
//   window is used when it has ≥5 trades, then the latest 3 hours, then the whole day.

export const TENORS = [1, 2, 3, 5, 7, 10, 15, 30] as const;
export type CurveKind = "ois" | "term";
export type CurveMethod = "close-window" | "latest-3h" | "day";

export interface SwapTrade { tenor: number; rate: number; execMs: number; notional: number | null }
export interface CurvePoint { tenor: number; rate: number; n: number; p25: number; p75: number; method: CurveMethod; nDay: number }
export interface SwapCurve { points: CurvePoint[]; trades: number; lastTradeAt: string | null }

/** RFC-4180 CSV (quoted fields, embedded commas/quotes/newlines). Returns header + row arrays. */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return { header, rows };
}

const dayMs = (s: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
};
const instantMs = (s: string): number | null => {
  const t = s.trim(); if (!t) return null;
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t + "Z");
  return Number.isNaN(ms) ? null : ms;
};

/** The plain-vanilla spot-starting SOFR swaps in one DTCC rates file. */
export function extractSofrSwaps(csvText: string, kind: CurveKind): SwapTrade[] {
  const { header, rows } = parseCsv(csvText);
  const col = (name: string) => header.indexOf(name);
  const iAct = col("Action type"), iCcy = col("Notional currency-Leg 1"), iUpi = col("UPI Underlier Name"),
    iPkg = col("Package indicator"), iF1 = col("Fixed rate-Leg 1"), iF2 = col("Fixed rate-Leg 2"),
    iExe = col("Execution Timestamp"), iEff = col("Effective Date"), iExp = col("Expiration Date"), iNot = col("Notional amount-Leg 1");
  if ([iAct, iCcy, iUpi, iF1, iExe, iEff, iExp].some(i => i < 0)) throw new Error("DTCC file is missing expected columns");
  const out: SwapTrade[] = [];
  for (const r of rows) {
    if (r[iAct] !== "NEWT" || r[iCcy] !== "USD") continue;
    const upi = (r[iUpi] ?? "").toUpperCase();
    if (!upi.includes("SOFR")) continue;
    const isTerm = upi.includes("TERM");
    if ((kind === "term") !== isTerm) continue;
    if (iPkg >= 0 && (r[iPkg] ?? "").trim().toUpperCase() === "TRUE") continue;
    const fr = Number((r[iF1] || (iF2 >= 0 ? r[iF2] : "") || "").trim());
    if (!Number.isFinite(fr) || fr <= 0 || fr > 0.25) continue;
    const exe = instantMs(r[iExe] ?? ""), eff = dayMs(r[iEff] ?? ""), exp = dayMs(r[iExp] ?? "");
    if (exe == null || eff == null || exp == null) continue;
    const lagDays = (eff - Date.UTC(new Date(exe).getUTCFullYear(), new Date(exe).getUTCMonth(), new Date(exe).getUTCDate())) / 86_400_000;
    if (lagDays < -3 || lagDays > 7) continue;                       // spot-starting only
    const years = (exp - eff) / 86_400_000 / 365.25;
    const tenor = TENORS.find(t => Math.abs(years - t) <= 0.05);
    if (tenor == null) continue;
    const n = iNot >= 0 ? Number((r[iNot] ?? "").replace(/[,+\s]/g, "")) : NaN;
    out.push({ tenor, rate: Math.round(fr * 100 * 100000) / 100000, execMs: exe, notional: Number.isFinite(n) && n > 0 ? n : null });
  }
  return out;
}

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Minutes since midnight in New York for an instant (DST-correct). */
export function nyMinutes(ms: number): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(ms)).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}
export function nyDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

const CLOSE_FROM = 13 * 60, CLOSE_TO = 16 * 60 + 30, MIN_N = 5;
// Off-market prints (non-standard terms booked as plain swaps) sit far from the pack: on
// 10/16 a handful pulled the 30Y close-window median to 4.649 against a 4.788 day median.
// Trades more than 10 bp from the tenor's whole-day median are left out first.
const OUTLIER_TOL = 0.10;

export interface BuildOptions {
  /** Keep only trades within `anchorTol` of this rate per tenor (Term SOFR swaps are
   *  anchored to the OIS curve — loan-hedge prints at all-in rates are otherwise mixed in). */
  anchor?: Map<number, number>; anchorTol?: number;
  /** Leave out a tenor with fewer trades than this after filtering. */
  minTrades?: number;
}

/** Curve from one trading day's trades: close-window median → latest 3h → whole day. */
export function buildCurve(trades: SwapTrade[], opts: BuildOptions = {}): SwapCurve {
  const points: CurvePoint[] = [];
  let lastTrade = 0;
  for (const t of TENORS) {
    let all = trades.filter(x => x.tenor === t);
    const nDay = all.length;
    const a = opts.anchor?.get(t);
    if (opts.anchor) all = a == null ? [] : all.filter(x => Math.abs(x.rate - a) <= (opts.anchorTol ?? 0.5));
    if (all.length) {
      const dayMed = quantile(all.map(x => x.rate).sort((p, q) => p - q), 0.5);
      all = all.filter(x => Math.abs(x.rate - dayMed) <= OUTLIER_TOL);
    }
    if (!all.length || all.length < (opts.minTrades ?? 1)) continue;
    const last = Math.max(...all.map(x => x.execMs));
    lastTrade = Math.max(lastTrade, last);
    const close = all.filter(x => { const m = nyMinutes(x.execMs); return m >= CLOSE_FROM && m <= CLOSE_TO; });
    const late = all.filter(x => x.execMs >= last - 3 * 3_600_000);
    const [set, method]: [SwapTrade[], CurveMethod] = close.length >= MIN_N ? [close, "close-window"] : late.length >= MIN_N ? [late, "latest-3h"] : [all, "day"];
    const v = set.map(x => x.rate).sort((a, b) => a - b);
    points.push({ tenor: t, rate: r3(quantile(v, 0.5)), n: v.length, p25: r3(quantile(v, 0.25)), p75: r3(quantile(v, 0.75)), method, nDay });
  }
  return { points, trades: trades.length, lastTradeAt: lastTrade ? new Date(lastTrade).toISOString() : null };
}

/** A pasted curve (e.g. from Chatham): "1Y 4.495, 2Y 4.62 …" or one "tenor rate" per line. */
export function parseManualCurve(text: string): Array<{ tenor: number; rate: number }> {
  const out = new Map<number, number>();
  for (const m of text.matchAll(/(\d{1,2})\s*(?:-?\s*(?:y|yr|yrs|year|years)\b)\s*[:=]?\s*(\d{1,2}\.\d{1,4})\s*%?/gi)) {
    const t = Number(m[1]), r = Number(m[2]);
    if ((TENORS as readonly number[]).includes(t) && r > 0 && r < 25) out.set(t, r);
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([tenor, rate]) => ({ tenor, rate }));
}
