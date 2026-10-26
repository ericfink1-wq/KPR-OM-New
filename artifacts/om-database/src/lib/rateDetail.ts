import { fmtMoney } from "./money";
import type { RatesPayload } from "./api";
import { isDailySofr, marketSwapRate, termSofrSpot, recordSources, loanExtensionNotice, type AmRecord, type DebtRow, type RateCap, type SwapRow } from "./assetMgmt";

// RATE DETAIL PANEL (Eric, 10/26/26) — the math behind clicking a Rate / All-in / swap cell.
// Pure and deterministic. Nothing here guesses: a term that isn't on the record is "not
// documented", a missing index print is a GAP (null), and loans/swaps with terms pending get
// no effective-rate line at all.
//
// Index history: Daily SOFR (NY Fed / FRED) is charted for EVERY SOFR loan. 1M Term SOFR
// history is CME-licensed and is never fetched, so Term-SOFR loans use Daily SOFR as a
// labelled proxy (TERM_PROXY_NOTE), with today's 1M Term SOFR spot as the latest point.

export type IndexPoint = [string, number | null];
export const TERM_PROXY_NOTE = "Daily SOFR shown as proxy for 1M Term SOFR; typically within ~5-10 bp";
const DAY = 86_400_000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const n = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const s = (v: unknown): string | null => (v == null || String(v).trim() === "" ? null : String(v).trim());
const isoDay = (v: unknown): string | null => { const t = s(v); return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null; };
const ms = (iso: string) => Date.parse(iso + "T00:00:00Z");
const addDays = (iso: string, k: number) => new Date(ms(iso) + k * DAY).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtShortDate = (iso: string | null | undefined): string => { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}/${y.slice(2)}`; };
export const fmtPeriod = (p: string) => `${MON[Number(p.slice(4, 6)) - 1]}-${p.slice(2, 4)}`;
const pct = (v: number | null | undefined, dp = 3) => (v == null ? "—" : `${(+v.toFixed(dp)).toString()}%`);

// ── Terms ────────────────────────────────────────────────────────────────────
export interface HedgeLeg { id: string; label: string; counterparty: string | null; notional: number | null; fixedSwapRatePct: number | null; allInPct: number | null; effective: string | null; maturity: string | null; pending: boolean; record: AmRecord }
export interface RateTerms {
  dealId: string; property: string; loanLabel: string | null; lender: string | null; record: AmRecord | null;
  rateClass: DebtRow["rateClass"]; index: string | null; daily: boolean;
  spreadBps: number | null; floorPct: number | null; caps: RateCap[]; fixedRatePct: number | null;
  balance: number | null; closing: string | null; maturity: string | null; amortizing: boolean;
  extensionOptions: string | null; extensionNotice: { start: string; end: string | null } | null;
  swaps: HedgeLeg[];
  /** Set when an effective-rate line can't be drawn honestly. */
  pending: string | null;
}
const legOf = (w: SwapRow): HedgeLeg => ({
  id: w.record.id, label: s(w.record.data.swapLabel) ?? w.loanLabel ?? "Swap", counterparty: w.counterparty, notional: w.notional,
  fixedSwapRatePct: w.fixedSwapRatePct, allInPct: w.allInFixedPct, effective: isoDay(w.effective), maturity: isoDay(w.maturity), pending: w.termsPending, record: w.record,
});
export function termsFromDebtRow(row: DebtRow): RateTerms {
  const d = row.record.data;
  const swaps = row.swaps.map(legOf);
  const t: RateTerms = {
    dealId: row.dealId, property: row.property, loanLabel: row.loanLabel, lender: row.lender, record: row.record,
    rateClass: row.rateClass, index: row.index, daily: isDailySofr(row.index), spreadBps: row.spreadBps, floorPct: row.floorPct, caps: row.caps,
    fixedRatePct: n(d.fixedRatePct) ?? (row.rateClass === "fixed" ? row.allInPct : null),
    balance: row.balance, closing: isoDay(d.originationDate), maturity: isoDay(d.maturityDate),
    amortizing: !!n(d.amortYears) || /amortiz/i.test(String(d.amortization ?? "")),
    extensionOptions: s(d.extensionOptions), extensionNotice: loanExtensionNotice(d), swaps, pending: null,
  };
  t.pending = pendingReason(t);
  return t;
}
/** A swap with no linked loan: priced as the hedge alone (notional at its all-in). */
export function termsFromSwap(w: SwapRow): RateTerms {
  const leg = legOf(w);
  const t: RateTerms = {
    dealId: w.dealId, property: w.property, loanLabel: w.loanLabel, lender: null, record: null, rateClass: "swapped", index: s(w.record.data.index), daily: isDailySofr(s(w.record.data.index)),
    spreadBps: n(w.record.data.spreadBps) ?? (leg.allInPct != null && leg.fixedSwapRatePct != null ? Math.round((leg.allInPct - leg.fixedSwapRatePct) * 10000) / 100 : null),
    floorPct: null, caps: [], fixedRatePct: null, balance: w.notional, closing: leg.effective, maturity: leg.maturity, amortizing: false,
    extensionOptions: null, extensionNotice: null, swaps: [leg], pending: null,
  };
  t.pending = pendingReason(t);
  return t;
}
function pendingReason(t: RateTerms): string | null {
  if (t.swaps.some(w => w.pending)) return "swap terms pending";
  if (t.rateClass === "fixed") return t.fixedRatePct == null ? "fixed rate not documented" : null;
  if (!t.rateClass) return "rate type not documented";
  const fullySwapped = t.swaps.length && t.balance != null && t.swaps.reduce((a, w) => a + (w.notional ?? 0), 0) >= t.balance * 0.995;
  if (t.spreadBps == null && !fullySwapped) return "loan spread not documented";
  if (t.swaps.some(w => w.allInPct == null || w.notional == null)) return "swap all-in or notional not documented";
  return null;
}

// ── Rate on a date ───────────────────────────────────────────────────────────
export type Regime = "fixed" | "swap" | "partial swap" | "cap" | "floating";
export interface RateOn { unhedged: number | null; effective: number | null; regime: Regime | null }
const capOn = (caps: RateCap[], date: string): number | null => {
  const live = caps.filter(c => !c.expiry || c.expiry >= date);
  return live.length ? Math.max(...live.map(c => c.strikePct)) : null;
};
const legLive = (w: HedgeLeg, date: string, closing: string | null) => (w.effective ?? closing ?? "0000") <= date && (!w.maturity || w.maturity >= date);
/** Index `ix` (%) on `date` → the unhedged cost (index floored + spread) and the rate actually
 *  paid: flat swap all-in while a swap is live (blended on a partial swap), min(index, cap
 *  strike) + spread while a cap is live, floating otherwise. Outside the loan's life → nulls. */
export function rateOn(t: RateTerms, date: string, ix: number | null): RateOn {
  if ((t.closing && date < t.closing) || (t.maturity && date > t.maturity)) return { unhedged: null, effective: null, regime: null };
  if (t.rateClass === "fixed") return { unhedged: t.fixedRatePct, effective: t.pending ? null : t.fixedRatePct, regime: "fixed" };
  const floored = ix == null ? null : t.floorPct != null ? Math.max(ix, t.floorPct) : ix;
  const unhedged = floored == null || t.spreadBps == null ? null : r4(floored + t.spreadBps / 100);
  const strike = capOn(t.caps, date);
  const floating = floored == null || t.spreadBps == null ? null : r4((strike != null ? Math.min(floored, Math.max(strike, t.floorPct ?? strike)) : floored) + t.spreadBps / 100);
  if (t.pending) return { unhedged, effective: null, regime: null };
  const live = t.swaps.filter(w => legLive(w, date, t.closing) && w.notional != null && w.allInPct != null);
  if (live.length) {
    const swapped = live.reduce((a, w) => a + w.notional!, 0);
    const allIn = live.reduce((a, w) => a + w.notional! * w.allInPct!, 0) / swapped;
    const B = t.balance ?? swapped;
    if (swapped >= B * 0.995) return { unhedged, effective: r4(allIn), regime: "swap" };
    return { unhedged, effective: floating == null ? null : r4((swapped * allIn + (B - swapped) * floating) / B), regime: "partial swap" };
  }
  return { unhedged, effective: floating, regime: strike != null ? "cap" : "floating" };
}

// ── Rate build (section 1) ───────────────────────────────────────────────────
export interface BuildLine { label: string; value: string; source: string | null; missing: boolean; sub?: boolean }
/** Hover text for a figure: the record's own sources (matched by usedFor), else its source note. */
export function sourceFor(rec: AmRecord | null, field: RegExp): string | null {
  if (!rec) return null;
  const { sources } = recordSources(rec);
  const hit = sources.find(x => (x.usedFor ?? []).some(u => field.test(u))) ?? (sources.length === 1 ? sources[0] : null);
  if (hit) return `Source: ${[hit.title, hit.status, hit.date].filter(Boolean).join(" · ")}`;
  return rec.sourceNote ? `Source: ${rec.sourceNote}` : null;
}
const ND = "not documented";
export function rateBuild(t: RateTerms, rates: RatesPayload | null, today: Date): { lines: BuildLine[]; after: string[] } {
  const todayIso = today.toISOString().slice(0, 10);
  const L: BuildLine[] = [];
  const line = (label: string, value: string | null, source: string | null, sub = false) => L.push({ label, value: value ?? ND, source: value == null ? null : source, missing: value == null, sub });
  const rec = t.record;
  if (t.rateClass === "fixed") {
    line("Rate type", "Fixed", sourceFor(rec, /rate/i));
    line("Note rate", t.fixedRatePct != null ? pct(t.fixedRatePct) : null, sourceFor(rec, /rate/i));
  } else {
    const spot = t.daily ? (rates?.sofrOvernight ? { rate: rates.sofrOvernight.rate, asOf: rates.sofrOvernight.date } : null) : termSofrSpot(rates);
    line("Index", t.index ?? (t.rateClass ? "1M Term SOFR (assumed — index not written on the loan)" : null), sourceFor(rec, /index|rate/i));
    if (spot?.rate != null) line(`Current ${t.daily ? "Daily SOFR" : "1M Term SOFR"}`, `${pct(spot.rate)}${spot.asOf ? ` (${fmtShortDate(spot.asOf.slice(0, 10))})` : ""}`, t.daily ? "NY Fed" : "1M Term SOFR spot (rates panel)");
    else L.push({ label: `Current ${t.daily ? "Daily SOFR" : "1M Term SOFR"}`, value: "not available right now", source: null, missing: true });
    line("Spread", t.spreadBps != null ? `${t.spreadBps} bps` : null, sourceFor(rec, /spread|margin|rate/i));
    line("Index floor", t.floorPct != null ? pct(t.floorPct, 2) : t.rateClass ? "none on file" : null, sourceFor(rec, /floor/i));
    if (t.caps.length) for (const c of t.caps) line("Rate cap", `${pct(c.strikePct, 2)} strike${c.notional ? ` on ${fmtMoney(c.notional)}` : ""}${c.expiry ? ` · expires ${fmtShortDate(c.expiry)}${c.expiry < todayIso ? " (expired)" : ""}` : " · expiry not documented"}`, sourceFor(rec, /cap|hedge/i));
    else if (t.rateClass === "capped") line("Rate cap", null, null);
  }
  for (const w of t.swaps) {
    const src = sourceFor(w.record, /swap|rate|hedge/i);
    line(`Swap${t.swaps.length > 1 ? ` — ${w.label}` : ""}`, w.counterparty ?? "counterparty not documented", src);
    line("Fixed swap rate", w.fixedSwapRatePct != null ? pct(w.fixedSwapRatePct, 4) : null, src, true);
    line("All-in fixed", w.allInPct != null ? pct(w.allInPct, 4) : null, src, true);
    line("Notional", w.notional != null ? fmtMoney(w.notional, { below: "full" }) : null, src, true);
    line("Effective → maturity", w.effective || w.maturity ? `${w.effective ? fmtShortDate(w.effective) : ND} → ${w.maturity ? fmtShortDate(w.maturity) : ND}` : null, src, true);
  }
  const liveNotional = t.swaps.filter(w => legLive(w, todayIso, t.closing)).reduce((a, w) => a + (w.notional ?? 0), 0);
  if (t.balance != null && liveNotional > 0 && liveNotional < t.balance * 0.995)
    line("Hedge split", `${fmtMoney(liveNotional)} swapped of ${fmtMoney(t.balance)} (${Math.round((liveNotional / t.balance) * 100)}%) — ${fmtMoney(t.balance - liveNotional)} floats`, null);
  line("Balance", t.balance != null ? fmtMoney(t.balance, { below: "full" }) : null, sourceFor(rec, /balance|loan/i));
  line("Loan closing", t.closing ? fmtShortDate(t.closing) : null, sourceFor(rec, /clos|origin|date/i));
  line("Loan maturity", t.maturity ? fmtShortDate(t.maturity) : null, sourceFor(rec, /matur|date/i));
  if (t.extensionOptions) line("Extension options", t.extensionOptions, sourceFor(rec, /exten/i));
  // Same index fallback as the Debt table's All-in: Daily → overnight SOFR, else 1M Term spot, each backing up the other.
  const ixToday = t.daily ? rates?.sofrOvernight?.rate ?? termSofrSpot(rates).rate : termSofrSpot(rates).rate ?? rates?.sofrOvernight?.rate ?? null;
  const eff = rateOn(t, todayIso, ixToday);
  line("Effective rate today", eff.effective != null ? `${pct(eff.effective)} (${eff.regime}${!t.daily && termSofrSpot(rates).rate == null && eff.regime !== "swap" && eff.regime !== "fixed" ? ", overnight SOFR as index" : ""})` : t.pending ? `— (${t.pending})` : null, null);
  return { lines: L, after: afterHedge(t, rates, today) };
}

/** What happens when a hedge ends before the loan does (Overland swap 2/15/30 vs loan 7/15/31). */
export function afterHedge(t: RateTerms, rates: RatesPayload | null, today: Date): string[] {
  const out: string[] = [];
  const todayIso = today.toISOString().slice(0, 10);
  const ends = [...t.swaps.filter(w => w.maturity).map(w => ({ what: `${t.swaps.length > 1 ? `${w.label} swap` : "Swap"}`, date: w.maturity! })),
    ...t.caps.filter(c => c.expiry).map(c => ({ what: `${pct(c.strikePct, 2)} cap`, date: c.expiry! }))];
  for (const e of ends) {
    if (!t.maturity) { out.push(`${e.what} ends ${fmtShortDate(e.date)}; loan maturity not documented.`); continue; }
    if (e.date >= t.maturity) { out.push(`${e.what} runs to ${fmtShortDate(e.date)}, covering the loan to maturity (${fmtShortDate(t.maturity)}).`); continue; }
    const gapDays = Math.round((ms(t.maturity) - ms(e.date)) / DAY);
    const gap = gapDays >= 60 ? `${Math.round(gapDays / 30.44)} months` : `${gapDays} days`;
    let tail = "";
    if (e.date >= todayIso && rates) {
      const fw = forwardView(t, rates, today);
      const after = fw?.months.filter(m => m.date > e.date && m.effective != null) ?? [];
      if (after.length) {
        const avg = after.reduce((a, m) => a + m.effective!, 0) / after.length;
        tail = ` Floating after that at ~${pct(avg, 2)} on today's forward curve (indicative)${t.balance ? `, ~${fmtMoney((t.balance * avg) / 100)}/yr interest` : ""}.`;
      } else if (t.spreadBps == null) tail = " The floating rate after that can't be projected — spread not documented.";
    }
    out.push(`${e.what} ends ${fmtShortDate(e.date)}, loan matures ${fmtShortDate(t.maturity)} — ${gap} unhedged.${tail}`);
  }
  return out;
}

// ── History (section 2) ──────────────────────────────────────────────────────
export interface HistoryRow { t: number; date: string; index: number | null; unhedged: number | null; effective: number | null; termSpot?: boolean }
/** Chart rows on real print dates only. A missing print stays null and a >5-day hole in the
 *  series gets a null break row, so the chart shows the gap instead of drawing across it. */
export function historySeries(t: RateTerms, sofr: IndexPoint[], opts: { from?: string | null; to: string; termSpot?: { rate: number | null; asOf: string | null } | null }): HistoryRow[] {
  const from = opts.from ?? "0000-00-00";
  const rows: HistoryRow[] = [];
  let prev: string | null = null;
  const pts = sofr.filter(([d]) => d >= from && d <= opts.to);
  // Term-SOFR loans: today's 1M Term SOFR spot replaces/extends the last point (flagged).
  const spot = !t.daily && opts.termSpot?.rate != null && opts.termSpot.asOf ? { d: opts.termSpot.asOf.slice(0, 10), v: opts.termSpot.rate } : null;
  const series: Array<[string, number | null, boolean]> = pts.map(([d, v]) => [d, v, false]);
  if (spot && spot.d >= from && spot.d <= opts.to) {
    const i = series.findIndex(x => x[0] === spot.d);
    if (i >= 0) series[i] = [spot.d, spot.v, true]; else if (!series.length || spot.d > series[series.length - 1][0]) series.push([spot.d, spot.v, true]);
  }
  for (const [d, v, isSpot] of series) {
    if (prev && ms(d) - ms(prev) > 5 * DAY) rows.push({ t: ms(prev) + DAY, date: addDays(prev, 1), index: null, unhedged: null, effective: null });
    const r = rateOn(t, d, v);
    rows.push({ t: ms(d), date: d, index: v, unhedged: v == null ? null : r.unhedged, effective: t.rateClass === "fixed" || v != null ? r.effective : null, ...(isSpot ? { termSpot: true } : {}) });
    prev = d;
  }
  return rows;
}
/** Thin a long series for drawing by keeping every k-th REAL row (no new values made up);
 *  null break rows and the last row are always kept. */
export function thin(rows: HistoryRow[], max = 900): HistoryRow[] {
  if (rows.length <= max) return rows;
  const k = Math.ceil(rows.length / max);
  return rows.filter((r, i) => i % k === 0 || r.index == null || i === rows.length - 1 || r.termSpot);
}
export interface Marker { date: string; label: string; kind: "closing" | "swap-start" | "swap-end" | "cap-end" | "ext-window" | "extension" | "maturity"; endDate?: string | null }
export function rateMarkers(t: RateTerms): Marker[] {
  const m: Marker[] = [];
  if (t.closing) m.push({ date: t.closing, label: "Loan closing", kind: "closing" });
  for (const w of t.swaps) {
    if (w.effective) m.push({ date: w.effective, label: `${t.swaps.length > 1 ? w.label + " " : ""}swap starts`, kind: "swap-start" });
    if (w.maturity) m.push({ date: w.maturity, label: `${t.swaps.length > 1 ? w.label + " " : ""}swap ends`, kind: "swap-end" });
  }
  for (const c of t.caps) if (c.expiry) m.push({ date: c.expiry, label: `${pct(c.strikePct, 2)} cap expires`, kind: "cap-end" });
  if (t.extensionNotice) m.push({ date: t.extensionNotice.start, endDate: t.extensionNotice.end, label: t.extensionNotice.end ? "Extension notice window" : "Extension notice due", kind: "ext-window" });
  if (t.extensionOptions && t.maturity) m.push({ date: t.maturity, label: "Extension date (initial maturity)", kind: "extension" });
  else if (t.maturity) m.push({ date: t.maturity, label: "Maturity", kind: "maturity" });
  m.sort((a, b) => a.date.localeCompare(b.date));
  // Two events on one day (closing + swap start) become one marker so the labels don't overprint.
  const out: Marker[] = [];
  for (const x of m) { const prev = out[out.length - 1]; if (prev && prev.date === x.date && !prev.endDate && !x.endDate) prev.label = `${prev.label} · ${x.label}`; else out.push({ ...x }); }
  return out;
}

// ── Forward view (section 3) ─────────────────────────────────────────────────
export interface ForwardMonth { t: number; date: string; index: number | null; unhedged: number | null; effective: number | null; regime: Regime | null }
export interface ForwardYear { year: number; months: number; interest: number | null; avgRate: number | null; partial: boolean }
/** Today's forward curve (the same par swap curve the mark-to-market uses) turned into monthly
 *  forward index rates — forward over [a,b] = (par(b)·b − par(a)·a)/(b − a), par(0) = spot — then
 *  run through the same rate rules to maturity. Balance held flat. INDICATIVE. */
export function forwardView(t: RateTerms, rates: RatesPayload, today: Date): { months: ForwardMonth[]; years: ForwardYear[]; curve: string | null; asOf: string | null; note: string } | null {
  if (!t.maturity) return null;
  const todayIso = today.toISOString().slice(0, 10);
  if (t.maturity <= todayIso) return null;
  const spot = t.daily ? rates.sofrOvernight?.rate ?? termSofrSpot(rates).rate : termSofrSpot(rates).rate ?? rates.sofrOvernight?.rate ?? null;
  const first = marketSwapRate(rates, 1, t.index);
  if (spot == null || first.rate == null || first.curve === "Treasury") return t.rateClass === "fixed" ? fixedForward(t, today) : null;
  const par = (tau: number) => (tau <= 0 ? spot : tau < 1 ? spot + (first.rate! - spot) * tau : marketSwapRate(rates, tau, t.index).rate ?? first.rate!);
  const S = (tau: number) => par(tau) * tau;
  const months: ForwardMonth[] = [];
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  for (let i = 0; ; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const iso = (i === 0 ? today : d).toISOString().slice(0, 10);
    if (iso > t.maturity) break;
    const a = Math.max(0, (d.getTime() - today.getTime()) / (365.25 * DAY)), b = a + 1 / 12;
    const ix = i === 0 ? spot : r4((S(b) - S(a)) / (b - a));
    const r = rateOn(t, iso, ix);
    months.push({ t: ms(iso), date: iso, index: ix, unhedged: r.unhedged, effective: r.effective, regime: r.regime });
    if (i > 600) break;
  }
  return { months, years: yearsOf(t, months), curve: first.curve, asOf: first.asOf, note: `Indicative: forward rates implied by today's ${first.curve} swap curve; balance held at ${t.balance != null ? fmtMoney(t.balance) : "—"}${t.amortizing ? " (amortization not modelled)" : ""}.` };
}
function fixedForward(t: RateTerms, today: Date) {
  const months: ForwardMonth[] = [];
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  for (let i = 0; i < 600; i++) {
    const iso = (i === 0 ? today : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))).toISOString().slice(0, 10);
    if (iso > t.maturity!) break;
    const r = rateOn(t, iso, null);
    months.push({ t: ms(iso), date: iso, index: null, unhedged: r.unhedged, effective: r.effective, regime: r.regime });
  }
  return { months, years: yearsOf(t, months), curve: null, asOf: null, note: "Fixed rate to maturity; balance held flat." };
}
function yearsOf(t: RateTerms, months: ForwardMonth[]): ForwardYear[] {
  const by = new Map<number, ForwardYear & { sum: number; days: number; bad: boolean }>();
  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    const end = i + 1 < months.length ? months[i + 1].date : addDays(t.maturity!, 1);
    const days = Math.max(0, Math.round((ms(end) - ms(m.date)) / DAY));
    const y = Number(m.date.slice(0, 4));
    const e = by.get(y) ?? { year: y, months: 0, interest: 0, avgRate: null, partial: false, sum: 0, days: 0, bad: false };
    e.months++;
    if (m.effective == null || t.balance == null) e.bad = true; else { e.sum += (t.balance * m.effective / 100) * days / 360; e.days += days; }
    by.set(y, e);
  }
  const ys = [...by.values()].sort((a, b) => a.year - b.year);
  return ys.map((e, i) => ({ year: e.year, months: e.months, interest: e.bad ? null : Math.round(e.sum), avgRate: e.bad || !e.days ? null : r4((e.sum / (t.balance! * e.days / 360)) * 100), partial: i === 0 || i === ys.length - 1 ? e.months < 12 : false }));
}

// ── Actual vs expected interest (section 4) ──────────────────────────────────
export interface GlRow { entityId: string; period: string; mortgageInterest: number | null; swapCredits: number | null }
export interface InterestMonth { period: string; accrual: string; actual: number | null; mortgageInterest: number | null; swapCredits: number | null; expected: number | null; expectedWhy: string | null; gap: number | null; gapPct: number | null; flagged: boolean; cumulativeGap: number | null }
export const GAP_FLAG_MIN = 2500, GAP_FLAG_PCT = 0.10;
const prevPeriod = (p: string) => { const y = Number(p.slice(0, 4)), m = Number(p.slice(4, 6)); return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, "0")}`; };
/** The index in effect on a day = the latest print on or before it (weekends/holidays carry the
 *  prior print — the SOFR accrual convention, not an interpolation). Null when the last print
 *  is more than 5 days old (a real hole in the data). */
function indexLookup(sofr: IndexPoint[]) {
  const pts = sofr.filter((p): p is [string, number] => p[1] != null);
  return (d: string): number | null => {
    let lo = 0, hi = pts.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans < 0 || ms(d) - ms(pts[ans][0]) > 5 * DAY ? null : pts[ans][1];
  };
}
/** Interest the stored terms say should have accrued in calendar month `accrual` (YYYYMM):
 *  Σ over days in the loan's life of balance × that day's effective rate / 360 (actual/360). */
export function expectedForMonth(loans: RateTerms[], accrual: string, sofr: IndexPoint[]): { amount: number | null; why: string | null } {
  const ix = indexLookup(sofr);
  const y = Number(accrual.slice(0, 4)), m = Number(accrual.slice(4, 6));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let total = 0, any = false;
  for (const t of loans) {
    if (t.balance == null) return { amount: null, why: "balance not documented" };
    if (t.pending) return { amount: null, why: t.pending };
    for (let d = 1; d <= days; d++) {
      const iso = `${accrual.slice(0, 4)}-${accrual.slice(4, 6)}-${String(d).padStart(2, "0")}`;
      if ((t.closing && iso < t.closing) || (t.maturity && iso > t.maturity)) continue;
      const needsIndex = t.rateClass !== "fixed" && !(rateOn(t, iso, 0).regime === "swap");
      const v = needsIndex ? ix(iso) : 0;
      if (needsIndex && v == null) return { amount: null, why: "index history missing for this month" };
      const r = rateOn(t, iso, v);
      if (r.effective == null) return { amount: null, why: "rate can't be priced for this month" };
      total += (t.balance * r.effective / 100) / 360; any = true;
    }
  }
  return any ? { amount: Math.round(total * 100) / 100, why: null } : { amount: null, why: "loan not in place that month" };
}
export interface InterestComparison { months: InterestMonth[]; notes: string[]; flagged: number; status: "ok" | "no-datex" | "not-loaded" | "no-rows" }
/** Datex posts each payment in the month it is PAID — the prior month's interest — so posting
 *  month P is compared with the interest that accrued in P−1. Actual = 1st Mortgage Interest +
 *  Swap Credits (netted as booked). A month is flagged when |gap| > max($2,500, 10% of expected). */
export function compareInterest(loans: RateTerms[], gl: GlRow[] | null | undefined, sofr: IndexPoint[], opts: { inDatex: boolean; maxMonths?: number }): InterestComparison {
  if (!opts.inDatex) return { months: [], notes: ["No Datex ledger for this property."], flagged: 0, status: "no-datex" };
  if (!gl) return { months: [], notes: ["The Datex interest ledger hasn't been loaded for this property yet — it arrives with the next Datex auto-refresh."], flagged: 0, status: "not-loaded" };
  const byP = new Map<string, { mi: number | null; sc: number | null }>();
  for (const r of gl) {
    const e = byP.get(r.period) ?? { mi: null, sc: null };
    if (r.mortgageInterest != null) e.mi = (e.mi ?? 0) + r.mortgageInterest;
    if (r.swapCredits != null) e.sc = (e.sc ?? 0) + r.swapCredits;
    byP.set(r.period, e);
  }
  // Start at the loan's closing; without one, at its swap's effective date (a refinanced
  // property's earlier postings belong to the previous loan).
  const closingIso = loans.map(t => t.closing).filter((x): x is string => !!x).sort()[0] ?? null;
  const swapIso = loans.flatMap(t => t.swaps.map(w => w.effective)).filter((x): x is string => !!x).sort()[0] ?? null;
  const closingP = (closingIso ?? swapIso)?.replace(/-/g, "").slice(0, 6) ?? null;
  let periods = [...byP.keys()].sort().filter(p => !closingP || prevPeriod(p) >= closingP);
  if (opts.maxMonths && periods.length > opts.maxMonths) periods = periods.slice(-opts.maxMonths);
  if (!periods.length) return { months: [], notes: ["Datex has no 1st-mortgage-interest postings for this property since the loan closed."], flagged: 0, status: "no-rows" };
  let cum = 0, cumOk = true;
  const months: InterestMonth[] = periods.map(p => {
    const g = byP.get(p)!;
    const actual = g.mi == null && g.sc == null ? null : Math.round(((g.mi ?? 0) + (g.sc ?? 0)) * 100) / 100;
    const accrual = prevPeriod(p);
    const ex = expectedForMonth(loans, accrual, sofr);
    const gap = actual != null && ex.amount != null ? Math.round((actual - ex.amount) * 100) / 100 : null;
    if (gap == null) cumOk = false; else cum += gap;
    const flagged = gap != null && Math.abs(gap) > Math.max(GAP_FLAG_MIN, GAP_FLAG_PCT * Math.abs(ex.amount!));
    return { period: p, accrual, actual, mortgageInterest: g.mi, swapCredits: g.sc, expected: ex.amount, expectedWhy: ex.why, gap,
      gapPct: gap != null && ex.amount ? Math.round((gap / ex.amount) * 1000) / 10 : null, flagged, cumulativeGap: cumOk ? Math.round(cum * 100) / 100 : null };
  });
  const notes = ["Datex posts each payment in the month it is paid, so each row compares that month's posting with the interest accrued the month before."];
  if (!closingIso && swapIso) notes.push(`Loan closing date not documented — compared from the swap's effective date (${fmtShortDate(swapIso)}).`);
  else if (!closingP) notes.push("Loan closing date not documented — compared over every month Datex has; months before this loan may belong to an earlier loan.");
  if (loans.some(t => t.amortizing)) notes.push("Expected interest uses today's balance for every month (amortization not modelled), so it runs slightly low on older months.");
  if (loans.some(t => t.rateClass !== "fixed" && t.swaps.length === 0) || loans.some(t => t.swaps.some(w => w.notional != null && t.balance != null && w.notional < t.balance * 0.995)))
    notes.push(`Floating months use Daily SOFR (each day's print) as the index${loans.some(t => !t.daily) ? ` — ${TERM_PROXY_NOTE}` : ""}.`);
  if (loans.length > 1) notes.push(`Property total — ${loans.length} loans compared together against every Datex entity for this property.`);
  notes.push(...catchUpNotes(months));
  return { months, notes, flagged: months.filter(m => m.flagged).length, status: "ok" };
}
/** "Underbilled 8 months, then a catch-up" — a run of flagged shortfalls followed within
 *  3 months by a flagged overage, with what the run nets to. */
export function catchUpNotes(months: InterestMonth[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < months.length; i++) {
    if (!(months[i].flagged && months[i].gap! < 0)) continue;
    let j = i; while (j + 1 < months.length && months[j + 1].flagged && months[j + 1].gap! < 0) j++;
    let k = -1;
    for (let q = j + 1; q < Math.min(months.length, j + 4); q++) if (months[q].flagged && months[q].gap! > 0) { k = q; break; }
    const under = months.slice(i, j + 1).reduce((a, m) => a + m.gap!, 0);
    const span = `${fmtPeriod(months[i].period)}${j > i ? ` – ${fmtPeriod(months[j].period)}` : ""}`;
    if (k >= 0) {
      const net = months.slice(i, k + 1).reduce((a, m) => a + (m.gap ?? 0), 0);
      const nearZero = Math.abs(net) <= Math.max(GAP_FLAG_MIN, 0.05 * Math.abs(under));
      out.push(`Underbilled ${j - i + 1} month${j > i ? "s" : ""} (${span}, ${fmtMoney(under, { below: "full" })} short), then a ${fmtMoney(months[k].gap!, { below: "full" })} catch-up posted ${fmtPeriod(months[k].period)}. ${nearZero ? `The cumulative gap nets to ~$0 (${fmtMoney(net, { below: "full" })}).` : `Net over the run: ${fmtMoney(net, { below: "full" })}.`}`);
      i = k;
    } else {
      out.push(`Underbilled ${j - i + 1} month${j > i ? "s" : ""} (${span}, ${fmtMoney(under, { below: "full" })} short) with no catch-up posted yet.`);
      i = j;
    }
  }
  return out;
}
