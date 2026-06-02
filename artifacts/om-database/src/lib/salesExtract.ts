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
  "year": <integer — the sales year this report covers, e.g. 2023>,
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
- year: infer from the header or period label of the report (e.g. "2023 Sales Report" → 2023). If truly ambiguous, use the most recent full calendar year mentioned.
- salesPSF: sales per square foot (dollars). Often labeled "Sales/SF", "$/SF", or "PSF".
- annualSales: total annual sales volume in dollars (not PSF). If shown in thousands, convert to full dollars.
- sf: tenant GLA / leased SF for use in sales calculations.
- occupancyCost: TOTAL occupancy cost percentage = (base rent + expense reimbursements/CAM+taxes+insurance + percentage rent + other rent) ÷ gross sales. Often labeled "Occ Cost %", "OC%", or "Occupancy Cost" — capture the report's stated total. Do NOT report a base-rent-only ratio.
- Skip total/subtotal rows and blank rows.
- Include all tenants that have any sales data, even if some fields are null.

${await lessonGuidanceClient("sales")}
SALES REPORT TEXT:
${text.slice(0, 40000)}`;

  const res = await apiAiMessages({
    model: "claude-haiku-4-5-20251001",
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
    let sf = nv(t.sf);
    if (sf == null) sf = nv(rt?.sf) ?? null;
    let psf = nv(t.salesPSF);
    let gross = nv(t.annualSales);
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
