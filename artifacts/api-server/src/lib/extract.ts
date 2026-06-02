// Shared Anthropic extraction logic — used by both the ai route and the ingest route
import type { Logger } from "pino";
import { db, dealsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { rebuildTenantIndex, parseLeaseDate } from "./tenantIndex";
import { augmentScoringWithBenchmarks, getTotalDealCount } from "./tenantBenchmarks";
import { ANALYSIS_VERSION } from "./analysisVersion";
import { lessonGuidance } from "./extractionLessons";
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
      "creditRating": "Investment Grade | Non-Investment Grade | null — Set this ONLY when the OM explicitly states a credit rating for the tenant, OR the tenant is a national credit you are CERTAIN is investment-grade (e.g. Target, Walmart, Costco, Home Depot, Lowe's, TJX/TJ Maxx/Marshalls, Ross, CVS, Walgreens, Kroger, Publix, McDonald's, Starbucks, Chick-fil-A, Verizon, AT&T, a money-center bank). Otherwise DEFAULT TO null. Do NOT infer 'Investment Grade' for private, PE-owned, franchised, regional, or local operators, and do NOT label junk/non-rated retailers as Investment Grade (e.g. Gap/Old Navy, Burlington, Michaels, Barnes & Noble, At Home, Lane Bryant, Famous Footwear, Destination XL, most restaurants and franchises). When unsure, use null — never guess a rating.",
      "salesPSF": "number or null",
      "salesYear": "number or null — the calendar year the salesPSF figure is from (e.g. 2024). Infer from context ('2024 sales', 'trailing 12 months ending Dec-2024', etc.).",
      "salesNotes": "string or null",
      "occupancyCost": "number or null — TOTAL occupancy cost as a percentage of gross sales, defined as (base rent + expense reimbursements/CAM+taxes+insurance + percentage rent + other rent) ÷ gross sales. Often labeled 'Occ Cost %', 'OC%', or 'Occupancy Cost'. Use the OM's stated total occ-cost % when given. If the OM only states base rent ÷ sales (not the full health ratio), note that in salesNotes instead and leave this null.",
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
  "dealScore": {"grade": "A+|A|B+|B|C+|C|D", "rationale": "one precise sentence based on the OM data available now, with the key driver(s) wrapped in **double asterisks** for bold emphasis — NOTE: a post-extraction portfolio benchmark pass will inject recency-weighted rent data from previously analyzed deals and may revise this score; when that data is present it supersedes general market assumptions", "strengths": ["string"], "risks": ["string"]},
  "redFlags": [{"severity": "high|medium|low", "description": "string — high only for substantial roof end-of-life or anchor with weak credit/closure history. NEVER flag absent asking price or non-reassessed RE taxes."}],
  "upsideItems": [{"priority": "high|medium|low", "item": "short label e.g. Mark-to-Market Rent Upside", "detail": "1-2 sentence explanation of the opportunity and magnitude if quantifiable — high only for significant value-creation opportunities clearly supported by OM data. Examples: below-market leases rolling to market, repositioning/redevelopment potential, shadow anchor lease-up, occupancy upside, strong demographics supporting rent growth. BELOW-MARKET RENT is real mark-to-market upside ONLY when the tenant has little term left AND few/no remaining fixed-rate renewal options AND can clearly afford more (strong salesPSF with low occupancyCost %); if sales are weak / occupancy cost already high it's a risk, not upside. HOLD-TIMING TIERS (KPR holds 5–7 yrs, max ~10): below-market rent rolling within ~7 yrs = in-hold upside KPR captures (can be high); rolling ~7–12 yrs out = residual/exit upside to position for the NEXT buyer (score 'low', occasionally 'medium' if large/anchor, and label it as a future-owner mark-to-market, not in-hold); locked deeper than ~12 yrs = not upside. RENEWAL OPTIONS GATE: if the tenant holds ANY remaining renewal options, assume the TENANT controls whether to stay and at what rent — treat as in-hold capturable only if the options are explicitly at market/FMV (or none remain); two 5-yr options ≈ a decade of control, so that is NOT high in-hold upside (at most residual upside for a future buyer per the tiers above). MATERIALITY GATE (critical): priority must reflect DOLLAR MAGNITUDE relative to the whole property, not just the cleanness of the story. A single small inline tenant — a few thousand $/yr of potential gain, or under ~2-3% of grossPotentialRent — is 'low' regardless of credit or term; 'high' requires the upside to actually move the deal (an anchor, a large SF block, multiple tenants together, or a clearly large $ figure relative to NOI). Do NOT list generic positives already captured in dealScore.strengths. Empty array if no genuine upside items beyond the going-in yield."}],
  "notes": "Substantive investment highlights narrative — write 5-8 sentences covering: (1) what the asset is and why the location matters, (2) anchor tenant quality, sales performance, and lease profile, (3) inline tenant mix and credit quality, (4) key lease metrics (WALT, occupancy, rent PSF vs. market), (5) the primary investment thesis — is this a cash flow play, mark-to-market story, value-add, or development upside, and (6) the most important risk or watch item. Write in the voice of an institutional underwriting memo — specific, data-driven, no generic filler. Reference actual numbers from the OM where available (sales PSF, cap rate, NOI, demographics). Do NOT just restate the property name and tenant list. Wrap the MOST IMPORTANT figures and phrases in **double asterisks** for bold emphasis (key metrics like cap rate, NOI, occupancy, WALT; the lead anchor; the core thesis; the top risk) — bold selectively, a handful per narrative, not whole sentences.",
  "extraFields": {"any_other_notable_metric": "value"},
  "reviewQuestions": [{"severity": "high|medium|low", "field": "human label for the value in question (e.g. 'Total SF', 'NOI', 'Five Below — SF')", "question": "a short plain-English question asking the user to confirm a value you were NOT confident you captured correctly", "detail": "1 sentence: what you read and why it was ambiguous (e.g. conflicting SF figures, an unlabeled column, a handwritten/blurry number, a footnote that might change it)", "suggestedValue": "the value you captured, as a string", "target": {"kind": "deal|tenant", "fieldKey": "the EXACT json field key this value maps to — for kind 'deal' one of: totalSF, noi, capRate, askingPrice, occupancy, walt, grossPotentialRent, weightedAvgRentPSF; for kind 'tenant' one of: sf, rentPerSF, annualRent, leaseStart, leaseExpiry, remainingTermYears, salesPSF", "tenantName": "for kind 'tenant', the exact tenant name as it appears in the tenants array; else null", "valueType": "number|text"}}]
}
DATA-INTEGRITY QUESTIONS (reviewQuestions): This is a DASHBOARD for the user to verify a clean import, not a place to dump everything. Add an item ONLY when you genuinely could not capture a value with confidence from the document — e.g. the OM gives conflicting square footages, the NOI/cap/price don't tie out, a rent-roll column was unlabeled or ambiguous, a key number was blurry/footnoted/asterisked, or two tenants might be the same. Severity: "high" = a core financial/SF figure that drives the analysis; "medium" = a material lease/tenant detail; "low" = a minor field. ALWAYS set "target" so the user can fix the value in one click: kind/fieldKey/tenantName/valueType pointing at the exact field; set target to null ONLY when the question is not about a single editable field (e.g. "two tenants might be duplicates"). Do NOT raise questions for values that are simply ABSENT from the document (those are just null) — only for values you DID capture but are UNSURE about, or genuine internal contradictions. Empty array if the import was clean and unambiguous. Cap at the ~5 most important.

PRIORITIES: Capture all footnotes/assumptions (assumptionNote, keyAssumptions). Capture roof ages. Only fill askingPrice/capRate when explicitly stated. shadowAnchors = null unless OM explicitly marks on-site parcel as NAP/unowned. Tenant roster scope: ONLY include tenants that are actual occupants of THIS property — i.e., they appear in the rent roll, tenant roster, or lease schedule with SF and/or rent data at this address. Exclude any tenant mentioned solely as: a competitor, a shadow anchor or co-tenant at another parcel, a comparable-sale occupant, a "trade area" or "co-tenancy" narrative reference, or market context. The test is: does this tenant have a lease at THIS property? If yes → include. If no → exclude. Tenant deduplication: if the same retailer appears in multiple phases, buildings, or pads (e.g. "TJ Maxx" and "TJ Maxx (West)"), consolidate into ONE tenant row — do NOT append phase/building identifiers in parentheses to the tenant name. Use the combined SF and primary lease terms for the single entry. Vacant spaces: include EACH vacant/availability row as its own tenant entry with name "Vacant", its SF if stated, and null for all lease/rent fields — do NOT merge multiple vacant suites into one row. Dates: always ISO YYYY-MM-DD. rentSchedule: leave null when no rent rate/steps are disclosed — do not just restate the lease-expiry date. creditRating: leave null unless the OM states it or the tenant is a certain national investment-grade credit — never guess (see field note). WALT: ALWAYS compute it yourself from the rent-roll lease-expiry dates (SF-weighted, to today); do NOT copy a WALT figure printed on the cover/marketing pages, which may use a different basis and conflict with the roster. Tenant names: brand only, no store numbers.

LANGUAGE (notes/rationale narration): RENTS DO NOT "TRADE" — properties trade, rents do not; say a rent "is X% below/above" market, never "trades below/above." Reserve "portfolio"/"KPR portfolio" for assets the owner holds; call the broader analyzed dataset "the database." KPR underwrites a 5–7 year hold (max ~10): frame mark-to-market/value-add upside that rolls within ~7 years as in-hold upside KPR captures; upside that rolls ~7–12 years out is residual/exit upside to position for the next buyer (not in-hold); upside locked deeper than that is not upside.

CRITICAL RENT-ROLL LESSONS (from real operator corrections — past extractions failed on these; do NOT repeat):
1. CAPTURE EVERY OCCUPIED LINE — NEVER DROP TENANTS. The tenants array MUST contain one row for EVERY occupied suite on the rent roll, plus one "Vacant" row per available suite. Do not stop partway, do not summarize, do not omit tenants because the roster is long. ANCHORS AND JUNIOR ANCHORS (the largest-SF tenants — grocers, Burlington, Marshalls, banks, etc.) are the MOST important to never omit; a missing 25,000 SF anchor is a severe error. Before finishing, COUNT the occupied suites listed on the rent roll and confirm your tenants array has that many occupied rows; if the rent roll's stated occupied SF or occupancy % does not reconcile with the sum of your tenant SF, you MISSED tenants — go back and add them (largest first).
2. USE THE FULL RENT ROLL, NOT A SUMMARY. The authoritative roster is the detailed in-place rent roll / lease schedule that has SF, current rent, AND lease-start columns. Extract every line from it. Do not build the roster from a cover-page anchor highlight, a "lease options" schedule, or a tenant-sales list alone — those are partial and may list departed tenants.
3. CURRENT EXPIRATION, NOT OPTION-EXTENDED. A pro-forma rent roll's "End"/"Expiration" column often ASSUMES renewal options are exercised (frequently stated in a footnote like "tenants with options assumed to exercise"). leaseExpiry MUST be the CURRENT contractual expiration, NOT the option-extended date. If a tenant's current term ends 2026 but the table shows 2031 because an option is assumed, use 2026 for leaseExpiry and put the option (→2031) in renewalOptions.
4. CURRENT IN-PLACE RENT, NOT OPTION RATE. rentPerSF and annualRent must be the tenant's CURRENT in-place base rent, not a future renewal-option rate. Option-period rates belong only in rentSchedule/renewalOptions.
5. DON'T CARRY DEPARTED TENANTS. Only include tenants on the CURRENT rent roll. A tenant that appears in an older options schedule or a prior-year sales report but is NOT on the current rent roll has left — exclude it (its suite is now vacant or re-leased to someone else).
6. SALES FIGURES — UNITS MATTER (salesPSF is PER SQUARE FOOT). When the OM gives a tenant's TOTAL annual sales (e.g. "Grocer Sales $37.7M", "anecdotal sales of $2.9M"), that is a TOTAL, not a per-SF figure — convert it: salesPSF = total ÷ SF. A $37.7M figure on a 59,678 SF store is ~$632/SF, NOT $37.7/SF. NEVER store a multi-million-dollar total in salesPSF. If the figure is labeled "anecdotal"/"estimated", say so in salesNotes. Only put a number directly in salesPSF when the OM states it per-SF.

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

  // Inject operator-taught extraction rules (admin "Teach the extractor" lessons)
  // so the system applies past corrections to every new OM. Best-effort: never
  // blocks extraction if the lessons table is unavailable.
  const taughtRules = await lessonGuidance("om");
  const first = await callExtract(EXTRACTION_PROMPT + taughtRules + (extraGuidance || "") + "\n\nOM TEXT:\n" + truncatedText);
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

  // Completeness backstop — even if the model stopped cleanly, it may have
  // dropped occupied tenants (this is how a 25,310 SF anchor like Burlington got
  // missed). If the OM states totalSF + occupancy, the captured occupied SF
  // should roughly reconcile; when it's well short, re-prompt for the missing
  // tenants (largest first) until it ties out or stops finding more.
  {
    const totalSF = Number(extracted.totalSF);
    let occPct = Number(extracted.occupancy);
    if (occPct > 0 && occPct <= 1.5) occPct *= 100; // fraction → percent
    let gapRounds = 0;
    while (gapRounds < 3 && totalSF > 0 && occPct > 0 && occPct <= 100) {
      const tenants = extracted.tenants as Array<{ name?: string; sf?: unknown; isNAP?: boolean }>;
      const capturedSF = tenants.reduce((s, t) => {
        const sf = Number(t?.sf);
        return s + (t && !t.isNAP && !isNaN(sf) && sf > 0 ? sf : 0);
      }, 0);
      const expectedOccSF = totalSF * occPct / 100;
      if (capturedSF >= expectedOccSF * 0.9) break; // close enough — likely complete
      gapRounds++;
      const haveNames = tenants.map((t) => t.name).filter(Boolean);
      const gapPrompt =
        `This property has ${Math.round(expectedOccSF).toLocaleString()} SF of OCCUPIED space ` +
        `(${occPct}% of ${totalSF.toLocaleString()} SF), but the tenants captured so far only sum to ` +
        `${Math.round(capturedSF).toLocaleString()} SF — so OCCUPIED TENANTS ARE MISSING, likely one or more large anchors/junior anchors. ` +
        `From the Offering Memorandum text below, extract ONLY the occupied tenants NOT already in this list (largest missing first):\n` +
        haveNames.join(", ") +
        `\n\nSame inclusion rule: actual lease occupants of THIS property only. Return ONLY {"tenants":[...]} with per-tenant schema ` +
        `{name, suite, sf, rentPerSF, annualRent, leaseStart, leaseExpiry, leaseType, rentBumps, rentSchedule, renewalOptions, creditRating, salesPSF, isAnchor, isNAP, isDark, remainingTermYears}. ` +
        `If none remain, return {"tenants":[]}. Output must start with { and end with }.\n\nOM TEXT:\n` + truncatedText;
      try {
        const cont = await callExtract(gapPrompt);
        const contParsed = robustParseJSON(cont.raw) as Record<string, unknown>;
        const newOnes = ((contParsed.tenants as Array<{ name?: string }>) || [])
          .filter((t) => t?.name && !haveNames.includes(t.name));
        if (newOnes.length === 0) break;
        extracted.tenants = (extracted.tenants as unknown[]).concat(newOnes);
      } catch {
        break;
      }
    }
  }

  extracted.tenants = mergePhaseDuplicates(extracted.tenants as Array<Record<string, unknown>>);

  // Occupancy sanity: OMs sometimes express occupancy as a fraction (1.0 = 100%,
  // 0.99 = 99%). A retail center occupancy of "1%" is never real, so a stored
  // value in (0, 1.5] is a fraction → scale to a percent. (1.0 → 100, 0.989 → 98.9)
  {
    const occ = Number(extracted.occupancy);
    if (!isNaN(occ) && occ > 0 && occ <= 1.5) {
      extracted.occupancy = Math.round(occ * 100 * 10) / 10;
    }
  }

  return { data: extracted, tenantsComplete: stopReason !== "max_tokens" };
}

// ── Regenerate the ANALYSIS (summary, grade, strengths/risks, upside, red flags) from the
// CURRENT structured deal data (live roster + financials) — NOT from the stored OM text.
// This is what makes a manual rent-roll update reflect consistently in the narrative without
// re-reading a stale OM. Returns ONLY the analytical fields; never touches tenants.
const ROSTER_ANALYSIS_PROMPT = `You are an expert real estate investment analyst. You are given the CURRENT, verified data for a single retail property — its live tenant roster and key financials. Regenerate ONLY the analytical narrative fields, based STRICTLY on the data provided. Do NOT invent tenants, sales, cap rates, or figures that are not present in the data. If a value is null/absent, do not fabricate it.

Return ONLY a single valid JSON object with EXACTLY these keys and nothing else:
{
  "notes": "5-8 sentence institutional underwriting narrative covering: (1) what the asset is and why the location matters, (2) anchor tenant quality and lease profile, (3) inline tenant mix and credit quality, (4) key lease metrics (WALT, occupancy, rent PSF), (5) the primary investment thesis (cash-flow, mark-to-market, value-add, or development), (6) the most important risk or watch item. Specific and data-driven using the numbers provided; no generic filler; do not just restate the tenant list. Wrap the MOST IMPORTANT figures and phrases in **double asterisks** for bold emphasis (key metrics, lead anchor, core thesis, top risk) — selectively, a handful per narrative.",
  "dealScore": {"grade":"A+|A|B+|B|C+|C|D","rationale":"one precise sentence grounded in the data, with the key driver(s) in **double asterisks** for bold emphasis","strengths":["string"],"risks":["string"]},
  "upsideItems": [{"priority":"high|medium|low","item":"short label","detail":"1-2 sentences; empty array if none beyond going-in yield"}],
  "redFlags": [{"severity":"high|medium|low","description":"string; reflect near-term lease expirations or vacancy evident in the data"}]
}

LANGUAGE — when comparing rents, RENTS DO NOT "TRADE." Properties trade; rents do not. Never write that a rent "trades" above/below a benchmark — say it "IS X% below/above" (e.g. "$15.00/SF is 24% below the $19.83/SF average across 15 comparable leases"). Also reserve "portfolio"/"KPR portfolio" for assets KPR OWNS; call the full analyzed dataset "the database."

BELOW-MARKET RENT — judge it correctly, do not treat it as automatically good or bad:
- KPR underwrites a 5–7 YEAR HOLD (max ~10). Judge below-market rent by WHEN it becomes capturable, on three tiers:
  • IN-HOLD (rollover within ~7 years) → upside KPR captures directly. This is the strongest case and can be "high" (subject to the other gates below).
  • JUST AFTER HOLD (rollover ~7–12 years out) → KPR won't capture it, but it's real RESIDUAL / EXIT UPSIDE we can position for the NEXT buyer as part of the sale story. Score it "low" (occasionally "medium" if large/anchor) and FRAME it that way — "embedded mark-to-market for a future owner at the ~YYYY rollover," not in-hold upside.
  • DEEP BEYOND (rollover/options keep it locked well past ~12 years) → not upside at all; at most note the rent is locked in.
- Below-market rent is real IN-HOLD MARK-TO-MARKET UPSIDE when the landlord can capture it during the 5–7 year hold. The strongest case (priority "high") is a tenant that is BELOW market AND has LITTLE LEASE TERM REMAINING (low remainingTermYears / near-term leaseExpiry) AND few or no remaining fixed-rate renewal options (renewalOptions) AND demonstrates it can pay more — STRONG sales (salesPSF) with a LOW occupancyCost %. That tenant can be marked to market at rollover.
- RENEWAL OPTIONS GATE: remaining renewal options put control in the TENANT'S hands — they will exercise only if the option rent is at/below market. So if a below-market tenant holds remaining options at fixed or unspecified (assume non-market) rents, you generally CANNOT mark it to market during the hold; apply the timing tiers above (if the latest option pushes the realistic rollover ~7–12 years out, treat it as residual/exit upside for the next buyer, not in-hold upside). Two 5-year options ≈ ~10 years of tenant-controlled occupancy. Below-market rent is in-hold capturable despite options ONLY if the OM states the options reset to market/FMV. Near-term expiry does NOT override unexercised options.
- DISCOUNT the upside when the tenant has many years of term left, OR has remaining options at fixed/below-market rents — you would not reach market during the hold, so it is not in-hold upside. Where the rollover lands ~7–12 years out, position it as exit/residual upside for the next buyer ("low"); where it is locked deeper than that, it is locked in, not upside.
- MATERIALITY GATE (critical): priority must reflect DOLLAR MAGNITUDE relative to the whole property, not just how clean the story is. The gain from one small inline space (a few thousand $/yr, or under ~2-3% of total in-place rent) is "low" no matter how strong the tenant's credit or how short its term. Reserve "high" for upside that actually moves the deal — an anchor, a large SF block, several tenants in aggregate, or a clearly large $ figure relative to NOI. A 1,000–1,500 SF tenant marked up a couple $/SF is never "high".
- Below-market rent can also be a WARNING, not upside: if sales are weak or occupancyCost is already high, the low rent may reflect a struggling tenant or a soft market, and pushing rent at renewal risks losing them. Frame it as a risk in that case.
- If sales/occupancy-cost data is absent, stay measured: note the below-market rent as a POSSIBLE mark-to-market opportunity contingent on lease term/options and sales, rather than asserting upside.

KPR THESIS (the "kprThesis" field, if present): this is the KPR acquisitions team's own stated thesis / assumptions for the deal — why they like it, what they're underwriting to, risks they're discounting. Treat it as INFORMED INTERNAL CONTEXT and weave it into the narrative, strengths, and risks — but stay OBJECTIVE and ADVISORY: you may agree, add nuance, or PUSH BACK where the roster/financials don't support a claim. If a thesis point is contradicted by the data, say so plainly (e.g. as a risk or caveat) rather than parroting it. Do NOT let an optimistic thesis inflate the grade beyond what the numbers justify. If kprThesis is absent, ignore this.

Base everything on the CURRENT roster below (note tenantsAsOf — this roster supersedes any older OM). Output must start with { and end with }.

CURRENT PROPERTY DATA (JSON):
`;

export async function runRosterAnalysis(dealData: Record<string, unknown>): Promise<Record<string, unknown>> {
  const t = Array.isArray(dealData.tenants) ? (dealData.tenants as Array<Record<string, unknown>>) : [];
  const thesis = typeof dealData.dealThesis === "string" ? dealData.dealThesis.trim() : "";
  const snapshot = {
    propertyName: dealData.propertyName, address: dealData.address, city: dealData.city, state: dealData.state,
    assetType: dealData.assetType, centerType: dealData.centerType,
    totalSF: dealData.totalSF, occupancy: dealData.occupancy, walt: dealData.walt,
    askingPrice: dealData.askingPrice, capRate: dealData.capRate, noi: dealData.noi,
    weightedAvgRentPSF: dealData.weightedAvgRentPSF, grossPotentialRent: dealData.grossPotentialRent,
    tenantsAsOf: dealData.tenantsAsOf, tenantsSource: dealData.tenantsSource,
    marketDemographics: dealData.marketDemographics ?? null,
    kprThesis: thesis || undefined,
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

// Deterministic SF-weighted WALT from the extracted roster — mirrors the
// LeaseRollover "WALT (by SF)" calc so the stored number matches what the deal
// page shows. Models sometimes copy a cover-page WALT computed on a different
// basis (rent-weighted, or to a future close date), so recompute from the rent
// roll's lease-expiry dates. Returns null when no parseable expiries exist
// (then we keep whatever the model gave).
function computeWaltFromRoster(tenants: unknown, asOf: unknown): number | null {
  if (!Array.isArray(tenants)) return null;
  const ref = typeof asOf === "string" && !isNaN(new Date(asOf).getTime()) ? new Date(asOf) : new Date();
  const isVacant = (n: unknown) => {
    const s = String(n ?? "").trim().toLowerCase();
    return !s || s === "-" || /^(vacant|available|spec|white\s*box)\b/.test(s);
  };
  let num = 0, den = 0;
  for (const t of tenants as Array<Record<string, unknown>>) {
    if (isVacant(t.name)) continue;
    const iso = parseLeaseDate(t.leaseExpiry);
    const sf = Number(t.sf);
    if (!iso || !sf || isNaN(sf) || sf <= 0) continue;
    const exp = new Date(iso + "T00:00:00Z");
    if (isNaN(exp.getTime())) continue;
    const years = Math.max(0, (exp.getTime() - ref.getTime()) / (365.25 * 86_400_000));
    num += sf * years; den += sf;
  }
  return den > 0 ? Math.round((num / den) * 10) / 10 : null;
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
    const computedWalt = computeWaltFromRoster(
      (augmented as Record<string, unknown>).tenants,
      (augmented as Record<string, unknown>).tenantsAsOf,
    );
    const dealData: Record<string, unknown> = {
      ...augmented,
      // Trust the roster-derived WALT over the model's (avoids copied cover figures).
      ...(computedWalt != null ? { walt: computedWalt } : {}),
      _processing: false,
      fileName,
      uploadedAt: new Date().toISOString(),
      status: "Prospect",
      pdfPages: pageCount,
      lastScoredAt: new Date().toISOString(),
      lastScoredDealCount: totalCount,
      analysisVersion: ANALYSIS_VERSION,
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
