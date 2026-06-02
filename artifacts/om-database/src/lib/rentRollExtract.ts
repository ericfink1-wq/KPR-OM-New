import { apiAiMessages, lessonGuidanceClient } from "./api";
import { robustParseJSON, toStepString, tenantKey, stripSuiteCode } from "./utils";
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

CRITICAL LESSONS (past extractions failed on these — do NOT repeat):
- CAPTURE EVERY occupied line, never drop tenants. Anchors / junior anchors (the largest-SF tenants — grocers, Burlington, Marshalls, banks) are the MOST important to never omit. Before finishing, confirm the sum of your tenant SF reconciles with the rent roll's stated occupied SF; if it doesn't, you missed tenants — add them (largest first).
- leaseExpiry = CURRENT contractual expiration, NOT an option-extended date. If the roll shows a pro-forma "End" that assumes options are exercised, use the current expiry and put option dates in renewalOptions.
- rentPerSF / annualRent = CURRENT in-place rent, NOT a future renewal-option rate.
- MONTHLY vs ANNUAL: rent rolls usually show base rent as a MONTHLY amount. annualRent must be ANNUAL — multiply a monthly figure by 12. Sanity-check: rentPerSF should ≈ annualRent ÷ SF (a normal inline rent is roughly $10–$120/SF, never thousands).
- FUTURE RENT INCREASES: capture any "future rent increases" / scheduled step columns into rentSchedule (dated steps); note "flat" if none.
- EXCLUDE non-inline / outparcel rows: shadow anchors and ground-lease pads that are NOT part of this property — typically 0 SF with a placeholder far-future expiration (e.g. 2098/2099), such as Costco, Target, a theater, or a separately-owned bank/restaurant pad. Do NOT list these as tenants. (A real lease that happens to show 0 SF but has a NORMAL near-term expiration and ordinary rent — e.g. a gas station — IS a real tenant; keep it.)
- DEDUPE SECTIONS: a rent roll may have separate sections like "New Leases" / "Occupied" / "Vacant". If the same tenant or suite appears in BOTH a future/"New Leases" section AND an in-place "Occupied" section, output ONE row using the OCCUPIED (current) lease; treat the future-commencing row as a renewal and fold its dates/rate into renewalOptions or rentSchedule. Never emit two rows for the same tenant/suite. Skip "Vacant" rows (no tenant name).

reviewQuestions: a SHORT list (max ~4) of values you could NOT capture with confidence from THIS rent roll — e.g. an unlabeled/ambiguous SF or rent column, a number that was blurry or split oddly, two rows that might be the same tenant, or an "as of" date you had to guess. Each: {"severity":"high|medium|low","field":"human label e.g. 'Five Below — SF'","question":"short confirm question","detail":"1 sentence on the ambiguity","suggestedValue":"what you captured, as a string","target":{"kind":"tenant","fieldKey":"exact tenant field key (sf, rentPerSF, annualRent, leaseStart, leaseExpiry, remainingTermYears, salesPSF)","tenantName":"exact tenant name from the tenants array","valueType":"number|text"}}. ALWAYS set target when the question is about one tenant's field so the user can fix it in one click; set target null only for non-field questions (e.g. possible duplicate rows). Only flag genuine uncertainty — NOT values simply absent from the roll. Empty array if the roll was clean.`;

  const taught = await lessonGuidanceClient("rent-roll");
  const res = await apiAiMessages({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt + taught + "\n\nRENT ROLL TEXT:\n" + text }],
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
  // Merge fresh rent-roll questions with any existing ones on the deal: drop the
  // prior rent-roll AI flags (ids prefixed "ai-rr-") and append the new batch,
  // keeping OM-extraction and resolved questions intact.
  const fresh = result.reviewQuestions ?? [];
  const prior = (deal.reviewQuestions ?? []).filter(q => !(q.source === "ai" && q.id.startsWith("ai-rr-")));
  const reviewQuestions = [...prior, ...fresh];

  // Index the existing roster by normalized tenant name so we can gap-fill.
  const priorByKey = new Map<string, Record<string, unknown>>();
  for (const pt of deal.tenants ?? []) {
    const k = tenantKey(stripSuiteCode((pt as Record<string, unknown>).name));
    if (k && !priorByKey.has(k)) priorByKey.set(k, pt as Record<string, unknown>);
  }
  // Fields that an options-focused or partial rent roll often omits. When the new
  // row leaves one blank but the existing OM roster had it, carry the old value
  // forward — so a "Lease Options" upload never wipes SF / rent / start dates.
  const CARRY_OVER = [
    "sf", "annualRent", "rentPerSF", "leaseStart", "leaseExpiry", "remainingTermYears",
    "leaseType", "reimbursementMethod", "rentBumps", "rentSchedule", "salesPSF",
    "salesYear", "expenseReimbursements", "percentageRent", "otherRent", "creditRating",
    "isAnchor", "isNAP", "isDark", "parentCompany",
  ];
  const blank = (v: unknown) => v == null || v === "";

  // Build the new rows (gap-filled from the prior roster), then UNION them with
  // any existing tenants the new file doesn't mention. A partial or secondary
  // file must never DELETE tenants — it can only add to and fill in the roster.
  const newKeys = new Set<string>();
  const newRows = result.tenants.map(t => {
    const x = { ...(t as Record<string, unknown>) };
    const k = tenantKey(stripSuiteCode(x.name));
    if (k) newKeys.add(k);
    const prior = priorByKey.get(k);
    if (prior) for (const f of CARRY_OVER) { if (blank(x[f]) && !blank(prior[f])) x[f] = prior[f]; }
    if (x.rentSchedule != null) x.rentSchedule = toStepString(x.rentSchedule);
    if (x.rentBumps != null) x.rentBumps = toStepString(x.rentBumps);
    if (x.renewalOptions != null) x.renewalOptions = toStepString(x.renewalOptions);
    return x;
  });
  const keptExisting = (deal.tenants ?? []).filter(pt => {
    const k = tenantKey(stripSuiteCode((pt as Record<string, unknown>).name));
    return !k || !newKeys.has(k);
  });
  const tenants = [...newRows, ...keptExisting] as NonNullable<Deal["tenants"]>;

  // Recompute occupancy / WALT from the FULL merged roster (not just the new
  // rows), so a partial file doesn't understate occupancy.
  if (!deal.verified?.occupancy && deal.totalSF) {
    const occupiedSF = tenants.reduce((s, t) => s + (nv((t as Record<string, unknown>).sf) ?? 0), 0);
    const occ = Math.round(occupiedSF / Number(deal.totalSF) * 1000) / 10;
    if (occ > 0 && occ <= 100) recomputed.occupancy = occ;
  }
  if (!deal.verified?.walt) {
    const sfT = tenants.reduce((s, t) => s + (nv((t as Record<string, unknown>).sf) ?? 0), 0);
    const wT = tenants.reduce((s, t) => {
      const sf = nv((t as Record<string, unknown>).sf), yr = nv((t as Record<string, unknown>).remainingTermYears);
      return s + (sf ?? 0) * (yr ?? 0);
    }, 0);
    if (sfT > 0) recomputed.walt = Math.round(wT / sfT * 10) / 10;
  }

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

// ENRICH-ONLY patch for a lease-OPTIONS schedule. An options file lists renewal
// ladders but lacks current SF/rent, so it must never add or remove tenants —
// it only fills in renewalOptions (and option-period rent steps / lease type)
// on tenants ALREADY in the roster. Matches by normalized name. Tenants in the
// roster that aren't in the file are untouched; rows in the file with no roster
// match are ignored (we won't invent a tenant from an options sheet).
export function buildOptionsPatch(deal: Deal, result: RentRollResult): { patch: Partial<Deal>; updated: number } {
  const blank = (v: unknown) => v == null || v === "";
  const byKey = new Map<string, Record<string, unknown>>();
  for (const ot of result.tenants) {
    const k = tenantKey(stripSuiteCode((ot as Record<string, unknown>).name));
    if (k && !byKey.has(k)) byKey.set(k, ot as Record<string, unknown>);
  }
  let updated = 0;
  const tenants = (deal.tenants ?? []).map(t => {
    const x = { ...(t as Record<string, unknown>) };
    const opt = byKey.get(tenantKey(stripSuiteCode(x.name)));
    if (!opt) return x as NonNullable<Deal["tenants"]>[number];
    let touched = false;
    // renewalOptions: the file's whole point — always take it when present.
    const ro = toStepString(opt.renewalOptions);
    if (ro && ro !== toStepString(x.renewalOptions)) { x.renewalOptions = ro; touched = true; }
    // Fill (never overwrite) these supporting fields only when the roster lacks them.
    for (const f of ["rentSchedule", "rentBumps", "leaseType"] as const) {
      if (blank(x[f]) && !blank(opt[f])) { x[f] = toStepString(opt[f]); touched = true; }
    }
    if (touched) updated++;
    return x as NonNullable<Deal["tenants"]>[number];
  }) as NonNullable<Deal["tenants"]>;

  if (updated === 0) return { patch: {}, updated: 0 };
  return { patch: { tenants, analysisStale: true }, updated };
}
