import { fmtMoney } from "./money";
import type { Deal, LeaseAbstract } from "./idb";
import type { RatesPayload, AnalystTenantBenchmark } from "./api";
import { calcSwapBreakage } from "./prepay";
import { brandFamilyKey, brandDisplayName, isInvestmentGrade } from "./tenantCredit";
import { resolveTenantRisk, anchorsReferenced, computeExposure } from "./leaseRisk";
import { isVacant, tenantLabel } from "./utils";

// ASSET MANAGEMENT calculations (Eric, 10/18/26) — owned properties only, all deterministic.
// Every figure the UI shows carries a `source` and, where there is one, an as-of date.

export interface AmRecord { id: string; kind: "loan" | "swap" | "date" | "pref" | "covenant" | "acquisition" | "optstatus"; dealId: string | null; data: Record<string, unknown>; sourceNote: string | null; updatedBy: string | null; updatedAt: string }

const n = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const s = (v: unknown): string | null => (v == null || String(v).trim() === "" ? null : String(v).trim());
const DAY = 86_400_000;
export const daysUntil = (iso: string | null | undefined, today: Date): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(t)) return null;
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((t - t0) / DAY);
};

// ── Swap curve lookup (shared with the deal-page breakage estimate) ───────────
/** 1M Term SOFR swaps by default (KPR's swaps index CME Term SOFR 1M); a Daily Simple /
 *  compounded SOFR index uses the SOFR (annual/annual) curve. Linear between tenors,
 *  flat beyond the ends. Falls back to the matching Treasury only if no swap curve. */
export function isDailySofr(index: string | null | undefined): boolean {
  const i = String(index ?? "");
  return /daily|simple|compound|\bOIS\b/i.test(i) && !/term/i.test(i);
}
export function marketSwapRate(r: RatesPayload, years: number, index?: string | null): { rate: number | null; curve: "1M Term SOFR" | "SOFR (annual/annual)" | "Treasury" | null; asOf: string | null } {
  const daily = isDailySofr(index);
  const term = (r.termSwapCurve?.points ?? []).map(p => [p.tenor, p.rate] as [number, number]);
  const ois = (r.swaps?.rows ?? []).map(x => { const m = /(\d+)\s*Year/i.exec(x.label || ""); return m && x.value != null ? [Number(m[1]), x.value] as [number, number] : null; }).filter((p): p is [number, number] => !!p);
  const useTerm = !daily && term.length >= 2;
  const pts = (useTerm ? term : ois).sort((a, b) => a[0] - b[0]);
  const interp = (t: number): number | null => {
    if (!pts.length) return null;
    if (t <= pts[0][0]) return pts[0][1];
    if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; if (t <= x1) return y0 + (y1 - y0) * ((t - x0) / (x1 - x0)); }
    return null;
  };
  const v = interp(years);
  if (v != null) return { rate: Math.round(v * 1000) / 1000, curve: useTerm ? "1M Term SOFR" : "SOFR (annual/annual)", asOf: useTerm ? r.termSwapCurve?.asOf ?? null : r.swaps?.asOf ?? null };
  const tenors: Array<[string, number]> = [["1-Yr", 1], ["2-Yr", 2], ["3-Yr", 3], ["5-Yr", 5], ["7-Yr", 7], ["10-Yr", 10], ["30-Yr", 30]];
  const best = tenors.reduce((a, b) => Math.abs(b[1] - years) < Math.abs(a[1] - years) ? b : a);
  const t = r.treasuries?.rows.find(x => x.label === best[0])?.value ?? null;
  return { rate: t, curve: t != null ? "Treasury" : null, asOf: r.treasuries?.asOf ?? null };
}
/** 1M Term SOFR spot for a floating loan's all-in rate. */
export function termSofrSpot(r: RatesPayload | null): { rate: number | null; asOf: string | null } {
  const row = r?.sofr.rows.find(x => /term.*1\s*month/i.test(x.label));
  return { rate: row?.value ?? null, asOf: row?.asOf ?? null };
}

// ── Floating-rate terms read from the loan record (fields first, then its own text) ──
// The Cedar/HPS-Guardian loans carry "1M Term SOFR + 220 bps, 2.75% floor" in the index
// text and their rate caps in covenants/notes ("Cedar $335M @5.25% to 2/1/28"), so a loan
// with no spreadBps field used to read "not enough terms".
const loanText = (d: Record<string, unknown>): string =>
  Object.entries(d).filter(([k, v]) => typeof v === "string" && /index|spread|floor|cap|hedge|covenant|note|prepay|rate|term|question/i.test(k)).map(([, v]) => String(v)).join("\n");
export function loanSpreadBps(d: Record<string, unknown>): number | null {
  const f = n(d.spreadBps);
  if (f != null) return f;
  const t = `${s(d.index) ?? ""} ${s(d.rateText) ?? ""} ${s(d.rateType) ?? ""}`;
  const bps = /(?:\+|plus|spread(?: of)?:?)\s*(\d{2,4})\s*(?:bps?|basis)/i.exec(t) ?? /\bS\s*\+\s*(\d{2,4})\b/i.exec(t);
  if (bps) { const v = Number(bps[1]); return v > 0 && v < 2000 ? v : null; }
  const pct = /(?:\+|plus)\s*(\d{1,2}(?:\.\d+)?)\s*%/i.exec(t);
  if (pct) { const v = Number(pct[1]); return v > 0 && v < 20 ? Math.round(v * 100) : null; }
  return null;
}
export function loanFloorPct(d: Record<string, unknown>): number | null {
  for (const k of ["indexFloorPct", "floorPct", "sofrFloorPct", "indexFloor", "floor"]) { const v = n(d[k]); if (v != null && v >= 0 && v < 15) return v; }
  const t = loanText(d);
  const m = /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:\(?\s*(?:index|sofr)\s*\)?\s*)?floor/i.exec(t) ?? /floor(?:\s*(?:of|at|:|=))?\s*(\d{1,2}(?:\.\d+)?)\s*%/i.exec(t);
  const v = m ? Number(m[1]) : null;
  return v != null && v >= 0 && v < 15 ? v : null;
}
export interface RateCap { strikePct: number; notional: number | null; expiry: string | null; text: string }
const toIso = (raw: string): string | null => {
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(raw);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  const t = Date.parse(raw);
  return Number.isFinite(t) && /\d{4}/.test(raw) ? new Date(t).toISOString().slice(0, 10) : null;
};
const money = (raw: string): number | null => {
  const m = /\$\s*(\d[\d,]*(?:\.\d+)?)\s*(mm|m|million|k|b|bn)?\b/i.exec(raw);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, "")), u = (m[2] ?? "").toLowerCase();
  return u === "b" || u === "bn" ? v * 1e9 : u.startsWith("m") ? v * 1e6 : u === "k" ? v * 1e3 : v;
};
/** Interest-rate caps written on a loan record (fields, or its own covenants/notes text). */
export function loanRateCaps(d: Record<string, unknown>): RateCap[] {
  const out: RateCap[] = [];
  const strike = n(d.rateCapStrikePct ?? d.capStrikePct ?? d.capStrike ?? d.rateCapPct);
  if (strike != null && strike > 0 && strike < 15) out.push({ strikePct: strike, notional: n(d.rateCapNotional ?? d.capNotional), expiry: toIso(String(d.rateCapExpiry ?? d.capExpiry ?? d.capMaturity ?? "")), text: "rate cap (entered)" });
  for (const seg of loanText(d).split(/\n|(?<=\.)\s+(?=[A-Z])/)) {
    if (!/\bcap\b|\bcaps\b|capped/i.test(seg) || /cap(?:italization)? rate|cam cap|capex|capital/i.test(seg)) continue;
    // One segment can carry several caps ("Cap A $335M @5.25% to 2/1/28, Cap B $68.5M @4.50% to 2/1/27").
    const re = /(\$\s*\d[\d,.]*\s*(?:mm|m|million|k|bn|b)?\b)?[^%$]{0,40}?@?\s*(\d{1,2}(?:\.\d+)?)\s*%(?:\s*strike)?[^%$]{0,30}?(?:to|through|thru|until|expir\w*|matur\w*)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Z][a-z]+\.? \d{1,2},? \d{4})/gi;
    let m: RegExpExecArray | null, hit = false;
    while ((m = re.exec(seg))) {
      const k = Number(m[2]);
      if (!(k > 0 && k < 15)) continue;
      hit = true;
      out.push({ strikePct: k, notional: m[1] ? money(m[1]) : null, expiry: toIso(m[3]), text: m[0].trim() });
    }
    if (!hit) { const p = /(\d{1,2}(?:\.\d+)?)\s*%/.exec(seg); if (p && Number(p[1]) > 0 && Number(p[1]) < 15) out.push({ strikePct: Number(p[1]), notional: money(seg), expiry: null, text: seg.trim().slice(0, 140) }); }
  }
  const seen = new Set<string>();
  return out.filter(c => { const k = `${c.strikePct}|${c.notional}|${c.expiry}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ── Debt & swaps ──────────────────────────────────────────────────────────────
export interface DebtRow {
  record: AmRecord; dealId: string; property: string; lender: string | null;
  balance: number | null; balanceIsOriginal: boolean; rateType: string | null; index: string | null; spreadBps: number | null;
  allInPct: number | null; allInSource: string; maturity: string | null; daysToMaturity: number | null; flag: "red" | "amber" | null;
  swaps: SwapRow[]; datexOnly: boolean; superseded: boolean; loanLabel: string | null;
  /** fixed / swapped / capped (floating with a live rate cap) / floating. */
  rateClass: "fixed" | "swapped" | "capped" | "floating" | null;
  /** All-in estimated from today's curve (a floating loan) rather than a stated rate. */
  estimated: boolean; floorPct: number | null; caps: RateCap[]; cappedMaxPct: number | null;
}
export interface SwapRow {
  record: AmRecord; dealId: string; property: string; counterparty: string | null; notional: number | null; fixedSwapRatePct: number | null;
  allInFixedPct: number | null; effective: string | null; maturity: string | null; daysToMaturity: number | null; flag: "red" | "amber" | null;
  remainingYears: number | null; marketRatePct: number | null; curve: string | null; mtm: number | null; mtmLabel: string;
  loanLabel: string | null; termsPending: boolean;
}
const flagFor = (days: number | null): DebtRow["flag"] => days == null ? null : days < 365 ? "red" : days <= 548 ? "amber" : null;

export function buildSwapRows(records: AmRecord[], names: Map<string, string>, rates: RatesPayload | null, today: Date): SwapRow[] {
  return records.filter(r => r.kind === "swap" && r.dealId).map(r => {
    const d = r.data, maturity = s(d.maturityDate), notional = n(d.notional), K = n(d.fixedSwapRatePct), spread = n(d.spreadBps);
    const days = daysUntil(maturity, today), yrs = days != null ? Math.max(0, days / 365.25) : null;
    const mk = rates && yrs != null ? marketSwapRate(rates, yrs, s(d.index)) : { rate: null, curve: null, asOf: null };
    // Terms not documented yet → shown so the hedge is visible, never priced.
    // Derived from the terms, never a stale stored flag (Overland / Pointe Plaza stayed "pending").
    const pending = notional == null || K == null || !maturity;
    const b = pending ? { value: null, label: "terms pending — not priced" } : calcSwapBreakage({ notional, fixedRatePct: K, terminationDate: maturity, payFixed: d.payFixed !== false } as never, { valuationDate: today.toISOString().slice(0, 10), marketSwapRatePct: mk.rate });
    return {
      record: r, dealId: r.dealId!, property: names.get(r.dealId!) ?? "—", counterparty: s(d.counterparty), notional, fixedSwapRatePct: K,
      allInFixedPct: n(d.allInFixedPct) ?? (K != null && spread != null ? Math.round((K + spread / 100) * 10000) / 10000 : null),
      effective: s(d.effectiveDate), maturity, daysToMaturity: days, flag: flagFor(days), remainingYears: yrs != null ? Math.round(yrs * 100) / 100 : null,
      marketRatePct: pending ? null : mk.rate, curve: pending ? null : mk.curve, mtm: b.value, mtmLabel: b.value == null ? b.label : b.value >= 0 ? "asset to KPR" : "cost to unwind",
      loanLabel: s(d.loanLabel), termsPending: pending,
    };
  });
}

export function buildDebtRows(records: AmRecord[], deals: Deal[], rates: RatesPayload | null, today: Date): DebtRow[] {
  const names = new Map(deals.map(d => [d.id, d.propertyName || "Untitled"]));
  const swaps = buildSwapRows(records, names, rates, today);
  const spot = termSofrSpot(rates);
  const loans = records.filter(r => r.kind === "loan" && r.dealId && names.has(r.dealId));
  const enteredDeals = new Set(loans.filter(r => !r.id.startsWith("datex-loan:")).map(r => r.dealId));
  return loans.map(r => {
    const d = r.data, datexOnly = r.id.startsWith("datex-loan:");
    const cur = n(d.currentBalance), orig = n(d.originalBalance), spread = loanSpreadBps(d);
    // A swap names its loan by id or by loanLabel (Rockaway: Commons / Town Court / Town Plaza);
    // an unlabelled one belongs to the property's loans.
    const label = s(d.loanLabel);
    const mySwaps = swaps.filter(w => w.dealId === r.dealId
      && (s(w.record.data.loanId) ? w.record.data.loanId === r.id : !w.loanLabel || !label || w.loanLabel.toLowerCase() === label.toLowerCase()));
    const idx = s(d.index);
    const looksFloating = spread != null && /sofr|libor|prime|index|term/i.test(`${idx ?? ""} ${s(d.rateType) ?? ""}`);
    const type = s(d.rateType) ?? (mySwaps.length ? "swapped" : n(d.fixedRatePct) != null && spread == null ? "fixed" : spread != null || looksFloating ? "floating" : null);
    const floor = loanFloorPct(d);
    const caps = loanRateCaps(d);
    const liveCaps = caps.filter(c => !c.expiry || c.expiry >= today.toISOString().slice(0, 10));
    let allIn = n(d.allInRatePct), src = allIn != null ? "as entered" : "", estimated = false;
    const priced = mySwaps.find(w => !w.termsPending && w.allInFixedPct != null);
    if (allIn == null && type === "swapped" && priced) { allIn = priced.allInFixedPct; src = "swap fixed + spread"; }
    if (allIn == null && type === "fixed" && n(d.fixedRatePct) != null) { allIn = n(d.fixedRatePct); src = "fixed rate"; }
    const floating = /float|capped/i.test(type ?? "");
    // Highest live strike = the conservative ceiling when a loan sits under more than one cap.
    const capStrike = floating && liveCaps.length ? Math.max(...liveCaps.map(c => c.strikePct)) : null;
    if (allIn == null && floating && spread != null) {
      const daily = isDailySofr(idx);
      const base = daily && rates?.sofrOvernight ? { rate: rates.sofrOvernight.rate, label: "SOFR overnight" }
        : spot.rate != null ? { rate: spot.rate, label: "1M Term SOFR" }
        : rates?.sofrOvernight ? { rate: rates.sofrOvernight.rate, label: "SOFR overnight (1M Term n/a)" } : null;
      if (base) {
        let ix = floor != null ? Math.max(base.rate, floor) : base.rate;
        const floorBinds = floor != null && floor > base.rate;
        const capBinds = capStrike != null && ix > capStrike;
        if (capBinds) ix = capStrike!;
        allIn = Math.round((ix + spread / 100) * 10000) / 10000;
        estimated = true;
        src = `est. from curve: ${base.label} ${base.rate.toFixed(3)}%${floorBinds ? ` → ${floor!.toFixed(2)}% floor` : ""}${capBinds ? ` → capped ${capStrike!.toFixed(2)}%` : ""} + ${spread} bps`;
      }
    }
    const rateClass: DebtRow["rateClass"] = type === "fixed" ? "fixed" : type === "swapped" ? "swapped" : floating ? (liveCaps.length ? "capped" : "floating") : null;
    const maturity = s(d.maturityDate), days = daysUntil(maturity, today);
    return {
      record: r, dealId: r.dealId!, property: names.get(r.dealId!)!, lender: s(d.lender), balance: cur ?? orig, balanceIsOriginal: cur == null && orig != null,
      rateType: type, index: idx, spreadBps: spread, allInPct: allIn, allInSource: src || "not enough terms", maturity, daysToMaturity: days, flag: flagFor(days),
      swaps: mySwaps, datexOnly, superseded: datexOnly && enteredDeals.has(r.dealId), loanLabel: label,
      rateClass, estimated, floorPct: floor, caps, cappedMaxPct: capStrike != null && spread != null ? Math.round((Math.max(capStrike, floor ?? 0) + spread / 100) * 10000) / 10000 : null,
    };
  }).sort((a, b) => (a.maturity ?? "9999").localeCompare(b.maturity ?? "9999"));
}

export interface DebtTotals { totalDebt: number; loans: number; weightedRatePct: number | null; rateCoveragePct: number; pctFixedOrHedged: number | null;
  /** Share of typed balances by class (fixed+swapped / capped / floating); estimatedPct = share of priced debt from the curve. */
  byClass: { fixedOrSwappedPct: number | null; cappedPct: number | null; floatingPct: number | null; estimatedLoans: number; estimatedPct: number };
  wall: Array<{ year: number; amount: number }>; totalMtm: number | null }
export function debtTotals(rows: DebtRow[], swaps: SwapRow[]): DebtTotals {
  const live = rows.filter(r => !r.superseded && r.balance != null);
  const total = live.reduce((t, r) => t + (r.balance ?? 0), 0);
  const priced = live.filter(r => r.allInPct != null);
  const pricedBal = priced.reduce((t, r) => t + r.balance!, 0);
  const fixedish = live.filter(r => r.rateClass === "fixed" || r.rateClass === "swapped" || r.rateClass === "capped").reduce((t, r) => t + r.balance!, 0);
  const typed = live.filter(r => r.rateType).reduce((t, r) => t + r.balance!, 0);
  const cls = (c: DebtRow["rateClass"]) => live.filter(r => r.rateClass === c).reduce((t, r) => t + r.balance!, 0);
  const classed = live.filter(r => r.rateClass).reduce((t, r) => t + r.balance!, 0);
  const pctOf = (v: number) => classed > 0 ? Math.round((v / classed) * 100) : null;
  const est = priced.filter(r => r.estimated);
  const wall = new Map<number, number>();
  for (const r of live) if (r.maturity) { const y = Number(r.maturity.slice(0, 4)); wall.set(y, (wall.get(y) ?? 0) + r.balance!); }
  const mtms = swaps.map(w => w.mtm).filter((v): v is number => v != null);
  return {
    totalDebt: total, loans: live.length,
    weightedRatePct: pricedBal > 0 ? Math.round((priced.reduce((t, r) => t + r.balance! * r.allInPct!, 0) / pricedBal) * 1000) / 1000 : null,
    rateCoveragePct: total > 0 ? Math.round((pricedBal / total) * 100) : 0,
    pctFixedOrHedged: typed > 0 ? Math.round((fixedish / typed) * 100) : null,
    byClass: { fixedOrSwappedPct: pctOf(cls("fixed") + cls("swapped")), cappedPct: pctOf(cls("capped")), floatingPct: pctOf(cls("floating")),
      estimatedLoans: est.length, estimatedPct: pricedBal > 0 ? Math.round((est.reduce((t, r) => t + r.balance!, 0) / pricedBal) * 100) : 0 },
    wall: [...wall.entries()].sort((a, b) => a[0] - b[0]).map(([year, amount]) => ({ year, amount })),
    totalMtm: mtms.length ? mtms.reduce((a, b) => a + b, 0) : null,
  };
}

// ── Preferred equity — capital, NOT debt: never in total debt or the weighted rate ──
export interface PrefRow { record: AmRecord; dealId: string; property: string; loanLabel: string | null; investor: string | null; amount: number | null;
  /** ALL-IN pref rate. */ ratePct: number | null;
  /** Cash-pay rate and the deferred / compounding part (Eric, 10/19/26). Null = not on file — never 0. */
  currentPayPct: number | null; accruedPct: number | null;
  /** Amount × rate, per year. Null when the rate isn't on file. */
  annualCurrentPay: number | null; annualAccrual: number | null;
  stepNote: string | null; redemptionDate: string | null; maturity: string | null; daysToMaturity: number | null }
export function buildPrefRows(records: AmRecord[], deals: Deal[], today: Date): PrefRow[] {
  const names = new Map(deals.map(d => [d.id, d.propertyName || "Untitled"]));
  return records.filter(r => r.kind === "pref" && r.dealId && names.has(r.dealId)).map(r => {
    const d = r.data, maturity = s(d.maturityDate), amount = n(d.amount);
    const cp = n(d.currentPayPct), acc = n(d.accruedPct) ?? n(d.accrualPct);
    const perYr = (pct: number | null) => amount != null && pct != null ? Math.round(amount * pct / 100) : null;
    return { record: r, dealId: r.dealId!, property: names.get(r.dealId!)!, loanLabel: s(d.loanLabel), investor: s(d.investor), amount, ratePct: n(d.ratePct),
      currentPayPct: cp, accruedPct: acc, annualCurrentPay: perYr(cp), annualAccrual: perYr(acc), stepNote: s(d.stepNote), redemptionDate: s(d.redemptionDate),
      maturity, daysToMaturity: daysUntil(s(d.redemptionDate) ?? maturity, today) };
  }).sort((a, b) => a.property.localeCompare(b.property) || (a.loanLabel ?? "").localeCompare(b.loanLabel ?? ""));
}
export function prefTotals(rows: PrefRow[]): { total: number; weightedRatePct: number | null; count: number; annualCurrentPay: number | null; annualAccrual: number | null; currentPayCovered: number } {
  const withAmt = rows.filter(r => r.amount != null);
  const total = withAmt.reduce((t, r) => t + r.amount!, 0);
  const priced = withAmt.filter(r => r.ratePct != null), pb = priced.reduce((t, r) => t + r.amount!, 0);
  const cp = rows.filter(r => r.annualCurrentPay != null), ac = rows.filter(r => r.annualAccrual != null);
  return { total, count: rows.length, weightedRatePct: pb > 0 ? Math.round((priced.reduce((t, r) => t + r.amount! * r.ratePct!, 0) / pb) * 1000) / 1000 : null,
    annualCurrentPay: cp.length ? cp.reduce((t, r) => t + r.annualCurrentPay!, 0) : null, annualAccrual: ac.length ? ac.reduce((t, r) => t + r.annualAccrual!, 0) : null, currentPayCovered: cp.length };
}

// ── Live tenant list (Datex first, OM roster as fallback) ────────────────────
export interface LiveTenant { name: string; tenantId: string | null; sf: number | null; annualRent: number | null; annualNNN: number | null; annualOther: number | null; leaseExpiry: string | null; isAnchor: boolean; nationalTenant: string | null; sales12: { sales12: number; months: number; from: string; to: string; staleMonths: number; partial: boolean; suspectMonths?: Array<{ period: string; amount: number; medianMonth: number }> } | null; salesNeverReported: boolean; lastSalesPeriod: string | null; delinquency: number | null; coTenancy: boolean }
export function liveTenants(deal: Deal): { tenants: LiveTenant[]; source: "Datex" | "OM roster"; asOf: string | null } {
  const dx = (deal as unknown as { datexLive?: Record<string, unknown> }).datexLive;
  const omAnchors = new Set((deal.tenants ?? []).filter(t => t.isAnchor).map(t => brandFamilyKey(t.canonicalName || t.name)));
  const dxT = Array.isArray(dx?.tenants) ? dx!.tenants as Array<Record<string, unknown>> : null;
  if (dxT && dxT.length) {
    return { source: "Datex", asOf: s(dx!.asOf), tenants: dxT.filter(t => !isVacant(String(t.name ?? "")) && t.futureLease !== true).map(t => {
      const name = String(t.name), sf = n(t.sf);
      return { name, tenantId: s(t.tenantId), sf, annualRent: n(t.annualRent), annualNNN: n(t.annualNNN) ?? (n(t.nnnPerSF) != null && sf ? n(t.nnnPerSF)! * sf : null), annualOther: n(t.annualOther),
        leaseExpiry: s(t.leaseExpiry), isAnchor: omAnchors.has(brandFamilyKey(name)) || (sf ?? 0) >= 15_000, nationalTenant: s(t.nationalTenant),
        sales12: (t.sales12 as LiveTenant["sales12"]) ?? null, salesNeverReported: t.salesNeverReported === true, lastSalesPeriod: s(t.lastSalesPeriod), delinquency: n(t.delinquency), coTenancy: t.coTenancy === true };
    }) };
  }
  return { source: "OM roster", asOf: deal.tenantsAsOf ?? null, tenants: (deal.tenants ?? []).filter(t => !isVacant(t.name) && !t.isNAP).map(t => ({
    name: tenantLabel(t.name, t.canonicalName), tenantId: null, sf: n(t.sf), annualRent: n(t.annualRent), annualNNN: n(t.expenseReimbursements), annualOther: n(t.otherRent),
    leaseExpiry: s(t.leaseExpiry), isAnchor: !!t.isAnchor, nationalTenant: null, sales12: null, salesNeverReported: false, lastSalesPeriod: null, delinquency: null, coTenancy: false,
  })) };
}

// ── Critical dates ───────────────────────────────────────────────────────────
export type DateType = "Lease expiry" | "Option notice" | "Termination / kick-out" | "Co-tenancy" | "Loan maturity" | "Extension notice" | "Swap maturity" | "Covenant test" | "Covenant trigger" | "Other";
export interface CriticalDate { date: string; days: number; type: DateType; dealId: string; property: string; tenant: string | null; description: string; source: string; owner: string | null; recordId?: string }
const asType = (t: unknown): DateType => {
  const x = String(t ?? "").toLowerCase();
  if (/option|renewal|notice/.test(x)) return "Option notice";
  if (/kick|terminat|cancel/.test(x)) return "Termination / kick-out";
  if (/co-?tenan/.test(x)) return "Co-tenancy";
  if (/extens/.test(x)) return "Extension notice";
  if (/swap/.test(x)) return "Swap maturity";
  if (/loan|matur/.test(x)) return "Loan maturity";
  if (/expir/.test(x)) return "Lease expiry";
  return "Other";
};
/** "Option 1 · 5 yrs · $17.60/SF" — never a bare "1 · $17.6/SF" (Eric, 10/18/26). */
export function optionLabel(o: { number?: unknown; ordinal?: unknown; length?: unknown; ratePSF?: unknown }): string {
  const raw = s(o.number) ?? s(o.ordinal);
  const name = !raw ? "Option" : /option|renewal/i.test(raw) ? raw : `Option ${raw.replace(/^(\d+)(st|nd|rd|th)$/i, "$1")}`;
  const rate = n(o.ratePSF);
  return `${name}${s(o.length) ? ` · ${s(o.length)}` : ""}${rate != null && rate > 0 ? ` · $${rate.toFixed(2)}/SF` : ""}`;
}
/** A property's asset manager: the one entered on Asset Mgmt → Properties (kept on its
 *  acquisition row), else Datex's assetManager, else null ("no owner on file"). */
export function propertyOwner(deal: Deal, records: AmRecord[]): string | null {
  const acq = records.find(r => r.kind === "acquisition" && r.dealId === deal.id);
  return s(acq?.data.assetManager) ?? s((deal as unknown as { datexLive?: { assetManager?: string } }).datexLive?.assetManager);
}
export function buildCriticalDates(deals: Deal[], records: AmRecord[], abstracts: LeaseAbstract[], today: Date, horizonDays = 3650): { items: CriticalDate[]; undatedRights: Map<string, number> } {
  const owned = new Map(deals.map(d => [d.id, d]));
  const owner = (d: Deal | undefined) => d ? propertyOwner(d, records) : null;
  const out: CriticalDate[] = [];
  const push = (x: Omit<CriticalDate, "days">) => { const days = daysUntil(x.date, today); if (days != null && days >= -30 && days <= horizonDays) out.push({ ...x, days }); };
  for (const d of deals) {
    const lt = liveTenants(d);
    for (const t of lt.tenants) if (t.leaseExpiry) push({ date: t.leaseExpiry, type: "Lease expiry", dealId: d.id, property: d.propertyName || "—", tenant: t.name, description: `${t.sf ? Math.round(t.sf).toLocaleString() + " SF" : ""}${t.annualRent ? ` · $${Math.round(t.annualRent).toLocaleString()}/yr` : ""}`.replace(/^ · /, ""), source: lt.source === "Datex" ? `Datex Tenants (as of ${lt.asOf ?? "?"})` : `OM roster (as of ${lt.asOf ?? "?"})`, owner: owner(d) });
  }
  for (const a of abstracts) {
    const d = a.dealId ? owned.get(a.dealId) : undefined;
    if (!d) continue;
    for (const o of a.options ?? []) if (o.noticeDate && o.status !== "exercised" && o.status !== "expired") push({ date: o.noticeDate, type: "Option notice", dealId: d.id, property: d.propertyName || "—", tenant: a.tenantName ?? null, description: optionLabel(o), source: "Lease abstract", owner: owner(d) });
    const cancel = a.dates?.cancelDate?.value as string | undefined;
    if (cancel && /^\d{4}-\d{2}-\d{2}/.test(String(cancel))) push({ date: String(cancel).slice(0, 10), type: "Termination / kick-out", dealId: d.id, property: d.propertyName || "—", tenant: a.tenantName ?? null, description: "Cancel / termination date", source: "Lease abstract", owner: owner(d) });
  }
  for (const r of records) {
    const d = r.dealId ? owned.get(r.dealId) : undefined;
    if (!d) continue;
    const x = r.data, src = r.sourceNote ? `${r.kind === "date" ? "Entered" : "Debt record"} — ${r.sourceNote}` : r.kind === "date" ? "Entered by hand" : "Debt record";
    if (r.kind === "loan") {
      if (r.id.startsWith("datex-loan:") && records.some(o => o.kind === "loan" && o.dealId === r.dealId && !o.id.startsWith("datex-loan:"))) continue;
      if (s(x.maturityDate)) push({ date: String(x.maturityDate), type: "Loan maturity", dealId: d.id, property: d.propertyName || "—", tenant: null, description: `${s(x.lender) ?? "Loan"}${n(x.currentBalance ?? x.originalBalance) ? ` · ${fmtMoney(n(x.currentBalance ?? x.originalBalance)!)}` : ""}${s(x.extensionOptions) ? ` · ext: ${s(x.extensionOptions)}` : ""}`, source: src, owner: owner(d), recordId: r.id });
      if (s(x.extensionNoticeDate)) push({ date: String(x.extensionNoticeDate), type: "Extension notice", dealId: d.id, property: d.propertyName || "—", tenant: null, description: `${s(x.lender) ?? "Loan"} extension notice`, source: src, owner: owner(d), recordId: r.id });
    } else if (r.kind === "swap" && s(x.maturityDate)) {
      push({ date: String(x.maturityDate), type: "Swap maturity", dealId: d.id, property: d.propertyName || "—", tenant: null, description: `${s(x.counterparty) ?? "Swap"}${n(x.notional) ? ` · ${fmtMoney(n(x.notional)!)}` : ""}`, source: src, owner: owner(d), recordId: r.id });
    } else if (r.kind === "covenant") {
      const label = covenantLabel(x);
      if (s(x.triggerDate)) push({ date: String(x.triggerDate), type: "Covenant trigger", dealId: d.id, property: d.propertyName || "—", tenant: s(x.linkedTenant), description: s(x.trigger) ?? label, source: src.replace("Debt record", "Covenant"), owner: owner(d), recordId: r.id });
      const next = nextCovenantTest(x, today);
      if (next) push({ date: next, type: "Covenant test", dealId: d.id, property: d.propertyName || "—", tenant: null, description: label, source: src.replace("Debt record", "Covenant"), owner: owner(d), recordId: r.id });
    } else if (r.kind === "date" && s(x.date)) {
      push({ date: String(x.date), type: asType(x.type), dealId: d.id, property: d.propertyName || "—", tenant: s(x.tenant), description: s(x.description) ?? String(x.type ?? ""), source: src, owner: s(x.owner) ?? owner(d), recordId: r.id });
    }
  }
  // Kick-out / co-tenancy rights carry thresholds and measurement periods, not calendar
  // dates — never invent one. Count them so the gap is visible and can be filled by hand.
  const undated = new Map<string, number>();
  for (const d of deals) {
    let k = 0;
    for (const t of (d.leaseRisk?.tenants ?? [])) k += (t.coTenancy?.length ?? 0) + (t.salesKickout?.length ?? 0) + (t.otherRiskClauses?.earlyTerminationOption?.present ? 1 : 0);
    if (k) undated.set(d.id, k);
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.property.localeCompare(b.property));
  return { items: out, undatedRights: undated };
}

// ── Covenants, debt service, plan vs actual (owned deal page) ─────────────────
export function covenantLabel(x: Record<string, unknown>): string {
  const t = s(x.type) ?? "Covenant", th = n(x.threshold);
  const lvl = th == null ? "" : t === "DSCR" || t === "cash-sweep" || t === "cash-trap" ? ` ${th.toFixed(2)}x` : ` ${th}%`;
  const name = t === "cash-sweep" ? "Cash sweep" : t === "cash-trap" ? "Cash trap" : t === "DY" ? "Debt yield" : t;
  return `${name}${lvl}${n(x.amortYears) ? ` (${n(x.amortYears)}-yr amort.)` : ""}${n(x.sweepBelow) ? ` · sweep below ${n(x.sweepBelow)!.toFixed(2)}x` : ""}${s(x.testFrequency) ? ` · ${s(x.testFrequency)}` : ""}`;
}
const isoUTC = (d: Date) => d.toISOString().slice(0, 10);
/** Next test date on or after today: from the first test date stepping by the frequency, else
 *  each testMonthDay, else calendar quarter / year ends. Null when the frequency is unknown. */
export function nextCovenantTest(x: Record<string, unknown>, today: Date): string | null {
  const f = s(x.testFrequency), t0 = isoUTC(today);
  const step = f === "quarterly" ? 3 : f === "semi-annual" ? 6 : f === "monthly" ? 1 : f === "annual" ? 12 : null;
  if (!step) return null;
  const first = s(x.firstTestDate);
  if (first && first >= t0) return first;
  if (first) {
    // Step whole months from the first test; a month-end first test (6/30) stays on month
    // ends (9/30, 12/31), never drifting to the 30th.
    const f0 = new Date(first + "T12:00:00Z"), day = f0.getUTCDate();
    const monthEnd = day === new Date(Date.UTC(f0.getUTCFullYear(), f0.getUTCMonth() + 1, 0)).getUTCDate();
    for (let i = 1; i < 600; i++) {
      const y = f0.getUTCFullYear(), m = f0.getUTCMonth() + i * step;
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const c = isoUTC(new Date(Date.UTC(y, m, monthEnd ? last : Math.min(day, last), 12)));
      if (c >= t0) return c;
    }
    return null;
  }
  const md = s(x.testMonthDay);
  if (md && step === 12) { const y = today.getUTCFullYear(); const c = `${y}-${md}`; return c >= t0 ? c : `${y + 1}-${md}`; }
  // Period ends (3/31, 6/30, 9/30, 12/31) when only the frequency is known.
  for (let k = 0; k < 24; k++) {
    const m = today.getUTCMonth() + k, end = new Date(Date.UTC(today.getUTCFullYear(), m + 1, 0));
    if ((end.getUTCMonth() + 1) % step === 0 && isoUTC(end) >= t0) return isoUTC(end);
  }
  return null;
}

/** Annual debt service, IO-aware: interest only while inside the IO period (or when the loan
 *  is IO for its term), otherwise the level payment on its amortization. */
export function annualDebtService(balance: number | null, ratePct: number | null, loan: Record<string, unknown>, today: Date, amortOverride?: number | null): { amount: number | null; basis: string } {
  if (balance == null || ratePct == null) return { amount: null, basis: "needs a balance and a rate" };
  const ioUntil = s(loan.ioUntil), amortType = s(loan.amortization), years = amortOverride ?? n(loan.amortYears);
  const inIO = !amortOverride && ((ioUntil != null && ioUntil > isoUTC(today)) || (amortType === "IO" && !ioUntil));
  if (inIO || !years) return { amount: Math.round(balance * ratePct / 100), basis: inIO ? `interest only${ioUntil ? ` to ${ioUntil}` : ""}` : "interest only (no amortization on file)" };
  const r = ratePct / 100 / 12, k = years * 12;
  const pmt = r === 0 ? balance / k : balance * r / (1 - Math.pow(1 + r, -k));
  return { amount: Math.round(pmt * 12), basis: `${years}-yr amortization${amortOverride ? " (covenant test basis)" : ""}` };
}

/** The NOI an owned asset is actually earning, best source first, always labelled. */
export function actualNoi(deal: Deal, acq: Record<string, unknown> | null): { value: number | null; source: string } {
  const f = (deal as unknown as { datexLive?: { financials?: Record<string, unknown> } }).datexLive?.financials;
  if (f && n(f.noiTtmActual) != null) return { value: n(f.noiTtmActual), source: `Datex trailing 12 months to ${s(f.period) ?? "?"}` };
  if (f && n(f.noiYtdActual) != null && s(f.period)) {
    const months = Number(String(f.period).slice(4, 6));
    if (months >= 3) return { value: Math.round(n(f.noiYtdActual)! * 12 / months), source: `Datex YTD to ${f.period}, annualised (${months} months)` };
  }
  if (acq && n(acq.budgetNoi) != null) return { value: n(acq.budgetNoi), source: `${n(acq.budgetYear) ?? ""} budget NOI (KPR Corporate Overview)`.trim() };
  if (n(deal.noi) != null) return { value: n(deal.noi), source: "underwritten NOI (deal record)" };
  return { value: null, source: "no NOI on file" };
}

export interface CovenantRow { record: AmRecord; label: string; type: string; threshold: number | null; actual: number | null; actualBasis: string; headroomPct: number | null; noiCushionPct: number | null; status: "ok" | "watch" | "breach" | "info"; nextTest: string | null; loanLabel: string | null; trigger: string | null; triggerDate: string | null; daysToTrigger: number | null }
export function buildCovenantRows(deal: Deal, records: AmRecord[], debt: DebtRow[], today: Date): CovenantRow[] {
  const acq = records.find(r => r.kind === "acquisition" && r.dealId === deal.id)?.data ?? null;
  const noi = actualNoi(deal, acq);
  const live = debt.filter(r => r.dealId === deal.id && !r.superseded);
  return records.filter(r => r.kind === "covenant" && r.dealId === deal.id).map(r => {
    const x = r.data, type = s(x.type) ?? "other", th = n(x.threshold);
    const loans = s(x.loanId) ? live.filter(l => l.record.id === x.loanId) : live;
    const bal = loans.reduce((t, l) => t + (l.balance ?? 0), 0) || null;
    let actual: number | null = null, basis = "";
    if (type === "DSCR" || ((type === "cash-sweep" || type === "cash-trap") && th != null && th < 5)) {
      let ds = 0, ok = loans.length > 0;
      for (const l of loans) {
        const rate = n(x.testRatePct) ?? l.allInPct;
        const a = annualDebtService(l.balance, rate, l.record.data, today, n(x.amortYears));
        if (a.amount == null) { ok = false; break; }
        ds += a.amount; basis = a.basis;
      }
      if (ok && ds > 0 && noi.value != null) { actual = Math.round((noi.value / ds) * 100) / 100; basis = `${noi.source} ÷ ${fmtMoney(ds)} debt service (${basis})`; }
      else basis = noi.value == null ? noi.source : "debt service needs the loan's balance and rate";
    } else if (type === "DY") {
      if (bal && noi.value != null) { actual = Math.round((noi.value / bal) * 1000) / 10; basis = `${noi.source} ÷ ${fmtMoney(bal)} balance`; } else basis = "needs NOI and a balance";
    } else if (type === "LTV") basis = "needs an appraised value — not computed";
    const higherIsBetter = type !== "LTV";
    const headroom = actual != null && th != null ? Math.round(((higherIsBetter ? actual / th : th / actual) - 1) * 1000) / 10 : null;
    const cushion = actual != null && th != null && type !== "LTV" && actual > 0 ? Math.round((1 - th / actual) * 1000) / 10 : null;
    const status: CovenantRow["status"] = headroom == null ? "info" : headroom < 0 ? "breach" : headroom < 10 ? "watch" : "ok";
    const trig = s(x.triggerDate);
    return { record: r, label: covenantLabel(x), type, threshold: th, actual, actualBasis: basis, headroomPct: headroom, noiCushionPct: cushion, status,
      nextTest: nextCovenantTest(x, today), loanLabel: s(x.loanLabel) ?? (loans.length === 1 ? loans[0].loanLabel : null), trigger: s(x.trigger) ?? s(x.description), triggerDate: trig, daysToTrigger: daysUntil(trig, today) };
  }).sort((a, b) => ({ breach: 0, watch: 1, ok: 2, info: 3 }[a.status] - { breach: 0, watch: 1, ok: 2, info: 3 }[b.status]));
}

export interface PlanRow { label: string; plan: number | null; planSource: string; actual: number | null; actualSource: string; unit: "usd" | "pct"; variance: number | null; variancePct: number | null }
export function planVsActual(deal: Deal, records: AmRecord[]): PlanRow[] {
  const acq = records.find(r => r.kind === "acquisition" && r.dealId === deal.id)?.data ?? null;
  const dx = (deal as unknown as { datexLive?: Record<string, unknown> }).datexLive;
  const f = dx?.financials as Record<string, unknown> | undefined;
  const lt = liveTenants(deal);
  const rows: PlanRow[] = [];
  const add = (label: string, plan: number | null, planSource: string, actual: number | null, actualSource: string, unit: PlanRow["unit"]) => {
    const v = plan != null && actual != null ? actual - plan : null;
    rows.push({ label, plan, planSource, actual, actualSource, unit, variance: v != null ? Math.round(v * 10) / 10 : null, variancePct: v != null && plan ? Math.round((v / Math.abs(plan)) * 1000) / 10 : null });
  };
  const uwNoi = n(acq?.noiAtPurchase) ?? n(deal.acqNOIAtClose) ?? n(deal.noi);
  const act = actualNoi(deal, acq);
  add("NOI — underwritten year 1", uwNoi, n(acq?.noiAtPurchase) != null ? "NOI at purchase (Corporate Overview)" : n(deal.acqNOIAtClose) != null ? "NOI at close (deal record)" : "OM year-1 NOI", act.value, act.source, "usd");
  if (f && n(f.noiYtdBudget) != null) add(`NOI year to date vs budget (to ${s(f.period)})`, n(f.noiYtdBudget), "Datex budget", n(f.noiYtdActual), "Datex actual", "usd");
  if (acq && n(acq.budgetNoi) != null && f && n(f.noiTtmActual) != null) add(`${n(acq.budgetYear) ?? ""} budget NOI vs trailing 12`.trim(), n(acq.budgetNoi), "KPR budget", n(f.noiTtmActual), "Datex trailing 12", "usd");
  add("Occupancy", n(deal.occupancy), deal.tenantsAsOf ? `underwriting roll (${deal.tenantsAsOf})` : "underwriting", n(dx?.occupancyPct), dx ? `Datex (${s(dx.asOf) ?? "?"})` : "no Datex snapshot", "pct");
  const omRent = (deal.tenants ?? []).filter(t => !t.isNAP).reduce((t, x) => t + (Number(x.annualRent) || 0), 0) || null;
  const dxRent = lt.source === "Datex" ? lt.tenants.reduce((t, x) => t + (x.annualRent ?? 0), 0) || null : null;
  add("In-place base rent", omRent, "underwriting roll", dxRent, dxRent != null ? `Datex rent roll (${lt.asOf ?? "?"})` : "no Datex snapshot", "usd");
  return rows;
}

export interface TimelineItem { date: string; kind: "close" | "leasing" | "change" | "debt" | "event"; text: string; source: string }
export function sinceAcquisition(deal: Deal, records: AmRecord[], today: Date): TimelineItem[] {
  const out: TimelineItem[] = [];
  const acq = records.find(r => r.kind === "acquisition" && r.dealId === deal.id);
  const close = s(acq?.data.closeDate) ?? s(deal.txnCloseDate);
  if (close) out.push({ date: close, kind: "close", text: `KPR closed the acquisition${n(acq?.data.purchasePrice ?? deal.txnPurchasePrice) ? ` for ${fmtMoney(n(acq?.data.purchasePrice ?? deal.txnPurchasePrice)!)}` : ""}${s(acq?.data.seller ?? deal.txnSeller) ? ` from ${s(acq?.data.seller ?? deal.txnSeller)}` : ""}`, source: acq ? "Acquisition record" : "Deal record" });
  const dx = (deal as unknown as { datexLive?: Record<string, unknown> }).datexLive;
  for (const l of (dx?.leasing as Array<Record<string, unknown>> | undefined) ?? []) {
    const d = s(l.executed) ?? s(l.submitted);
    if (!d || (close && d < close)) continue;
    // Datex LeaseAppDealHistoryBySuite rows are APPLICATIONS (stage "Lease Application", no
    // execution date) — never call one an executed lease unless it carries ExecutionDate.
    out.push({ date: d, kind: "leasing", text: `${s(l.executed) ? "Lease executed" : "Lease application"}: ${s(l.tenant)}${l.gla ? ` · ${Number(l.gla).toLocaleString()} SF` : ""}${l.rentPSF ? ` · $${Number(l.rentPSF).toFixed(2)}/SF` : ""}${s(l.stage) && !s(l.executed) ? ` (${s(l.stage)})` : ""}`, source: "Datex leasing activity" });
  }
  for (const h of deal.propertyHistory ?? []) {
    const d = (h.toAsOf ?? h.recordedAt ?? "").slice(0, 10);
    if (!d || (close && d < close)) continue;
    for (const e of h.events) if (e.kind !== "metric") out.push({ date: d, kind: "change", text: e.text, source: "Property history (document compare)" });
  }
  for (const r of records.filter(x => x.dealId === deal.id)) {
    if (r.kind === "loan" && s(r.data.originationDate)) out.push({ date: String(r.data.originationDate), kind: "debt", text: `Loan closed: ${s(r.data.lender) ?? "lender"}${s(r.data.loanLabel) ? ` (${s(r.data.loanLabel)})` : ""}${n(r.data.originalBalance) ? ` · ${fmtMoney(n(r.data.originalBalance)!)}` : ""}`, source: r.sourceNote ?? "Debt record" });
    if (r.kind === "swap" && s(r.data.tradeDate ?? r.data.effectiveDate)) out.push({ date: String(r.data.tradeDate ?? r.data.effectiveDate), kind: "debt", text: `Swap: ${n(r.data.notional) ? `${fmtMoney(n(r.data.notional)!)} ` : ""}fixed at ${n(r.data.fixedSwapRatePct) ?? "?"}%${s(r.data.counterparty) ? ` with ${s(r.data.counterparty)}` : ""}`, source: r.sourceNote ?? "Swap record" });
    if (r.kind === "date" && s(r.data.date) && String(r.data.date) <= isoUTC(today) && /other|event/i.test(String(r.data.type ?? ""))) out.push({ date: String(r.data.date), kind: "event", text: s(r.data.description) ?? "Event", source: r.sourceNote ?? "Entered" });
  }
  return out.filter(x => x.date <= isoUTC(today)).sort((a, b) => b.date.localeCompare(a.date));
}

/** Drive links on a record: drive.google.com/file/d/<id>/view. */
export function driveLinks(rec: AmRecord): Array<{ url: string; name: string }> {
  const docs = (rec.data.sourceDocs as Array<{ id: string; name?: string }> | undefined) ?? [];
  return docs.filter(d => /^[A-Za-z0-9_-]{20,}$/.test(d.id)).map((d, i) => ({ url: `https://drive.google.com/file/d/${d.id}/view`, name: d.name ?? (docs.length > 1 ? `Source doc ${i + 1}` : "Source doc") }));
}

// ── Credit watch ─────────────────────────────────────────────────────────────
export type CreditStatus = "Bankruptcy" | "Store closures announced" | "Watch" | "OK";
export interface WatchEntry { brand: string; status: string; note?: string | null }
export interface NewsHit { level: string | null; headline: string; url?: string | null; at?: string | null }
export interface NewsSignal { brand: string; level: string | null; headline?: string | null; url?: string | null; at?: string | null; scannedAt?: string | null; hits?: NewsHit[] }
const US_STATES: Array<[string, string]> = [["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],["DC","District of Columbia"]];
/** States a headline names (full names only — "IN"/"OR"/"ME" as words are too ambiguous).
 *  "Washington" alone is skipped (usually D.C. politics, not the state). */
export function headlineStates(headline: string): string[] {
  const h = headline.replace(/West Virginia/gi, "@WV@").replace(/\bNew York City\b/gi, "New York");
  const out = new Set<string>();
  if (/@WV@/.test(h)) out.add("WV");
  for (const [code, name] of US_STATES) {
    if (code === "WA" || code === "WV") continue;
    if (new RegExp(`\\b${name}\\b`, "i").test(h)) out.add(code);
  }
  if (/\bWashington state\b/i.test(h)) out.add("WA");
  // "Kansas City" is a metro, "Virginia Beach" a city in VA — both still point at a state, fine.
  return [...out];
}
/** A headline that names only states where we have no location doesn't affect us. */
export function headlineAffectsUs(headline: string, ourStates: Set<string>): boolean {
  const st = headlineStates(headline);
  return !st.length || st.some(x => ourStates.has(x));
}
export interface CreditLocation { dealId: string; property: string; tenant: string; rent: number; sf: number | null; isAnchor: boolean; coTenancyRentAtRisk: number; coTenancyTenants: number }
export interface CreditRow { key: string; brand: string; locations: CreditLocation[]; rent: number; pctOfRent: number; ig: boolean; status: CreditStatus; statusSource: string; news: NewsSignal | null;
  /** Distress headlines left out because they only name states where we have no location. */
  newsDropped?: number }
const SEV: Record<string, number> = { liquidating: 3, bankruptcy: 2, distressed: 1 };
export function buildCreditWatch(deals: Deal[], abstracts: LeaseAbstract[], watchlist: WatchEntry[], news: NewsSignal[]): { rows: CreditRow[]; totalRent: number; source: string } {
  const byKey = new Map<string, CreditRow>();
  const stateOf = new Map(deals.map(d => [d.id, d.state ?? null]));
  let total = 0, datexDeals = 0;
  const wl = new Map(watchlist.map(w => [brandFamilyKey(w.brand), w]));
  const nw = new Map(news.map(x => [brandFamilyKey(x.brand), x]));
  for (const d of deals) {
    const lt = liveTenants(d);
    if (lt.source === "Datex") datexDeals++;
    const resolved = resolveTenantRisk(d, abstracts.filter(a => a.dealId === d.id));
    const anchors = anchorsReferenced(resolved);
    for (const t of lt.tenants) {
      const rent = t.annualRent ?? 0;
      total += rent;
      const key = brandFamilyKey(t.nationalTenant || t.name);
      if (!key) continue;
      const anchorHit = anchors.find(a => brandFamilyKey(a) === key);
      const ex = anchorHit ? computeExposure(resolved, anchorHit) : null;
      const row = byKey.get(key) ?? { key, brand: brandDisplayName(t.nationalTenant || t.name), locations: [], rent: 0, pctOfRent: 0, ig: isInvestmentGrade(t.name), status: "OK" as CreditStatus, statusSource: "no watchlist entry or distress headline", news: null };
      row.rent += rent;
      row.locations.push({ dealId: d.id, property: d.propertyName || "—", tenant: t.name, rent, sf: t.sf, isAnchor: t.isAnchor, coTenancyRentAtRisk: ex?.tier1Rent ?? 0, coTenancyTenants: ex?.tier1Count ?? 0 });
      byKey.set(key, row);
    }
  }
  for (const r of byKey.values()) {
    r.pctOfRent = total > 0 ? Math.round((r.rent / total) * 10000) / 100 : 0;
    const w = wl.get(r.key), raw = nw.get(r.key);
    const ourStates = new Set(r.locations.map(l => String(stateOf.get(l.dealId) ?? "").toUpperCase()).filter(Boolean));
    let x: NewsSignal | null = raw ?? null;
    if (raw) {
      const hits = (raw.hits && raw.hits.length ? raw.hits : raw.headline ? [{ level: raw.level, headline: raw.headline, url: raw.url, at: raw.at }] : []);
      const keep = hits.filter(h => headlineAffectsUs(h.headline, ourStates));
      r.newsDropped = hits.length - keep.length;
      const best = keep.sort((a, b) => (SEV[b.level ?? ""] ?? 0) - (SEV[a.level ?? ""] ?? 0))[0];
      x = { ...raw, level: best?.level ?? null, headline: best?.headline ?? null, url: best?.url ?? null, at: best?.at ?? null };
    }
    r.news = x;
    const st = String(w?.status ?? "").toLowerCase();
    if (st === "bankruptcy" || st === "liquidating") { r.status = "Bankruptcy"; r.statusSource = `watchlist: ${st}${w?.note ? ` — ${w.note}` : ""}`; }
    else if (x?.level === "bankruptcy" || x?.level === "liquidating") { r.status = "Bankruptcy"; r.statusSource = `news headline — confirm: "${x.headline}"`; }
    else if (x?.level === "distressed") { r.status = "Store closures announced"; r.statusSource = `news headline — confirm: "${x.headline}"`; }
    else if (st === "watch" || st === "distressed") { r.status = "Watch"; r.statusSource = `watchlist: ${st}${w?.note ? ` — ${w.note}` : ""}`; }
  }
  const rows = [...byKey.values()].sort((a, b) => b.rent - a.rent);
  return { rows, totalRent: total, source: `${datexDeals} of ${deals.length} owned properties from Datex, the rest from their OM roster` };
}

// ── Tenant sales & occupancy cost ────────────────────────────────────────────
export interface SalesRow { tenant: string; sf: number | null; sales12: number | null; suspect: Array<{ period: string; amount: number; medianMonth: number }>; salesPSF: number | null; period: string | null; months: number | null; staleMonths: number | null; occCostPct: number | null; occCostBasis: string; isAnchor: boolean; atRisk: boolean; flags: string[]; benchmarkPSF: number | null; vsBenchmarkPct: number | null; benchmarkN: number | null }
const fmtPeriod = (p: string) => `${p.slice(4)}/${p.slice(0, 4)}`;
export function buildSalesRows(deal: Deal, benchmarks: AnalystTenantBenchmark[]): { rows: SalesRow[]; source: string; asOf: string | null } {
  const lt = liveTenants(deal);
  const bench = new Map(benchmarks.map(b => [brandFamilyKey(b.brand), b]));
  const rows: SalesRow[] = [];
  for (const t of lt.tenants) {
    const flags: string[] = [];
    if (t.salesNeverReported) { rows.push({ tenant: t.name, sf: t.sf, sales12: null, suspect: [], salesPSF: null, period: null, months: null, staleMonths: null, occCostPct: null, occCostBasis: "never reports sales", isAnchor: t.isAnchor, atRisk: false, flags: ["never reports"], benchmarkPSF: null, vsBenchmarkPct: null, benchmarkN: null }); continue; }
    if (!t.sales12) continue;
    const s12 = t.sales12;
    if (s12.staleMonths > 6) flags.push(`last report ${fmtPeriod(s12.to)} (${s12.staleMonths} months ago)`);
    if (s12.partial) flags.push(`only ${s12.months} months reported`);
    // A month far above the tenant's usual (a mis-keyed ANNUAL figure) is already left out of
    // the 12-month total on the server — say so, so the total isn't read as complete.
    const suspect = s12.suspectMonths ?? [];
    if (suspect.length) flags.push(`${suspect.length} month${suspect.length === 1 ? "" : "s"} excluded as suspect (> 3× usual month)`);
    const psf = t.sf ? Math.round((s12.sales12 / t.sf) * 100) / 100 : null;
    const parts = [t.annualRent, t.annualNNN, t.annualOther].filter((v): v is number => v != null);
    const occ = s12.sales12 > 0 && t.annualRent != null ? Math.round((parts.reduce((a, b) => a + b, 0) / s12.sales12) * 1000) / 10 : null;
    const limit = t.isAnchor ? 12 : 15;
    const atRisk = occ != null && occ > limit;
    if (atRisk) flags.push(`occupancy cost over ${limit}% (${t.isAnchor ? "anchor" : "shop"})`);
    const b = bench.get(brandFamilyKey(t.nationalTenant || t.name));
    const bp = b?.medianSalesPerSf ?? null;
    rows.push({ tenant: t.name, sf: t.sf, sales12: s12.sales12, suspect, salesPSF: psf, period: `${fmtPeriod(s12.from)}–${fmtPeriod(s12.to)}`, months: s12.months, staleMonths: s12.staleMonths,
      occCostPct: occ, occCostBasis: t.annualNNN == null ? "base rent ÷ sales (no recoveries on file)" : "base + recoveries + other ÷ sales", isAnchor: t.isAnchor, atRisk, flags,
      benchmarkPSF: bp, vsBenchmarkPct: bp && psf ? Math.round(((psf - bp) / bp) * 1000) / 10 : null, benchmarkN: b?.salesCount ?? null });
  }
  rows.sort((a, b) => (b.atRisk ? 1 : 0) - (a.atRisk ? 1 : 0) || (b.occCostPct ?? -1) - (a.occCostPct ?? -1));
  return { rows, source: lt.source === "Datex" ? "Datex SalesHistory (12 most recent reported months)" : "no Datex sales on file", asOf: lt.asOf };
}

// ── Underwritten (OM) vs Today (Datex) ───────────────────────────────────────
export interface CompareRow { label: string; om: number | null; today: number | null; unit: "pct" | "usd" | "sf"; todaySource: string }
export function omVsToday(deal: Deal): CompareRow[] {
  const dx = (deal as unknown as { datexLive?: Record<string, unknown> }).datexLive;
  if (!dx) return [];
  const lt = liveTenants(deal);
  const baseToday = lt.source === "Datex" ? lt.tenants.reduce((t, x) => t + (x.annualRent ?? 0), 0) : null;
  const omBase = (deal.tenants ?? []).filter(t => !isVacant(t.name) && !t.isNAP).reduce((t, x) => t + (n(x.annualRent) ?? 0), 0);
  const fin = dx.financials as Record<string, unknown> | undefined;
  return [
    { label: "Occupancy", om: n(deal.occupancy), today: n(dx.occupancyPct), unit: "pct", todaySource: `Datex Occupancy ${s(dx.period) ?? ""}`.trim() },
    { label: "GLA", om: n(deal.totalSF), today: n(dx.totalGLA), unit: "sf", todaySource: "Datex Occupancy.TotalGLA" },
    { label: "In-place base rent", om: omBase || null, today: baseToday, unit: "usd", todaySource: "Datex TenantsMetrics (annual rent)" },
    (() => {
      // Trailing 12 when the snapshot carries it, else the YTD annualised — always labelled.
      const a = actualNoi(deal, null), dx = a.source.startsWith("Datex");
      return { label: "NOI", om: n(deal.noi), today: dx ? a.value : null, unit: "usd" as const, todaySource: dx ? a.source : "no Datex financials" };
    })(),
  ];
}

// ── Datex GLA tie-out, recomputed from the stored snapshot (Eric, 10/18/26) ──
// The import-time check summed live + vacant suites raw, so it warned on rosters that
// were fine once OCCPSTAT and vacancy are handled: a suite listed twice (lease
// generations), a vacant suite that is also a live lease, or a vacant box already
// pre-leased (an N lease Datex drops from VacantSuites). Handle those first, and only
// WARN above 5% — 2–5% is a quiet note, ≤2% ties.
export interface GlaTieOut { rosterGLA: number; occupancyGLA: number | null; diffPct: number | null; level: "ties" | "note" | "warn" | null; adjustments: string[] }
const suiteKey = (v: unknown) => (s(v) ?? "").toUpperCase().replace(/^(SUITE|STE|UNIT)\s*/i, "").replace(/\s+/g, "");
export function datexGlaTieOut(dx: Record<string, unknown> | null | undefined): GlaTieOut | null {
  if (!dx || !Array.isArray(dx.tenants)) return null;
  const all = dx.tenants as Array<Record<string, unknown>>;
  const adjustments: string[] = [];
  const bySuite = new Map<string, number>(); let noSuite = 0, dupes = 0;
  const live = all.filter(t => !isVacant(String(t.name ?? "")) && t.futureLease !== true && String(t.occStatus ?? "").toUpperCase() !== "I");
  for (const t of live) {
    const sf = n(t.sf) ?? 0, k = suiteKey(t.suite);
    if (!k) { noSuite += sf; continue; }
    if (bySuite.has(k)) { dupes++; bySuite.set(k, Math.max(bySuite.get(k)!, sf)); } else bySuite.set(k, sf);
  }
  if (dupes) adjustments.push(`${dupes} suite${dupes === 1 ? "" : "s"} listed twice counted once`);
  const vacantSrc = Array.isArray(dx.vacantSuites) && (dx.vacantSuites as unknown[]).length
    ? dx.vacantSuites as Array<Record<string, unknown>>
    : all.filter(t => isVacant(String(t.name ?? "")));
  let vacant = 0, vacDup = 0;
  for (const v of vacantSrc) {
    const k = suiteKey(v.suite), sf = n(v.sf) ?? 0;
    if (k && bySuite.has(k)) { vacDup++; continue; }
    if (k) bySuite.set(k, sf); else vacant += sf;
  }
  if (vacDup) adjustments.push(`${vacDup} vacant suite${vacDup === 1 ? "" : "s"} already leased left out`);
  let pre = 0;
  for (const t of all.filter(t => t.futureLease === true)) {
    const k = suiteKey(t.suite);
    if (k && !bySuite.has(k)) { bySuite.set(k, n(t.sf) ?? 0); pre++; }
  }
  if (pre) adjustments.push(`${pre} pre-leased (signed, not yet open) suite${pre === 1 ? "" : "s"} counted`);
  const rosterGLA = Math.round([...bySuite.values()].reduce((a, b) => a + b, 0) + noSuite + vacant);
  const occ = n(dx.totalGLA);
  if (occ == null || occ <= 0) return { rosterGLA, occupancyGLA: null, diffPct: null, level: null, adjustments };
  const diffPct = Math.round(((rosterGLA - occ) / occ) * 1000) / 10;
  return { rosterGLA, occupancyGLA: occ, diffPct, level: Math.abs(diffPct) <= 2 ? "ties" : Math.abs(diffPct) <= 5 ? "note" : "warn", adjustments };
}

// ── A/R aging: current vs FORMER tenants (Eric, 10/18/26) ──
// A vacated tenant's unpaid balance (Big Lots after its bankruptcy) is a collections
// write-off question, not a sign the current roster is delinquent — label it apart.
// A row is "former" when Datex says so, or when its tenant id / brand no longer appears
// on the live rent roll. Only rows Datex itemises can be split; the rest stays "current".
export interface ArSplit { over60: number | null; over90: number | null; current60: number | null; current90: number | null; former60: number; former90: number; former: Array<{ name: string; over60: number | null; over90: number | null }>; currentTop: Array<{ name: string; over60: number | null; over90: number | null }> }
export function splitArAging(dx: Record<string, unknown> | null | undefined): ArSplit | null {
  const ar = dx?.arAging as { over60?: number; over90?: number; byTenant?: Array<{ tenantId?: string | null; name: string; over60?: number | null; over90?: number | null; occStatus?: string | null; former?: boolean | null }> } | undefined;
  if (!ar) return null;
  const tenants = Array.isArray(dx?.tenants) ? dx!.tenants as Array<Record<string, unknown>> : [];
  const liveRows = tenants.filter(t => !isVacant(String(t.name ?? "")) && String(t.occStatus ?? "").toUpperCase() !== "I");
  const ids = new Set(liveRows.map(t => s(t.tenantId)).filter(Boolean) as string[]);
  const brands = new Set(liveRows.map(t => brandFamilyKey(String(t.name ?? ""))));
  const isFormer = (x: NonNullable<typeof ar.byTenant>[number]) => {
    if (x.former === true || String(x.occStatus ?? "").toUpperCase() === "I") return true;
    if (x.former === false || String(x.occStatus ?? "").toUpperCase() === "C") return false;
    if (!tenants.length) return false;                     // no roll to compare against → don't guess
    if (x.tenantId && ids.has(String(x.tenantId))) return false;
    return !brands.has(brandFamilyKey(x.name));
  };
  const rows = ar.byTenant ?? [];
  const former = rows.filter(isFormer), cur = rows.filter(x => !isFormer(x));
  const f60 = former.reduce((t, x) => t + (n(x.over60) ?? 0), 0), f90 = former.reduce((t, x) => t + (n(x.over90) ?? 0), 0);
  const o60 = n(ar.over60), o90 = n(ar.over90);
  return { over60: o60, over90: o90, current60: o60 == null ? null : Math.max(0, o60 - f60), current90: o90 == null ? null : Math.max(0, o90 - f90), former60: f60, former90: f90,
    former: former.map(x => ({ name: x.name, over60: n(x.over60), over90: n(x.over90) })), currentTop: cur.map(x => ({ name: x.name, over60: n(x.over60), over90: n(x.over90) })) };
}

// ── NOI YTD vs budget (Properties tab) — partial-year budgets + ledger basis ────────────
// A property bought mid-year carries a budget for only the months KPR owned it (Westwood's
// $94K, Rockaway), so a raw variance against it reads as a huge miss/beat. That row is labelled
// "partial-year budget" and NOT coloured; the same when the budget is wildly out of line with
// the actual (likely partial or mis-entered). Basis is labelled per row, and a portfolio mixing
// cash and accrual says so — those variances aren't comparable across properties.
export interface NoiVsBudget {
  actual: number | null; budget: number | null; variancePct: number | null; period: string | null;
  basis: "Cash" | "Accrual" | "mixed" | null; partial: boolean; partialNote: string | null;
  /** Colour the variance only when it is like-for-like. */
  colour: "green" | "red" | null;
}
const periodYM = (p: unknown): { y: number; m: number } | null => {
  const t = String(p ?? "").trim(); let m = /^(\d{4})(\d{2})$/.exec(t) ?? /^(\d{4})-(\d{2})/.exec(t);
  return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
};
export function finBasis(fin: Record<string, unknown> | null | undefined): NoiVsBudget["basis"] {
  const b = String(fin?.basis ?? "").trim().toLowerCase();
  return b === "c" || b.startsWith("cash") ? "Cash" : b === "a" || b.startsWith("accr") ? "Accrual" : b === "mixed" ? "mixed" : null;
}
export function noiVsBudget(fin: Record<string, unknown> | null | undefined, closeDate: string | null | undefined): NoiVsBudget | null {
  if (!fin) return null;
  const actual = n(fin.noiYtdActual), budget = n(fin.noiYtdBudget), per = periodYM(fin.period);
  const basis = finBasis(fin);
  let partial = false, partialNote: string | null = null;
  const close = closeDate && /^\d{4}-\d{2}-\d{2}/.test(closeDate) ? { y: Number(closeDate.slice(0, 4)), m: Number(closeDate.slice(5, 7)) } : null;
  if (per && close && close.y === per.y && close.m > 1) {
    partial = true;
    const months = per.m - close.m + 1;
    partialNote = `partial-year budget — owned since ${closeDate!.slice(0, 7)} (${Math.max(0, months)} of ${per.m} months)`;
  } else if (actual != null && budget != null && budget > 0 && actual > 0 && (budget / actual < 0.5 || budget / actual > 2)) {
    partial = true;
    partialNote = "budget looks partial-year or mis-entered — not compared";
  }
  const variancePct = actual != null && budget != null && budget !== 0 ? Math.round(((actual - budget) / Math.abs(budget)) * 1000) / 10 : null;
  const colour = partial || basis === "mixed" || variancePct == null ? null : variancePct >= 0 ? "green" : variancePct <= -5 ? "red" : null;
  return { actual, budget, variancePct: partial ? null : variancePct, period: fin.period != null ? String(fin.period) : null, basis, partial, partialNote, colour };
}

// ── Dates tab: portfolio covenants collapsed + key debt deadlines (Eric, 10/19/26) ──────
/** One covenant tested across a whole portfolio loan (Cedar's 7.5% debt yield, repeated on 13
 *  properties) collapses to ONE row "Cedar portfolio (13 properties)". Same type + date +
 *  description on ≥3 properties is a portfolio test; anything else is left alone. */
export function collapsePortfolioCovenants(items: CriticalDate[], records: AmRecord[], deals: Deal[]): Array<CriticalDate & { properties?: string[] }> {
  const isCov = (i: CriticalDate) => i.type === "Covenant test" || i.type === "Covenant trigger";
  const groups = new Map<string, CriticalDate[]>();
  for (const i of items) if (isCov(i) && !i.tenant) { const k = `${i.type}|${i.date}|${i.description.toLowerCase().replace(/\s+/g, " ")}`; groups.set(k, [...(groups.get(k) ?? []), i]); }
  const out: Array<CriticalDate & { properties?: string[] }> = [];
  const done = new Set<string>();
  for (const i of items) {
    if (!isCov(i) || i.tenant) { out.push(i); continue; }
    const k = `${i.type}|${i.date}|${i.description.toLowerCase().replace(/\s+/g, " ")}`;
    const g = groups.get(k)!;
    const props = [...new Set(g.map(x => x.dealId))];
    if (props.length < 3) { out.push(i); continue; }
    if (done.has(k)) continue;
    done.add(k);
    out.push({ ...i, property: `${portfolioName(props, records)} portfolio (${props.length} properties)`, properties: props.map(id => deals.find(d => d.id === id)?.propertyName ?? id),
      owner: [...new Set(g.map(x => x.owner).filter(Boolean))].length === 1 ? g[0].owner : null });
  }
  return out;
}
/** A portfolio's name: the word its loans share (label, then lender) — "Cedar" — else "Loan". */
export function portfolioName(dealIds: string[], records: AmRecord[]): string {
  const rows = records.filter(r => (r.kind === "loan" || r.kind === "covenant") && r.dealId && dealIds.includes(r.dealId));
  for (const f of ["portfolio", "loanLabel", "loanName", "lender"]) {
    const vals = rows.map(r => s(r.data[f])).filter((v): v is string => !!v);
    if (!vals.length) continue;
    const words = vals.map(v => new Set(v.split(/[^A-Za-z0-9&]+/).filter(w => w.length > 2 && !/^(loan|senior|mortgage|the|and|portfolio|cap|rate)$/i.test(w))));
    const common = [...words[0]].filter(w => words.every(ws => ws.has(w)));
    if (common.length && vals.length >= Math.ceil(dealIds.length / 2)) return common[0];
  }
  return "Loan";
}
export interface DebtDeadline { date: string; endDate?: string | null; days: number; kind: "Rate cap expires" | "Extension notice window" | "Extension notice" | "Loan maturity"; title: string; detail: string; dealIds: string[]; properties: string[] }
const isoIn = (t: string): string[] => {
  const out: string[] = [];
  const re = /(\d{4}-\d{2}-\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g; let m: RegExpExecArray | null;
  while ((m = re.exec(t))) out.push(m[1] ?? `${m[4].length === 2 ? 2000 + Number(m[4]) : m[4]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  return out;
};
/** Debt deadlines pinned above the 90-day list regardless of window: rate-cap expirations,
 *  extension-notice windows, and maturities inside 12 months — derived from the loan records. */
export function keyDebtDeadlines(deals: Deal[], records: AmRecord[], today: Date): DebtDeadline[] {
  const names = new Map(deals.map(d => [d.id, d.propertyName || "—"]));
  const loans = records.filter(r => r.kind === "loan" && r.dealId && names.has(r.dealId) && !r.id.startsWith("datex-loan:"));
  const out: DebtDeadline[] = [];
  const caps = new Map<string, { cap: RateCap; ids: Set<string> }>();
  for (const r of loans) {
    const d = r.data, name = names.get(r.dealId!)!;
    for (const c of loanRateCaps(d)) if (c.expiry) {
      const k = `${c.strikePct}|${c.notional ?? ""}|${c.expiry}`;
      const e = caps.get(k) ?? { cap: c, ids: new Set<string>() }; e.ids.add(r.dealId!); caps.set(k, e);
    }
    // Extension-notice WINDOW written in the text ("notice between 11/19/26 and 1/3/27"), else the deadline field.
    const txt = [s(d.extensionOptions), s(d.notes), s(d.covenants), s(d.extensionNotice)].filter(Boolean).join("\n");
    const seg = txt.split(/\n|(?<=\.)\s+/).find(x => /notice/i.test(x) && /exten/i.test(x + " " + (s(d.extensionOptions) ?? "")) && isoIn(x).length >= 2);
    const win = seg ? isoIn(seg).slice(0, 2).sort() : null;
    if (win) out.push({ date: win[0], endDate: win[1], days: daysUntil(win[1], today)!, kind: "Extension notice window", title: `${name} — extension notice window`, detail: `${fmtD(win[0])} – ${fmtD(win[1])}${s(d.extensionOptions) && isoIn(s(d.extensionOptions)!).length < 2 ? ` · ${s(d.extensionOptions)}` : s(d.extensionOptions) ? ` · ${s(d.extensionOptions)!.replace(/[;,.]?\s*notice[^;.]*/i, "").trim()}` : ""}`.replace(/ · $/, ""), dealIds: [r.dealId!], properties: [name] });
    else if (s(d.extensionNoticeDate)) out.push({ date: String(d.extensionNoticeDate), days: daysUntil(String(d.extensionNoticeDate), today)!, kind: "Extension notice", title: `${name} — extension notice due`, detail: s(d.extensionOptions) ?? `${s(d.lender) ?? "Loan"} extension`, dealIds: [r.dealId!], properties: [name] });
    const mat = s(d.maturityDate), md = daysUntil(mat, today);
    if (mat && md != null && md >= 0 && md <= 365) out.push({ date: mat, days: md, kind: "Loan maturity", title: `${name} — loan matures`, detail: `${s(d.lender) ?? "Loan"}${n(d.currentBalance ?? d.originalBalance) ? ` · ${fmtMoney(n(d.currentBalance ?? d.originalBalance)!)}` : ""}${s(d.extensionOptions) ? ` · ext: ${s(d.extensionOptions)}` : ""}`, dealIds: [r.dealId!], properties: [name] });
  }
  for (const { cap, ids } of caps.values()) {
    const props = [...ids].map(id => names.get(id)!);
    const label = props.length >= 3 ? `${portfolioName([...ids], records)} portfolio (${props.length} properties)` : props.join(", ");
    out.push({ date: cap.expiry!, days: daysUntil(cap.expiry, today)!, kind: "Rate cap expires", title: `${label} — rate cap expires`, detail: `${cap.notional ? `${fmtMoney(cap.notional)} ` : ""}cap @ ${cap.strikePct.toFixed(2)}%`, dealIds: [...ids], properties: props });
  }
  return out.filter(x => x.days != null && x.days >= 0 && x.days <= 730).sort((a, b) => a.date.localeCompare(b.date));
}
const fmtD = (iso: string) => { const [y, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}/${y.slice(2)}`; };
