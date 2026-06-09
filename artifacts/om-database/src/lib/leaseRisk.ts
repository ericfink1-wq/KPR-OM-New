import type {
  Deal, LeaseAbstract, Tenant, TenantLeaseRisk, CoTenancyClause, SalesKickout,
  OtherRiskClauses, TriggerNode, TriggerCondition, AnchorStatus, CoTenancyRemedy,
} from "./idb";
import { tenantKey, isVacant } from "./utils";

// Lease-risk RESOLVER + EXPOSURE ENGINE (deterministic, token-free).
//
// The exposure engine answers: "if a named anchor leaves/goes dark, which tenant
// leases trip — on that anchor ALONE vs. needing a second event — and how much
// base rent is at risk?" It runs off the RESOLVED view: OM-disclosed clauses
// (unverified) overridden, per tenant, by a pasted lease abstract (verified).
// A rent-roll-only pipeline can't see any of this; this is the linking layer.

// ── normalisation ──────────────────────────────────────────────────────────────
// Anchor names are matched loosely so "Dick's", "Dick's Sporting Goods", and
// "DICKS" collapse together. Re-uses tenantKey (the roster/comp grouping key) so
// a co-tenancy reference and a roster anchor line resolve to the same anchor.
function normAnchor(s: unknown): string {
  return tenantKey(s);
}

// ── trigger tree helpers ────────────────────────────────────────────────────────
function isBranch(n: TriggerNode): n is { operator: "AND" | "OR"; conditions: TriggerNode[] } {
  return !!n && typeof (n as { operator?: unknown }).operator === "string"
    && Array.isArray((n as { conditions?: unknown }).conditions);
}

/** All leaf conditions in a trigger tree (depth-first). */
export function collectLeaves(node: TriggerNode | null | undefined): TriggerCondition[] {
  if (!node) return [];
  if (isBranch(node)) return node.conditions.flatMap(collectLeaves);
  return [node as TriggerCondition];
}

// ── anchor-count ("X of N") helpers ──────────────────────────────────────────────
// A count leaf models "at least openRequired of these N named stores must stay open";
// it FAILS (the co-tenancy trips) only when (N − openRequired + 1) of them go dark.
function isCountLeaf(c: TriggerCondition): boolean {
  return /count/i.test(String(c?.type || "")) && Array.isArray(c?.anchors);
}
function countDarkNeeded(c: TriggerCondition): number {
  const n = (c.anchors || []).length;
  const open = c.openRequired != null ? c.openRequired : n;
  return Math.max(1, n - open + 1);
}
// Fuzzy "is this anchor in the dark set?" (brand-key match, like normAnchor).
function setHasAnchor(darkSet: Set<string>, name: unknown): boolean {
  const target = normAnchor(name);
  if (!target) return false;
  for (const d of darkSet) {
    const nd = normAnchor(d);
    if (nd && (nd === target || nd.includes(target) || target.includes(nd))) return true;
  }
  return false;
}
function anchorMatch(a: unknown, target: string): boolean {
  const na = normAnchor(a);
  return !!na && !!target && (na === target || na.includes(target) || target.includes(na));
}

/** A leaf references this anchor — a single named-anchor leaf OR an "X of N" count
 *  leaf whose list includes it. (Drives linkage + the dependency graph + matrix.) */
function leafNamesAnchor(c: TriggerCondition, anchor: string): boolean {
  if (!c) return false;
  const target = normAnchor(anchor);
  if (!target) return false;
  if (c.anchor && /anchor/i.test(String(c.type || "")) && anchorMatch(c.anchor, target)) return true;
  if (isCountLeaf(c)) return (c.anchors || []).some((x) => anchorMatch(x, target));
  return false;
}

/** Does any leaf in the tree reference this anchor? (linkage / "any linkage" test.) */
export function triggerReferencesAnchor(node: TriggerNode | null | undefined, anchor: string): boolean {
  return collectLeaves(node).some((c) => leafNamesAnchor(c, anchor));
}

/** Every distinct anchor named anywhere in a clause's trigger tree (single + count). */
function treeAnchors(node: TriggerNode | null | undefined): string[] {
  const out = new Map<string, string>();
  for (const leaf of collectLeaves(node)) {
    if (leaf.anchor && /anchor/i.test(String(leaf.type || ""))) { const k = normAnchor(leaf.anchor); if (k) out.set(k, leaf.anchor); }
    if (isCountLeaf(leaf)) for (const a of (leaf.anchors || [])) { const k = normAnchor(a); if (k && !out.has(k)) out.set(k, a); }
  }
  return [...out.values()];
}

/** Legacy per-leaf evaluator — kept for callers/tests that pass a leaf predicate. */
export function evaluateTrigger(
  node: TriggerNode | null | undefined,
  isTrue: (c: TriggerCondition) => boolean,
): boolean {
  if (!node) return false;
  if (isBranch(node)) {
    if (!node.conditions.length) return false;
    return node.operator === "AND"
      ? node.conditions.every((c) => evaluateTrigger(c, isTrue))
      : node.conditions.some((c) => evaluateTrigger(c, isTrue));
  }
  return isTrue(node as TriggerCondition);
}

// Set-based evaluator: given the set of DARK anchors and whether occupancy is below
// its threshold, does the trigger fire? This is what makes "X of N" accurate — a
// count leaf fires only when ENOUGH of its named stores are dark.
function leafTrips(c: TriggerCondition, darkSet: Set<string>, occBelow: boolean): boolean {
  const t = String(c.type || "");
  if (/occupancy_threshold/i.test(t)) return occBelow;
  if (isCountLeaf(c)) {
    const dark = (c.anchors || []).filter((a) => setHasAnchor(darkSet, a)).length;
    return dark >= countDarkNeeded(c);
  }
  if (c.anchor && /anchor/i.test(t)) return setHasAnchor(darkSet, c.anchor);
  return false; // unknown / non-anchor leaf — not driven by an anchor going dark
}
function evalTrigger(node: TriggerNode | null | undefined, darkSet: Set<string>, occBelow: boolean): boolean {
  if (!node) return false;
  if (isBranch(node)) {
    if (!node.conditions.length) return false;
    return node.operator === "AND"
      ? node.conditions.every((c) => evalTrigger(c, darkSet, occBelow))
      : node.conditions.some((c) => evalTrigger(c, darkSet, occBelow));
  }
  return leafTrips(node as TriggerCondition, darkSet, occBelow);
}

/** Plain-English rendering of a trigger tree for display / flags. */
export function describeTrigger(node: TriggerNode | null | undefined): string {
  if (!node) return "";
  if (isBranch(node)) {
    const inner = node.conditions.map(describeTrigger).filter(Boolean);
    if (!inner.length) return "";
    const joined = inner.join(node.operator === "AND" ? " AND " : " OR ");
    return inner.length > 1 ? `(${joined})` : joined;
  }
  const c = node as TriggerCondition;
  const t = String(c.type || "");
  if (isCountLeaf(c)) {
    const n = (c.anchors || []).length, open = c.openRequired != null ? c.openRequired : n;
    return `${n - open + 1}+ of ${n} dark (needs ${open} of ${n} open: ${(c.anchors || []).join(", ")})`;
  }
  if (/named_anchor/i.test(t)) return `${c.anchor || "anchor"}${/dark/i.test(t) ? " dark" : /gone/i.test(t) ? " gone" : ""}`;
  if (/occupancy_threshold/i.test(t)) {
    const dir = c.direction === "below" ? "<" : c.direction === "above" ? ">" : "";
    return `occupancy ${dir}${c.pct != null ? `${c.pct}%` : ""}${c.scope ? ` (${c.scope})` : ""}`.trim();
  }
  if (/replacement/i.test(t)) return `no suitable replacement${c.anchor ? ` for ${c.anchor}` : ""}`;
  return c.note || t || "condition";
}

// Tier of a single co-tenancy clause for a given at-risk anchor. Occupancy is held at
// NOT-below — anchor tiers isolate the ANCHOR effect (a broad-occupancy decline is a
// separate risk axis), and the "events" counted toward Tier 2 are OTHER anchors going
// dark. So an "X of N" store that needs several peers dark correctly lands at Tier 3.
//   1 = trips on this anchor ALONE
//   2 = trips when this anchor PLUS one other named anchor goes dark
//   3 = linked to this anchor but needs ≥2 further anchor departures
//   0 = not linked to this anchor
export function clauseTierForAnchor(clause: CoTenancyClause, anchor: string): 0 | 1 | 2 | 3 {
  const tree = clause.triggerLogic;
  if (!triggerReferencesAnchor(tree, anchor)) return 0;
  if (evalTrigger(tree, new Set([anchor]), false)) return 1;
  const others = treeAnchors(tree).filter((a) => normAnchor(a) !== normAnchor(anchor));
  for (const x of others) {
    if (evalTrigger(tree, new Set([anchor, x]), false)) return 2;
  }
  return 3;
}

// ── resolution: OM (unverified) overridden by abstract (verified) per tenant ─────
export interface ResolvedTenantRisk {
  tenant: string;
  key: string;
  suite?: string | null;
  baseRentAnnual: number | null;
  coTenancy: CoTenancyClause[];
  salesKickout: SalesKickout[];
  otherRiskClauses: OtherRiskClauses | null;
  source: "abstract" | "OM" | "none";
  hasUnverified: boolean;   // any present co-tenancy/kickout clause not verified against an executed doc
}

function rosterRentByKey(tenants: Tenant[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tenants) {
    if (!t.name || isVacant(t.name)) continue;
    const r = Number(t.annualRent);
    if (Number.isFinite(r) && r > 0) m.set(tenantKey(t.canonicalName || t.name), r);
  }
  return m;
}

// Mark every clause's verification flag for the layer it came from (default by
// source): abstract ⇒ verified true unless explicitly false; OM ⇒ false.
function stamp<T extends { verifiedAgainstExecutedDoc?: boolean | null; sourceDocument?: string | null }>(
  clauses: T[] | null | undefined, verified: boolean, fallbackDoc: string,
): T[] {
  // Guard against malformed stored data (a clause group that isn't an array).
  return (Array.isArray(clauses) ? clauses : []).filter((c): c is T => !!c && typeof c === "object").map((c) => ({
    ...c,
    sourceDocument: c.sourceDocument || fallbackDoc,
    verifiedAgainstExecutedDoc: c.verifiedAgainstExecutedDoc ?? verified,
  }));
}

function clauseUnverified(c: { verifiedAgainstExecutedDoc?: boolean | null }): boolean {
  return c.verifiedAgainstExecutedDoc !== true;
}

/**
 * Merge a deal's OM-level lease risk with any pasted lease abstracts. For each
 * tenant + clause group, a present abstract group OVERRIDES the OM group and is
 * treated as verified; otherwise the OM (unverified) group is used.
 */
export function resolveTenantRisk(deal: Deal, abstracts: LeaseAbstract[] = []): ResolvedTenantRisk[] {
  const rosterRent = rosterRentByKey(deal.tenants || []);
  const omByKey = new Map<string, TenantLeaseRisk>();
  for (const t of deal.leaseRisk?.tenants ?? []) {
    if (t?.tenant) omByKey.set(tenantKey(t.tenant), t);
  }
  const absByKey = new Map<string, LeaseAbstract>();
  for (const a of abstracts) {
    if (a?.tenantName) absByKey.set(tenantKey(a.tenantName), a);
  }

  const keys = new Set<string>([...omByKey.keys(), ...absByKey.keys()]);
  const out: ResolvedTenantRisk[] = [];
  for (const key of keys) {
    const om = omByKey.get(key);
    const ab = absByKey.get(key);
    const name = ab?.tenantName || om?.tenant || key;

    const absCo = stamp(ab?.coTenancy, true, ab ? `${ab.tenantName} lease (executed)` : "lease");
    const absKick = stamp(ab?.salesKickout, true, ab ? `${ab.tenantName} lease (executed)` : "lease");
    const omCo = stamp(om?.coTenancy, false, "OM (rent-roll footnote / lease summary)");
    const omKick = stamp(om?.salesKickout, false, "OM (rent-roll footnote / lease summary)");

    const coTenancy = absCo.length ? absCo : omCo;
    const salesKickout = absKick.length ? absKick : omKick;
    const otherRiskClauses = ab?.otherRiskClauses ?? om?.otherRiskClauses ?? null;

    const baseRentAnnual =
      (ab?.baseRentAnnual != null ? Number(ab.baseRentAnnual) : null) ??
      (om?.baseRentAnnual != null ? Number(om.baseRentAnnual) : null) ??
      (rosterRent.get(key) ?? null);

    const source: ResolvedTenantRisk["source"] =
      (absCo.length || absKick.length || ab?.otherRiskClauses) ? "abstract"
      : (omCo.length || omKick.length || om?.otherRiskClauses) ? "OM"
      : "none";

    const hasUnverified = [...coTenancy, ...salesKickout].some(clauseUnverified);

    out.push({ tenant: name, key, suite: ab?.suite ?? om?.suite ?? null, baseRentAnnual, coTenancy, salesKickout, otherRiskClauses, source, hasUnverified });
  }
  out.sort((a, b) => (b.baseRentAnnual ?? 0) - (a.baseRentAnnual ?? 0) || a.tenant.localeCompare(b.tenant));
  return out;
}

// ── anchor status ────────────────────────────────────────────────────────────────
/** A condition references this anchor as "tripped" in the live world. departing /
 *  relocating anchors are tripped; in_place / shadow are not; NAP (unowned, may be
 *  open elsewhere) is conservatively treated as NOT tripped unless also departing. */
export function anchorIsTripped(st: AnchorStatus | undefined): boolean {
  if (!st) return false;
  return st.status === "departing" || st.relocating === true;
}

/** Distinct anchor names referenced by any resolved co-tenancy trigger — both single
 *  named-anchor leaves AND every store named in an "X of N" count leaf. */
export function anchorsReferenced(resolved: ResolvedTenantRisk[]): string[] {
  const seen = new Map<string, string>();
  const add = (name: unknown) => { const k = normAnchor(name); if (k && !seen.has(k)) seen.set(k, String(name)); };
  for (const r of resolved) {
    for (const c of r.coTenancy) {
      for (const leaf of collectLeaves(c.triggerLogic)) {
        if (leaf.anchor && /anchor/i.test(String(leaf.type || ""))) add(leaf.anchor);
        if (isCountLeaf(leaf)) for (const a of (leaf.anchors || [])) add(a);
      }
    }
  }
  return [...seen.values()];
}

/** Seed an editable anchor-status table from the roster + referenced anchors. */
export function seedAnchorStatus(deal: Deal, abstracts: LeaseAbstract[] = []): AnchorStatus[] {
  const resolved = resolveTenantRisk(deal, abstracts);
  const byKey = new Map<string, AnchorStatus>();
  const add = (name: string, st: AnchorStatus["status"], relocating = false) => {
    const k = normAnchor(name);
    if (!k || byKey.has(k)) return;
    byKey.set(k, { anchor: name, status: st, relocating, termExpiration: null });
  };
  // Roster anchors first (carry their real status), then any co-tenancy-referenced anchor.
  for (const t of deal.tenants || []) {
    if (!t.name || isVacant(t.name) || !t.isAnchor) continue;
    const st: AnchorStatus["status"] = t.isNAP ? "NAP" : t.isDark ? "departing" : "in_place";
    add(t.canonicalName || t.name, st, false);
    if (byKey.has(normAnchor(t.canonicalName || t.name)) && t.leaseExpiry) {
      byKey.get(normAnchor(t.canonicalName || t.name))!.termExpiration = String(t.leaseExpiry).slice(0, 10);
    }
  }
  for (const name of anchorsReferenced(resolved)) add(name, "in_place");
  return [...byKey.values()];
}

// ── exposure engine ──────────────────────────────────────────────────────────────
export interface ExposureClause {
  tenant: string;
  baseRentAnnual: number | null;
  tier: 1 | 2 | 3;
  clauseType: "opening" | "operating" | null;
  remedy: CoTenancyRemedy | null;
  reliefMonths: number | null;
  terminationNoticeDays: number | null;
  cureCondition: string | null;
  verified: boolean;
  triggerSummary: string;
}

export interface ExposureResult {
  anchor: string;
  clauses: ExposureClause[];
  tier1Rent: number;   // trips on this anchor alone
  tier2Rent: number;   // needs a second event
  tier3Rent: number;   // ANY linkage (inclusive of tier 1 + 2 + 3)
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
}

/** Evaluate every resolved co-tenancy clause against a single at-risk anchor. */
export function computeExposure(resolved: ResolvedTenantRisk[], anchor: string): ExposureResult {
  const clauses: ExposureClause[] = [];
  for (const r of resolved) {
    for (const c of r.coTenancy) {
      const tier = clauseTierForAnchor(c, anchor);
      if (tier === 0) continue;
      clauses.push({
        tenant: r.tenant,
        baseRentAnnual: r.baseRentAnnual,
        tier,
        clauseType: c.type ?? null,
        remedy: c.remedy ?? null,
        reliefMonths: c.reliefPeriodMonthsBeforeTermination ?? null,
        terminationNoticeDays: c.terminationNoticeDays ?? null,
        cureCondition: c.cureCondition ?? null,
        verified: c.verifiedAgainstExecutedDoc === true,
        triggerSummary: describeTrigger(c.triggerLogic),
      });
    }
  }
  const sumTier = (n: number) => clauses.filter((c) => c.tier === n).reduce((s, c) => s + (c.baseRentAnnual ?? 0), 0);
  const tier1Rent = sumTier(1);
  const tier2Rent = sumTier(2);
  const tier3Rent = clauses.reduce((s, c) => s + (c.baseRentAnnual ?? 0), 0);
  return {
    anchor,
    clauses: clauses.sort((a, b) => a.tier - b.tier || (b.baseRentAnnual ?? 0) - (a.baseRentAnnual ?? 0)),
    tier1Rent, tier2Rent, tier3Rent,
    tier1Count: clauses.filter((c) => c.tier === 1).length,
    tier2Count: clauses.filter((c) => c.tier === 2).length,
    tier3Count: clauses.length,
  };
}

export interface AnchorDependency {
  anchor: string;
  dependents: { tenant: string; baseRentAnnual: number | null; clauseType: "opening" | "operating" | null }[];
}

/** Anchor → every tenant clause that references it (linkage, scenario-independent). */
export function buildAnchorDependencyGraph(resolved: ResolvedTenantRisk[]): AnchorDependency[] {
  const anchors = anchorsReferenced(resolved);
  return anchors.map((anchor) => {
    const dependents: AnchorDependency["dependents"] = [];
    for (const r of resolved) {
      for (const c of r.coTenancy) {
        if (triggerReferencesAnchor(c.triggerLogic, anchor)) {
          dependents.push({ tenant: r.tenant, baseRentAnnual: r.baseRentAnnual, clauseType: c.type ?? null });
        }
      }
    }
    return { anchor, dependents };
  }).filter((d) => d.dependents.length > 0);
}

/** Convenience: resolve + run exposure for one anchor straight off a deal. */
export function computeDealExposure(deal: Deal, abstracts: LeaseAbstract[], anchor: string): ExposureResult {
  return computeExposure(resolveTenantRisk(deal, abstracts), anchor);
}

// ── combined multi-anchor scenario ───────────────────────────────────────────────
// "What if ALL of these anchors go dark together?" — evaluates each clause with the
// whole selected set dark, surfacing cascade exposure a single-anchor view misses
// (e.g. a tenant that needs two of three anchors dark). comboOnly = trips under the
// combination but NOT under any single selected anchor alone.
export interface CombinedClause {
  tenant: string;
  baseRentAnnual: number | null;
  remedy: CoTenancyRemedy | null;
  terminationNoticeDays: number | null;
  verified: boolean;
  triggerSummary: string;
  comboOnly: boolean;
}
export interface CombinedExposure {
  anchors: string[];
  clauses: CombinedClause[];
  totalRent: number;       // base rent that trips when all selected anchors go dark
  comboOnlyRent: number;   // of that, the rent that trips ONLY because of the combination
}

export function computeCombinedExposure(resolved: ResolvedTenantRisk[], anchors: string[]): CombinedExposure {
  const sel = anchors.filter(Boolean);
  const darkSet = new Set(sel);
  const clauses: CombinedClause[] = [];
  for (const r of resolved) {
    for (const c of r.coTenancy) {
      if (!sel.some((a) => triggerReferencesAnchor(c.triggerLogic, a))) continue;  // unrelated to the selected set
      if (!evalTrigger(c.triggerLogic, darkSet, false)) continue;                  // doesn't trip even with all selected dark
      // comboOnly = trips under the combination but NOT from any single selected anchor alone
      const tripsSingle = sel.some((a) => evalTrigger(c.triggerLogic, new Set([a]), false));
      clauses.push({
        tenant: r.tenant,
        baseRentAnnual: r.baseRentAnnual,
        remedy: c.remedy ?? null,
        terminationNoticeDays: c.terminationNoticeDays ?? null,
        verified: c.verifiedAgainstExecutedDoc === true,
        triggerSummary: describeTrigger(c.triggerLogic),
        comboOnly: !tripsSingle,
      });
    }
  }
  clauses.sort((a, b) => Number(a.comboOnly) - Number(b.comboOnly) || (b.baseRentAnnual ?? 0) - (a.baseRentAnnual ?? 0));
  return {
    anchors: sel,
    clauses,
    totalRent: clauses.reduce((s, c) => s + (c.baseRentAnnual ?? 0), 0),
    comboOnlyRent: clauses.filter((c) => c.comboOnly).reduce((s, c) => s + (c.baseRentAnnual ?? 0), 0),
  };
}

// ── risk matrix (anchor × tenant) ─────────────────────────────────────────────────
// A single grid for export: rows = tenants whose co-tenancy depends on an anchor,
// columns = the at-risk anchors, each cell = the WORST (lowest) tier at which that
// tenant trips on that anchor. Anchor columns carry the rent at stake (ranked), and
// tenant rows carry their own base rent (ranked) — "who is affected by whom, and how
// much rent is on the line." Deterministic, token-free; mirrors the panel's math.
export interface MatrixCell {
  tier: 1 | 2 | 3;
  clauseType: "opening" | "operating" | null;
  remedy: CoTenancyRemedy | null;
  terminationNoticeDays: number | null;
  verified: boolean;
  triggerSummary: string;
}
export interface MatrixTenantRow {
  tenant: string;
  key: string;
  baseRentAnnual: number | null;
  cells: Record<string, MatrixCell>;   // keyed by anchor display name
  worstTier: 1 | 2 | 3;                // lowest tier across this row's cells
  anchorsAffecting: number;
  anyVerified: boolean;                // any cell sourced from an executed lease
}
export interface MatrixAnchorCol {
  anchor: string;
  tier1Rent: number;     // base rent of tenants that trip on this anchor ALONE
  tier2Rent: number;     // base rent of tenants that need this anchor + one more event
  totalRent: number;     // base rent of every tenant linked to this anchor (any tier)
  dependentCount: number;
}
export interface RiskMatrix {
  anchors: MatrixAnchorCol[];   // ranked: most tier-1 rent at stake first
  tenants: MatrixTenantRow[];   // ranked: most base rent at stake first
}

/** Build the anchor × tenant exposure matrix from the resolved view. */
export function buildRiskMatrix(resolved: ResolvedTenantRisk[]): RiskMatrix {
  const anchorNames = anchorsReferenced(resolved);

  const tenants: MatrixTenantRow[] = [];
  for (const r of resolved) {
    if (!r.coTenancy.length) continue;
    const cells: Record<string, MatrixCell> = {};
    for (const anchor of anchorNames) {
      // Across this tenant's clauses, keep the one with the lowest (worst) tier
      // for this anchor — the most easily tripped is the one that matters.
      let best: MatrixCell | null = null;
      for (const c of r.coTenancy) {
        const tier = clauseTierForAnchor(c, anchor);
        if (tier === 0) continue;
        if (!best || tier < best.tier) {
          best = {
            tier,
            clauseType: c.type ?? null,
            remedy: c.remedy ?? null,
            terminationNoticeDays: c.terminationNoticeDays ?? null,
            verified: c.verifiedAgainstExecutedDoc === true,
            triggerSummary: describeTrigger(c.triggerLogic),
          };
        }
      }
      if (best) cells[anchor] = best;
    }
    const keys = Object.keys(cells);
    if (!keys.length) continue;
    const worstTier = keys.reduce((m, a) => Math.min(m, cells[a].tier), 3) as 1 | 2 | 3;
    tenants.push({
      tenant: r.tenant, key: r.key, baseRentAnnual: r.baseRentAnnual, cells,
      worstTier, anchorsAffecting: keys.length,
      anyVerified: keys.some((a) => cells[a].verified),
    });
  }

  const anchors: MatrixAnchorCol[] = anchorNames.map((anchor) => {
    let tier1Rent = 0, tier2Rent = 0, totalRent = 0, dependentCount = 0;
    for (const t of tenants) {
      const cell = t.cells[anchor];
      if (!cell) continue;
      const rent = t.baseRentAnnual ?? 0;
      dependentCount += 1;
      totalRent += rent;
      if (cell.tier === 1) tier1Rent += rent;
      else if (cell.tier === 2) tier2Rent += rent;
    }
    return { anchor, tier1Rent, tier2Rent, totalRent, dependentCount };
  }).filter((a) => a.dependentCount > 0);

  anchors.sort((a, b) => b.tier1Rent - a.tier1Rent || b.totalRent - a.totalRent || a.anchor.localeCompare(b.anchor));
  // Rank tenants by Tier-1 exposure dollars — the base rent that trips if a single
  // anchor goes dark on its own (worstTier 1). Biggest single-event risks sit at
  // the top; tenants that need a second event fall below, then by base rent / name.
  const tier1Dollars = (t: MatrixTenantRow) => (t.worstTier === 1 ? (t.baseRentAnnual ?? 0) : 0);
  tenants.sort((a, b) =>
    tier1Dollars(b) - tier1Dollars(a) ||
    (b.baseRentAnnual ?? 0) - (a.baseRentAnnual ?? 0) ||
    a.worstTier - b.worstTier ||
    a.tenant.localeCompare(b.tenant));

  return { anchors, tenants };
}

// ── auto-generated diligence to-do list ──────────────────────────────────────────
export interface DiligenceItem {
  kind: "verify_unverified" | "pull_leases_no_cotenancy";
  tenant: string;
  message: string;
}

/**
 * Auto diligence list:
 *  - every co-tenancy/kickout clause not yet verified against an executed doc → "verify";
 *  - every real (non-vacant, non-shadow/NAP) roster tenant with NO co-tenancy captured →
 *    "co-tenancy not disclosed in OM — pull leases" (the OM's silence is not evidence
 *    of no risk).
 */
export function buildDiligenceList(deal: Deal, abstracts: LeaseAbstract[] = []): DiligenceItem[] {
  const resolved = resolveTenantRisk(deal, abstracts);
  const haveCoTenancy = new Set<string>();
  const items: DiligenceItem[] = [];
  for (const r of resolved) {
    if (r.coTenancy.length) haveCoTenancy.add(r.key);
    const unverified = [...r.coTenancy, ...r.salesKickout].some((c) => c.verifiedAgainstExecutedDoc !== true);
    if (unverified) {
      items.push({ kind: "verify_unverified", tenant: r.tenant, message: `${r.tenant}: clause captured from a summary — pull and verify against the executed lease.` });
    }
  }
  // Only emit "pull leases" once the OM has actually been processed for lease risk
  // (deal.leaseRisk present). On older deals with no lease-risk data we have no
  // basis to claim co-tenancy is "not disclosed", and we don't want a noisy list.
  if (deal.leaseRisk) {
    for (const t of deal.tenants || []) {
      if (!t.name || isVacant(t.name)) continue;
      if (t.isNAP || (t.isAnchor && (t.isDark || t.isNAP))) continue; // shadow/unowned anchors aren't "our" leases to pull
      if (haveCoTenancy.has(tenantKey(t.canonicalName || t.name))) continue;
      items.push({ kind: "pull_leases_no_cotenancy", tenant: t.canonicalName || t.name, message: `${t.canonicalName || t.name}: co-tenancy not disclosed in OM — pull leases.` });
    }
  }
  return items;
}

