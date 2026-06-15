// Shared Anthropic extraction logic — used by both the ai route and the ingest route
import type { Logger } from "pino";
import { db, dealsTable, pool, leaseAbstractsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { rebuildTenantIndex, parseLeaseDate } from "./tenantIndex";
import { augmentScoringWithBenchmarks, getTotalDealCount } from "./tenantBenchmarks";
import { ANALYSIS_VERSION } from "./analysisVersion";
import { lessonGuidance } from "./extractionLessons";
import { runLeaseRiskPass, enforceRosterCotenancyRule, validateLeaseRiskAtExtraction, summarizeLeaseRisk } from "./leaseRiskExtract";
import { getHouseView, saveHouseView, incrementPendingReviews } from "./houseView";
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
  "zip": "5-digit ZIP code (or ZIP+4) or null — from the property address",
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
  "currentAssessedValue": "number or null — the property's CURRENT total ASSESSED (or taxable) value from the OM's real-estate-tax overview / parcel table. This is the assessor's value the BILL is computed on, NOT the market value and NOT the asking price. In Michigan use the TAXABLE value; elsewhere the total assessed value. If the OM lists multiple parcels, this MUST be the SUM of ALL parcels (also fill taxParcels[] below so the sum can be verified).",
  "currentMarketValue": "number or null — the assessor's total MARKET / full / appraised value when the OM states it SEPARATELY from assessed value (many tables show Market, Assessed, and Taxable columns — capture all three). Sum across parcels. Null if the OM only gives one value. Do NOT copy the asking price here.",
  "currentAnnualTaxes": "number or null — the property's CURRENT total annual real-estate TAXES actually billed, from the OM's tax overview / parcel table (SUM of ALL parcels, most recent year). NOT a pro-forma/underwritten tax figure.",
  "assessmentYear": "number or null — the tax year the currentAssessedValue / currentAnnualTaxes are from (e.g. 2025).",
  "taxParcels": "array — ONE entry per parcel/line in the OM's real-estate-tax / parcel table (empty array if the OM gives only a single combined figure or no tax detail). This exists so the totals can be reconciled — capture EVERY parcel row, including small outlots, never just the largest 'Main' parcel. Each: {\"parcelId\":\"the APN / parcel number string or null\",\"label\":\"short label e.g. 'Main','Panera outlot','Ulta' or null\",\"assessedValue\":number or null,\"marketValue\":number or null,\"annualTaxes\":number or null,\"year\":number or null}. Do NOT include a grand-total/'Total' row as a parcel — that goes in currentAssessedValue/currentAnnualTaxes.",
  "taxAbatement": "object or null — set only if the OM discloses a tax abatement, PILOT (payment in lieu of taxes), TIF, Enterprise/Opportunity Zone, or similar break on THIS property's CURRENT taxes: {\"present\":true,\"type\":\"abatement|PILOT|TIF|enterprise zone|other\",\"note\":\"short description\",\"expiry\":\"ISO date or year or null\"}. Null if none disclosed.",
  "specialAssessments": "string or null — any NON-ad-valorem special-assessment / special-district charges on the tax bill (CDD, Mello-Roos, Business Improvement District, lighting/fire/drainage district, PACE) that the OM discloses. These don't reassess like ad-valorem taxes. Null if none.",
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
      "reimbursementMethod": "string or null — the FULL recovery / expense-reimbursement structure the OM discloses, captured COMPACTLY in one line from the detailed rent roll's 'Recovery Type/Method' + 'Comments/Encumbrances' columns. Include, when stated: the recovery type (NNN/Net, Gross, Modified Gross, Base Year, or a split/Fixed structure); any CAM CAP and its basis (e.g. 'CAM cap 5% non-cumulative'); the ADMIN FEE (e.g. 'admin fee 10% of CAM'); whether the MANAGEMENT FEE is included in or excluded from CAM; any GROSS-UP %; and any FIXED-CAM amount/escalator (e.g. 'Fixed CAM $2.00/SF +2%/yr'). Example: 'NNN; CAM cap 5% non-cumulative; admin fee 10% of CAM; mgmt fee in CAM'. Do NOT collapse this to bare 'Net'/'NNN' when the OM actually discloses caps/fees — that detail drives the expense-recovery risk read.",
      "camCapPct": "number or null — the annual cap on (controllable) CAM growth as a percent (e.g. 5 for '5% per year'), when disclosed.",
      "camCapBasis": "cumulative|non-cumulative|null — the CAM cap basis when disclosed.",
      "adminFeePct": "number or null — administrative fee as a percent of CAM, when disclosed (e.g. 10, 15).",
      "mgmtFeeInCam": "true|false|null — true if the OM states the management fee is INCLUDED in CAM, false if EXCLUDED, null if not stated.",
      "grossUpPct": "number or null — CAM gross-up percent when disclosed (e.g. 80, 95).",
      "recoverySF": "number or null — the square footage used to BILL recoveries when the OM states it DIFFERS from the tenant's leased sf (e.g. 'occupies 2,593 SF; reimbursements calculated off 2,800 SF' → 2800). Null when recoveries are billed on the leased sf.",
      "percentOfNOI": "number or null",
      "rentBumps": "string — summarize pattern, e.g. '3%/yr'",
      "rentSchedule": "string — REQUIRED for every tenant. ONLY clean dated rent steps with amounts e.g. '2024-09-01: $13.50 PSF ($345,384/yr); 2029-09-01: $15.50 PSF ($396,552/yr)', or 'Flat at $XX.XX PSF through YYYY-MM-DD.' if flat. NEVER write prose, explanations, or renewal narratives here (e.g. do NOT write 'Walmart recently executed a 10-year renewal…') — any such explanation belongs in assumptionNote or recentlyExercisedRenewal. This field feeds a compact Rent-Steps column, so keep it to dates + amounts only. Never leave null.",
      "renewalOptions": "string or null",
      "recentlyExercisedRenewal": "string or null",
      "recentRenewalSpreadPct": "number or null — the rent SPREAD (percent increase) achieved on this tenant's MOST RECENT renewal/extension when the OM discloses it (e.g. 'Old Navy recently agreed to a 10-year extension at 21% increase' → 21; 'Michaels exercised its option at a 22% increase' → 22; 'Jimmy John's extended at 17%' → 17). Positive = pricing power / prior rent was below market. Null if no recent renewal or no stated increase.",
      "percentageRentClause": "string or null — text describing the percentage rent clause (e.g. '7% of gross sales above $500/SF natural breakpoint'). Null if no clause.",
      "percentageRentRate": "number or null — the percentage-rent RATE as a percent (e.g. 6 for '6% of gross sales over breakpoint'), when disclosed.",
      "percentageRentBreakpoint": "number or null — the ANNUAL sales BREAKPOINT in dollars above which percentage rent is owed (e.g. 2016000 for 'over $2,016,000'). When the OM gives multiple period breakpoints, use the CURRENT one. Null if natural-only with no stated amount.",
      "percentageRentBreakpointType": "natural|fixed|null — 'natural' = breakpoint = base rent ÷ rate (computed); 'fixed' = a stated fixed dollar breakpoint; null if not disclosed.",
      "expenseReimbursements": "number or null — Populate ONLY when the OM explicitly discloses the annual CAM + real-estate-tax + insurance recoveries paid by this specific tenant in dollars. Never estimate, derive, or guess. If not disclosed, leave null.",
      "percentageRent": "number or null — Populate ONLY when the OM explicitly discloses the annual overage/percentage rent paid by this tenant in dollars. Never estimate. If not disclosed, leave null.",
      "otherRent": "number or null — Populate ONLY when the OM explicitly discloses annual marketing/promo fund, storage, specialty, or other rent paid by this tenant in dollars. Never estimate. If not disclosed, leave null.",
      "creditRating": "Investment Grade | Non-Investment Grade | null — Set this ONLY when the OM explicitly states a credit rating for the tenant, OR the tenant is a national credit you are CERTAIN is investment-grade (e.g. Target, Walmart, Costco, Home Depot, Lowe's, TJX/TJ Maxx/Marshalls, Ross, CVS, Walgreens, Kroger, Publix, McDonald's, Starbucks, Chick-fil-A, Verizon, AT&T, a money-center bank). Otherwise DEFAULT TO null. Do NOT infer 'Investment Grade' for private, PE-owned, franchised, regional, or local operators, and do NOT label junk/non-rated retailers as Investment Grade (e.g. Gap/Old Navy, Burlington, Michaels, Barnes & Noble, At Home, Lane Bryant, Famous Footwear, Destination XL, most restaurants and franchises). When unsure, use null — never guess a rating.",
      "salesPSF": "number or null",
      "salesYear": "number or null — the calendar year the salesPSF figure is from (e.g. 2024). Infer from context ('2024 sales', 'trailing 12 months ending Dec-2024', etc.).",
      "priorSalesPSF": "number or null — the tenant's PRIOR-year sales PER SQUARE FOOT, when the OM's tenant-sales table prints TWO years (e.g. columns '2024 Sales' and '2025 Sales'). Same per-SF basis as salesPSF (convert a total ÷ SF). Leave null if only one year is shown. salesPSF must remain the MOST RECENT year.",
      "priorSalesYear": "number or null — the calendar year priorSalesPSF is from (e.g. 2024 when salesYear is 2025).",
      "salesNotes": "string or null",
      "occupancyCost": "number or null — TOTAL occupancy cost as a percentage of gross sales, defined as (base rent + expense reimbursements/CAM+taxes+insurance + percentage rent + other rent) ÷ gross sales. Often labeled 'Occ Cost %', 'OC%', or 'Occupancy Cost'. Use the OM's stated total occ-cost % when given. If the OM only states base rent ÷ sales (not the full health ratio), note that in salesNotes instead and leave this null.",
      "assumptionNote": "string or null — any footnote/assumption for this tenant",
      "isAnchor": "true|false",
      "isNAP": "true if this tenant is on an adjacent parcel NOT part of this sale/ownership (marked NAP, Not A Part, or outparcel on the site plan). false or null otherwise. IMPORTANT: a signed inline tenant whose rent has NOT yet commenced (future rent-commencement / lease-start date, $0 or blank current rent, in build-out/free-rent) is a REAL tenant, NOT NAP — set isNAP false, set leaseStart to the commencement date, and capture their contractual base rent (not $0).",
      "isDark": "true if this tenant is a 'dark' store — they still hold the lease and are paying rent, but the store is closed / no longer operating (look for words like 'dark', 'closed but paying', 'gone dark', 'not operating', 'vacated but obligated', 'lease in place, store closed'). false or null otherwise. Do NOT mark a unit dark just because it is vacant with no tenant — dark specifically means a paying tenant whose store is closed.",
      "leaseStatus": "executed|signed-not-open|loi|proposed|null — the EXECUTION status of the lease the OM is underwriting for this tenant. Default 'executed' for a normal in-place rent-roll tenant. Use 'signed-not-open' when the lease is signed but the store has NOT opened / rent has not commenced (e.g. 'signed not open', in build-out, future rent-commencement date). Use 'loi' when the deal is only a Letter of Intent, and 'proposed' when it is a proposed / under-negotiation / spec deal that is NOT yet executed but the OM models it in place (look for 'LOI', 'proposed', 'under negotiation', 'JLL assumes [tenant] is in place at start of analysis', or a footnote that the lease is not yet signed). These NON-executed tenants overstate NOI until signed, so flag them here — do NOT silently treat them as executed.",
      "originalLeaseDate": "string or null",
      "remainingTermYears": "number or null"
    }
  ],
  "cashFlowProjection": [{"label": "string", "noi": "number or null", "egr": "number or null", "totalBaseRent": "number or null", "reimbursements": "number or null", "operatingExpenses": "number or null", "netCashFlow": "number or null"}],
  "incomeBreakdown": {"anchorBaseRent": "number or null", "shopBaseRent": "number or null", "camReimbursements": "number or null", "realEstateTaxReimbursements": "number or null", "insuranceReimbursements": "number or null", "percentageRentIncome": "number or null", "vacancyLoss": "number or null"},
  "expenseBreakdown": {"commonAreaExpenses": "number or null", "realEstateTax": "number or null", "insurance": "number or null", "managementFee": "number or null"},
  "otherIncome": "array of center-level NON-RENT income lines the OM discloses BEYOND base rent and expense recoveries — empty array if none. Each: {\"source\":\"short label e.g. 'Bath & Body storage license', 'EVgo charging', 'parking lot'\", \"type\":\"utility-resale|ev-charging|parking|storage|license|marketing|specialty|other\", \"annualAmount\":number or null, \"isMargin\":true|false — true ONLY for spread/margin income that is not durable contractual rent (e.g. the landlord buying wholesale electricity and reselling to tenants at retail — a recurring margin), false for normal license/parking/storage rent, \"note\":\"string or null\"}. Capture things like: utility / electricity resale arbitrage margins, EV-charging-station licenses, parking income, storage or antenna/rooftop licenses, marketing/promo funds kept by the landlord, and specialty/temporary-tenant income. Do NOT include base rent, percentage rent, or CAM/tax/insurance recoveries here.",
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
7. leaseType is the REIMBURSEMENT / LEASE STRUCTURE (NNN, Gross, Modified Gross, NN, Base Year) — NOT a renewal-option type. NEVER put option codes like "AUT" (automatic) or "REN" (renewal) in leaseType; that detail belongs in renewalOptions, or omit it. Leave leaseType null if the structure isn't stated. Always capture each tenant's suite/unit id when present (the value in the leftmost "Suite"/"Suite/Space"/"Unit" column, separate from the tenant name) — it's the key used to match tenants across documents. CAPTURE IT EVEN WHEN PURELY NUMERIC: "38", "1", a zero-padded code like "00002"/"00011", or a range "23-24"/"19N20". A leading number before the tenant name on a rent-roll row IS the suite, NOT a row number — put it in the suite field (you may strip leading zeros), and never fold it into the tenant name.
8. rentSchedule = ONLY dates + amounts (or "Flat at $X PSF through YYYY-MM-DD"). NEVER put renewal narratives or commentary in rentSchedule — put those in assumptionNote / recentlyExercisedRenewal. EXECUTED RENEWAL: when the OM says a tenant has already EXECUTED/exercised a renewal extending its term (e.g. "Walmart executed a 10-year renewal through Jan 2037"), set leaseExpiry to that NEW later date (2037-01-18) and record the detail in recentlyExercisedRenewal — do NOT leave leaseExpiry at the pre-renewal date. An UNEXERCISED option, by contrast, stays in renewalOptions and does not change leaseExpiry.
9. ATM vs BANK BRANCH: a standalone ATM (e.g. "Chase Bank ATM", "Bank of America ATM") is NOT a bank branch — it's a tiny kiosk/license, usually 0 or under ~200 SF. KEEP the word "ATM" in the name, list it as its OWN tenant row, and NEVER merge it into the bank's branch lease or vice-versa. It is not an anchor. (It belongs to the same parent company as the branch — that rollup is handled downstream.)
10. "ANNUAL RENT INCREASE" vs "ANNUAL OPTION RENT" COLUMNS (CRITICAL — these are two DIFFERENT column groups, never conflate them). A rent roll with a "Term Comm. Date" / "Term Exp. Date" pair plus an "Annual Rent Increase" column group (Date / Amount / Incr-PSF) and a SEPARATE "Annual Option Rent" group (Date / Amount / Incr-PSF) is showing two different things, and THE LEASE EXPIRATION DATE IS THE DIVIDER. "Annual Rent Increase" = CONTRACTUAL fixed rent steps DURING the current term → rentSchedule (the tell: these dates fall BEFORE the Term Exp. Date; the "Incr/SF" column is the new $/SF, the "Amount" column the new annual base — emit each future-dated one as "YYYY-MM-DD: $<Incr/SF> PSF"). "Annual Option Rent" = renewal-OPTION period rents → renewalOptions ONLY (these dates fall AT/AFTER the Term Exp. Date). NEVER put the contractual increases in renewalOptions, and NEVER leave rentSchedule empty when an Annual Rent Increase schedule is present.

11. CAPTURE THE RECOVERY COLUMN IN FULL — DON'T REDUCE IT TO "NET". The detailed rent roll's "Recovery Type/Method" + "Comments/Encumbrances" columns disclose the EXPENSE-RECOVERY STRUCTURE per tenant, and it materially affects NOI durability: a CAM cap (e.g. "5% per year non-cumulative") limits how much expense growth the landlord recovers; a FIXED CAM (e.g. Burlington "$2.00/SF +2%/yr", Kohl's "$0.83/SF +3%/yr") means the landlord — not the tenant — bears CAM growth above the escalator; an admin fee % and management-fee-in/out-of-CAM change effective recovery. Put the full structure in reimbursementMethod (compact, one line) AND populate camCapPct/camCapBasis/adminFeePct/mgmtFeeInCam/grossUpPct/recoverySF when the OM states them. A tenant whose roll says "Net — CAM cap 5% non-cumulative; admin fee 10%" must NOT be stored as just "Net". When the billing SF differs from the leased SF (e.g. "occupies 2,593 SF; reimbursements off 2,800 SF"), set recoverySF.

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

export { robustParseJSON } from "./jsonRepair";
import { robustParseJSON } from "./jsonRepair";

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
    // Recompute the blended rent PSF off the combined SF + base rent, so the
    // merged row stays internally consistent (a single phase's PSF no longer
    // contradicts the summed SF/rent: rentPerSF × sf == annualRent).
    if (sumSF != null && sumSF > 0 && sumRent != null) result.rentPerSF = Math.round((sumRent / sumSF) * 100) / 100;
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
export async function runOmExtraction(text: string, extraGuidance = ""): Promise<{ data: Record<string, unknown>; tenantsComplete: boolean; timings: { totalMs: number; firstPassMs: number; continuationRounds: number; continuationMs: number; gapFillRounds: number; gapFillMs: number; leaseRiskMs: number; tenantCount: number; budgetHit: boolean } }> {
  const truncatedText = text.length > 180000
    ? text.slice(0, 120000) + "\n...[middle truncated]...\n" + text.slice(-40000)
    : text;

  // OM extraction is the hardest, highest-stakes pass — use the stronger Sonnet
  // model for materially fewer misreads on complex rent rolls / financials. The
  // lighter rent-roll and sales passes stay on Haiku.
  type Block = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
  // First pass + the anchor-finding gap-fill use Sonnet (accuracy); the overflow
  // "continuation" passes on very long rosters use the faster Haiku model.
  const FAST_MODEL = "claude-haiku-4-5-20251001";
  const callExtract = async (content: string | Block[], model = "claude-sonnet-4-6") => {
    const upstream = await callAnthropicOnce({
      model,
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
  // KPR House View — the team's distilled underwriting lens, applied to the grade/
  // narrative so new uploads are reviewed the way KPR thinks.
  const houseView = await loadHouseViewText();
  const houseBlock = houseView
    ? `\n\nKPR HOUSE VIEW (apply this lens to dealScore, strengths, risks, redFlags, upsideItems and notes — weigh it but stay grounded in THIS OM's data):\n${houseView}\n`
    : "";
  // Prompt caching: the large static EXTRACTION_PROMPT is byte-identical on every
  // OM, so mark it as a cached block. Across a batch of deals (within the cache
  // window) the schema/instructions prefix is a cache hit — cheaper + faster on
  // the Sonnet pass. The variable part (lessons + this OM's text) is uncached.
  // Shared, byte-identical prefix for EVERY pass on this OM: the schema prompt
  // and the OM text are both cached. Continuation/gap passes append only a small
  // trailing instruction, so they reuse the cached document instead of re-reading
  // the whole thing each round — the main cause of slow multi-pass extractions.
  const cachedBlocks: Block[] = [
    { type: "text", text: EXTRACTION_PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: taughtRules + houseBlock + (extraGuidance || "") + "\n\nOM TEXT:\n" + truncatedText, cache_control: { type: "ephemeral" } },
  ];
  // Per-phase timing (measurement only — does not change extraction behavior).
  const _extractStart = Date.now();
  let firstPassMs = 0, continuationMs = 0, gapFillMs = 0, gapRoundsTotal = 0;
  const _fpStart = Date.now();
  let first = await callExtract(cachedBlocks);
  firstPassMs = Date.now() - _fpStart;
  // The first pass must return valid JSON. On a very large/dense OM the model can
  // truncate or wrap its output so the parser (and its repair) can't recover it.
  // Retry the first pass once; if it still won't parse, fail with a plain-English
  // message instead of the cryptic "All parse strategies failed".
  let extracted: Record<string, unknown>;
  try {
    extracted = robustParseJSON(first.raw) as Record<string, unknown>;
  } catch {
    const _fpRetry = Date.now();
    first = await callExtract(cachedBlocks);
    firstPassMs += Date.now() - _fpRetry;
    try {
      extracted = robustParseJSON(first.raw) as Record<string, unknown>;
    } catch {
      throw new Error("The AI read this OM but returned its answer in a form we couldn't process (the response came back incomplete or not as structured data — this usually happens on very large, image-heavy, or scanned OMs). Try re-uploading it; if it keeps failing, the OM likely needs to be split into smaller files or saved as a text-based PDF.");
    }
  }
  if (!extracted.tenants) extracted.tenants = [];

  // Hard budget so a problematic OM can never churn the model indefinitely and
  // burn tokens. Once we pass the deadline, we stop the follow-up passes and
  // return whatever we've captured (flagged incomplete) instead of looping.
  // Progress-based budget: keep going while the model is still pulling NEW tenants;
  // stop only if it STALLS (no new tenants for STALL_MS — wheel-spinning that just
  // burns tokens) or hits an absolute backstop (anti-runaway). A big-but-advancing
  // OM is therefore never cut off mid-progress; only a stuck one is.
  const STALL_MS = 2 * 60 * 1000;                         // ≥2 min with no new tenants → stuck
  const ABS_DEADLINE = Date.now() + 20 * 60 * 1000;       // hard ceiling, rarely reached
  let lastProgressAt = Date.now();
  const overBudget = () => Date.now() > ABS_DEADLINE || (Date.now() - lastProgressAt) > STALL_MS;
  let budgetHit = false;

  let stopReason = first.stopReason;
  let rounds = 0;
  while (stopReason === "max_tokens" && rounds < 20) {
    if (overBudget()) { budgetHit = true; break; }
    rounds++;
    const tenants = extracted.tenants as Array<{ name?: string }>;
    const haveNames = tenants.map((t) => t.name).filter(Boolean);
    const contInstruction =
      "From the Offering Memorandum text above, extract ONLY the tenants NOT already in this list:\n" +
      haveNames.join(", ") +
      "\n\nINCLUSION RULE: Only include tenants that are actual occupants of THIS property — they must appear in the rent roll, tenant roster, or lease schedule with SF and/or rent data at this address. Do NOT include tenants mentioned as competitors, shadow anchors at other parcels, comparable-sale occupants, or trade-area/co-tenancy narrative references. The test: does this tenant have a lease at THIS property?\n\n" +
      "Return ONLY a JSON object: {\"tenants\":[...]} using this schema per tenant: " +
      "{name, suite, sf, rentPerSF, annualRent, leaseStart, leaseExpiry, leaseType, reimbursementMethod, camCapPct, camCapBasis, adminFeePct, mgmtFeeInCam, grossUpPct, recoverySF, rentBumps, rentSchedule, renewalOptions, recentlyExercisedRenewal, recentRenewalSpreadPct, percentageRentClause, percentageRentRate, percentageRentBreakpoint, percentageRentBreakpointType, expenseReimbursements, percentageRent, otherRent, creditRating, salesPSF, salesYear, priorSalesPSF, priorSalesYear, isAnchor, isDark, leaseStatus, remainingTermYears}. " +
      "If there are no more tenants, return {\"tenants\":[]}. Output must start with { and end with }.";
    try {
      const _cStart = Date.now();
      const cont = await callExtract([...cachedBlocks, { type: "text", text: contInstruction }], FAST_MODEL);
      continuationMs += Date.now() - _cStart;
      const contParsed = robustParseJSON(cont.raw) as Record<string, unknown>;
      const newOnes = ((contParsed.tenants as Array<{ name?: string }>) || [])
        .filter((t) => t?.name && !haveNames.includes(t.name));
      if (newOnes.length === 0) break;
      extracted.tenants = (extracted.tenants as unknown[]).concat(newOnes);
      lastProgressAt = Date.now();   // captured new tenants → still progressing
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
    while (gapRounds < 5 && totalSF > 0 && occPct > 0 && occPct <= 100) {
      if (overBudget()) { budgetHit = true; break; }
      const tenants = extracted.tenants as Array<{ name?: string; sf?: unknown; isNAP?: boolean }>;
      const capturedSF = tenants.reduce((s, t) => {
        const sf = Number(t?.sf);
        const vacant = /vacant|available/i.test(String(t?.name || ""));
        return s + (t && !t.isNAP && !vacant && !isNaN(sf) && sf > 0 ? sf : 0);
      }, 0);
      const expectedOccSF = totalSF * occPct / 100;
      if (capturedSF >= expectedOccSF * 0.9) break; // close enough — likely complete
      gapRounds++;
      const haveNames = tenants.map((t) => t.name).filter(Boolean);
      const gapInstruction =
        `This property has ${Math.round(expectedOccSF).toLocaleString()} SF of OCCUPIED space ` +
        `(${occPct}% of ${totalSF.toLocaleString()} SF), but the tenants captured so far only sum to ` +
        `${Math.round(capturedSF).toLocaleString()} SF — so OCCUPIED TENANTS ARE MISSING, likely one or more large anchors/junior anchors. ` +
        `From the Offering Memorandum text above, extract ONLY the occupied tenants NOT already in this list (largest missing first):\n` +
        haveNames.join(", ") +
        `\n\nSame inclusion rule: actual lease occupants of THIS property only. Return ONLY {"tenants":[...]} with per-tenant schema ` +
        `{name, suite, sf, rentPerSF, annualRent, leaseStart, leaseExpiry, leaseType, reimbursementMethod, camCapPct, camCapBasis, adminFeePct, mgmtFeeInCam, grossUpPct, recoverySF, rentBumps, rentSchedule, renewalOptions, recentRenewalSpreadPct, creditRating, salesPSF, salesYear, priorSalesPSF, priorSalesYear, isAnchor, isNAP, isDark, leaseStatus, remainingTermYears}. ` +
        `If none remain, return {"tenants":[]}. Output must start with { and end with }.`;
      try {
        const _gStart = Date.now();
        const cont = await callExtract([...cachedBlocks, { type: "text", text: gapInstruction }]);
        gapFillMs += Date.now() - _gStart;
        const contParsed = robustParseJSON(cont.raw) as Record<string, unknown>;
        const newOnes = ((contParsed.tenants as Array<{ name?: string }>) || [])
          .filter((t) => t?.name && !haveNames.includes(t.name));
        if (newOnes.length === 0) break;
        extracted.tenants = (extracted.tenants as unknown[]).concat(newOnes);
        lastProgressAt = Date.now();   // found missing tenants → still progressing
      } catch {
        break;
      }
    }
    gapRoundsTotal = gapRounds;
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

  // DEDICATED LEASE-RISK PASS — a separate, focused model call (reusing the cached
  // OM blocks) so a long rent roll truncating the main pass can never drop the
  // co-tenancy / kickout data. Best-effort; normalised to source:"OM"/unverified.
  // Skipped if we already blew the time budget.
  let leaseRiskMs = 0;
  if (!budgetHit && !overBudget()) {
    const _lrStart = Date.now();
    const names = (extracted.tenants as Array<{ name?: unknown }>).map((t) => String(t?.name ?? "")).filter(Boolean);
    const leaseRisk = await runLeaseRiskPass({ callExtract, cachedBlocks, tenantNames: names, parse: robustParseJSON });
    leaseRiskMs = Date.now() - _lrStart;
    if (leaseRisk) {
      extracted.leaseRisk = leaseRisk;
      // Backstop the roster rule: drop any anchor name that leaked into tenants[]
      // only because a co-tenancy clause referenced it.
      const guard = enforceRosterCotenancyRule(extracted.tenants as Array<Record<string, unknown>>, leaseRisk);
      extracted.tenants = guard.tenants;
    }
  }

  // If we stopped at the time budget, flag it loudly: log it and leave a review
  // question so the roster is reviewed rather than silently trusted as complete.
  if (budgetHit) {
    const n = Array.isArray(extracted.tenants) ? (extracted.tenants as unknown[]).length : 0;
    const rq = Array.isArray(extracted.reviewQuestions) ? extracted.reviewQuestions as unknown[] : [];
    rq.push({
      id: "ai-budget-stop", source: "ai", severity: "high",
      field: "Tenant roster completeness",
      question: `Extraction hit its time budget after capturing ${n} tenants — the roster may be incomplete. Review against the rent roll and re-run if tenants are missing.`,
      detail: "The OM took unusually long to read (large/complex document); processing was capped to avoid runaway token cost.",
      suggestedValue: null, target: null,
    });
    extracted.reviewQuestions = rq;
  }

  const tenantCount = Array.isArray(extracted.tenants) ? (extracted.tenants as unknown[]).length : 0;
  const timings = {
    totalMs: Date.now() - _extractStart,
    firstPassMs,
    continuationRounds: rounds,
    continuationMs,
    gapFillRounds: gapRoundsTotal,
    gapFillMs,
    leaseRiskMs,
    tenantCount,
    budgetHit,
  };
  return { data: extracted, tenantsComplete: stopReason !== "max_tokens" && !budgetHit, timings };
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

KPR HOUSE VIEW (the "houseView" field, if present): this is the KPR team's distilled, cross-deal underwriting philosophy — what they consistently reward and penalize, their cap-rate expectations by product type and market, and recurring concerns, learned from their reviews of past deals. Apply this lens to the grade, strengths, risks, and narrative so the analysis reflects how KPR actually thinks — while staying grounded in THIS deal's data. A deal-specific kprReview or kprThesis (if present) takes precedence over the general House View where they conflict. If houseView is absent, ignore this.

KPR REVIEW (the "kprReview" field, if present): this is the KPR team's OVERALL HUMAN ASSESSMENT of THIS deal — what they like, what concerns them, and their read on the broker's pricing / cap rate. It is the team's verdict; weave it directly into the narrative, strengths, risks, and especially the grade rationale, and let it move the grade. You may add nuance or push back where the roster/financials clearly contradict it, but give it real weight (it reflects experienced underwriting judgment, not just optimism). Where the review questions pricing (e.g. "broker's 6.5% is too expensive for this product/market"), reflect that as a pricing/return risk. If kprReview is absent, ignore this.

KPR THESIS (the "kprThesis" field, if present): this is the KPR acquisitions team's own stated thesis / assumptions for the deal — why they like it, what they're underwriting to, risks they're discounting. Treat it as INFORMED INTERNAL CONTEXT and weave it into the narrative, strengths, and risks — but stay OBJECTIVE and ADVISORY: you may agree, add nuance, or PUSH BACK where the roster/financials don't support a claim. If a thesis point is contradicted by the data, say so plainly (e.g. as a risk or caveat) rather than parroting it. Do NOT let an optimistic thesis inflate the grade beyond what the numbers justify. If kprThesis is absent, ignore this.

LEASE RISK (anchor-dependency / co-tenancy): If a "leaseRiskExposure" block is present, it lists co-tenancy / sales-kickout exposure the APP computed from the lease documents — base rent that can convert to alternate/reduced rent (or grant a termination right) if a named anchor goes dark. NARRATE those figures; never re-derive or invent them. Fold the MATERIAL exposure into the Risks list and the narrative's risk sentence — e.g. a Tier-1 figure that is significant vs. the property's rent is a real risk ("~$X of base rent (TenantA, TenantB) converts to alternate rent if Anchor goes dark"). Tier-2 (needs a second event) is a lesser watch item. Where an executed lease has VERIFIED/mitigated a clause (Tier-1 reduced, or a tenant de-linked), reflect it as resolved rather than a live risk, and do not list a mitigated tenant as at-risk. Clauses still "OM-only (unverified)" should be framed as "subject to confirming the executed leases." Keep it proportional — a small Tier-1 relative to total rent is a minor note, not a headline. If no leaseRiskExposure block is present, ignore this.

Base everything on the CURRENT roster below (note tenantsAsOf — this roster supersedes any older OM). Output must start with { and end with }.

CURRENT PROPERTY DATA (JSON):
`;

// Load a deal's pasted lease abstracts and build the resolved co-tenancy exposure
// summary for the narrative pass. Best-effort: returns "" on any failure.
export async function loadLeaseRiskSummary(dealId: string, dealData: Record<string, unknown>): Promise<string> {
  try {
    const rows = await db.select().from(leaseAbstractsTable).where(eq(leaseAbstractsTable.dealId, dealId));
    const abstracts = rows.map((r) => ({ ...(r.data as Record<string, unknown>), tenantName: r.tenantName }));
    return summarizeLeaseRisk(dealData, abstracts);
  } catch {
    return "";
  }
}

// Load the distilled House View text (KPR's cross-deal underwriting lens) for
// injection into the grade/narrative. Best-effort: "" on any failure.
export async function loadHouseViewText(): Promise<string> {
  try { return (await getHouseView()).content.trim(); } catch { return ""; }
}

const HOUSE_VIEW_DISTILL_PROMPT = `You are distilling an acquisitions team's underwriting JUDGMENT from their free-text reviews of retail shopping-center deals into a compact, durable "House View" that will be applied to every FUTURE deal the team analyzes.

Below is a JSON array of past deal reviews (each with the property, center type, state, going-in cap rate where known, and the team's verbatim review). Read them and synthesize the team's CONSISTENT preferences and judgment — NOT a deal-by-deal summary.

Return ONLY plain text (no JSON, no markdown headers), ~150-350 words, organized as short labeled lines covering, where the reviews support it:
- REWARDS: what the team consistently likes (e.g. strong grocer sales + below-market rent, credit anchors, infill density).
- PENALIZES / CONCERNS: what consistently worries them (e.g. junior boxes with high rent + soft sales, single-anchor dependence, weak co-tenancy).
- CAP RATE / PRICING: their expectations by product type and market (e.g. "grocery-anchored in secondary NJ markets: rich below ~6.75%, fair ~7%+"); capture any explicit cap-rate opinions and generalize them by product/market.
- TENANT/CREDIT VIEWS: recurring stances (e.g. treat franchised QSR as non-credit).
- DEAL TYPES TO AVOID: anything they say they won't buy.
Only include a point if the reviews actually support it. Be specific and quote their numbers/thresholds where given. Do not invent preferences. This text becomes the team's standing lens, so write durable principles, not one-off notes.`;

// Rebuild the House View by distilling every deal's dealReview. Returns the new
// content + how many reviews fed it. Token cost: one Haiku pass.
export async function rebuildHouseView(updatedBy: string | null): Promise<{ content: string; sourceCount: number }> {
  const rows = await db.select().from(dealsTable);
  const reviews = rows
    .map((r) => r.data as Record<string, unknown>)
    .filter((d) => d && !d.trashedAt && typeof d.dealReview === "string" && (d.dealReview as string).trim())
    .map((d) => ({
      property: d.propertyName, centerType: d.centerType, state: d.state,
      capRate: d.capRate ?? null, askingPrice: d.askingPrice ?? null,
      review: (d.dealReview as string).trim(),
    }));
  if (reviews.length === 0) {
    await saveHouseView("", updatedBy, { sourceCount: 0 });
    return { content: "", sourceCount: 0 };
  }
  const upstream = await callAnthropicOnce({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    messages: [{ role: "user", content: [
      { type: "text", text: HOUSE_VIEW_DISTILL_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: "DEAL REVIEWS (JSON):\n" + JSON.stringify(reviews, null, 1) },
    ] }],
  });
  const data = await upstream.json() as Record<string, unknown>;
  if (!upstream.ok) {
    const errMsg = typeof data.error === "object" && data.error !== null
      ? (data.error as Record<string, unknown>).message ?? JSON.stringify(data.error)
      : String(data.error ?? "Unknown error");
    throw new Error(String(errMsg));
  }
  const blocks = data.content as Array<{ type: string; text?: string }>;
  const content = (blocks?.find((b) => b.type === "text")?.text ?? "").trim();
  await saveHouseView(content, updatedBy, { sourceCount: reviews.length });
  return { content, sourceCount: reviews.length };
}

// Called (in the background) whenever a deal's "Our Take" is saved. Keeps the House
// View learning automatically: re-distills from all takes — UNLESS the House View
// was hand-edited since the last rebuild, in which case it leaves the manual text
// alone and just counts the take as pending (the UI nudges for a manual rebuild).
export async function autoUpdateHouseViewOnReview(updatedBy: string | null): Promise<void> {
  try {
    const hv = await getHouseView();
    if (hv.manuallyEdited) { await incrementPendingReviews(); return; }
    await rebuildHouseView(updatedBy);
  } catch {
    /* best-effort: never let House-View upkeep affect the deal save */
  }
}

export async function runRosterAnalysis(dealData: Record<string, unknown>, leaseRiskSummary = ""): Promise<Record<string, unknown>> {
  const houseView = await loadHouseViewText();
  const t = Array.isArray(dealData.tenants) ? (dealData.tenants as Array<Record<string, unknown>>) : [];
  const thesis = typeof dealData.dealThesis === "string" ? dealData.dealThesis.trim() : "";
  const review = typeof dealData.dealReview === "string" ? dealData.dealReview.trim() : "";
  const snapshot = {
    houseView: houseView || undefined,
    leaseRiskExposure: leaseRiskSummary || undefined,
    kprReview: review || undefined,
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
  // Prompt caching: the static ROSTER_ANALYSIS_PROMPT is identical every refresh,
  // so cache it; only the per-deal snapshot JSON varies. Helps now that analysis
  // auto-refreshes on every upload.
  const upstream = await callAnthropicOnce({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    messages: [{ role: "user", content: [
      { type: "text", text: ROSTER_ANALYSIS_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: JSON.stringify(snapshot, null, 1) },
    ] }],
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
    const { data: rawExtracted, timings } = await runOmExtraction(text, extraGuidance);
    const _scoreStart = Date.now();
    const [augmented, totalCount] = await Promise.all([
      augmentScoringWithBenchmarks(id, rawExtracted, log),
      getTotalDealCount(),
    ]);
    const scoreMs = Date.now() - _scoreStart;
    // Record the per-OM extraction timing breakdown (measurement only) so it's
    // visible at /api/upload-timing. Best-effort; never affects the upload.
    void (async () => {
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS upload_trace (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL)`);
        await pool.query(`INSERT INTO upload_trace(data) VALUES ($1::jsonb)`, [JSON.stringify({ id, fileName, scoreMs, ...timings, ts: new Date().toISOString() })]);
        await pool.query(`DELETE FROM upload_trace WHERE id <= (SELECT max(id) FROM upload_trace) - 30`);
      } catch { /* tracing must never break an upload */ }
    })();
    log.info({ id, timings, scoreMs }, "OM extraction timing");
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
    // Post-extraction lease-risk validators → fold into Import-Review questions
    // (unverified OM co-tenancy/kickout + any "increase" rent step that decreases).
    try {
      const lrChecks = validateLeaseRiskAtExtraction(dealData);
      if (lrChecks.length) {
        const existing = Array.isArray(dealData.reviewQuestions) ? dealData.reviewQuestions as unknown[] : [];
        const seen = new Set(existing.map((q) => (q as { id?: string })?.id));
        dealData.reviewQuestions = [...existing, ...lrChecks.filter((q) => !seen.has(q.id))];
      }
    } catch { /* validators must never break an upload */ }
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
