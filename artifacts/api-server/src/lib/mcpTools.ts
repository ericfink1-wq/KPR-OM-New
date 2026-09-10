// The MCP tool surface — everything an outside Claude client can ask this deal
// library for. READ-ONLY by design: nothing here writes, deletes, or spends tokens,
// so handing someone a key can never damage the library or run up an API bill.
//
// Each tool returns plain JSON. Payloads are trimmed deliberately: a deal record
// carries narrative, cash flows, lease-risk trees and a full roster, and dumping all
// of it for 150+ deals would blow the client's context. So list tools return compact
// summaries and get_deal returns the full record with the heavy blocks opt-in.
import { db, dealsTable, tenantIndexTable, leaseAbstractsTable, compsIndexTable } from "@workspace/db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { auditExtraction, auditCheckKey, AUDIT_CHECK_LABELS } from "./extractionAudit";
import { summarizePortfolioIssues } from "./portfolioIssues";
import { getAllTenantBenchmarks } from "./tenantBenchmarks";
import { getHouseView } from "./houseView";
import { getActiveLessons } from "./extractionLessons";
import { buildKnowledgePack, renderKnowledgePack, KPR_PLAYBOOK } from "./mcpKnowledge";

export interface McpToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

// ─── argument coercion ──────────────────────────────────────────────────────
// MCP clients are loose with types (a number can arrive as "25"), so coerce rather
// than reject — a tool that 400s on a stringified number is a tool Claude gives up on.
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const bool = (v: unknown, dflt = false): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return /^(true|yes|1)$/i.test(v.trim());
  return dflt;
};
// Date filters must REJECT a bad value, never silently ignore it. An unparseable date used
// to fall through to a string comparison, which quietly turned "expiring before <garbage>"
// into "has any expiry date at all" and returned 6,543 confident matches to a query that
// meant nothing. A filter that silently stops filtering is worse than an error.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isoDateOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!ISO_DATE.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : t;
}
const badDate = (field: string, got: unknown) => ({
  error: "invalid_date",
  message: `${field} must be an ISO date like "2027-06-30" — received ${JSON.stringify(got)}. ` +
    "Rejecting rather than ignoring it, because a filter that silently stops filtering returns " +
    "a confident answer to a question you did not ask.",
});

const clampLimit = (v: unknown, dflt: number, max: number): number => {
  const n = num(v);
  if (n == null) return dflt;
  return Math.max(1, Math.min(max, Math.round(n)));
};

// ─── response budget ────────────────────────────────────────────────────────
// Measured against the real 301-deal corpus: search_deals at its old default
// returned 174 KB (~45k tokens) and at limit 200 returned 1.2 MB (~318k tokens) — more
// than a whole context window, from one call. A tool that floods the caller is worse
// than no tool, so every list-shaped result is capped and says so when it trims.
// ~60 KB ≈ 15k tokens: big enough for a real answer, small enough to leave room to think.
export const RESPONSE_BUDGET_BYTES = 60_000;

// Measure exactly what goes on the wire. The tool handler emits JSON.stringify(x, null, 2)
// for readability, which runs ~17% larger than the compact form — so budgeting against
// compact JSON silently overshoots by that much. Always measure the emitted shape.
export const emittedSize = (v: unknown): number => JSON.stringify(v, null, 2).length;

// Trim `rows` until the whole payload fits the budget, then explain the trim in-band so
// the caller knows it is looking at a slice and how to narrow the question instead.
export function capRows<T>(
  payload: Record<string, unknown>,
  rowsKey: string,
  rows: T[],
  advice: string,
  budget = RESPONSE_BUDGET_BYTES,
): Record<string, unknown> {
  const size = emittedSize;
  let kept = rows;
  const base = { ...payload, [rowsKey]: [] as T[] };
  const overhead = size(base);
  if (overhead >= budget) {
    // Even with no rows the wrapper is over budget — return an honest, tiny result
    // rather than something the caller cannot use.
    return { ...base, truncated: { returned: 0, of: rows.length, reason: "summary alone exceeds the response budget", advice } };
  }
  while (kept.length > 0 && overhead + size(kept) > budget) {
    // Halve first for speed on very large sets, then step down to land close to the cap.
    kept = kept.length > 20 ? kept.slice(0, Math.floor(kept.length * 0.6)) : kept.slice(0, kept.length - 1);
  }
  const out: Record<string, unknown> = { ...payload, [rowsKey]: kept };
  if (kept.length < rows.length) {
    out.truncated = {
      returned: kept.length,
      of: rows.length,
      reason: `the full set exceeded this tool's ${Math.round(budget / 1024)} KB response budget`,
      advice,
    };
  }
  return out;
}

type DealData = Record<string, unknown>;
interface DealRecord { id: string; data: DealData; updatedAt: Date }

// Active = not trashed, not mid-ingest. The same filter the site's own audit uses,
// so MCP callers see exactly the library the app shows.
function isActive(d: DealData): boolean {
  return !d.trashedAt && !d._processing && !d._processingError;
}

async function loadActiveDeals(): Promise<DealRecord[]> {
  const rows = await db.select().from(dealsTable);
  return rows
    .map(r => ({ id: r.id, data: r.data as DealData, updatedAt: r.updatedAt }))
    .filter(r => isActive(r.data));
}

// Blocks that are large, image-encoded, or internal bookkeeping. Stripped from
// get_deal unless explicitly requested, and always stripped from list results.
const HEAVY_FIELDS = new Set([
  "sourceText", "imageMeta", "cover", "coverThumb", "sitePlan", "pagePicks",
  "reviewQuestions", "_processing", "_processingError",
]);
const OPT_IN_FIELDS: Record<string, string> = {
  tenants: "includeTenants",
  cashFlowProjection: "includeCashFlow",
  leaseRisk: "includeLeaseRisk",
  comparableSales: "includeComps",
};

// A real tenant row carries 44 fields and ~1.3 KB. On a 126-tenant centre that is 160 KB
// of roster in one response. Every field is meaningful, so nothing is dropped on
// principle — but a caller asking "tell me about this deal" needs the shape of the
// roster, not every clause of it. The compact projection keeps what answers most
// questions; the full row is one explicit flag away, and search_tenants({dealId}) always
// returns everything.
const COMPACT_TENANT_FIELDS = [
  "name", "suite", "sf", "rentPerSF", "annualRent", "leaseStart", "leaseExpiry",
  "remainingTermYears", "leaseType", "isAnchor", "isNAP", "isDark", "creditRating",
  "salesPSF", "salesYear", "occupancyCost", "renewalOptions", "rentBumps", "screens",
] as const;

function compactTenant(t: DealData): DealData {
  const out: DealData = {};
  for (const k of COMPACT_TENANT_FIELDS) {
    const v = t[k];
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

function trimDeal(d: DealData, opts: Record<string, boolean>): DealData {
  const out: DealData = {};
  for (const [k, v] of Object.entries(d)) {
    if (HEAVY_FIELDS.has(k)) continue;
    const gate = OPT_IN_FIELDS[k];
    if (gate && !opts[gate]) continue;
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

const nameOf = (d: DealData) => String(d.propertyName || d.fileName || "Untitled");

// Vacancy is labelled inconsistently across the corpus. On the real 301-deal set:
// 513 rows begin "Vacant", 141 begin "Available" (and none of those 141 carry rent, at an
// average 4,800 SF — unmistakably empty suites). Matching only /^vacant/ silently counted
// those 141 as operating tenants, inflating tenant counts and the denominators built on
// them. Match the whole family.
// The trailing \b matters: without it "Vacanti Salon" and "Availa Bank" — real tenants —
// would be written off as empty suites.
const VACANT_NAME = /^\s*(vacant|vacancy|available|avail|white\s*box|dark\s*space)\b/i;
export const isVacantName = (name: unknown): boolean => VACANT_NAME.test(String(name ?? ""));

// ─── brand matching ─────────────────────────────────────────────────────────
// Tenant names are matched on WORD BOUNDARIES, not raw substrings. A plain substring
// match is catastrophic on real roster data: searching "Ross" also matches "American Red
// CROSS", "CROSS Country Package", "Lacrosse Unlimited" and — worst of all — the rent
// notations "(Modified GROSS)" and "(GROSS)" that sit inside dozens of unrelated tenant
// names. On this corpus that turned a perfectly reasonable "what do we pay Ross?" into a
// median contaminated by 22 different tenants. A word-boundary match still does the job it
// is meant to do, folding "Starbucks", "STARBUCKS", "Starbucks Coffee" and "Starbucks
// Corporation" together, because the brand appears there as a whole word.
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function brandMatcher(query: string): (name: unknown) => boolean {
  const q = query.trim();
  if (!q) return () => false;
  const re = new RegExp(`\\b${escapeRe(q)}\\b`, "i");
  return (name: unknown) => re.test(String(name ?? ""));
}

// Collapse a roster name to the brand underneath it, so "Dollar Tree #3654",
// "Dollar Tree (LOI)" and "Dollar Tree Stores" are recognised as one tenant rather than
// three. Used only to judge whether a match set is coherent — never to rewrite data.
export function brandBaseName(name: unknown): string {
  return String(name ?? "")
    .replace(/\([^)]*\)/g, " ")        // drop "(LOI)", "(Modified Gross)", "(NAP)"
    .replace(/#\s*\w+/g, " ")          // drop store numbers
    .replace(/\b(stores?|inc|llc|corp(oration)?|company|co|the)\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim().toLowerCase();
}

// WHEN was this record true? This corpus is STATIC: a deal is captured from an offering
// memorandum or rent roll and then essentially never updated. So every figure here is
// as-of its capture date, not as-of today — and a benchmark built across the corpus is a
// blend of vintages spanning a rent cycle, not a snapshot of today's market. Nothing can
// read these numbers honestly without knowing that, so the date rides along with them.
function capturedAt(d: DealData, fallback: Date): { asOf: string; basis: string; omAssumedClosing?: string } {
  const rosterAsOf = str(d.tenantsAsOf);
  const uploaded = str(d.uploadedAt);
  const today = new Date().toISOString().slice(0, 10);

  // A FORWARD-DATED tenantsAsOf is not an observation date. Retail OMs routinely start
  // their financials on an assumed closing date a few months out — a mid-2026 book will
  // model from 1/1/27, because that is when a buyer would realistically own it. The
  // roster underneath is still as of publication. Treating that assumed closing date as
  // "when this data was true" credits the record with freshness it does not have, so the
  // observation date falls back to when the document was actually read, and the OM's own
  // assumption is reported separately as what it is.
  if (rosterAsOf && rosterAsOf.slice(0, 10) > today && uploaded) {
    return {
      asOf: uploaded.slice(0, 10),
      basis: "document upload date (the roster's stated as-of is the OM's assumed closing date, not an observation)",
      omAssumedClosing: rosterAsOf.slice(0, 10),
    };
  }
  if (rosterAsOf) return { asOf: rosterAsOf.slice(0, 10), basis: `roster as-of date${d.tenantsSource ? ` (${String(d.tenantsSource)})` : ""}` };
  if (uploaded) return { asOf: uploaded.slice(0, 10), basis: "document upload date" };
  return { asOf: fallback.toISOString().slice(0, 10), basis: "last record change (no capture date stored)" };
}

const yearOf = (iso: string | null | undefined): number | null => {
  const y = Number(String(iso ?? "").slice(0, 4));
  return Number.isFinite(y) && y > 1900 && y < 2200 ? y : null;
};

// Median / quartiles — the only summary statistics this library reports. Means are
// never used: one outlier lease would drag a mean somewhere no real deal sits.
function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  const v = lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
  return Math.round(v * 100) / 100;
}
function spread(values: number[]) {
  const clean = values.filter(v => Number.isFinite(v));
  if (!clean.length) return null;
  return { n: clean.length, median: quantile(clean, 0.5), p25: quantile(clean, 0.25), p75: quantile(clean, 0.75), min: quantile(clean, 0), max: quantile(clean, 1) };
}

// ─── recency weighting ──────────────────────────────────────────────────────
// Eric's judgement (9/10/26): in retail, a data point older than about ten years is
// fairly stale. So influence decays linearly to nothing across a ten-year horizon rather
// than either trusting a 2014 rent as much as a 2025 one or throwing it away at an
// arbitrary cliff. "Fairly stale" is a fade, not a wall.
//
// WHAT AGES, AND FROM WHEN (Eric, 9/10/26 — this corrected an earlier mistake here):
// "if an OM is from 2026 and the lease was signed in 2010, that doesn't mean the lease
// vintage is 2026, it's 2010." The first cut weighted by CAPTURE date, which is wrong for
// the question actually being asked. A rent negotiated in 2010 tells you about the 2010
// market no matter when someone typed it into a database; reading it recently does not
// make it a current market signal. So the clock that matters is LEASE COMMENCEMENT — when
// the economics were struck — and capture date is only the fallback when commencement is
// unknown.
//
// The caveat Eric attaches: amendments and exercised options RESET the economics, so a
// lease whose terms were renegotiated later has a later effective vintage. The roster does
// not reliably record when that last happened, so this weights on commencement and flags
// the limitation rather than pretending to a precision it does not have.
//
// Change RECENCY_HORIZON_YEARS to re-tune it; everything downstream follows.
export const RECENCY_HORIZON_YEARS = 10;

export function recencyWeight(vintageYear: number | null, nowYear: number): number {
  if (vintageYear == null) return 0.25;   // unknown vintage still counts, but weakly
  const age = nowYear - vintageYear;
  if (age <= 0) return 1;
  return Math.max(0, 1 - age / RECENCY_HORIZON_YEARS);
}

// Weighted percentile: sort by value, walk the cumulative weight, and take the point
// where it crosses q. A weighted MEDIAN, not a weighted mean — one freak lease must not
// be able to drag the figure, which is why this library reports medians everywhere.
export function weightedQuantile(entries: Array<{ value: number; weight: number }>, q: number): number | null {
  const clean = entries.filter(e => Number.isFinite(e.value) && e.weight > 0).sort((a, b) => a.value - b.value);
  if (!clean.length) return null;
  const total = clean.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return null;
  let acc = 0;
  for (const e of clean) {
    acc += e.weight;
    if (acc >= total * q) return Math.round(e.value * 100) / 100;
  }
  return Math.round(clean[clean.length - 1]!.value * 100) / 100;
}

// A metric summarised twice: recency-weighted (what the market looks like NOW, as far as
// this corpus can tell) and unweighted (everything ever seen). Reporting both means a
// caller can see when the two diverge — which is itself a signal that rents have moved.
export function weightedSpread(entries: Array<{ value: number; year: number | null }>, nowYear: number) {
  const clean = entries.filter(e => Number.isFinite(e.value));
  if (!clean.length) return null;
  const weighted = clean.map(e => ({ value: e.value, weight: recencyWeight(e.year, nowYear) }));
  // Strictly inside: a record AT the horizon has weight 0, so it informs nothing and must
  // not be counted as current — otherwise nWithinHorizon overstates how fresh the median is.
  const withinHorizon = clean.filter(e => recencyWeight(e.year, nowYear) > 0 && e.year != null).length;
  const plain = clean.map(e => e.value);
  return {
    n: clean.length,
    nWithinHorizon: withinHorizon,
    nStale: clean.length - withinHorizon,
    median: weightedQuantile(weighted, 0.5),
    p25: weightedQuantile(weighted, 0.25),
    p75: weightedQuantile(weighted, 0.75),
    min: quantile(plain, 0),
    max: quantile(plain, 1),
    unweightedMedian: quantile(plain, 0.5),
    basis: `recency-weighted: influence fades linearly to zero over ${RECENCY_HORIZON_YEARS} years`,
  };
}

// KPR runs a SEPARATE internal system of record for assets it owns today. Where that
// system is connected, it outranks this library on live roster and financial facts —
// this library's copy of an owned asset is an acquisition-era snapshot. Every tool
// that returns an owned deal says so inline, so the precedence travels WITH the data
// instead of depending on the reader having remembered a rule from somewhere else.
const OWNED_AUTHORITY_NOTE =
  "KPR-OWNED ASSET — DATEX IS AUTHORITATIVE, NOT THIS RECORD. Datex is KPR's " +
  "property-management system of record and holds the live picture of this property: " +
  "current rents and NNN, budget vs actual, occupancy history, tenant sales, option and " +
  "notice dates, loans, percentage-rent breakpoints, vacant suites and the active leasing " +
  "pipeline. What you have here is the ACQUISITION-ERA SNAPSHOT taken from the offering " +
  "documents at the time of the deal — it does not track anything that has happened since. " +
  "Take every live fact from Datex. Use this record only for what Datex has no reason to " +
  "hold: the original marketed underwriting, and this deal's place in the market corpus.";

function authorityFor(d: DealData): string | undefined {
  return String(d.status ?? "") === "Owned" ? OWNED_AUTHORITY_NOTE : undefined;
}

// One compact row per deal — the shape every list/search tool returns. Enough to
// decide which deal to open, small enough that 50 of them cost little context.
function dealSummary(r: DealRecord) {
  const d = r.data;
  const tenants = Array.isArray(d.tenants) ? (d.tenants as DealData[]) : [];
  const anchors = tenants.filter(t => t.isAnchor).map(t => String(t.name || "")).filter(Boolean);
  return {
    dealId: r.id,
    propertyName: nameOf(d),
    address: d.address ?? null,
    city: d.city ?? null,
    state: d.state ?? null,
    centerType: d.centerType ?? d.assetType ?? null,
    status: d.status ?? null,
    totalSF: d.totalSF ?? null,
    occupancy: d.occupancy ?? null,
    noi: d.noi ?? null,
    capRate: d.capRate ?? null,
    askingPrice: d.askingPrice ?? null,
    walt: d.walt ?? null,
    weightedAvgRentPSF: d.weightedAvgRentPSF ?? null,
    // dealScore is a rich object (grade + rationale + strengths + risks; median 5.5 KB,
    // max 15 KB on the real corpus). Carrying it on every list row is what made
    // search_deals return 45k tokens by default. The grade is the scannable part; the
    // reasoning belongs in get_deal, where the caller asked for one deal.
    grade: (() => {
      const ds = d.dealScore;
      if (ds == null) return null;
      if (typeof ds === "object") return (ds as DealData).grade ?? null;
      return ds;
    })(),
    tenantCount: tenants.length,
    anchors: anchors.slice(0, 6),
    updatedAt: r.updatedAt.toISOString(),
    capturedAsOf: capturedAt(d, r.updatedAt).asOf,
    ...(authorityFor(d) ? { authority: OWNED_AUTHORITY_NOTE } : {}),
  };
}

// Free-text match across the fields someone would actually search by, including
// tenant names — "find the Publix deals" has to work.
function matchesQuery(d: DealData, q: string): boolean {
  const needle = q.toLowerCase();
  const hay: string[] = [
    String(d.propertyName ?? ""), String(d.fileName ?? ""), String(d.address ?? ""),
    String(d.city ?? ""), String(d.state ?? ""), String(d.market ?? ""),
    String(d.submarket ?? ""), String(d.centerType ?? ""), String(d.notes ?? ""),
  ];
  if (Array.isArray(d.tenants)) {
    for (const t of d.tenants as DealData[]) hay.push(String(t?.name ?? ""));
  }
  return hay.some(h => h.toLowerCase().includes(needle));
}

// ─── 1. library_overview ────────────────────────────────────────────────────
const libraryOverview: McpToolDef = {
  name: "library_overview",
  title: "Library overview",
  description:
    "START HERE. What is in the KPR MARKET CORPUS right now: how many retail deals have been " +
    "recorded, the states and center types covered, aggregate size and the spread of headline " +
    "metrics, which tenant brands recur most often across the deals seen, and a glossary of " +
    "the field names used everywhere else. These are deals KPR LOOKED AT — mostly not deals it " +
    "owns — so read the roll-ups as market frequency, never as KPR's holdings.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    const deals = await loadActiveDeals();
    const byState = new Map<string, number>();
    const byType = new Map<string, number>();
    const byStatus = new Map<string, number>();
    let totalSF = 0, sfCount = 0, totalNOI = 0, noiCount = 0;
    const occs: number[] = [], caps: number[] = [];
    for (const r of deals) {
      const d = r.data;
      const st = str(d.state); if (st) byState.set(st, (byState.get(st) ?? 0) + 1);
      const ct = str(d.centerType) || str(d.assetType); if (ct) byType.set(ct, (byType.get(ct) ?? 0) + 1);
      const stt = str(d.status) || "unset"; byStatus.set(stt, (byStatus.get(stt) ?? 0) + 1);
      const sf = num(d.totalSF); if (sf) { totalSF += sf; sfCount++; }
      const noi = num(d.noi); if (noi) { totalNOI += noi; noiCount++; }
      const occ = num(d.occupancy); if (occ != null) occs.push(occ);
      const cap = num(d.capRate); if (cap != null) caps.push(cap);
    }
    const median = (a: number[]) => {
      if (!a.length) return null;
      const s = [...a].sort((x, y) => x - y);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
    };
    const rentRows = await db.select({
      name: tenantIndexTable.canonicalName, rent: tenantIndexTable.annualRent,
    }).from(tenantIndexTable).where(isNotNull(tenantIndexTable.canonicalName));
    const byTenant = new Map<string, { rent: number; locations: number }>();
    for (const t of rentRows) {
      const n = t.name!; const e = byTenant.get(n) ?? { rent: 0, locations: 0 };
      e.rent += t.rent ?? 0; e.locations += 1; byTenant.set(n, e);
    }
    const topTenants = [...byTenant.entries()]
      .sort((a, b) => b[1].rent - a[1].rent).slice(0, 15)
      .map(([name, v]) => ({ name, annualRent: Math.round(v.rent), locations: v.locations }));

    return {
      dealCount: deals.length,
      totals: {
        gla: Math.round(totalSF), dealsWithGla: sfCount,
        noi: Math.round(totalNOI), dealsWithNoi: noiCount,
        medianOccupancyPct: median(occs), medianCapRatePct: median(caps),
        dealsWithCapRate: caps.length,
      },
      note:
        "This is a MARKET CORPUS, not KPR's portfolio: most of these are deals KPR evaluated and " +
        "did not buy. Read every roll-up below as what the market looks like across the deals " +
        "seen, never as KPR's own exposure. For KPR's actual properties, use Datex. Also: cap " +
        "rate and asking price are absent on most deals because retail is often marketed " +
        "unpriced — expected, not a data gap.",
      byState: [...byState.entries()].sort((a, b) => b[1] - a[1]).map(([state, count]) => ({ state, count })),
      byCenterType: [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count })),
      byStatus: [...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ status, count })),
      // Frequency and rent WEIGHT across the corpus — how often a brand shows up in the
      // deals KPR sees. This is a market-presence signal, NOT KPR's tenant concentration.
      mostRecurringTenantsAcrossDeals: topTenants,
      fieldGlossary: {
        deal: "propertyName, address, city, state, centerType, totalSF (GLA), occupancy (%), walt (yrs), weightedAvgRentPSF, capRate (%), noi ($), askingPrice ($), grossPotentialRent ($), dealScore, redFlags, upsideItems, keyAssumptions, notes (underwriting narrative), tenants[]",
        tenant: "name (brand only), sf, rentPerSF, annualRent (BASE RENT ONLY), leaseStart, leaseExpiry, remainingTermYears, leaseType, rentBumps, rentSchedule, renewalOptions, salesPSF, salesYear, occupancyCost, expenseReimbursements, percentageRent, otherRent, creditRating, isAnchor, isNAP, isDark, parentCompany",
        kprUnderwriting: "KPR's own underwriting is in the acq*, debt*, pref*, txn* and disp* fields — never mixed into the seller-stated fields above.",
      },
      nextSteps: [
        "get_knowledge — read the KPR analyst playbook before interpreting any of this",
        "search_deals — find deals by name, market, anchor or metrics",
        "get_deal — pull one deal in full, with its rent roll",
      ],
    };
  },
};

// ─── 2. search_deals ────────────────────────────────────────────────────────
const searchDeals: McpToolDef = {
  name: "search_deals",
  title: "Search deals",
  description:
    "Find shopping centers in the library. Free-text `query` matches property name, address, " +
    "city, state, market, the underwriting narrative AND tenant names (so \"Publix\" finds every " +
    "Publix-anchored deal). Numeric filters narrow by size, occupancy, cap rate and NOI. Returns " +
    "compact summaries — follow up with get_deal for the full record.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free text: property name, city, market, or a tenant/anchor brand." },
      state: { type: "string", description: "Two-letter state code, e.g. \"PA\"." },
      city: { type: "string" },
      centerType: { type: "string", description: "e.g. \"Grocery-Anchored\", \"Power Center\", \"Lifestyle\"." },
      status: { type: "string", description: "Pipeline status, e.g. \"Owned\", \"Passed\", \"Under Contract\"." },
      anchor: { type: "string", description: "Only deals with this anchor tenant." },
      minSF: { type: "number" }, maxSF: { type: "number" },
      minOccupancy: { type: "number", description: "Percent, e.g. 90." },
      maxOccupancy: { type: "number" },
      minCapRate: { type: "number", description: "Percent, e.g. 6.5." },
      maxCapRate: { type: "number" },
      minNOI: { type: "number" },
      sortBy: { type: "string", enum: ["name", "totalSF", "noi", "capRate", "occupancy", "dealScore", "updatedAt"], description: "Default: name." },
      limit: { type: "number", description: "Default 20, max 60. Narrow with filters rather than raising this." },
    },
  },
  handler: async (a) => {
    const deals = await loadActiveDeals();
    const q = str(a.query), state = str(a.state), city = str(a.city);
    const centerType = str(a.centerType), status = str(a.status), anchor = str(a.anchor);
    const minSF = num(a.minSF), maxSF = num(a.maxSF);
    const minOcc = num(a.minOccupancy), maxOcc = num(a.maxOccupancy);
    const minCap = num(a.minCapRate), maxCap = num(a.maxCapRate), minNOI = num(a.minNOI);

    const hit = deals.filter(r => {
      const d = r.data;
      if (q && !matchesQuery(d, q)) return false;
      if (state && String(d.state ?? "").toUpperCase() !== state.toUpperCase()) return false;
      if (city && !String(d.city ?? "").toLowerCase().includes(city.toLowerCase())) return false;
      if (centerType && !`${d.centerType ?? ""} ${d.assetType ?? ""}`.toLowerCase().includes(centerType.toLowerCase())) return false;
      if (status && !String(d.status ?? "").toLowerCase().includes(status.toLowerCase())) return false;
      if (anchor) {
        const ts = Array.isArray(d.tenants) ? (d.tenants as DealData[]) : [];
        const m = brandMatcher(anchor);
        if (!ts.some(t => m(t?.name))) return false;
      }
      const sf = num(d.totalSF);
      if (minSF != null && (sf == null || sf < minSF)) return false;
      if (maxSF != null && (sf == null || sf > maxSF)) return false;
      const occ = num(d.occupancy);
      if (minOcc != null && (occ == null || occ < minOcc)) return false;
      if (maxOcc != null && (occ == null || occ > maxOcc)) return false;
      const cap = num(d.capRate);
      if (minCap != null && (cap == null || cap < minCap)) return false;
      if (maxCap != null && (cap == null || cap > maxCap)) return false;
      const noi = num(d.noi);
      if (minNOI != null && (noi == null || noi < minNOI)) return false;
      return true;
    });

    const sortBy = str(a.sortBy) ?? "name";
    // Descending for metrics (biggest first is what you want), ascending by name.
    const key = (r: DealRecord): number | string => {
      switch (sortBy) {
        case "totalSF": return -(num(r.data.totalSF) ?? -Infinity);
        case "noi": return -(num(r.data.noi) ?? -Infinity);
        case "capRate": return -(num(r.data.capRate) ?? -Infinity);
        case "occupancy": return -(num(r.data.occupancy) ?? -Infinity);
        case "dealScore": return -(num(r.data.dealScore) ?? -Infinity);
        case "updatedAt": return -r.updatedAt.getTime();
        default: return nameOf(r.data).toLowerCase();
      }
    };
    hit.sort((x, y) => {
      const kx = key(x), ky = key(y);
      if (typeof kx === "string" || typeof ky === "string") return String(kx).localeCompare(String(ky));
      return kx - ky;
    });

    const limit = clampLimit(a.limit, 20, 60);
    return capRows(
      { matched: hit.length, totalInLibrary: deals.length },
      "deals",
      hit.slice(0, limit).map(dealSummary),
      "Narrow with state, centerType, anchor, status or a size/occupancy range, then call get_deal on the ones that matter.",
    );
  },
};

// ─── 3. get_deal ────────────────────────────────────────────────────────────
const getDeal: McpToolDef = {
  name: "get_deal",
  title: "Get one deal in full",
  description:
    "The complete record for one shopping center: seller-stated metrics, the underwriting " +
    "narrative, red flags, upside items, key assumptions, demographics, KPR's own underwriting " +
    "(acq*/debt*/pref*/txn* fields), and the full tenant rent roll. Accepts a dealId from " +
    "search_deals, or a property name (fuzzy — the closest single match wins; ambiguous names " +
    "come back as a candidate list rather than a guess).",
  inputSchema: {
    type: "object",
    properties: {
      dealId: { type: "string", description: "Exact id from search_deals. Preferred." },
      propertyName: { type: "string", description: "Property name, if you don't have the id." },
      includeTenants: { type: "boolean", description: "Full rent roll. Default true." },
      includeCashFlow: { type: "boolean", description: "Cash-flow projection. Default false." },
      includeLeaseRisk: { type: "boolean", description: "Co-tenancy / kickout trigger tree. Default false." },
      includeComps: { type: "boolean", description: "OM-supplied comparable sales. Default false." },
      tenantDetail: {
        type: "string", enum: ["compact", "full"],
        description: "Roster detail. \"compact\" (default) returns the ~19 fields that answer most questions; \"full\" returns all 44 per tenant and can be very large on a big centre. For the full detail of specific tenants, prefer search_tenants with this dealId.",
      },
    },
  },
  handler: async (a) => {
    const deals = await loadActiveDeals();
    const id = str(a.dealId), name = str(a.propertyName);
    let found: DealRecord | undefined;
    if (id) found = deals.find(r => r.id === id);
    if (!found && name) {
      const lower = name.toLowerCase();
      const exact = deals.filter(r => nameOf(r.data).toLowerCase() === lower);
      const partial = exact.length ? exact : deals.filter(r => nameOf(r.data).toLowerCase().includes(lower));
      if (partial.length === 1) found = partial[0];
      else if (partial.length > 1) {
        // Never silently pick one — an ambiguous name resolved by guess is how the
        // wrong center's numbers end up in an analysis.
        return {
          error: "ambiguous_property_name",
          message: `"${name}" matches ${partial.length} deals — call get_deal again with one of these dealIds.`,
          candidates: partial.slice(0, 20).map(dealSummary),
        };
      }
    }
    if (!found) {
      return { error: "not_found", message: id ? `No active deal with id "${id}".` : `No deal matching "${name ?? ""}". Use search_deals to find one.` };
    }
    const opts = {
      includeTenants: bool(a.includeTenants, true),
      includeCashFlow: bool(a.includeCashFlow, false),
      includeLeaseRisk: bool(a.includeLeaseRisk, false),
      includeComps: bool(a.includeComps, false),
    };
    const deal = trimDeal(found.data, opts);
    // Project the roster unless the caller explicitly asked for every field.
    if (opts.includeTenants && Array.isArray(deal.tenants)) {
      const roster = deal.tenants as DealData[];
      if (str(a.tenantDetail) !== "full") {
        deal.tenants = roster.map(compactTenant);
        deal.rosterDetail =
          `compact (${COMPACT_TENANT_FIELDS.length} of ~44 fields per tenant). For every field on a ` +
          `tenant, call search_tenants with this dealId, or re-call with tenantDetail:"full".`;
      } else {
        deal.rosterDetail = "full — every captured field per tenant";
      }
    }
    deal.dealId = found.id;
    deal.updatedAt = found.updatedAt.toISOString();
    const cap = capturedAt(found.data, found.updatedAt);
    deal.capturedAsOf = cap.asOf;
    deal.capturedAsOfBasis = cap.basis;
    // The live deterministic tie-out audit, so the caller sees data-integrity
    // contradictions on this deal instead of quoting a number that doesn't add up.
    const audit = auditExtraction(found.data);
    const response: Record<string, unknown> = {
      deal,
      ...(authorityFor(found.data) ? { authority: OWNED_AUTHORITY_NOTE } : {}),
      integrityFlags: audit.map(qq => ({
        check: AUDIT_CHECK_LABELS[auditCheckKey(qq.id)] || qq.field,
        severity: qq.severity,
        detail: qq.question,
      })),
      reminder:
        "annualRent is BASE RENT ONLY. Recoveries are in expenseReimbursements / percentageRent / " +
        "otherRent and are null when the source never disclosed them. Null means not captured — never zero.",
      vintage:
        `Every figure in this record is AS OF ${cap.asOf} (${cap.basis}) — the corpus is static, ` +
        "captured from the source document and rarely updated after. Say the as-of date when you " +
        "quote a figure, and never present it as today's rent, occupancy or value.",
    };

    // Bound the WHOLE response, not just the deal object — the audit flags, vintage note
    // and reminders are part of what the caller receives. On the real corpus the biggest
    // centre carries 126 tenants; trimming here keeps even an explicit tenantDetail:"full"
    // from flooding the context, and says exactly how to page the rest.
    if (Array.isArray(deal.tenants)) {
      const roster = deal.tenants as DealData[];
      const overhead = emittedSize({ ...response, deal: { ...deal, tenants: [] } });
      let kept = roster;
      while (kept.length > 0 && overhead + emittedSize(kept) > RESPONSE_BUDGET_BYTES) {
        kept = kept.length > 20 ? kept.slice(0, Math.floor(kept.length * 0.6)) : kept.slice(0, kept.length - 1);
      }
      if (kept.length < roster.length) {
        deal.tenants = kept;
        deal.rosterTruncated = {
          returned: kept.length,
          of: roster.length,
          advice: `This roster exceeded the ${Math.round(RESPONSE_BUDGET_BYTES / 1024)} KB response budget. ` +
            `Use search_tenants({ dealId: "${found.id}" }) to page the full roster, or filter it by name, ` +
            "anchorsOnly or an expiry window. Do NOT total the rows below and present it as the centre's rent.",
        };
      }
    }
    return response;
  },
};

// ─── 4. search_tenants ──────────────────────────────────────────────────────
const searchTenants: McpToolDef = {
  name: "search_tenants",
  title: "Search tenants across the portfolio",
  description:
    "Find every location of a tenant/brand across the whole library, with SF, rent PSF, annual " +
    "base rent, lease dates, credit rating and sales PSF. Use it to answer \"what do we pay " +
    "Starbucks elsewhere\", \"which deals have a dark anchor\", or \"what rolls in 2027\".",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Brand or tenant name (partial match)." },
      dealId: { type: "string", description: "Restrict to one deal." },
      anchorsOnly: { type: "boolean" },
      minSF: { type: "number" }, maxSF: { type: "number" },
      expiringBefore: { type: "string", description: "ISO date — leases expiring on or before this." },
      expiringAfter: { type: "string", description: "ISO date — leases expiring on or after this." },
      withSalesOnly: { type: "boolean", description: "Only tenants that reported sales PSF." },
      includeVacant: { type: "boolean", description: "Include vacant/available suites. Default false — they are empty space, not tenants, and counting them inflates roster figures." },
      limit: { type: "number", description: "Default 50, max 150." },
    },
  },
  handler: async (a) => {
    const rows = await db.select().from(tenantIndexTable);
    const name = str(a.name);
    const nameMatch = name ? brandMatcher(name) : null;
    const dealId = str(a.dealId);
    const minSF = num(a.minSF), maxSF = num(a.maxSF);
    const before = isoDateOrNull(a.expiringBefore), after = isoDateOrNull(a.expiringAfter);
    if (a.expiringBefore != null && before === null) return badDate("expiringBefore", a.expiringBefore);
    if (a.expiringAfter != null && after === null) return badDate("expiringAfter", a.expiringAfter);
    const anchorsOnly = bool(a.anchorsOnly), withSalesOnly = bool(a.withSalesOnly);
    const includeVacant = bool(a.includeVacant);

    const hit = rows.filter(t => {
      if (dealId && t.dealId !== dealId) return false;
      // Vacant suites are not tenants. Counting them inflates every roster figure built on
      // this tool, so they are out unless the caller explicitly wants the vacancy list.
      if (!includeVacant && isVacantName(t.canonicalName || t.rawName)) return false;
      if (nameMatch && !(nameMatch(t.canonicalName) || nameMatch(t.rawName))) return false;
      if (anchorsOnly && t.isAnchor !== true) return false;
      if (withSalesOnly && !t.salesPsf) return false;
      if (minSF != null && (t.sf ?? 0) < minSF) return false;
      if (maxSF != null && (t.sf ?? Infinity) > maxSF) return false;
      const exp = t.leaseExpiryDate ? String(t.leaseExpiryDate).slice(0, 10) : null;
      if (before && (!exp || exp > before)) return false;
      if (after && (!exp || exp < after)) return false;
      return true;
    });
    hit.sort((x, y) => (y.annualRent ?? 0) - (x.annualRent ?? 0));
    const limit = clampLimit(a.limit, 50, 150);
    // Totals are computed over EVERY match, not just the rows returned, so a truncated
    // response still reports the true portfolio-wide figure rather than a partial sum.
    return capRows({
      matched: hit.length,
      totalAnnualBaseRent: Math.round(hit.reduce((s, t) => s + (t.annualRent ?? 0), 0)),
      totalSF: Math.round(hit.reduce((s, t) => s + (t.sf ?? 0), 0)),
      note: "annualBaseRent is BASE RENT ONLY — recoveries are the separate fields on each row. Totals above cover ALL matches, including any rows trimmed below.",
    }, "tenants", hit.slice(0, limit).map(t => ({
        dealId: t.dealId, deal: t.dealName, dealStatus: t.dealStatus,
        tenant: t.canonicalName || t.rawName, asWritten: t.rawName,
        sf: t.sf, rentPerSF: t.rentPerSf, annualBaseRent: t.annualRent,
        leaseStart: t.leaseStartDate ? String(t.leaseStartDate).slice(0, 10) : t.leaseStart,
        leaseExpiry: t.leaseExpiryDate ? String(t.leaseExpiryDate).slice(0, 10) : t.leaseExpiry,
        leaseType: t.leaseType, creditRating: t.creditRating,
        isAnchor: t.isAnchor, isNAP: t.isNap,
        isVacantSuite: isVacantName(t.canonicalName || t.rawName) || undefined,
        salesPSF: t.salesPsf, salesYear: t.salesYear,
        expenseReimbursements: t.expenseReimbursements, percentageRent: t.percentageRent, otherRent: t.otherRent,
      })),
      "Filter by dealId, name, anchorsOnly or an expiry window to narrow the set.");
  },
};

// ─── 5. tenant_benchmarks ───────────────────────────────────────────────────
const tenantBenchmarks: McpToolDef = {
  name: "tenant_benchmarks",
  title: "Tenant rent & sales benchmarks",
  description:
    "The library's own median rent PSF, sales PSF and store size for each multi-location brand, " +
    "with the sample size, the data's year range and a confidence tier. This is how you tell " +
    "whether a rent is above or below market. Medians, never means — and remember: above-market " +
    "rent is mark-to-market DOWNSIDE, not upside.",
  inputSchema: {
    type: "object",
    properties: {
      brand: { type: "string", description: "Filter to brands matching this text." },
      minLocations: { type: "number", description: "Only brands with at least this many locations." },
      limit: { type: "number", description: "Default 60, max 400." },
    },
  },
  handler: async (a) => {
    const all = await getAllTenantBenchmarks();
    const brand = str(a.brand)?.toLowerCase();
    const minLoc = num(a.minLocations);
    const hit = all.filter(b =>
      (!brand || b.brand.toLowerCase().includes(brand)) &&
      (minLoc == null || b.locations >= minLoc));
    const limit = clampLimit(a.limit, 60, 400);
    return {
      matched: hit.length,
      benchmarks: hit.slice(0, limit),
      howToRead:
        "Compare a tenant's rentPerSF to medianRentPerSf for its brand. ABOVE the median is a " +
        "premium that may reset down at renewal (downside, unless the tenant's sales/occupancy " +
        "cost support it). BELOW the median and locked by options is sticky, secure income — " +
        "not a risk. Always state the sample size (locations) alongside any verdict.",
    };
  },
};

// ─── 6. portfolio_analytics ─────────────────────────────────────────────────
const portfolioAnalytics: McpToolDef = {
  name: "portfolio_analytics",
  title: "Portfolio rollups & lease rollover",
  description:
    "Cross-deal analytics computed from the tenant index: the lease-expiration waterfall by year " +
    "(rent rolling and its share of total), tenant concentration, anchor share, and credit mix. " +
    "Scope it to specific deals with dealIds, or leave empty for the whole library.",
  inputSchema: {
    type: "object",
    properties: {
      dealIds: { type: "array", items: { type: "string" }, description: "Restrict to these deals. Omit for all." },
      throughYear: { type: "number", description: "Only show expirations up to this year, e.g. 2032." },
    },
  },
  handler: async (a) => {
    const ids = Array.isArray(a.dealIds) ? (a.dealIds as unknown[]).map(v => str(v)).filter((v): v is string => !!v) : null;
    const rows = await db.select().from(tenantIndexTable);
    const scoped = ids && ids.length ? rows.filter(r => ids.includes(r.dealId)) : rows;
    // Vacant suites carry no rent and no roll — they'd distort every share below.
    const tenants = scoped.filter(r => r.rawName && !isVacantName(r.rawName));
    const withRent = tenants.filter(r => (r.annualRent ?? 0) > 0);
    const totalRent = withRent.reduce((s, r) => s + (r.annualRent ?? 0), 0);
    const pct = (part: number) => (totalRent > 0 ? Math.round((part / totalRent) * 1000) / 10 : 0);

    const byYear = new Map<string, { rent: number; count: number; sf: number }>();
    for (const r of withRent) {
      let year = "Unknown";
      if (r.leaseExpiryDate) { const y = String(r.leaseExpiryDate).slice(0, 4); if (/^\d{4}$/.test(y)) year = y; }
      const e = byYear.get(year) ?? { rent: 0, count: 0, sf: 0 };
      byYear.set(year, { rent: e.rent + (r.annualRent ?? 0), count: e.count + 1, sf: e.sf + (r.sf ?? 0) });
    }
    const through = num(a.throughYear);
    const leaseExpiration = [...byYear.entries()]
      .filter(([y]) => through == null || y === "Unknown" || Number(y) <= through)
      .sort(([x], [y]) => (x === "Unknown" ? 1 : y === "Unknown" ? -1 : Number(x) - Number(y)))
      .map(([year, v]) => ({ year, annualRentRolling: Math.round(v.rent), pctOfTotalRent: pct(v.rent), tenantCount: v.count, sf: Math.round(v.sf) }));

    const byTenant = new Map<string, number>();
    for (const r of withRent) {
      const n = r.canonicalName || r.rawName || "Unknown";
      byTenant.set(n, (byTenant.get(n) ?? 0) + (r.annualRent ?? 0));
    }
    const topTenants = [...byTenant.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10)
      .map(([name, rent]) => ({ name, annualRent: Math.round(rent), pctOfTotalRent: pct(rent) }));

    const anchors = withRent.filter(r => r.isAnchor === true);
    const anchorRent = anchors.reduce((s, r) => s + (r.annualRent ?? 0), 0);

    const creditMap = new Map<string, { rent: number; count: number }>();
    for (const r of withRent) {
      const label = r.creditRating === "Investment Grade" ? "Investment Grade"
        : r.creditRating === "Non-Investment Grade" ? "Non-Investment Grade" : "Unrated";
      const e = creditMap.get(label) ?? { rent: 0, count: 0 };
      creditMap.set(label, { rent: e.rent + (r.annualRent ?? 0), count: e.count + 1 });
    }

    return {
      scope: ids && ids.length ? { dealIds: ids } : { dealIds: "all" },
      summary: {
        deals: new Set(scoped.map(r => r.dealId)).size,
        tenantsWithRent: withRent.length,
        totalTenants: tenants.length,
        totalAnnualBaseRent: Math.round(totalRent),
      },
      leaseExpiration,
      tenantConcentration: {
        topTenants,
        top5PctOfRent: topTenants.slice(0, 5).reduce((s, t) => s + t.pctOfTotalRent, 0),
        anchorRent: Math.round(anchorRent),
        anchorPctOfRent: pct(anchorRent),
        anchorCount: new Set(anchors.map(r => r.canonicalName || r.rawName)).size,
      },
      creditMix: [...creditMap.entries()].map(([label, v]) => ({ label, annualRent: Math.round(v.rent), pctOfTotalRent: pct(v.rent), tenantCount: v.count })),
    };
  },
};

// ─── 7. sale_comps ──────────────────────────────────────────────────────────
const saleComps: McpToolDef = {
  name: "sale_comps",
  title: "Search the sale-comp database",
  description:
    "Retail sale comparables collected across the library. Source quality is tiered and matters: " +
    "owned (KPR's own verified trades) beats broker/manual, which beats OM-sourced (the seller " +
    "picked those, so they're the weakest). Always report medians with the sample size and date range.",
  inputSchema: {
    type: "object",
    properties: {
      state: { type: "string" },
      market: { type: "string" },
      query: { type: "string", description: "Property/center name text." },
      minSalePrice: { type: "number" }, maxCapRate: { type: "number" }, minCapRate: { type: "number" },
      sinceDate: { type: "string", description: "ISO date — only comps that traded on or after this." },
      ownedOnly: { type: "boolean", description: "KPR's own verified transactions only." },
      limit: { type: "number", description: "Default 40, max 120." },
    },
  },
  handler: async (a) => {
    const rows = await db.select().from(compsIndexTable);
    const state = str(a.state)?.toUpperCase(), market = str(a.market)?.toLowerCase(), q = str(a.query)?.toLowerCase();
    const minPrice = num(a.minSalePrice), minCap = num(a.minCapRate), maxCap = num(a.maxCapRate);
    const since = isoDateOrNull(a.sinceDate);
    if (a.sinceDate != null && since === null) return badDate("sinceDate", a.sinceDate);
    const ownedOnly = bool(a.ownedOnly);
    const r2 = rows as unknown as Array<Record<string, unknown>>;
    const hit = r2.filter(c => {
      if (state && String(c.state ?? "").toUpperCase() !== state) return false;
      if (market && !String(c.market ?? "").toLowerCase().includes(market)) return false;
      if (q && !`${c.propertyName ?? ""} ${c.address ?? ""} ${c.city ?? ""}`.toLowerCase().includes(q)) return false;
      if (ownedOnly && c.isOwnTransaction !== true) return false;
      const price = num(c.salePrice);
      if (minPrice != null && (price == null || price < minPrice)) return false;
      const cap = num(c.capRate);
      if (minCap != null && (cap == null || cap < minCap)) return false;
      if (maxCap != null && (cap == null || cap > maxCap)) return false;
      if (since) {
        const d = c.saleDate ? String(c.saleDate).slice(0, 10) : null;
        if (!d || d < since) return false;
      }
      return true;
    });
    hit.sort((x, y) => String(y.saleDate ?? "").localeCompare(String(x.saleDate ?? "")));
    const limit = clampLimit(a.limit, 40, 120);
    const tier = (c: Record<string, unknown>) => c.isOwnTransaction ? "owned" : c.isManual ? "broker/manual" : "OM-sourced";
    return {
      matched: hit.length,
      sourceMix: hit.reduce<Record<string, number>>((m, c) => { const t = tier(c); m[t] = (m[t] ?? 0) + 1; return m; }, {}),
      comps: hit.slice(0, limit).map(c => ({
        propertyName: c.propertyName ?? null, city: c.city ?? null, state: c.state ?? null, market: c.market ?? null,
        saleDate: c.saleDate ? String(c.saleDate).slice(0, 10) : null,
        salePrice: c.salePrice ?? null, sf: c.sf ?? null, pricePerSf: c.pricePerSf ?? null,
        capRate: c.capRate ?? null, occupancy: c.occupancy ?? null, anchor: c.anchor ?? null,
        propertyType: c.propertyType ?? null, sourceTier: tier(c), sourceDealId: c.dealId ?? null,
      })),
      useCompBenchmarkInstead:
        "For a verdict on what a specific deal should trade at, call comp_benchmark with its " +
        "dealId — it runs the app's deterministic engine (validity filters, tiered relaxation, " +
        "minimum sample, medians with quartiles). These raw rows are for browsing what exists, " +
        "not for deriving a number.",
      caution:
        "Never eyeball these rows into a verdict. Report medians (not means) with n and the date " +
        "range, and weight owned > broker/manual > OM-sourced.",
    };
  },
};

// ─── 8. lease_abstracts ─────────────────────────────────────────────────────
const leaseAbstracts: McpToolDef = {
  name: "lease_abstracts",
  title: "Lease abstracts",
  description:
    "Reconciled lease abstracts drawn from executed documents: term dates, rent schedule, renewal " +
    "options, co-tenancy, exclusives, kickout/termination rights, guaranties. Omit tenantName to " +
    "list what's abstracted for a deal; pass it to read one abstract in full. Any field marked " +
    "verifiedAgainstExecutedDoc:false is UNVERIFIED — say so rather than stating it as fact.",
  inputSchema: {
    type: "object",
    properties: {
      dealId: { type: "string", description: "Deal to look in." },
      tenantName: { type: "string", description: "Tenant whose abstract to read in full." },
      listAll: { type: "boolean", description: "List every abstract in the library." },
    },
  },
  handler: async (a) => {
    const dealId = str(a.dealId), tenantName = str(a.tenantName);
    if (bool(a.listAll) || (!dealId && !tenantName)) {
      const rows = await db.select({
        id: leaseAbstractsTable.id, dealId: leaseAbstractsTable.dealId,
        tenantName: leaseAbstractsTable.tenantName, updatedAt: leaseAbstractsTable.updatedAt,
      }).from(leaseAbstractsTable).orderBy(desc(leaseAbstractsTable.updatedAt)).limit(500);
      return { count: rows.length, abstracts: rows.map(r => ({ ...r, updatedAt: r.updatedAt.toISOString() })) };
    }
    const rows = await db.select().from(leaseAbstractsTable)
      .where(dealId ? eq(leaseAbstractsTable.dealId, dealId) : isNotNull(leaseAbstractsTable.id));
    if (!tenantName) {
      return {
        dealId,
        count: rows.length,
        abstracts: rows.map(r => ({ id: r.id, tenantName: r.tenantName, version: r.version, updatedAt: r.updatedAt.toISOString() })),
      };
    }
    const lower = tenantName.toLowerCase();
    const match = rows.filter(r => r.tenantName.toLowerCase().includes(lower));
    if (!match.length) return { error: "not_found", message: `No abstract for "${tenantName}"${dealId ? ` on deal ${dealId}` : ""}.` };
    return {
      count: match.length,
      abstracts: match.map(r => ({ id: r.id, dealId: r.dealId, tenantName: r.tenantName, version: r.version, updatedAt: r.updatedAt.toISOString(), abstract: r.data })),
      reminder:
        "Executed documents govern. The rent roll and any draft abstract are cross-checks, never " +
        "sources. Surface every mid-term tenant lever (co-tenancy, kickout, go-dark, early " +
        "termination, ROFR/ROFO) prominently — with its exact trigger, remedy and notice window.",
    };
  },
};

// ─── 9. data_quality ────────────────────────────────────────────────────────
const dataQuality: McpToolDef = {
  name: "data_quality",
  title: "Data-integrity audit",
  description:
    "The library's deterministic tie-out audit — arithmetic contradictions like roster SF vs " +
    "building GLA, stated vs implied occupancy, NOI ÷ cap vs price, EGI − OpEx vs NOI, and " +
    "co-tenancy structure errors. Pass a dealId for one deal, or omit it for the portfolio-wide " +
    "trend grouped by issue type. Use this before trusting a number that looks surprising.",
  inputSchema: {
    type: "object",
    properties: {
      dealId: { type: "string", description: "One deal. Omit for the whole portfolio." },
      limit: { type: "number", description: "Portfolio mode: max issue groups. Default 25." },
    },
  },
  handler: async (a) => {
    const dealId = str(a.dealId);
    const rows = await db.select().from(dealsTable);
    if (dealId) {
      const row = rows.find(r => r.id === dealId);
      if (!row) return { error: "not_found", message: `No deal with id "${dealId}".` };
      const d = row.data as DealData;

      // Mirror the portfolio summary exactly. Previously this ran only the fresh
      // deterministic audit, so the two modes of the same tool disagreed: the portfolio
      // view named a deal as having an open issue and then asking about that deal returned
      // "0 issues". Airport Square had two unresolved captures — a WALT and an address
      // conflict from a re-uploaded OM — and the per-deal view showed a clean bill.
      const stored = Array.isArray(d.reviewQuestions) ? (d.reviewQuestions as DealData[]) : [];
      const resolvedIds = new Set(stored.filter(q => q?.resolvedAt).map(q => String(q?.id ?? "")));
      const fresh = auditExtraction(d).filter(q => !resolvedIds.has(q.id));
      const captures = stored.filter(q => {
        if (q?.resolvedAt || !q?.question) return false;
        const id = String(q?.id ?? "");
        // audit-* are recomputed fresh above; anomaly-* are a client-side computation.
        return !id.startsWith("audit-") && !id.startsWith("src-") && !id.startsWith("anomaly-");
      });
      const sevOf = (v: unknown) => (v === "high" || v === "medium" || v === "low" ? v : "medium");
      const all = [
        ...fresh.map(f => ({
          source: "deterministic tie-out (recomputed now)",
          check: AUDIT_CHECK_LABELS[auditCheckKey(f.id)] || f.field,
          severity: f.severity, field: f.field, detail: f.question,
        })),
        ...captures.map(q => ({
          source: "stored capture awaiting review",
          check: String(q.field ?? "Captured value"),
          severity: sevOf(q.severity), field: String(q.field ?? ""), detail: String(q.question ?? ""),
        })),
      ];
      return {
        dealId, propertyName: nameOf(d),
        issueCount: all.length,
        high: all.filter(f => f.severity === "high").length,
        breakdown: { deterministicTieOuts: fresh.length, storedCaptures: captures.length },
        issues: all,
        note: all.length === 0
          ? "No open issues: the arithmetic tie-outs pass and nothing is awaiting review."
          : "Two kinds of finding here. A DETERMINISTIC TIE-OUT is arithmetic that contradicts " +
            "itself and is recomputed on every call — treat it as fact. A STORED CAPTURE is a " +
            "question raised at import that nobody has answered yet, so it may already be stale.",
      };
    }
    const summary = summarizePortfolioIssues(rows.map(r => ({ id: r.id, data: r.data as DealData })));
    const limit = clampLimit(a.limit, 25, 100);
    return {
      scanned: summary.scanned,
      dealsWithIssues: summary.dealsWithIssues,
      totalOpen: summary.totalOpen,
      groups: summary.groups.slice(0, limit).map(g => ({
        issue: g.label, key: g.key, kind: g.kind, severity: g.severity,
        occurrences: g.count, dealsAffected: g.dealCount,
        example: g.sample,
        deals: g.deals.slice(0, 10),
      })),
    };
  },
};

// ─── 10. get_knowledge ──────────────────────────────────────────────────────
const getKnowledge: McpToolDef = {
  name: "get_knowledge",
  title: "KPR analyst playbook & house view",
  description:
    "READ THIS BEFORE ANALYZING ANYTHING. The standing rules that make an analysis KPR's " +
    "analysis: field conventions, the above-market/below-market rent doctrine, demographics ↔ " +
    "cap-rate logic, cinema per-screen math, co-tenancy trigger fidelity, comp discipline — plus " +
    "the live House View distilled from KPR's own deal reviews and the operator-taught rules Eric " +
    "has recorded from real corrections.",
  inputSchema: {
    type: "object",
    properties: {
      section: { type: "string", enum: ["all", "playbook", "house_view", "operator_lessons"], description: "Default: all." },
    },
  },
  handler: async (a) => {
    const section = str(a.section) ?? "all";
    if (section === "playbook") return { markdown: KPR_PLAYBOOK };
    const pack = await buildKnowledgePack({
      getHouseView: async () => {
        const hv = await getHouseView();
        return { content: hv.content, sourceCount: hv.sourceCount, lastDistilledAt: hv.lastDistilledAt };
      },
      getActiveLessons: async (scope) => getActiveLessons(scope),
    });
    if (section === "house_view") return { houseView: pack.houseView };
    if (section === "operator_lessons") return { operatorLessons: pack.operatorLessons };
    return { markdown: renderKnowledgePack(pack), operatorLessonCount: pack.operatorLessons.length };
  },
};


// ─── 11. brand_lease_terms ──────────────────────────────────────────────────
// The "does this lease look off?" tool. Someone is holding ONE lease for a brand and
// wants to know how its terms sit against every other lease this library holds for
// that same brand — rent, size, term length, option structure, and the mid-term
// levers (co-tenancy, kickout, go-dark, exclusive, ROFR). Answering that from
// search_tenants + lease_abstracts separately means the caller has to do the
// gathering and the arithmetic; this does both and returns the comparison set.
const brandLeaseTerms: McpToolDef = {
  name: "brand_lease_terms",
  title: "Compare a brand's lease terms across the library",
  description:
    "THE TOOL FOR REVIEWING ONE LEASE AGAINST PRECEDENT. Given a brand (\"PetSmart\", " +
    "\"Ulta\", \"Five Below\"), returns every lease this library holds for that brand — rent " +
    "PSF, size, term dates and length, option structure, reimbursement method, sales — plus " +
    "the medians and quartiles across those locations, and how often each mid-term tenant " +
    "lever appears (co-tenancy, sales kickout, go-dark, exclusive use, ROFR/ROFO, early " +
    "termination). Use it whenever someone hands you a lease, an LOI or a proposed term and " +
    "asks whether anything looks off, unusual, aggressive or off-market.",
  inputSchema: {
    type: "object",
    properties: {
      brand: { type: "string", description: "Tenant/brand name, e.g. \"PetSmart\". Partial match." },
      includeAbstracts: { type: "boolean", description: "Include the full executed-document lease abstracts. Default true." },
      limit: { type: "number", description: "Max locations returned. Default 15, max 60. The medians always cover EVERY match regardless of this." },
    },
    required: ["brand"],
  },
  handler: async (a) => {
    const brand = str(a.brand);
    if (!brand) return { error: "brand_required", message: "Pass a brand name, e.g. { brand: \"PetSmart\" }." };
    // A one- or two-character "brand" is a typo or a fragment, not a tenant. Left
    // unguarded it matched thousands of unrelated rows and returned a confident median
    // across all of them.
    if (brand.replace(/[^a-z0-9]/gi, "").length < 3) {
      return { error: "brand_too_short", message: `"${brand}" is too short to identify a tenant. Pass the brand as you'd say it — "Ross", "Five Below", "Dollar Tree".` };
    }
    if (isVacantName(brand)) {
      return { error: "not_a_brand", message: `"${brand}" describes EMPTY SPACE, not a tenant, so a rent benchmark over it is meaningless. For vacancy use search_tenants with includeVacant:true, or read occupancy off the deal.` };
    }
    const matches = brandMatcher(brand);
    const withAbstracts = bool(a.includeAbstracts, true);
    const limit = clampLimit(a.limit, 15, 60);

    const [deals, abstractRows] = await Promise.all([
      loadActiveDeals(),
      db.select().from(leaseAbstractsTable),
    ]);

    // Executed-document abstracts, keyed by deal + tenant. These OUTRANK the roster
    // for clause detail — the roster's lease-risk block is an OM read, the abstract
    // is reconciled from the signed documents.
    const absByDeal = new Map<string, Array<{ tenantName: string; data: DealData }>>();
    for (const r of abstractRows) {
      if (!matches(r.tenantName)) continue;
      const list = absByDeal.get(r.dealId) ?? [];
      list.push({ tenantName: r.tenantName, data: r.data as DealData });
      absByDeal.set(r.dealId, list);
    }

    interface Loc {
      dealId: string; deal: string; city: unknown; state: unknown; centerType: unknown; dealStatus: unknown;
      tenant: string; sf: number | null; rentPerSF: number | null; annualBaseRent: number | null;
      leaseStart: unknown; leaseExpiry: unknown; termYears: number | null; remainingTermYears: unknown;
      leaseType: unknown; reimbursementMethod: unknown; rentBumps: unknown; rentSchedule: unknown;
      renewalOptions: unknown; salesPSF: unknown; salesYear: unknown; occupancyCost: unknown;
      creditRating: unknown; isAnchor: unknown; isDark: unknown;
      levers: Record<string, string | boolean>;
      capturedAsOf: string;
      abstract?: DealData; abstractTenantName?: string;
      authority?: string;
    }
    const locations: Loc[] = [];

    for (const r of deals) {
      const d = r.data;
      const tenants = Array.isArray(d.tenants) ? (d.tenants as DealData[]) : [];
      // Deal-level lease-risk block (OM-sourced), indexed by tenant name.
      const riskRows = (() => {
        const lr = d.leaseRisk as DealData | undefined;
        const rows = lr && Array.isArray(lr.tenants) ? (lr.tenants as DealData[]) : [];
        return rows;
      })();
      for (const t of tenants) {
        const tname = String(t?.name ?? "");
        if (!matches(tname)) continue;
        if (isVacantName(tname)) continue;   // an empty suite is not a lease comparable
        const start = str(t.leaseStart), end = str(t.leaseExpiry);
        const termYears = start && end
          ? Math.round(((Date.parse(end) - Date.parse(start)) / 31557600000) * 10) / 10
          : null;
        const risk = riskRows.find(rr => String(rr?.tenant ?? "").toLowerCase() === tname.toLowerCase());
        const abs = (absByDeal.get(r.id) ?? []).find(x => brandBaseName(x.tenantName) === brandBaseName(tname)
          || brandMatcher(x.tenantName)(tname) || matches(x.tenantName));

        // Levers, preferring the executed abstract over the OM read. A value of
        // "unknown" is NOT "none" — it means nothing in this library says either way,
        // and the caller must not read silence as an absent clause.
        const other = (abs?.data.otherRiskClauses ?? risk?.otherRiskClauses) as DealData | undefined;
        const coTen = (abs?.data.coTenancy ?? risk?.coTenancy) as unknown[] | undefined;
        const kick = (abs?.data.salesKickout ?? risk?.salesKickout) as unknown[] | undefined;
        const hasClause = (v: unknown): string | boolean => {
          if (v === undefined || v === null) return "unknown";
          if (Array.isArray(v)) return v.length > 0;
          const note = v as DealData;
          if (note.present === true) return true;
          if (note.present === false) return false;
          return "unknown";
        };
        const levers: Record<string, string | boolean> = {
          coTenancy: hasClause(coTen),
          salesKickout: hasClause(kick),
          goDark: hasClause(other?.goDarkRight),
          exclusiveUse: hasClause(other?.exclusiveUse ?? (Array.isArray(abs?.data.exclusives) ? abs?.data.exclusives : undefined)),
          rofrRofo: hasClause(other?.rofrRofo),
          earlyTermination: hasClause(other?.earlyTerminationOption),
          continuousOperation: hasClause(other?.continuousOperationCovenant),
          source: abs ? "executed lease abstract" : risk ? "OM read (unverified)" : "not captured",
        };

        locations.push({
          dealId: r.id, deal: nameOf(d), city: d.city ?? null, state: d.state ?? null,
          centerType: d.centerType ?? d.assetType ?? null, dealStatus: d.status ?? null,
          tenant: tname, sf: num(t.sf), rentPerSF: num(t.rentPerSF), annualBaseRent: num(t.annualRent),
          leaseStart: start, leaseExpiry: end, termYears,
          remainingTermYears: t.remainingTermYears ?? null,
          leaseType: t.leaseType ?? null, reimbursementMethod: t.reimbursementMethod ?? null,
          rentBumps: t.rentBumps ?? null, rentSchedule: t.rentSchedule ?? null,
          renewalOptions: t.renewalOptions ?? null,
          salesPSF: t.salesPSF ?? null, salesYear: t.salesYear ?? null, occupancyCost: t.occupancyCost ?? null,
          creditRating: t.creditRating ?? null, isAnchor: t.isAnchor ?? null, isDark: t.isDark ?? null,
          levers,
          capturedAsOf: capturedAt(d, r.updatedAt).asOf,
          ...(withAbstracts && abs ? { abstract: abs.data, abstractTenantName: abs.tenantName } : {}),
          ...(authorityFor(d) ? { authority: OWNED_AUTHORITY_NOTE } : {}),
        });
      }
    }

    if (!locations.length) {
      return {
        brand,
        matched: 0,
        message: `No leases for "${brand}" in this library. Check the spelling, or use search_tenants to see what brands are present.`,
      };
    }

    // Is this actually ONE tenant? "Dollar" legitimately matches Dollar Tree, Dollar General
    // AND Family Dollar — three brands with different rent profiles — so a single median
    // across them describes nothing real.
    //
    // Counting distinct names is too crude: "Starbucks", "Starbucks Coffee" and
    // "Starbucks - NAP" are three names for one tenant and flagging them as mixed cries
    // wolf. So names are first collapsed into FAMILIES by prefix — where one base name
    // begins with another, they are the same tenant written differently. What survives is
    // genuinely distinct: "dollar tree" and "dollar general" share no prefix relationship.
    const bases = new Map<string, number>();
    for (const l of locations) {
      const b = brandBaseName(l.tenant);
      if (b) bases.set(b, (bases.get(b) ?? 0) + 1);
    }
    const sortedBases = [...bases.entries()].sort((x, y) => x[0].length - y[0].length);
    const families = new Map<string, number>();
    for (const [nm, count] of sortedBases) {
      const parent = [...families.keys()].find(f => nm === f || nm.startsWith(`${f} `));
      const key = parent ?? nm;
      families.set(key, (families.get(key) ?? 0) + count);
    }
    const fam = [...families.entries()].sort((x, y) => y[1] - x[1]);
    const mixedBrands = fam.length > 1
      ? {
          distinctTenants: fam.length,
          breakdown: fam.slice(0, 8).map(([n, c]) => ({ tenant: n, locations: c })),
          warning:
            `"${brand}" matched ${fam.length} DIFFERENT tenants, not one — see breakdown. The ` +
            "medians below blend all of them, so they describe no single brand. Re-run with the " +
            "full brand name (the largest group is usually what you meant), or read this as a " +
            "list rather than a benchmark.",
        }
      : null;

    locations.sort((x, y) => String(y.leaseStart ?? "").localeCompare(String(x.leaseStart ?? "")));

    const leverKeys = ["coTenancy", "salesKickout", "goDark", "exclusiveUse", "rofrRofo", "earlyTermination", "continuousOperation"] as const;
    const leverPrevalence: Record<string, { present: number; absent: number; unknown: number }> = {};
    for (const k of leverKeys) {
      const vals = locations.map(l => l.levers[k]);
      leverPrevalence[k] = {
        present: vals.filter(v => v === true).length,
        absent: vals.filter(v => v === false).length,
        unknown: vals.filter(v => v === "unknown").length,
      };
    }

    const nowYear = new Date().getFullYear();
    const captureYears = locations.map(l => yearOf(l.capturedAsOf)).filter((y): y is number => y != null);
    const startYears = locations.map(l => yearOf(str(l.leaseStart))).filter((y): y is number => y != null);
    // Two different clocks, and they mean different things:
    //  • CAPTURE year ages the NUMBER — the rent shown was true as of capture.
    //  • COMMENCEMENT year ages the DEAL — when these economics were actually negotiated.
    // The weighting runs off capture (the vintage of the figure); commencement is reported
    // separately because a lease struck 15 years ago is legacy rent, not a market signal,
    // however recently we happened to record it.
    const struckWithinHorizon = startYears.filter(y => nowYear - y < RECENCY_HORIZON_YEARS).length;
    const datedByCommencement = locations.filter(l => yearOf(str(l.leaseStart)) != null).length;
    const vintage = {
      horizonYears: RECENCY_HORIZON_YEARS,
      weightedBy: "lease commencement — when the economics were struck, not when the document was read",
      leasesDatedByCommencement: `${datedByCommencement} of ${locations.length} (the rest fall back to capture date)`,
      capturedBetween: captureYears.length ? [Math.min(...captureYears), Math.max(...captureYears)] : null,
      leasesCommencedBetween: startYears.length ? [Math.min(...startYears), Math.max(...startYears)] : null,
      leasesStruckWithinHorizon: struckWithinHorizon,
      leasesStruckBeforeHorizon: startYears.length - struckWithinHorizon,
      warning:
        "Medians here are RECENCY-WEIGHTED BY LEASE COMMENCEMENT — a lease's influence fades " +
        `linearly to zero over ${RECENCY_HORIZON_YEARS} years from the date its economics were ` +
        "STRUCK, not from when the document was read. A 2010 lease sitting inside a 2026 offering " +
        "memorandum is a 2010 rent and is weighted as such. \`median\` is the market as this corpus " +
        "currently sees it; \`unweightedMedian\` treats every lease equally regardless of age. When " +
        "the two diverge materially, rents have MOVED — say so rather than quoting one figure. " +
        "CAVEAT: amendments and exercised options RESET a lease's economics, giving it a later " +
        "effective vintage than its original commencement, and the roster does not reliably record " +
        "when that happened — so an old lease showing recent rent steps may be fresher than its " +
        "commencement date implies. Note it rather than over-claiming. For a KPR-owned location " +
        "take the current figure from Datex instead of any of this.",
    };

    // The vintage of a LEASE is when its economics were struck, not when we read the
    // document. A 2010 lease inside a 2026 offering memorandum is a 2010 rent. Fall back
    // to the capture date only where commencement was never recorded.
    const vintageOf = (l: Loc): number | null => yearOf(str(l.leaseStart)) ?? yearOf(l.capturedAsOf);
    const withYear = (pick: (l: Loc) => number | null | undefined) =>
      locations
        .map(l => ({ value: num(pick(l)) as number, year: vintageOf(l) }))
        .filter(e => e.value != null && Number.isFinite(e.value) && e.value > 0);

    const head: Record<string, unknown> = {
      brand,
      matched: locations.length,
      vintage,
      comparison: {
        rentPerSF: weightedSpread(withYear(l => l.rentPerSF), nowYear),
        sf: weightedSpread(withYear(l => l.sf), nowYear),
        originalTermYears: weightedSpread(withYear(l => l.termYears), nowYear),
        salesPSF: weightedSpread(withYear(l => num(l.salesPSF)), nowYear),
      },
      leverPrevalence,
      alsoCheckDatex:
        "If KPR OWNS any location of this brand, run the same question against Datex and CITE " +
        "BOTH, separately labelled: what KPR achieves as a landlord on its own properties " +
        "(Datex, current) versus what the broader market shows across every deal reviewed (this " +
        "corpus, as-of each capture date). They answer different questions, and the GAP between " +
        "them is itself the finding — whether KPR is outperforming or paying up. Do not merge " +
        "them into one number.",
      statsCoverAllMatches:
        "The medians, bands and leverPrevalence above are computed over ALL " +
        "matching locations. Only the per-location rows below can be trimmed for size, so " +
        "a truncated response still carries a true benchmark.",
      howToUse:
        "Compare the lease in front of you to the recency-weighted MEDIAN and the p25–p75 band, " +
        "and say how many locations the band is built from AND how many of those fall inside the " +
        `${RECENCY_HORIZON_YEARS}-year horizon (nWithinHorizon). A two-location median is an ` +
        "anecdote, not a benchmark; a median resting entirely on stale captures is history, not " +
        "market — say which you are quoting. A rent above the band is a premium to interrogate (mark-to-market DOWNSIDE " +
        "unless the store's sales or a low occupancy cost support it), never 'upside'. Below the " +
        "band with locked options is secure, sticky income, not a risk. On the levers: `false` " +
        "means the source says the clause is absent, `unknown` means nothing here says either " +
        "way — never report `unknown` as 'no such clause'. Where a lever comes from an OM read " +
        "rather than an executed abstract, say it is unverified.",
    };

    if (mixedBrands) head.mixedBrandWarning = mixedBrands;
    return capRows(head, "locations", locations.slice(0, limit),
      "Lower `limit`, or filter to the deals you care about with search_tenants({name, dealId}).");
  },
};


// ─── 12. data_coverage ──────────────────────────────────────────────────────
// How much of the library actually HAS each field. This is the guardrail against the
// most seductive failure mode of a database this size: building a confident argument
// on a field that only a handful of deals carry. A median is not a benchmark when
// n=3, and a "portfolio trend" over 8% coverage is an anecdote. Rather than leave a
// client to discover that by accident, the library states its own density.
const dataCoverage: McpToolDef = {
  name: "data_coverage",
  title: "How complete is the data?",
  description:
    "CALL THIS BEFORE MAKING A PORTFOLIO-WIDE CLAIM. Reports what share of deals and " +
    "tenants actually carry each field — pricing, financials, sales, demographics, lease " +
    "structure, abstracts — so you know whether an analysis is well-supported or resting on " +
    "a handful of records. Sparse coverage is usually a fact about how retail is marketed, " +
    "not a bug: cap rate and price are genuinely absent on most offering memoranda.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "Restrict to one pipeline status, e.g. \"Owned\" or \"Passed\"." },
    },
  },
  handler: async (a) => {
    const wanted = str(a.status)?.toLowerCase();
    const all = await loadActiveDeals();
    const deals = wanted ? all.filter(r => String(r.data.status ?? "").toLowerCase() === wanted) : all;
    if (!deals.length) return { error: "no_deals", message: wanted ? `No active deals with status "${str(a.status)}".` : "The library has no active deals." };

    const has = (d: DealData, k: string) => {
      const v = d[k];
      if (v === null || v === undefined || v === "") return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === "number") return Number.isFinite(v);
      if (typeof v === "object") return Object.keys(v as object).length > 0;
      return true;
    };
    const pctOf = (n: number, total: number) => Math.round((n / total) * 1000) / 10;
    const dealField = (label: string, key: string) => {
      const n = deals.filter(r => has(r.data, key)).length;
      return { field: label, deals: n, pct: pctOf(n, deals.length) };
    };

    // Tenant-level density is measured against tenant ROWS, not deals — a brand-level
    // claim lives or dies on how many individual leases carry the field.
    const tenantRows: DealData[] = [];
    for (const r of deals) {
      const ts = Array.isArray(r.data.tenants) ? (r.data.tenants as DealData[]) : [];
      for (const t of ts) if (!isVacantName(t?.name)) tenantRows.push(t);
    }
    const tenantField = (label: string, key: string) => {
      const n = tenantRows.filter(t => has(t, key)).length;
      return { field: label, tenants: n, pct: tenantRows.length ? pctOf(n, tenantRows.length) : 0 };
    };

    const abstractRows = await db.select({ dealId: leaseAbstractsTable.dealId, tenantName: leaseAbstractsTable.tenantName }).from(leaseAbstractsTable);
    const abstractedDeals = new Set(abstractRows.map(r => r.dealId).filter(id => deals.some(d => d.id === id)));
    const leaseRiskDeals = deals.filter(r => {
      const lr = r.data.leaseRisk as DealData | undefined;
      return !!lr && Array.isArray(lr.tenants) && (lr.tenants as unknown[]).length > 0;
    }).length;

    const thin = (pct: number) => pct < 25;
    const coverage = {
      headlineMetrics: [
        dealField("Total GLA", "totalSF"), dealField("Occupancy", "occupancy"),
        dealField("WALT", "walt"), dealField("Weighted-avg rent PSF", "weightedAvgRentPSF"),
        dealField("Tenant roster", "tenants"),
      ],
      pricing: [
        dealField("Cap rate", "capRate"), dealField("Asking price", "askingPrice"),
        dealField("NOI", "noi"), dealField("Gross potential rent", "grossPotentialRent"),
        dealField("Effective gross income", "effectiveGrossIncome"), dealField("Operating expenses", "operatingExpenses"),
        dealField("Cash-flow projection", "cashFlowProjection"),
      ],
      tradeArea: [
        dealField("Population (3mi)", "population3mi"), dealField("Avg HH income (3mi)", "avgHHIncome3mi"),
        dealField("Traffic count", "trafficCountVPD"),
      ],
      analysis: [
        dealField("Underwriting narrative", "notes"), dealField("Deal score", "dealScore"),
        dealField("Red flags", "redFlags"), dealField("Upside items", "upsideItems"),
        dealField("Key assumptions", "keyAssumptions"), dealField("OM comparable sales", "comparableSales"),
        dealField("Tenant sales history", "tenantSalesHistory"),
      ],
      leaseStructure: [
        { field: "Structured lease-risk capture (co-tenancy / kickout from the OM)", deals: leaseRiskDeals, pct: pctOf(leaseRiskDeals, deals.length) },
        { field: "Executed lease abstracts", deals: abstractedDeals.size, pct: pctOf(abstractedDeals.size, deals.length) },
      ],
      tenantLevel: [
        tenantField("SF", "sf"), tenantField("Rent PSF", "rentPerSF"), tenantField("Annual base rent", "annualRent"),
        tenantField("Lease expiry", "leaseExpiry"), tenantField("Lease start", "leaseStart"),
        tenantField("Renewal options", "renewalOptions"), tenantField("Rent bumps", "rentBumps"),
        tenantField("Sales PSF", "salesPSF"), tenantField("Occupancy cost", "occupancyCost"),
        tenantField("Credit rating", "creditRating"), tenantField("Reimbursement method", "reimbursementMethod"),
        tenantField("Expense reimbursements ($)", "expenseReimbursements"),
      ],
    };

    const sparse = [
      ...coverage.pricing, ...coverage.tradeArea, ...coverage.leaseStructure,
    ].filter(f => thin(f.pct)).map(f => f.field);

    // COVERAGE BY VINTAGE. Raw field coverage says whether the corpus can answer a
    // question at all; this says whether it can answer it about TODAY. A brand with 40
    // captured leases, all from 2013, supports a historical claim and not a market one.
    const nowYear = new Date().getFullYear();
    const buckets = [
      { label: "0-3 years (current market)", min: 0, max: 3 },
      { label: "4-6 years", min: 4, max: 6 },
      { label: `7-${RECENCY_HORIZON_YEARS - 1} years (fading)`, min: 7, max: RECENCY_HORIZON_YEARS - 1 },
      { label: `${RECENCY_HORIZON_YEARS}+ years (stale — zero weight)`, min: RECENCY_HORIZON_YEARS, max: Infinity },
    ];
    const ages = deals.map(r => {
      const y = yearOf(capturedAt(r.data, r.updatedAt).asOf);
      // Clamp at 0: a forward-dated record has a NEGATIVE age, which fell through every
      // bucket and silently vanished from the totals — on production 46 of 301 deals were
      // missing from the vintage breakdown for exactly this reason. Treat "captured in the
      // future" as "captured today" for bucketing.
      return y == null ? null : Math.max(0, nowYear - y);
    });
    const byVintage = buckets.map(b => {
      const n = ages.filter(a => a != null && a >= b.min && a <= b.max).length;
      return { bucket: b.label, deals: n, pct: pctOf(n, deals.length) };
    });
    const unknownVintage = ages.filter(a => a == null).length;
    const freshPct = pctOf(ages.filter(a => a != null && a < RECENCY_HORIZON_YEARS).length, deals.length);

    return {
      scope: wanted ? { status: str(a.status) } : { status: "all active deals" },
      dealsScanned: deals.length,
      tenantRowsScanned: tenantRows.length,
      abstractsInLibrary: abstractRows.length,
      coverage,
      thinlyCovered: sparse,
      vintage: {
        horizonYears: RECENCY_HORIZON_YEARS,
        byVintage,
        unknownVintage,
        pctWithinHorizon: freshPct,
        note:
          `${freshPct}% of these deals were captured within the last ${RECENCY_HORIZON_YEARS} ` +
          "years. Field coverage tells you whether the corpus can answer a question at all; this " +
          "tells you whether it can answer it about TODAY'S market. A brand well covered but " +
          "captured mostly before the horizon supports a historical claim, not a market one — " +
          "say which you are making.",
      },
      howToUse:
        "Treat anything under ~25% coverage as ANECDOTAL: quote it per-deal, never as a " +
        "portfolio finding, and say how many records it rests on. Missing pricing is expected " +
        "(retail is often marketed unpriced) and is not a data-quality problem. Sparse sales " +
        "coverage is the one that most often misleads — without sales you cannot judge whether " +
        "an above-market rent is supported, so flag it to verify rather than assuming either way.",
    };
  },
};


// ─── 13. comp_benchmark ─────────────────────────────────────────────────────
// The cardinal comp rule in CLAUDE.md: "the APP computes all comp stats in code; Claude
// only NARRATES the structured output." sale_comps hands over raw rows, which quietly
// invites exactly the eyeballing that rule forbids. computeBenchmark is the engine that
// rule refers to — validity filters, tiered relaxation, a minimum sample, medians with
// quartiles — and it was sitting unexposed. This wires it up so the arithmetic happens
// in code and the caller is left with nothing to derive.
const compBenchmarkTool: McpToolDef = {
  name: "comp_benchmark",
  title: "Deterministic sale-comp benchmark for a deal",
  description:
    "THE way to answer \"what does this trade at\" — never eyeball sale_comps rows instead. " +
    "Runs the app's own comp engine for one deal: validity filters, tiered relaxation until " +
    "it finds a usable sample, then MEDIANS with p25/p75 for cap rate and price PSF, the " +
    "sample size, the date range, and the source mix (owned > broker > OM-sourced). Also " +
    "returns how far the subject's own cap rate and PSF sit from the set. When the sample is " +
    "too thin it says so — report that, never a substitute number.",
  inputSchema: {
    type: "object",
    properties: {
      dealId: { type: "string", description: "Deal to benchmark. Preferred." },
      propertyName: { type: "string", description: "Property name, if you don't have the id." },
      excludeOmComps: { type: "boolean", description: "Drop seller-supplied OM comps (the weakest tier). Default false." },
      includeCompRows: { type: "boolean", description: "Return the matched comps themselves. Default false — the statistics are the answer." },
    },
  },
  handler: async (a) => {
    const deals = await loadActiveDeals();
    const id = str(a.dealId), name = str(a.propertyName);
    let found: DealRecord | undefined;
    if (id) found = deals.find(r => r.id === id);
    if (!found && name) {
      const lower = name.toLowerCase();
      const hits = deals.filter(r => nameOf(r.data).toLowerCase().includes(lower));
      if (hits.length === 1) found = hits[0];
      else if (hits.length > 1) {
        return { error: "ambiguous_property_name", message: `"${name}" matches ${hits.length} deals — pass a dealId.`, candidates: hits.slice(0, 20).map(dealSummary) };
      }
    }
    if (!found) return { error: "not_found", message: "Pass a dealId from search_deals, or an unambiguous propertyName." };

    const d = found.data;
    const anchors = (Array.isArray(d.tenants) ? (d.tenants as DealData[]) : [])
      .filter(t => t.isAnchor).map(t => String(t.name ?? "")).filter(Boolean);
    const sf = num(d.totalSF);
    const price = num(d.askingPrice);
    const { computeBenchmark } = await import("./compBenchmark");
    const r = await computeBenchmark({
      dealId: found.id,
      market: str(d.market), state: str(d.state),
      propertyType: str(d.centerType) || str(d.assetType),
      sf, capRate: num(d.capRate),
      pricePerSf: price != null && sf ? Math.round((price / sf) * 100) / 100 : null,
      occupancy: num(d.occupancy),
      anchor: anchors.length ? anchors.join(", ") : null,
      anchorIG: (Array.isArray(d.tenants) ? (d.tenants as DealData[]) : [])
        .some(t => t.isAnchor && t.creditRating === "Investment Grade"),
      excludeOmComps: bool(a.excludeOmComps),
      excludeCompIds: [], includeCompIds: [], starCompIds: [], manual: null,
    });

    const out: Record<string, unknown> = {
      deal: { dealId: found.id, propertyName: nameOf(d), state: d.state ?? null, market: d.market ?? null, centerType: d.centerType ?? d.assetType ?? null, totalSF: sf },
      subject: r.subject,
      insufficient: r.insufficient,
      n: r.n,
      tier: r.tierLabel,
      relaxedBy: r.relaxed,
      dateRange: r.dateRange,
      sourceMix: r.sourceMix,
      excludedAsInvalid: r.excludedInvalid,
      // SUPPRESS THE STATISTICS WHEN THE SAMPLE IS TOO THIN. The engine still computes a
      // "median" from one or two comps — on the real corpus it returned a median cap rate
      // of 11.1% off a single trade. A figure like that reads as authoritative precision
      // and is exactly the fabricated-looking number the cardinal comp rule exists to
      // prevent. Below the minimum sample the honest output is nothing, not a number with
      // a warning attached to it, because the warning is what gets dropped in the retelling.
      capRate: r.insufficient ? null : r.capRate,
      pricePerSf: r.insufficient ? null : r.pricePerSf,
      last12Months: r.insufficient ? null : r.last12,
      subjectVsSet: r.insufficient ? null : { capDeltaBps: r.capDeltaBps, psfDeltaPct: r.psfDeltaPct },
      ...(r.insufficient ? {
        suppressed:
          `Cap-rate and price-PSF statistics are withheld: ${r.n} comp${r.n === 1 ? "" : "s"} is ` +
          "below the minimum sample this engine will report on. A median over one or two trades " +
          "is an anecdote wearing the clothes of a benchmark.",
      } : {}),
      ...(bool(a.includeCompRows) ? { comps: r.comps } : { compRowCount: r.comps.length }),
      howToReport: r.insufficient
        ? `INSUFFICIENT SAMPLE — only ${r.n} valid comp${r.n === 1 ? "" : "s"} could be assembled, ` +
          "even after relaxing the filters, so the statistics are withheld above. Say plainly " +
          "that the library cannot benchmark this deal yet, and say how many comps it found. Do " +
          "NOT substitute a figure from sale_comps, from the OM's own comp page, or from general " +
          "market knowledge and present it as this library's benchmark. If the caller needs a " +
          "number, the answer is that more comps have to go into the database first."
        : "Report the MEDIAN with n and the date range, every time — never a mean, never a " +
          "figure you derived yourself. Name the tier and anything it relaxed to reach the " +
          "sample, and weight the source mix: owned (KPR's verified trades) > broker/manual > " +
          "OM-sourced (seller-selected, the weakest). capDeltaBps and psfDeltaPct are the " +
          "subject against the set — a wide gap is the finding worth explaining.",
    };
    return out;
  },
};

export const MCP_TOOLS: McpToolDef[] = [
  libraryOverview,
  getKnowledge,
  searchDeals,
  getDeal,
  searchTenants,
  brandLeaseTerms,
  tenantBenchmarks,
  portfolioAnalytics,
  saleComps,
  compBenchmarkTool,
  leaseAbstracts,
  dataQuality,
  dataCoverage,
];

export const MCP_TOOLS_BY_NAME: Map<string, McpToolDef> = new Map(MCP_TOOLS.map(t => [t.name, t]));

// Server-level instructions, sent on MCP `initialize`. This is what orients a client
// that has never seen the library before, so it leads with the two must-call tools.
export const MCP_SERVER_INSTRUCTIONS = `This is the KPR Centers deal library — an offering-memorandum database for RETAIL SHOPPING CENTERS (not residential, not office, not land).

Before analyzing anything, call **get_knowledge** once: it returns KPR's standing underwriting doctrine (how to treat above- and below-market rent, co-tenancy triggers, cinema sales, comps discipline) plus live operator-taught rules. Analysis that ignores it will be wrong in ways this team cares about.

Call **library_overview** to see what's in the library, then **search_deals** → **get_deal** to work a specific center.

**What this library is.** It is NOT KPR's portfolio. It is a deliberately broad MARKET
CORPUS: KPR records essentially every retail deal it looks at — bought, passed, still
evaluating, sold — to build up enough data points to see averages and trends across
tenants, brands, anchors, markets, pricing and sales. Most records here are deals KPR
looked at and did NOT buy, and that is the point: they are the comparable set. Never
describe a deal here as "ours" or "our portfolio" unless its status says Owned, and never
present a corpus-wide roll-up as KPR's own exposure or holdings.

**Which source wins.** KPR also runs Datex, its property-management system of record, as a
separate connector. Datex holds the live, detailed picture of the properties KPR actually
OWNS — current rents and NNN, budgets, occupancy history, tenant sales, option and notice
dates, loans, leasing pipeline. For any fact about a KPR-owned property, go to Datex
first; it is more current and more complete than this library will ever be. Owned records
here carry an \`authority\` field saying so.

But the split is by QUESTION, not only by property. Datex knows KPR's buildings; it does
NOT know the hundreds of deals KPR evaluated and declined, which is where the market
signal lives. So:
- A fact about a KPR property ("what does our Ulta pay?") → Datex.
- A market question ("is that rent normal for Ulta?") → THIS library, which has the sample.
  Take the subject figure from Datex, then benchmark it against this corpus.
Going to Datex for a market question shrinks the sample to KPR's own holdings, which
defeats the reason this corpus exists.

**Why Datex leads: this corpus is STATIC, Datex is LIVING.** A deal here is captured from an
offering memorandum or a rent roll and then essentially never updated — every figure is
frozen as of its capture date, which each record reports as \`capturedAsOf\`. Datex is fed
continuously by KPR's team and reflects today. So default to Datex for anything that could
have changed, and whenever you quote a figure from this library, say what it is as-of. Never
present a captured figure as a current rent, occupancy or value.

That also applies to averages, and the corpus now handles it for you: **in retail, a data
point older than about ten years is fairly stale**, so medians here are RECENCY-WEIGHTED — a
capture's influence fades linearly to zero across a ten-year horizon. Each metric reports
\`median\` (recency-weighted: the market as this corpus currently sees it), \`unweightedMedian\`
(everything ever captured), and \`nWithinHorizon\`. When the weighted and unweighted figures
diverge materially, RENTS HAVE MOVED — say that, rather than quoting one number as if it
settled the question. A median resting entirely on stale captures is history, not market.

**Comparing to Datex: match BASE to BASE.** Datex splits rent into \`AnnualRentPSF\` (base),
\`AnnualNNNPSF\` (recoveries) and \`AnnualOtherPSF\`. This corpus's \`rentPerSF\` is BASE ONLY, so
the only valid comparison is Datex \`AnnualRentPSF\` vs this corpus's \`rentPerSF\`. Folding NNN
into the Datex side inflates it by the entire recovery load — often $8–15/SF — and turns an
ordinary rent into a phantom above-market finding. Also: Datex \`TenantsMetrics\` is monthly
history keyed by \`Period\` (YYYYMM), so "current" is the LATEST period; and Datex sales are
trailing-twelve-month and live, while this corpus's salesPSF is as-of its capture date.

**Datex row-level traps — verified against the live data, and each one silently produces a
wrong number.** Before aggregating anything out of \`TenantsMetrics\`:
1. **Filter to one \`Period\`.** It is monthly history. Without a period filter you aggregate
   the same tenant dozens of times. "Current" is the latest period.
2. **Every tenant appears more than once per period, and the extra rows carry rent of 0.**
   Averaging the rows as they come back HALVES the rent. Drop rows where \`AnnualRentPSF\` is
   0 before you compute anything.
3. **\`Rolling12SalesPSF: 0\` with \`LastSalesPeriod: "190001"\` means NEVER REPORTED, not zero
   sales.** That sentinel date is January 1900. Treating those zeros as real sales says a
   healthy chain does $0/SF, and averaging them produces a plausible-looking figure that is
   completely false. Exclude them; report how many locations actually reported.
4. **Datex tenant names carry store numbers** ("Dollar Tree #4516"); this corpus stores the
   brand alone. Match on the brand, not the raw string.

**A lease ages from when it was STRUCK, not from when we read it.** A 2010 lease sitting
inside a 2026 offering memorandum is a 2010 rent — reading it recently does not make it a
current market signal. Benchmarks here are therefore weighted by LEASE COMMENCEMENT, with
capture date used only where commencement was never recorded. The caveat: amendments and
exercised options RESET the economics, so a lease renegotiated later has a later effective
vintage than its commencement date shows, and the roster does not reliably record when that
happened. An old lease with recent rent steps may be fresher than it looks — say so rather
than over-claiming in either direction.

**A rent roll dated in the FUTURE is the OM's assumed closing date, not a capture date.**
Retail offering memoranda routinely start their financials a few months out, on the date a
buyer would realistically own the asset — a mid-2026 book will model from 1/1/2027. That is
a normal marketing convention, not an error and not evidence of a pro forma roster. It does
NOT mean the roster is current to that date, so never read a forward as-of date as freshness.

**On tenants and brands, use BOTH and cite BOTH.** These sources answer different questions,
so the best answer carries them separately rather than picking one:
  "Across KPR's own properties we see rents of X (Datex, current). Across the broader set of
   deals we've reviewed, the market shows Y (corpus, captures spanning 20NN–20NN)."
What KPR achieves as a landlord is not the same thing as what the market shows, and the GAP
between them is itself the finding. Never merge them into a single blended number, and never
imply the corpus figure describes KPR's properties.

On a disagreement about an owned property, Datex wins. Name the source of each figure and
flag the gap — never average them, never silently pick one.

Ground rules for every answer:
- Accuracy over speed. If a figure isn't in the data, say it isn't captured — never invent a precise-looking number.
- null means NOT CAPTURED, never zero.
- annualRent is BASE RENT ONLY; recoveries live in separate fields.
- Comps and benchmarks: report medians with the sample size and date range, never means, never eyeballed.
- Every tool here is read-only — you cannot change this library, only read it.`;
