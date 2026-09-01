// Dedicated, server-side LEASE-RISK extraction pass + normalizer + validators.
//
// This runs as its OWN focused model call (separate from the big tenant/roster
// pass) so a long rent roll truncating the main extraction can never drop the
// co-tenancy / kickout data. It reuses the cached OM blocks, so the document is a
// cache hit (cheap). Everything it produces is normalised to source:"OM",
// verifiedAgainstExecutedDoc:false — an OM summary is never treated as verified.
//
// DB-free on purpose: the model call is injected, so this module is unit-testable
// with a mocked model and never imports the database layer.

// ── lightweight structural types (mirror the client idb.ts shapes) ───────────────
export interface TriggerCondition {
  type: string;
  anchor?: string | null;
  // for "anchor_count_below" ("X of N" co-tenancy): the FULL named list and how many
  // must stay open. The clause fails only when fewer than openRequired stay open —
  // i.e. when (anchors.length − openRequired + 1) of them go dark. Losing ONE named
  // store does NOT trip it (unless openRequired === anchors.length). These fields
  // MUST survive normalisation: dropping them silently collapses an X-of-N clause
  // into a per-anchor trigger and massively overstates single-anchor exposure.
  anchors?: string[] | null;
  openRequired?: number | null;
  totalNamed?: number | null;
  scope?: string | null;
  direction?: "above" | "below" | null;
  pct?: number | null;
  note?: string | null;
}
export type TriggerNode =
  | { operator: "AND" | "OR"; conditions: TriggerNode[] }
  | TriggerCondition;

interface RiskMeta {
  sourceDocument?: string | null;
  controllingDocument?: string | null;
  sectionRef?: string | null;
  verbatimQuote?: string | null;
  provenance?: "extracted" | "inferred" | null;
  verifiedAgainstExecutedDoc?: boolean | null;
}
export interface CoTenancyClause extends RiskMeta {
  type?: "opening" | "operating" | null;
  triggerLogic?: TriggerNode | null;
  remedy?: { mechanism?: string | null; value?: number | null; cap?: string | null; additionalRentTreatment?: string | null } | null;
  reliefPeriodMonthsBeforeTermination?: number | null;
  terminationNoticeDays?: number | null;
  cureCondition?: string | null;
  suitableReplacementDefinition?: string | null;
  currentlyInEffect?: boolean | null;     // tenant is ALREADY paying alternate/reduced rent today
  currentStatusNote?: string | null;      // detail: effective date, expected cure, etc.
}
export interface SalesKickout extends RiskMeta {
  salesThresholdAmount?: number | null;
  salesThresholdPSF?: number | null;
  measurementPeriod?: string | null;
  noticeWindowDays?: number | null;
  terminationFee?: number | null;
  unamortizedTiRepayment?: number | null;
}
export interface RiskClauseNote extends RiskMeta { present?: boolean | null; summary?: string | null }
export interface OtherRiskClauses {
  goDarkRight?: RiskClauseNote | null;
  continuousOperationCovenant?: RiskClauseNote | null;
  exclusiveUse?: RiskClauseNote | null;
  rofrRofo?: RiskClauseNote | null;
  recaptureAssignment?: RiskClauseNote | null;
  earlyTerminationOption?: RiskClauseNote | null;
}
export interface TenantLeaseRisk {
  tenant: string;
  suite?: string | null;
  baseRentAnnual?: number | null;
  coTenancy?: CoTenancyClause[] | null;
  salesKickout?: SalesKickout[] | null;
  otherRiskClauses?: OtherRiskClauses | null;
}
export interface DealLeaseRisk {
  source: "OM";
  coTenancyDisclosed: boolean;
  tenants: TenantLeaseRisk[];
}

// ── focused prompt ───────────────────────────────────────────────────────────────
export const LEASE_RISK_PROMPT = `You are an expert retail-lease analyst. From the Offering Memorandum text above, extract ONLY the structured LEASE-RISK clauses that the OM ACTUALLY DISCLOSES — co-tenancy, sales kickouts, go-dark / continuous-operation, exclusive use, ROFR/ROFO, recapture/assignment, and early-termination rights. These usually live in rent-roll footnotes or a per-tenant lease-summary / lease-abstract section. Do NOT infer a clause from the mere presence of an anchor; if the OM is silent, say so.

Return ONLY a single valid JSON object, no markdown:
{
  "coTenancyDisclosed": true|false,   // true only if the OM discloses ANY co-tenancy/kickout/go-dark clause for ANY tenant
  "tenants": [
    {
      "tenant": "tenant name — MUST match a tenant on this property's rent roll (see list below). This is structured clause data, NOT a roster row.",
      "suite": "string or null",
      "baseRentAnnual": "number or null — that tenant's base rent put at risk (their in-place annual minimum rent)",
      "coTenancy": [
        {
          "type": "opening|operating",
          "triggerLogic": <AND/OR tree>,   // branch = {"operator":"AND|OR","conditions":[...]}; leaf = {"type":"named_anchor_dark","anchor":"Target"} or {"type":"occupancy_threshold","scope":"Center GLA","direction":"below","pct":80}. Encode EXACTLY what the clause says and preserve which anchors are named. See the CO-TENANCY TRIGGER FIDELITY rules below — an "X of N" requirement is NEVER a per-anchor trigger.
          "remedy": {"mechanism":"alternate_rent_pct_sales|percent_rent_reduction|fixed_reduction","value":<number>,"cap":"string or null","additionalRentTreatment":"tenant_continues|swept|unknown"},
          "reliefPeriodMonthsBeforeTermination": <number or null>,
          "terminationNoticeDays": <number or null>,
          "cureCondition": "string or null",
          "suitableReplacementDefinition": "string or null",
          "currentlyInEffect": true|false,   // true ONLY if the OM says this clause is ALREADY triggered and the tenant is CURRENTLY paying alternate/reduced rent (e.g. "exercised its right to pay reduced rent effective 5/1/2026", "currently in co-tenancy / paying X% of sales"). This is a present fact affecting in-place rent, not a hypothetical. Default false.
          "currentStatusNote": "string or null — when currentlyInEffect, the detail: effective date, current reduced amount, and any expected cure (e.g. 'reduced rent from 5/1/2026; expected to cure when the Cleveland Furniture lease commences')",
          "sectionRef": "string or null",
          "verbatimQuote": "the exact OM sentence(s) — required"
        }
      ],
      "salesKickout": [
        {"salesThresholdAmount":<number|null>,"salesThresholdPSF":<number|null>,"measurementPeriod":"string|null","noticeWindowDays":<number|null>,"terminationFee":<number|null>,"unamortizedTiRepayment":<number|null>,"sectionRef":"string|null","verbatimQuote":"string"}
      ],
      "otherRiskClauses": {
        "goDarkRight": null | {"present":true,"summary":"...","sectionRef":"...","verbatimQuote":"..."},
        "continuousOperationCovenant": null | {...}, "exclusiveUse": null | {...}, "rofrRofo": null | {...}, "recaptureAssignment": null | {...}, "earlyTerminationOption": null | {...}
      }
    }
  ]
}

CO-TENANCY TRIGGER FIDELITY — the single most important thing about a co-tenancy clause is WHAT ACTUALLY TRIPS IT. Getting this wrong by one word turns a benign clause into a fake headline risk. Match the clause to one of these three shapes:
 1. "ANY named tenant" ("Tenant gets relief if ANY of the following ceases to operate", or a list of exactly ONE named store) -> losing that ONE anchor DOES trip it. Encode as {"type":"named_anchor_dark","anchor":"Belk"}, OR'd together when several anchors each trip it alone.
 2. "X of N" ("2 of the following must be open and operating: i) Hobby Lobby ii) Belk iii) Ross", "at least 7 of these 10 Key Stores", "3 of the following") -> encode as ONE leaf {"type":"anchor_count_below","anchors":[<the FULL named list>],"openRequired":X,"totalNamed":N}. Losing ONE named store does NOT trip it — it trips only when (N − X + 1) of them go dark. NEVER model an X-of-N as an OR of per-anchor triggers; that is the most damaging error in this whole extraction and it massively overstates single-anchor exposure.
   - If a slot in the list is itself compound ("iii) EITHER Ross or Ulta"), that slot fails only when BOTH are dark. Expand the clause into an explicit OR of AND-branches over named_anchor_dark leaves so every named anchor is evaluated, rather than inventing a combined "Ross or Ulta" anchor name.
 3. "Occupancy threshold" ("below 75% of GLA occupied", "landlord must maintain 75% occupancy of the non-anchor floor area") -> encode as {"type":"occupancy_threshold","scope":"Center GLA"|"non-anchor floor area","direction":"below","pct":75}. There is NO named anchor here — do not invent one.
A single clause often has BOTH a named-anchor prong AND a standalone occupancy prong (e.g. "2 of {A,B,C} open" PLUS "center must stay above 65% occupied"). Those are SEPARATE, independent triggers — OR them together, never fold the occupancy percentage into the anchor count.
Always carry the exact verbatim clause text in verbatimQuote so the structure can be audited.

RULES:
- Include a tenant entry ONLY if it actually has at least one disclosed clause. Omit tenants the OM is silent on (they are handled downstream as "pull leases").
- NEVER put an anchor named only inside a co-tenancy trigger (e.g. a shadow anchor) into a tenant row — anchors belong only inside triggerLogic.
- If the OM discloses NO such clauses at all, return {"coTenancyDisclosed":false,"tenants":[]}.
- Output must start with { and end with }.`;

// ── coercion / normalisation ─────────────────────────────────────────────────────
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function coerceTriggerNode(raw: unknown): TriggerNode | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if ((o.operator === "AND" || o.operator === "OR") && Array.isArray(o.conditions)) {
    const conditions = o.conditions.map(coerceTriggerNode).filter((n): n is TriggerNode => n != null);
    if (!conditions.length) return null;
    return { operator: o.operator, conditions };
  }
  if (typeof o.type === "string" && o.type.trim()) {
    const leaf: TriggerCondition = { type: o.type.trim() };
    if (o.anchor != null) leaf.anchor = str(o.anchor);
    // Preserve the "X of N" shape. Without this an anchor_count_below leaf loses its
    // named list and count and degrades into a bare per-anchor trigger downstream.
    if (Array.isArray(o.anchors)) {
      const list = o.anchors.map(str).filter((a): a is string => !!a);
      if (list.length) leaf.anchors = list;
    }
    const req = num(o.openRequired); if (req != null) leaf.openRequired = req;
    const tot = num(o.totalNamed); if (tot != null) leaf.totalNamed = tot;
    if (leaf.anchors && leaf.totalNamed == null) leaf.totalNamed = leaf.anchors.length;
    if (o.scope != null) leaf.scope = str(o.scope);
    if (o.direction === "above" || o.direction === "below") leaf.direction = o.direction;
    const p = num(o.pct); if (p != null) leaf.pct = p;
    if (o.note != null) leaf.note = str(o.note);
    return leaf;
  }
  return null;
}

// Force the source/verification on a clause: an OM-extracted clause is ALWAYS
// source "OM" and NEVER verified against an executed document.
function stampMeta<T extends RiskMeta>(c: T): T {
  return {
    ...c,
    sourceDocument: "OM",
    verifiedAgainstExecutedDoc: false,
    provenance: c.provenance === "inferred" ? "inferred" : "extracted",
  };
}

function normCoTenancy(raw: unknown): CoTenancyClause | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const trigger = coerceTriggerNode(o.triggerLogic);
  const remedyRaw = (o.remedy && typeof o.remedy === "object") ? o.remedy as Record<string, unknown> : null;
  const clause: CoTenancyClause = stampMeta({
    type: o.type === "opening" ? "opening" : o.type === "operating" ? "operating" : null,
    triggerLogic: trigger,
    remedy: remedyRaw ? {
      mechanism: str(remedyRaw.mechanism),
      value: num(remedyRaw.value),
      cap: str(remedyRaw.cap),
      additionalRentTreatment: str(remedyRaw.additionalRentTreatment),
    } : null,
    reliefPeriodMonthsBeforeTermination: num(o.reliefPeriodMonthsBeforeTermination),
    terminationNoticeDays: num(o.terminationNoticeDays),
    cureCondition: str(o.cureCondition),
    suitableReplacementDefinition: str(o.suitableReplacementDefinition),
    currentlyInEffect: o.currentlyInEffect === true,
    currentStatusNote: str(o.currentStatusNote),
    sectionRef: str(o.sectionRef),
    verbatimQuote: str(o.verbatimQuote),
    provenance: o.provenance === "inferred" ? "inferred" : "extracted",
  });
  // A co-tenancy with no trigger and no quote is noise — drop it.
  if (!clause.triggerLogic && !clause.verbatimQuote) return null;
  return clause;
}

function normKickout(raw: unknown): SalesKickout | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const k: SalesKickout = stampMeta({
    salesThresholdAmount: num(o.salesThresholdAmount),
    salesThresholdPSF: num(o.salesThresholdPSF),
    measurementPeriod: str(o.measurementPeriod),
    noticeWindowDays: num(o.noticeWindowDays),
    terminationFee: num(o.terminationFee),
    unamortizedTiRepayment: num(o.unamortizedTiRepayment),
    sectionRef: str(o.sectionRef),
    verbatimQuote: str(o.verbatimQuote),
    provenance: o.provenance === "inferred" ? "inferred" : "extracted",
  });
  if (k.salesThresholdAmount == null && k.salesThresholdPSF == null && !k.verbatimQuote) return null;
  return k;
}

function normNote(raw: unknown): RiskClauseNote | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.present === false) return null;
  const note: RiskClauseNote = stampMeta({
    present: true,
    summary: str(o.summary),
    sectionRef: str(o.sectionRef),
    verbatimQuote: str(o.verbatimQuote),
    provenance: o.provenance === "inferred" ? "inferred" : "extracted",
  });
  if (!note.summary && !note.verbatimQuote) return null;
  return note;
}

function normOther(raw: unknown): OtherRiskClauses | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: OtherRiskClauses = {
    goDarkRight: normNote(o.goDarkRight),
    continuousOperationCovenant: normNote(o.continuousOperationCovenant),
    exclusiveUse: normNote(o.exclusiveUse),
    rofrRofo: normNote(o.rofrRofo),
    recaptureAssignment: normNote(o.recaptureAssignment),
    earlyTerminationOption: normNote(o.earlyTerminationOption),
  };
  return Object.values(out).some((v) => v != null) ? out : null;
}

/** Normalise raw model output (either the leaseRisk object or {leaseRisk:{...}}). */
export function normalizeLeaseRisk(raw: unknown): DealLeaseRisk {
  const root = (raw && typeof raw === "object" && "leaseRisk" in (raw as object))
    ? (raw as Record<string, unknown>).leaseRisk
    : raw;
  const o = (root && typeof root === "object") ? root as Record<string, unknown> : {};
  const tenantsRaw = Array.isArray(o.tenants) ? o.tenants : [];
  const tenants: TenantLeaseRisk[] = [];
  for (const t of tenantsRaw) {
    if (!t || typeof t !== "object") continue;
    const to = t as Record<string, unknown>;
    const name = str(to.tenant);
    if (!name) continue;
    const coTenancy = (Array.isArray(to.coTenancy) ? to.coTenancy : []).map(normCoTenancy).filter((c): c is CoTenancyClause => c != null);
    const salesKickout = (Array.isArray(to.salesKickout) ? to.salesKickout : []).map(normKickout).filter((c): c is SalesKickout => c != null);
    const otherRiskClauses = normOther(to.otherRiskClauses);
    if (!coTenancy.length && !salesKickout.length && !otherRiskClauses) continue; // no real clause → omit
    tenants.push({ tenant: name, suite: str(to.suite), baseRentAnnual: num(to.baseRentAnnual), coTenancy, salesKickout, otherRiskClauses });
  }
  const disclosed = o.coTenancyDisclosed === true || tenants.length > 0;
  return { source: "OM", coTenancyDisclosed: disclosed, tenants };
}

// ── roster backstop ──────────────────────────────────────────────────────────────
function anchorKey(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/['’.,]/g, "").replace(/\b(inc|llc|lp|corp|co|the|sporting goods|stores?)\b/g, "").replace(/\s+/g, " ").trim();
}
function collectAnchorNames(lr: DealLeaseRisk): Set<string> {
  const names = new Set<string>();
  const walk = (n: TriggerNode | null | undefined) => {
    if (!n) return;
    if ("operator" in n) { n.conditions.forEach(walk); return; }
    if (n.anchor && /anchor/i.test(n.type)) names.add(anchorKey(n.anchor));
  };
  for (const t of lr.tenants) for (const c of t.coTenancy ?? []) walk(c.triggerLogic);
  return names;
}

/**
 * Backstop the roster rule: drop any tenant row that leaked in ONLY because it was
 * named in a co-tenancy trigger — i.e. its name matches a referenced anchor AND it
 * carries no occupancy evidence (no SF, no rent, no suite). Real occupants and
 * flagged shadow/NAP anchors (which have a suite or NAP flag) are kept.
 */
export function enforceRosterCotenancyRule(
  tenants: Array<Record<string, unknown>>,
  lr: DealLeaseRisk,
): { tenants: Array<Record<string, unknown>>; dropped: string[] } {
  const anchors = collectAnchorNames(lr);
  if (!anchors.size) return { tenants, dropped: [] };
  const dropped: string[] = [];
  const kept = tenants.filter((t) => {
    const name = anchorKey(t.name ?? t.canonicalName);
    if (!name || !anchors.has(name)) return true;
    const hasEvidence = num(t.sf) != null || num(t.annualRent) != null || str(t.suite) != null || t.isNAP === true || t.isAnchor === true;
    if (hasEvidence) return true;
    dropped.push(String(t.name ?? ""));
    return false;
  });
  return { tenants: kept, dropped };
}

// ── dedicated extraction pass ─────────────────────────────────────────────────────
type CallExtract = (content: unknown, model?: string) => Promise<{ raw: string; stopReason: string }>;

/**
 * Run the focused lease-risk pass. `callExtract` and `parse` are injected so this is
 * unit-testable with a mocked model (no network, no DB). `cachedBlocks` are the same
 * cached OM blocks the main pass uses, so the document is a cache hit. Best-effort:
 * returns null on any failure (never breaks an upload).
 */
export async function runLeaseRiskPass(opts: {
  callExtract: CallExtract;
  cachedBlocks: unknown[];
  tenantNames: string[];
  parse: (raw: string) => unknown;
  model?: string;
}): Promise<DealLeaseRisk | null> {
  const { callExtract, cachedBlocks, tenantNames, parse, model } = opts;
  try {
    const roster = tenantNames.filter(Boolean).join(", ");
    const instruction = LEASE_RISK_PROMPT + (roster ? `\n\nThis property's rent-roll tenants (match names to these):\n${roster}` : "");
    const { raw } = await callExtract([...cachedBlocks, { type: "text", text: instruction }], model);
    const parsed = parse(raw);
    return normalizeLeaseRisk(parsed);
  } catch {
    return null;
  }
}

// ── lease-risk SUMMARY for the AI narrative (resolve OM + abstracts) ──────────────
// Pure + DB-free: the caller loads the deal's abstracts and passes them in. Produces
// a compact, factual exposure block the roster-analysis model NARRATES (it must not
// re-derive the numbers). Mirrors the client engine's resolve + tier logic.

function anchorMatch(a: unknown, b: unknown): boolean {
  const x = anchorKey(a), y = anchorKey(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}
function leaves(n: TriggerNode | null | undefined): TriggerCondition[] {
  if (!n) return [];
  if ("operator" in n) return (n.conditions || []).flatMap(leaves);
  return [n];
}
function evalTree(n: TriggerNode | null | undefined, t: (c: TriggerCondition) => boolean): boolean {
  if (!n) return false;
  if ("operator" in n) {
    if (!n.conditions?.length) return false;
    return n.operator === "AND" ? n.conditions.every((c) => evalTree(c, t)) : n.conditions.some((c) => evalTree(c, t));
  }
  return t(n);
}
const namesAnchor = (c: TriggerCondition, anchor: string) => !!c.anchor && /anchor/i.test(c.type || "") && anchorMatch(c.anchor, anchor);

function clauseTier(trigger: TriggerNode | null | undefined, anchor: string): 0 | 1 | 2 | 3 {
  if (!leaves(trigger).some((c) => namesAnchor(c, anchor))) return 0;
  if (evalTree(trigger, (c) => namesAnchor(c, anchor))) return 1;
  for (const L of leaves(trigger).filter((c) => !namesAnchor(c, anchor))) {
    if (evalTree(trigger, (c) => namesAnchor(c, anchor) || c === L)) return 2;
  }
  return 3;
}

interface ResolvedT { tenant: string; baseRent: number | null; coTenancy: CoTenancyClause[]; verified: boolean }

function resolveServer(lr: DealLeaseRisk, abstracts: Array<Record<string, unknown>>, dealData: Record<string, unknown>): ResolvedT[] {
  const rentByKey = new Map<string, number>();
  for (const t of (Array.isArray(dealData.tenants) ? dealData.tenants : []) as Array<Record<string, unknown>>) {
    const r = num(t.annualRent); const k = anchorKey(t.canonicalName ?? t.name);
    if (r != null && k) rentByKey.set(k, r);
  }
  const absByKey = new Map<string, CoTenancyClause[]>();
  for (const a of abstracts) {
    const name = str(a.tenantName); if (!name) continue;
    const co = (Array.isArray(a.coTenancy) ? a.coTenancy : []).map(normCoTenancy).filter((c): c is CoTenancyClause => c != null);
    if (co.length) absByKey.set(anchorKey(name), co);
  }
  return (lr.tenants || []).map((t) => {
    const key = anchorKey(t.tenant);
    const abs = absByKey.get(key);
    const coTenancy = abs && abs.length ? abs : (t.coTenancy || []);
    const baseRent = t.baseRentAnnual != null ? Number(t.baseRentAnnual) : (rentByKey.get(key) ?? null);
    return { tenant: t.tenant, baseRent, coTenancy, verified: !!(abs && abs.length) };
  });
}

function anchorsReferenced(resolved: ResolvedT[]): string[] {
  const seen = new Map<string, string>();
  for (const r of resolved) for (const c of r.coTenancy) for (const lf of leaves(c.triggerLogic)) {
    if (lf.anchor && /anchor/i.test(lf.type || "")) { const k = anchorKey(lf.anchor); if (k && !seen.has(k)) seen.set(k, lf.anchor); }
  }
  return [...seen.values()];
}

const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Build a compact, factual co-tenancy exposure block for the narrative model. "" when none. */
export function summarizeLeaseRisk(dealData: Record<string, unknown>, abstracts: Array<Record<string, unknown>> = []): string {
  const lr = dealData.leaseRisk as DealLeaseRisk | undefined;
  if (!lr || !Array.isArray(lr.tenants) || !lr.tenants.length) return "";
  const resolved = resolveServer(lr, abstracts, dealData);
  const omOnly = resolveServer(lr, [], dealData);
  const anchors = anchorsReferenced(resolved);
  if (!anchors.length) return "";

  const expFor = (rs: ResolvedT[], anchor: string) => {
    let t1 = 0, t2 = 0, t3 = 0; const t1n: string[] = [], t2n: string[] = [];
    for (const r of rs) for (const c of r.coTenancy) {
      const tier = clauseTier(c.triggerLogic, anchor); if (!tier) continue;
      const rent = r.baseRent ?? 0; t3 += rent;
      if (tier === 1) { t1 += rent; t1n.push(r.tenant); } else if (tier === 2) { t2 += rent; t2n.push(r.tenant); }
    }
    return { t1, t2, t3, t1n, t2n };
  };

  const ranked = anchors.map((a) => ({ a, e: expFor(resolved, a) })).sort((x, y) => y.e.t1 - x.e.t1 || y.e.t3 - x.e.t3).slice(0, 4);
  const lines: string[] = ["LEASE-RISK EXPOSURE (computed by the app from the lease documents — NARRATE these figures, do not re-derive):"];
  for (const { a, e } of ranked) {
    if (e.t3 <= 0) continue;
    let s = `• If ${a} goes dark/relocates: Tier-1 ${fmt$(e.t1)} trips on ${a} alone${e.t1n.length ? ` (${e.t1n.join(", ")})` : ""}; Tier-2 ${fmt$(e.t2)} needs a second event${e.t2n.length ? ` (${e.t2n.join(", ")})` : ""}; Tier-3 ${fmt$(e.t3)} any linkage.`;
    const om = expFor(omOnly, a);
    if (om.t1 !== e.t1) s += ` (Executed leases reduced Tier-1 from ${fmt$(om.t1)}.)`;
    lines.push(s);
  }
  const live = resolved
    .filter((r) => r.coTenancy.some((c) => c.currentlyInEffect))
    .map((r) => {
      const note = r.coTenancy.find((c) => c.currentlyInEffect)?.currentStatusNote;
      return note ? `${r.tenant} (${note})` : r.tenant;
    });
  if (live.length) lines.push(`CURRENTLY IN EFFECT (tenant already paying reduced co-tenancy rent today — a present hit to in-place rent, not hypothetical): ${live.join("; ")}.`);
  const unverified = resolved.filter((r) => r.coTenancy.length && !r.verified).map((r) => r.tenant);
  const verified = resolved.filter((r) => r.verified).map((r) => r.tenant);
  if (verified.length) lines.push(`Verified against executed leases: ${verified.join(", ")}.`);
  if (unverified.length) lines.push(`Still OM-only (unverified — pull leases): ${unverified.slice(0, 12).join(", ")}${unverified.length > 12 ? "…" : ""}.`);
  return lines.length > 1 ? lines.join("\n") : "";
}

// ── post-extraction validators (seed Import-Review questions) ─────────────────────
export interface ReviewQuestionLike {
  id: string;
  source: "check";
  severity: "high" | "medium" | "low";
  field: string;
  question: string;
  detail: string | null;
  suggestedValue: string | null;
  target: null;
}

function parseRentSteps(s: unknown): { date: string | null; psf: number | null; annual: number | null }[] {
  if (!s || typeof s !== "string") return [];
  const out: { date: string | null; psf: number | null; annual: number | null }[] = [];
  for (const chunk of s.split(/;|\n/)) {
    const dm = chunk.match(/\d{4}-\d{2}-\d{2}/);
    const pm = chunk.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:psf|\/\s*sf|per\s*sf)/i);
    const am = chunk.match(/\$\s*([\d,]+(?:\.\d+)?)\s*\/?\s*(?:yr|year|annually|\/yr)/i);
    const psf = pm ? Number(pm[1].replace(/,/g, "")) : null;
    const annual = am ? Number(am[1].replace(/,/g, "")) : null;
    if (dm || psf != null || annual != null) out.push({ date: dm ? dm[0] : null, psf, annual });
  }
  return out;
}

/**
 * Validators that run at extraction time (need only the extracted deal): flag
 * unverified OM co-tenancy/kickout (every OM clause is a summary, not the lease)
 * and any "scheduled increase" rent step that actually decreases. Returns review
 * questions to fold into the deal's reviewQuestions (Import Review).
 */
export function validateLeaseRiskAtExtraction(extracted: Record<string, unknown>): ReviewQuestionLike[] {
  const out: ReviewQuestionLike[] = [];
  const lr = extracted.leaseRisk as DealLeaseRisk | undefined;

  // 0) currently-in-effect co-tenancy — a present fact (tenant already at reduced
  // rent), so it gets its own HIGH review item ahead of the generic unverified one.
  if (lr?.tenants?.length) {
    const live = lr.tenants
      .filter((t) => (t.coTenancy || []).some((c) => c.currentlyInEffect))
      .map((t) => {
        const note = (t.coTenancy || []).find((c) => c.currentlyInEffect)?.currentStatusNote;
        return note ? `${t.tenant} (${note})` : t.tenant;
      });
    if (live.length) {
      out.push({
        id: "check-cotenancy-live", source: "check", severity: "high",
        field: "Co-tenancy currently in effect",
        question: `${live.length} tenant${live.length > 1 ? "s are" : " is"} CURRENTLY paying reduced co-tenancy rent — confirm the in-place rent reflects the reduced amount and whether/when it cures.`,
        detail: `Already-triggered co-tenancy (not hypothetical): ${live.join("; ")}.`,
        suggestedValue: null, target: null,
      });
    }
  }

  // 1) unverified_cotenancy — aggregate, so Import Review gets one clear to-do.
  if (lr?.tenants?.length) {
    const names = lr.tenants
      .filter((t) => (t.coTenancy?.length || t.salesKickout?.length))
      .map((t) => t.tenant);
    if (names.length) {
      out.push({
        id: "check-lease-risk-unverified", source: "check", severity: "medium",
        field: "Co-tenancy / kickout (unverified)",
        question: `${names.length} tenant${names.length > 1 ? "s have" : " has"} OM-disclosed co-tenancy/kickout clauses — pull the executed leases to verify.`,
        detail: `These are OM summaries, not executed leases: ${names.join(", ")}. The anchor-dependency exposure is computed from them but flagged unverified until the leases are reconciled.`,
        suggestedValue: null, target: null,
      });
    }
  }

  // 2) scheduled_increase_to_lower_amount — per tenant rent-schedule string.
  const tenants = Array.isArray(extracted.tenants) ? extracted.tenants as Array<Record<string, unknown>> : [];
  for (const t of tenants) {
    const steps = parseRentSteps(t.rentSchedule).filter((s) => s.psf != null || s.annual != null)
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    for (let i = 1; i < steps.length; i++) {
      const a = steps[i - 1].psf ?? steps[i - 1].annual!;
      const b = steps[i].psf ?? steps[i].annual!;
      if (a != null && b != null && b < a * 0.995) {
        const nm = String(t.canonicalName || t.name || "tenant");
        out.push({
          id: `check-rent-decrease-${nm}`.slice(0, 80), source: "check", severity: "high",
          field: `${nm} — rent step`,
          question: `${nm}: a rent step labeled an increase goes DOWN ($${a} → $${b}). Verify against the lease.`,
          detail: "A scheduled increase below the current rent is almost always a transcription error (e.g. $36 read as $26).",
          suggestedValue: null, target: null,
        });
        break;
      }
    }
  }
  return out;
}
