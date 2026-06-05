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
          "triggerLogic": <AND/OR tree>,   // branch = {"operator":"AND|OR","conditions":[...]}; leaf = {"type":"named_anchor_dark","anchor":"Target"} or {"type":"occupancy_threshold","scope":"Center GLA","direction":"below","pct":80}. Encode EXACTLY what the clause says and preserve which anchors are named. A "fewer than N of {A,B,C} open" requirement = an OR of every AND-pair of those anchors going dark.
          "remedy": {"mechanism":"alternate_rent_pct_sales|percent_rent_reduction|fixed_reduction","value":<number>,"cap":"string or null","additionalRentTreatment":"tenant_continues|swept|unknown"},
          "reliefPeriodMonthsBeforeTermination": <number or null>,
          "terminationNoticeDays": <number or null>,
          "cureCondition": "string or null",
          "suitableReplacementDefinition": "string or null",
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
