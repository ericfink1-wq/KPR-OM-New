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

// ── Debt & swaps ──────────────────────────────────────────────────────────────
export interface DebtRow {
  record: AmRecord; dealId: string; property: string; lender: string | null;
  balance: number | null; balanceIsOriginal: boolean; rateType: string | null; index: string | null; spreadBps: number | null;
  allInPct: number | null; allInSource: string; maturity: string | null; daysToMaturity: number | null; flag: "red" | "amber" | null;
  swaps: SwapRow[]; datexOnly: boolean; superseded: boolean; loanLabel: string | null;
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
    const pending = d.termsPending === true || notional == null || K == null || !maturity;
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
    const cur = n(d.currentBalance), orig = n(d.originalBalance), spread = n(d.spreadBps);
    // A swap names its loan by id or by loanLabel (Rockaway: Commons / Town Court / Town Plaza);
    // an unlabelled one belongs to the property's loans.
    const label = s(d.loanLabel);
    const mySwaps = swaps.filter(w => w.dealId === r.dealId
      && (s(w.record.data.loanId) ? w.record.data.loanId === r.id : !w.loanLabel || !label || w.loanLabel.toLowerCase() === label.toLowerCase()));
    const type = s(d.rateType) ?? (mySwaps.length ? "swapped" : n(d.fixedRatePct) != null && spread == null ? "fixed" : spread != null ? "floating" : null);
    let allIn = n(d.allInRatePct), src = allIn != null ? "as entered" : "";
    const priced = mySwaps.find(w => !w.termsPending && w.allInFixedPct != null);
    if (allIn == null && type === "swapped" && priced) { allIn = priced.allInFixedPct; src = "swap fixed + spread"; }
    if (allIn == null && type === "fixed" && n(d.fixedRatePct) != null) { allIn = n(d.fixedRatePct); src = "fixed rate"; }
    if (allIn == null && type === "floating" && spread != null && spot.rate != null && !isDailySofr(s(d.index))) { allIn = Math.round((spot.rate + spread / 100) * 10000) / 10000; src = `1M Term SOFR ${spot.rate.toFixed(3)}% + spread (live)`; }
    const maturity = s(d.maturityDate), days = daysUntil(maturity, today);
    return {
      record: r, dealId: r.dealId!, property: names.get(r.dealId!)!, lender: s(d.lender), balance: cur ?? orig, balanceIsOriginal: cur == null && orig != null,
      rateType: type, index: s(d.index), spreadBps: spread, allInPct: allIn, allInSource: src || "not enough terms", maturity, daysToMaturity: days, flag: flagFor(days),
      swaps: mySwaps, datexOnly, superseded: datexOnly && enteredDeals.has(r.dealId), loanLabel: label,
    };
  }).sort((a, b) => (a.maturity ?? "9999").localeCompare(b.maturity ?? "9999"));
}

export interface DebtTotals { totalDebt: number; loans: number; weightedRatePct: number | null; rateCoveragePct: number; pctFixedOrHedged: number | null; wall: Array<{ year: number; amount: number }>; totalMtm: number | null }
export function debtTotals(rows: DebtRow[], swaps: SwapRow[]): DebtTotals {
  const live = rows.filter(r => !r.superseded && r.balance != null);
  const total = live.reduce((t, r) => t + (r.balance ?? 0), 0);
  const priced = live.filter(r => r.allInPct != null);
  const pricedBal = priced.reduce((t, r) => t + r.balance!, 0);
  const fixedish = live.filter(r => r.rateType === "fixed" || r.rateType === "swapped").reduce((t, r) => t + r.balance!, 0);
  const typed = live.filter(r => r.rateType).reduce((t, r) => t + r.balance!, 0);
  const wall = new Map<number, number>();
  for (const r of live) if (r.maturity) { const y = Number(r.maturity.slice(0, 4)); wall.set(y, (wall.get(y) ?? 0) + r.balance!); }
  const mtms = swaps.map(w => w.mtm).filter((v): v is number => v != null);
  return {
    totalDebt: total, loans: live.length,
    weightedRatePct: pricedBal > 0 ? Math.round((priced.reduce((t, r) => t + r.balance! * r.allInPct!, 0) / pricedBal) * 1000) / 1000 : null,
    rateCoveragePct: total > 0 ? Math.round((pricedBal / total) * 100) : 0,
    pctFixedOrHedged: typed > 0 ? Math.round((fixedish / typed) * 100) : null,
    wall: [...wall.entries()].sort((a, b) => a[0] - b[0]).map(([year, amount]) => ({ year, amount })),
    totalMtm: mtms.length ? mtms.reduce((a, b) => a + b, 0) : null,
  };
}

// ── Preferred equity — capital, NOT debt: never in total debt or the weighted rate ──
export interface PrefRow { record: AmRecord; dealId: string; property: string; loanLabel: string | null; investor: string | null; amount: number | null; ratePct: number | null; maturity: string | null; daysToMaturity: number | null }
export function buildPrefRows(records: AmRecord[], deals: Deal[], today: Date): PrefRow[] {
  const names = new Map(deals.map(d => [d.id, d.propertyName || "Untitled"]));
  return records.filter(r => r.kind === "pref" && r.dealId && names.has(r.dealId)).map(r => {
    const d = r.data, maturity = s(d.maturityDate);
    return { record: r, dealId: r.dealId!, property: names.get(r.dealId!)!, loanLabel: s(d.loanLabel), investor: s(d.investor), amount: n(d.amount), ratePct: n(d.ratePct), maturity, daysToMaturity: daysUntil(maturity, today) };
  }).sort((a, b) => a.property.localeCompare(b.property) || (a.loanLabel ?? "").localeCompare(b.loanLabel ?? ""));
}
export function prefTotals(rows: PrefRow[]): { total: number; weightedRatePct: number | null; count: number } {
  const withAmt = rows.filter(r => r.amount != null);
  const total = withAmt.reduce((t, r) => t + r.amount!, 0);
  const priced = withAmt.filter(r => r.ratePct != null), pb = priced.reduce((t, r) => t + r.amount!, 0);
  return { total, count: rows.length, weightedRatePct: pb > 0 ? Math.round((priced.reduce((t, r) => t + r.amount! * r.ratePct!, 0) / pb) * 1000) / 1000 : null };
}

// ── Live tenant list (Datex first, OM roster as fallback) ────────────────────
export interface LiveTenant { name: string; tenantId: string | null; sf: number | null; annualRent: number | null; annualNNN: number | null; annualOther: number | null; leaseExpiry: string | null; isAnchor: boolean; nationalTenant: string | null; sales12: { sales12: number; months: number; from: string; to: string; staleMonths: number; partial: boolean } | null; salesNeverReported: boolean; lastSalesPeriod: string | null; delinquency: number | null; coTenancy: boolean }
export function liveTenants(deal: Deal): { tenants: LiveTenant[]; source: "Datex" | "OM roster"; asOf: string | null } {
  const dx = (deal as unknown as { datexLive?: Record<string, unknown> }).datexLive;
  const omAnchors = new Set((deal.tenants ?? []).filter(t => t.isAnchor).map(t => brandFamilyKey(t.canonicalName || t.name)));
  const dxT = Array.isArray(dx?.tenants) ? dx!.tenants as Array<Record<string, unknown>> : null;
  if (dxT && dxT.length) {
    return { source: "Datex", asOf: s(dx!.asOf), tenants: dxT.filter(t => !isVacant(String(t.name ?? ""))).map(t => {
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
export function buildCriticalDates(deals: Deal[], records: AmRecord[], abstracts: LeaseAbstract[], today: Date, horizonDays = 3650): { items: CriticalDate[]; undatedRights: Map<string, number> } {
  const owned = new Map(deals.map(d => [d.id, d]));
  const owner = (d: Deal | undefined) => s((d as unknown as { datexLive?: { assetManager?: string } } | undefined)?.datexLive?.assetManager);
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
      if (s(x.maturityDate)) push({ date: String(x.maturityDate), type: "Loan maturity", dealId: d.id, property: d.propertyName || "—", tenant: null, description: `${s(x.lender) ?? "Loan"}${n(x.currentBalance ?? x.originalBalance) ? ` · $${(n(x.currentBalance ?? x.originalBalance)! / 1e6).toFixed(2)}M` : ""}${s(x.extensionOptions) ? ` · ext: ${s(x.extensionOptions)}` : ""}`, source: src, owner: owner(d), recordId: r.id });
      if (s(x.extensionNoticeDate)) push({ date: String(x.extensionNoticeDate), type: "Extension notice", dealId: d.id, property: d.propertyName || "—", tenant: null, description: `${s(x.lender) ?? "Loan"} extension notice`, source: src, owner: owner(d), recordId: r.id });
    } else if (r.kind === "swap" && s(x.maturityDate)) {
      push({ date: String(x.maturityDate), type: "Swap maturity", dealId: d.id, property: d.propertyName || "—", tenant: null, description: `${s(x.counterparty) ?? "Swap"}${n(x.notional) ? ` · $${(n(x.notional)! / 1e6).toFixed(2)}M` : ""}`, source: src, owner: owner(d), recordId: r.id });
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
      if (ok && ds > 0 && noi.value != null) { actual = Math.round((noi.value / ds) * 100) / 100; basis = `${noi.source} ÷ $${(ds / 1e6).toFixed(2)}M debt service (${basis})`; }
      else basis = noi.value == null ? noi.source : "debt service needs the loan's balance and rate";
    } else if (type === "DY") {
      if (bal && noi.value != null) { actual = Math.round((noi.value / bal) * 1000) / 10; basis = `${noi.source} ÷ $${(bal / 1e6).toFixed(2)}M balance`; } else basis = "needs NOI and a balance";
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
  if (close) out.push({ date: close, kind: "close", text: `KPR closed the acquisition${n(acq?.data.purchasePrice ?? deal.txnPurchasePrice) ? ` for $${(n(acq?.data.purchasePrice ?? deal.txnPurchasePrice)! / 1e6).toFixed(1)}M` : ""}${s(acq?.data.seller ?? deal.txnSeller) ? ` from ${s(acq?.data.seller ?? deal.txnSeller)}` : ""}`, source: acq ? "Acquisition record" : "Deal record" });
  const dx = (deal as unknown as { datexLive?: Record<string, unknown> }).datexLive;
  for (const l of (dx?.leasing as Array<Record<string, unknown>> | undefined) ?? []) {
    const d = s(l.executed) ?? s(l.submitted);
    if (!d || (close && d < close)) continue;
    out.push({ date: d, kind: "leasing", text: `${s(l.executed) ? "Lease executed" : "Lease in progress"}: ${s(l.tenant)}${l.gla ? ` · ${Number(l.gla).toLocaleString()} SF` : ""}${l.rentPSF ? ` · $${Number(l.rentPSF).toFixed(2)}/SF` : ""}${s(l.stage) && !s(l.executed) ? ` (${s(l.stage)})` : ""}`, source: "Datex leasing activity" });
  }
  for (const h of deal.propertyHistory ?? []) {
    const d = (h.toAsOf ?? h.recordedAt ?? "").slice(0, 10);
    if (!d || (close && d < close)) continue;
    for (const e of h.events) if (e.kind !== "metric") out.push({ date: d, kind: "change", text: e.text, source: "Property history (document compare)" });
  }
  for (const r of records.filter(x => x.dealId === deal.id)) {
    if (r.kind === "loan" && s(r.data.originationDate)) out.push({ date: String(r.data.originationDate), kind: "debt", text: `Loan closed: ${s(r.data.lender) ?? "lender"}${s(r.data.loanLabel) ? ` (${s(r.data.loanLabel)})` : ""}${n(r.data.originalBalance) ? ` · $${(n(r.data.originalBalance)! / 1e6).toFixed(2)}M` : ""}`, source: r.sourceNote ?? "Debt record" });
    if (r.kind === "swap" && s(r.data.tradeDate ?? r.data.effectiveDate)) out.push({ date: String(r.data.tradeDate ?? r.data.effectiveDate), kind: "debt", text: `Swap: ${n(r.data.notional) ? `$${(n(r.data.notional)! / 1e6).toFixed(2)}M ` : ""}fixed at ${n(r.data.fixedSwapRatePct) ?? "?"}%${s(r.data.counterparty) ? ` with ${s(r.data.counterparty)}` : ""}`, source: r.sourceNote ?? "Swap record" });
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
export interface NewsSignal { brand: string; level: string | null; headline?: string | null; url?: string | null; at?: string | null; scannedAt?: string | null }
export interface CreditLocation { dealId: string; property: string; tenant: string; rent: number; sf: number | null; isAnchor: boolean; coTenancyRentAtRisk: number; coTenancyTenants: number }
export interface CreditRow { key: string; brand: string; locations: CreditLocation[]; rent: number; pctOfRent: number; ig: boolean; status: CreditStatus; statusSource: string; news: NewsSignal | null }
export function buildCreditWatch(deals: Deal[], abstracts: LeaseAbstract[], watchlist: WatchEntry[], news: NewsSignal[]): { rows: CreditRow[]; totalRent: number; source: string } {
  const byKey = new Map<string, CreditRow>();
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
    const w = wl.get(r.key), x = nw.get(r.key);
    r.news = x ?? null;
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
export interface SalesRow { tenant: string; sf: number | null; sales12: number | null; salesPSF: number | null; period: string | null; months: number | null; staleMonths: number | null; occCostPct: number | null; occCostBasis: string; isAnchor: boolean; atRisk: boolean; flags: string[]; benchmarkPSF: number | null; vsBenchmarkPct: number | null; benchmarkN: number | null }
const fmtPeriod = (p: string) => `${p.slice(4)}/${p.slice(0, 4)}`;
export function buildSalesRows(deal: Deal, benchmarks: AnalystTenantBenchmark[]): { rows: SalesRow[]; source: string; asOf: string | null } {
  const lt = liveTenants(deal);
  const bench = new Map(benchmarks.map(b => [brandFamilyKey(b.brand), b]));
  const rows: SalesRow[] = [];
  for (const t of lt.tenants) {
    const flags: string[] = [];
    if (t.salesNeverReported) { rows.push({ tenant: t.name, sf: t.sf, sales12: null, salesPSF: null, period: null, months: null, staleMonths: null, occCostPct: null, occCostBasis: "never reports sales", isAnchor: t.isAnchor, atRisk: false, flags: ["never reports"], benchmarkPSF: null, vsBenchmarkPct: null, benchmarkN: null }); continue; }
    if (!t.sales12) continue;
    const s12 = t.sales12;
    if (s12.staleMonths > 6) flags.push(`last report ${fmtPeriod(s12.to)} (${s12.staleMonths} months ago)`);
    if (s12.partial) flags.push(`only ${s12.months} months reported`);
    const psf = t.sf ? Math.round((s12.sales12 / t.sf) * 100) / 100 : null;
    const parts = [t.annualRent, t.annualNNN, t.annualOther].filter((v): v is number => v != null);
    const occ = s12.sales12 > 0 && t.annualRent != null ? Math.round((parts.reduce((a, b) => a + b, 0) / s12.sales12) * 1000) / 10 : null;
    const limit = t.isAnchor ? 12 : 15;
    const atRisk = occ != null && occ > limit;
    if (atRisk) flags.push(`occupancy cost over ${limit}% (${t.isAnchor ? "anchor" : "shop"})`);
    const b = bench.get(brandFamilyKey(t.nationalTenant || t.name));
    const bp = b?.medianSalesPerSf ?? null;
    rows.push({ tenant: t.name, sf: t.sf, sales12: s12.sales12, salesPSF: psf, period: `${fmtPeriod(s12.from)}–${fmtPeriod(s12.to)}`, months: s12.months, staleMonths: s12.staleMonths,
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
