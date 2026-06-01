import { apiAiMessages } from "./api";
import { robustParseJSON } from "./utils";

// Extract comparable-sale records from an Excel/CSV-derived text dump or a PDF
// comps sheet, mapping arbitrary columns/layout into the shape /comps/manual/bulk
// expects. Used by the Comps page's file import (Excel + PDF).
export interface ImportedComp {
  name?: string | null;
  address?: string | null;
  market?: string | null;
  state?: string | null;
  saleDate?: string | null;       // ISO YYYY-MM-DD when determinable
  saleDateRaw?: string | null;    // as printed
  salePrice?: number | null;
  capRate?: number | null;        // percent, e.g. 6.25
  pricePerSf?: number | null;
  sf?: number | null;
  occupancy?: number | null;      // percent
  anchor?: string | null;
  propertyType?: string | null;
  buyer?: string | null;
  seller?: string | null;
  sourceNotes?: string | null;
}

export async function extractCompsFromText(text: string, sourceLabel: string): Promise<ImportedComp[]> {
  const prompt = `You are a CRE data extraction engine. The text below is a list of COMPARABLE SALES (sold properties) from ${sourceLabel}. Extract EVERY comparable sale row into JSON.

Return ONLY JSON: {"comps":[{...}]}

Each comp (omit a field if not present — never invent values):
{"name","address","market","state","saleDate","saleDateRaw","salePrice","capRate","pricePerSf","sf","occupancy","anchor","propertyType","buyer","seller","sourceNotes"}

Rules:
- name: property/center name (or address if no name).
- salePrice: total sale price in PLAIN DOLLARS (no $ or commas; convert "$12.5M" → 12500000, "$1,250,000" → 1250000).
- saleDate: ISO YYYY-MM-DD if a full/partial date is given (use -01 for unknown day); saleDateRaw: the date exactly as printed (e.g. "May-2026", "Q2 2025").
- capRate: percent as a number (6.25, not "6.25%"). occupancy: percent number.
- pricePerSf: price per SF as a number; sf: gross leasable area as a number (no commas).
- state: 2-letter code if derivable from market/address.
- anchor: lead anchor tenant(s) if listed. propertyType: e.g. "Power Center", "Grocery-Anchored".
- buyer / seller: if disclosed.
- Skip header rows, totals/averages/subtotals, and any row with neither a name/address nor a sale price.
- This is a SALES comp set — do not include rent-roll tenants or for-lease listings.

DATA:
${text.slice(0, 60000)}`;

  const res = await apiAiMessages({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = res.content?.find(c => c.type === "text")?.text ?? "";
  let parsed: { comps?: unknown[] };
  try { parsed = robustParseJSON(raw) as typeof parsed; }
  catch { throw new Error("Couldn't parse the comps from that file — try a clearer layout."); }
  const comps = Array.isArray(parsed.comps) ? parsed.comps as ImportedComp[] : [];
  if (comps.length === 0) throw new Error("No comparable sales found in that file.");
  return comps;
}
