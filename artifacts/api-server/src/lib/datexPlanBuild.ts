// SERVER-SIDE PLAN + BUILD for the scheduled Datex auto-refresh (11/12/26).
// The monthly run was stopped by Claude's safety check ("code from external"): the task
// downloaded job_kit.py from this site and RAN it. So the kit's plan/build logic now runs
// HERE, behind POST /api/datex/plan and POST /api/datex/build, and the scheduled task only
// makes plain HTTPS JSON calls — it never downloads or executes a script.
//
// This is a line-for-line port of tools/datex-job-kit/job_kit.py (plan() + build()). The
// Python kit stays (GET /api/datex/job-kit keeps working); datexPlanBuild.test.ts runs BOTH
// on the same fixtures and fails if they ever disagree — change both or neither.
// PURE: no DB, no I/O. `state` is exactly what GET /api/datex/state returns.
import { createHash } from "node:crypto";

export const PLAN_BUILD_VERSION = "2026-11-12.1";

type Row = Record<string, unknown>;
export interface DatexCall {
  entity?: string; tool?: string; function?: string; field?: string;
  filters?: Array<{ field?: string; operator?: string; value?: unknown }>; filterLogic?: string;
  rows?: Row[];
}
export interface KitState { deals?: Array<Record<string, unknown>> }
export type PlanMode = "weekly" | "monthly" | "all";
export type SalesMode = "auto" | "none" | "newest" | "all";

const BLDG_FIELD: Record<string, string> = {
  Occupancy: "BuildingId", TenantsMetrics: "BuildingId", Tenants: "BuildingId",
  SalesHistory: "BuildingId", TenantLedger: "BuildingId", FinancialGroups: "EntityID",
  LeaseAppDealHistoryBySuite: "BldgId", VacantSuites: "BLDGID", Spaces: "BLDGID",
  GeneralLedgerSummaries: "EntityId",
};
const BASIS: Record<string, string> = { C: "Cash", A: "Accrual" };

// ── small helpers (same semantics as the kit's) ──────────────────────────────────
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
/** Datex character ids are fixed-width with trailing spaces; compare trimmed, lowercase. */
export const nid = (v: unknown): string => str(v).trim().toLowerCase();
const trimId = (v: unknown): string => str(v).trim();
const s = (v: unknown): string | null => { const t = str(v).trim(); return t || null; };

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  let n: number;
  if (typeof v === "string") {
    const t = v.replace(/,/g, "").replace(/\$/g, "").trim();
    if (!t || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) && !/^[+-]?(inf|infinity|nan)$/i.test(t)) return null;
    n = Number(t);
  } else if (typeof v === "number") n = v;
  else if (typeof v === "boolean") n = v ? 1 : 0;
  else return null;
  return Number.isFinite(n) ? n : null;
}

/** '2034-12-31T00:00:00Z' -> '2034-12-31'. Datex's 1900 sentinel dates mean 'none'. */
export function isoDay(v: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(v));
  if (!m || Number(m[1]) < 1950) return null;
  return m[0];
}

export function yyyymm(v: unknown): string | null {
  const t = str(v).trim();
  if (/^\d{6}$/.test(t)) return t;
  const m = /^(\d{4})-(\d{2})/.exec(t);
  return m ? m[1] + m[2] : null;
}

export function addMonths(p: string, k: number): string {
  let y = Number(p.slice(0, 4)), m = Number(p.slice(4)) + k;
  while (m < 1) { y -= 1; m += 12; }
  while (m > 12) { y += 1; m -= 12; }
  return `${String(y).padStart(4, "0")}${String(m).padStart(2, "0")}`;
}

/** Python's round(x, 2): half-to-even on an exact tie, else nearest. */
function round2(x: number): number {
  const y = x * 100, f = Math.floor(y), d = y - f;
  const r = d === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(y);
  return r / 100;
}

const dayMs = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isoMinusDays = (iso: string, days: number): string => new Date(dayMs(iso) - days * 86_400_000).toISOString().slice(0, 10);
const minStr = (a: string, b: string): string => (a <= b ? a : b);

/** Stable JSON (sorted keys) — the dedupe key for identical rows. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as Row).sort().map(k => `${JSON.stringify(k)}:${canon((v as Row)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** Must equal rosterHash() in lib/datexIngest.ts and roster_hash() in job_kit.py. */
function jsNum(n: number): string { return String(Math.floor(n * 100 + 0.5) / 100); }
export function kitRosterHash(tenants: Row[]): string {
  const f = (v: unknown) => { const x = num(v); return x === null ? "" : jsNum(x); };
  const lines = tenants.map(t => [trimId(t.tenantId), f(t.sf), f(t.annualRent), str(t.leaseExpiry).slice(0, 10)].join("|")).sort();
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex").slice(0, 16);
}

/** Normalise whatever the task posted into the call list the kit reads. */
export function normalizeCalls(raw: unknown): DatexCall[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.filter(c => c && typeof c === "object").map(c => {
    const o = c as DatexCall;
    return { ...o, filters: Array.isArray(o.filters) ? o.filters : [], rows: Array.isArray(o.rows) ? o.rows : [], tool: o.tool || "read" };
  });
}

/** NDJSON text (one call per line, the kit's calls.jsonl) → calls. Throws on a bad line. */
export function parseCallsNdjson(text: string): DatexCall[] {
  const out: unknown[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try { out.push(JSON.parse(t)); } catch { throw new Error(`calls line ${i + 1} is not valid JSON`); }
  });
  return normalizeCalls(out);
}

// ── call bookkeeping ───────────────────────────────────────────────────────────
/** The buildings a call was filtered to, or null when it covered every building. */
function callBuildings(call: DatexCall): Set<string> | null {
  const fld = BLDG_FIELD[str(call.entity)];
  const ids = new Set<string>();
  for (const f of call.filters ?? []) {
    if (f && f.field === fld && ["eq", "contains", "startswith"].includes(str(f.operator).toLowerCase())) ids.add(nid(f.value));
  }
  return ids.size ? ids : null;
}

/** True when every one of these buildings was covered by at least one call on the entity. */
function covered(calls: DatexCall[], entity: string, bldgs: string[]): boolean {
  const cs = calls.filter(c => c.entity === entity);
  if (!cs.length) return false;
  return bldgs.every(b => cs.some(c => { const cb = callBuildings(c); return cb === null || cb.has(b); }));
}

function rowsFor(calls: DatexCall[], entity: string, bldgs: Iterable<string>, tool?: string): Row[] {
  const fld = BLDG_FIELD[entity], want = new Set(bldgs), seen = new Set<string>(), out: Row[] = [];
  for (const c of calls) {
    if (c.entity !== entity || (tool && c.tool !== tool)) continue;
    for (const r of c.rows ?? []) {
      if (fld && !want.has(nid(r?.[fld]))) continue;
      const k = canon(r);
      if (!seen.has(k)) { seen.add(k); out.push(r); }
    }
  }
  return out;
}

export function latestPeriod(calls: DatexCall[]): string | null {
  let best: string | null = null;
  for (const c of calls) if (c.entity === "Occupancy") for (const r of c.rows ?? []) {
    const p = yyyymm(r?.Period);
    if (p && (best === null || p > best)) best = p;
  }
  return best;
}

/** The last COMPLETED month (the current month's financials are partial). */
export const closedPeriod = (asOf: string): string => addMonths(asOf.slice(0, 4) + asOf.slice(5, 7), -1);

// ── build: raw Datex rows -> v2 payload, delta form ─────────────────────────────
const OCC_SUMS: Array<[string, string]> = [["totalGLA", "TotalGLA"], ["occupiedGLA", "TotalGLAOccupied"], ["vacantGLA", "TotalGLAVacant"],
  ["totalUnits", "TotalUnits"], ["occupiedUnits", "TotalOccupiedUnits"], ["vacantUnits", "TotalVacantUnits"]];
const SEGMENTS: Array<[string, string]> = [["shop", "Shop"], ["major", "Major"], ["subMajor", "SubMajor"], ["pad", "Pad"], ["groundLease", "GroundLease"]];
const sameSet = (a: Set<string>, b: string[]) => { const bs = new Set(b); return a.size === bs.size && [...a].every(x => bs.has(x)); };

function buildOccupancy(calls: DatexCall[], bl: string[], period: string): [Row | null, string | null] {
  const rows = rowsFor(calls, "Occupancy", bl).filter(r => yyyymm(r.Period) === period);
  if (!rows.length || !sameSet(new Set(rows.map(r => nid(r.BuildingId))), bl)) return [null, null];
  const out: Row = { period };
  for (const [k, f] of OCC_SUMS) {
    const vals = rows.map(r => num(r[f]));
    if (vals.every(v => v !== null)) out[k] = vals.reduce((a, v) => a + (v as number), 0);
  }
  const seg: Row = {};
  for (const [key, pre] of SEGMENTS) {
    const g = rows.map(r => num(r[`${pre}GLA`]));
    if (g.some(v => v !== null)) {
      const d: Row = { gla: g.reduce((a: number, v) => a + (v ?? 0), 0) };
      const og = rows.map(r => num(r[`${pre}OccupiedGLA`]));
      if (og.some(v => v !== null)) d.occupiedGLA = og.reduce((a: number, v) => a + (v ?? 0), 0);
      seg[key] = d;
    }
  }
  if (Object.keys(seg).length) out.segments = seg;
  const am = rows.map(r => s(r.AssetManager)).find(Boolean) ?? null;
  return [out, am];
}

function buildTenants(calls: DatexCall[], bl: string[]): Row[] {
  let tm = rowsFor(calls, "TenantsMetrics", bl);
  if (!tm.length) return [];
  // One Period only: the latest present per building (an unpinned read counts tenants many times).
  const latest = new Map<string, string>();
  for (const r of tm) { const b = nid(r.BuildingId), p = yyyymm(r.Period) ?? "", cur = latest.get(b) ?? ""; latest.set(b, p > cur ? p : cur); }
  tm = tm.filter(r => (yyyymm(r.Period) ?? "") === latest.get(nid(r.BuildingId)));
  const haveTenants = covered(calls, "Tenants", bl);
  const idx = new Map<string, Row>();
  for (const r of rowsFor(calls, "Tenants", bl)) idx.set(`${nid(r.BuildingId)}\u0000${trimId(r.TenantId)}`, r);
  const best = new Map<string, { key: [string, string, string]; r: Row }>();
  for (const r of tm) {
    const b = nid(r.BuildingId), tid = trimId(r.TenantId), suite = trimId(r.SUITID);
    if (!tid) continue;
    const k = `${b}\u0000${tid}\u0000${suite}`;
    // Duplicate rows per tenant arrive at $0 rent — keep the one carrying the rent.
    const cur = best.get(k);
    if (!cur || (num(r.AnnualRent) ?? 0) > (num(cur.r.AnnualRent) ?? 0)) best.set(k, { key: [b, tid, suite], r });
  }
  const cmpTuple = (a: string[], b: string[]) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
  const out: Row[] = [];
  for (const { key: [b, tid, suite], r } of [...best.values()].sort((x, y) => cmpTuple(x.key, y.key))) {
    const t = idx.get(`${b}\u0000${tid}`);
    const occ = t ? (s(t.OCCPSTAT) ?? "").toUpperCase().slice(0, 1) : "";
    if (occ === "I") continue;                       // vacated
    if (!t && haveTenants) continue;                 // Tenants was read (OCCPSTAT ne I) and this id isn't in it: vacated
    if (!occ && tid.includes(".")) continue;         // no status: a dotted id is a superseded generation
    const row: Row = { tenantId: tid, name: s(t?.DBA) ?? s(r.Tenant) ?? s(t?.Tenant) ?? tid };
    if (suite) row.suite = suite;
    for (const [key, f] of [["sf", "SuiteSQFT"], ["annualRent", "AnnualRent"], ["annualRentPSF", "AnnualRentPSF"], ["annualNNN", "AnnualNNN"],
      ["annualNNNPSF", "AnnualNNNPSF"], ["annualOther", "AnnualOther"], ["delinquency", "Delinquency"]] as const) {
      const v = num(r[f]);
      if (v !== null) row[key] = v;
    }
    const lsp = yyyymm(r.LastSalesPeriod);
    if (lsp) row.lastSalesPeriod = lsp;
    if (t) {
      if (s(t.NationalTenant)) row.nationalTenant = s(t.NationalTenant);
      if (isoDay(t.BEGINDATE)) row.leaseStart = isoDay(t.BEGINDATE);
      if (isoDay(t.EXPIR)) row.leaseExpiry = isoDay(t.EXPIR);
      const ct = (s(t.COTENANT) ?? "").toUpperCase();
      if (ct && !["N", "NO", "0", "FALSE"].includes(ct)) row.coTenancy = true;
      if (occ) row.occStatus = occ;
    }
    out.push(row);
  }
  return out;
}

function buildVacant(calls: DatexCall[], bl: string[]): Row[] {
  const sq = new Map<string, number | null>();
  for (const r of rowsFor(calls, "Spaces", bl)) sq.set(`${nid(r.BLDGID)}\u0000${trimId(r.SUITID)}`, num(r.SUITSQFT));
  const out: Row[] = [];
  for (const r of rowsFor(calls, "VacantSuites", bl)) {
    const suite = trimId(r.SUITID);
    if (!suite) continue;
    const v: Row = { suite };
    const sf = sq.get(`${nid(r.BLDGID)}\u0000${suite}`);
    if (sf !== undefined && sf !== null) v.sf = sf;
    out.push(v);
  }
  return out;
}

function buildSales(calls: DatexCall[], bl: string[]): Row[] {
  const out: Row[] = [];
  for (const r of rowsFor(calls, "SalesHistory", bl)) {
    const st = (s(r.SalesType) ?? "GROSS").toUpperCase();
    const amt = num(r.SalesAmount), per = yyyymm(r.SalesPeriod), tid = s(r.TenantId);
    if (st !== "GROSS" || !tid || !per || per === "190001" || amt === null || amt <= 1) continue;
    out.push({ tenantId: tid, period: per, amount: amt, reportingType: (s(r.ReportingType) ?? "RPT").toUpperCase() });
  }
  return out;
}

/** The latest month the SalesHistory calls fully covered: an `eq` month, or a year read via
 *  contains/startsWith (capped at the last closed month). */
function salesCheckedThrough(calls: DatexCall[], asOf: string): string | null {
  let best: string | null = null;
  const cap = closedPeriod(asOf);
  for (const c of calls) {
    if (c.entity !== "SalesHistory") continue;
    for (const f of c.filters ?? []) {
      if (f.field !== "SalesPeriod") continue;
      const v = str(f.value).trim(), op = str(f.operator).toLowerCase();
      const p = op === "eq" && /^\d{6}$/.test(v) ? v : (op === "contains" || op === "startswith") && /^\d{4}$/.test(v) ? minStr(v + "12", cap) : null;
      if (p && p <= cap && (best === null || p > best)) best = p;
    }
  }
  return best;
}

function ageDays(asOf: string, v: unknown): number | null {
  const d = isoDay(v);
  return d ? Math.round((dayMs(asOf) - dayMs(d)) / 86_400_000) : null;
}

function buildAr(calls: DatexCall[], bl: Set<string>, asOf: string, currentIds: Record<string, string> | null): Row {
  type E = { tenantId: string; name: string; total: number; over60: number; over90: number };
  const per = new Map<string, E>();
  const bucket = (tid: string, name: string | null, key: "total" | "over60" | "over90", amt: number) => {
    let e = per.get(tid);
    if (!e) { e = { tenantId: tid, name: name || tid, total: 0, over60: 0, over90: 0 }; per.set(tid, e); }
    if (name && e.name === tid) e.name = name;
    e[key] += amt;
  };
  for (const c of calls) {
    if (c.entity !== "TenantLedger") continue;
    const rows = (c.rows ?? []).filter(r => bl.has(nid(r?.BuildingId)));
    if (c.tool === "aggregate") {
      const f = (c.filters ?? []).find(x => x.field === "TransactionDate" && ["le", "lt"].includes(str(x.operator).toLowerCase()));
      const age = f && f.value !== undefined && f.value !== null && f.value !== "" ? ageDays(asOf, f.value) : null;
      const key = age === null ? "total" : age >= 89 ? "over90" : age >= 59 ? "over60" : null;
      if (key === null) continue;
      for (const r of rows) { const amt = num(r.value); if (amt && amt > 0) bucket(trimId(r.TenantId), s(r.TenantFlags), key, amt); }
    } else {
      for (const r of rows) {
        const amt = num(r.TransactionOpenAmount);
        if (!amt || amt <= 0) continue;
        const tid = trimId(r.TenantId), nm = s(r.TenantFlags), age = ageDays(asOf, r.TransactionDate);
        bucket(tid, nm, "total", amt);
        if (age !== null && age >= 60) bucket(tid, nm, "over60", amt);
        if (age !== null && age >= 90) bucket(tid, nm, "over90", amt);
      }
    }
  }
  if (!per.size) return { totalOpen: 0, over60: 0, over90: 0, byTenant: [] };
  const es = [...per.values()];
  const by = es.map(e => {
    const row: Row = { tenantId: e.tenantId, name: e.name, over60: round2(e.over60), over90: round2(e.over90) };
    if (currentIds !== null) row.occpstat = currentIds[e.tenantId] ?? "I";
    return row;
  }).sort((a, b) => (b.over60 as number) - (a.over60 as number));
  const sum = (k: "total" | "over60" | "over90") => round2(es.reduce((t, e) => t + e[k], 0));
  return { totalOpen: sum("total"), over60: sum("over60"), over90: sum("over90"), byTenant: by.filter(r => (r.over60 as number) > 0).slice(0, 25) };
}

/** NOI for the deal's buildings. A building with NO NOI rows is not in Datex (left out
 *  quietly); one with NOI history but no row for this period → the deal waits. */
function buildFinancials(calls: DatexCall[], blIn: string[], period: string): [Row | null, string | null] {
  const rows = rowsFor(calls, "FinancialGroups", blIn).filter(r => (s(r.AccountGroupId) ?? "").toUpperCase() === "NOI");
  const present = new Set(rows.map(r => nid(r.EntityID)));
  const absent = blIn.filter(b => !present.has(b));
  const bl = blIn.filter(b => present.has(b));
  if (!bl.length) return [null, "financials: not in Datex"];
  const at = rows.filter(r => yyyymm(r.Period) === period);
  if (!sameSet(new Set(at.map(r => nid(r.EntityID))), bl)) return [null, `financials: ${period} not posted yet for every building`];
  const out: Row = { period };
  for (const [key, f] of [["noiYtdActual", "YtdActual"], ["noiYtdBudget", "YtdBudget"], ["noiYearBudget", "CurrentYearBudget"]] as const) {
    const vals = at.map(r => num(r[f]));
    if (vals.every(v => v !== null)) out[key] = vals.reduce((a, v) => a + (v as number), 0);
  }
  let ttm: number | null = 0;
  for (const b of bl) {
    const mine = new Map<string | null, number | null>();
    for (const r of rows) if (nid(r.EntityID) === b) mine.set(yyyymm(r.Period), num(r.Actual));
    const want = Array.from({ length: 12 }, (_, i) => addMonths(period, -i));
    if (want.every(p => mine.get(p) !== undefined && mine.get(p) !== null)) ttm += want.reduce((t, p) => t + (mine.get(p) as number), 0);
    else {
      const hit = at.find(r => nid(r.EntityID) === b);
      const v = hit ? num(hit.TwelveMoActual) : null;
      if (v === null) { ttm = null; break; }
      ttm += v;
    }
  }
  if (ttm !== null) out.noiTtmActual = ttm;
  const bases = new Set<string>();
  for (const r of at) { const b = s(r.Basis); if (b) bases.add(BASIS[b.toUpperCase().slice(0, 1)] ?? b); }
  if (bases.size) out.basis = bases.size === 1 ? [...bases][0] : "Mixed";
  return [out, absent.length ? `financials: ${absent.join(", ")} not in Datex (left out)` : null];
}

const GL_INTEREST = "81100000", GL_SWAP = "81101000";
const fltEq = (call: DatexCall, field: string): string | null => {
  const f = (call.filters ?? []).find(x => x.field === field && str(x.operator).toLowerCase() === "eq");
  return f ? str(f.value).trim().toUpperCase() : null;
};

/** Monthly interest (81100000) + swap credits (81101000), accrual book, period activity only;
 *  months after `through` dropped; a month seen twice is taken once (the later call). */
function buildInterest(calls: DatexCall[], bl: Set<string>, through: string): Row[] {
  const per = new Map<string, Row>();
  for (const c of calls) {
    if (c.entity !== "GeneralLedgerSummaries" || c.tool !== "aggregate") continue;
    if (fltEq(c, "Basis") !== "A" || fltEq(c, "BalanceForward") !== "N") continue;
    for (const r of c.rows ?? []) {
      const e = nid(r.EntityId), p = yyyymm(r.Period), acct = s(r.AccountNumber), v = num(r.value);
      if (!bl.has(e) || !p || p > through || (acct !== GL_INTEREST && acct !== GL_SWAP) || v === null) continue;
      const k = `${e}\u0000${p}`;
      let row = per.get(k);
      if (!row) { row = { entityId: e, period: p, mortgageInterest: null, swapCredits: null }; per.set(k, row); }
      row[acct === GL_INTEREST ? "mortgageInterest" : "swapCredits"] = round2(v);
    }
  }
  return [...per.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, r]) => r);
}

function buildLeasing(calls: DatexCall[], bl: string[]): Row[] {
  const out: Row[] = [];
  for (const r of rowsFor(calls, "LeaseAppDealHistoryBySuite", bl)) {
    const t = s(r.DBA) ?? s(r.LegalName);
    if (!t) continue;
    const o: Row = { tenant: t };
    if (s(r.SuiteId)) o.suite = s(r.SuiteId);
    for (const [key, f] of [["gla", "ProposedGLA"], ["rentPSF", "ProposedRentInitialPSFRent"], ["termMonths", "LeaseTermTotalMonths"]] as const) {
      const v = num(r[f]);
      if (v) o[key] = v;
    }
    if (s(r.DocumentStageDesc)) o.stage = s(r.DocumentStageDesc);
    for (const [key, f] of [["submitted", "DateSubmitted"], ["executed", "ExecutionDate"], ["rentCommencement", "AnticipatedRentCommencementDate"]] as const) {
      if (isoDay(r[f])) o[key] = isoDay(r[f]);
    }
    out.push(o);
  }
  return out;
}

export interface BuildReport { dealId: string; propertyName: unknown; blocks: string[]; notes: string[] }

/** The delta payload + a per-deal report of what was included and why. */
export function buildPayload(state: KitState, calls: DatexCall[], asOf: string, finPeriodIn?: string | null, force = false):
  { payload: { source: "datex"; asOf: string; generatedBy: string; deals: Row[] }; report: BuildReport[] } {
  const period = latestPeriod(calls);
  const finPeriod = finPeriodIn || closedPeriod(asOf);
  const deals: Row[] = [], report: BuildReport[] = [];
  for (const d of state.deals ?? []) {
    const bl = (Array.isArray(d.bldgIds) ? d.bldgIds : []).map(nid);
    if (!bl.length) continue;
    const p: Row = { dealId: d.dealId, bldgIds: d.bldgIds };
    const notes: string[] = [];
    if (period && covered(calls, "Occupancy", bl)) {
      const [occ, am] = buildOccupancy(calls, bl, period);
      if (occ) { Object.assign(p, occ); if (am) p.assetManager = am; }
      else notes.push(`occupancy skipped: not every building has a ${period} row`);
    }
    if (covered(calls, "TenantsMetrics", bl)) {
      const tenants = buildTenants(calls, bl);
      if (tenants.length) {
        p.tenants = tenants;
        if (kitRosterHash(tenants) === ((d.tenants as Row | undefined)?.hash ?? null)) notes.push("rent roll unchanged (hash matches)");
      } else notes.push("TenantsMetrics returned no rows — rent roll not sent");
    }
    if (covered(calls, "VacantSuites", bl)) p.vacantSuites = buildVacant(calls, bl);
    if (covered(calls, "SalesHistory", bl)) {
      p.salesHistory = buildSales(calls, bl);
      const ct = salesCheckedThrough(calls, asOf);
      if (ct) p.salesCheckedThrough = ct;              // an empty result still counts as checked
    }
    if (covered(calls, "TenantLedger", bl)) {
      // Former vs current: the fresh Tenants read when there is one, else the site's roster.
      let cur: Record<string, string> | null = null;
      if (covered(calls, "Tenants", bl)) {
        const all: Record<string, string> = {};
        for (const r of rowsFor(calls, "Tenants", bl)) all[trimId(r.TenantId)] = (s(r.OCCPSTAT) ?? "C").toUpperCase().slice(0, 1);
        cur = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== "I"));
      } else {
        const ids = (d.tenants as Row | undefined)?.ids;
        if (Array.isArray(ids) && ids.length) cur = Object.fromEntries(ids.map(t => [String(t), "C"]));
      }
      p.arAging = buildAr(calls, new Set(bl), asOf, cur);
    }
    if (covered(calls, "FinancialGroups", bl)) {
      if (!force && (d.financials as Row | null | undefined)?.period === finPeriod) notes.push(`financials already at ${finPeriod} — not resent`);
      else {
        const [fin, why] = buildFinancials(calls, bl, finPeriod);
        if (fin) p.financials = fin;
        if (why) notes.push(why);
      }
    }
    if (covered(calls, "GeneralLedgerSummaries", bl)) {
      const gl = buildInterest(calls, new Set(bl), finPeriod);
      p.interestGl = gl;                                // an empty list still counts as checked
      p.interestCheckedThrough = finPeriod;
      if (!gl.length) notes.push("interest ledger: no 1st-mortgage-interest rows for these entities");
    }
    if (covered(calls, "LeaseAppDealHistoryBySuite", bl)) {
      const lease = buildLeasing(calls, bl);
      if (lease.length) p.leasing = lease;
    }
    const blocks = Object.keys(p).filter(k => k !== "dealId" && k !== "bldgIds");
    if (blocks.length) deals.push(p);
    report.push({ dealId: String(d.dealId), propertyName: d.propertyName ?? null, blocks, notes });
  }
  return { payload: { source: "datex", asOf, generatedBy: `site plan/build ${PLAN_BUILD_VERSION}`, deals }, report };
}

// ── plan: the minimum Datex calls, given what the site already has ──────────────
const TM_FIELDS = ["BuildingId", "TenantId", "Tenant", "SUITID", "Period", "SuiteSQFT", "AnnualRent", "AnnualRentPSF", "AnnualNNN", "AnnualNNNPSF", "AnnualOther", "Delinquency", "LastSalesPeriod"];
const TEN_FIELDS = ["BuildingId", "TenantId", "Tenant", "DBA", "NationalTenant", "OCCPSTAT", "BEGINDATE", "EXPIR", "COTENANT"];
const OCC_FIELDS = ["BuildingId", "Period", "TotalGLA", "TotalGLAOccupied", "TotalGLAVacant", "TotalUnits", "TotalOccupiedUnits", "TotalVacantUnits", "AssetManager",
  "ShopGLA", "ShopOccupiedGLA", "MajorGLA", "MajorOccupiedGLA", "SubMajorGLA", "SubMajorOccupiedGLA", "PadGLA", "PadOccupiedGLA", "GroundLeaseGLA", "GroundLeaseOccupiedGLA"];
const F = (field: string, operator: string, value: unknown) => ({ field, operator, value });

export interface PlannedCall { tool: "read_records" | "aggregate_records"; why: string; args: Row }
export interface Plan { phase: 1 | 2; period?: string; calls: PlannedCall[]; notes: string[] }

/** Phase 1 (no Occupancy yet): the one Occupancy call. Phase 2: everything else, sized to what
 *  changed. Each entry's `args` is ready to pass to the Datex MCP tool as-is. */
export function planCalls(state: KitState, calls: DatexCall[], asOf: string, mode: PlanMode = "weekly", salesMode: SalesMode = "auto"): Plan {
  const out: PlannedCall[] = [];
  const add = (tool: PlannedCall["tool"], why: string, args: Row) => out.push({ tool, why, args });
  const period = latestPeriod(calls);
  if (!period) {
    add("read_records", "Occupancy for every building at the latest period (one call; the newest period sorts first)",
      { entity: "Occupancy", select: OCC_FIELDS, orderBy: [{ field: "Period", direction: "desc" }, { field: "BuildingId", direction: "asc" }], first: 100 });
    return { phase: 1, calls: out, notes: ["Make this call, add its rows to calls, then ask for the plan again."] };
  }
  const deals = (state.deals ?? []).filter(d => Array.isArray(d.bldgIds) && d.bldgIds.length);
  const notes: string[] = [];
  const roster = deals.filter(d => {
    const bl = (d.bldgIds as unknown[]).map(nid);
    const [occ] = buildOccupancy(calls, bl, period);
    const st = (d.occupancy as Row | null | undefined) ?? {};
    const moved = occ === null || ["totalGLA", "occupiedGLA", "occupiedUnits"].some(k => num(occ[k]) !== num(st[k]));
    return mode === "monthly" || mode === "all" || !d.hasSnapshot || !(d.tenants as Row | undefined)?.count || moved;
  });
  notes.push(`latest period ${period}; rent roll re-pull for ${roster.length} of ${deals.length} properties (${mode === "monthly" || mode === "all" ? `all, ${mode}` : "occupancy moved or no stored roll"})`);
  for (const d of roster) {
    const label = String(d.propertyName || d.dealId);
    for (const b of d.bldgIds as unknown[]) {
      const bid = nid(b);
      add("read_records", `${label}: rent roll at ${period}`, { entity: "TenantsMetrics", filters: [F("BuildingId", "contains", bid), F("Period", "eq", period)], select: TM_FIELDS, first: 100 });
      add("read_records", `${label}: OCCPSTAT, dates, co-tenancy`, { entity: "Tenants", filters: [F("BuildingId", "contains", bid), F("OCCPSTAT", "ne", "I")], select: TEN_FIELDS, first: 100 });
      add("read_records", `${label}: vacant suites`, { entity: "VacantSuites", filters: [F("BLDGID", "contains", bid)], first: 100 });
      add("read_records", `${label}: suite square feet (for vacant suites)`, { entity: "Spaces", filters: [F("BLDGID", "contains", bid)], select: ["BLDGID", "SUITID", "SUITSQFT"], first: 100 });
    }
  }

  // Sales — PORTFOLIO-WIDE, never per building; NO orderBy (sorted paging fails on page 2).
  const fp = closedPeriod(asOf);
  const unchecked = deals.filter(d => !(d.sales as Row | undefined)?.storedMonthlyRows && !(d.sales as Row | undefined)?.checkedThrough);
  let sales: SalesMode = salesMode;
  if (sales === "auto") sales = unchecked.length ? "all" : (mode === "monthly" || mode === "all" ? "newest" : "none");
  if (mode === "all") sales = "all";
  const gross = F("SalesType", "contains", "GROSS");
  const sel = ["BuildingId", "TenantId", "SalesType", "ReportingType", "SalesPeriod", "SalesAmount"];
  if (sales === "newest") {
    add("read_records", `sales for ${fp} (newest closed month), every building — page with after; do NOT add orderBy`, { entity: "SalesHistory", filters: [gross, F("SalesPeriod", "eq", fp)], select: sel, first: 100 });
  } else if (sales === "all") {
    const startP = addMonths(fp, -23);
    const why = unchecked.length ? `${unchecked.length} propert${unchecked.length === 1 ? "y has" : "ies have"} no sales checked yet` : "full 24-month sales refresh";
    for (let y = Number(startP.slice(0, 4)); y <= Number(fp.slice(0, 4)); y++) {
      add("read_records", `sales ${y}, every building (${why}) — page with after; do NOT add orderBy`, { entity: "SalesHistory", filters: [gross, F("SalesPeriod", "contains", String(y))], select: sel, first: 100 });
    }
  }
  notes.push(`sales: ${sales}` + (unchecked.length ? ` (${unchecked.length} propert${unchecked.length === 1 ? "y" : "ies"} never checked)` : ""));

  // A/R: three portfolio-wide aggregates (total / over 60 / over 90 days).
  const d60 = isoMinusDays(asOf, 60), d90 = isoMinusDays(asOf, 90);
  for (const [label, extra] of [["total open", []], ["over 60 days", [F("TransactionDate", "le", d60)]], ["over 90 days", [F("TransactionDate", "le", d90)]]] as const) {
    add("aggregate_records", `A/R ${label}, every building`, { entity: "TenantLedger", function: "sum", field: "TransactionOpenAmount",
      groupBy: ["BuildingId", "TenantId", "TenantFlags"], filters: [F("TransactionOpenAmount", "gt", 0), ...extra], first: 100 });
  }

  if (mode === "monthly" || mode === "all" || deals.some(d => ((d.financials as Row | null | undefined)?.period ?? null) !== fp)) {
    add("read_records", `NOI for ${fp} (last closed month), every building`, { entity: "FinancialGroups",
      filters: [F("Period", "eq", fp), F("AccountGroupId", "contains", "NOI")],
      select: ["EntityID", "Period", "Basis", "AccountGroupId", "Actual", "YtdActual", "YtdBudget", "CurrentYearBudget", "TwelveMoActual"], first: 100 });
  } else notes.push(`financials already at ${fp} everywhere — skipped`);

  // Interest ledger: one aggregate per year the first time, then the last 3 closed months.
  const glMax = deals.map(d => ((d.interest as Row | null | undefined)?.checkedThrough as string | null | undefined) ?? null);
  const gl = (why: string, pf: Row) => add("aggregate_records", why, { entity: "GeneralLedgerSummaries", function: "sum", field: "Activity",
    groupBy: ["EntityId", "Period", "AccountNumber"],
    filters: [F("Basis", "eq", "A"), F("BalanceForward", "eq", "N"), F("AccountNumber", "startsWith", "8110"), pf], first: 100 });
  if (mode === "all" || !glMax.every(Boolean)) {
    const startP = addMonths(fp, -23);
    for (let y = Number(startP.slice(0, 4)); y <= Number(fp.slice(0, 4)); y++) gl(`interest ledger ${y}, every entity (first pull) — page with after`, F("Period", "startsWith", String(y)));
  } else if (mode === "monthly" || glMax.some(x => (x as string) < fp)) {
    for (let k = 2; k >= 0; k--) gl(`interest ledger ${addMonths(fp, -k)}, every entity`, F("Period", "eq", addMonths(fp, -k)));
  } else notes.push(`interest ledger already at ${fp} everywhere — skipped`);

  const subs = deals.map(d => ((d.leasing as Row | null | undefined)?.latestSubmitted as string | null | undefined) ?? null);
  const yearAgo = isoMinusDays(asOf, 365);
  const present = subs.filter((x): x is string => !!x);
  const since = subs.every(Boolean) ? (present.length ? present.reduce(minStr) : yearAgo) : yearAgo;
  add("read_records", `leasing applications submitted since ${since}, every building`, { entity: "LeaseAppDealHistoryBySuite",
    filters: [F("DateSubmitted", "ge", since)], orderBy: [{ field: "DateSubmitted", direction: "desc" }],
    select: ["BldgId", "DBA", "LegalName", "SuiteId", "ProposedGLA", "ProposedRentInitialPSFRent", "DocumentStageDesc", "DateSubmitted", "ExecutionDate", "AnticipatedRentCommencementDate", "LeaseTermTotalMonths"], first: 100 });
  notes.push("Any call that returns hasMore:true — call it again with after=<nextCursor> until hasMore is false.");
  return { phase: 2, period, calls: out, notes };
}
