import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Deal, Tenant, ReviewQuestion, LeaseAbstract } from "./idb";
import { getTenantDecisions, saveTenantDecision, removeTenantDecision } from "./idb";
import { isInvestmentGrade } from "./tenantCredit";
// Used only inside buildSystemPrompt (runtime), so the utils⇄leaseRisk import cycle
// is safe — neither module touches the other's exports at module-eval time.
import { resolveTenantRisk, anchorsReferenced, computeExposure } from "./leaseRisk";

// Occupancy sanity: some OMs express occupancy as a FRACTION (1.0 = 100%,
// 0.993 = 99.3%) rather than a percent. A real retail-center occupancy is never
// ≤1.5%, so any value in (0, 1.5] is treated as a fraction and scaled to a percent.
// Applied at every data-load boundary so the whole app (grid, detail, compare,
// analytics, PDF, export, comps) sees a consistent percent. Idempotent.
export function normalizeOccupancy(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (isNaN(n) || n <= 0) return null;
  return n <= 1.5 ? Math.round(n * 100 * 10) / 10 : n;
}

// Return a deal with its occupancy normalized (non-mutating).
export function normalizeDeal<T extends { occupancy?: number | null }>(deal: T): T {
  const occ = normalizeOccupancy(deal.occupancy);
  return occ != null && occ !== deal.occupancy ? { ...deal, occupancy: occ } : deal;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getRecency(deal: Deal): { label: string; color: string; bg: string } | null {
  const date = deal.omDate || deal.uploadedAt;
  if (!date) return null;
  const months = (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (months < 2) return { label: "FRESH", color: "#0f9d63", bg: "#0f9d6318" };
  if (months < 5) return { label: "RECENT", color: "#6dba43", bg: "#6dba4318" };
  if (months < 10) return { label: "AGING", color: "#d9890c", bg: "#d9890c18" };
  return { label: "STALE", color: "#a69e91", bg: "#a69e9118" };
}

export function classifyLocation(deal: Deal) {
  const pop = deal.population3mi;
  const inc = deal.avgHHIncome3mi ?? deal.medianHHIncome3mi;
  const market = (deal.market || "").toLowerCase();
  const urbanKeys = ["new york","los angeles","chicago","houston","phoenix","philadelphia",
    "san antonio","san diego","dallas","san jose","austin","jacksonville","fort worth",
    "columbus","charlotte","indianapolis","san francisco","seattle","denver","washington"];
  const suburbanKeys = ["suburb","township","village","heights","grove","hills","lake","park","springs","station"];
  let urbanicity: string | null = null;
  if (urbanKeys.some(k => market.includes(k))) urbanicity = "Urban";
  else if (suburbanKeys.some(k => market.includes(k))) urbanicity = "Suburban";
  else if (market) urbanicity = "Suburban";
  let density: { tier: string; color: string } | null = null;
  if (pop != null) {
    if (pop >= 150000) density = { tier: "Dense Urban", color: "#0d9488" };
    else if (pop >= 80000) density = { tier: "Urban", color: "#0f9d63" };
    else if (pop >= 40000) density = { tier: "Suburban", color: "#6dba43" };
    else if (pop >= 15000) density = { tier: "Exurban", color: "#d9890c" };
    else density = { tier: "Rural", color: "#a69e91" };
  }
  let income: { tier: string; color: string } | null = null;
  if (inc != null) {
    if (inc >= 150000) income = { tier: "Affluent", color: "#0f9d63" };
    else if (inc >= 100000) income = { tier: "Upper-Middle", color: "#6dba43" };
    else if (inc >= 70000) income = { tier: "Middle", color: "#d9890c" };
    else if (inc >= 50000) income = { tier: "Lower-Middle", color: "#b45309" };
    else income = { tier: "Low Income", color: "#dc2626" };
  }
  return { urbanicity, density, income, pop, inc };
}

export function findSimilar(deal: Deal, all: Deal[]): Deal[] {
  return all.filter(d => {
    if (d.id === deal.id || d.trashedAt) return false;
    const sameType = d.assetType === deal.assetType;
    const sameMarket = d.market && deal.market && d.market.toLowerCase() === deal.market.toLowerCase();
    const sameSF = deal.totalSF && d.totalSF &&
      Math.abs(Number(d.totalSF) - Number(deal.totalSF)) / Number(deal.totalSF) < 0.25;
    return (sameType && sameMarket) || (sameType && sameSF) || (sameMarket && sameSF);
  }).slice(0, 4);
}

export function humanizeKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim();
}

// Tally fields the user has manually corrected across all deals and return
// in-context guidance to inject into the extraction prompt for new runs.
// This is NOT model training — it's a "corrections memory" in the prompt.
export function buildCorrectionsNote(deals: Deal[]): string {
  const skip = new Set(["extraction","record","propertyGroup","status","marketSale","marketDemographics","imageMeta","userNotes"]);
  const counts: Record<string, number> = {};
  for (const d of deals || []) {
    for (const h of (((d as unknown) as Record<string, unknown>).editHistory as Array<{ by?: string; changes?: Array<{ field?: string; to?: unknown }> }> || [])) {
      if (/^(AI|Auto|PDF)/i.test(h.by || "")) continue;
      for (const c of h.changes || []) {
        const f = c.field;
        if (!f || skip.has(f)) continue;
        if (c.to === "verified" || c.to === "unverified") continue;
        counts[f] = (counts[f] || 0) + 1;
      }
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([f]) => humanizeKey(f));
  if (!top.length) return "";
  return `\n\nANALYST CORRECTION HISTORY — across prior deals the user has manually corrected these fields, so the source figures or a first read were often off. Extract these with extra care: prefer the ACTUAL/in-place figures stated in the OM (not asking, pro-forma, or marketing numbers) and double-check them: ${top.join(", ")}.`;
}

export function assessExtraction(deal: Deal): { quality: "good" | "partial" | "thin"; missing: string[] } {
  const core: [keyof Deal, string][] = [
    ["propertyName","Property Name"],["totalSF","Total SF"],
    ["noi","NOI"],["occupancy","Occupancy"],["walt","WALT"],
  ];
  const missing = core.filter(([k]) => deal[k] == null || deal[k] === "").map(([,l]) => l);
  const hasTenants = (deal.tenants || []).length > 0;
  const quality = missing.length === 0 && hasTenants ? "good" : missing.length <= 2 ? "partial" : "thin";
  return { quality, missing };
}

export interface ReconcileCheck { label: string; detail: string; severity: "error" | "warn"; }
export function reconcileDeal(deal: Deal) {
  const checks: ReconcileCheck[] = [];
  const n = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const noi = n(deal.noi), cap = n(deal.capRate), price = n(deal.askingPrice);
  const sf = n(deal.totalSF), ppsf = n(deal.pricePerSF);
  const gpr = n(deal.grossPotentialRent), egi = n(deal.effectiveGrossIncome), opex = n(deal.operatingExpenses);
  if (noi && cap && price) {
    const implied = noi / (cap / 100);
    const diff = Math.abs(implied - price) / price;
    if (diff > 0.12) checks.push({ severity:"error", label:"Cap rate / price mismatch", detail:`NOI ÷ cap rate implies $${Math.round(implied).toLocaleString()}, but asking price is $${Math.round(price).toLocaleString()} (${(diff*100).toFixed(0)}% gap).` });
  }
  if (price && sf && ppsf) {
    const implied = price / sf;
    const diff = Math.abs(implied - ppsf) / ppsf;
    if (diff > 0.1) checks.push({ severity:"warn", label:"Price/SF mismatch", detail:`$${Math.round(price).toLocaleString()} ÷ ${sf.toLocaleString()} SF = $${implied.toFixed(0)}/SF, but extracted price/SF is $${ppsf}.` });
  }
  if (gpr && egi && noi) {
    if (noi > egi) checks.push({ severity:"error", label:"NOI exceeds EGI", detail:`NOI ($${noi.toLocaleString()}) should not exceed Effective Gross Income ($${egi.toLocaleString()}).` });
    if (egi && opex && noi) {
      const impliedNOI = egi - opex;
      const diff = Math.abs(impliedNOI - noi) / noi;
      if (diff > 0.08) checks.push({ severity:"warn", label:"Income statement doesn't balance", detail:`EGI ($${egi.toLocaleString()}) − OpEx ($${opex.toLocaleString()}) = $${impliedNOI.toLocaleString()}, but NOI is $${noi.toLocaleString()} (${(diff*100).toFixed(0)}% gap).` });
    }
  }
  const hadData = !!(noi || price || sf || gpr);
  return { checks, errors: checks.filter(c => c.severity==="error").length, warns: checks.filter(c => c.severity==="warn").length, hadData };
}

// Build the post-import data-integrity review list: deterministic arithmetic
// checks (reconcileDeal, free) + missing core fields (assessExtraction, free) +
// the AI's own low-confidence flags (deal.reviewQuestions from extraction).
// Previously-resolved questions are preserved (so we don't re-ask), and the
// returned list is sorted high → low severity. Pure/idempotent — safe to call
// on every deal render and after each (re)upload.
const SEV_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
// Normalize a model-produced reviewQuestions array (OM/rent-roll/sales/loan
// extraction) into typed ReviewQuestions with stable, prefixed ids. The prefix
// (e.g. "ai-sales-", "ai-loan-") lets a re-upload drop its own prior flags
// without touching flags from other document types. Mirrors the OM extractor's
// shape so every doc type flags doubt the same way.
export function parseAiReviewQuestions(raw: unknown, idPrefix: string): ReviewQuestion[] {
  return (Array.isArray(raw) ? raw : [])
    .map((q, i) => {
      const r = q as Record<string, unknown>;
      const t = r.target as Record<string, unknown> | null | undefined;
      const target = t && (t.kind === "deal" || t.kind === "tenant") && typeof t.fieldKey === "string"
        ? {
            kind: t.kind as "deal" | "tenant",
            fieldKey: t.fieldKey as string,
            tenantName: typeof t.tenantName === "string" ? t.tenantName : null,
            valueType: (t.valueType === "text" ? "text" : "number") as "number" | "text",
          }
        : null;
      return {
        id: `${idPrefix}${i}-${String(r.field ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
        source: "ai" as const,
        severity: (["high", "medium", "low"].includes(r.severity as string) ? r.severity : "medium") as ReviewQuestion["severity"],
        field: typeof r.field === "string" ? r.field : null,
        question: typeof r.question === "string" ? r.question : "",
        detail: typeof r.detail === "string" ? r.detail : null,
        suggestedValue: r.suggestedValue != null ? String(r.suggestedValue) : null,
        target,
      } as ReviewQuestion;
    })
    .filter(q => q.question);
}

export function buildReviewQuestions(deal: Deal): ReviewQuestion[] {
  const prior = Array.isArray(deal.reviewQuestions) ? deal.reviewQuestions : [];
  const resolvedById = new Map(prior.filter(q => q.resolvedAt).map(q => [q.id, q]));
  const out: ReviewQuestion[] = [];
  const seen = new Set<string>();
  const add = (q: ReviewQuestion) => {
    if (seen.has(q.id)) return;
    seen.add(q.id);
    // Carry forward a prior resolution so confirmed/dismissed items stay quiet.
    const wasResolved = resolvedById.get(q.id);
    out.push(wasResolved ? { ...q, resolvedAt: wasResolved.resolvedAt, resolution: wasResolved.resolution } : q);
  };

  // 1) AI-flagged low-confidence captures carried on the deal. These may be raw
  //    from the model (OM extraction stores them as-is, without id/source), so
  //    normalize: anything not produced by a deterministic check is treated as AI.
  prior.forEach((raw, i) => {
    if (raw.source === "check") return; // deterministic checks are regenerated below
    const r = raw as Partial<ReviewQuestion> & Record<string, unknown>;
    if (!r.question) return;
    const id = r.id || `ai-${i}-${String(r.field ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`;
    const t = r.target as Record<string, unknown> | null | undefined;
    const target = t && (t.kind === "deal" || t.kind === "tenant") && typeof t.fieldKey === "string"
      ? {
          kind: t.kind as "deal" | "tenant",
          fieldKey: t.fieldKey as string,
          tenantName: typeof t.tenantName === "string" ? t.tenantName : null,
          valueType: (t.valueType === "text" ? "text" : "number") as "number" | "text",
        }
      : null;
    add({
      id,
      source: "ai",
      severity: (["high", "medium", "low"].includes(r.severity as string) ? r.severity : "medium") as ReviewQuestion["severity"],
      field: typeof r.field === "string" ? r.field : null,
      question: String(r.question),
      detail: typeof r.detail === "string" ? r.detail : null,
      suggestedValue: r.suggestedValue != null ? String(r.suggestedValue) : null,
      target,
      resolvedAt: r.resolvedAt ?? null,
      resolution: r.resolution ?? null,
    });
  });

  // 2) Deterministic arithmetic integrity checks.
  const { checks } = reconcileDeal(deal);
  for (const c of checks) {
    add({
      id: "calc-" + c.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      source: "check",
      severity: c.severity === "error" ? "high" : "medium",
      question: `${c.label} — does this look right, or was a number mis-captured?`,
      detail: c.detail,
    });
  }

  // 3) Missing core fields (only when the rest of the import looks substantive,
  //    so we don't nag on a deliberately thin entry).
  const { quality, missing } = assessExtraction(deal);
  if (quality === "partial" && missing.length > 0) {
    add({
      id: "missing-core",
      source: "check",
      severity: "medium",
      field: missing.join(", "),
      question: `Couldn't find ${missing.join(", ")} in this document — is it in there to capture, or genuinely not stated?`,
      detail: "These core fields drive the analysis; confirm whether they were missed or simply not disclosed.",
    });
  }

  return out.sort((a, b) => (SEV_RANK[a.severity] ?? 1) - (SEV_RANK[b.severity] ?? 1));
}

// Count of OPEN (unresolved) review questions — for badges.
export function openReviewCount(deal: Deal): number {
  return buildReviewQuestions(deal).filter(q => !q.resolvedAt).length;
}

// ── User-defined tenant merges ────────────────────────────────────────────────
// Persisted to localStorage; checked BEFORE the hardcoded TENANT_ALIASES.

const _USER_MERGES_KEY = "kpr_user_tenant_merges";

export interface UserMerge {
  id: string;
  canonical: string;
  variants: string[];
}

let _userMerges: UserMerge[] = (() => {
  try {
    const raw = localStorage.getItem(_USER_MERGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
})();

let _userAliases: Record<string, string> = {};

function rebuildUserAliases() {
  _userAliases = {};
  for (const m of _userMerges) {
    for (const v of m.variants) {
      _userAliases[_normTenant(v)] = m.canonical;
    }
  }
}

// Bootstrap on load — runs after _normTenant is defined.
// Also seeds _userMerges from IndexedDB so decisions persist across devices.
async function _seedFromIdb() {
  try {
    const decisions = await getTenantDecisions();
    const mergeDecisions = decisions.filter(d => d.type === "merge");
    let changed = false;
    for (const d of mergeDecisions) {
      if (!_userMerges.find(m => m.id === d.id)) {
        _userMerges.push({ id: d.id, canonical: d.nameA, variants: d.variants ?? [] });
        changed = true;
      }
    }
    if (changed) {
      rebuildUserAliases();
      try { localStorage.setItem(_USER_MERGES_KEY, JSON.stringify(_userMerges)); } catch { /**/ }
    }
    // Same for parent-company links (type "parent").
    let changedP = false;
    for (const d of decisions.filter(d => d.type === "parent")) {
      if (!_userParentLinks.find(l => l.id === d.id)) {
        _userParentLinks.push({ id: d.id, parent: d.nameA, brands: d.variants ?? [] });
        changedP = true;
      }
    }
    if (changedP) { rebuildParentLinks(); _persistParentLinks(); }
  } catch { /**/ }
}

Promise.resolve().then(rebuildUserAliases).then(rebuildParentLinks).then(_seedFromIdb);

// ── Server-persisted tenant decisions (source of truth, DB-backed) ────────────
export interface TenantDecisionRecord {
  id: string;
  type: "merge" | "dismiss" | "parent";
  nameA?: string | null;
  nameB?: string | null;
  canonical?: string | null;
  variants?: string[] | null;
}

export async function fetchServerDecisions(): Promise<TenantDecisionRecord[]> {
  try {
    const r = await fetch("/api/tenant-decisions", { credentials: "include" });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? (j as TenantDecisionRecord[]) : [];
  } catch { return []; }
}

export function saveServerDecision(d: TenantDecisionRecord): void {
  fetch("/api/tenant-decisions", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  }).catch(() => { /* non-fatal */ });
}

export function deleteServerDecision(id: string): void {
  fetch(`/api/tenant-decisions/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" }).catch(() => { /**/ });
}

// Hydrate in-memory merges from server decisions (called on app/audit load) so
// confirmed merges apply across the app on any browser/device.
export function applyServerMerges(decisions: TenantDecisionRecord[]): void {
  let changed = false;
  for (const d of decisions) {
    if (d.type !== "merge") continue;
    if (!_userMerges.find(m => m.id === d.id)) {
      _userMerges.push({ id: d.id, canonical: d.canonical ?? d.nameA ?? "", variants: d.variants ?? [] });
      changed = true;
    }
  }
  if (changed) {
    rebuildUserAliases();
    try { localStorage.setItem(_USER_MERGES_KEY, JSON.stringify(_userMerges)); } catch { /**/ }
  }
}

export function addUserMerge(merge: UserMerge): void {
  _userMerges = _userMerges.filter(m => m.id !== merge.id);
  _userMerges.push(merge);
  rebuildUserAliases();
  try { localStorage.setItem(_USER_MERGES_KEY, JSON.stringify(_userMerges)); } catch { /**/ }
  saveTenantDecision({ id: merge.id, type: "merge", nameA: merge.canonical, nameB: "", variants: merge.variants }).catch(() => { /**/ });
  // Permanent DB record of the decision (loaded back on any device).
  saveServerDecision({ id: merge.id, type: "merge", nameA: merge.canonical, canonical: merge.canonical, variants: merge.variants });
  // Aliases drive backend canonicalisation of the tenant index (analytics).
  const entries = merge.variants.map(v => ({
    rawName: v,
    canonicalName: merge.canonical,
    notes: "user-confirmed-merge",
  }));
  fetch("/api/aliases", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entries),
  }).catch(() => { /* non-fatal: local save already succeeded */ });
}

export function removeUserMerge(id: string): void {
  const m = _userMerges.find(x => x.id === id);
  _userMerges = _userMerges.filter(m => m.id !== id);
  rebuildUserAliases();
  try { localStorage.setItem(_USER_MERGES_KEY, JSON.stringify(_userMerges)); } catch { /**/ }
  removeTenantDecision(id).catch(() => { /**/ });
  deleteServerDecision(id);
  if (m) {
    for (const v of m.variants) {
      fetch(`/api/aliases/${encodeURIComponent(v)}`, { method: "DELETE", credentials: "include" }).catch(() => {});
    }
  }
}

export function getUserMerges(): UserMerge[] {
  return _userMerges;
}

// ── User-defined parent-company links ─────────────────────────────────────────
// A parent link groups DIFFERENT brands under a shared owner (e.g. TJ Maxx,
// Marshalls, HomeGoods → TJX). Unlike a merge it does NOT collapse the brands —
// they stay distinct in tenantKey/analytics — it only feeds parentCompany(), so
// you can roll up by owner without losing the individual brands. Persisted to
// the same tenant-decisions store (type "parent") for cross-device sync.
const _USER_PARENT_LINKS_KEY = "kpr_user_parent_links";

export interface ParentLink {
  id: string;
  parent: string;    // parent-company name (e.g. "TJX")
  brands: string[];  // brand names that roll up to it
}

let _userParentLinks: ParentLink[] = (() => {
  try {
    const raw = localStorage.getItem(_USER_PARENT_LINKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
})();

// brand key (tenantKey) -> parent name. Built from _userParentLinks.
let _parentByBrandKey: Record<string, string> = {};

function rebuildParentLinks() {
  _parentByBrandKey = {};
  for (const l of _userParentLinks) {
    if (!l.parent || !l.parent.trim()) continue;
    for (const b of l.brands) {
      const k = tenantKey(b);
      if (k) _parentByBrandKey[k] = l.parent.trim();
    }
  }
}

function _persistParentLinks() {
  try { localStorage.setItem(_USER_PARENT_LINKS_KEY, JSON.stringify(_userParentLinks)); } catch { /**/ }
}

export function getUserParentLinks(): ParentLink[] {
  return _userParentLinks;
}

export function addUserParentLink(link: ParentLink): void {
  _userParentLinks = _userParentLinks.filter(l => l.id !== link.id);
  _userParentLinks.push(link);
  rebuildParentLinks();
  _persistParentLinks();
  saveTenantDecision({ id: link.id, type: "parent", nameA: link.parent, nameB: "", variants: link.brands }).catch(() => { /**/ });
  saveServerDecision({ id: link.id, type: "parent", nameA: link.parent, canonical: link.parent, variants: link.brands });
}

export function removeUserParentLink(id: string): void {
  _userParentLinks = _userParentLinks.filter(l => l.id !== id);
  rebuildParentLinks();
  _persistParentLinks();
  removeTenantDecision(id).catch(() => { /**/ });
  deleteServerDecision(id);
}

// Hydrate parent links from server decisions (called next to applyServerMerges).
export function applyServerParentLinks(decisions: TenantDecisionRecord[]): void {
  let changed = false;
  for (const d of decisions) {
    if (d.type !== "parent") continue;
    if (!_userParentLinks.find(l => l.id === d.id)) {
      _userParentLinks.push({ id: d.id, parent: d.canonical ?? d.nameA ?? "", brands: d.variants ?? [] });
      changed = true;
    }
  }
  if (changed) { rebuildParentLinks(); _persistParentLinks(); }
}

// Split a single tenant name back out of whatever group it's in — used by the
// per-row "Unlink" on tenant detail pages when a stray variant snuck into a
// grouping. Removes the name from any user-merge it belongs to (collapsing the
// merge if only the canonical remains) and deletes its server-side alias, so the
// split flows through analytics on every device. Returns true if anything changed.
export function unlinkTenantName(rawName: string): boolean {
  const target = _normTenant(rawName);
  if (!target) return false;
  let changed = false;
  const remaining: UserMerge[] = [];
  for (const m of _userMerges) {
    if (!m.variants.some(v => _normTenant(v) === target)) { remaining.push(m); continue; }
    changed = true;
    const variants = m.variants.filter(v => _normTenant(v) !== target);
    const distinct = new Set(variants.map(_normTenant)); distinct.add(_normTenant(m.canonical));
    if (distinct.size >= 2) {
      // Merge still links ≥2 names — keep it, trimmed.
      remaining.push({ ...m, variants });
      saveTenantDecision({ id: m.id, type: "merge", nameA: m.canonical, nameB: "", variants }).catch(() => { /**/ });
      saveServerDecision({ id: m.id, type: "merge", nameA: m.canonical, canonical: m.canonical, variants });
    } else {
      // Nothing left to link — drop the whole merge.
      removeTenantDecision(m.id).catch(() => { /**/ });
      deleteServerDecision(m.id);
    }
  }
  if (changed) {
    _userMerges = remaining;
    rebuildUserAliases();
    try { localStorage.setItem(_USER_MERGES_KEY, JSON.stringify(_userMerges)); } catch { /**/ }
  }
  // Always clear the backend alias for this name so the tenant index splits it too.
  fetch(`/api/aliases/${encodeURIComponent(rawName)}`, { method: "DELETE", credentials: "include" }).catch(() => { /**/ });
  return changed;
}

// ── Tenant-name normalisation ─────────────────────────────────────────────────
// These helpers ensure that spelling variants of the same brand (e.g. "T Mobile",
// "T-Mobile", "TMobile") collapse to one key in every cross-deal grouping.
//
// To merge a brand that still splits, add ONE entry to TENANT_ALIASES:
//   "normalized variant": "Canonical Display Name"
// The left side must be the *normalized* form (lowercase, no punctuation).
export const TENANT_ALIASES: Record<string, string> = {
  "ulta": "Ulta Beauty",
  "tj maxx": "TJ Maxx", "tjmaxx": "TJ Maxx",
  "t mobile": "T-Mobile", "tmobile": "T-Mobile",
  "at and t": "AT&T", "att": "AT&T", "at t": "AT&T",
  "cvs": "CVS",
  "bath and body works": "Bath & Body Works",
  "dicks sporting goods": "Dick's Sporting Goods", "dicks": "Dick's Sporting Goods",
  "jersey mikes": "Jersey Mike's",
  "chick fil a": "Chick-fil-A", "chickfila": "Chick-fil-A",
  "bjs wholesale club": "BJ's Wholesale Club", "bjs": "BJ's Wholesale Club",
  "sams club": "Sam's Club",
  "trader joes": "Trader Joe's",
  "macys": "Macy's", "kohls": "Kohl's",
  "lowes": "Lowe's", "lowes home improvement": "Lowe's",
  "raising canes": "Raising Cane's",
  "mcdonalds": "McDonald's", "wendys": "Wendy's", "dennys": "Denny's",
  "applebees": "Applebee's",
  "five guys": "Five Guys", "5 guys": "Five Guys",
  "ups": "The UPS Store", "ups store": "The UPS Store",
  "americas best": "America's Best Contacts & Eyecare",
  "americas best contacts": "America's Best Contacts & Eyecare",
  "at and t mobility": "AT&T",
  "burlington coat": "Burlington",
  "burlington coat factory": "Burlington",
  "suntrust": "Truist Bank", "suntrust bank": "Truist Bank", "truist": "Truist Bank",
  "wal mart": "Walmart", "wal mart supercenter": "Walmart", "walmart supercenter": "Walmart",
  "carters osh kosh": "Carter's",
  "carters babies and kids": "Carter's",
  "edward d jones": "Edward Jones",
  "mens warehouse": "Men's Wearhouse",
  "lets lose weight loss and wellness": "Let's Lose Weight",
  "vestavia hill nutrition": "Vestavia Hills Nutrition",
  // ── nationals ───────────────────────────────────────────────────────────────
  "stop and shop": "Stop & Shop", "stop shop": "Stop & Shop",
  "ross dress for less": "Ross Dress for Less", "ross": "Ross Dress for Less",
  "t j maxx": "TJ Maxx",
  "bed bath and beyond": "Bed Bath & Beyond",
  "barnes and noble": "Barnes & Noble",
  "dick sporting goods": "Dick's Sporting Goods",
  "nordstrom rack": "Nordstrom Rack",
  "tj maxx homegoods": "TJ Maxx / HomeGoods",
  "homegoods": "HomeGoods", "home goods": "HomeGoods",
  "petco": "Petco", "petsmart": "PetSmart",
  "old navy": "Old Navy", "five below": "Five Below",
  "dollar tree": "Dollar Tree", "family dollar": "Family Dollar", "dollar general": "Dollar General",
  "michaels": "Michaels", "hobby lobby": "Hobby Lobby",
  "jo ann": "Jo-Ann", "joann": "Jo-Ann",
  "marshalls": "Marshalls",
  "burlington": "Burlington",
  "ulta beauty": "Ulta Beauty",
  "best buy": "Best Buy",
  "home depot": "The Home Depot",
  "target": "Target", "walmart": "Walmart", "costco": "Costco",
  "whole foods": "Whole Foods Market", "whole foods market": "Whole Foods Market",
  "sprouts farmers market": "Sprouts", "sprouts": "Sprouts",
  "aldi": "ALDI", "lidl": "Lidl",
  "publix": "Publix", "kroger": "Kroger", "safeway": "Safeway",
  "giant food": "Giant", "giant": "Giant",
  "wegmans": "Wegmans", "harris teeter": "Harris Teeter",
  "heb": "H-E-B", "h e b": "H-E-B",
  "winn dixie": "Winn-Dixie", "food lion": "Food Lion",
  "jewel osco": "Jewel-Osco", "meijer": "Meijer",
  "marcs": "Marc's",
  "cub foods": "Cub Foods", "giant eagle": "Giant Eagle",
  "bank of america": "Bank of America", "wells fargo": "Wells Fargo",
  "chase bank": "Chase", "jpmorgan chase": "Chase",
  "third federal": "Third Federal Savings",
  "fedex office": "FedEx Office", "fedex kinkos": "FedEx Office",
  "great clips": "Great Clips", "sport clips": "Sport Clips",
  "supercuts": "Supercuts", "hair cuttery": "Hair Cuttery",
  "orange theory fitness": "Orangetheory Fitness",
  "orangetheory fitness": "Orangetheory Fitness", "orangetheory": "Orangetheory Fitness",
  "planet fitness": "Planet Fitness", "la fitness": "LA Fitness",
  "anytime fitness": "Anytime Fitness",
  "gold gym": "Gold's Gym", "golds gym": "Gold's Gym",
  "massage envy": "Massage Envy", "european wax center": "European Wax Center",
  "chipotle mexican grill": "Chipotle", "chipotle": "Chipotle",
  "panera bread": "Panera Bread", "panera": "Panera Bread",
  "starbucks": "Starbucks",
  "dunkin": "Dunkin'", "dunkin donuts": "Dunkin'",
  "subway": "Subway",
  "jersey mikes subs": "Jersey Mike's",
  "five guys burgers and fries": "Five Guys",
  "shake shack": "Shake Shack", "wingstop": "Wingstop",
  "tropical smoothie cafe": "Tropical Smoothie Café",
  "moes southwest grill": "Moe's Southwest Grill",
  "att mobility": "AT&T",
  "verizon wireless": "Verizon", "verizon": "Verizon", "sprint": "Sprint",
  "amc theatres": "AMC Theatres", "amc": "AMC Theatres", "american multi cinema": "AMC Theatres", "american multiplex cinema": "AMC Theatres",
  "regal cinemas": "Regal Cinemas", "cinemark": "Cinemark",
  "cvs pharmacy": "CVS", "walgreens": "Walgreens", "rite aid": "Rite Aid",
  "quest diagnostics": "Quest Diagnostics", "labcorp": "LabCorp",
  "heartland dental": "Heartland Dental", "aspen dental": "Aspen Dental",
  "my eye dr": "MyEyeDr.", "myeyedr": "MyEyeDr.",
  "vision works": "Visionworks",
  "navy federal credit union": "Navy Federal Credit Union",
  "taco bell": "Taco Bell",
  "chick fila": "Chick-fil-A",
  // ── add your own variants here (one per line) ──────────────────────────────
};

export const PARENT_COMPANIES: Record<string, string> = {
  "tj maxx": "TJX Companies", "tjmaxx": "TJX Companies",
  "marshalls": "TJX Companies", "homegoods": "TJX Companies",
  "home goods": "TJX Companies", "homesense": "TJX Companies",
  "sierra": "TJX Companies",
  "ross dress for less": "Ross Stores", "ross": "Ross Stores",
  "dds discounts": "Ross Stores",
  "dollar tree": "Dollar Tree Inc.", "family dollar": "Dollar Tree Inc.",
  "gap": "Gap Inc.", "old navy": "Gap Inc.", "banana republic": "Gap Inc.", "athleta": "Gap Inc.",
  "kay jewelers": "Signet Jewelers", "zales": "Signet Jewelers", "jared": "Signet Jewelers",
  "lane bryant": "Authentic Brands Group", "justice": "Authentic Brands Group",
  "foot locker": "Foot Locker Inc.", "kids foot locker": "Foot Locker Inc.", "champs sports": "Foot Locker Inc.",
  "bath and body works": "Bath & Body Works Inc.", "victorias secret": "Victoria's Secret & Co.",
  "coach": "Tapestry", "kate spade": "Tapestry",
  "vans": "VF Corporation", "the north face": "VF Corporation", "timberland": "VF Corporation",
  "stop and shop": "Ahold Delhaize", "stop shop": "Ahold Delhaize",
  "giant food": "Ahold Delhaize", "giant": "Ahold Delhaize",
  "food lion": "Ahold Delhaize", "hannaford": "Ahold Delhaize",
  "safeway": "Albertsons Companies", "albertsons": "Albertsons Companies",
  "jewel osco": "Albertsons Companies", "vons": "Albertsons Companies",
  "acme": "Albertsons Companies", "shaws": "Albertsons Companies",
  "star market": "Albertsons Companies", "tom thumb": "Albertsons Companies",
  "randalls": "Albertsons Companies", "pavilions": "Albertsons Companies",
  "carrs": "Albertsons Companies", "united supermarkets": "Albertsons Companies",
  // The Kroger Co. and its regional banners
  "kroger": "The Kroger Co.", "king soopers": "The Kroger Co.",
  "kings soopers": "The Kroger Co.", "fry s": "The Kroger Co.", "frys": "The Kroger Co.",
  "fry s food": "The Kroger Co.", "ralphs": "The Kroger Co.", "smiths": "The Kroger Co.",
  "smith s": "The Kroger Co.", "frys food": "The Kroger Co.",
  "qfc": "The Kroger Co.", "harris teeter": "The Kroger Co.",
  "dillons": "The Kroger Co.", "food 4 less": "The Kroger Co.", "foods co": "The Kroger Co.",
  "fred meyer": "The Kroger Co.", "city market": "The Kroger Co.", "baker s": "The Kroger Co.",
  "bakers": "The Kroger Co.", "gerbes": "The Kroger Co.", "pick n save": "The Kroger Co.",
  "metro market": "The Kroger Co.", "marianos": "The Kroger Co.", "mariano s": "The Kroger Co.",
  "ruler foods": "The Kroger Co.",
  // Other major grocers / wholesale (canonical = the operating brand)
  "walmart": "Walmart Inc.", "walmart neighborhood market": "Walmart Inc.",
  "sams club": "Walmart Inc.", "sam s club": "Walmart Inc.",
  "costco": "Costco Wholesale", "costco wholesale": "Costco Wholesale",
  "target": "Target Corporation",
  "whole foods": "Amazon", "whole foods market": "Amazon",
  "trader joes": "Trader Joe's", "trader joe s": "Trader Joe's",
  "publix": "Publix Super Markets", "publix supermarkets": "Publix Super Markets", "heb": "H-E-B", "h e b": "H-E-B",
  "meijer": "Meijer", "wegmans": "Wegmans", "aldi": "Aldi",
  "sprouts": "Sprouts Farmers Market", "sprouts farmers market": "Sprouts Farmers Market",
  "winco": "WinCo Foods", "winco foods": "WinCo Foods",
  "save a lot": "Save A Lot", "grocery outlet": "Grocery Outlet",
  "bjs": "BJ's Wholesale Club", "bj s": "BJ's Wholesale Club",
  "bjs wholesale": "BJ's Wholesale Club", "bj s wholesale club": "BJ's Wholesale Club",
  "weis": "Weis Markets", "weis markets": "Weis Markets",
  "ingles": "Ingles Markets", "ingles markets": "Ingles Markets",
  // Home / hardware
  "home depot": "The Home Depot", "the home depot": "The Home Depot",
  "lowes": "Lowe's", "lowe s": "Lowe's",
  "petsmart": "PetSmart", "petco": "Petco",
  // Off-price / discount (own parents)
  "dollar general": "Dollar General",
  "five below": "Five Below", "big lots": "Big Lots",
  "ollies": "Ollie's Bargain Outlet", "ollie s": "Ollie's Bargain Outlet",
  "ollie s bargain": "Ollie's Bargain Outlet", "ollies bargain": "Ollie's Bargain Outlet",
  "taco bell": "Yum! Brands", "kfc": "Yum! Brands", "pizza hut": "Yum! Brands",
  "burger king": "Restaurant Brands Intl.", "tim hortons": "Restaurant Brands Intl.",
  "popeyes": "Restaurant Brands Intl.", "firehouse subs": "Restaurant Brands Intl.",
  "arbys": "Inspire Brands", "buffalo wild wings": "Inspire Brands",
  "sonic": "Inspire Brands", "dunkin": "Inspire Brands",
  "olive garden": "Darden Restaurants", "longhorn steakhouse": "Darden Restaurants",
  "the capital grille": "Darden Restaurants", "seasons 52": "Darden Restaurants",
  "chilis": "Brinker International", "maggianos": "Brinker International",
  "outback steakhouse": "Bloomin' Brands", "bonefish grill": "Bloomin' Brands",
  "supercuts": "Regis Corporation", "hair cuttery": "Regis Corporation",
  "anytime fitness": "Self Esteem Brands", "orangetheory": "Self Esteem Brands",
  "orangetheory fitness": "Self Esteem Brands",
  "cvs": "CVS Health", "cvs pharmacy": "CVS Health",
  "walgreens": "Walgreens Boots Alliance",
  "chase": "JPMorgan Chase", "jpmorgan chase": "JPMorgan Chase",
  "att": "AT&T Inc.", "att mobility": "AT&T Inc.",
  "t mobile": "T-Mobile US", "sprint": "T-Mobile US",
  "nordstrom rack": "Nordstrom Inc.", "nordstrom": "Nordstrom Inc.",
  "burlington": "Burlington Stores", "burlington coat factory": "Burlington Stores",
};

export function parentCompany(name: unknown, storedParent?: string | null): string | null {
  // Prefer the curated map: it gives ONE canonical parent name per brand, so
  // banners like King Soopers/Ralphs/Fry's all roll up to "The Kroger Co." and
  // aren't split by inconsistent AI-extracted parent strings. Fall back to the
  // stored value only for brands the map doesn't know.
  const key = tenantKey(name);
  // A user-defined parent link wins over everything — it's an explicit decision.
  if (_parentByBrandKey[key]) return _parentByBrandKey[key];
  if (PARENT_COMPANIES[key]) return PARENT_COMPANIES[key];
  // An ATM rolls up to the SAME parent as the branch brand (it's tracked as its
  // own tenant, but belongs to e.g. JPMorgan Chase just like a Chase branch).
  const stripped = String(name ?? "").replace(/\b(atms?|cash machine)\b/ig, " ").replace(/\s+/g, " ").trim();
  if (stripped && stripped.toLowerCase() !== String(name ?? "").trim().toLowerCase()) {
    const k2 = tenantKey(stripped);
    if (PARENT_COMPANIES[k2]) return PARENT_COMPANIES[k2];
  }
  return storedParent && storedParent.trim() ? storedParent.trim() : null;
}

// Redundant format/descriptor words safe to strip from the END of a name.
// Only pure legal/entity suffixes that never appear in real brand names.
const _TENANT_TRAIL = new Set([
  "salon","salons","outlet","outlets","factory","factories",
  "supercenter","pharmacy","wireless",
  // Legal/entity suffixes — always safe to strip.
  "inc","incorporated","llc","corp","corporation","co","company","companies",
  "ltd","limited","lp","llp","plc","na","holdings","holding",
]);
// Corporate filler that's usually a suffix but CAN be part of a real brand
// ("The Container Store", "Burlington Stores"). Strip only when ≥3 words are
// present (≥2 brand words remain after removal), so two-word brands keep their
// identity while "Best Buy Stores", "Dollar Tree Stores" collapse correctly.
// Known two-word exceptions (e.g. "Walmart Stores") are handled by the alias map.
const _TENANT_TRAIL_SOFT = new Set([
  "stores","store","enterprises","enterprise","partners","partnership","markets",
]);

/** Lowercase, punctuation-free normalised form of a tenant name. */
export function _normTenant(name: unknown): string {
  let s = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.toLowerCase()
       .replace(/\([^)]*\)/g, " ")
       .replace(/['.]/g, "")
       .replace(/&/g, " and ")
       .replace(/#\s*[a-z0-9][\w-]*/gi, " ")
       .replace(/[^a-z0-9]+/g, " ")
       .replace(/\s+/g, " ")
       .trim();
  s = s.replace(/\s*\b(absolute\s+net|triple\s+net|modified\s+gross|ground|net|nnn|gross)\s+lease\b\s*/g, " ")
       .replace(/\s+/g, " ")
       .trim();
  if (s.startsWith("the ")) s = s.slice(4);
  let parts = s.split(" ").filter(Boolean);
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (_TENANT_TRAIL.has(last) || /^\d+$/.test(last)) { parts.pop(); continue; }
    // Soft filler ("Stores", etc.): only strip if ≥2 brand words would remain.
    if (parts.length >= 3 && _TENANT_TRAIL_SOFT.has(last)) { parts.pop(); continue; }
    break;
  }
  return parts.join(" ");
}

/** Returns true for any blank, vacant, available, spec, or white-box entry. */
export function isVacant(name: unknown): boolean {
  const s = String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s || s === "-" || s === "–" || s === "—" || s === "n/a" || s === "na") return true;
  const c = s.replace(/^[\s\-–—•·*"']+/, "");
  if (/^vacan/.test(c)) return true;
  if (/^availab/.test(c)) return true;
  if (/^spec\s+(suite|space|unit)/.test(c)) return true;
  if (/white\s*box/.test(c)) return true;
  return false;
}

export function isNAPTenant(t: { name?: string | null; sf?: number | string | null; annualRent?: number | string | null; rentPerSF?: number | string | null; isNAP?: boolean | null; leaseStart?: string | null; leaseExpiry?: string | null; rentSchedule?: string | null }): boolean {
  if (t.isNAP === true) return true;
  if (isVacant(t.name)) return false;
  // A signed lease (lease dates or a rent schedule) means a REAL tenant even when
  // current rent shows $0 — they're PRE-COMMENCEMENT (rent starts on a future
  // date / build-out / free-rent), not a Not-A-Part parcel. Only treat $0-rent
  // occupied space as NAP when there's no lease at all (a ground-leased pad).
  const hasLease = !!(
    (typeof t.leaseStart === "string" && t.leaseStart.trim()) ||
    (typeof t.leaseExpiry === "string" && t.leaseExpiry.trim()) ||
    (typeof t.rentSchedule === "string" && t.rentSchedule.trim())
  );
  if (hasLease) return false;
  const sf = t.sf == null || t.sf === "" ? null : Number(t.sf);
  const rent = t.annualRent == null || t.annualRent === "" ? null : Number(t.annualRent);
  const rentPSF = t.rentPerSF == null || t.rentPerSF === "" ? null : Number(t.rentPerSF);
  return sf != null && sf > 0 && (rent == null || rent === 0) && (rentPSF == null || rentPSF === 0);
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Parse a lease date string into a Date at local noon (so a bare date never
// shifts a day across time zones). Handles ISO YYYY-MM-DD, YYYY-MM, MM/DD/YYYY,
// M/YY month-year, "Mon-YYYY"/"January 2030", and bare YYYY. Returns null when
// unparseable. Shared so roster math, WALT, and the rollover chart all agree.
export function parseLeaseDate(raw: unknown): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const d = new Date(s + "T12:00:00"); return isNaN(d.getTime()) ? null : d; }
  if (/^\d{4}-\d{2}$/.test(s)) { const [y, m] = s.split("-").map(Number); return new Date(y, m, 0, 12); }
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [mo, d, y] = s.split("/").map(Number);
    const fy = y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y;
    const dt = new Date(fy, mo - 1, d, 12); return isNaN(dt.getTime()) ? null : dt;
  }
  if (/^\d{1,2}\/\d{2,4}$/.test(s)) {
    const [mo, y] = s.split("/").map(Number);
    const fy = y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y;
    if (mo >= 1 && mo <= 12) return new Date(fy, mo, 0, 12);
  }
  const monYear = s.match(/^([A-Za-z]{3,9})[-\s](\d{2}|\d{4})$/);
  if (monYear) {
    const mon = MONTH_MAP[monYear[1].toLowerCase().slice(0, 3)];
    const ry = parseInt(monYear[2], 10);
    const yr = ry < 100 ? (ry < 50 ? 2000 + ry : 1900 + ry) : ry;
    if (mon !== undefined && !isNaN(yr)) return new Date(yr, mon + 1, 0, 12);
  }
  if (/^\d{4}$/.test(s)) return new Date(parseInt(s, 10), 11, 31, 12);
  return null;
}

// Recompute the roster-derived deal metrics (occupancy, WALT, weighted-avg rent
// PSF) from a fresh tenant list + as-of date. Used by the deal page's roster
// paste and rent-roll refresh. Key correctness points:
//  - WALT term is derived from each tenant's leaseExpiry vs the as-of date — the
//    pasted/extracted JSON usually omits a fresh remainingTermYears, so trusting
//    it wrote a 0 WALT over a good one.
//  - Vacant and NAP/outparcel rows are excluded from occupancy and WALT.
//  - Never writes a 0/empty metric over an existing value, and respects the
//    deal's verified locks.
export function recomputeRosterMetrics(
  tenants: Array<Record<string, unknown>>,
  asOf: string | null | undefined,
  deal: { totalSF?: number | string | null; verified?: Record<string, unknown> | null | undefined },
): { occupancy?: number; walt?: number; weightedAvgRentPSF?: number } {
  const nv = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const ref = parseLeaseDate(asOf) ?? new Date();
  const verified = (deal.verified || {}) as Record<string, unknown>;
  const out: { occupancy?: number; walt?: number; weightedAvgRentPSF?: number } = {};
  const occ = tenants.filter(t => !isVacant(t.name) && !isNAPTenant(t as Parameters<typeof isNAPTenant>[0]));
  const totalSF = nv(deal.totalSF);

  if (!verified.occupancy && totalSF && totalSF > 0) {
    const occupiedSF = occ.reduce((s, t) => s + (nv(t.sf) ?? 0), 0);
    const o = Math.round(occupiedSF / totalSF * 1000) / 10;
    if (o > 0 && o <= 100) out.occupancy = o;
  }
  if (!verified.walt) {
    let sfT = 0, wT = 0;
    for (const t of occ) {
      const sf = nv(t.sf); if (!sf || sf <= 0) continue;
      const exp = parseLeaseDate(t.leaseExpiry);
      const yr = exp ? Math.max(0, (exp.getTime() - ref.getTime()) / (365.25 * 86_400_000)) : nv(t.remainingTermYears);
      if (yr == null) continue;
      sfT += sf; wT += sf * yr;
    }
    if (wT > 0 && sfT > 0) out.walt = Math.round(wT / sfT * 10) / 10;
  }
  if (!verified.weightedAvgRentPSF) {
    let sfR = 0, wR = 0;
    for (const t of occ) {
      const sf = nv(t.sf), r = nv(t.rentPerSF);
      if (sf && sf > 0 && r && r > 0) { sfR += sf; wR += sf * r; }
    }
    if (sfR > 0) out.weightedAvgRentPSF = Math.round(wR / sfR * 100) / 100;
  }
  return out;
}

// Distinguish a standalone ATM (a kiosk/license, operationally trivial) from a
// real bank BRANCH. Two tells: the name often says "ATM", and the footprint is
// tiny (a kiosk is well under a branch's few-thousand SF). Tracked separately
// from branches in analytics, though they roll up to the same parent company.
export function isATM(name?: unknown, sf?: number | string | null): boolean {
  const n = String(name ?? "");
  if (/\batms?\b/i.test(n)) return true;
  const s = sf == null || sf === "" ? null : Number(sf);
  // SF giveaway: a clearly bank/financial tenant with a kiosk-sized footprint.
  if (s != null && s > 0 && s <= 200 && /\b(bank|banking|credit union|fcu|f\.?c\.?u\.?|federal credit|financial)\b/i.test(n)) return true;
  return false;
}

// ── Expense-recovery estimation ──────────────────────────────────────────────
// OMs disclose per-tenant recoveries only sometimes. When they don't, we estimate
// each recovery-paying tenant's annual expense reimbursements by ALLOCATING the
// property-level recovery revenue across the recovery-paying tenants, weighted by
// SF. Best-effort, clearly flagged as estimated — close enough for occupancy-cost
// / health-ratio purposes, never presented as OM-disclosed.

type RecoveryTenant = {
  name?: string | null; canonicalName?: string | null; sf?: number | string | null;
  reimbursementMethod?: string | null; leaseType?: string | null;
  expenseReimbursements?: number | null; isNAP?: boolean | null;
  annualRent?: number | string | null; rentPerSF?: number | string | null;
  percentageRent?: number | string | null; otherRent?: number | string | null;
};

const _num = (v: unknown): number | null =>
  v == null || v === "" || isNaN(Number(v)) ? null : Number(v);

/** True if a tenant's lease pays expense recoveries (NNN/NN/net), not gross. */
export function paysRecoveries(t: { reimbursementMethod?: string | null; leaseType?: string | null }): boolean {
  const m = `${t.reimbursementMethod || ""} ${t.leaseType || ""}`.toLowerCase();
  if (!m.trim()) return false;
  if (/\bgross\b/.test(m) && !/modified|net/.test(m)) return false; // pure gross → no recovery
  // NNN / triple net / double net / net / CAM / "n n n" / recover*
  return /\bn\s*n\s*n\b|triple\s*net|double\s*net|\bnnn\b|\bnn\b|\bnet\b|\bcam\b|recover/.test(m);
}

interface RecoveryEstimate {
  /** Per-tenant annual recoveries — disclosed value when present, else estimated. */
  byName: Map<string, { value: number; estimated: boolean }>;
  /** Property-level recovery pool used for the estimate, and its source. */
  poolTotal: number | null;
  poolSource: string | null;
}

/**
 * Estimate per-tenant expense recoveries for a deal. Tenants with an OM-disclosed
 * `expenseReimbursements` keep that exact figure; the remaining property-level
 * recovery pool is spread across the other recovery-paying tenants by SF share.
 */
export function estimateRecoveries(deal: {
  tenants?: RecoveryTenant[] | null;
  nnnRecoveries?: number | null;
  incomeBreakdown?: Record<string, number | null> | null;
  cashFlowProjection?: Array<{ reimbursements?: number | null }> | null;
  effectiveGrossIncome?: number | null;
  grossPotentialRent?: number | null;
}): RecoveryEstimate {
  const tenants = (deal.tenants || []).filter(t => !isVacant(t.name) && !isNAPTenant(t));
  const byName = new Map<string, { value: number; estimated: boolean }>();

  // 1) Property-level recovery pool — first available reliable source.
  const ib = deal.incomeBreakdown || {};
  const ibSum = (_num(ib.camReimbursements) ?? 0) + (_num(ib.realEstateTaxReimbursements) ?? 0) + (_num(ib.insuranceReimbursements) ?? 0);
  const cfReimb = (Array.isArray(deal.cashFlowProjection) ? deal.cashFlowProjection : []).map(r => _num(r?.reimbursements)).find(v => v != null) ?? null;
  let pool: number | null = null;
  let poolSource: string | null = null;
  if (_num(deal.nnnRecoveries) != null) { pool = _num(deal.nnnRecoveries); poolSource = "OM recovery income"; }
  else if (ibSum > 0) { pool = ibSum; poolSource = "OM income breakdown (CAM+tax+insurance)"; }
  else if (cfReimb != null && cfReimb > 0) { pool = cfReimb; poolSource = "OM cash-flow reimbursements"; }
  else if (_num(deal.effectiveGrossIncome) != null && _num(deal.grossPotentialRent) != null) {
    const diff = (_num(deal.effectiveGrossIncome) as number) - (_num(deal.grossPotentialRent) as number);
    if (diff > 0) { pool = diff; poolSource = "OM EGI − base rent"; }
  }

  // 2) Disclosed tenants keep their exact figure; subtract from the pool.
  let remainingPool = pool;
  let disclosedTotal = 0;
  for (const t of tenants) {
    const disc = _num(t.expenseReimbursements);
    if (disc != null && disc > 0) {
      byName.set(tenantKey(t.canonicalName ?? t.name), { value: disc, estimated: false });
      disclosedTotal += disc;
    }
  }
  if (remainingPool != null) remainingPool = Math.max(0, remainingPool - disclosedTotal);

  // 3) Spread the remaining pool across recovery-paying tenants WITHOUT a
  //    disclosed figure, weighted by SF.
  if (remainingPool != null && remainingPool > 0) {
    const eligible = tenants.filter(t => {
      const key = tenantKey(t.canonicalName ?? t.name);
      return !byName.has(key) && paysRecoveries(t) && (_num(t.sf) ?? 0) > 0;
    });
    const totalSf = eligible.reduce((s, t) => s + (_num(t.sf) ?? 0), 0);
    if (totalSf > 0) {
      for (const t of eligible) {
        const share = (_num(t.sf) as number) / totalSf;
        byName.set(tenantKey(t.canonicalName ?? t.name), { value: Math.round(remainingPool * share), estimated: true });
      }
    }
  }

  return { byName, poolTotal: pool, poolSource };
}

export interface LatestSale {
  salesPSF: number | null;
  grossSales: number | null;
  salesYear: number | null;
  occupancyCost: number | null;
  occSource?: "stated" | "computed";
  occBreakdown?: import("./idb").OccBreakdown | null;
}

/**
 * Per-tenant latest sales + occupancy cost, derived the same way as the Tenant
 * Sales panel (gross→PSF, recoveries-aware occ cost), so the tenant roster can
 * mirror the sales table. Uses the most recent uploaded sales year per tenant,
 * falling back to OM-stated sales on the roster. Returns a map keyed by tenantKey.
 */
export function buildLatestSales(deal: {
  tenants?: RecoveryTenant[] | null;
  tenantSalesHistory?: Array<{ year: number; source?: string; tenants: Array<{ name: string; salesPSF?: number | null; annualSales?: number | null; sf?: number | null; occupancyCost?: number | null }> }> | null;
} & Parameters<typeof estimateRecoveries>[0]): Map<string, LatestSale> {
  const out = new Map<string, LatestSale>();
  const rec = estimateRecoveries(deal).byName;
  const roster = new Map((deal.tenants || []).map(t => [tenantKey(t.canonicalName ?? t.name), t]));

  // Most-recent uploaded sales record per tenant (highest year wins; uploads over OM).
  const latestByKey = new Map<string, { year: number; r: { salesPSF?: number | null; annualSales?: number | null; sf?: number | null; occupancyCost?: number | null }; isUpload: boolean }>();
  for (const snap of deal.tenantSalesHistory || []) {
    const isUpload = snap.source !== "om";
    for (const r of snap.tenants) {
      const key = tenantKey(stripSuiteCode(r.name));
      const cur = latestByKey.get(key);
      if (!cur || (isUpload && !cur.isUpload) || (isUpload === cur.isUpload && snap.year > cur.year)) {
        latestByKey.set(key, { year: snap.year, r, isUpload });
      }
    }
  }

  for (const [key, { r, year }] of latestByKey) {
    const rt = roster.get(key);
    let sf = _num(r.sf) ?? _num(rt?.sf);
    let psf = _num(r.salesPSF);
    let gross = _num(r.annualSales);
    if (psf == null && gross != null && sf != null && sf > 0) psf = Math.round((gross / sf) * 100) / 100;
    if (gross == null && psf != null && sf != null && sf > 0) gross = Math.round(psf * sf);

    let occupancyCost = _num(r.occupancyCost);
    let occSource: "stated" | "computed" | undefined = occupancyCost != null ? "stated" : undefined;
    let occBreakdown: import("./idb").OccBreakdown | null = null;
    const base = _num(rt?.annualRent);
    const disclosed = _num(rt?.expenseReimbursements);
    const est = rec.get(key);
    const reimb = disclosed ?? (est ? est.value : null);
    const reimbEstimated = disclosed == null && !!est?.estimated;
    const pctRent = _num(rt?.percentageRent) ?? 0, other = _num(rt?.otherRent) ?? 0;
    // Compute occ-cost only when it wasn't stated on the report — a disclosed
    // figure is authoritative and isn't overwritten by a derived (possibly
    // estimated-reimbursement) one.
    if (occupancyCost == null && base != null && reimb != null && gross != null && gross > 0) {
      const total = base + reimb + pctRent + other;
      occupancyCost = Math.round((total / gross) * 1000) / 10;
      occSource = "computed";
      occBreakdown = { base, reimbursements: reimb, percentRent: pctRent, other, total, sales: gross, reimbEstimated };
    }
    out.set(key, { salesPSF: psf, grossSales: gross, salesYear: year ?? null, occupancyCost, occSource, occBreakdown });
  }
  return out;
}

/**
 * Build a per-deal map of resolved latest sales, keyed by deal id (then fileName).
 * Lets cross-property views (Tenant page, Parent page, Tenant Analytics) surface
 * UPLOADED sales (from tenantSalesHistory) the same way the deal page does —
 * instead of only reading the raw roster `salesPSF`, which uploads never write back.
 */
export function buildSalesByDeal(deals: Deal[]): Map<string, Map<string, LatestSale>> {
  const m = new Map<string, Map<string, LatestSale>>();
  for (const d of deals) m.set(d.id || d.fileName || "?", buildLatestSales(d));
  return m;
}

/**
 * Effective per-SF sales for one roster tenant: prefer the resolved uploaded-sales
 * value (tenantSalesHistory, uploads-over-OM, derived from gross÷SF when needed),
 * else fall back to the roster's own OM-stated `salesPSF`. This is the single
 * source of truth for sales in every cross-property/aggregate view.
 */
export function resolveSalesPSF(
  salesByDeal: Map<string, Map<string, LatestSale>>,
  deal: { id?: string; fileName?: string },
  t: { name?: string | null; canonicalName?: string | null; salesPSF?: number | string | null },
): number | null {
  const resolved = salesByDeal.get(deal.id || deal.fileName || "?")?.get(tenantKey(t.canonicalName ?? t.name))?.salesPSF;
  if (resolved != null) return resolved;
  const raw = t.salesPSF;
  if (raw == null || (raw as unknown) === "" || isNaN(Number(raw))) return null;
  return Number(raw);
}

/** Stable grouping key — every spelling of one brand collapses to the same string. */
export function tenantKey(name: unknown): string {
  const n = _normTenant(name);
  if (_userAliases[n]) return _normTenant(_userAliases[n]);
  const alias = TENANT_ALIASES[n];
  return alias ? _normTenant(alias) : n;
}

/**
 * Strip a leading or trailing SUITE / UNIT code from a sales-report tenant name
 * so it matches the clean roster brand. Sales reports label tenants like
 * "A06 Elite Nutrition", "MH01 Samurai Japan", "P Publix Supermarkets",
 * "Taco Mama 194A". Conservative — only removes things that look like unit codes,
 * never real brand words. Used ONLY in the sales-matching path (not _normTenant),
 * so comp / analytics / watchlist grouping is unaffected.
 */
export function stripSuiteCode(name: unknown): string {
  const original = String(name ?? "").trim();
  let s = original
    // Leading alphanumeric unit code: "A06", "MH01", "P02", "MB04", "A-05".
    .replace(/^[A-Za-z]{1,4}-?\d{1,4}[A-Za-z]?[\s.:)\-]+/, "")
    // Leading 1-2 letter building code ("P Publix Supermarkets"), only when ≥2
    // words remain afterward (protects 2-word brands like "A Plus").
    .replace(/^[A-Za-z]{1,2}\s+(?=\S+\s+\S+)/, "")
    // Trailing unit code like "194A" / "12" separated from the name.
    .replace(/[\s.\-]+\d{1,4}[A-Za-z]?$/, "")
    .trim();
  return s || original;
}

/** Clean, human-readable canonical name for labels and headers. */
/** Remove trailing store-number suffixes like "#371", "# 0111", "#560-A" from display labels. */
function stripStoreNumber(s: string): string {
  return s.replace(/\s*#\s*[a-z0-9][\w-]*\s*$/i, "").trim();
}

export function tenantLabel(name: unknown, canonicalName?: string | null): string {
  if (canonicalName && canonicalName.trim()) return stripStoreNumber(canonicalName.trim());
  const n = _normTenant(name);
  if (_userAliases[n]) return stripStoreNumber(_userAliases[n]);
  if (TENANT_ALIASES[n]) return stripStoreNumber(TENANT_ALIASES[n]);
  // Never return an empty string — if store-number stripping or normalization
  // empties the label (e.g. a name that's basically just "#1234"), fall back to
  // the raw name so a tenant never renders nameless on its detail/rollup pages.
  return stripStoreNumber(n.replace(/\b\w/g, c => c.toUpperCase()))
    || stripStoreNumber(String(name || ""))
    || String(name ?? "").trim()
    || (canonicalName ?? "").trim();
}

// ── Lender-name normalisation ─────────────────────────────────────────────────
// Mirrors the tenant canonical-name system so "BankUnited", "BankUnited, N.A.",
// and "Bank United" all collapse to the same key in cross-deal groupings.

/** Stable grouping key — strips entity suffixes and punctuation so spelling
 *  variants of the same institution collapse to one string. */
export function lenderKey(name: unknown): string {
  if (!name || typeof name !== "string") return "";
  return name.toLowerCase()
    .replace(/,?\s*(n\.?a\.?|national association|llc|l\.l\.c\.|inc\.?|corp\.?|company|co\.?|bank|f\.?s\.?b\.?)\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/** Clean, human-readable display name — strips trailing legal suffixes (e.g.
 *  ", N.A.", "National Association") while preserving the institution name. */
export function lenderLabel(name: unknown): string {
  if (!name || typeof name !== "string") return String(name || "");
  return name.replace(/\s*,?\s*(N\.?A\.?|National Association)\s*$/i, "").trim() || String(name);
}

// Month abbreviations used in fmtLeaseDate.
const _MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","June","July","Aug","Sept","Oct","Nov","Dec"];

/**
 * Format a lease date string as "Mon-YYYY" (e.g. "Sept-2027").
 * Handles ISO (2027-09-30), slash M/D/YY, MM/DD/YYYY, and M/YYYY inputs.
 * Returns "—" for empty/unparseable values.
 */
export function fmtLeaseDate(raw: unknown): string {
  const s = String(raw || "").trim();
  if (!s || s === "—") return "—";
  // ISO: YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const m = parseInt(iso[2], 10) - 1;
    if (m >= 0 && m < 12) return `${_MONTH_ABBR[m]}-${iso[1]}`;
  }
  // M/D/YY or MM/DD/YYYY or M/D/YYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const m = parseInt(slash[1], 10) - 1;
    let y = parseInt(slash[3], 10);
    if (y < 100) y += 2000;
    if (m >= 0 && m < 12) return `${_MONTH_ABBR[m]}-${y}`;
  }
  // M/YYYY (no day)
  const my = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (my) {
    const m = parseInt(my[1], 10) - 1;
    if (m >= 0 && m < 12) return `${_MONTH_ABBR[m]}-${my[2]}`;
  }
  return s;
}

/**
 * Format tenant sales volume as "$X.XM / $NNN PSF" or "$NNNk / $NNN PSF".
 * Returns "—" when salesPSF is absent; returns "$NNN PSF" when sf is absent.
 */
export function fmtTenantSales(salesPSF: unknown, sf: unknown): string {
  const psf = (salesPSF == null || salesPSF === "" || isNaN(Number(salesPSF))) ? null : Number(salesPSF);
  const sqft = (sf == null || sf === "" || isNaN(Number(sf))) ? null : Number(sf);
  if (psf == null) return "—";
  const psfStr = `$${Math.round(psf)} PSF`;
  if (sqft == null) return psfStr;
  const total = psf * sqft;
  const totalStr = total >= 1_000_000
    ? `$${(total / 1_000_000).toFixed(1)}M`
    : `$${Math.round(total / 1000)}k`;
  return `${totalStr} / ${psfStr}`;
}

/**
 * Site-wide money formatter for LARGE/TOTAL dollar amounts (annual rent, NOI,
 * price, GPR, debt, gross sales, household income…). Always whole dollars — no
 * cents — because stored values often carry stray cents (e.g. 1,553,529.96) and
 * mixing "$1,553,529.96" with "$1,235,754" reads as inconsistent. Per-SF figures
 * (rent/SF, sales/SF) keep their 2 decimals via their own formatters — this is
 * only for the big totals. Returns "—" for null/blank/NaN.
 */
export function fmtUSD(v: unknown): string {
  if (v == null || (v as unknown) === "" || isNaN(Number(v))) return "—";
  return `$${Math.round(Number(v)).toLocaleString()}`;
}

export function buildSystemPrompt(
  deals: Deal[],
  abstracts: LeaseAbstract[] = [],
  compsSummary?: import("./compsSummary").CompsSummary | null,
  watch?: ReadonlyMap<string, { status: string; note?: string | null }>,
  tenantBenchmarks?: readonly import("./api").AnalystTenantBenchmark[] | null,
): string {
  const active = deals.filter(d => !d.trashedAt);
  const statuses = ["Prospect","Under Contract","Owned","Sold","Passed"];
  const bySt = Object.fromEntries(statuses.map(s => [s, active.filter(d => d.status === s).length]));
  const nz = (v: unknown) => v != null && v !== "" && !(typeof v === "number" && isNaN(v));

  // Resolve each deal's sales the SAME way the deal page / cross-property views do —
  // uploaded sales (tenantSalesHistory) WIN over the raw roster `salesPSF` (which the
  // sales-upload path never writes back). Without this the analyst only ever saw
  // OM-stated roster sales and was blind to everything Eric uploaded. Surfaces, per
  // tenant: latest sales PSF + gross $ volume + the reporting year + occupancy-cost %.
  const salesByDeal = buildSalesByDeal(active);
  // Compact multi-year history per tenant (only tenants with reported sales get one),
  // so year-over-year / trend questions are answerable from the prompt.
  const salesHistByDeal = new Map<string, Map<string, Array<{ year: number; salesPSF: number | null; grossSales: number | null; occCostPct: number | null }>>>();
  for (const d of active) {
    const perTenant = new Map<string, Array<{ year: number; salesPSF: number | null; grossSales: number | null; occCostPct: number | null }>>();
    for (const snap of (d.tenantSalesHistory || [])) {
      for (const r of (snap.tenants || [])) {
        if (r.removed) continue;
        const key = tenantKey(stripSuiteCode(r.name));
        let psf = _num(r.salesPSF), gross = _num(r.annualSales);
        const sf = _num(r.sf);
        if (psf == null && gross != null && sf != null && sf > 0) psf = Math.round((gross / sf) * 100) / 100;
        if (gross == null && psf != null && sf != null && sf > 0) gross = Math.round(psf * sf);
        if (psf == null && gross == null) continue;
        const arr = perTenant.get(key) || [];
        arr.push({ year: snap.year, salesPSF: psf, grossSales: gross, occCostPct: _num(r.occupancyCost) });
        perTenant.set(key, arr);
      }
    }
    // newest year first; keep one record per year (uploads already deduped on write)
    for (const [k, arr] of perTenant) perTenant.set(k, arr.sort((a, b) => b.year - a.year));
    salesHistByDeal.set(d.id, perTenant);
  }

  // KPR's own deal economics — only meaningful for deals KPR has transacted on
  // (Owned / Under Contract / Sold). Built compactly and only when present, so
  // the prompt stays lean for the larger Prospect/Passed pipeline.
  const kprEconomics = (d: Deal) => {
    const k: Record<string, unknown> = {};
    if (nz(d.txnPurchasePrice)) k.kprPurchasePrice = d.txnPurchasePrice;
    if (nz(d.acqCapRate)) k.kprAcqCapRate = d.acqCapRate;
    if (nz(d.acqNOIAtClose)) k.kprNoiAtClose = d.acqNOIAtClose;
    if (nz(d.acqStrategy)) k.kprStrategy = d.acqStrategy;
    if (nz(d.acqHoldPeriod)) k.kprHoldYears = d.acqHoldPeriod;
    if (nz(d.acqTargetIRR)) k.kprTargetIRR = d.acqTargetIRR;
    if (nz(d.txnCloseDate)) k.kprCloseDate = d.txnCloseDate;
    if (nz(d.txnSeller)) k.kprSeller = d.txnSeller;
    // Debt
    if (nz(d.debtLender)) k.loanLender = d.debtLender;
    if (nz(d.debtLoanAmount)) k.loanAmount = d.debtLoanAmount;
    if (nz(d.debtRate)) k.loanRate = d.debtRate;
    if (nz(d.debtSpread)) k.loanSpreadBps = d.debtSpread;
    if (nz(d.debtIndex)) k.loanIndex = d.debtIndex;
    if (nz(d.debtLTV)) k.loanLTV = d.debtLTV;
    if (nz(d.debtIOPeriod)) k.loanIOYears = d.debtIOPeriod;
    if (nz(d.debtMaturityDate)) k.loanMaturity = d.debtMaturityDate;
    // Pref equity
    if (nz(d.prefAmount)) k.prefAmount = d.prefAmount;
    if (nz(d.prefRateCurrent)) k.prefPayRate = d.prefRateCurrent;
    // Disposition (Sold)
    if (nz(d.txnSalePrice)) k.kprSalePrice = d.txnSalePrice;
    if (nz(d.txnSaleDate)) k.kprSaleDate = d.txnSaleDate;
    return Object.keys(k).length ? k : undefined;
  };

  // Co-tenancy exposure (the deterministic lease-risk engine, token-free). Per named
  // anchor: rent that trips if it goes dark ALONE (tripsAlone — be precise, never
  // overstate an X-of-N clause as a solo trigger) vs. ANY linkage (anyLinkage —
  // trips alone OR needs a second event). Resolves abstracts (verified) over OM
  // (unverified) for the deal, exactly like the deal page's risk panel.
  const coTenancyExposure = (d: Deal) => {
    const resolved = resolveTenantRisk(d, (abstracts || []).filter(a => a.dealId === d.id));
    const anchors = anchorsReferenced(resolved);
    if (!anchors.length) return undefined;
    const rows = anchors.map(anchor => {
      const e = computeExposure(resolved, anchor);
      return {
        anchor,
        tripsAloneRent: Math.round(e.tier1Rent) || undefined,
        tripsAloneTenants: e.tier1Count || undefined,
        anyLinkageRent: Math.round(e.tier3Rent) || undefined,
        anyLinkageTenants: e.tier3Count || undefined,
        verified: e.clauses.some(c => c.verified) || undefined,
      };
    }).sort((a, b) => (b.tripsAloneRent ?? 0) - (a.tripsAloneRent ?? 0));
    return rows.length ? rows : undefined;
  };

  // Trade-area demographics — OM-stated plus AI-researched (marketDemographics).
  const demographics = (d: Deal) => {
    const m: Record<string, unknown> = {};
    if (nz(d.trafficCountVPD)) m.trafficVPD = d.trafficCountVPD;
    if (nz(d.population3mi)) m.pop3mi = d.population3mi;
    if (nz(d.medianHHIncome3mi)) m.medHHI3mi = d.medianHHIncome3mi;
    if (nz(d.avgHHIncome3mi)) m.avgHHI3mi = d.avgHHIncome3mi;
    if (nz(d.proximityHighways)) m.highways = d.proximityHighways;
    if (nz(d.retailCotenants)) m.nearbyRetail = d.retailCotenants;
    const md = d.marketDemographics;
    if (md) {
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries({ pop1mi: md.pop1mi, pop3mi: md.pop3mi, pop5mi: md.pop5mi, avgHHI1mi: md.avgHHI1mi, avgHHI3mi: md.avgHHI3mi, avgHHI5mi: md.avgHHI5mi })) {
        if (nz(v)) r[k] = v;
      }
      if (md.confidence) r.confidence = md.confidence;
      if (Object.keys(r).length) m.researched = r;
    }
    return Object.keys(m).length ? m : undefined;
  };

  // Lease-expiration (rollover) schedule — base rent + SF + tenant count expiring per
  // year, so "what rolls in 2027 / our rollover exposure" is answerable directly.
  // Bucketed: already-expired/MTM, each of the next ~10 years, then a 10yr+ tail.
  const rolloverByYear = (d: Deal) => {
    const curY = new Date().getFullYear();
    const buckets = new Map<string, { rent: number; sf: number; tenants: number }>();
    for (const t of (d.tenants || [])) {
      if (isNAPTenant(t)) continue;
      const y = parseInt(String(t.leaseExpiry ?? "").slice(0, 4), 10);
      if (!y || isNaN(y)) continue;
      const key = y <= curY ? "expired/MTM" : y >= curY + 10 ? `${curY + 10}+` : String(y);
      const b = buckets.get(key) || { rent: 0, sf: 0, tenants: 0 };
      b.rent += _num(t.annualRent) ?? 0;
      b.sf += _num(t.sf) ?? 0;
      b.tenants += 1;
      buckets.set(key, b);
    }
    if (!buckets.size) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of buckets) out[k] = { rent: Math.round(v.rent) || undefined, sf: Math.round(v.sf) || undefined, tenants: v.tenants };
    return out;
  };

  // ── Generic field pass-through — so the analyst AUTO-FOLDS IN EVERY data field ──
  // An allowlist is a maintenance trap: every new Deal/Tenant field would be invisible
  // to the analyst until someone hand-edited this prompt. Instead we serialize ALL
  // present fields and OMIT only a small, stable denylist of internal/noise/huge or
  // separately-handled fields. New underwriting fields (financials, lease terms,
  // cash flow, rent steps, …) therefore reach the analyst automatically — no babysitting.
  const has = (v: unknown): boolean => {
    if (v == null || v === "") return false;
    if (typeof v === "number") return !isNaN(v);
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v as object).length > 0;
    return true;
  };
  // Deal fields handled elsewhere (computed / renamed) or pure noise/internal.
  const DEAL_OMIT = new Set<string>([
    "tenants", "tenantSalesHistory", "leaseRisk", "anchorStatus", "marketDemographics",
    "dealScore", "dealReview", "dealThesis", "fileName", "imageMeta", "verified",
    "reviewQuestions", "analysisStale", "analysisVersion", "autoPassed", "autoPassedAt",
    "propertyGroupId", "updatedAt", "refreshedAt", "demoChecked", "marketSaleChecked",
    "trashedAt", "aka", "tenantsManual", "tenantsSource", "pdfPages",
    // demographics fold into the `demographics` object below:
    "trafficCountVPD", "population3mi", "medianHHIncome3mi", "avgHHIncome3mi",
    "proximityHighways", "retailCotenants",
  ]);
  // Heavy fields dropped for PASSED deals only (they're market-intel/comps, the bulk
  // of the count) so the prompt stays lean; active deals keep everything.
  const PASSED_HEAVY_OMIT = new Set<string>([
    "notes", "userNotes", "cashFlowProjection", "incomeBreakdown", "expenseBreakdown",
    "roofData", "keyAssumptions", "shadowAnchors", "redFlags", "upsideItems", "marketSale",
  ]);
  const genericDeal = (d: Deal, lean = false): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d)) {
      if (DEAL_OMIT.has(k)) continue;
      if (lean && PASSED_HEAVY_OMIT.has(k)) continue;
      if (/^(acq|debt|pref|txn|disp)/.test(k)) continue; // KPR economics → consolidated in `kpr`
      if (has(v)) o[k] = v;
    }
    return o;
  };
  const TENANT_OMIT = new Set<string>(["canonicalName"]); // grouping key, not analyst-facing
  const genericTenant = (t: Tenant): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(t)) {
      if (TENANT_OMIT.has(k)) continue;
      if (has(v)) o[k] = v;
    }
    return o;
  };
  const watchOf = (t: Tenant) => {
    const w = watch?.get(tenantKey(t.canonicalName ?? t.name));
    return w ? { status: w.status, note: w.note ?? undefined } : undefined;
  };

  const portfolio = active.map(d => {
    const isPassed = d.status === "Passed";
    const tenantList = (d.tenants || []);
    const latestSales = salesByDeal.get(d.id);
    const hist = salesHistByDeal.get(d.id);
    // Resolved sales (uploads-over-OM) + watchlist overlay onto each tenant.
    const tenantSales = (t: Tenant) => {
      const ls = latestSales?.get(tenantKey(t.canonicalName ?? t.name));
      const h = hist?.get(tenantKey(t.canonicalName ?? t.name));
      return {
        salesPSF: (ls?.salesPSF ?? _num(t.salesPSF)) ?? undefined,
        salesGross: ls?.grossSales ?? undefined,
        salesYear: ls?.salesYear ?? _num(t.salesYear) ?? undefined,
        occCostPct: ls?.occupancyCost ?? _num(t.occupancyCost) ?? undefined,
        salesHistory: h && h.length >= 2 ? h : undefined,
      };
    };
    // Passed deals: anchor-only compact summary (the bulk of the pipeline — keep lean).
    // Active deals: EVERY tenant field (generic) + resolved sales/IG/watchlist overlay.
    const tenants = isPassed
      ? tenantList
          .filter(t => t.isAnchor || (t.sf && Number(t.sf) >= 5000))
          .map(t => ({
            name: t.name, sf: t.sf, anchor: t.isAnchor || undefined, expiry: t.leaseExpiry,
            ...tenantSales(t),
            isIG: isInvestmentGrade(t.name || "", t.creditRating) || undefined,
            watch: watchOf(t),
          }))
      : tenantList.map(t => ({
          ...genericTenant(t),
          // Computed overlays WIN over the raw fields they replace:
          ...tenantSales(t),
          isIG: isInvestmentGrade(t.name || "", t.creditRating) || undefined,
          watch: watchOf(t),
        }));
    // KPR economics only for deals KPR has actually transacted on.
    const kpr = (d.status === "Owned" || d.status === "Under Contract" || d.status === "Sold")
      ? kprEconomics(d) : undefined;
    return {
      // Generic pass-through of every present OM/underwriting field (auto-includes
      // cash flow, rent steps, assumable debt, income/expense breakdowns, and any
      // FUTURE field), then computed/renamed analytics overlaid on top.
      ...genericDeal(d, isPassed),
      id: d.id,
      name: d.propertyName || d.fileName,
      dealScore: d.dealScore?.score ?? undefined,
      dealGrade: d.dealScore?.grade ?? undefined,
      // Which sales-report years are on file (so trend questions survive roster trims).
      salesYearsOnFile: (d.tenantSalesHistory && d.tenantSalesHistory.length)
        ? Array.from(new Set(d.tenantSalesHistory.map(s => s.year))).sort((a, b) => b - a)
        : undefined,
      // Computed analytics (can't auto-derive from raw fields):
      coTenancyExposure: isPassed ? undefined : coTenancyExposure(d),
      rollover: isPassed ? undefined : rolloverByYear(d),
      demographics: demographics(d),
      // KPR's own recorded take — these DEFINE the house view (see HOUSE VIEW section).
      kprReview: nz(d.dealReview) ? d.dealReview : undefined,
      kprThesis: nz(d.dealThesis) ? d.dealThesis : undefined,
      tenants: tenants.length ? tenants : undefined,
      kpr,
    };
  });

  // KPR HOUSE VIEW — distilled from every deal Eric has personally reviewed. This is
  // how KPR thinks (pricing read, what they like/avoid, risk tolerance); the analyst
  // should reason in this voice and apply it even to deals without an explicit review.
  const houseView = active
    .filter(d => nz(d.dealReview))
    .map(d => ({ deal: d.propertyName || d.fileName, status: d.status, review: d.dealReview }));

  const ownedCount = bySt["Owned"] || 0;

  // Lease abstracts on file (reconciled from each tenant's full document set).
  // These are the authoritative source for lease-level questions and carry
  // per-fact citations (document, section, page). Tagged with their deal name
  // for context; the storage-envelope keys are stripped to keep the prompt lean.
  const dealName = (id?: string) => {
    const dd = active.find(x => x.id === id);
    return dd ? (dd.propertyName || dd.fileName || id) : id;
  };
  const absForPrompt = (abstracts || []).map(a => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = a;
    return { deal: dealName(a.dealId), ...rest };
  });
  // ---- Context-size guard ----------------------------------------------------
  // The ENTIRE library is serialized into every Analyst prompt; as deals +
  // abstracts grow the JSON exceeds the model's 200K-token context and the request
  // 400s ("prompt is too long"). Serialize COMPACT (no pretty-print) and, if still
  // too big, shed the least-important detail in order — non-owned rosters → all
  // rosters → abstract bodies — until the data fits the budget below.
  //
  // The budget is DYNAMIC: an earlier version measured ONLY the portfolio+abstract
  // JSON against a fixed 500K-char cap and ignored the other large sections that
  // also go into the prompt (comps summary, tenant benchmarks, house view, the
  // static instruction scaffold) plus the running chat history and the reply. So
  // the data could sit just under cap while the WHOLE prompt overflowed (a batch of
  // verbose lease abstracts tipped it to ~208K tokens). Budget the data against
  // what's actually left: a conservative input-token target × chars/token, minus the
  // measured overhead and a reserve for history/reply.
  const CHARS_PER_TOKEN = 2.3;          // measured: this dense deal/abstract JSON tokenizes ~2.3 chars/token (an earlier 2.9 ran the budget ~20% too loose so trims never fired)
  const INPUT_TOKEN_TARGET = 175_000;   // generous margin below the 200K hard cap
  const HISTORY_RESERVE_CHARS = 40_000; // ~14K tokens kept free for the running chat history + reply
  const overheadChars =
    JSON.stringify(compsSummary ?? null).length +
    JSON.stringify(tenantBenchmarks ?? null).length +
    JSON.stringify(houseView).length +
    24_000;                             // the static instruction scaffold below (approx, stable)
  const DATA_BUDGET = Math.max(
    140_000,
    Math.floor(INPUT_TOKEN_TARGET * CHARS_PER_TOKEN) - HISTORY_RESERVE_CHARS - overheadChars,
  );
  const byId = new Map(active.map(d => [d.id, d] as const));
  const compactRoster = (d: Deal) => {
    const latestSales = salesByDeal.get(d.id);
    return (d.tenants || [])
      .filter(t => t.isAnchor || (t.sf != null && Number(t.sf) >= 8000))
      .map(t => {
        const ls = latestSales?.get(tenantKey(t.canonicalName ?? t.name));
        return { name: t.name, sf: t.sf, anchor: t.isAnchor || undefined, expiry: t.leaseExpiry,
                 rentPSF: t.rentPerSF ?? undefined,
                 salesPSF: (ls?.salesPSF ?? _num(t.salesPSF)) ?? undefined,
                 salesYear: ls?.salesYear ?? undefined,
                 isIG: isInvestmentGrade(t.name || "", t.creditRating) || undefined };
      });
  };

  let portfolioOut: unknown[] = portfolio;
  let absOut: unknown[] = absForPrompt;
  let abstractsSummarized = false;
  const trimNotes: string[] = [];
  const dataSize = () => JSON.stringify(portfolioOut).length + JSON.stringify(absOut).length;

  // Abstracts grow fast, tokenize heavy (verbose legal prose), and are rarely
  // needed in FULL for a portfolio question — yet a single batch can dominate the
  // prompt on its own. So, INDEPENDENT of the overall budget, if the full abstract
  // bodies exceed this standalone cap, condense them to a tenant index up front.
  // (Without this, when the rest of the library is modest the total can sit just
  // under DATA_BUDGET, no staged trim fires, and the bulky abstracts still ship —
  // the exact case that kept the Analyst at ~208K tokens.) Full bodies stay on each
  // deal's page; lease-level questions get pointed there.
  const ABSTRACT_BODY_BUDGET = 90_000; // chars (~30K tokens)
  if (JSON.stringify(absOut).length > ABSTRACT_BODY_BUDGET) {
    absOut = absForPrompt.map(a => { const r = a as Record<string, unknown>; return { deal: r.deal, tenant: r.tenantName, suite: r.suite }; });
    abstractsSummarized = true;
    trimNotes.push("lease abstracts summarized to a tenant index (large abstract set)");
  }

  if (dataSize() > DATA_BUDGET) {
    portfolioOut = portfolio.map(p => {
      const d = byId.get(p.id);
      if (d && d.status !== "Owned" && d.status !== "Under Contract" && p.tenants) {
        const ct = compactRoster(d);
        return { ...p, tenants: ct.length ? ct : undefined };
      }
      return p;
    });
    trimNotes.push("non-owned deals show anchors + larger tenants only");
  }
  if (dataSize() > DATA_BUDGET) {
    portfolioOut = portfolio.map(p => {
      const d = byId.get(p.id);
      if (d && p.tenants) { const ct = compactRoster(d); return { ...p, tenants: ct.length ? ct : undefined }; }
      return p;
    });
    trimNotes.push("all tenant rosters trimmed to anchors + larger tenants");
  }
  if (dataSize() > DATA_BUDGET && absOut.length) {
    absOut = absForPrompt.map(a => { const r = a as Record<string, unknown>; return { deal: r.deal, tenant: r.tenantName, suite: r.suite }; });
    abstractsSummarized = true;
    trimNotes.push("lease abstracts summarized to a tenant index");
  }
  // Heavy deal-LEVEL fields (cash-flow projections, income/expense breakdowns, long
  // narrative notes, amort/pref schedules) can dominate the prompt even after the
  // rosters are trimmed — and they're rarely what a cross-portfolio question needs.
  // genericDeal() passes every field through, so shed the heavy ones when still over
  // budget; full detail stays on each deal's page.
  const HEAVY_DEAL_KEYS = ["cashFlowProjection","incomeBreakdown","expenseBreakdown","notes","keyAssumptions","redFlags","upsideItems","shadowAnchors","roofData","customAmortSchedule","prefSchedule","marketDemographics"];
  if (dataSize() > DATA_BUDGET) {
    portfolioOut = (portfolioOut as Array<Record<string, unknown>>).map(p => {
      const c = { ...p }; for (const k of HEAVY_DEAL_KEYS) delete c[k]; return c;
    });
    trimNotes.push("heavy deal fields (cash flow, income/expense breakdowns, long notes) omitted");
  }
  // Last resort: collapse non-transacted (Prospect/Passed) deals to a compact stub so
  // owned-portfolio questions always fit even with a large pipeline.
  if (dataSize() > DATA_BUDGET) {
    portfolioOut = (portfolioOut as Array<Record<string, unknown>>).map(p => {
      const d = byId.get(p.id as string);
      if (d && d.status !== "Owned" && d.status !== "Under Contract" && d.status !== "Sold") {
        return { id: p.id, name: p.name, status: p.status, city: p.city, state: p.state,
                 capRate: p.capRate, askingPrice: p.askingPrice, totalSF: p.totalSF,
                 dealScore: p.dealScore, dealGrade: p.dealGrade };
      }
      return p;
    });
    trimNotes.push("pipeline (Prospect/Passed) deals reduced to a summary stub");
  }

  const trimNote = trimNotes.length
    ? `\n\nNOTE: the library is large, so to fit the context window: ${trimNotes.join("; ")}. For anything trimmed, the full detail is on that deal's page — ask about the SPECIFIC deal or tenant and answer from what's shown, or say it's available there.`
    : "";

  const abstractsSection = !absOut.length ? "" : abstractsSummarized ? `

=== LEASE ABSTRACTS ON FILE (index only — trimmed to fit) ===
Full lease abstracts exist for these tenant/deal pairs, but their bodies were omitted to keep the prompt within the context window. For a lease-level question on one of these, say a full abstract is on file (on that deal's page) rather than guessing the terms.

${JSON.stringify(absOut)}` : `

=== LEASE ABSTRACTS ON FILE ===
Full, reconciled lease abstracts for specific tenants — assembled from the original lease plus every amendment, assignment, guaranty, option exercise and waiver, with later documents controlling earlier ones. These are the AUTHORITATIVE source for lease-level questions (term, options, rent steps, percentage rent, security deposit, exclusives/use, go-dark, assignment/recapture, guaranties, default, CAM/taxes). Rules:
- Every fact carries a "cite" object (doc, section, page). When you answer from an abstract, quote the value AND cite it, e.g. "Fresh Farms can go dark — it's not a default; the landlord's only remedy is to terminate (Cub Foods Lease, §9.6, p. 20 of 49)."
- "options" carry a status (exercised / available / expired), window dates and rent — use them for "when does the next option start / what's the rent."
- "guaranties" is a stack (a lease can carry several across successive assignments). "flags" are reconciliation/defect items — surface the relevant one when it bears on the answer.
- If a lease-level question is about a tenant that has NO abstract here, say no abstract is on file rather than inferring from the roster summary.

Lease abstracts (JSON):
${JSON.stringify(absOut)}`;

  const prompt = `You are KPR Centers' in-house commercial real estate analyst. You specialize in RETAIL SHOPPING CENTERS (anchored strip/power/grocery centers — not residential, not office, not raw land). You are analyzing KPR's own deal library. Be precise, think like an experienced acquisitions principal, and reason from the structured data below — never invent numbers.

=== "KPR PORTFOLIO" vs "THE DATABASE" — READ THIS FIRST (most common source of confusion) ===
Every deal has a "status". It is critical you interpret these correctly:
- "Owned"          → KPR ACTUALLY OWNS this. These ${ownedCount} deal(s) ARE the "KPR portfolio" / "our centers" / "our properties" / "what we own".
- "Under Contract" → KPR is acquiring it (in progress), not yet owned.
- "Sold"           → KPR previously owned it and has since sold it (realized/exited).
- "Prospect"       → A deal KPR is evaluating or has read an OM on. NOT owned. This is pipeline / the broader database.
- "Passed"         → KPR looked at it and declined. NOT owned. Kept only as market intelligence / comps.

TERMINOLOGY (use these exact words so scope is never ambiguous):
- "KPR portfolio" / "the portfolio" = OWNED assets ONLY. Reserve the word "portfolio" for what KPR owns — never use it for the whole dataset.
- "the database" = the ENTIRE analyzed dataset across all statuses (owned + pipeline + passed). When citing cross-deal benchmarks/averages over everything, call it "the database," e.g. "across 15 comparable leases in the database."

INTERPRETATION RULES:
- "our portfolio", "the KPR portfolio", "our centers", "we own", "our assets" → Owned ONLY (optionally Sold for track-record/realized questions). NEVER include Prospect/Passed.
- "all deals", "the database", "the library", "everything", "deals we've looked at", "across all deals" → ALL statuses.
- "the pipeline", "deals we're considering", "what's in the funnel" → Prospect (+ Under Contract).
- "deals we passed on" / "rejected" → Passed.
- If a question is genuinely ambiguous about scope, DEFAULT to Owned (the KPR portfolio) for "we/our" phrasing, but STATE your assumption in one short clause (e.g. "Across your 6 owned centers, …") so the user can correct you. When you give an aggregate, say which set it covers (KPR portfolio vs the database).

=== KPR's OWN ECONOMICS vs OM-STATED FIGURES ===
For Owned / Under Contract / Sold deals, a "kpr" object holds KPR's ACTUAL deal terms:
- kprPurchasePrice = what KPR actually paid (use this for basis/"what we paid", NOT askingPrice).
- askingPrice / capRate / noi at the top level are the OM/seller-stated figures — what the deal was marketed at, not necessarily KPR's actual basis or underwriting.
- kprAcqCapRate = KPR's going-in cap on actual price; loan* = KPR's financing (lender, amount, rate, spread in bps, LTV, IO years, maturity); pref* = preferred equity. kprSalePrice/kprSaleDate = exit terms for Sold deals.
- For "what's our basis / our cap / our loan / our financing / cash-on-cash", use the kpr object. If a needed kpr field is absent, say it isn't recorded — do not substitute the OM figure silently.
${houseView.length ? `
=== KPR HOUSE VIEW (how we think — READ AND ADOPT THIS) ===
These are KPR's OWN written takes on deals it has reviewed — the team's real opinions on pricing, what they like and avoid, and risk tolerance. This is the house view: reason in this voice, weight deals the way these reviews do, and APPLY the same lens to deals that have no explicit review. Each deal also carries its own "kprReview"/"kprThesis" inline. When you draw on it, attribute it as KPR's own view (e.g. "consistent with your read on …"), and never contradict a recorded KPR review with a generic take — if you disagree, flag the tension explicitly.

${JSON.stringify(houseView)}
` : ""}
=== RETAIL DOMAIN GLOSSARY ===
- Anchor: large lead tenant driving traffic (grocer, big-box, etc.) — flagged anchor:true. "Inline/shop tenants" = the smaller non-anchor stores.
- NAP ("not a part", isNAP:true): a parcel/pad in the center not part of the leasable area KPR controls (e.g. a ground-leased pad or separately-owned outparcel) — exclude from KPR's occupancy/SF/rent rollups unless asked specifically.
- Dark (isDark:true): tenant has gone dark — closed/not operating but STILL PAYING RENT under its lease. It counts as occupied/paying for income, but is an operational red flag (no traffic). Call this out when relevant.
- IG (isIG:true): investment-grade-rated tenant (or parent) — stronger credit, lower risk. "IG rent %" = share of base rent from IG tenants.
- watch (tenant field, when present): the retailer is on KPR's distress watchlist — watch.status is "watch" / "distressed" / "bankruptcy" / "liquidating" (escalating), watch.note gives the reason. ALWAYS surface this as a risk when discussing a flagged tenant (e.g. a bankruptcy tenant's rent is at real risk regardless of lease term); weight rollover/co-tenancy exposure on watchlisted anchors more heavily.
- WALT: weighted-average lease term remaining (years), SF-weighted — higher = more durable income.
- Occupancy: % of leasable SF leased. Cap rate: NOI ÷ price. weightedAvgRentPSF: SF-weighted in-place base rent per SF.
- Vacant suites may appear in rosters; exclude vacants from rent/occupied-SF math but include them when discussing lease-up upside.

=== TENANT SALES DATA (per tenant, when reported) ===
Sales figures shown are the MOST RECENT on file, resolving uploaded sales reports OVER the OM-stated roster figure (an uploaded sales report always wins over the OM). Per tenant:
- salesPSF = latest reported sales per SF. salesGross = latest total annual sales $ volume. salesYear = the reporting year those figures belong to (always state the year when you quote sales — sales without a year are nearly meaningless).
- occCostPct = occupancy cost as a % of sales = (base rent + reimbursements + percentage rent + other) ÷ gross sales. This is the key health metric: low (grocers often <3%, inline apparel healthy <10–12%, stressed >15%) = the tenant can comfortably afford its rent and there's mark-to-market room; high = rent is stretched relative to sales, a closure/renewal risk. Never compute occ cost as rent÷sales alone, and never invent it — use the value given.
- salesHistory = an array (newest year first) of {year, salesPSF, grossSales, occCostPct} when 2+ years are on file — use it for year-over-year / trend ("sales up/down X% since 20YY"). salesYearsOnFile (deal level) lists which sales-report years exist for the deal even if a roster was trimmed.
- A tenant with NO sales fields simply has no reported sales — say so; do not infer sales from rent. When quoting a cross-tenant sales benchmark, it's sourced from the database (uploaded + OM sales across deals) — cite the year basis and tenant count, use medians, and never quote a sales-PSF average off a tiny sample.

=== CO-TENANCY EXPOSURE (deal field "coTenancyExposure") ===
A precomputed, deterministic read of each deal's co-tenancy risk — what happens to OTHER tenants' rent if a named anchor goes dark. Per anchor:
- tripsAloneRent / tripsAloneTenants = base rent (and # of tenants) whose co-tenancy clause trips if THIS anchor alone goes dark. This is the true single-anchor exposure — use it for "if Anchor X leaves, how much rent is at risk?"
- anyLinkageRent / anyLinkageTenants = rent of every tenant whose clause so much as REFERENCES this anchor, including ones that need a SECOND event (e.g. an "X-of-N key-tenants" clause that only trips when several go dark). anyLinkage ≥ tripsAlone. NEVER present anyLinkage as if one anchor leaving triggers it — that overstates exposure. If tripsAloneRent is 0 but anyLinkage is large, say the anchor is one of several named tenants and the clause needs multiple to go dark.
- verified:true = at least one clause is confirmed against an executed lease/abstract; otherwise it's OM-disclosed and UNVERIFIED — say so. Absent coTenancyExposure = no co-tenancy disclosed for that deal.

=== LEASE ROLLOVER (deal field "rollover") ===
Base rent + SF + tenant count expiring per year (keys: "expired/MTM" = already past, each upcoming year, and "<year>+" = a 10-year tail). Use it for rollover-wall / "what rolls in 20XX" / near-term mark-to-market questions; pair with the hold-period lens below.

=== DEMOGRAPHICS (deal field "demographics") ===
trafficVPD (vehicles/day), pop3mi, medHHI3mi/avgHHI3mi (household income), highways, nearbyRetail. "researched" = an AI-verified trade-area pull (pop/income at 1/3/5 mi with a confidence) — distinguish it from OM-stated figures, and note low confidence when present.

Portfolio counts: ${active.length} total deals — ${statuses.map(s => `${bySt[s]} ${s}`).join(", ")}.

Full deal data (JSON):
${JSON.stringify(portfolioOut)}
${abstractsSection}${trimNote}
${compsSummary ? `
=== SALES-COMP BENCHMARK (precomputed — NARRATE, never re-derive) ===
This is the app's deterministic benchmark over the comp database (median + 25th/75th percentile, validity-filtered: sale price > 0, no future dates, cap 3–12%, price/SF ≤ $2,000). The numbers are FINAL — quote them, do not average raw comps yourself, and always cite n + the date range. Use MEDIANS, not means. Source tiers, strongest to weakest: owned (KPR's verified trades) > broker/manual > OM-sourced (seller-cherry-picked). ${compsSummary.insufficient ? "NOTE: fewer than 4 valid comps — say the sample is too thin for a reliable benchmark rather than quoting a median as authoritative." : ""}
- n=${compsSummary.n} valid comps${compsSummary.dateRange ? `, sales ${compsSummary.dateRange.from} → ${compsSummary.dateRange.to}` : ""} (excluded ${compsSummary.excludedInvalid} invalid). Source mix: ${compsSummary.sourceMix.owned} owned, ${compsSummary.sourceMix.brokerManual} broker/manual, ${compsSummary.sourceMix.omSourced} OM-sourced.
- When comparing one of KPR's deals to "the comps," compare its cap rate / price-PSF to these medians and state the gap in bps (cap) or % (price/SF).

${JSON.stringify(compsSummary)}
` : ""}${tenantBenchmarks && tenantBenchmarks.length ? `
=== TENANT BENCHMARKS — DATABASE MEDIANS (precomputed — NARRATE, never re-derive) ===
The app's OFFICIAL per-brand benchmark — the SAME recency-weighted engine the deal pages use, run across every location of each brand in the database (recent leases weighted more: ≤3yr ×1.0, 3–7yr ×0.5, >7yr ×0.25; NAP/outlier rows excluded; medians, not means). When asked how a tenant's rent/sales/size compares to "the database" or "the chain," use THESE numbers — do not average the roster yourself. Always cite the brand's location count and recency. Rules:
- medianRentPerSf = the database median base rent/SF for that brand across "locations" leases. State a tenant's rent as IS X% above/below it (rents don't "trade").
- medianSalesPerSf is only meaningful when salesCount ≥ 3 (sparse otherwise) — if salesCount is low, say the sales sample is too thin to benchmark. medianSf = the brand's typical store size (prototype proxy) when sfCount ≥ 2.
- confidence (high/medium/low) reflects sample depth — soften the verdict at low/medium. Only multi-location brands appear here; a brand NOT listed has no peer set to benchmark against (say so rather than guessing).
- This is the database-wide median across ALL locations of the brand; the deal page's scoring flag compares a deal against the OTHERS (excluding itself), so for a tiny sample the two can differ slightly — frame this as the all-locations database median.

${JSON.stringify(tenantBenchmarks)}
` : ""}
=== ANSWERING GUIDELINES ===
- Reference actual deal names and real numbers from the data above; don't generalize when specifics are available.
- Accuracy over confidence: if a figure isn't in the data, say so plainly and leave it out — NEVER fabricate a precise-looking number. null/absent means unknown, not zero.
- When you compute an aggregate, briefly note the scope and how many deals it covers, and whether it's the KPR portfolio (owned) or the database (all).
- RENTS DO NOT "TRADE." Properties trade; rents do not. Never say a rent "trades" above/below a benchmark — say it "IS X% below/above." e.g. "Five Below at $15.00/SF is 24% below the database average of $19.83/SF across 15 comparable leases (2026 recency-weighted)" — NOT "…trades 24% below…".
- HOLD-PERIOD LENS (three tiers): KPR underwrites a 5–7 year hold (max ~10). Mark-to-market / lease-up / value-add that rolls within ~7 years = in-hold upside KPR captures. Rolls ~7–12 years out = residual/exit upside to position for the NEXT buyer (call it a future-owner mark-to-market, not in-hold). Locked deeper than ~12 years = not upside. Always make clear which tier you mean.
- Format currency as $X,XXX,XXX (or $1.2M / $930K shorthand for large/round figures) and percentages to one decimal.
- Show brief reasoning for non-trivial calculations so the user can sanity-check, then give the answer.
- Keep responses focused and actionable. Today's date: ${new Date().toLocaleDateString()}.`;

  // ── Absolute backstop ───────────────────────────────────────────────────────
  // No matter what slipped past the trims above (a huge owned roster, oversized
  // comps/benchmarks/house-view, anything new), the prompt must fit the model's
  // 200K-token context. Hard-cap the FINAL string by characters; truncating the
  // tail (lowest-value: trailing guidelines/benchmarks) degrades the answer instead
  // of 400ing the whole request. Sized at the measured ratio with margin.
  // Fixed, ratio-independent ceiling: even at a worst-case ~2.0 chars/token this is
  // ~195K tokens, still under the 200K hard cap (at the measured ~2.3 it's ~170K).
  const HARD_CHAR_CAP = 390_000;
  if (prompt.length > HARD_CHAR_CAP) {
    // Truncating the tail drops the ANSWERING GUIDELINES, so re-append a compact set
    // of the non-negotiable rules — a truncated prompt must still know not to
    // fabricate and how to scope "portfolio" vs "database".
    const CRITICAL_RULES = "\n\n=== CRITICAL RULES (still apply) ===\n" +
      "- Never invent numbers; if a figure isn't in the data above, say so plainly. null/absent = unknown, not zero.\n" +
      "- \"KPR portfolio\" / \"our\" = Owned deals only; \"the database\" = all statuses. State which set any aggregate covers.\n" +
      "- Always cite the year for a sales figure; use medians (not means) for benchmarks; rents \"are X% below,\" they don't \"trade.\"\n" +
      "- Some lower-priority context was truncated to fit the model's limit — for anything missing, ask about a SPECIFIC deal or tenant (full detail is on its page).";
    return prompt.slice(0, HARD_CHAR_CAP - CRITICAL_RULES.length) + CRITICAL_RULES;
  }
  return prompt;
}

export function cityState(d: Deal): string {
  if (d.city || d.state) return [d.city, d.state].filter(Boolean).join(", ");
  const a = (d.address || "").trim();
  if (a) {
    const parts = a.split(",").map(s => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const sm = last.match(/\b([A-Z]{2})\b/);
    const state = sm ? sm[1] : "";
    let city = parts.length >= 2 ? parts[parts.length - 2] : "";
    if (/^\d/.test(city) || /\b[A-Z]{2}\b\s*\d{5}/.test(city)) city = "";
    const out = [city, state].filter(Boolean).join(", ");
    if (out) return out;
  }
  return d.market || "";
}

// Compose a clean "street, city, ST zip" line WITHOUT duplicating any piece the
// street field already carries. OMs often capture the whole address line into
// `address` (e.g. "1114 S 17th Street, Kokomo, IN 46902") while city/state/zip are
// ALSO stored separately — naively joining them yields "…Kokomo, IN 46902 46902".
// This only appends the structured pieces the street doesn't already contain.
export function formatFullAddress(d: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }): string {
  const street = (d.address || "").trim().replace(/[\s,]+$/, "");
  const city = (d.city || "").trim();
  const state = (d.state || "").trim();
  const zip = (d.zip || "").trim();
  if (!street) return [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const inStreet = (v: string) => !!v && new RegExp(`\\b${esc(v)}\\b`, "i").test(street);
  const stateZip = [inStreet(state) ? "" : state, inStreet(zip) ? "" : zip].filter(Boolean).join(" ");
  return [street, inStreet(city) ? "" : city, stateZip].filter(Boolean).join(", ");
}

// One-time data-cleanup companion to formatFullAddress: when the stored `address`
// has the city/state/zip tacked onto the end AND those also live in their own
// fields, strip the trailing duplicates so `address` holds just the street.
// Conservative — it only peels a trailing piece that exactly matches a structured
// field (never re-parses free-form text, never invents city/state/zip), and returns
// null when there's nothing to clean so callers can count/preview the real changes.
export function dedupeStoredAddress(d: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }): string | null {
  const orig = (d.address || "").trim();
  if (!orig) return null;
  const city = (d.city || "").trim();
  const state = (d.state || "").trim();
  const zip = (d.zip || "").trim();
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let s = orig;
  // Peel trailing zip, then state, then city — the order they appear at the end of
  // a "street, city, ST zip" line — each only if it matches the structured field.
  if (zip) s = s.replace(new RegExp(`[\\s,]*${esc(zip)}\\s*$`), "");
  if (state) s = s.replace(new RegExp(`[\\s,]*\\b${esc(state)}\\b\\s*$`, "i"), "");
  if (city) s = s.replace(new RegExp(`[\\s,]*\\b${esc(city)}\\b\\s*$`, "i"), "");
  s = s.replace(/[\s,]+$/, "").trim();
  if (!s || s === orig) return null;   // nothing to strip, or it would empty the field
  return s;
}

// Robust AI-response JSON parser — strips markdown fences, trailing commas, and
// recovers gracefully from truncated output (the same strategy used server-side
// in extract.ts). Use this whenever parsing a raw AI text response.
export function robustParseJSON(raw: string): unknown {
  if (!raw?.trim()) throw new Error("Empty response");
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try { return JSON.parse(s); } catch {}
  try { return JSON.parse(s.replace(/,(\s*[}\]])/g, "$1")); } catch {}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch {}
  }
  if (first !== -1) {
    try { return _repairTruncatedJSON(s.slice(first)); } catch {}
  }
  throw new Error("The AI's response couldn't be read as structured data — it came back incomplete or not in the expected format.");
}
function _repairTruncatedJSON(s: string): unknown {
  let inStr = false, esc = false;
  const stack: string[] = [];
  let safeLen = -1, safeClosers = "";
  const closersFor = () => stack.map(b => b === "{" ? "}" : "]").reverse().join("");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") { stack.pop(); safeLen = i + 1; safeClosers = closersFor(); }
    else if (c === ",") { safeLen = i; safeClosers = closersFor(); }
  }
  if (safeLen <= 0) throw new Error("Could not repair truncated JSON");
  return JSON.parse(s.slice(0, safeLen).replace(/,\s*$/, "") + safeClosers);
}

export function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const TENANT_LOGO_DOMAINS: Record<string, string> = {
  "home depot": "homedepot.com", "the home depot": "homedepot.com",
  "target": "target.com", "walmart": "walmart.com", "costco": "costco.com",
  "tj maxx": "tjmaxx.com", "marshalls": "marshalls.com",
  "homegoods": "homegoods.com", "homesense": "homesense.com",
  "ross dress for less": "rossstores.com",
  "burlington": "burlington.com",
  "nordstrom rack": "nordstromrack.com", "nordstrom": "nordstrom.com",
  "best buy": "bestbuy.com",
  "petsmart": "petsmart.com", "petco": "petco.com",
  "five below": "fivebelow.com",
  "dollar tree": "dollartree.com", "family dollar": "familydollar.com",
  "dollar general": "dollargeneral.com",
  "michaels": "michaels.com", "hobby lobby": "hobbylobby.com",
  "ulta beauty": "ulta.com",
  "old navy": "oldnavy.com", "gap": "gap.com", "banana republic": "bananarepublic.com",
  "bath and body works": "bathandbodyworks.com",
  "kay jewelers": "kay.com", "zales": "zales.com",
  "foot locker": "footlocker.com",
  "famous footwear": "famousfootwear.com",
  "dsw": "dsw.com",
  "cvs": "cvs.com", "walgreens": "walgreens.com", "rite aid": "riteaid.com",
  "bank of america": "bankofamerica.com",
  "chase": "chase.com", "wells fargo": "wellsfargo.com",
  "td bank": "td.com",
  "navy federal credit union": "navyfederal.org",
  "fedex office": "fedex.com",
  "att": "att.com", "t mobile": "t-mobile.com", "verizon": "verizon.com",
  "amc theatres": "amctheatres.com",
  "planet fitness": "planetfitness.com",
  "orange theory fitness": "orangetheory.com", "orangetheory fitness": "orangetheory.com",
  "massage envy": "massageenvy.com",
  "great clips": "greatclips.com", "sport clips": "sportclips.com",
  "mcdonalds": "mcdonalds.com", "starbucks": "starbucks.com",
  "chick fil a": "chick-fil-a.com", "taco bell": "tacobell.com",
  "chipotle": "chipotle.com", "panera bread": "panerabread.com",
  "five guys": "fiveguys.com", "shake shack": "shakeshack.com",
  "subway": "subway.com",
  "publix": "publix.com", "kroger": "kroger.com",
  "whole foods market": "wholefoodsmarket.com",
  "trader joes": "traderjoes.com",
  "aldi": "aldi.us", "lidl": "lidl.com",
  "stop and shop": "stopandshop.com",
  "food lion": "foodlion.com", "safeway": "safeway.com",
  "giant eagle": "gianteagle.com",
  "quest diagnostics": "questdiagnostics.com",
  "heartland dental": "heartland.com",
  "aspen dental": "aspendental.com",
};

export function tenantLogoDomain(name: unknown, canonicalName?: string | null): string | null {
  const key = tenantKey(canonicalName || name);
  return TENANT_LOGO_DOMAINS[key] ?? null;
}

/**
 * Coerce a step field (rentSchedule / rentBumps / renewalOptions) to a
 * semicolon-joined string. OM extraction returns these as strings, but the
 * rent-roll AI sometimes returns an array (or other) — this normalizes both so
 * downstream `.split(";")` never blows up.
 */
export function toStepString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(formatStepItem).filter(Boolean).join("; ");
  if (typeof v === "object") return formatStepItem(v);
  return String(v);
}

// Render a single rent-step / renewal-option value as readable text. The AI
// sometimes returns these as structured objects (e.g. a renewal option
// {optionNumber, termMonths, rentPerSF, expiryDate}); without this they print
// as "[object Object]". Strings pass through unchanged.
function formatStepItem(x: unknown): string {
  if (x == null) return "";
  if (typeof x === "string") return x;
  if (typeof x !== "object") return String(x);
  const o = x as Record<string, unknown>;
  // Case-insensitive field lookup across common key spellings.
  const norm: Record<string, unknown> = {};
  for (const k of Object.keys(o)) norm[k.toLowerCase().replace(/[^a-z0-9]/g, "")] = o[k];
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) { const kk = k.toLowerCase().replace(/[^a-z0-9]/g, ""); if (norm[kk] != null && norm[kk] !== "") return norm[kk]; }
    return null;
  };
  const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const monYear = (v: unknown): string => {
    const s = String(v);
    const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) { const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`); if (!isNaN(d.getTime())) return d.toLocaleDateString("en-US", { month: "short", year: "numeric" }); }
    return s;
  };

  const optNum = num(pick("optionNumber", "option", "optionNo", "number", "no"));
  const months = num(pick("termMonths", "months"));
  const years = num(pick("termYears", "years", "term"));
  const psf = num(pick("rentPerSF", "rentPSF", "psf", "rentPerSf", "ratePerSF", "rate"));
  const annual = num(pick("annualRent", "annual", "rent", "amount"));
  const dateV = pick("expiryDate", "expiry", "endDate", "through", "thru", "leaseExpiry", "date", "startDate", "commencement", "commenceDate", "effectiveDate");

  let term = "";
  if (years != null) term = `${years} yr`;
  else if (months != null) term = months % 12 === 0 ? `${months / 12} yr` : `${months} mo`;

  let rent = "";
  if (psf != null) rent = `$${psf.toFixed(2)}/SF`;
  else if (annual != null) rent = `$${annual.toLocaleString("en-US")}`;

  const head = optNum != null ? `Opt ${optNum}` : "";
  const body = [term, rent].filter(Boolean).join(" @ ");
  const tail = dateV != null ? `→ ${monYear(dateV)}` : "";
  const tailBody = [body, tail].filter(Boolean).join(" ");
  const out = head ? (tailBody ? `${head}: ${tailBody}` : head) : tailBody;
  if (out) return out;
  // Unknown shape — join primitive values so we never emit "[object Object]".
  return Object.values(o).filter(v => v != null && typeof v !== "object").map(String).filter(Boolean).join(" ");
}

/**
 * Filters a rentSchedule or rentBumps string (semicolon-delimited steps)
 * to only include steps whose date is today or in the future.
 * Steps with no parseable date are kept (can't determine if past).
 */
export function filterFutureRentSteps(raw: unknown): string {
  const s = toStepString(raw);
  if (!s) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const steps = s.split(";").map(s => s.trim()).filter(Boolean);
  const future = steps.filter(step => {
    const isoMatch = step.match(/(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) {
      const d = new Date(isoMatch[1]);
      return isNaN(d.getTime()) || d >= today;
    }
    const monYearMatch = step.match(/([A-Za-z]{3})[-\s](\d{4})/);
    if (monYearMatch) {
      const d = new Date(`${monYearMatch[1]} 1, ${monYearMatch[2]}`);
      return isNaN(d.getTime()) || d >= today;
    }
    const slashMatch = step.match(/(\d{4})\/(\d{2})\/(\d{2})/);
    if (slashMatch) {
      const d = new Date(`${slashMatch[1]}-${slashMatch[2]}-${slashMatch[3]}`);
      return isNaN(d.getTime()) || d >= today;
    }
    return true;
  });
  return future.join("; ");
}
