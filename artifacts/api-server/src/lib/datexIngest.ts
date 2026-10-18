import { createHash } from "crypto";
import { buildLiveBlock, glaTieOut, reduceSalesHistory, pendingSaleProblem, type DatexDealPayload } from "./datexImport";
export { pendingSaleProblem };

// DATEX AUTO-REFRESH — the MERGE layer for POST /api/datex/ingest (Eric, 10/18/26).
//
// A scheduled Claude task reads Datex and posts only what CHANGED. So unlike the file import
// (which replaces the whole live block), a block absent from the payload is KEPT from the
// stored snapshot. Every block that IS sent goes through the same buildLiveBlock guardrails
// as the file import (bldgIds must match the map, occupied ≤ total, over90 ≤ over60, null =
// unknown, only whitelisted fields survive) — this file only decides how sent blocks combine
// with what is already stored. PURE: no database; the route does the reads and writes.

/** The blocks a payload can carry, each stamped with its own as-of date. */
export const INGEST_BLOCKS = ["occupancy", "tenants", "vacantSuites", "sales", "arAging", "financials", "leasing", "assetManager", "notes"] as const;
export type IngestBlock = typeof INGEST_BLOCKS[number];

const OCC_KEYS = ["period", "totalGLA", "occupiedGLA", "vacantGLA", "occupancyPct", "totalUnits", "occupiedUnits", "vacantUnits", "segments"] as const;
/** Sales history kept per deal, newest period back. 24 months covers TTM and the prior TTM. */
export const SALES_MONTHS_KEPT = 24;

export interface SalesRow { tenantId: string; period: string; amount: number; reportingType: string }

const num = (v: unknown): number | null => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const yyyymm = (v: unknown): string | null => { const s = String(v ?? "").trim(); return /^\d{6}$/.test(s) ? s : null; };
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(4)) - Number(a.slice(4)));
const has = (o: unknown, k: string) => o != null && typeof o === "object" && (o as Record<string, unknown>)[k] != null;

/** Which blocks a payload deal actually SENDS. Absent = keep what is stored. */
export function blocksSent(p: DatexDealPayload): IngestBlock[] {
  const out: IngestBlock[] = [];
  if (OCC_KEYS.some(k => has(p, k))) out.push("occupancy");
  if (Array.isArray(p.tenants)) out.push("tenants");
  if (Array.isArray(p.vacantSuites)) out.push("vacantSuites");
  if (Array.isArray(p.salesHistory)) out.push("sales");
  if (p.arAging && typeof p.arAging === "object") out.push("arAging");
  if (p.financials && typeof p.financials === "object") out.push("financials");
  if (Array.isArray(p.leasing)) out.push("leasing");
  if (typeof p.assetManager === "string") out.push("assetManager");
  if (typeof p.notes === "string") out.push("notes");
  return out;
}

/** Upsert SalesHistory rows by tenantId+period. A reported (RPT) figure is never replaced
 *  by an estimate for the same month. Keeps the last SALES_MONTHS_KEPT months. */
export function mergeSalesRows(stored: SalesRow[], incoming: unknown[]): { rows: SalesRow[]; added: number; updated: number; dropped: number } {
  const m = new Map(stored.map(r => [`${r.tenantId}|${r.period}`, r]));
  let added = 0, updated = 0, dropped = 0;
  for (const x of incoming) {
    const r = (x ?? {}) as Record<string, unknown>;
    const tenantId = String(r.tenantId ?? "").trim(), period = yyyymm(r.period), amount = num(r.amount);
    if (!tenantId || !period || period === "190001" || amount == null || amount < 0) { dropped++; continue; }
    const reportingType = String(r.reportingType ?? "RPT").trim().toUpperCase() || "RPT";
    const k = `${tenantId}|${period}`, cur = m.get(k);
    if (cur && cur.reportingType === "RPT" && reportingType !== "RPT") continue;
    if (!cur) added++; else if (cur.amount !== amount || cur.reportingType !== reportingType) updated++; else continue;
    m.set(k, { tenantId, period, amount, reportingType });
  }
  const all = [...m.values()];
  const max = all.reduce((a, r) => (r.period > a ? r.period : a), "");
  const rows = max ? all.filter(r => monthsBetween(r.period, max) < SALES_MONTHS_KEPT) : all;
  rows.sort((a, b) => a.tenantId.localeCompare(b.tenantId) || a.period.localeCompare(b.period));
  return { rows, added, updated, dropped };
}

/** Leasing pipeline rows upserted by tenant + suite + submitted date; newest 40 kept. */
export function mergeLeasing(stored: Array<Record<string, unknown>>, incoming: Array<Record<string, unknown>>): { rows: Array<Record<string, unknown>>; added: number; updated: number } {
  const key = (r: Record<string, unknown>) => `${String(r.tenant ?? "").trim().toLowerCase()}|${String(r.suite ?? "").trim().toLowerCase()}|${String(r.submitted ?? "")}`;
  const m = new Map(stored.map(r => [key(r), r]));
  let added = 0, updated = 0;
  for (const r of incoming) {
    const k = key(r), cur = m.get(k);
    if (!cur) added++; else if (JSON.stringify(cur) !== JSON.stringify(r)) updated++; else continue;
    m.set(k, r);
  }
  const rows = [...m.values()].sort((a, b) => String(b.submitted ?? b.executed ?? "").localeCompare(String(a.submitted ?? a.executed ?? ""))).slice(0, 40);
  return { rows, added, updated };
}

/** The roster fingerprint GET /datex/state publishes, so the job can tell whether a
 *  building's rent roll changed without re-sending it. Formula (documented for the job):
 *  one line per stored tenant "tenantId|sf|annualRent|leaseExpiry" (numbers rounded to 2dp,
 *  blank when unknown), lines sorted, joined with "\n", sha256 hex, first 16 chars. */
export function rosterHash(tenants: Array<Record<string, unknown>>): string {
  const f = (v: unknown) => { const n = num(v); return n == null ? "" : String(Math.round(n * 100) / 100); };
  const lines = tenants.map(t => [String(t.tenantId ?? "").trim(), f(t.sf), f(t.annualRent), String(t.leaseExpiry ?? "").slice(0, 10)].join("|")).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
}

export interface MergeResult {
  block: Record<string, unknown>;
  salesRows: SalesRow[];
  sent: IngestBlock[];
  changed: string[];
  warnings: string[];
}

/**
 * Merge one payload deal onto the stored live block. Blocks absent from the payload are
 * kept; blocks present are validated by buildLiveBlock, then replaced (occupancy, tenants,
 * vacantSuites, arAging, financials) or upserted (sales, leasing).
 */
export function mergeDatexDeal(
  prev: Record<string, unknown> | null,
  storedSales: SalesRow[],
  p: DatexDealPayload,
  asOf: string,
  mapEntry: { bldgIds: string[] },
): MergeResult | { problem: string } {
  const sale = pendingSaleProblem(p);
  if (sale) return { problem: sale };
  const sent = blocksSent(p);
  if (!sent.length) return { problem: "no Datex blocks sent for this deal (nothing to merge)" };
  // Validate every sent block with the same rules as the file import. Sales are merged here,
  // not there, because the stored history is what makes an append possible.
  const built = buildLiveBlock({ ...p, salesHistory: undefined }, asOf, mapEntry);
  if ("problem" in built) return { problem: built.problem };
  const b = built.block;

  const warnings: string[] = [], changed: string[] = [];
  const next: Record<string, unknown> = prev ? { ...prev } : {};
  const prevAsOf = prev ? String(prev.asOf ?? "") : "";
  // A block stored by the file import has no per-block stamps — they all date from its asOf.
  const blockAsOf: Record<string, string> = { ...((prev?.blockAsOf as Record<string, string> | undefined) ?? {}) };
  if (prev && prevAsOf && !prev.blockAsOf) {
    if (OCC_KEYS.some(k => prev[k] != null)) blockAsOf.occupancy = prevAsOf;
    for (const k of ["tenants", "vacantSuites", "arAging", "financials", "leasing", "assetManager", "notes"] as const) if (prev[k] != null) blockAsOf[k] = prevAsOf;
    if (prev.salesHistoryCovered) blockAsOf.sales = prevAsOf;
  }
  next.source = "datex"; next.bldgIds = b.bldgIds; next.importedAt = b.importedAt;
  next.asOf = prevAsOf && prevAsOf > asOf ? prevAsOf : asOf;
  if (prevAsOf && asOf < prevAsOf) warnings.push(`payload asOf ${asOf} is older than the stored snapshot (${prevAsOf}); sent blocks still replace the stored ones`);
  const stamp = (k: IngestBlock) => { blockAsOf[k] = asOf; };
  const differs = (a: unknown, c: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(c ?? null);

  if (sent.includes("occupancy")) {
    const before = Object.fromEntries(OCC_KEYS.map(k => [k, prev?.[k]]));
    for (const k of OCC_KEYS) delete next[k];
    for (const k of OCC_KEYS) if (b[k] != null) next[k] = b[k];
    const after = Object.fromEntries(OCC_KEYS.map(k => [k, next[k]]));
    if (differs(before, after)) changed.push(`occupancy ${before.occupancyPct ?? "—"}% → ${after.occupancyPct ?? "—"}%${after.period ? ` (period ${after.period})` : ""}`);
    stamp("occupancy");
  }
  const prevTenants = Array.isArray(prev?.tenants) ? (prev!.tenants as Array<Record<string, unknown>>) : [];
  if (sent.includes("tenants")) {
    const nt = Array.isArray(b.tenants) ? (b.tenants as Array<Record<string, unknown>>) : [];
    if (!nt.length) warnings.push("tenants block was empty — the stored rent roll was cleared");
    if (rosterHash(prevTenants) !== rosterHash(nt)) changed.push(`rent roll ${prevTenants.length} → ${nt.length} tenants`);
    if (nt.length) next.tenants = nt; else delete next.tenants;
    stamp("tenants");
  }
  if (sent.includes("vacantSuites")) {
    if (differs(prev?.vacantSuites, b.vacantSuites)) changed.push(`vacant suites ${Array.isArray(prev?.vacantSuites) ? (prev!.vacantSuites as unknown[]).length : 0} → ${Array.isArray(b.vacantSuites) ? (b.vacantSuites as unknown[]).length : 0}`);
    if (b.vacantSuites) next.vacantSuites = b.vacantSuites; else delete next.vacantSuites;
    stamp("vacantSuites");
  }
  for (const k of ["arAging", "financials"] as const) {
    if (!sent.includes(k)) continue;
    if (differs(prev?.[k], b[k])) changed.push(k === "arAging" ? "A/R aging" : `financials${(b.financials as Record<string, unknown> | undefined)?.period ? ` to ${(b.financials as Record<string, unknown>).period}` : ""}`);
    if (b[k]) next[k] = b[k]; else { delete next[k]; warnings.push(`${k} block carried no usable figures — cleared`); }
    stamp(k);
  }
  if (sent.includes("leasing")) {
    const r = mergeLeasing(Array.isArray(prev?.leasing) ? (prev!.leasing as Array<Record<string, unknown>>) : [], Array.isArray(b.leasing) ? (b.leasing as Array<Record<string, unknown>>) : []);
    if (r.added || r.updated) changed.push(`leasing pipeline +${r.added} new, ${r.updated} updated`);
    if (r.rows.length) next.leasing = r.rows;
    stamp("leasing");
  }
  for (const k of ["assetManager", "notes"] as const) {
    if (!sent.includes(k)) continue;
    const v = String(p[k] ?? "").trim();
    if (differs(prev?.[k], v || undefined)) changed.push(k === "assetManager" ? `asset manager → ${v || "(none)"}` : "notes");
    if (v) next[k] = v; else delete next[k];
    stamp(k);
  }

  // Sales: append to the stored history, then recompute each tenant's trailing 12 months.
  let salesRows = storedSales;
  if (sent.includes("sales")) {
    const r = mergeSalesRows(storedSales, p.salesHistory as unknown[]);
    salesRows = r.rows;
    if (r.added || r.updated) changed.push(`sales +${r.added} months${r.updated ? `, ${r.updated} revised` : ""}`);
    if (r.dropped) warnings.push(`${r.dropped} sales row(s) dropped (no tenant, bad period, the 190001 never-reported sentinel, or a negative amount)`);
    stamp("sales");
  }
  const tenants = Array.isArray(next.tenants) ? (next.tenants as Array<Record<string, unknown>>) : null;
  if (tenants && (sent.includes("sales") || sent.includes("tenants"))) {
    if (salesRows.length) {
      const asOfPeriod = String(next.asOf).slice(0, 4) + String(next.asOf).slice(5, 7);
      const sums = reduceSalesHistory(salesRows, asOfPeriod);
      next.tenants = tenants.map(t => {
        const { sales12: _s, salesNeverReported: _n, ...rest } = t;
        const s = sums.get(String(t.tenantId ?? ""));
        return s ? { ...rest, sales12: s } : t.lastSalesPeriod === "190001" ? { ...rest, salesNeverReported: true } : rest;
      });
      next.salesHistoryCovered = true;
    } else if (sent.includes("tenants") && prevTenants.some(t => t.sales12)) {
      // No stored monthly history yet (the deal came in by file import, which kept only the
      // summaries) — carry each tenant's previous trailing-12 summary over by tenant id
      // rather than silently losing it, until the job sends SalesHistory.
      const old = new Map(prevTenants.map(t => [String(t.tenantId ?? ""), t]));
      let carried = 0;
      next.tenants = tenants.map(t => { const o = old.get(String(t.tenantId ?? "")); if (o?.sales12 && !t.sales12) { carried++; return { ...t, sales12: o.sales12 }; } return t; });
      if (carried) warnings.push(`${carried} tenant sales summaries carried over from the previous snapshot — send SalesHistory to refresh them`);
    }
  }
  if ((sent.includes("tenants") || sent.includes("vacantSuites") || sent.includes("occupancy")) && Array.isArray(next.tenants)) {
    const live = (next.tenants as Array<Record<string, unknown>>).filter(t => !/^vacant\b/i.test(String(t.name)) && !t.futureLease);
    next.glaTieOut = glaTieOut(live, Array.isArray(next.vacantSuites) ? (next.vacantSuites as Array<{ sf?: unknown }>) : [], num(next.totalGLA));
  }
  next.blockAsOf = blockAsOf;
  return { block: next, salesRows, sent, changed, warnings };
}

/** What GET /datex/state returns per deal — enough for the job to fetch only what changed. */
export function dealState(dealId: string, propertyName: string, bldgIds: string[], block: Record<string, unknown> | null, salesRows: SalesRow[]): Record<string, unknown> {
  if (!block) return { dealId, propertyName, bldgIds, hasSnapshot: false };
  const tenants = Array.isArray(block.tenants) ? (block.tenants as Array<Record<string, unknown>>) : [];
  const byTenant: Record<string, string> = {};
  for (const r of salesRows) if (!byTenant[r.tenantId] || r.period > byTenant[r.tenantId]) byTenant[r.tenantId] = r.period;
  // A deal imported by file has no monthly rows stored — fall back to each tenant's summary.
  if (!salesRows.length) for (const t of tenants) { const s = t.sales12 as { to?: string } | undefined; if (s?.to && t.tenantId) byTenant[String(t.tenantId)] = s.to; }
  const salesMax = Object.values(byTenant).reduce((a, p) => (p > a ? p : a), "") || null;
  const leasing = Array.isArray(block.leasing) ? (block.leasing as Array<Record<string, unknown>>) : [];
  const latestSubmitted = leasing.reduce((a, r) => { const s = String(r.submitted ?? ""); return s > a ? s : a; }, "") || null;
  const fin = block.financials as Record<string, unknown> | undefined;
  const blockAsOf = (block.blockAsOf as Record<string, string> | undefined) ?? null;
  return {
    dealId, propertyName, bldgIds, hasSnapshot: true,
    asOf: block.asOf ?? null, blockAsOf,
    occupancy: { period: block.period ?? null, totalGLA: block.totalGLA ?? null, occupiedGLA: block.occupiedGLA ?? null, totalUnits: block.totalUnits ?? null, occupiedUnits: block.occupiedUnits ?? null },
    tenants: { count: tenants.length, hash: rosterHash(tenants), ids: tenants.map(t => String(t.tenantId ?? "").trim()).filter(Boolean) },
    sales: { maxPeriod: salesMax, storedMonthlyRows: salesRows.length, byTenant },
    leasing: { count: leasing.length, latestSubmitted },
    financials: fin ? { period: fin.period ?? null, basis: fin.basis ?? null } : null,
    arAging: block.arAging ? { asOf: blockAsOf?.arAging ?? block.asOf ?? null } : null,
  };
}
