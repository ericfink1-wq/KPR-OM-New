// Shared Anthropic extraction logic — used by both the ai route and the ingest route
import type { Logger } from "pino";
import { db, dealsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { rebuildTenantIndex } from "./tenantIndex";
import { augmentScoringWithBenchmarks, getTotalDealCount } from "./tenantBenchmarks";
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
  "walt": "number or null — if not stated, CALCULATE from rent roll: sum(SF × remaining years to expiry) ÷ total occupied SF, using today's date as the base. Never leave null if lease expiry dates are available.",
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
      "INCLUSION RULE — READ THIS FIRST": "Include a tenant HERE if and only if they are an actual occupant of THIS property with a lease, license, or occupancy agreement — i.e., they appear in the rent roll, tenant roster, or lease schedule of THIS OM with SF and/or rent data. DO NOT include: tenants only mentioned as competitors, tenants at comparable or shadow-anchored properties, tenants described in market-context paragraphs, tenants at off-site parcels, or any retailer name that appears only in a 'co-tenancy' or 'trade area' narrative without accompanying lease data for THIS property. When in doubt, require SF or rent evidence at this address before including.",
      "name": "raw tenant name exactly as it appears in the OM (may include store number, e.g. 'Stop & Shop #1234', 'TJ Maxx #T0586')",
      "canonicalName": "clean brand name only — strip store numbers, suite identifiers, and entity suffixes. Preserve special characters and punctuation that are part of the brand: ampersands (Stop & Shop), apostrophes (McDonald's, Lowe's), hyphens (Chick-fil-A, T-Mobile), and stylized caps (ALDI, H-E-B, TJ Maxx). Examples: 'Stop & Shop #1234' → 'Stop & Shop', 'TJ Maxx #T0586' → 'TJ Maxx', 'McDonald\\'s #32499' → 'McDonald\\'s', 'Dollar Tree #4212' → 'Dollar Tree'",
      "parentCompany": "Parent or holding company that owns this brand — only fill this when you are highly confident based on well-known public corporate ownership (e.g. TJ Maxx → 'TJX Companies', Marshalls → 'TJX Companies', HomeGoods → 'TJX Companies', Stop & Shop → 'Ahold Delhaize', Food Lion → 'Ahold Delhaize', Safeway → 'Albertsons Companies', Dollar Tree → 'Dollar Tree Inc.', Family Dollar → 'Dollar Tree Inc.', Old Navy → 'Gap Inc.', Taco Bell → 'Yum! Brands', Burger King → 'Restaurant Brands Intl.'). Leave null for: privately held regional operators, franchisee-operated tenants, local/independent chains, or any tenant where corporate ownership is uncertain or could have recently changed. When in doubt, leave null — do not guess.",
      "suite": "string or null",
      "sf": "number or null",
      "rentPerSF": "number or null",
      "annualRent": "number or null — BASE rent only; do not fold in recoveries, percentage rent, or any other charges",
      "leaseStart": "string or null",
      "leaseExpiry": "string — ISO format YYYY-MM-DD (e.g. 2029-01-31). Never return Mon-YYYY strings or slash formats.",
      "leaseType": "NNN|Gross|Modified Gross|null",
      "reimbursementMethod": "string or null",
      "percentOfNOI": "number or null",
      "rentBumps": "string — summarize pattern, e.g. '3%/yr'",
      "rentSchedule": "string — REQUIRED for every tenant. List all dated rent steps with amounts e.g. '2024-09-01: $13.50 PSF ($345,384/yr); 2029-09-01: $15.50 PSF ($396,552/yr)'. Include option period bumps. If rent is flat, write 'Flat at $XX.XX PSF through YYYY-MM-DD.' Never leave null.",
      "renewalOptions": "string or null",
      "recentlyExercisedRenewal": "string or null",
      "percentageRentClause": "string or null — text describing the percentage rent clause (e.g. '7% of gross sales above $500/SF natural breakpoint'). Null if no clause.",
      "expenseReimbursements": "number or null — Populate ONLY when the OM explicitly discloses the annual CAM + real-estate-tax + insurance recoveries paid by this specific tenant in dollars. Never estimate, derive, or guess. If not disclosed, leave null.",
      "percentageRent": "number or null — Populate ONLY when the OM explicitly discloses the annual overage/percentage rent paid by this tenant in dollars. Never estimate. If not disclosed, leave null.",
      "otherRent": "number or null — Populate ONLY when the OM explicitly discloses annual marketing/promo fund, storage, specialty, or other rent paid by this tenant in dollars. Never estimate. If not disclosed, leave null.",
      "creditRating": "Investment Grade|Non-Investment Grade|null",
      "salesPSF": "number or null",
      "salesYear": "number or null — the calendar year the salesPSF figure is from (e.g. 2024). Infer from context ('2024 sales', 'trailing 12 months ending Dec-2024', etc.).",
      "salesNotes": "string or null",
      "occupancyCost": "number or null — total occupancy cost as a percentage of sales (base rent + CAM + taxes + insurance recoveries, all divided by gross sales). Often labeled 'Occ Cost %', 'OC%', or 'Occupancy Cost'. If the OM only states base rent ÷ sales, note that in salesNotes instead and leave this null.",
      "assumptionNote": "string or null — any footnote/assumption for this tenant",
      "isAnchor": "true|false",
      "isNAP": "true if this tenant is on an adjacent parcel NOT part of this sale/ownership (marked NAP, Not A Part, or outparcel on the site plan). false or null otherwise.",
      "isDark": "true if this tenant is a 'dark' store — they still hold the lease and are paying rent, but the store is closed / no longer operating (look for words like 'dark', 'closed but paying', 'gone dark', 'not operating', 'vacated but obligated', 'lease in place, store closed'). false or null otherwise. Do NOT mark a unit dark just because it is vacant with no tenant — dark specifically means a paying tenant whose store is closed.",
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
  "comparableSales": [{"name": "string or null — property name if stated", "address": "string", "market": "string or null — MSA or city/market label", "saleDate": "string", "salePrice": "number or null", "capRate": "number or null", "pricePerSF": "number or null", "sf": "number or null", "occupancy": "number or null"}],
  "dealScore": {"grade": "A+|A|B+|B|C+|C|D", "rationale": "one precise sentence based on the OM data available now — NOTE: a post-extraction portfolio benchmark pass will inject recency-weighted rent data from previously analyzed deals and may revise this score; when that data is present it supersedes general market assumptions", "strengths": ["string"], "risks": ["string"]},
  "redFlags": [{"severity": "high|medium|low", "description": "string — high only for substantial roof end-of-life or anchor with weak credit/closure history. NEVER flag absent asking price or non-reassessed RE taxes."}],
  "upsideItems": [{"priority": "high|medium|low", "item": "short label e.g. Mark-to-Market Rent Upside", "detail": "1-2 sentence explanation of the opportunity and magnitude if quantifiable — high only for significant value-creation opportunities clearly supported by OM data. Examples: below-market leases rolling to market, repositioning/redevelopment potential, shadow anchor lease-up, occupancy upside, strong demographics supporting rent growth. Do NOT list generic positives already captured in dealScore.strengths. Empty array if no genuine upside items beyond the going-in yield."}],
  "notes": "Substantive investment highlights narrative — write 5-8 sentences covering: (1) what the asset is and why the location matters, (2) anchor tenant quality, sales performance, and lease profile, (3) inline tenant mix and credit quality, (4) key lease metrics (WALT, occupancy, rent PSF vs. market), (5) the primary investment thesis — is this a cash flow play, mark-to-market story, value-add, or development upside, and (6) the most important risk or watch item. Write in the voice of an institutional underwriting memo — specific, data-driven, no generic filler. Reference actual numbers from the OM where available (sales PSF, cap rate, NOI, demographics). Do NOT just restate the property name and tenant list.",
  "extraFields": {"any_other_notable_metric": "value"}
}

PRIORITIES: Capture all footnotes/assumptions (assumptionNote, keyAssumptions). Capture roof ages. Only fill askingPrice/capRate when explicitly stated. shadowAnchors = null unless OM explicitly marks on-site parcel as NAP/unowned. Tenant roster scope: ONLY include tenants that are actual occupants of THIS property — i.e., they appear in the rent roll, tenant roster, or lease schedule with SF and/or rent data at this address. Exclude any tenant mentioned solely as: a competitor, a shadow anchor or co-tenant at another parcel, a comparable-sale occupant, a "trade area" or "co-tenancy" narrative reference, or market context. The test is: does this tenant have a lease at THIS property? If yes → include. If no → exclude. Tenant deduplication: if the same retailer appears in multiple phases, buildings, or pads (e.g. "TJ Maxx" and "TJ Maxx (West)"), consolidate into ONE tenant row — do NOT append phase/building identifiers in parentheses to the tenant name. Use the combined SF and primary lease terms for the single entry. Vacant spaces: include vacant/availability rows as tenant entries with name "Vacant", their SF if stated, and null for all lease/rent fields — this ensures the roster reflects the actual vacancy picture. Dates: always ISO YYYY-MM-DD. rentSchedule: required for every tenant, never null. WALT: calculate from lease dates if not stated. Tenant names: brand only, no store numbers.

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
      model: "claude-haiku-4-5-20251001",
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
      "\n\nINCLUSION RULE: Only include tenants that are actual occupants of THIS property — they must appear in the rent roll, tenant roster, or lease schedule with SF and/or rent data at this address. Do NOT include tenants mentioned as competitors, shadow anchors at other parcels, comparable-sale occupants, or trade-area/co-tenancy narrative references. The test: does this tenant have a lease at THIS property?\n\n" +
      "Return ONLY a JSON object: {\"tenants\":[...]} using this schema per tenant: " +
      "{name, suite, sf, rentPerSF, annualRent, leaseStart, leaseExpiry, leaseType, reimbursementMethod, rentBumps, rentSchedule, renewalOptions, percentageRentClause, expenseReimbursements, percentageRent, otherRent, creditRating, salesPSF, isAnchor, isDark, remainingTermYears}. " +
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

// ── Regenerate the ANALYSIS (summary, grade, strengths/risks, upside, red flags) from the
// CURRENT structured deal data (live roster + financials) — NOT from the stored OM text.
// This is what makes a manual rent-roll update reflect consistently in the narrative without
// re-reading a stale OM. Returns ONLY the analytical fields; never touches tenants.
const ROSTER_ANALYSIS_PROMPT = `You are an expert real estate investment analyst. You are given the CURRENT, verified data for a single retail property — its live tenant roster and key financials. Regenerate ONLY the analytical narrative fields, based STRICTLY on the data provided. Do NOT invent tenants, sales, cap rates, or figures that are not present in the data. If a value is null/absent, do not fabricate it.

Return ONLY a single valid JSON object with EXACTLY these keys and nothing else:
{
  "notes": "5-8 sentence institutional underwriting narrative covering: (1) what the asset is and why the location matters, (2) anchor tenant quality and lease profile, (3) inline tenant mix and credit quality, (4) key lease metrics (WALT, occupancy, rent PSF), (5) the primary investment thesis (cash-flow, mark-to-market, value-add, or development), (6) the most important risk or watch item. Specific and data-driven using the numbers provided; no generic filler; do not just restate the tenant list.",
  "dealScore": {"grade":"A+|A|B+|B|C+|C|D","rationale":"one precise sentence grounded in the data","strengths":["string"],"risks":["string"]},
  "upsideItems": [{"priority":"high|medium|low","item":"short label","detail":"1-2 sentences; empty array if none beyond going-in yield"}],
  "redFlags": [{"severity":"high|medium|low","description":"string; reflect near-term lease expirations or vacancy evident in the data"}]
}

BELOW-MARKET RENT — judge it correctly, do not treat it as automatically good or bad:
- Below-market rent is only real MARK-TO-MARKET UPSIDE when the landlord can actually capture it during a normal hold. The strongest case (priority "high") is a tenant that is BELOW market AND has LITTLE LEASE TERM REMAINING (low remainingTermYears / near-term leaseExpiry) AND few or no remaining fixed-rate renewal options (renewalOptions) AND demonstrates it can pay more — STRONG sales (salesPSF) with a LOW occupancyCost %. That tenant can be marked to market at rollover.
- DISCOUNT the upside when the tenant has many years of term left, OR has multiple remaining options at fixed/below-market rents (you would never reach market during the hold) — in that case below-market rent is locked in, not upside. Mention it at most as minor/"low".
- Below-market rent can also be a WARNING, not upside: if sales are weak or occupancyCost is already high, the low rent may reflect a struggling tenant or a soft market, and pushing rent at renewal risks losing them. Frame it as a risk in that case.
- If sales/occupancy-cost data is absent, stay measured: note the below-market rent as a POSSIBLE mark-to-market opportunity contingent on lease term/options and sales, rather than asserting upside.

Base everything on the CURRENT roster below (note tenantsAsOf — this roster supersedes any older OM). Output must start with { and end with }.

CURRENT PROPERTY DATA (JSON):
`;

export async function runRosterAnalysis(dealData: Record<string, unknown>): Promise<Record<string, unknown>> {
  const t = Array.isArray(dealData.tenants) ? (dealData.tenants as Array<Record<string, unknown>>) : [];
  const snapshot = {
    propertyName: dealData.propertyName, address: dealData.address, city: dealData.city, state: dealData.state,
    assetType: dealData.assetType, centerType: dealData.centerType,
    totalSF: dealData.totalSF, occupancy: dealData.occupancy, walt: dealData.walt,
    askingPrice: dealData.askingPrice, capRate: dealData.capRate, noi: dealData.noi,
    weightedAvgRentPSF: dealData.weightedAvgRentPSF, grossPotentialRent: dealData.grossPotentialRent,
    tenantsAsOf: dealData.tenantsAsOf, tenantsSource: dealData.tenantsSource,
    marketDemographics: dealData.marketDemographics ?? null,
    tenants: t.map((x) => ({
      name: x.name, sf: x.sf, rentPerSF: x.rentPerSF, annualRent: x.annualRent,
      leaseExpiry: x.leaseExpiry, remainingTermYears: x.remainingTermYears,
      isAnchor: x.isAnchor, isNAP: x.isNAP, isDark: x.isDark, creditRating: x.creditRating,
      leaseType: x.leaseType, rentSchedule: x.rentSchedule,
      // Needed to judge whether below-market rent is REAL mark-to-market upside
      renewalOptions: x.renewalOptions, rentBumps: x.rentBumps,
      salesPSF: x.salesPSF, salesYear: x.salesYear, occupancyCost: x.occupancyCost,
    })),
  };
  const content = ROSTER_ANALYSIS_PROMPT + JSON.stringify(snapshot, null, 1);
  const upstream = await callAnthropicOnce({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    messages: [{ role: "user", content }],
  });
  const data = await upstream.json() as Record<string, unknown>;
  if (!upstream.ok) {
    const errMsg = typeof data.error === "object" && data.error !== null
      ? (data.error as Record<string, unknown>).message ?? JSON.stringify(data.error)
      : String(data.error ?? "Unknown error");
    throw new Error(String(errMsg));
  }
  const blocks = data.content as Array<{ type: string; text?: string }>;
  const raw = blocks?.find((b) => b.type === "text")?.text ?? "";
  if (!raw) throw new Error(`AI returned empty content. stop_reason=${data.stop_reason}`);
  const parsed = robustParseJSON(raw) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (parsed.notes != null) out.notes = parsed.notes;
  if (parsed.dealScore != null) out.dealScore = parsed.dealScore;
  if (parsed.upsideItems != null) out.upsideItems = parsed.upsideItems;
  if (parsed.redFlags != null) out.redFlags = parsed.redFlags;
  return out;
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
    const { data: rawExtracted } = await runOmExtraction(text, extraGuidance);
    const [augmented, totalCount] = await Promise.all([
      augmentScoringWithBenchmarks(id, rawExtracted, log),
      getTotalDealCount(),
    ]);
    const dealData: Record<string, unknown> = {
      ...augmented,
      _processing: false,
      fileName,
      uploadedAt: new Date().toISOString(),
      status: "Prospect",
      pdfPages: pageCount,
      lastScoredAt: new Date().toISOString(),
      lastScoredDealCount: totalCount,
    };
    await db.update(dealsTable)
      .set({ data: dealData, updatedAt: new Date() })
      .where(eq(dealsTable.id, id));
    await rebuildTenantIndex(id, dealData);
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
