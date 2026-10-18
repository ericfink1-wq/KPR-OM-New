import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import datexMapJson from "../data/datex-deal-map.json";
import type { DatexMap } from "./datexImport";

// ASSET MANAGEMENT (Eric, 10/18/26) — owned properties only.
//
// Two runtime tables, each in THREE places (this DDL, lib/db/src/schema/assetMgmt.ts, and
// lib/db/scripts/ensure-runtime-tables.mjs) or the publish diff proposes a DROP:
//   am_records          admin-entered loans, swaps and critical dates, plus the cheap daily
//                       credit-news signals. One row per record, `kind` says which; `data`
//                       is the sanitised record; `source_note` is the per-row provenance
//                       Eric asked for ("loan summary in Drive", "Datex Loans #12", …).
//   datex_building_map  deal ↔ Datex BLDGID(s), admin-editable. Seeded once from the
//                       hand-maintained data/datex-deal-map.json. NEVER matched by name —
//                       Datex ids are city-based (voorhees = Eagle Plaza, brunswic = Cooks
//                       Corner, …) and two buildings share the name "Mattatuck Commons".

export type AmKind = "loan" | "swap" | "date" | "news";
export const AM_KINDS: readonly AmKind[] = ["loan", "swap", "date", "news"];

let ready: Promise<void> | null = null;
export function ensureAssetMgmtTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS am_records (
          id text PRIMARY KEY,
          kind text NOT NULL,
          deal_id text,
          data jsonb NOT NULL DEFAULT '{}'::jsonb,
          source_note text,
          updated_by text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS datex_building_map (
          deal_id text PRIMARY KEY,
          property_name text,
          bldg_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
          note text,
          updated_by text,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await seedDatexMapIfEmpty();
    })().catch(err => { ready = null; throw err; });
  }
  return ready;
}

// ── Datex building map ───────────────────────────────────────────────────────
interface MapRow { deal_id: string; property_name: string | null; bldg_ids: string[]; note: string | null; updated_by: string | null; updated_at: string }

async function seedDatexMapIfEmpty(): Promise<void> {
  const r = await db.execute(sql`SELECT count(*)::int AS n FROM datex_building_map`);
  if (((r.rows[0] as { n: number })?.n ?? 0) > 0) return;
  const m = datexMapJson as unknown as DatexMap;
  for (const x of m.mappings) {
    await db.execute(sql`INSERT INTO datex_building_map (deal_id, property_name, bldg_ids, note, updated_by)
      VALUES (${x.dealId}, ${x.propertyName}, ${JSON.stringify(x.bldgIds)}::jsonb, ${x.note ?? null}, 'seed: datex-deal-map.json') ON CONFLICT (deal_id) DO NOTHING`);
  }
  for (const x of m.unmapped) {
    await db.execute(sql`INSERT INTO datex_building_map (deal_id, property_name, bldg_ids, note, updated_by)
      VALUES (${x.dealId}, ${x.propertyName}, '[]'::jsonb, ${x.reason ?? "Not set up in Datex yet"}, 'seed: datex-deal-map.json') ON CONFLICT (deal_id) DO NOTHING`);
  }
}

/** The live map, in the shape datexImport expects. A deal with no building ids is "unmapped"
 *  (not set up in Datex) and is skipped by design rather than rejected. */
export async function loadDatexMapFromDb(): Promise<DatexMap> {
  await ensureAssetMgmtTables();
  const r = await db.execute(sql`SELECT deal_id, property_name, bldg_ids, note FROM datex_building_map ORDER BY property_name`);
  const rows = r.rows as unknown as MapRow[];
  return {
    mappings: rows.filter(x => Array.isArray(x.bldg_ids) && x.bldg_ids.length).map(x => ({ dealId: x.deal_id, propertyName: x.property_name ?? "", bldgIds: x.bldg_ids, note: x.note ?? undefined })),
    unmapped: rows.filter(x => !Array.isArray(x.bldg_ids) || !x.bldg_ids.length).map(x => ({ dealId: x.deal_id, propertyName: x.property_name ?? "", reason: x.note ?? undefined })),
  };
}

export async function listDatexMap(): Promise<Array<{ dealId: string; propertyName: string | null; bldgIds: string[]; note: string | null; updatedBy: string | null; updatedAt: string }>> {
  await ensureAssetMgmtTables();
  const r = await db.execute(sql`SELECT deal_id, property_name, bldg_ids, note, updated_by, updated_at FROM datex_building_map ORDER BY property_name`);
  return (r.rows as unknown as MapRow[]).map(x => ({ dealId: x.deal_id, propertyName: x.property_name, bldgIds: x.bldg_ids ?? [], note: x.note, updatedBy: x.updated_by, updatedAt: new Date(x.updated_at).toISOString() }));
}

/** Datex BLDGIDs are short lowercase codes (rockcom, voorhees, …). Anything else is a typo. */
export function cleanBldgIds(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = [...new Set(v.map(x => String(x ?? "").trim().toLowerCase()).filter(Boolean))];
  return out.every(x => /^[a-z0-9_\-]{2,16}$/.test(x)) ? out : null;
}

export async function saveDatexMapRow(dealId: string, propertyName: string | null, bldgIds: string[], note: string | null, by: string): Promise<void> {
  await ensureAssetMgmtTables();
  await db.execute(sql`INSERT INTO datex_building_map (deal_id, property_name, bldg_ids, note, updated_by, updated_at)
    VALUES (${dealId}, ${propertyName}, ${JSON.stringify(bldgIds)}::jsonb, ${note}, ${by}, now())
    ON CONFLICT (deal_id) DO UPDATE SET property_name = COALESCE(EXCLUDED.property_name, datex_building_map.property_name),
      bldg_ids = EXCLUDED.bldg_ids, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()`);
}

// ── Records: sanitisers (every number is checked; null = unknown, never zero) ──
const num = (v: unknown, lo = -Infinity, hi = Infinity): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
};
const str = (v: unknown, max = 300): string | undefined => {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s.slice(0, max) : undefined;
};
/** ISO date from ISO, US m/d/yyyy or m/d/yy. Anything else → undefined (never guessed). */
export function isoDate(v: unknown): string | undefined {
  const s = str(v, 40); if (!s) return undefined;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  return undefined;
}
const bool = (v: unknown): boolean | undefined => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return ["y", "yes", "true", "1"].includes(s) ? true : ["n", "no", "false", "0"].includes(s) ? false : undefined;
};
const prune = <T extends Record<string, unknown>>(o: T): T => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};
/** A rate given as a fraction (0.0408) is a percent written the other way round. */
const pct = (v: unknown): number | undefined => { const n = num(v, 0, 100); return n == null ? undefined : n > 0 && n < 0.25 ? Math.round(n * 1e6) / 1e4 : n; };

export interface LoanRec {
  lender?: string; loanName?: string; originalBalance?: number; currentBalance?: number; balanceAsOf?: string;
  rateType?: "fixed" | "floating" | "swapped"; index?: string; spreadBps?: number; fixedRatePct?: number; allInRatePct?: number;
  originationDate?: string; maturityDate?: string; extensionOptions?: string; extensionNoticeDate?: string;
  amortization?: "IO" | "amortizing" | "partial IO"; amortYears?: number; ioUntil?: string;
  dscrCovenant?: number; debtYieldCovenantPct?: number; recourse?: string; guarantor?: string;
  datexLoanId?: number; notes?: string;
}
export interface SwapRec {
  loanId?: string; counterparty?: string; notional?: number; fixedSwapRatePct?: number; spreadBps?: number; allInFixedPct?: number;
  tradeDate?: string; effectiveDate?: string; maturityDate?: string; index?: string; payFixed?: boolean; notes?: string;
}
export interface DateRec { date?: string; type?: string; tenant?: string; description?: string; owner?: string; noticeDays?: number }

const RATE_TYPES = ["fixed", "floating", "swapped"] as const;
function rateType(v: unknown): LoanRec["rateType"] {
  const s = String(v ?? "").toLowerCase();
  return (RATE_TYPES as readonly string[]).find(t => s.includes(t)) as LoanRec["rateType"] ?? (s.includes("hedg") ? "swapped" : undefined);
}
/** Normalise the index name so the MTM engine can tell 1M Term from Daily Simple SOFR. */
export function normIndex(v: unknown): string | undefined {
  const s = str(v, 80); if (!s) return undefined;
  if (/term/i.test(s) && /sofr/i.test(s)) return "1M CME Term SOFR";
  if (/(daily|simple|compound|\bOIS\b)/i.test(s) && /sofr/i.test(s)) return "Daily Simple SOFR";
  return s;
}

export function sanitizeLoan(r: Record<string, unknown>): LoanRec {
  const spreadBps = num(r.spreadBps ?? r.spread_bps, 0, 2000) ?? (num(r.spreadPct ?? r.spread, 0, 20) != null ? Math.round(num(r.spreadPct ?? r.spread, 0, 20)! * 100) : undefined);
  const amort = String(r.amortization ?? "").toLowerCase();
  return prune({
    lender: str(r.lender), loanName: str(r.loanName ?? r.name), originalBalance: num(r.originalBalance ?? r.originalAmount, 0, 5e9),
    currentBalance: num(r.currentBalance ?? r.balance, 0, 5e9), balanceAsOf: isoDate(r.balanceAsOf),
    rateType: rateType(r.rateType), index: normIndex(r.index), spreadBps, fixedRatePct: pct(r.fixedRatePct ?? r.fixedRate),
    allInRatePct: pct(r.allInRatePct ?? r.allInRate), originationDate: isoDate(r.originationDate ?? r.startDate),
    maturityDate: isoDate(r.maturityDate ?? r.maturity), extensionOptions: str(r.extensionOptions), extensionNoticeDate: isoDate(r.extensionNoticeDate),
    amortization: amort.includes("partial") ? "partial IO" : amort.includes("io") || amort.includes("interest") ? "IO" : amort.includes("amort") ? "amortizing" : undefined,
    amortYears: num(r.amortYears, 1, 50), ioUntil: isoDate(r.ioUntil),
    dscrCovenant: num(r.dscrCovenant ?? r.dscr, 0.5, 5), debtYieldCovenantPct: pct(r.debtYieldCovenantPct ?? r.debtYieldCovenant),
    recourse: str(r.recourse), guarantor: str(r.guarantor), datexLoanId: num(r.datexLoanId, 0), notes: str(r.notes, 1000),
  } as LoanRec & Record<string, unknown>);
}
export function sanitizeSwap(r: Record<string, unknown>): SwapRec {
  const spreadBps = num(r.spreadBps, 0, 2000) ?? (num(r.spreadPct ?? r.spread, 0, 20) != null ? Math.round(num(r.spreadPct ?? r.spread, 0, 20)! * 100) : undefined);
  return prune({
    loanId: str(r.loanId, 120), counterparty: str(r.counterparty), notional: num(r.notional, 0, 5e9),
    fixedSwapRatePct: pct(r.fixedSwapRatePct ?? r.swapRate ?? r.fixedRate), spreadBps, allInFixedPct: pct(r.allInFixedPct ?? r.allIn),
    tradeDate: isoDate(r.tradeDate), effectiveDate: isoDate(r.effectiveDate), maturityDate: isoDate(r.maturityDate ?? r.terminationDate ?? r.maturity),
    index: normIndex(r.index ?? r.floatingIndex), payFixed: bool(r.payFixed), notes: str(r.notes, 1000),
  });
}
export function sanitizeDate(r: Record<string, unknown>): DateRec {
  return prune({ date: isoDate(r.date), type: str(r.type, 60), tenant: str(r.tenant, 120), description: str(r.description, 500), owner: str(r.owner, 80), noticeDays: num(r.noticeDays, 0, 3650) });
}
const SANITIZE: Record<Exclude<AmKind, "news">, (r: Record<string, unknown>) => Record<string, unknown>> = {
  loan: r => sanitizeLoan(r) as Record<string, unknown>,
  swap: r => sanitizeSwap(r) as Record<string, unknown>,
  date: r => sanitizeDate(r) as Record<string, unknown>,
};

/** A record must say WHAT it is about; one that doesn't is rejected, never stored blank. */
export function validateRecord(kind: Exclude<AmKind, "news">, d: Record<string, unknown>): string | null {
  if (kind === "loan" && d.originalBalance == null && d.currentBalance == null) return "a loan needs an original or current balance";
  if (kind === "loan" && !d.maturityDate) return "a loan needs a maturity date";
  if (kind === "swap" && (d.notional == null || d.fixedSwapRatePct == null || !d.maturityDate)) return "a swap needs notional, fixed swap rate and maturity";
  if (kind === "date" && (!d.date || !d.type)) return "a critical date needs a date and a type";
  return null;
}

/** Stable id so re-importing the same seed updates rows instead of duplicating them. */
export function recordId(kind: string, dealId: string, d: Record<string, unknown>): string {
  const key = kind === "loan" ? [d.lender, d.maturityDate, d.loanName]
    : kind === "swap" ? [d.counterparty, d.maturityDate, d.notional]
    : [d.date, d.type, d.tenant];
  return `${kind}:${createHash("sha1").update([dealId, ...key.map(x => String(x ?? "").toLowerCase())].join("|")).digest("hex").slice(0, 16)}`;
}

// ── Import (paste JSON or CSV) ───────────────────────────────────────────────
/** RFC-4180-ish CSV → objects keyed by the header row. */
export function parseCsvObjects(text: string): Array<Record<string, string>> {
  const rows: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else f += c;
  }
  if (f || row.length) { row.push(f); if (row.some(x => x.trim())) rows.push(row); }
  const head = (rows.shift() ?? []).map(h => h.trim());
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export interface ImportRow { kind: Exclude<AmKind, "news">; raw: Record<string, unknown> }
/** Accepts {loans:[],swaps:[],dates:[]}, a bare array with a `kind` on each row, or CSV with a `kind` column. */
export function readImportText(text: string): { rows: ImportRow[]; problem?: string } {
  const t = text.trim();
  if (!t) return { rows: [], problem: "nothing pasted" };
  const asKind = (k: unknown): ImportRow["kind"] | null => { const s = String(k ?? "").toLowerCase().replace(/s$/, ""); return s === "loan" || s === "swap" || s === "date" ? s : s === "criticaldate" ? "date" : null; };
  if (t.startsWith("{") || t.startsWith("[")) {
    let j: unknown;
    try { j = JSON.parse(t); } catch { return { rows: [], problem: "that isn't valid JSON" }; }
    const out: ImportRow[] = [];
    if (Array.isArray(j)) { for (const r of j) { const k = asKind((r as Record<string, unknown>)?.kind); if (k) out.push({ kind: k, raw: r as Record<string, unknown> }); } }
    else if (j && typeof j === "object") {
      for (const [key, kind] of [["loans", "loan"], ["swaps", "swap"], ["dates", "date"], ["criticalDates", "date"]] as const) {
        const arr = (j as Record<string, unknown>)[key];
        if (Array.isArray(arr)) for (const r of arr) if (r && typeof r === "object") out.push({ kind, raw: r as Record<string, unknown> });
      }
    }
    return out.length ? { rows: out } : { rows: [], problem: "no loans, swaps or dates found — use {\"loans\":[…],\"swaps\":[…],\"dates\":[…]}" };
  }
  const objs = parseCsvObjects(t);
  const rows = objs.map(o => ({ kind: asKind(o.kind), raw: o as Record<string, unknown> })).filter((r): r is ImportRow => !!r.kind);
  return rows.length ? { rows } : { rows: [], problem: "CSV needs a header row with a `kind` column (loan, swap or date)" };
}

export interface OwnedDealRef { id: string; name: string; bldgIds: string[] }
/** Resolve a row to an OWNED deal: by dealId, by Datex bldgId (through the map), or by an
 *  EXACT property name. Anything ambiguous or unknown is rejected with the reason. */
export function resolveDeal(raw: Record<string, unknown>, owned: OwnedDealRef[]): { dealId: string } | { problem: string } {
  const id = str(raw.dealId, 80);
  if (id) return owned.some(d => d.id === id) ? { dealId: id } : { problem: `dealId ${id} is not an owned deal` };
  const b = str(raw.bldgId ?? raw.BLDGID, 20)?.toLowerCase();
  if (b) { const hit = owned.filter(d => d.bldgIds.includes(b)); return hit.length === 1 ? { dealId: hit[0].id } : { problem: hit.length ? `bldgId ${b} maps to several deals` : `bldgId ${b} isn't in the Datex map` }; }
  const name = str(raw.property ?? raw.propertyName, 160)?.toLowerCase();
  if (name) { const hit = owned.filter(d => d.name.trim().toLowerCase() === name); return hit.length === 1 ? { dealId: hit[0].id } : { problem: hit.length ? `"${name}" matches several owned deals — use dealId` : `no owned deal is named exactly "${name}" — use dealId or bldgId` }; }
  return { problem: "row has no dealId, bldgId or property" };
}

export interface ImportPlanRow { kind: string; id: string; dealId: string; property: string; data: Record<string, unknown>; sourceNote: string | null; action: "create" | "update" }
export function planImport(text: string, owned: OwnedDealRef[], existingIds: Set<string>): { rows: ImportPlanRow[]; rejected: Array<{ row: number; problem: string }>; problem?: string } {
  const { rows, problem } = readImportText(text);
  if (problem) return { rows: [], rejected: [], problem };
  const out: ImportPlanRow[] = [], rejected: Array<{ row: number; problem: string }> = [];
  rows.forEach((r, i) => {
    const deal = resolveDeal(r.raw, owned);
    if ("problem" in deal) { rejected.push({ row: i + 1, problem: deal.problem }); return; }
    const data = SANITIZE[r.kind](r.raw);
    const bad = validateRecord(r.kind, data);
    if (bad) { rejected.push({ row: i + 1, problem: bad }); return; }
    const id = str(r.raw.id, 120) ?? recordId(r.kind, deal.dealId, data);
    out.push({ kind: r.kind, id, dealId: deal.dealId, property: owned.find(d => d.id === deal.dealId)!.name, data, sourceNote: str(r.raw.source ?? r.raw.sourceNote, 300) ?? null, action: existingIds.has(id) ? "update" : "create" });
  });
  return { rows: out, rejected };
}

// ── Storage ──────────────────────────────────────────────────────────────────
export interface AmRecord { id: string; kind: AmKind; dealId: string | null; data: Record<string, unknown>; sourceNote: string | null; updatedBy: string | null; updatedAt: string }
export async function listRecords(kinds: AmKind[] = ["loan", "swap", "date"]): Promise<AmRecord[]> {
  await ensureAssetMgmtTables();
  const r = await db.execute(sql`SELECT id, kind, deal_id, data, source_note, updated_by, updated_at FROM am_records WHERE kind IN (${sql.join(kinds.map(k => sql`${k}`), sql`, `)}) ORDER BY kind, deal_id, id`);
  return (r.rows as Array<Record<string, unknown>>).map(x => ({ id: String(x.id), kind: x.kind as AmKind, dealId: (x.deal_id as string) ?? null, data: (x.data as Record<string, unknown>) ?? {}, sourceNote: (x.source_note as string) ?? null, updatedBy: (x.updated_by as string) ?? null, updatedAt: new Date(String(x.updated_at)).toISOString() }));
}
export async function upsertRecord(id: string, kind: AmKind, dealId: string | null, data: Record<string, unknown>, sourceNote: string | null, by: string): Promise<void> {
  await ensureAssetMgmtTables();
  await db.execute(sql`INSERT INTO am_records (id, kind, deal_id, data, source_note, updated_by, updated_at)
    VALUES (${id}, ${kind}, ${dealId}, ${JSON.stringify(data)}::jsonb, ${sourceNote}, ${by}, now())
    ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, deal_id = EXCLUDED.deal_id, data = EXCLUDED.data,
      source_note = EXCLUDED.source_note, updated_by = EXCLUDED.updated_by, updated_at = now()`);
}
export async function deleteRecord(id: string): Promise<boolean> {
  await ensureAssetMgmtTables();
  const r = await db.execute(sql`DELETE FROM am_records WHERE id = ${id} RETURNING id`);
  return (r.rows as unknown[]).length > 0;
}
export function sanitizeFor(kind: Exclude<AmKind, "news">, raw: Record<string, unknown>): Record<string, unknown> { return SANITIZE[kind](raw); }

/** Datex Loans → loan records (source "datex"). An admin-entered loan for the same deal
 *  always wins in totals (see the client); these only fill the gap where nothing was entered. */
export function datexLoanToRecord(l: Record<string, unknown>): { id: string; data: LoanRec; note: string } | null {
  const loanId = num(l.loanId ?? l.LoanId, 0);
  if (loanId == null || bool(l.inactive ?? l.Inactive) === true) return null;
  const data = sanitizeLoan({ lender: l.lender ?? l.Lender, originalBalance: l.originalAmount ?? l.InitializeAmount, currentBalance: l.balance ?? l.Balance,
    balanceAsOf: l.balanceAsOf, maturityDate: l.dueDate ?? l.DueDate ?? l.endDate ?? l.EndDate, originationDate: l.startDate ?? l.StartDate,
    fixedRatePct: l.interestRate ?? l.InterestRate, datexLoanId: loanId });
  if (data.originalBalance == null && data.currentBalance == null) return null;
  return { id: `datex-loan:${loanId}`, data, note: `Datex Loans #${loanId}${l.period ? ` (period ${l.period})` : ""}` };
}
