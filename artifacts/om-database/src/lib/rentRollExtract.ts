import { apiAiMessages } from "./api";
import { robustParseJSON, toStepString } from "./utils";
import type { Deal, ReviewQuestion } from "./idb";

export interface RentRollResult {
  asOf: string | null;
  tenants: NonNullable<Deal["tenants"]>;
  reviewQuestions?: ReviewQuestion[];
}

// Extract a tenant roster from rent-roll text (PDF or spreadsheet-derived).
// Shared by the deal page's "Refresh tenants" button and the smart uploader.
export async function extractRentRoll(text: string): Promise<RentRollResult> {
  const prompt = `You are a CRE data extraction engine. Extract every occupied tenant from this rent roll.
Return ONLY JSON: {"asOf":"YYYY-MM-DD or null","tenants":[{...}],"reviewQuestions":[{...}]}

Each tenant object (omit unknown fields):
{"name","sf","rentPerSF","annualRent","leaseStart","leaseExpiry","leaseType","reimbursementMethod","rentBumps","rentSchedule","renewalOptions","percentageRentClause","expenseReimbursements","percentageRent","otherRent","creditRating","salesPSF","isAnchor","isDark","remainingTermYears"}

Rules:
- Brand name only (no store #).
- Dates ISO YYYY-MM-DD.
- Skip vacant/available units unless they have a tenant name.
- rentSchedule: future steps only as of the asOf date.
- SF and rents as plain numbers (no $ or commas).
- If a value isn't shown, omit it.
- remainingTermYears: compute from asOf to leaseExpiry if possible.

reviewQuestions: a SHORT list (max ~4) of values you could NOT capture with confidence from THIS rent roll — e.g. an unlabeled/ambiguous SF or rent column, a number that was blurry or split oddly, two rows that might be the same tenant, or an "as of" date you had to guess. Each: {"severity":"high|medium|low","field":"human label e.g. 'Five Below — SF'","question":"short confirm question","detail":"1 sentence on the ambiguity","suggestedValue":"what you captured, as a string","target":{"kind":"tenant","fieldKey":"exact tenant field key (sf, rentPerSF, annualRent, leaseStart, leaseExpiry, remainingTermYears, salesPSF)","tenantName":"exact tenant name from the tenants array","valueType":"number|text"}}. ALWAYS set target when the question is about one tenant's field so the user can fix it in one click; set target null only for non-field questions (e.g. possible duplicate rows). Only flag genuine uncertainty — NOT values simply absent from the roll. Empty array if the roll was clean.`;

  const res = await apiAiMessages({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt + "\n\nRENT ROLL TEXT:\n" + text }],
  });
  const raw = res.content?.[0]?.text ?? "";
  let parsed: { asOf?: string | null; tenants?: unknown[]; reviewQuestions?: unknown[] };
  try { parsed = robustParseJSON(raw) as typeof parsed; }
  catch { throw new Error("Couldn't parse the rent roll. Try a clearer file."); }
  const tenants = (Array.isArray(parsed.tenants) ? parsed.tenants : []) as NonNullable<Deal["tenants"]>;
  if (tenants.length === 0) throw new Error("No tenants found in the rent roll.");
  const reviewQuestions = (Array.isArray(parsed.reviewQuestions) ? parsed.reviewQuestions : [])
    .map((q, i) => {
      const r = q as Record<string, unknown>;
      const tgt = r.target as Record<string, unknown> | undefined;
      const target = tgt && tgt.kind === "tenant" && typeof tgt.fieldKey === "string"
        ? {
            kind: "tenant" as const,
            fieldKey: tgt.fieldKey,
            tenantName: typeof tgt.tenantName === "string" ? tgt.tenantName : null,
            valueType: (tgt.valueType === "text" ? "text" : "number") as "number" | "text",
          }
        : null;
      return {
        id: `ai-rr-${i}-${String(r.field ?? "").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
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
  return { asOf: parsed.asOf || new Date().toISOString().slice(0, 10), tenants, reviewQuestions };
}

// Recompute occupancy + WALT from a fresh roster, respecting verified locks.
// Returns the full patch to apply to a deal (tenants + recomputed metrics).
export function buildRosterPatch(deal: Deal, result: RentRollResult): Partial<Deal> {
  const nv = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const recomputed: Partial<Deal> = {};
  if (!deal.verified?.occupancy && deal.totalSF) {
    const occupiedSF = result.tenants.reduce((s, t) => s + (nv((t as Record<string, unknown>).sf) ?? 0), 0);
    const occ = Math.round(occupiedSF / Number(deal.totalSF) * 1000) / 10;
    if (occ > 0 && occ <= 100) recomputed.occupancy = occ;
  }
  if (!deal.verified?.walt) {
    const sfT = result.tenants.reduce((s, t) => s + (nv((t as Record<string, unknown>).sf) ?? 0), 0);
    const wT = result.tenants.reduce((s, t) => {
      const sf = nv((t as Record<string, unknown>).sf), yr = nv((t as Record<string, unknown>).remainingTermYears);
      return s + (sf ?? 0) * (yr ?? 0);
    }, 0);
    if (sfT > 0) recomputed.walt = Math.round(wT / sfT * 10) / 10;
  }
  // Merge fresh rent-roll questions with any existing ones on the deal: drop the
  // prior rent-roll AI flags (ids prefixed "ai-rr-") and append the new batch,
  // keeping OM-extraction and resolved questions intact.
  const fresh = result.reviewQuestions ?? [];
  const prior = (deal.reviewQuestions ?? []).filter(q => !(q.source === "ai" && q.id.startsWith("ai-rr-")));
  const reviewQuestions = [...prior, ...fresh];

  // Normalize step fields to strings — the AI sometimes returns rentSchedule /
  // rentBumps / renewalOptions as arrays, which break string-only consumers.
  const tenants = result.tenants.map(t => {
    const x = { ...(t as Record<string, unknown>) };
    if (x.rentSchedule != null) x.rentSchedule = toStepString(x.rentSchedule);
    if (x.rentBumps != null) x.rentBumps = toStepString(x.rentBumps);
    if (x.renewalOptions != null) x.renewalOptions = toStepString(x.renewalOptions);
    return x;
  }) as NonNullable<Deal["tenants"]>;

  return {
    tenants,
    tenantsAsOf: result.asOf,
    tenantsSource: "rent-roll",
    tenantsManual: true,
    analysisStale: true,
    reviewQuestions,
    ...recomputed,
  };
}
