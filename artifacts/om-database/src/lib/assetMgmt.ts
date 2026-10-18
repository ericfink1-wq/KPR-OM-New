import type { Deal, LeaseAbstract } from "./idb";
import type { RatesPayload, AnalystTenantBenchmark } from "./api";
import { calcSwapBreakage } from "./prepay";
import { brandFamilyKey, brandDisplayName, isInvestmentGrade } from "./tenantCredit";
import { resolveTenantRisk, anchorsReferenced, computeExposure } from "./leaseRisk";
import { isVacant, tenantLabel } from "./utils";

// ASSET MANAGEMENT calculations (Eric, 10/18/26) — owned properties only, all deterministic.
// Every figure the UI shows carries a `source` and, where there is one, an as-of date.

export interface AmRecord { id: string; kind: "loan" | "swap" | "date" | "pref"; dealId: string | null; data: Record<string, unknown>; sourceNote: string | null; updatedBy: string | null; updatedAt: string }

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
export type DateType = "Lease expiry" | "Option notice" | "Termination / kick-out" | "Co-tenancy" | "Loan maturity" | "Extension notice" | "Swap maturity" | "Other";
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
    for (const o of a.options ?? []) if (o.noticeDate && o.status !== "exercised" && o.status !== "expired") push({ date: o.noticeDate, type: "Option notice", dealId: d.id, property: d.propertyName || "—", tenant: a.tenantName ?? null, description: `${o.number ?? (o.ordinal ? `Option ${o.ordinal}` : "Option")}${o.length ? ` · ${o.length}` : ""}${o.ratePSF ? ` · $${o.ratePSF}/SF` : ""}`, source: "Lease abstract", owner: owner(d) });
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
    { label: "NOI", om: n(deal.noi), today: n(fin?.noiTtmActual), unit: "usd", todaySource: fin ? `Datex FinancialGroups, trailing 12 months to ${s(fin.period) ?? "?"}` : "no Datex financials" },
  ];
}
