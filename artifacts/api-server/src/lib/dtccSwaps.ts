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
//   Rate = median per tenor, with n and p25–p75, of trades EXECUTED on the curve date in the
//   3:00–5:00pm ET close (≥5 trades), else the latest 2 hours, else the whole day — see the
//   re-calibration note at CLOSE_FROM (within 0.8 bp of Chatham at 2Y–10Y on 10/15 + 10/16).

export const TENORS = [1, 2, 3, 5, 7, 10, 15, 30] as const;
export type CurveKind = "ois" | "term";
export type CurveMethod = "close-window" | "day+drift" | "latest-2h" | "day";

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

// RE-CALIBRATED 10/17/26 against Chatham's logged-in closes for 10/15 (flat) and 10/16 (a
// ~3 bp rally). The old 1:00–4:30 window ran ~2.5–3 bp high on 10/16: the DTCC file dated
// 10/16 also carries trades EXECUTED on 10/15 (late reports + the 10/15 evening session),
// and the window only looked at the time of day. Now: only trades executed on the curve
// date, exact duplicate reports dropped, and the close = 3:00–5:00pm ET. Measured over
// 2Y–10Y on both days: 3:00–5:00 mean 0.35 bp / worst 0.8 bp; 3:00–4:15 mean 0.74 / worst
// 2.4 (the 10Y kept rallying after 4:15); 1:00–4:30 worst ~3. Re-check whenever a Chatham
// mark is pasted (the panel logs DTCC-vs-Chatham error per day).
const CLOSE_FROM = 15 * 60, CLOSE_TO = 17 * 60, MIN_N = 5;
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
  /** Only trades EXECUTED on this New York date count. A DTCC file dated D also carries
   *  late-reported trades executed on earlier days; without this they leak into D's close. */
  curveDate?: string;
}

/** Curve from one trading day's trades: 3:00–5:00pm ET median → latest 2h → whole day. */
export function buildCurve(trades: SwapTrade[], opts: BuildOptions = {}): SwapCurve {
  const points: CurvePoint[] = [];
  const dayMedian = new Map<number, number>(), daySet = new Map<number, number[]>();
  if (opts.curveDate) trades = trades.filter(x => nyDate(x.execMs) === opts.curveDate);
  const seen = new Set<string>();
  trades = trades.filter(x => { const k = `${x.tenor}|${x.execMs}|${x.rate}|${x.notional}`; if (seen.has(k)) return false; seen.add(k); return true; });
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
    const late = all.filter(x => x.execMs >= last - 2 * 3_600_000);
    const [set, method]: [SwapTrade[], CurveMethod] = close.length >= MIN_N ? [close, "close-window"] : late.length >= MIN_N ? [late, "latest-2h"] : [all, "day"];
    const v = set.map(x => x.rate).sort((a, b) => a - b);
    points.push({ tenor: t, rate: r3(quantile(v, 0.5)), n: v.length, p25: r3(quantile(v, 0.25)), p75: r3(quantile(v, 0.75)), method, nDay });
    dayMedian.set(t, quantile(all.map(x => x.rate).sort((a, b) => a - b), 0.5));
    daySet.set(t, all.map(x => x.rate).sort((a, b) => a - b));
  }
  // THIN TENORS (10/17/26, checked vs Chatham's 10/16 close): a tenor with too few trades in the
  // close falls back to a wider window, which misses the day's move (1Y +2.5 bp, 15Y +1.7 bp on
  // a ~3 bp rally). Interpolating across tenors is worse — the curve humps at 15Y (a 10Y–30Y line
  // was ~10 bp low). So: its whole-day median + the median move into the close of its two
  // nearest well-traded tenors (close − whole-day). 10/16: 1Y → +0.1 bp, 15Y → +0.6 bp.
  const anchored = points.filter(p => p.method === "close-window" && dayMedian.has(p.tenor));
  if (anchored.length) {
    for (const p of points) {
      if (p.method === "close-window" || !daySet.get(p.tenor)?.length) continue;
      const nb = [...anchored].sort((a, b) => Math.abs(Math.log(a.tenor / p.tenor)) - Math.abs(Math.log(b.tenor / p.tenor))).slice(0, 2);
      const drift = quantile(nb.map(n => n.rate - dayMedian.get(n.tenor)!).sort((a, b) => a - b), 0.5);
      const day = daySet.get(p.tenor)!;
      p.rate = r3(quantile(day, 0.5) + drift); p.p25 = r3(quantile(day, 0.25) + drift); p.p75 = r3(quantile(day, 0.75) + drift);
      p.n = day.length; p.method = "day+drift";
    }
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

// ── 1-MONTH TERM SOFR SWAP CURVE, DERIVED FROM THE OIS CURVE (10/17/26) ──────────────────
// KPR's swapped loans hedge 1M CME Term SOFR (Derivative Advisors MTM report 6/9/26: all 7
// swaps — Bensalem, Brunswick, Concordia, Voorhees, Kokomo, Waterbury, Bolton — index CME
// Term SOFR 1M; only Overland/ONB is Daily Simple SOFR). DTCC carries too few clean Term
// SOFR prints to read that curve directly (10/16: none usable; newest was 9/30 with two
// tenors, 5Y printing ~17 bp ABOVE OIS — the wrong sign, loan-hedge prints at all-in rates).
// So: take the validated OIS curve (annual/annual), convert each tenor to monthly
// compounding, and add a small Term-vs-OIS basis. CHECKED vs Chatham 10/15: OIS 1Y 4.495 →
// 4.405 monthly vs Chatham 1M Term 4.391; 2Y 4.620 → 4.525 vs 4.517 — residual ≈ −1 bp.
/** Default Term-vs-OIS basis by tenor (bp): Chatham's 1M Term column minus its own
 *  annual/annual column converted to monthly, averaged over 10/15 + 10/16/26 (the
 *  conversion reproduced Chatham's Term column within 0.2–1.4 bp at every tenor).
 *  Linear in between; flat beyond the ends. A pasted Chatham mark re-calibrates it. */
export const TERM_BASIS_DEFAULT_BY_TENOR: ReadonlyArray<[number, number]> = [[1, -1.2], [2, -0.7], [3, -0.5], [5, -0.35], [7, -0.3], [10, -0.3], [15, -0.3], [30, -0.2]];
export function defaultTermBasisBp(tenor: number, table: ReadonlyArray<[number, number]> = TERM_BASIS_DEFAULT_BY_TENOR): number {
  if (tenor <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [t1, b1] = table[i];
    if (tenor <= t1) { const [t0, b0] = table[i - 1]; return Math.round((b0 + (b1 - b0) * (tenor - t0) / (t1 - t0)) * 100) / 100; }
  }
  return table[table.length - 1][1];
}
/** Kept for the label when every tenor is on its default. */
export const TERM_BASIS_DEFAULT_BP = -1.0;
export const TERM_BASIS_CLAMP_BP = 5;
export const TERM_BASIS_MIN_PRINTS = 5;
/** A Term print/day-median further than this from converted OIS is contamination, not basis.
 *  Same as the clamp: a real Term-vs-OIS basis is a couple of bp. At 10 bp the old 9/30
 *  day-medians (stored under the earlier ±50 bp filter) passed and pinned 3Y/5Y to the ±5 bp
 *  edges — exactly the stale, thin print the rule says must never move the curve. */
export const TERM_CLEAN_TOL_BP = 5;

/** Annual-compounding rate (%) → the equivalent monthly-compounding rate (%). */
export function annualToMonthly(ratePct: number): number {
  return 12 * (Math.pow(1 + ratePct / 100, 1 / 12) - 1) * 100;
}

/** One day's Term SOFR swap median at a tenor, minus that day's converted OIS rate. */
export interface BasisSample { date: string; tenor: number; diffBp: number; n: number }
export interface TermBasis { bp: number; source: "measured" | "default" | "chatham"; prints: number; days: number }

/** Basis at a tenor: the median of CLEAN samples (|diff| ≤ 5 bp) when they hold ≥5 prints
 *  in total, clamped to ±5 bp; otherwise the −1.0 bp default. A stale or thin print never
 *  moves the curve on its own. */
export function termBasis(samples: BasisSample[], tenor: number, defaultBp = defaultTermBasisBp(tenor)): TermBasis {
  const clean = samples.filter(s => s.tenor === tenor && Number.isFinite(s.diffBp) && Math.abs(s.diffBp) <= TERM_CLEAN_TOL_BP && s.n > 0);
  const prints = clean.reduce((t, s) => t + s.n, 0);
  if (prints < TERM_BASIS_MIN_PRINTS) return { bp: defaultBp, source: "default", prints, days: clean.length };
  const expanded = clean.flatMap(s => Array(Math.round(s.n)).fill(s.diffBp) as number[]).sort((a, b) => a - b);
  const med = quantile(expanded, 0.5);
  const bp = Math.max(-TERM_BASIS_CLAMP_BP, Math.min(TERM_BASIS_CLAMP_BP, Math.round(med * 10) / 10));
  return { bp, source: "measured", prints, days: clean.length };
}

export interface TermPoint { tenor: number; rate: number; oisRate: number; monthly: number; basisBp: number; basisSource: TermBasis["source"]; basisPrints: number; n?: number; p25?: number; p75?: number }

// ── CHATHAM MARK (pasted by a person — never scraped: Chatham is behind a login and carries a
//    CME licensing notice). Text copied from cf.com/rates/us: a 1M Term SOFR swap table and a
//    SOFR (annual/annual) table, plus the 1M Term SOFR spot. Parsed, PREVIEWED, then saved. ──
export interface ChathamMark { date: string | null; ois: Array<{ tenor: number; rate: number }>; term: Array<{ tenor: number; rate: number }>; termSofr1m: number | null; warnings: string[] }

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function findDate(text: string): string | null {
  const a = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/.exec(text);
  if (a) return `${a[3]}-${a[1].padStart(2, "0")}-${a[2].padStart(2, "0")}`;
  const b = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i.exec(text);
  if (b) return `${b[3]}-${String(MONTHS.indexOf(b[1].slice(0, 3).toLowerCase()) + 1).padStart(2, "0")}-${b[2].padStart(2, "0")}`;
  const c = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  return c ? `${c[1]}-${c[2]}-${c[3]}` : null;
}

const RATE = /(?<![\d.\-+])(\d{1,2}\.\d{2,6})\s*%?/g;
const TENOR = /\b(\d{1,2})\s*-?\s*(?:y|yr|yrs|year|years)\b/i;
const isTermHeader = (l: string) => /term/i.test(l) && /sofr|swap|1\s*-?\s*m/i.test(l);
const isOisHeader = (l: string) => /annual\s*\/?\s*annual|\bOIS\b|compound/i.test(l);

/** Parse the Chatham page text. Section headers decide which column a rate belongs to; a line
 *  carrying two rates takes the order of the last header that named both. Change/bp columns
 *  are ignored (a rate must be 0.5–15% and the pair within 50 bp of each other). */
export function parseChathamMark(text: string): ChathamMark {
  const ois = new Map<number, number>(), term = new Map<number, number>(), warnings: string[] = [];
  let section: "ois" | "term" | null = null, pairOrder: Array<"ois" | "term"> = ["term", "ois"];
  let termSofr1m: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const tenor = TENOR.exec(line);
    const rates = [...line.matchAll(RATE)].map(m => Number(m[1])).filter(r => r >= 0.5 && r <= 15);
    if (!tenor) {
      const t = isTermHeader(line), o = isOisHeader(line);
      if (t && o) { const it = line.search(/term/i), io = line.search(/annual|OIS|compound/i); pairOrder = it < io ? ["term", "ois"] : ["ois", "term"]; section = null; }
      else if (t) section = "term"; else if (o) section = "ois";
      if (t && !o && rates.length && /(1\s*-?\s*m(onth)?|one[- ]month)/i.test(line) && !/swap/i.test(line) && termSofr1m == null) termSofr1m = rates[0];
      continue;
    }
    const t = Number(tenor[1]);
    if (!TENORS.includes(t as typeof TENORS[number]) && ![4, 6, 8, 9, 12, 20, 25].includes(t)) continue;
    const after = line.slice((tenor.index ?? 0) + tenor[0].length);
    const rs = [...after.matchAll(RATE)].map(m => Number(m[1])).filter(r => r >= 0.5 && r <= 15);
    if (!rs.length) continue;
    if (rs.length >= 2 && Math.abs(rs[0] - rs[1]) <= 0.5 && section == null) {
      const [a, b] = pairOrder; (a === "term" ? term : ois).set(t, rs[0]); (b === "term" ? term : ois).set(t, rs[1]);
    } else if (section) (section === "term" ? term : ois).set(t, rs[0]);
    else warnings.push(`Couldn't tell which table "${line.slice(0, 40)}" belongs to`);
  }
  const sorted = (m: Map<number, number>) => [...m.entries()].sort((a, b) => a[0] - b[0]).map(([tenor, rate]) => ({ tenor, rate }));
  const out: ChathamMark = { date: findDate(text), ois: sorted(ois), term: sorted(term), termSofr1m, warnings };
  if (!out.date) warnings.push("No date found — it will be saved for today");
  for (const p of out.term) { const o = ois.get(p.tenor); if (o != null && Math.abs(annualToMonthly(o) - p.rate) > 0.05) warnings.push(`${p.tenor}Y: Term ${p.rate} vs annual/annual ${o} looks off (>5 bp after conversion) — check the columns`); }
  return out;
}

/** Term-vs-OIS basis by tenor measured from a Chatham mark (its own two columns). */
export function chathamBasis(mark: Pick<ChathamMark, "ois" | "term">): Array<[number, number]> {
  const ois = new Map(mark.ois.map(p => [p.tenor, p.rate]));
  return mark.term.filter(p => ois.has(p.tenor)).map(p => [p.tenor, Math.round((p.rate - annualToMonthly(ois.get(p.tenor)!)) * 1000) / 10] as [number, number]).sort((a, b) => a[0] - b[0]);
}

/** The 1M Term SOFR swap curve for every tenor the OIS curve has. `chathamBasis` (bp by
 *  tenor, from the latest pasted Chatham mark) outranks DTCC prints and the defaults. */
export function deriveTermCurve(ois: Array<{ tenor: number; rate: number; n?: number; p25?: number; p75?: number }>, samples: BasisSample[], chathamBasis?: ReadonlyArray<[number, number]> | null): TermPoint[] {
  return ois.map(p => {
    const b: TermBasis = chathamBasis && chathamBasis.length
      ? { bp: defaultTermBasisBp(p.tenor, chathamBasis), source: "chatham", prints: 0, days: 0 }
      : termBasis(samples, p.tenor);
    const monthly = annualToMonthly(p.rate);
    const shift = (x: number) => r3(annualToMonthly(x) + b.bp / 100);
    return { tenor: p.tenor, rate: r3(monthly + b.bp / 100), oisRate: p.rate, monthly: r3(monthly), basisBp: b.bp, basisSource: b.source, basisPrints: b.prints,
      n: p.n, p25: p.p25 != null ? shift(p.p25) : undefined, p75: p.p75 != null ? shift(p.p75) : undefined };
  });
}

/** Weekdays strictly after `from` up to and including `to` (ISO dates). */
export function businessDaysBetween(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z"), b = Date.parse(to + "T00:00:00Z");
  if (!(b > a)) return 0;
  let n = 0;
  for (let t = a + 86_400_000; t <= b; t += 86_400_000) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) n++; }
  return n;
}
