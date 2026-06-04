import type { Deal, TenantSalesYear, OccBreakdown, ReviewQuestion } from "./idb";
import { apiAiMessages, lessonGuidanceClient } from "./api";
import { robustParseJSON, tenantKey, stripSuiteCode, estimateRecoveries, parseAiReviewQuestions } from "./utils";

export interface SalesExtractResult {
  year: number;
  tenants: Array<Record<string, unknown>>;
  reviewQuestions?: ReviewQuestion[];
}

// Extract tenant sales rows from a sales-report document (Haiku). Shared by the
// deal page's "Update Sales" upload and the smart-ingest upload queue, so both
// parse identically.
export async function extractSalesReport(text: string): Promise<SalesExtractResult> {
  const prompt = `You are a CRE data extraction engine. Extract tenant sales data from this retail sales report.
Return ONLY valid JSON — no markdown fences, no explanation — with this exact shape:
{
  "year": <integer — the sales year your figures below represent, e.g. 2024>,
  "tenants": [
    {
      "name": "string",
      "salesPSF": number_or_null,
      "annualSales": number_or_null,
      "sf": number_or_null,
      "occupancyCost": number_or_null
    }
  ],
  "reviewQuestions": [
    {
      "severity": "high|medium|low",
      "field": "human label, e.g. 'Sales year' or 'Starbucks — sales PSF'",
      "question": "a short plain-English question asking the user to confirm a value you were NOT confident about",
      "detail": "1 sentence on why it was ambiguous",
      "suggestedValue": "the value you captured, as a string",
      "target": {"kind": "tenant", "fieldKey": "salesPSF|annualSales|sf|occupancyCost", "tenantName": "exact tenant name from your tenants array above", "valueType": "number"}
    }
  ]
}

RULES:
- salesPSF: sales per square foot (dollars). Often labeled "Sales/SF", "$/SF", "PSF", or "Per Square Foot".
- annualSales: TOTAL annual sales volume in dollars (not PSF) for a FULL 12-month year. If shown in thousands, convert to full dollars.
- sf: tenant GLA / leased SF used for sales calculations.
- occupancyCost: TOTAL occupancy cost percentage = (base rent + expense reimbursements/CAM+taxes+insurance + percentage rent + other rent) ÷ gross sales. Often labeled "Occ Cost %", "OC%", "Occupancy Cost", or an "Occupancy Cost Ratio". Capture the report's stated total — but as a PERCENTAGE NUMBER: a ratio shown as a decimal (e.g. 0.0796) means 7.96, so multiply by 100. Do NOT report a base-rent-only ratio.
- Skip total/subtotal rows and blank rows. Skip tenants whose sales are all zero / not reported.
- Include all tenants that have any real sales data, even if some fields are null.

R12 / TRAILING-12 FORMAT (common in property-management exports). If the report has columns named "R12 Total", "R12 Sales PSF", and an "R12 ... Occupancy Cost Ratio" (usually a spreadsheet with one column per month followed by these R12 summary columns), then for EACH occupant row use:
- annualSales = the "R12 Total" column (this IS the last-twelve-months sales — use it directly even if some monthly cells are 0; do NOT re-sum the months yourself).
- salesPSF = the "R12 Sales PSF" column.
- occupancyCost = the "R12 ... Occupancy Cost Ratio" column as a percentage (decimal × 100).
- sf = the "Sq. Ft." / "Square Feet" column. name = the "Occupant Name" column.
- year = the calendar year the trailing-12 period ends in (the latest month column, or the report's as-of year). In this format you do NOT need the complete-vs-partial-year logic below — "R12 Total" is already the figure to use.

CHOOSING THE YEAR — READ CAREFULLY (for multi-year column reports, NOT the R12 format above). Many reports (e.g. "Gross Sales History", "MAX_GSALES") show MULTIPLE year columns per tenant (e.g. 12/25, 12/24, 12/23 …). The MOST RECENT column is frequently a PARTIAL / year-to-date year that is NOT yet complete — its total is far smaller than the prior year, or its later months are zero/blank, or the report is dated early in the following year. DO NOT use a partial year: it understates sales drastically (e.g. a grocer showing $5M for a part-year vs $51M full-year).
- Use the MOST RECENT *COMPLETE* full-year column for every tenant, and set the top-level "year" to that complete year. If the latest column is clearly partial (much lower than the prior year, trailing zero months, or report dated in Jan–Mar of the next year), step back to the last complete year.
- A tenant's annualSales and salesPSF MUST come from the SAME chosen year and be internally consistent (annualSales ÷ sf ≈ salesPSF).

SQUARE FOOTAGE — IMPORTANT. If the report's "Square Feet (GLA)" prints as 0 or blank but it DOES state a "Per Square Foot" sales figure, DERIVE sf = round(annualSales ÷ salesPSF). Never report sf as 0 when sales and PSF are both present.

reviewQuestions — FLAG DOUBT so the user can confirm/fix it. Add an item ONLY when you genuinely could not capture a value with confidence, e.g.: the year you chose was ambiguous (the latest column might be partial and you had to step back a year); a sales/PSF figure was blurry, split oddly, or in unclear units (thousands vs whole dollars); a tenant's salesPSF and annual sales don't tie (annualSales ÷ sf should ≈ salesPSF); or a column was unlabeled and you weren't sure it was sales vs PSF vs occupancy cost. ALWAYS set target to the exact tenant + field when the doubt is about one tenant's number. Do NOT flag values simply absent from the report (those are just null). Empty array if the report was clean. Cap at the ~4 most important.

${await lessonGuidanceClient("sales")}
SALES REPORT TEXT:
${text.slice(0, 40000)}`;

  const res = await apiAiMessages({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = res.content.find((c: { type: string }) => c.type === "text")?.text ?? "";
  let parsed: { year?: number; tenants?: unknown[] };
  try { parsed = robustParseJSON(raw) as typeof parsed; } catch { throw new Error("Couldn't parse the AI response — try again."); }

  const year = typeof parsed.year === "number" ? parsed.year : new Date().getFullYear() - 1;
  const tenants = Array.isArray(parsed.tenants) ? parsed.tenants as Array<Record<string, unknown>> : [];
  if (tenants.length === 0) throw new Error("No tenant sales data found in the report.");
  const reviewQuestions = parseAiReviewQuestions((parsed as { reviewQuestions?: unknown }).reviewQuestions, "ai-sales-");
  return { year, tenants, reviewQuestions };
}

// Build the tenantSalesHistory patch for a deal from an extracted sales report:
// cross-derives PSF<->gross, matches each row to the roster (suite-aware) to
// recompute occupancy cost from the full rent stack, stores the clean brand
// name, and replaces any prior snapshot for the same year. Mirrors the deal
// page's sales-import math exactly.
export function buildSalesHistoryPatch(deal: Deal, result: SalesExtractResult): Partial<Deal> {
  const { year } = result;
  const nv = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const roster = new Map((deal.tenants || []).map(t => [tenantKey(t.canonicalName || t.name), t]));
  const recEst = estimateRecoveries(deal).byName;
  const hasRoster = (deal.tenants || []).length > 0;
  const unmatched: string[] = [];
  const inconsistent: ReviewQuestion[] = [];

  const tenants = result.tenants.map(t => {
    const matchKey = tenantKey(stripSuiteCode(t.name as string));
    const rt = roster.get(matchKey);
    if (hasRoster && !rt) unmatched.push(stripSuiteCode(t.name as string) || String(t.name ?? "this tenant"));
    let psf = nv(t.salesPSF);
    let gross = nv(t.annualSales);
    let sf = nv(t.sf);
    if (sf == null) sf = nv(rt?.sf) ?? null;
    // Derive SF from sales ÷ PSF when GLA wasn't disclosed (common in "Gross Sales History" reports that print GLA as 0).
    if (sf == null && psf != null && psf > 0 && gross != null) sf = Math.round(gross / psf);
    if (psf == null && gross != null && sf != null && sf > 0) psf = Math.round((gross / sf) * 100) / 100;
    if (gross == null && psf != null && sf != null && sf > 0) gross = Math.round(psf * sf);

    let occupancyCost = nv(t.occupancyCost);
    let occSource: "stated" | "computed" | undefined = occupancyCost != null ? "stated" : undefined;
    let occBreakdown: OccBreakdown | null = null;
    const base = nv(rt?.annualRent);
    const estRec = recEst.get(matchKey);
    const reimb = nv(rt?.expenseReimbursements) ?? (estRec ? estRec.value : null);
    const reimbEstimated = nv(rt?.expenseReimbursements) == null && !!estRec?.estimated;
    const pctRent = nv(rt?.percentageRent) ?? 0, other = nv(rt?.otherRent) ?? 0;
    // Only COMPUTE the occ-cost when it wasn't already stated on the report — a
    // disclosed figure is authoritative and must not be overwritten by a derived
    // one (whose reimbursements may even be an estimate).
    if (occupancyCost == null && base != null && reimb != null && gross != null && gross > 0) {
      const total = base + reimb + pctRent + other;
      occupancyCost = Math.round((total / gross) * 1000) / 10;
      occSource = "computed";
      occBreakdown = { base, reimbursements: reimb, percentRent: pctRent, other, total, sales: gross, reimbEstimated };
    }
    const cleanName = rt ? (rt.canonicalName || rt.name || stripSuiteCode(t.name as string)) : stripSuiteCode(t.name as string);
    // Internal-consistency check: stated PSF should tie to annual sales ÷ SF. A
    // >20% gap means one of the three numbers was misread — flag the PSF to fix.
    if (psf != null && psf > 0 && gross != null && gross > 0 && sf != null && sf > 0) {
      const impliedPsf = gross / sf;
      if (Math.abs(impliedPsf - psf) / psf > 0.2) {
        inconsistent.push({
          id: `ai-sales-tie-${tenantKey(cleanName)}`,
          source: "ai", severity: "medium",
          field: `${cleanName} — sales PSF`,
          question: `Confirm ${cleanName}'s ${year} sales — the PSF and total don't tie.`,
          detail: `Stated $${psf.toFixed(0)}/SF, but $${Math.round(gross).toLocaleString()} ÷ ${Math.round(sf).toLocaleString()} SF ≈ $${impliedPsf.toFixed(0)}/SF.`,
          suggestedValue: `$${psf.toFixed(2)}/SF`,
          target: { kind: "tenant", fieldKey: "salesPSF", tenantName: cleanName, valueType: "number" },
        });
      }
    }
    return { ...t, name: cleanName, sf, salesPSF: psf, annualSales: gross, occupancyCost, occSource, occBreakdown };
  });

  const newSnap: TenantSalesYear = { year, uploadedAt: new Date().toISOString(), source: "upload", tenants: tenants as TenantSalesYear["tenants"] };
  const existing = (deal.tenantSalesHistory || []).filter(s => s.year !== year);

  // Surface doubt for one-tap review/fix: the model's low-confidence flags, the
  // PSF↔total mismatches, and any sales rows that couldn't be linked to a tenant
  // on the rent roll (their sales won't attach until the name/roster is fixed).
  // Drop this upload's prior sales flags so a re-upload doesn't pile up; keep
  // every other doc type's flags untouched.
  // NB: id ?? "" — OM-extracted reviewQuestions are stored without an id, so a
  // bare q.id.startsWith() throws ("undefined is not an object") and kills the upload.
  const priorFlags = (deal.reviewQuestions ?? []).filter(q => !(q.id ?? "").startsWith("ai-sales-"));
  const unmatchedFlag: ReviewQuestion[] = unmatched.length > 0 ? [{
    id: "ai-sales-unmatched",
    source: "ai", severity: "medium",
    field: "Unlinked sales rows",
    question: `${unmatched.length} sales row${unmatched.length === 1 ? "" : "s"} couldn't be matched to a tenant on the rent roll — their sales won't show until linked.`,
    detail: `No roster match for: ${unmatched.slice(0, 8).join(", ")}${unmatched.length > 8 ? `, +${unmatched.length - 8} more` : ""}. Check the tenant name spelling on the roster, or update the roster.`,
    suggestedValue: null,
    target: null,
  }] : [];
  const reviewQuestions = [...priorFlags, ...(result.reviewQuestions ?? []), ...inconsistent, ...unmatchedFlag];

  return { tenantSalesHistory: [...existing, newSnap], reviewQuestions };
}
