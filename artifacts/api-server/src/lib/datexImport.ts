import { readFileSync } from "node:fs";
import { join } from "node:path";

// DATEX LIVE IMPORT — the guardrail layer.
//
// Datex is KPR's property-management system of record. Its MCP endpoint is OAuth-only and
// its authorization server offers no machine-to-machine grant, so this server cannot pull
// from it directly. Instead a Claude session (where a person IS authenticated) generates a
// JSON payload and posts it here.
//
// THAT MEANS THE PAYLOAD IS UNTRUSTED. It is produced by a model reading a live system, and
// the whole value of the deal library is that its acquisition-era figures are FROZEN — the
// OM-stated numbers are evidence of what was marketed, and silently overwriting them would
// destroy the record this library exists to keep. So every rule lives HERE, enforced on
// arrival, rather than in the instructions that generated the file:
//
//   • Only `datexLive` is ever written. The merge is constructed so no other key CAN change.
//   • A deal must exist, be status Owned, and be in the hand-maintained map. Nothing else.
//   • The payload's building ids must match the map's — a file generated against the wrong
//     building is the one error that would look completely plausible in the output.
//   • Null means UNKNOWN, never zero. An absent figure is omitted, never coerced.
//   • Figures are bounds-checked. Occupancy outside 0–100, negative area or rent, or an
//     occupied area above total area are rejected as impossible rather than stored.
//
// Verified against live Datex on 2026-09-15, correcting three things the original spec had
// wrong — see DATEX_SOURCE_NOTES below.

export interface DatexDealPayload {
  dealId: string;
  bldgIds: string[];
  period?: string | null;            // Datex period, YYYYMM
  totalGLA?: number | null;
  occupiedGLA?: number | null;
  vacantGLA?: number | null;
  occupancyPct?: number | null;
  totalUnits?: number | null;
  occupiedUnits?: number | null;
  vacantUnits?: number | null;
  /** Shop / major / pad / ground-lease split, as Datex reports it. */
  segments?: Record<string, { gla?: number | null; occupiedGLA?: number | null; units?: number | null; occupiedUnits?: number | null }> | null;
  tenants?: Array<{
    tenantId?: string | null; name?: string | null; suite?: string | null;
    sf?: number | null; annualRent?: number | null; annualRentPSF?: number | null;
    annualNNNPSF?: number | null; leaseExpiry?: string | null;
    salesPSF?: number | null; salesPeriod?: string | null;
  }> | null;
  vacantSuites?: Array<{ suite?: string | null; sf?: number | null }> | null;
  notes?: string | null;
}

export interface DatexPayload {
  source?: string;
  asOf: string;                       // ISO date the snapshot represents
  generatedBy?: string | null;
  deals: DatexDealPayload[];
}

export interface DealRef { id: string; data: Record<string, unknown> }

export interface ImportOutcome {
  applied: Array<{ dealId: string; propertyName: string; block: Record<string, unknown>; changedFrom: Record<string, unknown> | null }>;
  skipped: Array<{ dealId: string; propertyName: string | null; reason: string }>;
  rejected: Array<{ dealId: string; propertyName: string | null; problem: string }>;
}

/** What validating against the live system actually established, kept next to the code that
 *  depends on it so a future edit can see why these choices are not arbitrary. */
export const DATEX_SOURCE_NOTES = {
  occupancySource:
    "Occupancy entity, NOT a sum over TenantsMetrics. Summing TenantsMetrics SuiteSQFT for " +
    "Cooks Corner gave 340,824 SF against a 300,386 SF building — it carries rows that are " +
    "not leasable area. Occupancy already reports TotalGLA, TotalGLAOccupied, unit counts " +
    "and the shop/major/pad/ground-lease split.",
  supersededRows:
    "A superseded lease generation repeats a tenant's SF at zero dollars and is identified " +
    "by a DOT in TenantId. Real examples at Cooks Corner: t0000062.1.30, t0000069.2.6, " +
    "t0000070.2.70 — the spec's stated '.0.00011' pattern matches none of them.",
  neverFilterRentForArea:
    "Do NOT drop zero-rent rows when computing area. Big Lots occupies 40,000 SF at $0 rent " +
    "with no dot suffix — a real dark anchor. A rent filter silently deletes it.",
  buildingsGlaUnusable:
    "Buildings.BLDGGLA is 0 on 46 buildings, and Buildings.OCCGLA is the SHOP-occupied " +
    "figure, not the total. Dividing one by the other produced the bogus '48.9% occupancy' " +
    "at Cooks Corner, where the true figure is 67.2% against a 67.6% acquisition snapshot.",
  fixedWidthIds:
    "Datex character fields are fixed-width and carry trailing spaces, so BLDGID must be " +
    "matched with `contains`; `eq` silently matches nothing.",
} as const;

/** The key the live block is stored under. MUST also be in USER_PRESERVED_KEYS, or the next
 *  OM re-import wipes it with no error. */
export const DATEX_BLOCK_KEY = "datexLive";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(String(v).replace(/[$,%\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Keep a numeric field ONLY when it is genuinely present and sane. Null/absent means the
 *  system does not know — it is omitted, never written as zero. */
function keepNumber(v: unknown, opts: { min?: number; max?: number } = {}): number | null {
  const n = num(v);
  if (n == null) return null;
  if (opts.min != null && n < opts.min) return null;
  if (opts.max != null && n > opts.max) return null;
  return n;
}

export interface DatexMap {
  mappings: Array<{ dealId: string; propertyName: string; bldgIds: string[]; note?: string }>;
  unmapped: Array<{ dealId: string; propertyName: string; reason?: string }>;
}

let cachedMap: DatexMap | null = null;
export function loadDatexMap(dir = join(__dirname, "..", "data")): DatexMap {
  if (!cachedMap) cachedMap = JSON.parse(readFileSync(join(dir, "datex-deal-map.json"), "utf8")) as DatexMap;
  return cachedMap;
}
/** Test seam — lets a test supply a map without touching the filesystem. */
export function __setDatexMap(m: DatexMap | null): void { cachedMap = m; }

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && [...a].map(s => s.trim().toLowerCase()).sort().join("|") === [...b].map(s => s.trim().toLowerCase()).sort().join("|");

/**
 * Validate one deal's payload and build the live block. Returns null with a reason when the
 * payload cannot be trusted — the caller records it rather than writing anything.
 */
export function buildLiveBlock(
  p: DatexDealPayload,
  asOf: string,
  mapEntry: { bldgIds: string[] },
): { block: Record<string, unknown> } | { problem: string } {
  if (!Array.isArray(p.bldgIds) || p.bldgIds.length === 0) return { problem: "payload carries no bldgIds" };
  if (!sameIds(p.bldgIds, mapEntry.bldgIds)) {
    return { problem: `bldgIds ${JSON.stringify(p.bldgIds)} do not match the map's ${JSON.stringify(mapEntry.bldgIds)} — the file was generated against different buildings` };
  }

  const totalGLA = keepNumber(p.totalGLA, { min: 1 });
  const occupiedGLA = keepNumber(p.occupiedGLA, { min: 0 });
  if (totalGLA != null && occupiedGLA != null && occupiedGLA > totalGLA * 1.01) {
    return { problem: `occupied GLA ${occupiedGLA} exceeds total GLA ${totalGLA}` };
  }

  // Prefer a stated occupancy, but only if it is a real percentage; otherwise derive it.
  let occupancyPct = keepNumber(p.occupancyPct, { min: 0, max: 100 });
  if (occupancyPct == null && totalGLA && occupiedGLA != null) {
    occupancyPct = Math.round((occupiedGLA / totalGLA) * 1000) / 10;
  }

  const tenants = Array.isArray(p.tenants) ? p.tenants.filter(t => {
    // A superseded lease generation repeats the SF at zero dollars; the dot is the marker.
    if (String(t?.tenantId ?? "").includes(".")) return false;
    return Boolean(String(t?.name ?? "").trim());
  }).map(t => {
    const row: Record<string, unknown> = { name: String(t.name).trim() };
    if (t.tenantId) row.tenantId = String(t.tenantId).trim();
    if (t.suite) row.suite = String(t.suite).trim();
    // Area and rent are kept only when real. Zero rent is MEANINGFUL (a dark anchor still
    // occupies its box), so 0 is allowed through — it is null that is dropped.
    const sf = keepNumber(t.sf, { min: 0 });                     if (sf != null) row.sf = sf;
    const rent = keepNumber(t.annualRent, { min: 0 });            if (rent != null) row.annualRent = rent;
    const psf = keepNumber(t.annualRentPSF, { min: 0 });          if (psf != null) row.rentPerSF = psf;
    const nnn = keepNumber(t.annualNNNPSF, { min: 0 });           if (nnn != null) row.nnnPerSF = nnn;
    const sales = keepNumber(t.salesPSF, { min: 0 });             if (sales != null) row.salesPSF = sales;
    if (t.leaseExpiry && /^\d{4}-\d{2}-\d{2}/.test(String(t.leaseExpiry))) row.leaseExpiry = String(t.leaseExpiry).slice(0, 10);
    if (t.salesPeriod) row.salesPeriod = String(t.salesPeriod);
    return row;
  }) : null;

  const block: Record<string, unknown> = {
    source: "datex",
    asOf,
    bldgIds: mapEntry.bldgIds,
    importedAt: new Date().toISOString(),
  };
  if (p.period) block.period = String(p.period);
  if (totalGLA != null) block.totalGLA = totalGLA;
  if (occupiedGLA != null) block.occupiedGLA = occupiedGLA;
  const vacantGLA = keepNumber(p.vacantGLA, { min: 0 });         if (vacantGLA != null) block.vacantGLA = vacantGLA;
  if (occupancyPct != null) block.occupancyPct = occupancyPct;
  const tu = keepNumber(p.totalUnits, { min: 0 });               if (tu != null) block.totalUnits = tu;
  const ou = keepNumber(p.occupiedUnits, { min: 0 });            if (ou != null) block.occupiedUnits = ou;
  const vu = keepNumber(p.vacantUnits, { min: 0 });              if (vu != null) block.vacantUnits = vu;
  if (p.segments && typeof p.segments === "object") block.segments = p.segments;
  if (tenants && tenants.length) block.tenants = tenants;
  if (Array.isArray(p.vacantSuites) && p.vacantSuites.length) block.vacantSuites = p.vacantSuites;
  if (p.notes) block.notes = String(p.notes);
  return { block };
}

/**
 * Merge a payload across the library. PURE — returns what WOULD change; the caller decides
 * whether to write. The returned deal object is rebuilt as {...existing, [DATEX_BLOCK_KEY]},
 * so it is structurally impossible for this to modify an acquisition-era field.
 */
export function planDatexImport(payload: DatexPayload, deals: DealRef[], map: DatexMap = loadDatexMap()): ImportOutcome {
  const out: ImportOutcome = { applied: [], skipped: [], rejected: [] };

  const asOf = String(payload?.asOf ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return { ...out, rejected: [{ dealId: "(payload)", propertyName: null, problem: "asOf must be an ISO date (YYYY-MM-DD)" }] };
  }
  if (asOf > new Date().toISOString().slice(0, 10)) {
    return { ...out, rejected: [{ dealId: "(payload)", propertyName: null, problem: `asOf ${asOf} is in the future` }] };
  }
  if (!Array.isArray(payload.deals) || payload.deals.length === 0) {
    return { ...out, rejected: [{ dealId: "(payload)", propertyName: null, problem: "payload contains no deals" }] };
  }

  const byId = new Map(deals.map(d => [d.id, d]));
  const mapped = new Map(map.mappings.map(m => [m.dealId, m]));
  const unmapped = new Set(map.unmapped.map(m => m.dealId));

  for (const p of payload.deals) {
    const dealId = String(p?.dealId ?? "");
    const deal = byId.get(dealId);
    const name = (deal?.data?.propertyName as string) ?? null;

    if (unmapped.has(dealId)) { out.skipped.push({ dealId, propertyName: name, reason: "not set up in Datex yet — skipped by design" }); continue; }
    const entry = mapped.get(dealId);
    if (!entry) { out.rejected.push({ dealId, propertyName: name, problem: "not in the Datex map — never guess a building by name" }); continue; }
    if (!deal) { out.rejected.push({ dealId, propertyName: null, problem: "no such deal in the library" }); continue; }
    if (String(deal.data.status ?? "") !== "Owned") {
      out.rejected.push({ dealId, propertyName: name, problem: `status is "${deal.data.status ?? "(none)"}", not Owned — Datex only covers owned assets` });
      continue;
    }

    const built = buildLiveBlock(p, asOf, entry);
    if ("problem" in built) { out.rejected.push({ dealId, propertyName: name, problem: built.problem }); continue; }

    const prev = (deal.data[DATEX_BLOCK_KEY] as Record<string, unknown> | undefined) ?? null;
    out.applied.push({ dealId, propertyName: name ?? entry.propertyName ?? dealId, block: built.block, changedFrom: prev });
  }
  return out;
}

/** Produce the updated deal data for one applied entry. The ONLY write path. */
export function applyLiveBlock(data: Record<string, unknown>, block: Record<string, unknown>): Record<string, unknown> {
  return { ...data, [DATEX_BLOCK_KEY]: block };
}

/** The divergence report: live against the frozen acquisition snapshot. Surfaces the spread,
 *  never reconciles it — a gap between what was marketed and what the asset does today is the
 *  point of holding both, not an error to tidy away. */
export function datexDivergence(data: Record<string, unknown>): Array<{ field: string; acquisition: number; live: number; deltaPct: number | null; note?: string }> {
  const block = data[DATEX_BLOCK_KEY] as Record<string, unknown> | undefined;
  if (!block) return [];
  const rows: Array<{ field: string; acquisition: number; live: number; deltaPct: number | null; note?: string }> = [];
  const pairs: Array<[string, unknown, unknown]> = [
    ["occupancy", data.occupancy, block.occupancyPct],
    ["totalSF", data.totalSF, block.totalGLA],
  ];
  for (const [field, a, l] of pairs) {
    const av = num(a), lv = num(l);
    if (av == null || lv == null) continue;
    rows.push({ field, acquisition: av, live: lv, deltaPct: av !== 0 ? Math.round(((lv - av) / av) * 1000) / 10 : null });
  }
  // A fully-dark segment is a real finding that a headline occupancy figure hides.
  const seg = block.segments as Record<string, { gla?: number | null; occupiedGLA?: number | null }> | undefined;
  if (seg) {
    for (const [name, s] of Object.entries(seg)) {
      const gla = num(s?.gla), occ = num(s?.occupiedGLA);
      if (gla != null && gla > 0 && occ === 0) {
        rows.push({ field: `${name} segment`, acquisition: gla, live: 0, deltaPct: -100, note: `${Math.round(gla).toLocaleString()} SF of ${name} space is entirely vacant` });
      }
    }
  }
  return rows;
}
