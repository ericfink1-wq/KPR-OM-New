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

export type AmKind = "loan" | "swap" | "date" | "pref" | "covenant" | "acquisition" | "optstatus" | "news";
export const AM_KINDS: readonly AmKind[] = ["loan", "swap", "date", "pref", "covenant", "acquisition", "optstatus", "news"];
/** The kinds an admin enters (news is written by the credit-watch scan only). */
export type EntryKind = Exclude<AmKind, "news">;
export const ENTRY_KINDS: readonly EntryKind[] = ["loan", "swap", "date", "pref", "covenant", "acquisition", "optstatus"];

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
/** Free text that may arrive as a string, a list or a small object (covenants, open
 *  questions…) — flattened to readable text, never dropped. */
const text = (v: unknown, max = 1500): string | undefined => {
  if (v == null) return undefined;
  if (Array.isArray(v)) return str(v.map(x => (x && typeof x === "object" ? text(x, max) : String(x ?? "").trim())).filter(Boolean).join("; "), max);
  if (typeof v === "object") return str(Object.entries(v as Record<string, unknown>).filter(([, x]) => x != null && x !== "").map(([k, x]) => `${k}: ${typeof x === "object" ? text(x, max) : String(x)}`).join("; "), max);
  return str(v, max);
};
/** A rate given as a fraction (0.0408) is a percent written the other way round. */
const pct = (v: unknown): number | undefined => { const n = num(v, 0, 100); return n == null ? undefined : n > 0 && n < 0.25 ? Math.round(n * 1e6) / 1e4 : n; };

export interface LoanRec {
  lender?: string; loanName?: string; originalBalance?: number; currentBalance?: number; balanceAsOf?: string;
  rateType?: "fixed" | "floating" | "swapped"; index?: string; spreadBps?: number; fixedRatePct?: number; allInRatePct?: number;
  originationDate?: string; maturityDate?: string; extensionOptions?: string; extensionNoticeDate?: string;
  amortization?: "IO" | "amortizing" | "partial IO"; amortYears?: number; ioUntil?: string; amortizationText?: string;
  dscrCovenant?: number; debtYieldCovenantPct?: number; recourse?: string; guarantor?: string;
  datexLoanId?: number; notes?: string;
  loanLabel?: string; covenants?: string; prepayment?: string; openQuestions?: string; confidence?: string;
}
export interface SwapRec {
  loanId?: string; counterparty?: string; notional?: number; fixedSwapRatePct?: number; spreadBps?: number; allInFixedPct?: number;
  tradeDate?: string; effectiveDate?: string; maturityDate?: string; index?: string; payFixed?: boolean; notes?: string;
  loanLabel?: string; openQuestions?: string; confidence?: string;
  /** Hedge known to exist but notional / rate / maturity not documented yet — shown, never priced. */
  termsPending?: boolean;
}
/** Preferred equity — capital, not debt: kept OUT of total debt and the weighted rate. */
export interface PrefRec {
  investor?: string; loanLabel?: string; amount?: number; ratePct?: number; currentPayPct?: number; accrualPct?: number;
  fundingDate?: string; maturityDate?: string; redemption?: string; notes?: string; openQuestions?: string; confidence?: string;
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
    // Word-boundary IO test: "amortizat-io-n" contains "io" and used to read as interest-only.
    amortization: amort.includes("partial") ? "partial IO" : /\bio\b|interest[- ]only/.test(amort) ? "IO" : amort.includes("amort") ? "amortizing" : undefined,
    // "IO to 1/15/2030, then 30-yr amortization" → ioUntil + amortYears, read from the text.
    amortYears: num(r.amortYears, 1, 50) ?? num(/(\d{2})[- ]?(?:yr|year)s?\s*amort/i.exec(String(r.amortization ?? ""))?.[1], 1, 50),
    ioUntil: isoDate(r.ioUntil) ?? isoDate(/(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/.exec(String(r.ioPeriod ?? r.interestOnly ?? (/\bIO\b|interest[- ]only/i.test(String(r.amortization ?? "")) ? r.amortization : "")))?.[1]),
    amortizationText: str(r.amortization, 300),
    dscrCovenant: num(r.dscrCovenant ?? r.dscr, 0.5, 5), debtYieldCovenantPct: pct(r.debtYieldCovenantPct ?? r.debtYieldCovenant),
    recourse: str(r.recourse), guarantor: str(r.guarantor), datexLoanId: num(r.datexLoanId, 0), notes: text(r.notes),
    loanLabel: str(r.loanLabel ?? r.label, 120), covenants: text(r.covenants), prepayment: text(r.prepayment ?? r.prepaymentTerms ?? r.prepay),
    openQuestions: text(r.openQuestions), confidence: str(r.confidence, 60),
  } as LoanRec & Record<string, unknown>);
}
export function sanitizeSwap(r: Record<string, unknown>): SwapRec {
  const spreadBps = num(r.spreadBps, 0, 2000) ?? (num(r.spreadPct ?? r.spread, 0, 20) != null ? Math.round(num(r.spreadPct ?? r.spread, 0, 20)! * 100) : undefined);
  return prune({
    loanId: str(r.loanId, 120), counterparty: str(r.counterparty), notional: num(r.notional, 0, 5e9),
    fixedSwapRatePct: pct(r.fixedSwapRatePct ?? r.swapRate ?? r.fixedRate), spreadBps, allInFixedPct: pct(r.allInFixedPct ?? r.allIn),
    tradeDate: isoDate(r.tradeDate), effectiveDate: isoDate(r.effectiveDate), maturityDate: isoDate(r.maturityDate ?? r.terminationDate ?? r.maturity),
    index: normIndex(r.index ?? r.floatingIndex), payFixed: bool(r.payFixed), notes: text(r.notes),
    loanLabel: str(r.loanLabel ?? r.label, 120), openQuestions: text(r.openQuestions), confidence: str(r.confidence, 60),
  });
}
export function sanitizePref(r: Record<string, unknown>): PrefRec {
  return prune({
    investor: str(r.investor ?? r.provider ?? r.lender ?? r.counterparty), loanLabel: str(r.loanLabel ?? r.label, 120),
    amount: num(r.amount ?? r.originalBalance ?? r.currentBalance ?? r.balance, 0, 5e9),
    ratePct: pct(r.ratePct ?? r.prefRatePct ?? r.allInRatePct ?? r.fixedRatePct ?? r.rate), currentPayPct: pct(r.currentPayPct), accrualPct: pct(r.accrualPct),
    fundingDate: isoDate(r.fundingDate ?? r.originationDate), maturityDate: isoDate(r.maturityDate ?? r.maturity),
    redemption: text(r.redemption ?? r.prepayment), notes: text(r.notes), openQuestions: text(r.openQuestions), confidence: str(r.confidence, 60),
  });
}
export function sanitizeDate(r: Record<string, unknown>): DateRec {
  return prune({ date: isoDate(r.date), type: str(r.type, 60), tenant: str(r.tenant, 120), description: str(r.description, 500), owner: str(r.owner, 80), noticeDays: num(r.noticeDays, 0, 3650) });
}
// ── Columns we don't model are KEPT, not silently dropped (Eric's 10/18 seed lost its
//    covenant, prepayment and Drive-link columns to a whitelist). Bounded, primitive-ish only.
const META_KEYS = new Set(["kind", "id", "dealId", "bldgId", "BLDGID", "property", "propertyName", "source", "sourceNote"]);
const ALIAS_KEYS = new Set(["spread", "spreadPct", "spread_bps", "originalAmount", "balance", "name", "fixedRate", "allInRate", "startDate", "maturity",
  "dscr", "debtYieldCovenant", "swapRate", "allIn", "terminationDate", "floatingIndex", "label", "prepaymentTerms", "prepay", "provider",
  "prefRatePct", "rate", "price", "closingDate", "noiAtClose", "goingInCap", "capRate", "kpOwnershipPct", "kpPercent", "jv", "partner"]);
function withExtras(raw: Record<string, unknown>, clean: Record<string, unknown>): Record<string, unknown> {
  let kept = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (kept >= 40 || META_KEYS.has(k) || ALIAS_KEYS.has(k) || k in clean || v == null || v === "" || !/^[A-Za-z][A-Za-z0-9_ ]{0,60}$/.test(k)) continue;
    const t = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (t.length > 2000) continue;
    clean[k] = typeof v === "number" || typeof v === "boolean" ? v : typeof v === "object" ? v : String(v).trim();
    kept++;
  }
  const docs = extractDocs(raw);
  if (docs.length) clean.sourceDocs = docs;
  return clean;
}
/** Google Drive files named on a row (bare ids, /d/<id>/ links, ?id= links, {id,name} objects). */
export function extractDocs(raw: Record<string, unknown>): Array<{ id: string; name?: string }> {
  const out = new Map<string, string | undefined>();
  const idOf = (x: string): string | null => {
    const m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(x) ?? /[?&]id=([A-Za-z0-9_-]{20,})/.exec(x);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{25,}$/.test(x.trim()) ? x.trim() : null;
  };
  const visit = (v: unknown, name?: string, depth = 0): void => {
    if (v == null || depth > 3) return;
    if (typeof v === "string") { for (const part of v.split(/[\s,;]+/)) { const id = idOf(part); if (id && !out.has(id)) out.set(id, name); } return; }
    if (Array.isArray(v)) { v.forEach(x => visit(x, name, depth + 1)); return; }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const nm = str(o.name ?? o.title ?? o.label ?? o.fileName, 160) ?? name;
      for (const k of ["id", "fileId", "driveId", "driveFileId", "url", "link", "href"]) if (o[k] != null) visit(o[k], nm, depth + 1);
    }
  };
  for (const [k, v] of Object.entries(raw)) if (/drive|file|doc|link|url|source_?id/i.test(k) && !/^source(Note)?$/.test(k)) visit(v, undefined);
  return [...out.entries()].slice(0, 20).map(([id, name]) => (name ? { id, name } : { id }));
}

// ── Covenants (structured; admin-editable) ──
export type CovenantType = "DSCR" | "DY" | "LTV" | "cash-sweep" | "cash-trap" | "other";
export function covType(v: unknown): CovenantType | undefined {
  const x = String(v ?? "").toLowerCase();
  if (!x) return undefined;
  if (/sweep/.test(x)) return "cash-sweep";
  if (/trap|cash ?management|lockbox/.test(x)) return "cash-trap";
  if (/dscr|debt service coverage/.test(x)) return "DSCR";
  if (/\bdy\b|debt yield/.test(x)) return "DY";
  if (/ltv|loan[- ]to[- ]value|right[- ]?siz/.test(x)) return "LTV";
  return "other";
}
const freq = (v: unknown): string | undefined => {
  const x = String(v ?? "").toLowerCase();
  return /quarter/.test(x) ? "quarterly" : /semi/.test(x) ? "semi-annual" : /month/.test(x) ? "monthly" : /annual|year|12\/31/.test(x) ? "annual" : undefined;
};
export function sanitizeCovenant(r: Record<string, unknown>): Record<string, unknown> {
  return prune({
    loanId: str(r.loanId, 120), loanLabel: str(r.loanLabel, 120), type: covType(r.type ?? r.covenantType),
    threshold: num(r.threshold ?? r.min ?? r.level, 0, 100), sweepBelow: num(r.sweepBelow ?? r.sweepThreshold, 0, 100),
    testFrequency: freq(r.testFrequency ?? r.frequency), firstTestDate: isoDate(r.firstTestDate ?? r.firstTest),
    testMonthDay: /^\d{2}-\d{2}$/.test(String(r.testMonthDay ?? "")) ? String(r.testMonthDay) : undefined,
    amortYears: num(r.amortYears ?? r.testAmortYears, 1, 50), testRatePct: pct(r.testRatePct),
    linkedTenant: str(r.linkedTenant ?? r.tenant, 160), triggerDate: isoDate(r.triggerDate ?? r.deadline), trigger: text(r.trigger, 600),
    description: text(r.description, 800), notes: text(r.notes), confidence: str(r.confidence, 60),
  } as Record<string, unknown>);
}
// ── Acquisition (one per deal, from the KPR Corporate Overview) ──
export function sanitizeAcquisition(r: Record<string, unknown>): Record<string, unknown> {
  const budgetKey = Object.keys(r).find(k => /^budget_?noi_?(20\d\d)$/i.test(k));
  return prune({
    purchasePrice: num(r.purchasePrice ?? r.price, 0, 5e9), closeDate: isoDate(r.closeDate ?? r.closingDate),
    seller: str(r.seller, 200), kpPct: pct(r.kpPct ?? r.kpOwnershipPct ?? r.kpPercent), jvPartner: str(r.jvPartner ?? r.jv ?? r.partner, 200),
    mzlEquity: num(r.mzlEquity, -5e9, 5e9), kpMemberEquity: num(r.kpMemberEquity, -5e9, 5e9), totalEquity: num(r.totalEquity, -5e9, 5e9),
    noiAtPurchase: num(r.noiAtPurchase ?? r.noiAtClose, -1e9, 1e9), goingInCapPct: pct(r.goingInCapPct ?? r.goingInCap ?? r.capRate),
    budgetNoi: num(r.budgetNoi ?? (budgetKey ? r[budgetKey] : undefined), -1e9, 1e9),
    budgetYear: num(r.budgetYear, 2000, 2100) ?? (budgetKey ? Number(/(20\d\d)/.exec(budgetKey)![1]) : undefined),
    notes: text(r.notes),
  } as Record<string, unknown>);
}
// ── Option-notice status (a passed notice date: did the tenant exercise?) ──
const OPT_STATUS = ["Exercised", "Pending", "Lapsed"] as const;
export function sanitizeOptStatus(r: Record<string, unknown>): Record<string, unknown> {
  const st = OPT_STATUS.find(x => x.toLowerCase() === String(r.status ?? "").trim().toLowerCase());
  return prune({ tenant: str(r.tenant, 160), option: str(r.option, 80), noticeDate: isoDate(r.noticeDate), status: st, note: text(r.note ?? r.notes, 600) } as Record<string, unknown>);
}

const SANITIZE: Record<EntryKind, (r: Record<string, unknown>) => Record<string, unknown>> = {
  loan: r => withExtras(r, sanitizeLoan(r) as Record<string, unknown>),
  swap: r => {
    const w = withExtras(r, sanitizeSwap(r) as Record<string, unknown>);
    if (w.notional == null || w.fixedSwapRatePct == null || !w.maturityDate) w.termsPending = true; else delete w.termsPending;
    return w;
  },
  pref: r => withExtras(r, sanitizePref(r) as Record<string, unknown>),
  covenant: r => withExtras(r, sanitizeCovenant(r)),
  acquisition: r => withExtras(r, sanitizeAcquisition(r)),
  optstatus: r => sanitizeOptStatus(r),
  date: r => sanitizeDate(r) as Record<string, unknown>,
};

/** A record must say WHAT it is about; one that doesn't is rejected, never stored blank. */
export function validateRecord(kind: EntryKind, d: Record<string, unknown>): string | null {
  if (kind === "loan" && d.originalBalance == null && d.currentBalance == null) return "a loan needs an original or current balance";
  if (kind === "loan" && !d.maturityDate) return "a loan needs a maturity date";
  // A swap whose terms aren't documented yet still saves (as "terms pending", never priced) —
  // but it has to say whose hedge it is.
  if (kind === "swap" && !d.counterparty && !d.loanLabel && !d.loanId && d.notional == null) return "a swap needs at least a counterparty, loan label or notional";
  if (kind === "pref" && d.amount == null) return "preferred equity needs an amount";
  if (kind === "covenant" && !d.type) return "a covenant needs a type (DSCR, DY, LTV, cash sweep, cash trap or other)";
  if (kind === "covenant" && d.threshold == null && !d.trigger && !d.linkedTenant && !d.description) return "a covenant needs a threshold or a described trigger";
  if (kind === "acquisition" && d.purchasePrice == null && !d.closeDate) return "an acquisition row needs a purchase price or a close date";
  if (kind === "optstatus" && (!d.tenant || !d.status)) return "an option status needs a tenant and a status (Exercised, Pending or Lapsed)";
  if (kind === "date" && (!d.date || !d.type)) return "a critical date needs a date and a type";
  return null;
}

/** Stable id so re-importing the same seed updates rows instead of duplicating them. */
export function recordId(kind: string, dealId: string, d: Record<string, unknown>): string {
  const key = kind === "loan" ? [d.lender, d.maturityDate, d.loanName]
    : kind === "swap" ? (d.termsPending ? [d.counterparty, d.maturityDate, d.notional, "pending", d.loanLabel, d.fixedSwapRatePct] : [d.counterparty, d.maturityDate, d.notional])
    : kind === "pref" ? [d.investor, d.loanLabel, d.amount]
    : kind === "covenant" ? [d.loanId ?? d.loanLabel, d.type, d.threshold, d.linkedTenant, d.triggerDate]
    : kind === "acquisition" ? []          // one per property — re-importing replaces it
    : kind === "optstatus" ? [String(d.tenant ?? "").toLowerCase().replace(/[^a-z0-9]+/g, ""), d.option, d.noticeDate]
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

export interface ImportRow { kind: EntryKind; raw: Record<string, unknown> }
/** A row sent under "loans" that is really preferred equity (Kimco "Loan 2" at Rockaway…) —
 *  only when a type/label field SAYS so; never inferred from the lender's name. */
export function isPrefEquityRow(raw: Record<string, unknown>): boolean {
  const said = [raw.instrument, raw.type, raw.loanType, raw.category, raw.rateType, raw.loanLabel, raw.loanName, raw.label].map(v => String(v ?? "")).join(" ");
  return /pref(erred)?[\s-]*equity|\bpref\s*eq\b/i.test(said);
}
/** Accepts {loans:[],swaps:[],dates:[]}, a bare array with a `kind` on each row, or CSV with a `kind` column. */
export function readImportText(text: string): { rows: ImportRow[]; problem?: string } {
  const t = text.trim();
  if (!t) return { rows: [], problem: "nothing pasted" };
  const asKind = (k: unknown): ImportRow["kind"] | null => { const s = String(k ?? "").toLowerCase().replace(/s$/, "").replace(/[\s_-]/g, ""); return s === "loan" || s === "swap" || s === "date" || s === "pref" || s === "covenant" || s === "acquisition" || s === "optstatus" ? s : s === "criticaldate" ? "date" : s === "preferredequity" || s === "prefequity" ? "pref" : null; };
  const route = (r: ImportRow): ImportRow => (r.kind === "loan" && isPrefEquityRow(r.raw) ? { ...r, kind: "pref" } : r);
  if (t.startsWith("{") || t.startsWith("[")) {
    let j: unknown;
    try { j = JSON.parse(t); } catch { return { rows: [], problem: "that isn't valid JSON" }; }
    const out: ImportRow[] = [];
    if (Array.isArray(j)) { for (const r of j) { const k = asKind((r as Record<string, unknown>)?.kind); if (k) out.push({ kind: k, raw: r as Record<string, unknown> }); } }
    else if (j && typeof j === "object") {
      for (const [key, kind] of [["loans", "loan"], ["swaps", "swap"], ["dates", "date"], ["criticalDates", "date"], ["preferredEquity", "pref"], ["prefs", "pref"], ["prefEquity", "pref"],
        ["covenants", "covenant"], ["acquisitions", "acquisition"], ["acquisition", "acquisition"], ["optionStatuses", "optstatus"]] as const) {
        const arr = (j as Record<string, unknown>)[key];
        if (Array.isArray(arr)) for (const r of arr) if (r && typeof r === "object") out.push({ kind, raw: r as Record<string, unknown> });
      }
    }
    return out.length ? { rows: out.map(route) } : { rows: [], problem: "nothing recognised — use {\"loans\":[…],\"swaps\":[…],\"dates\":[…],\"preferredEquity\":[…],\"covenants\":[…],\"acquisitions\":[…]}" };
  }
  const objs = parseCsvObjects(t);
  const rows = objs.map(o => ({ kind: asKind(o.kind), raw: o as Record<string, unknown> })).filter((r): r is ImportRow => !!r.kind);
  return rows.length ? { rows: rows.map(route) } : { rows: [], problem: "CSV needs a header row with a `kind` column (loan, swap or date)" };
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
export async function listRecords(kinds: AmKind[] = [...ENTRY_KINDS]): Promise<AmRecord[]> {
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
export function sanitizeFor(kind: EntryKind, raw: Record<string, unknown>): Record<string, unknown> { return SANITIZE[kind](raw); }

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

/** Does a headline actually name the brand? (whole-word match, spacing/punctuation-tolerant:
 *  "Fred Meyer" matches "FredMeyer" and "Fred-Meyer", never a generic grocery story.) */
export function headlineNamesBrand(title: string, brand: string): boolean {
  const parts = brand.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!parts.length) return false;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${parts.map(esc).join("[^a-z0-9]*")}(?![a-z])`, "i").test(title);
}
