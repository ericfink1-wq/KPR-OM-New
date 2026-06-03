import type { Deal, TenantSalesYear, OccBreakdown } from "./idb";
import { apiAiMessages, lessonGuidanceClient } from "./api";
import { robustParseJSON, tenantKey, stripSuiteCode, estimateRecoveries } from "./utils";

export interface SalesExtractResult {
  year: number;
  tenants: Array<Record<string, unknown>>;
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
  ]
}

RULES:
- salesPSF: sales per square foot (dollars). Often labeled "Sales/SF", "$/SF", "PSF", or "Per Square Foot".
- annualSales: TOTAL annual sales volume in dollars (not PSF) for a FULL 12-month year. If shown in thousands, convert to full dollars.
- sf: tenant GLA / leased SF used for sales calculations.
- occupancyCost: TOTAL occupancy cost percentage = (base rent + expense reimbursements/CAM+taxes+insurance + percentage rent + other rent) ÷ gross sales. Often labeled "Occ Cost %", "OC%", or "Occupancy Cost" — capture the report's stated total. Do NOT report a base-rent-only ratio.
- Skip total/subtotal rows and blank rows. Skip tenants whose sales are all zero / not reported.
- Include all tenants that have any real sales data, even if some fields are null.

CHOOSING THE YEAR — READ CAREFULLY. Many reports (e.g. "Gross Sales History", "MAX_GSALES") show MULTIPLE year columns per tenant (e.g. 12/25, 12/24, 12/23 …). The MOST RECENT column is frequently a PARTIAL / year-to-date year that is NOT yet complete — its total is far smaller than the prior year, or its later months are zero/blank, or the report is dated early in the following year. DO NOT use a partial year: it understates sales drastically (e.g. a grocer showing $5M for a part-year vs $51M full-year).
- Use the MOST RECENT *COMPLETE* full-year column for every tenant, and set the top-level "year" to that complete year. If the latest column is clearly partial (much lower than the prior year, trailing zero months, or report dated in Jan–Mar of the next year), step back to the last complete year.
- A tenant's annualSales and salesPSF MUST come from the SAME chosen year and be internally consistent (annualSales ÷ sf ≈ salesPSF).

SQUARE FOOTAGE — IMPORTANT. If the report's "Square Feet (GLA)" prints as 0 or blank but it DOES state a "Per Square Foot" sales figure, DERIVE sf = round(annualSales ÷ salesPSF). Never report sf as 0 when sales and PSF are both present.

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
  return { year, tenants };
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

  const tenants = result.tenants.map(t => {
    const matchKey = tenantKey(stripSuiteCode(t.name as string));
    const rt = roster.get(matchKey);
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
    if (base != null && reimb != null && gross != null && gross > 0) {
      const total = base + reimb + pctRent + other;
      occupancyCost = Math.round((total / gross) * 1000) / 10;
      occSource = "computed";
      occBreakdown = { base, reimbursements: reimb, percentRent: pctRent, other, total, sales: gross, reimbEstimated };
    }
    const cleanName = rt ? (rt.canonicalName || rt.name || stripSuiteCode(t.name as string)) : stripSuiteCode(t.name as string);
    return { ...t, name: cleanName, sf, salesPSF: psf, annualSales: gross, occupancyCost, occSource, occBreakdown };
  });

  const newSnap: TenantSalesYear = { year, uploadedAt: new Date().toISOString(), source: "upload", tenants: tenants as TenantSalesYear["tenants"] };
  const existing = (deal.tenantSalesHistory || []).filter(s => s.year !== year);
  return { tenantSalesHistory: [...existing, newSnap] };
}
