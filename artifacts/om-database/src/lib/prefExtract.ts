import type { Deal } from "./idb";
import { apiAiMessages, lessonGuidanceClient } from "./api";
import { robustParseJSON } from "./utils";

// Fields the preferred-equity section holds.
const PREF_NUMERIC = new Set(["prefAmount", "prefRateCurrent", "prefRateAllIn", "prefTermYears"]);

export interface PrefResult {
  fields: Record<string, unknown>;
}

// Extract preferred-equity terms from a JV agreement / pref-equity term sheet /
// pref schedule. Uses Sonnet — these are dense legal/financial documents.
export async function extractPref(text: string): Promise<PrefResult> {
  const prompt = `You extract PREFERRED EQUITY investment terms from a JV agreement, preferred-equity term sheet, or pref-equity schedule. Preferred equity is investor capital that earns a preferred return and is often documented or treated as a loan. Output ONLY one JSON object (no markdown):
{"prefLender":string|null,"prefAmount":number|null,"prefRateCurrent":number|null,"prefRateAllIn":number|null,"prefReturnType":"Current Pay"|"Accruing"|"Hybrid"|null,"prefOriginationDate":string|null,"prefMaturityDate":string|null,"prefTermYears":number|null,"prefRecourse":"Non-Recourse"|"Recourse"|"Partial"|null,"prefNotes":string|null}

Rules:
- prefLender: the preferred-equity INVESTOR / provider — the party that funds the pref and receives the preferred return (e.g. the "Preferred Member" / "Pref" / the institutional partner). NOT the common/sponsor member.
- prefAmount: the preferred equity contribution / initial funded amount (plain number).
- prefRateAllIn: the FULL preferred return rate % — the all-in/total rate including any deferred or accruing portion (e.g. 9.25).
- prefRateCurrent: the CURRENT-PAY rate % — the portion paid currently in cash; the remainder accrues/defers (e.g. an 8% current pay with 1.25% deferred). If only one rate is stated, use it for both.
- prefReturnType: "Current Pay" if entirely cash-pay, "Accruing" if entirely deferred/compounding, "Hybrid" if part current-pay and part deferred/accruing.
- prefOriginationDate: the funding / closing date (YYYY-MM-DD). prefMaturityDate: the redemption / maturity date (YYYY-MM-DD).
- prefTermYears: term in years (number). prefRecourse: "Non-Recourse"/"Recourse"/"Partial" if stated, else null.
- prefNotes: a concise summary of the remaining key terms NOT captured above — origination & exit fees, make-whole / lockout period, deferred/PIK accrual and any step rates (e.g. a different rate during a redevelopment period), payment frequency & dates, compounding, future-advance/unused fees, senior-loan context, and tax treatment.
Numbers plain (no $, %, or commas). null when not clearly stated.

${await lessonGuidanceClient("loan")}
DOCUMENT TEXT:
${text.slice(0, 60000)}

Return ONLY the JSON object.`;

  const res = await apiAiMessages({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = res.content?.find(c => c.type === "text")?.text ?? "";
  let out: Record<string, unknown>;
  try { out = robustParseJSON(raw) as Record<string, unknown>; }
  catch { throw new Error("Couldn't read the preferred-equity terms from that file. Try a clearer term sheet."); }

  const keys = ["prefLender", "prefAmount", "prefRateCurrent", "prefRateAllIn", "prefReturnType", "prefOriginationDate", "prefMaturityDate", "prefTermYears", "prefRecourse", "prefNotes"];
  const fields: Record<string, unknown> = {};
  for (const k of keys) {
    const v = out[k];
    if (v == null || v === "") continue;
    fields[k] = PREF_NUMERIC.has(k) && !isNaN(Number(v)) ? Number(v) : v;
  }
  if (Object.keys(fields).length === 0) throw new Error("No preferred-equity terms found — this may not be a pref-equity document.");
  return { fields };
}

// ENRICH-ONLY: fill BLANK pref-equity fields from the document (never overwrite a
// value already entered).
export function buildPrefPatch(deal: Deal, result: PrefResult): Partial<Deal> {
  const patch: Record<string, unknown> = {};
  const ex = deal as unknown as Record<string, unknown>;
  const blank = (v: unknown) => v == null || v === "";
  for (const [k, v] of Object.entries(result.fields)) {
    if (!blank(v) && blank(ex[k])) patch[k] = v;
  }
  return patch as Partial<Deal>;
}
