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
    "START HERE. What is in the KPR deal library right now: how many shopping-center deals, " +
    "the states and center types covered, portfolio totals (GLA, NOI, occupancy), the biggest " +
    "tenants by rent, and a glossary of the field names used everywhere else. Call this first " +
    "when you don't yet know what the library contains.",
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
        "Cap rate and asking price are absent on most deals — retail centers are often marketed " +
        "unpriced. That is expected, not a data gap.",
      byState: [...byState.entries()].sort((a, b) => b[1] - a[1]).map(([state, count]) => ({ state, count })),
      byCenterType: [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count })),
      byStatus: [...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ status, count })),
      topTenantsByRent: topTenants,
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

export const MCP_TOOLS: McpToolDef[] = [
  libraryOverview,
  getKnowledge,
  searchDeals,
  getDeal,
  searchTenants,
  tenantBenchmarks,
  portfolioAnalytics,
  saleComps,
  leaseAbstracts,
  dataQuality,
];

export const MCP_TOOLS_BY_NAME: Map<string, McpToolDef> = new Map(MCP_TOOLS.map(t => [t.name, t]));

// Server-level instructions, sent on MCP `initialize`. This is what orients a client
// that has never seen the library before, so it leads with the two must-call tools.
export const MCP_SERVER_INSTRUCTIONS = `This is the KPR Centers deal library — an offering-memorandum database for RETAIL SHOPPING CENTERS (not residential, not office, not land).

Before analyzing anything, call **get_knowledge** once: it returns KPR's standing underwriting doctrine (how to treat above- and below-market rent, co-tenancy triggers, cinema sales, comps discipline) plus live operator-taught rules. Analysis that ignores it will be wrong in ways this team cares about.

Call **library_overview** to see what's in the library, then **search_deals** → **get_deal** to work a specific center.

Ground rules for every answer:
- Accuracy over speed. If a figure isn't in the data, say it isn't captured — never invent a precise-looking number.
- null means NOT CAPTURED, never zero.
- annualRent is BASE RENT ONLY; recoveries live in separate fields.
- Comps and benchmarks: report medians with the sample size and date range, never means, never eyeballed.
- Every tool here is read-only — you cannot change this library, only read it.`;
