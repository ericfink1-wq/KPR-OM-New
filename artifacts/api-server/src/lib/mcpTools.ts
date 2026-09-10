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
const clampLimit = (v: unknown, dflt: number, max: number): number => {
  const n = num(v);
  if (n == null) return dflt;
  return Math.max(1, Math.min(max, Math.round(n)));
};

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
    dealScore: d.dealScore ?? null,
    tenantCount: tenants.length,
    anchors: anchors.slice(0, 6),
    updatedAt: r.updatedAt.toISOString(),
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
      limit: { type: "number", description: "Default 25, max 200." },
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
        if (!ts.some(t => String(t?.name ?? "").toLowerCase().includes(anchor.toLowerCase()))) return false;
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

    const limit = clampLimit(a.limit, 25, 200);
    return {
      matched: hit.length,
      returned: Math.min(limit, hit.length),
      totalInLibrary: deals.length,
      deals: hit.slice(0, limit).map(dealSummary),
    };
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
    deal.dealId = found.id;
    deal.updatedAt = found.updatedAt.toISOString();
    // The live deterministic tie-out audit, so the caller sees data-integrity
    // contradictions on this deal instead of quoting a number that doesn't add up.
    const audit = auditExtraction(found.data);
    return {
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
    };
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
      limit: { type: "number", description: "Default 50, max 500." },
    },
  },
  handler: async (a) => {
    const rows = await db.select().from(tenantIndexTable);
    const name = str(a.name)?.toLowerCase();
    const dealId = str(a.dealId);
    const minSF = num(a.minSF), maxSF = num(a.maxSF);
    const before = str(a.expiringBefore), after = str(a.expiringAfter);
    const anchorsOnly = bool(a.anchorsOnly), withSalesOnly = bool(a.withSalesOnly);

    const hit = rows.filter(t => {
      if (dealId && t.dealId !== dealId) return false;
      if (name) {
        const n = `${t.canonicalName ?? ""} ${t.rawName ?? ""}`.toLowerCase();
        if (!n.includes(name)) return false;
      }
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
    const limit = clampLimit(a.limit, 50, 500);
    return {
      matched: hit.length,
      returned: Math.min(limit, hit.length),
      totalAnnualBaseRent: Math.round(hit.reduce((s, t) => s + (t.annualRent ?? 0), 0)),
      totalSF: Math.round(hit.reduce((s, t) => s + (t.sf ?? 0), 0)),
      tenants: hit.slice(0, limit).map(t => ({
        dealId: t.dealId, deal: t.dealName, dealStatus: t.dealStatus,
        tenant: t.canonicalName || t.rawName, asWritten: t.rawName,
        sf: t.sf, rentPerSF: t.rentPerSf, annualBaseRent: t.annualRent,
        leaseStart: t.leaseStartDate ? String(t.leaseStartDate).slice(0, 10) : t.leaseStart,
        leaseExpiry: t.leaseExpiryDate ? String(t.leaseExpiryDate).slice(0, 10) : t.leaseExpiry,
        leaseType: t.leaseType, creditRating: t.creditRating,
        isAnchor: t.isAnchor, isNAP: t.isNap,
        salesPSF: t.salesPsf, salesYear: t.salesYear,
        expenseReimbursements: t.expenseReimbursements, percentageRent: t.percentageRent, otherRent: t.otherRent,
      })),
      note: "annualBaseRent is BASE RENT ONLY — recoveries are the separate fields on each row.",
    };
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
    const tenants = scoped.filter(r => r.rawName && !/^vacant/i.test(r.rawName.trim()));
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
      limit: { type: "number", description: "Default 40, max 300." },
    },
  },
  handler: async (a) => {
    const rows = await db.select().from(compsIndexTable);
    const state = str(a.state)?.toUpperCase(), market = str(a.market)?.toLowerCase(), q = str(a.query)?.toLowerCase();
    const minPrice = num(a.minSalePrice), minCap = num(a.minCapRate), maxCap = num(a.maxCapRate);
    const since = str(a.sinceDate), ownedOnly = bool(a.ownedOnly);
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
    const limit = clampLimit(a.limit, 40, 300);
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
      const flags = auditExtraction(d);
      return {
        dealId, propertyName: nameOf(d),
        issueCount: flags.length,
        high: flags.filter(f => f.severity === "high").length,
        issues: flags.map(f => ({
          check: AUDIT_CHECK_LABELS[auditCheckKey(f.id)] || f.field,
          severity: f.severity, field: f.field, detail: f.question,
        })),
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
      limit: { type: "number", description: "Max locations returned. Default 40, max 200." },
    },
    required: ["brand"],
  },
  handler: async (a) => {
    const brand = str(a.brand);
    if (!brand) return { error: "brand_required", message: "Pass a brand name, e.g. { brand: \"PetSmart\" }." };
    const needle = brand.toLowerCase();
    const withAbstracts = bool(a.includeAbstracts, true);
    const limit = clampLimit(a.limit, 40, 200);

    const [deals, abstractRows] = await Promise.all([
      loadActiveDeals(),
      db.select().from(leaseAbstractsTable),
    ]);

    // Executed-document abstracts, keyed by deal + tenant. These OUTRANK the roster
    // for clause detail — the roster's lease-risk block is an OM read, the abstract
    // is reconciled from the signed documents.
    const absByDeal = new Map<string, Array<{ tenantName: string; data: DealData }>>();
    for (const r of abstractRows) {
      if (!r.tenantName.toLowerCase().includes(needle)) continue;
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
        if (!tname.toLowerCase().includes(needle)) continue;
        const start = str(t.leaseStart), end = str(t.leaseExpiry);
        const termYears = start && end
          ? Math.round(((Date.parse(end) - Date.parse(start)) / 31557600000) * 10) / 10
          : null;
        const risk = riskRows.find(rr => String(rr?.tenant ?? "").toLowerCase() === tname.toLowerCase());
        const abs = (absByDeal.get(r.id) ?? []).find(x => x.tenantName.toLowerCase().includes(tname.toLowerCase()) || tname.toLowerCase().includes(x.tenantName.toLowerCase()));

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

    return {
      brand,
      matched: locations.length,
      returned: Math.min(limit, locations.length),
      comparison: {
        rentPerSF: spread(locations.map(l => l.rentPerSF!).filter(v => v != null && v > 0)),
        sf: spread(locations.map(l => l.sf!).filter(v => v != null && v > 0)),
        originalTermYears: spread(locations.map(l => l.termYears!).filter(v => v != null && v > 0)),
        salesPSF: spread(locations.map(l => num(l.salesPSF)!).filter(v => v != null && v > 0)),
      },
      leverPrevalence,
      locations: locations.slice(0, limit),
      howToUse:
        "Compare the lease in front of you to the MEDIAN and the p25–p75 band, and say how " +
        "many locations the band is built from — a two-location median is an anecdote, not a " +
        "benchmark. A rent above the band is a premium to interrogate (mark-to-market DOWNSIDE " +
        "unless the store's sales or a low occupancy cost support it), never 'upside'. Below the " +
        "band with locked options is secure, sticky income, not a risk. On the levers: `false` " +
        "means the source says the clause is absent, `unknown` means nothing here says either " +
        "way — never report `unknown` as 'no such clause'. Where a lever comes from an OM read " +
        "rather than an executed abstract, say it is unverified.",
    };
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
      for (const t of ts) if (!/^vacant/i.test(String(t?.name ?? ""))) tenantRows.push(t);
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

    return {
      scope: wanted ? { status: str(a.status) } : { status: "all active deals" },
      dealsScanned: deals.length,
      tenantRowsScanned: tenantRows.length,
      abstractsInLibrary: abstractRows.length,
      coverage,
      thinlyCovered: sparse,
      howToUse:
        "Treat anything under ~25% coverage as ANECDOTAL: quote it per-deal, never as a " +
        "portfolio finding, and say how many records it rests on. Missing pricing is expected " +
        "(retail is often marketed unpriced) and is not a data-quality problem. Sparse sales " +
        "coverage is the one that most often misleads — without sales you cannot judge whether " +
        "an above-market rent is supported, so flag it to verify rather than assuming either way.",
    };
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

On a disagreement about an owned property, Datex wins. Name the source of each figure and
flag the gap — never average them, never silently pick one.

Ground rules for every answer:
- Accuracy over speed. If a figure isn't in the data, say it isn't captured — never invent a precise-looking number.
- null means NOT CAPTURED, never zero.
- annualRent is BASE RENT ONLY; recoveries live in separate fields.
- Comps and benchmarks: report medians with the sample size and date range, never means, never eyeballed.
- Every tool here is read-only — you cannot change this library, only read it.`;
