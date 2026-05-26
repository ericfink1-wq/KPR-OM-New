// Shared Anthropic extraction logic — used by both the ai route and the ingest route
import type { Logger } from "pino";
import { db, dealsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Agent, fetch as undiciFetch } from "undici";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// Undici agent with generous timeouts — Claude can take 60-90s for large OMs
const anthropicAgent = new Agent({
  headersTimeout: 5 * 60 * 1000,
  bodyTimeout: 10 * 60 * 1000,
  connectTimeout: 30 * 1000,
});

export const EXTRACTION_PROMPT = `You are an expert real estate investment analyst. Extract ALL available data from this Offering Memorandum text and return ONLY a single valid JSON object. Use null for anything not found.

REQUIRED SCHEMA:
{
  "propertyName": "string",
  "address": "full street address",
  "city": "city / town name only, e.g. 'Lewis Center' (no state or zip) or null",
  "state": "2-letter state abbreviation, e.g. 'OH' or null",
  "market": "metro market (e.g. Dallas-Fort Worth)",
  "submarket": "string or null",
  "assetType": "Retail|Office|Industrial|Multifamily|Mixed-Use|NNN|Other",
  "centerType": "For retail, the center FORMAT: Grocery-Anchored|Power Center|Neighborhood Center|Community Center|Lifestyle Center|Regional Mall|Super-Regional Mall|Outlet Center|Strip/Unanchored|Single-Tenant NNN|Mixed-Use|Other. Infer from anchors and description. null if not retail.",
  "urbanicity": "Urban|Suburban|Exurban|Rural or null",
  "omDate": "YYYY-MM-DD or null",
  "askingPrice": "number or null — ONLY if explicitly stated",
  "capRate": "number or null — ONLY if explicitly stated",
  "noi": "number or null",
  "grossPotentialRent": "number or null",
  "effectiveGrossIncome": "number or null",
  "operatingExpenses": "number or null",
  "expenseRatio": "number or null",
  "nnnRecoveries": "number or null",
  "occupancy": "number or null",
  "totalSF": "number or null",
  "pricePerSF": "number or null",
  "walt": "number or null",
  "weightedAvgRentPSF": "number or null",
  "yearBuilt": "number or null",
  "renovationYear": "number or null",
  "numberOfBuildings": "number or null",
  "numberOfUnits": "number or null",
  "lotSizeAcres": "number or null",
  "parkingSpaces": "number or null",
  "parkingRatio": "number or null",
  "constructionType": "string or null",
  "zoning": "string or null",
  "roofData": {
    "summary": "string or null",
    "sections": [{"area": "string", "installedYear": "number or null", "ageYears": "number or null", "condition": "string or null"}],
    "concern": "string or null — flag only if large share of roof area is old/near end-of-life"
  },
  "lastSaleDate": "YYYY-MM-DD or null",
  "lastSalePrice": "number or null",
  "assumableDebt": "true|false|null",
  "loanBalance": "number or null",
  "loanRate": "number or null",
  "loanMaturity": "string or null",
  "loanType": "Fixed|Floating|null",
  "broker": "string",
  "seller": "string or null",
  "trafficCountVPD": "number or null",
  "population1mi": "number or null",
  "population3mi": "number or null",
  "population5mi": "number or null",
  "medianHHIncome3mi": "number or null",
  "avgHHIncome3mi": "number or null",
  "proximityHighways": "string or null",
  "retailCotenants": "string or null",
  "tenants": [
    {
      "name": "string",
      "suite": "string or null",
      "sf": "number or null",
      "rentPerSF": "number or null",
      "annualRent": "number or null",
      "leaseStart": "string or null",
      "leaseExpiry": "string",
      "leaseType": "NNN|Gross|Modified Gross|null",
      "reimbursementMethod": "string or null",
      "percentOfNOI": "number or null",
      "rentBumps": "string — summarize pattern, e.g. '3%/yr'",
      "rentSchedule": "string or null",
      "renewalOptions": "string or null",
      "recentlyExercisedRenewal": "string or null",
      "percentageRent": "string or null",
      "creditRating": "Investment Grade|Non-Investment Grade|null",
      "salesPSF": "number or null",
      "salesNotes": "string or null",
      "occupancyCost": "number or null",
      "assumptionNote": "string or null — any footnote/assumption for this tenant",
      "isAnchor": "true|false",
      "originalLeaseDate": "string or null",
      "remainingTermYears": "number or null"
    }
  ],
  "cashFlowProjection": [{"label": "string", "noi": "number or null", "egr": "number or null", "totalBaseRent": "number or null", "reimbursements": "number or null", "operatingExpenses": "number or null", "netCashFlow": "number or null"}],
  "incomeBreakdown": {"anchorBaseRent": "number or null", "shopBaseRent": "number or null", "camReimbursements": "number or null", "realEstateTaxReimbursements": "number or null", "insuranceReimbursements": "number or null", "percentageRentIncome": "number or null", "vacancyLoss": "number or null"},
  "expenseBreakdown": {"commonAreaExpenses": "number or null", "realEstateTax": "number or null", "insurance": "number or null", "managementFee": "number or null"},
  "underwritingAssumptions": {"analysisPeriodYears": "number or null", "analysisStartDate": "string or null", "expenseInflation": "string or null", "marketRentInflation": "string or null", "capitalReserves": "string or null", "managementFeePct": "string or null", "generalVacancyLoss": "string or null", "renewalProbability": "string or null", "tiAllowance": "string or null", "leasingCommissions": "string or null", "marketRentsBySpaceType": "string or null"},
  "shadowAnchors": "string or null — ONLY on-site parcels NOT part of this sale (NAP/unowned). Most centers have none.",
  "keyAssumptions": ["array of deal-level footnotes affecting underwriting — empty array if none"],
  "comparableSales": [{"address": "string", "saleDate": "string", "salePrice": "number or null", "capRate": "number or null", "pricePerSF": "number or null", "sf": "number or null"}],
  "dealScore": {"grade": "A+|A|B+|B|C+|C|D", "rationale": "one precise sentence", "strengths": ["string"], "risks": ["string"]},
  "redFlags": [{"severity": "high|medium|low", "description": "string — high only for substantial roof end-of-life or anchor with weak credit/closure history. NEVER flag absent asking price or non-reassessed RE taxes."}],
  "notes": "2-3 sentence investment summary",
  "extraFields": {"any_other_notable_metric": "value"}
}

PRIORITIES: Capture all footnotes/assumptions (assumptionNote, keyAssumptions). Capture roof ages. Only fill askingPrice/capRate when explicitly stated. shadowAnchors = null unless OM explicitly marks on-site parcel as NAP/unowned. Tenant deduplication: if the same retailer appears in multiple phases, buildings, or pads (e.g. "TJ Maxx" and "TJ Maxx (West)"), consolidate into ONE tenant row — do NOT append phase/building identifiers in parentheses to the tenant name. Use the combined SF and primary lease terms for the single entry.

Return ONLY raw JSON. No markdown, no code fences, no explanation.`;

export async function callAnthropicOnce(body: object, retryCount = 0): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  let resp: Response;
  try {
    resp = await undiciFetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      dispatcher: anthropicAgent,
    }) as unknown as Response;
  } catch (err) {
    // Network-level error (timeout, connection reset, etc.) — retry with backoff
    if (retryCount < 5) {
      const waitMs = Math.min(2000 * Math.pow(2, retryCount) + Math.random() * 1000, 60000);
      await new Promise((r) => setTimeout(r, waitMs));
      return callAnthropicOnce(body, retryCount + 1);
    }
    throw err;
  }

  if ((resp.status === 429 || resp.status === 529 || resp.status === 503) && retryCount < 5) {
    const retryAfter = parseFloat(resp.headers.get("retry-after") ?? "");
    const waitMs = isNaN(retryAfter)
      ? Math.min(1000 * Math.pow(2, retryCount) + Math.random() * 500, 30000)
      : Math.min(retryAfter * 1000, 60000);
    await new Promise((r) => setTimeout(r, waitMs));
    return callAnthropicOnce(body, retryCount + 1);
  }
  return resp;
}

export function robustParseJSON(raw: string): unknown {
  if (!raw?.trim()) throw new Error("Empty response");
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try { return JSON.parse(s); } catch {}
  try { return JSON.parse(s.replace(/,(\s*[}\]])/g, "$1")); } catch {}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch {}
  }
  if (first !== -1) {
    try { return repairTruncatedJSON(s.slice(first)); } catch {}
  }
  throw new Error("All parse strategies failed");
}

function repairTruncatedJSON(s: string): unknown {
  let inStr = false, esc = false;
  const stack: string[] = [];
  let safeLen = -1, safeClosers = "";
  const closersFor = () => stack.map((b) => (b === "{" ? "}" : "]")).reverse().join("");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; }
    else if (c === "{" || c === "[") { stack.push(c); }
    else if (c === "}" || c === "]") { stack.pop(); safeLen = i + 1; safeClosers = closersFor(); }
    else if (c === ",") { safeLen = i; safeClosers = closersFor(); }
  }
  if (safeLen <= 0) throw new Error("Could not repair truncated JSON");
  const repaired = s.slice(0, safeLen).replace(/,\s*$/, "") + safeClosers;
  return JSON.parse(repaired);
}

// Strip trailing phase/building identifiers like "(West)", "(Phase 2)", "(Bldg A)"
// so duplicate phase entries collapse to the same base name.
const PHASE_SUFFIX = /\s*\(\s*(west|east|north|south|phase\s*\w+|bldg\s*\w+|building\s*\w+|pad\s*\w+|site\s*\w+|unit\s*\w+|suite\s*\w+|section\s*\w+|wing\s*\w+|\w+\s+phase\s*\w*)\s*\)\s*$/i;

function normTenantName(name: string): string {
  return name.replace(PHASE_SUFFIX, "").trim().toLowerCase();
}

function mergePhaseDuplicates(tenants: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (!tenants || tenants.length === 0) return tenants;
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const t of tenants) {
    const name = typeof t.name === "string" ? t.name : "";
    const key = normTenantName(name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const merged: Array<Record<string, unknown>> = [];
  for (const group of groups.values()) {
    if (group.length === 1) { merged.push(group[0]); continue; }
    // Pick the entry with the canonical (un-suffixed) name if one exists, else the first
    const base = group.find(t => !PHASE_SUFFIX.test(String(t.name || ""))) || group[0];
    const result: Record<string, unknown> = { ...base };
    // Strip any lingering phase suffix from the chosen name
    if (typeof result.name === "string") result.name = result.name.replace(PHASE_SUFFIX, "").trim();
    // Sum numeric fields across all phases; fill nulls from other entries
    const numSum = (field: string) => {
      const vals = group.map(t => { const v = t[field]; return v != null && !isNaN(Number(v)) ? Number(v) : null; }).filter((v): v is number => v !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    const sumSF = numSum("sf"); if (sumSF != null) result.sf = sumSF;
    const sumRent = numSum("annualRent"); if (sumRent != null) result.annualRent = sumRent;
    // For any field that's null in the base, fill from other entries
    for (const t of group) {
      for (const k of Object.keys(t)) {
        if (result[k] == null && t[k] != null) result[k] = t[k];
      }
    }
    merged.push(result);
  }
  return merged;
}

// Full OM extraction — retries truncated tenant lists automatically
export async function runOmExtraction(text: string, extraGuidance = ""): Promise<{ data: Record<string, unknown>; tenantsComplete: boolean }> {
  const truncatedText = text.length > 180000
    ? text.slice(0, 120000) + "\n...[middle truncated]...\n" + text.slice(-40000)
    : text;

  const callExtract = async (content: string) => {
    const upstream = await callAnthropicOnce({
      model: "claude-sonnet-4-6",
      max_tokens: 32000,
      messages: [{ role: "user", content }],
    });
    const data = await upstream.json() as Record<string, unknown>;
    if (!upstream.ok) {
      const errMsg = typeof data.error === "object" && data.error !== null
        ? (data.error as Record<string, unknown>).message ?? JSON.stringify(data.error)
        : String(data.error ?? "Unknown error");
      throw new Error(String(errMsg));
    }
    const content_blocks = data.content as Array<{ type: string; text?: string }>;
    const raw = content_blocks?.find((b) => b.type === "text")?.text ?? "";
    if (!raw) throw new Error(`AI returned empty content. stop_reason=${data.stop_reason}`);
    return { raw, stopReason: data.stop_reason as string };
  };

  const first = await callExtract(EXTRACTION_PROMPT + (extraGuidance || "") + "\n\nOM TEXT:\n" + truncatedText);
  let extracted = robustParseJSON(first.raw) as Record<string, unknown>;
  if (!extracted.tenants) extracted.tenants = [];

  let stopReason = first.stopReason;
  let rounds = 0;
  while (stopReason === "max_tokens" && rounds < 8) {
    rounds++;
    const tenants = extracted.tenants as Array<{ name?: string }>;
    const haveNames = tenants.map((t) => t.name).filter(Boolean);
    const contPrompt =
      "From the Offering Memorandum text below, extract ONLY the tenants NOT already in this list:\n" +
      haveNames.join(", ") +
      "\n\nReturn ONLY a JSON object: {\"tenants\":[...]} using this schema per tenant: " +
      "{name, suite, sf, rentPerSF, annualRent, leaseStart, leaseExpiry, leaseType, reimbursementMethod, rentBumps, rentSchedule, renewalOptions, percentageRent, creditRating, salesPSF, isAnchor, remainingTermYears}. " +
      "If there are no more tenants, return {\"tenants\":[]}. Output must start with { and end with }.\n\nOM TEXT:\n" + truncatedText;
    try {
      const cont = await callExtract(contPrompt);
      const contParsed = robustParseJSON(cont.raw) as Record<string, unknown>;
      const newOnes = ((contParsed.tenants as Array<{ name?: string }>) || [])
        .filter((t) => t?.name && !haveNames.includes(t.name));
      if (newOnes.length === 0) break;
      extracted.tenants = (extracted.tenants as unknown[]).concat(newOnes);
      stopReason = cont.stopReason;
    } catch {
      break;
    }
  }

  extracted.tenants = mergePhaseDuplicates(extracted.tenants as Array<Record<string, unknown>>);

  return { data: extracted, tenantsComplete: stopReason !== "max_tokens" };
}

// Run extraction as a background job — updates the deal row in DB when done/error
export async function runBackgroundExtraction(
  id: string,
  text: string,
  fileName: string,
  pageCount: number,
  log: Logger,
  extraGuidance = "",
): Promise<void> {
  try {
    const { data: extracted } = await runOmExtraction(text, extraGuidance);
    const dealData: Record<string, unknown> = {
      ...extracted,
      _processing: false,
      fileName,
      uploadedAt: new Date().toISOString(),
      status: "Prospect",
      pdfPages: pageCount,
    };
    await db.update(dealsTable)
      .set({ data: dealData, updatedAt: new Date() })
      .where(eq(dealsTable.id, id));
    log.info({ id }, "Background extraction complete");
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Extraction failed";
    log.error({ err, id }, "Background extraction failed");
    await db.update(dealsTable)
      .set({
        data: { _processing: false, _processingError: errorMsg, fileName, status: "Prospect", uploadedAt: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(eq(dealsTable.id, id));
  }
}
