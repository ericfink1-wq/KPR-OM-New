import { apiAiMessages } from "./api";
import { robustParseJSON } from "./utils";
import type { Deal } from "./idb";

export interface RentRollResult {
  asOf: string | null;
  tenants: NonNullable<Deal["tenants"]>;
}

// Extract a tenant roster from rent-roll text (PDF or spreadsheet-derived).
// Shared by the deal page's "Refresh tenants" button and the smart uploader.
export async function extractRentRoll(text: string): Promise<RentRollResult> {
  const prompt = `You are a CRE data extraction engine. Extract every occupied tenant from this rent roll.
Return ONLY JSON: {"asOf":"YYYY-MM-DD or null","tenants":[{...}]}

Each tenant object (omit unknown fields):
{"name","sf","rentPerSF","annualRent","leaseStart","leaseExpiry","leaseType","reimbursementMethod","rentBumps","rentSchedule","renewalOptions","percentageRentClause","expenseReimbursements","percentageRent","otherRent","creditRating","salesPSF","isAnchor","isDark","remainingTermYears"}

Rules:
- Brand name only (no store #).
- Dates ISO YYYY-MM-DD.
- Skip vacant/available units unless they have a tenant name.
- rentSchedule: future steps only as of the asOf date.
- SF and rents as plain numbers (no $ or commas).
- If a value isn't shown, omit it.
- remainingTermYears: compute from asOf to leaseExpiry if possible.`;

  const res = await apiAiMessages({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt + "\n\nRENT ROLL TEXT:\n" + text }],
  });
  const raw = res.content?.[0]?.text ?? "";
  let parsed: { asOf?: string | null; tenants?: unknown[] };
  try { parsed = robustParseJSON(raw) as typeof parsed; }
  catch { throw new Error("Couldn't parse the rent roll. Try a clearer file."); }
  const tenants = (Array.isArray(parsed.tenants) ? parsed.tenants : []) as NonNullable<Deal["tenants"]>;
  if (tenants.length === 0) throw new Error("No tenants found in the rent roll.");
  return { asOf: parsed.asOf || new Date().toISOString().slice(0, 10), tenants };
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
  return {
    tenants: result.tenants,
    tenantsAsOf: result.asOf,
    tenantsSource: "rent-roll",
    tenantsManual: true,
    analysisStale: true,
    ...recomputed,
  };
}
