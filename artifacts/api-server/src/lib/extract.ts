// Shared Anthropic extraction logic — used by both the ai route and the ingest route
import type { Logger } from "pino";
import { db, dealsTable, pool, leaseAbstractsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { rebuildTenantIndex, parseLeaseDate } from "./tenantIndex";
import { augmentScoringWithBenchmarks, getTotalDealCount } from "./tenantBenchmarks";
import { ANALYSIS_VERSION } from "./analysisVersion";
import { lessonGuidance } from "./extractionLessons";
import { filterNewTenants } from "./tenantDedup";
import { runLeaseRiskPass, enforceRosterCotenancyRule, validateLeaseRiskAtExtraction, summarizeLeaseRisk } from "./leaseRiskExtract";
import { auditExtraction, auditSourceText } from "./extractionAudit";
import { applyImportFixes } from "./importFixes";
import { getHouseView, saveHouseView, incrementPendingReviews } from "./houseView";
import { findComparableDeals } from "./comparables";
import { computePortfolioCalibration } from "./calibration";
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
  "currentAssessedValue": "number or null — the property's CURRENT total ASSESSED (or taxable) value from the OM's real-estate-tax overview / parcel table. This is the assessor's value the BILL is computed on, NOT the market value and NOT the asking price. CRITICAL: many states assess at a FRACTION of market value (e.g. Ohio 35%, several others), so the tax table frequently has BOTH an 'Assessed Value' column AND a 'Market Value' column — the ASSESSED value is the SMALLER one (≈ ratio × market). Capture the ASSESSED (smaller) column here and the Market column in currentMarketValue — NEVER put the Market value here. Example (Ohio): a table showing Assessed $4,284,880 and Market $12,242,500 → currentAssessedValue=4284880, currentMarketValue=12242500. In Michigan use the TAXABLE value; elsewhere the assessed value. If the OM lists multiple parcels, this MUST be the SUM of ALL parcels' ASSESSED values (also fill taxParcels[] below so the sum can be verified).",
  "currentMarketValue": "number or null — the assessor's total MARKET / full / appraised value when the OM states it SEPARATELY from assessed value (many tables show Market, Assessed, and Taxable columns — capture all three). Sum across parcels. Null if the OM only gives one value. Do NOT copy the asking price here.",
  "currentAnnualTaxes": "number or null — the property's CURRENT total annual real-estate TAXES actually billed, from the OM's tax overview / parcel table (SUM of ALL parcels, most recent year). NOT a pro-forma/underwritten tax figure.",
  "assessmentYear": "number or null — the tax year the currentAssessedValue / currentAnnualTaxes are from (e.g. 2025).",
  "taxParcels": "array — ONE entry per parcel/line in the OM's real-estate-tax / parcel table (empty array if the OM gives only a single combined figure or no tax detail). This exists so the totals can be reconciled — capture EVERY parcel row, including small outlots, never just the largest 'Main' parcel. Each: {\"parcelId\":\"the APN / parcel number string or null\",\"label\":\"short label e.g. 'Main','Panera outlot','Ulta' or null\",\"assessedValue\":number or null,\"marketValue\":number or null,\"annualTaxes\":number or null,\"year\":number or null}. Do NOT include a grand-total/'Total' row as a parcel — that goes in currentAssessedValue/currentAnnualTaxes.",
  "taxAbatement": "object or null — set only if the OM discloses a tax abatement, PILOT (payment in lieu of taxes), TIF, Enterprise/Opportunity Zone, or similar break on THIS property's CURRENT taxes: {\"present\":true,\"type\":\"abatement|PILOT|TIF|enterprise zone|other\",\"note\":\"short description\",\"expiry\":\"ISO date or year or null\",\"unabatedAnnualTaxes\":number or null,\"abatementPct\":number or null,\"phaseOutYears\":number or null,\"survivesSale\":true/false or null}. unabatedAnnualTaxes = the FULL annual taxes once the break ends when the OM shows a 'stabilized' or 'fully-assessed' tax figure alongside the abated one. abatementPct = the % the break cuts off the full bill if stated (e.g. a 50% abatement → 50). phaseOutYears = years the break burns off over if it ramps down rather than ending at a cliff. survivesSale = true/false only if the OM says whether it transfers to a buyer, else null. Null for the whole object if none disclosed.",
  "specialAssessments": "string or null — any NON-ad-valorem special-assessment / special-district charges on the tax bill (CDD, Mello-Roos, Business Improvement District, lighting/fire/drainage district, PACE) that the OM discloses. These don't reassess like ad-valorem taxes. Null if none.",
  "nonAdValoremAnnual": "number or null — the ANNUAL DOLLAR total of the non-ad-valorem charges above (CDD/Mello-Roos/BID/PACE/fixed district fees) ONLY when they are INCLUDED inside currentAnnualTaxes and the OM states the dollar figure (a line item or sub-total). This is netted out of the reassessing base so a flat charge isn't scaled up with value. Null if not disclosed as a dollar amount, or if those charges are billed separately from the ad-valorem tax total.",
  "sellerTaxExempt": "true/false or null — set TRUE only if the OM indicates the CURRENT owner is a tax-exempt entity (non-profit, church/religious, government/municipality, public housing authority, hospital, university) such that the property currently pays little/no ad-valorem tax or is PILOT-only. This warns that a taxable buyer will face a NEW fully-assessed bill the OM's current-tax figure does not show. Null/false if the seller is an ordinary taxable owner.",
  "agOrGreenbeltAssessed": "true/false or null — set TRUE only if the OM indicates the parcel is assessed under an agricultural / greenbelt / use-value / open-space / farmland program (common on undeveloped outparcels or recently-converted land), which can trigger ROLLBACK (recapture of deferred back-taxes) on a change to retail use. Null/false otherwise.",
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
      "name": "raw tenant name exactly as it appears in the OM (may include store number, e.g. 'Stop & Shop #1234', 'TJ Maxx #T0586'). TJX COMBO BOXES: TJX (Marshalls, HomeGoods, T.J. Maxx, HomeSense, Sierra) frequently puts TWO banners in ONE box on ONE lease (a combined 'Marshalls HomeGoods' or 'T.J. Maxx HomeGoods' anchor). When the OM, site plan, or anchor list shows a co-branded TJX box, set name to BOTH banners joined by ' / ' (e.g. 'Marshalls / HomeGoods'), keep the SINGLE lease's total SF and base rent as ONE row (do NOT split into two tenants), and note it in assumptionNote. If the rent roll lists only one banner's legal entity (e.g. 'Marshalls of MA, Inc.') but the OM elsewhere shows the box is co-branded, still name it 'Marshalls / HomeGoods'. Only TJX does this at scale — do NOT infer combos for other retailers.",
      "canonicalName": "clean brand name only — strip store numbers, suite identifiers, and entity suffixes. Preserve special characters and punctuation that are part of the brand: ampersands (Stop & Shop), apostrophes (McDonald's, Lowe's), hyphens (Chick-fil-A, T-Mobile), and stylized caps (ALDI, H-E-B, TJ Maxx). Examples: 'Stop & Shop #1234' → 'Stop & Shop', 'TJ Maxx #T0586' → 'TJ Maxx', 'McDonald\\'s #32499' → 'McDonald\\'s', 'Dollar Tree #4212' → 'Dollar Tree'",
      "parentCompany": "Parent or holding company that owns this brand — only fill this when you are highly confident based on well-known public corporate ownership (e.g. TJ Maxx → 'TJX Companies', Marshalls → 'TJX Companies', HomeGoods → 'TJX Companies', Stop & Shop → 'Ahold Delhaize', Food Lion → 'Ahold Delhaize', Safeway → 'Albertsons Companies', Dollar Tree → 'Dollar Tree Inc.', Family Dollar → 'Dollar Tree Inc.', Old Navy → 'Gap Inc.', Taco Bell → 'Yum! Brands', Burger King → 'Restaurant Brands Intl.'). Leave null for: privately held regional operators, franchisee-operated tenants, local/independent chains, or any tenant where corporate ownership is uncertain or could have recently changed. When in doubt, leave null — do not guess.",
      "suite": "string or null",
      "sf": "number or null",
      "rentPerSF": "number or null — the CURRENT in-place BASE rent per SF. It MUST reconcile: rentPerSF × sf ≈ annualRent. If your read doesn't tie out you misread a column — the annual base rent on the rent roll is usually the more reliable figure, so recompute rentPerSF = annualRent ÷ sf rather than copying a per-SF number that implies a different annual (that figure is often a gross/effective or option-period rate). This matters most for anchors: a big-box base rent is typically ~$3–$15/SF, so a per-SF figure that implies 2x+ the stated annual is a misread.",
      "annualRent": "number or null — BASE rent only; do not fold in recoveries, percentage rent, or any other charges. Must reconcile to rentPerSF × sf (see rentPerSF).",
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
      "salesPSF": "number or null — most recent ANNUAL sales per SF (annual sales ÷ SF). CRITICAL — MOVIE-THEATER TRAP: a cinema's sales are often reported PER SCREEN or PER SEAT ('Sales / Screen $165,836', 'Sales per Seat'), NOT per SF. NEVER put a per-screen or per-seat figure in salesPSF — it is ~1000× too large and implies an impossible $/SF. For a theater, capture the screen count in the screens field, and set salesPSF from the TOTAL sales ÷ SF (total = per-screen × screens; e.g. $165,836/screen × 16 screens = $2,653,381 total ÷ 63,260 SF = $42/SF). If only a per-screen figure is given, still store salesPSF as (per-screen × screens ÷ SF) and put the count in the screens field so the app can show sales/screen. PARTIAL-YEAR TRAP: when a sales table shows MULTIPLE year columns, the most-recent column is often a PARTIAL / year-to-date year (its total is far below the prior year, its later months are zero/blank, or the report is dated early in the next year). NEVER use a partial year — it understates sales badly and inflates the occupancy-cost ratio. Use the most recent COMPLETE full-year column instead, and set salesYear to that complete year. ONLY annualize (sum of reported months ÷ number of reported months × 12) when the tenant OPENED mid-year so the partial period is its ONLY data — and then set annualized:true.",
      "salesYear": "number or null — the calendar year the salesPSF figure is from (e.g. 2024). Infer from context ('2024 sales', 'trailing 12 months ending Dec-2024', etc.).",
      "priorSalesPSF": "number or null — the tenant's PRIOR-year sales PER SQUARE FOOT, when the OM's tenant-sales table prints TWO years (e.g. columns '2024 Sales' and '2025 Sales'). Same per-SF basis as salesPSF (convert a total ÷ SF). Leave null if only one year is shown. salesPSF must remain the MOST RECENT year.",
      "priorSalesYear": "number or null — the calendar year priorSalesPSF is from (e.g. 2024 when salesYear is 2025).",
      "screens": "number or null — MOVIE THEATER / cinema tenants ONLY: the number of screens (auditoriums). Theaters are underwritten on sales PER SCREEN, not per SF, so capture this whenever the OM states it (e.g. '14-screen theater', '16 screens', 'stadium seating in 12 auditoriums') OR it is embedded in the tenant name — a trailing number on a cinema is the screen count ('Regal Trussville 14' → 14, 'Cinemark 18' → 18, 'AMC CLASSIC 12' → 12). SANITY CHECK: a real theater almost never exceeds ~30 screens (most are 6–24). If your read is above ~30, you have likely grabbed a SEAT count, a store number, or a year — re-check; capture your best genuine screen read, and if none is clearly stated, leave it null rather than guessing. Null for every non-theater tenant.",
      "salesNotes": "string or null",
      "occupancyCost": "number or null — TOTAL occupancy cost as a percentage of gross sales, defined as (base rent + expense reimbursements/CAM+taxes+insurance + percentage rent + other rent) ÷ gross sales. Often labeled 'Occ Cost %', 'OC%', or 'Occupancy Cost'. Use the OM's stated total occ-cost % when given. ENTER THE PERCENT NUMBER ITSELF (e.g. 22.5 for 22.5%), NEVER a 0.NN decimal fraction (not 0.225) — retail occupancy cost is essentially always between ~1% and ~30%, so any value below 1 means you wrote a fraction by mistake. If the OM only states base rent ÷ sales (not the full health ratio), note that in salesNotes instead and leave this null.",
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
  "fieldCitations": "object or null — WHERE each HEADLINE number came from, so a reviewer can verify it in seconds without hunting through the PDF. For each of these keys that you filled with a non-null value, give a SHORT locator: the PDF page number (the OM text contains '--- Page N ---' markers — use those) plus the table/section name, e.g. {\"noi\":\"p.14 — Financial Summary\",\"capRate\":\"p.3 — Offering Summary\",\"totalSF\":\"p.9 — Rent Roll total\"}. Keys (only those actually captured): noi, capRate, askingPrice, totalSF, occupancy, grossPotentialRent, effectiveGrossIncome, operatingExpenses, walt, weightedAvgRentPSF, currentAnnualTaxes, currentAssessedValue. When a value appears in SEVERAL places with the SAME figure, cite the most authoritative (financial summary over cover page); when you COMPUTED the value (e.g. WALT from the rent roll), write \"computed from rent roll (p.N)\". Keep each locator under ~8 words.",
  "reviewQuestions": [{"severity": "high|medium|low", "field": "human label for the value in question (e.g. 'Total SF', 'NOI', 'Five Below — SF')", "question": "a short plain-English question asking the user to confirm a value you were NOT confident you captured correctly", "detail": "1 sentence: what you read and why it was ambiguous (e.g. conflicting SF figures, an unlabeled column, a handwritten/blurry number, a footnote that might change it)", "suggestedValue": "the value you captured, as a string", "target": {"kind": "deal|tenant", "fieldKey": "the EXACT json field key this value maps to — for kind 'deal' one of: totalSF, noi, capRate, askingPrice, occupancy, walt, grossPotentialRent, weightedAvgRentPSF; for kind 'tenant' one of: sf, rentPerSF, annualRent, leaseStart, leaseExpiry, remainingTermYears, salesPSF", "tenantName": "for kind 'tenant', the exact tenant name as it appears in the tenants array; else null", "valueType": "number|text"}}]
}
DATA-INTEGRITY QUESTIONS (reviewQuestions): This is a DASHBOARD for the user to verify a clean import, not a place to dump everything. Add an item ONLY when you genuinely could not capture a value with confidence from the document — e.g. the OM gives conflicting square footages, the NOI/cap/price don't tie out, a rent-roll column was unlabeled or ambiguous, a key number was blurry/footnoted/asterisked, or two tenants might be the same. Severity: "high" = a core financial/SF figure that drives the analysis; "medium" = a material lease/tenant detail; "low" = a minor field. ALWAYS set "target" so the user can fix the value in one click: kind/fieldKey/tenantName/valueType pointing at the exact field; set target to null ONLY when the question is not about a single editable field (e.g. "two tenants might be duplicates"). Do NOT raise questions for values that are simply ABSENT from the document (those are just null) — only for values you DID capture but are UNSURE about, or genuine internal contradictions. Empty array if the import was clean and unambiguous. Cap at the ~5 most important.

PRIORITIES: Capture all footnotes/assumptions (assumptionNote, keyAssumptions). Capture roof ages. Only fill askingPrice/capRate when explicitly stated. shadowAnchors = null unless OM explicitly marks on-site parcel as NAP/unowned. Tenant roster scope: ONLY include tenants that are actual occupants of THIS property — i.e., they appear in the rent roll, tenant roster, or lease schedule with SF and/or rent data at this address. Exclude any tenant mentioned solely as: a competitor, a shadow anchor or co-tenant at another parcel, a comparable-sale occupant, a "trade area" or "co-tenancy" narrative reference, or market context. The test is: does this tenant have a lease at THIS property? If yes → include. If no → exclude. Tenant deduplication: if the same retailer appears in multiple phases, buildings, or pads (e.g. "TJ Maxx" and "TJ Maxx (West)"), consolidate into ONE tenant row — do NOT append phase/building identifiers in parentheses to the tenant name. Use the combined SF and primary lease terms for the single entry. Vacant spaces: include EACH vacant/availability row as its own tenant entry with name "Vacant", its SF if stated, and null for all lease/rent fields — do NOT merge multiple vacant suites into one row. Dates: always ISO YYYY-MM-DD. rentSchedule: leave null when no rent rate/steps are disclosed — do not just restate the lease-expiry date. creditRating: leave null unless the OM states it or the tenant is a certain national investment-grade credit — never guess (see field note). WALT: ALWAYS compute it yourself from the rent-roll lease-expiry dates (SF-weighted, to today); do NOT copy a WALT figure printed on the cover/marketing pages, which may use a different basis and conflict with the roster. Tenant names: brand only, no store numbers.

LANGUAGE (notes/rationale narration): RENTS DO NOT "TRADE" — properties trade, rents do not; say a rent "is X% below/above" market, never "trades below/above." Reserve "portfolio"/"KPR portfolio" for assets the owner holds; call the broader analyzed dataset "the database." KPR underwrites a 5–7 year hold (max ~10): frame mark-to-market/value-add upside that rolls within ~7 years as in-hold upside KPR captures; upside that rolls ~7–12 years out is residual/exit upside to position for the next buyer (not in-hold); upside locked deeper than that is not upside.

CRITICAL RENT-ROLL LESSONS (from real operator corrections — past extractions failed on these; do NOT repeat):
1. CAPTURE EVERY OCCUPIED LINE — NEVER DROP TENANTS. The tenants array MUST contain one row for EVERY occupied suite on the rent roll, plus one "Vacant" row per available suite. Do not stop partway, do not summarize, do not omit tenants because the roster is long. ANCHORS AND JUNIOR ANCHORS (the largest-SF tenants — grocers, Burlington, Marshalls, banks, etc.) are the MOST important to never omit; a missing 25,000 SF anchor is a severe error. Before finishing, COUNT the occupied suites listed on the rent roll and confirm your tenants array has that many occupied rows; if the rent roll's stated occupied SF or occupancy % does not reconcile with the sum of your tenant SF, you MISSED tenants — go back and add them (largest first). BUT NEVER EMIT TWO ROWS FOR THE SAME TENANT IN THE SAME SUITE: if a tenant appears twice (e.g. an original lease row and an amended/renewal row, or in two sections), output ONE row using the MOST CURRENT lease (latest expiry, current rent). Two rows for the same tenant+suite double-count its SF and corrupt occupancy/GLA.
2. USE THE FULL RENT ROLL, NOT A SUMMARY. The authoritative roster is the detailed in-place rent roll / lease schedule that has SF, current rent, AND lease-start columns. Extract every line from it. Do not build the roster from a cover-page anchor highlight, a "lease options" schedule, or a tenant-sales list alone — those are partial and may list departed tenants.
3. CURRENT EXPIRATION, NOT OPTION-EXTENDED. A pro-forma rent roll's "End"/"Expiration" column often ASSUMES renewal options are exercised (frequently stated in a footnote like "tenants with options assumed to exercise"). leaseExpiry MUST be the CURRENT contractual expiration, NOT the option-extended date. If a tenant's current term ends 2026 but the table shows 2031 because an option is assumed, use 2026 for leaseExpiry and put the option (→2031) in renewalOptions.
4. CURRENT IN-PLACE RENT, NOT OPTION RATE. rentPerSF and annualRent must be the tenant's CURRENT in-place base rent, not a future renewal-option rate. Option-period rates belong only in rentSchedule/renewalOptions.
5. DON'T CARRY DEPARTED TENANTS. Only include tenants on the CURRENT rent roll. A tenant that appears in an older options schedule or a prior-year sales report but is NOT on the current rent roll has left — exclude it (its suite is now vacant or re-leased to someone else).
6. SALES FIGURES — UNITS MATTER (salesPSF is PER SQUARE FOOT). When the OM gives a tenant's TOTAL annual sales (e.g. "Grocer Sales $37.7M", "anecdotal sales of $2.9M"), that is a TOTAL, not a per-SF figure — convert it: salesPSF = total ÷ SF. A $37.7M figure on a 59,678 SF store is ~$632/SF, NOT $37.7/SF. NEVER store a multi-million-dollar total in salesPSF. If the figure is labeled "anecdotal"/"estimated", say so in salesNotes. Only put a number directly in salesPSF when the OM states it per-SF. PARTIAL-YEAR / NEWLY-OPENED TENANT: if a tenant's only sales figure covers a PARTIAL year because the tenant OPENED MID-YEAR (a recent leaseStart/rent-commencement, a "sales reporting effective" mid-year date, or only the last few months reported with no prior full year), ANNUALIZE it to a 12-month run-rate (partial ÷ months reported × 12) for salesPSF, and state the basis in salesNotes (e.g. "Annualized run-rate from 4 months; opened ~Sep 2025 — straight-line, may not reflect seasonality"). Do not report the raw partial figure as if it were a full year, and do not raise a 'use prior year' question (there is no prior year).
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

// Vacant / available / spec suites must NEVER be merged together — each empty unit is a
// distinct suite with its own SF. (They'd otherwise all normalize to "vacant" and the
// phase-dedup below would collapse them into one row with summed SF.)
function isVacantName(name: string): boolean {
  const s = (name || "").trim().toLowerCase();
  return !s || s === "-" || /^(vacant|available|avail\b|spec(ulative)?|white\s*box|tbd|to\s+be\s+leased)\b/.test(s);
}

function mergePhaseDuplicates(tenants: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (!tenants || tenants.length === 0) return tenants;
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (let idx = 0; idx < tenants.length; idx++) {
    const t = tenants[idx];
    const name = typeof t.name === "string" ? t.name : "";
    // Vacant suites get a unique key so they're never grouped/summed with each other.
    const key = isVacantName(name) ? `__vacant__${idx}` : normTenantName(name);
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

// Lightweight broker/system FORMAT detection → a short, high-confidence hint string
// appended to the extraction prompt. Token-free (a sentence or two), additive, and
// only fires on clear signatures — a nudge on known format quirks, never a hard rule.
export function formatHints(text: string): string {
  const ends = (text || "").slice(0, 24000) + "\n" + (text || "").slice(-8000); // broker/system marks live in headers/footers
  const hints: string[] = [];
  if (/\bMRI\b|Run Date:[\s\S]{0,80}Rent Roll|Gross Annual\s*\n?\s*Rent/i.test(text)) {
    hints.push('MRI-STYLE RENT ROLL: base rent is the "Annual Rent" column — do NOT use "Gross Annual Rent" (that bakes in CAM/Tax/Insurance recoveries). Set annualRent = BASE only, and capture CAM+Tax+Insurance as expenseReimbursements separately.');
  }
  if (/\bCBRE\b/.test(ends)) {
    hints.push("CBRE book: if it covers a PORTFOLIO of more than one property, extract ONLY the single property in scope — never merge a second center's tenants or financials — and note in keyAssumptions that it's part of a portfolio offering. Pull per-tenant economics from the rent-roll/financial section, not the marketing highlights.");
  }
  if (/Marcus\s*&\s*Millichap|\bMMRE\b/i.test(ends)) {
    hints.push("Marcus & Millichap OM: the headline cap rate is frequently PRO-FORMA, not in-place. Capture in-place NOI and occupancy separately, and don't treat the marketing cap as in-place.");
  }
  if (/\bJLL\b|Jones Lang LaSalle/i.test(ends)) {
    hints.push("JLL book: if it's a multi-property portfolio, extract only the property in scope; pull per-tenant base rents and lease dates from the rent-roll/financial section.");
  }
  if (/\bNewmark\b|Newmark Knight Frank|\bNKF\b/i.test(ends)) {
    hints.push("Newmark book: institutional, frequently a multi-property PORTFOLIO — extract ONLY the property in scope and note the portfolio context in keyAssumptions. Headline returns are usually PRO-FORMA / stabilized off a 10-year cash flow; capture in-place NOI, occupancy and rents from the rent-roll/financial pages, and don't treat the stabilized/marketing cap as in-place.");
  }
  if (/Eastdil\s*Secured|\bEastdil\b/i.test(ends)) {
    hints.push("Eastdil Secured book: top-of-market institutional, typically marketed UNPRICED ('guidance' / 'call for offers') — leave askingPrice and capRate null unless an explicit number is printed; never infer them from the pro-forma. The underwriting shows forward/stabilized returns with market mark-to-market upside, so capture in-place NOI, occupancy and rents from the rent roll separately from that upside.");
  }
  if (/Cushman\s*&?\s*Wakefield|\bCushman\b/i.test(ends)) {
    hints.push("Cushman & Wakefield book: institutional; if it's a multi-property portfolio, extract only the property in scope. Pull per-tenant base rents and lease dates from the rent-roll/financial section (not the marketing highlights), and separate in-place NOI from any pro-forma / stabilized figure.");
  }
  if (/\bColliers\b/i.test(ends)) {
    hints.push("Colliers book: if it's a multi-property portfolio, extract only the property in scope; pull per-tenant economics from the rent roll, and distinguish in-place NOI from any pro-forma / stabilized figure.");
  }
  if (/SRS Real Estate|\bSRS\b/i.test(ends)) {
    hints.push("SRS Real Estate Partners book: retail specialist — often a single net-lease asset or a small retail portfolio. If multiple properties, extract only the property in scope. The headline is frequently a PRO-FORMA cap on stabilized rent; capture in-place NOI/occupancy and per-tenant base rents from the rent roll, and flag any signed-not-open or proposed tenants the OM models in place.");
  }
  if (/\bNorthMarq\b|\bNorthmarq\b/i.test(ends)) {
    hints.push("NorthMarq book: primarily a debt/capital-markets shop, so a sales OM often leans on a financing narrative — keep KPR's own debt assumptions out of the OM-stated fields. Extract in-place NOI/occupancy/rents from the rent-roll/financial section and treat any quoted return as pro-forma unless it's explicitly in-place.");
  }
  if (/\bBerkadia\b/i.test(ends)) {
    hints.push("Berkadia book: capital-markets/debt heritage; for a retail sales OM, pull per-tenant economics from the rent roll (not the marketing pages) and separate in-place NOI from any stabilized/pro-forma figure. If multi-property, extract only the property in scope.");
  }
  if (/\bTen-?X\b|\bRCM\b|Real Capital Markets|\bCREXi\b|\bLightBox\b|\bAuction\.com\b/i.test(ends)) {
    hints.push("AUCTION / online-marketplace listing (Ten-X / RCM / CREXi / LightBox / Auction.com): the price field is a STARTING BID or RESERVE, not an asking price — capture it only if explicit and note in keyAssumptions that pricing is auction/bid-based (leave askingPrice null if only a starting bid is shown). These are often value-add/distressed or short-fuse marketed deals, so in-place occupancy/NOI may be soft — capture them straight from the rent roll and flag vacancy/rollover.");
  }
  if (!hints.length) return "";
  return "\n\nDOCUMENT-FORMAT HINTS (auto-detected from the source — apply where relevant):\n- " + hints.join("\n- ") + "\n";
}

// SECOND-READER verification (best-effort, Haiku). Re-reads the OM and cross-checks
// the handful of HIGH-VALUE headline numbers the extractor produced, flagging ONLY
// clear, quote-grounded disagreements into Import Review. Cheap (one Haiku pass) and
// fully contained — every failure path returns [] so it can never affect an upload.
// Deal-level numbers only (no per-tenant) to hold cost and false-positive noise down.
type VerifyQuestion = { id: string; source: "ai"; severity: "medium"; field: string; question: string; detail: string | null; suggestedValue: string | null; target: { kind: "deal"; fieldKey: string; valueType: "number" } | null };
const VERIFY_FIELDS: Array<[string, string]> = [
  ["noi", "in-place net operating income ($)"],
  ["capRate", "cap rate (%)"],
  ["askingPrice", "asking / guidance price ($)"],
  ["totalSF", "total building GLA (SF)"],
  ["occupancy", "occupancy (%)"],
  ["grossPotentialRent", "gross potential / in-place base rent ($)"],
];
const parseMoneyish = (s: string): number | null => {
  const m = s.replace(/,/g, "").match(/-?\$?\s*([\d.]+)\s*([mMkK])?/);
  if (!m) return null;
  let n = Number(m[1]); if (!Number.isFinite(n)) return null;
  if (m[2] && /[mM]/.test(m[2])) n *= 1_000_000; else if (m[2] && /[kK]/.test(m[2])) n *= 1_000;
  return n;
};
export async function verifyExtraction(text: string, deal: Record<string, unknown>, log?: Logger): Promise<VerifyQuestion[]> {
  try {
    const present = VERIFY_FIELDS.filter(([k]) => deal[k] != null && deal[k] !== "");
    if (present.length < 2 || !text) return [];
    const truncated = text.length > 160000 ? text.slice(0, 110000) + "\n...[middle truncated]...\n" + text.slice(-40000) : text;
    const valueList = present.map(([k, label]) => `- ${k} (${label}): ${JSON.stringify(deal[k])}`).join("\n");
    const prompt = `You are a meticulous CRE analyst doing a SECOND-READER check. Below are headline figures another analyst extracted from this Offering Memorandum, plus the OM text. For EACH figure, find where the OM states it and decide whether the extracted value is correct.

Return ONLY JSON: {"disagreements":[{"field":"<one of the field keys>","omValue":"<the value the OM actually states, with units>","quote":"<short verbatim snippet from the OM showing it>"}]}

RULES:
- Include a field ONLY when the OM CLEARLY states a DIFFERENT value than extracted (a real contradiction). Ignore rounding and ignore a value simply quoted on a different basis you can't pin down.
- If a figure is in-place vs pro-forma and the extracted value matches EITHER, that is NOT a disagreement.
- You MUST include a verbatim "quote" from the OM for every disagreement. If you cannot quote it, do not report it.
- If everything looks right, or you cannot find a figure in the OM, return {"disagreements":[]}.

EXTRACTED FIGURES:
${valueList}

OM TEXT:
${truncated}`;
    const upstream = await callAnthropicOnce({ model: "claude-haiku-4-5-20251001", max_tokens: 1200, messages: [{ role: "user", content: prompt }] });
    const data = await upstream.json() as Record<string, unknown>;
    if (!upstream.ok) return [];
    const raw = (data.content as Array<{ type: string; text?: string }>)?.find(b => b.type === "text")?.text ?? "";
    if (!raw) return [];
    const parsed = robustParseJSON(raw) as { disagreements?: Array<Record<string, unknown>> };
    const rows = Array.isArray(parsed?.disagreements) ? parsed.disagreements : [];
    const allowed = new Set(present.map(([k]) => k));
    const out: VerifyQuestion[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const field = String(r.field || "");
      if (!allowed.has(field) || seen.has(field)) continue;
      const omValue = r.omValue == null ? "" : String(r.omValue).trim();
      const quote = r.quote == null ? "" : String(r.quote).trim();
      if (!omValue || !quote) continue;                       // must be grounded in a quote
      seen.add(field);
      const suggested = parseMoneyish(omValue);
      out.push({
        id: `ai-verify-${field}`,
        source: "ai", severity: "medium",
        field: `${field} — second-reader`,
        question: `Second read of the OM suggests ${field} may be ${omValue}, not the extracted ${JSON.stringify(deal[field])}. Confirm which is right.`,
        detail: `From the OM: "${quote.slice(0, 240)}". A verification pass flagged this as a possible mis-read — check the source before relying on it.`,
        suggestedValue: suggested != null ? String(suggested) : null,
        target: suggested != null ? { kind: "deal", fieldKey: field, valueType: "number" } : null,
      });
    }
    if (out.length) log?.info?.({ count: out.length, fields: out.map(o => o.field) }, "Second-reader flagged figures");
    return out;
  } catch (err) { log?.warn?.({ err }, "verifyExtraction failed (non-fatal)"); return []; }
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
    { type: "text", text: taughtRules + houseBlock + formatHints(text) + (extraGuidance || "") + "\n\nOM TEXT:\n" + truncatedText, cache_control: { type: "ephemeral" } },
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
    const tenants = extracted.tenants as Array<{ name?: string; suite?: unknown }>;
    // Exclude by suite AND name — suites are the stable key when names are garbled.
    const haveLabels = tenants.map((t) => (t.suite ? `${t.name ?? "?"} [${t.suite}]` : t.name)).filter(Boolean);
    const contInstruction =
      "From the Offering Memorandum text above, extract ONLY the tenants NOT already in this list (each shown as name [suite] — do NOT re-emit any suite already listed):\n" +
      haveLabels.join(", ") +
      "\n\nINCLUSION RULE: Only include tenants that are actual occupants of THIS property — they must appear in the rent roll, tenant roster, or lease schedule with SF and/or rent data at this address. Do NOT include tenants mentioned as competitors, shadow anchors at other parcels, comparable-sale occupants, or trade-area/co-tenancy narrative references. The test: does this tenant have a lease at THIS property?\n\n" +
      "Return ONLY a JSON object: {\"tenants\":[...]} using this schema per tenant: " +
      "{name, suite, sf, rentPerSF, annualRent, leaseStart, leaseExpiry, leaseType, reimbursementMethod, camCapPct, camCapBasis, adminFeePct, mgmtFeeInCam, grossUpPct, recoverySF, rentBumps, rentSchedule, renewalOptions, recentlyExercisedRenewal, recentRenewalSpreadPct, percentageRentClause, percentageRentRate, percentageRentBreakpoint, percentageRentBreakpointType, expenseReimbursements, percentageRent, otherRent, creditRating, salesPSF, salesYear, priorSalesPSF, priorSalesYear, isAnchor, isDark, leaseStatus, remainingTermYears}. " +
      "If there are no more tenants, return {\"tenants\":[]}. Output must start with { and end with }.";
    try {
      const _cStart = Date.now();
      const cont = await callExtract([...cachedBlocks, { type: "text", text: contInstruction }], FAST_MODEL);
      continuationMs += Date.now() - _cStart;
      const contParsed = robustParseJSON(cont.raw) as Record<string, unknown>;
      const newOnes = filterNewTenants(tenants, (contParsed.tenants as Array<{ name?: string; suite?: unknown }>) || []);
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
        const newOnes = filterNewTenants(tenants, (contParsed.tenants as Array<{ name?: string; suite?: unknown }>) || []);
        if (newOnes.length === 0) break;
        extracted.tenants = (extracted.tenants as unknown[]).concat(newOnes);
        lastProgressAt = Date.now();   // found missing tenants → still progressing
      } catch {
        break;
      }
    }
    gapRoundsTotal = gapRounds;
  }

  // VACANCY backstop — the occupied side can reconcile perfectly while the VACANT
  // suites were dropped (the roster was built from the site-plan tenant names, never
  // the rent roll's empty rows). The OM states its vacancy in several places (the
  // exec-summary occupancy/vacant-SF block, the leasing/availability table, the
  // rent-roll subtotals, an absorption schedule), so cross-reference them: if the
  // roster carries materially LESS vacant SF than the stated occupancy implies,
  // re-prompt specifically for the missing VACANT suites until it reconciles to the
  // GLA. (This is the Pacific Commons miss — occupied tied out, ~68K SF of vacancy
  // was silently dropped because the occupied-only backstop above was satisfied.)
  {
    const totalSF = Number(extracted.totalSF);
    let occPct = Number(extracted.occupancy);
    if (occPct > 0 && occPct <= 1.5) occPct *= 100;
    const isVac = (n: unknown) => /vacant|available|avail\b|spec|white\s*box|tbd/i.test(String(n || ""));
    let vacRounds = 0;
    while (vacRounds < 3 && totalSF > 0 && occPct > 0 && occPct < 100) {
      if (overBudget()) { budgetHit = true; break; }
      const tenants = extracted.tenants as Array<{ name?: string; sf?: unknown; suite?: unknown; isNAP?: boolean }>;
      const capturedVacSF = tenants.reduce((s, t) => { const sf = Number(t?.sf); return s + (t && !t.isNAP && isVac(t.name) && !isNaN(sf) && sf > 0 ? sf : 0); }, 0);
      const impliedVacSF = totalSF * (100 - occPct) / 100;
      // Only chase a MATERIAL shortfall so a fully-leased / rounding case never fires.
      if (impliedVacSF <= 0 || capturedVacSF >= impliedVacSF * 0.85 || (impliedVacSF - capturedVacSF) < 5000) break;
      vacRounds++;
      const haveVac = tenants.filter(t => isVac(t.name)).map(t => `${t.name}${t.suite ? ` [${t.suite}]` : ""} ${Number(t.sf) || "?"} SF`);
      const vacInstruction =
        `RECONCILIATION CHECK — VACANCY. The OM states ${occPct}% occupancy on ${totalSF.toLocaleString()} SF, which implies about ` +
        `${Math.round(impliedVacSF).toLocaleString()} SF of VACANT/AVAILABLE leasable space — but the roster so far carries only ` +
        `${Math.round(capturedVacSF).toLocaleString()} SF of vacancy, so VACANT SUITES ARE MISSING. The OM discloses its vacancy in ` +
        `several places: the executive-summary occupancy / vacant-SF block, the site-plan or leasing/availability table, the rent-roll ` +
        `subtotals, and any "vacant space" / lease-up / absorption schedule. Cross-reference those and extract EACH currently ` +
        `vacant/available leasable suite NOT already listed below. Do NOT include NAP/unowned parcels or future-delivery anchor space ` +
        `(e.g. a not-yet-built grocery box) — only CURRENT vacant in-line/anchor suites that count toward this building's GLA.\n` +
        `Already-listed vacant rows: ${haveVac.join("; ") || "(none)"}.\n` +
        `Return ONLY {"tenants":[...]} where each row is a vacant suite: {"name":"Vacant","suite":<id or null>,"sf":<number>, and all rent/lease fields null}. ` +
        `If no vacant suites remain to add, return {"tenants":[]}. Output must start with { and end with }.`;
      try {
        const _gStart = Date.now();
        const cont = await callExtract([...cachedBlocks, { type: "text", text: vacInstruction }], FAST_MODEL);
        gapFillMs += Date.now() - _gStart;
        const contParsed = robustParseJSON(cont.raw) as Record<string, unknown>;
        const existingSuites = new Set(tenants.map(t => String(t.suite ?? "").trim().toLowerCase()).filter(Boolean));
        const newOnes = ((contParsed.tenants as Array<{ name?: string; suite?: unknown; sf?: unknown }>) || [])
          .filter(t => t?.name && isVac(t.name) && Number(t.sf) > 0)
          .filter(t => { const s = String(t.suite ?? "").trim().toLowerCase(); return !s || !existingSuites.has(s); });
        if (newOnes.length === 0) break;
        extracted.tenants = (extracted.tenants as unknown[]).concat(newOnes);
        lastProgressAt = Date.now();
      } catch { break; }
    }
    gapRoundsTotal += vacRounds;
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

TJX COMBO BOX — a tenant named like "Marshalls / HomeGoods" (or "T.J. Maxx / HomeGoods") is ONE lease housing TWO TJX banners in a single combined box. Treat it as a single anchor lease, but recognize it as a DUAL draw (two co-tenant magnets), and remember its footprint is ~2× a single banner — so its larger SF is expected and is NOT an oversized-store or SF-error risk. Do not double-count it as two leases, and do not read its blended rent/sales PSF as if it were a single standalone banner.

BELOW-MARKET RENT — judge it correctly, do not treat it as automatically good or bad:
- KPR underwrites a 5–7 YEAR HOLD (max ~10). Judge below-market rent by WHEN it becomes capturable, on three tiers:
  • IN-HOLD (rollover within ~7 years) → upside KPR captures directly. This is the strongest case and can be "high" (subject to the other gates below).
  • JUST AFTER HOLD (rollover ~7–12 years out) → KPR won't capture it, but it's real RESIDUAL / EXIT UPSIDE we can position for the NEXT buyer as part of the sale story. Score it "low" (occasionally "medium" if large/anchor) and FRAME it that way — "embedded mark-to-market for a future owner at the ~YYYY rollover," not in-hold upside.
  • DEEP BEYOND (rollover/options keep it locked well past ~12 years) → not upside at all — but it is ALSO NOT A RISK. Below-market rent locked in by options is the STICKIEST, most secure income in the center (the tenant never leaves a below-market deal, so near-zero vacancy/re-leasing risk); the only thing "lost" is theoretical upside we never underwrote. Note it NEUTRALLY as secure, durable income whose mark-to-market simply is not capturable in the hold — or, for a healthy credit, a mild income-durability strength. NEVER put locked below-market rent in redFlags or risks, and never frame it as "structural underperformance," "rent compression," or something that "persists through exit" as if it were negative. It becomes a risk ONLY if the tenant is distressed (weak sales / high occupancy cost, so the low rent itself is shaky), if a dominant anchor's locked rent materially caps the asset's growth/resale value (a valuation point — the income is still secure), or if the deal is priced as though the upside were capturable.
- Below-market rent is real IN-HOLD MARK-TO-MARKET UPSIDE when the landlord can capture it during the 5–7 year hold. The strongest case (priority "high") is a tenant that is BELOW market AND has LITTLE LEASE TERM REMAINING (low remainingTermYears / near-term leaseExpiry) AND few or no remaining fixed-rate renewal options (renewalOptions) AND demonstrates it can pay more — STRONG sales (salesPSF) with a LOW occupancyCost %. That tenant can be marked to market at rollover.
- RENEWAL OPTIONS GATE: remaining renewal options put control in the TENANT'S hands — they will exercise only if the option rent is at/below market. So if a below-market tenant holds remaining options at fixed or unspecified (assume non-market) rents, you generally CANNOT mark it to market during the hold; apply the timing tiers above (if the latest option pushes the realistic rollover ~7–12 years out, treat it as residual/exit upside for the next buyer, not in-hold upside). Two 5-year options ≈ ~10 years of tenant-controlled occupancy. Below-market rent is in-hold capturable despite options ONLY if the OM states the options reset to market/FMV. Near-term expiry does NOT override unexercised options.
- DISCOUNT the upside when the tenant has many years of term left, OR has remaining options at fixed/below-market rents — you would not reach market during the hold, so it is not in-hold upside. Where the rollover lands ~7–12 years out, position it as exit/residual upside for the next buyer ("low"); where it is locked deeper than that, it is locked in, not upside.
- MATERIALITY GATE (critical): priority must reflect DOLLAR MAGNITUDE relative to the whole property, not just how clean the story is. The gain from one small inline space (a few thousand $/yr, or under ~2-3% of total in-place rent) is "low" no matter how strong the tenant's credit or how short its term. Reserve "high" for upside that actually moves the deal — an anchor, a large SF block, several tenants in aggregate, or a clearly large $ figure relative to NOI. A 1,000–1,500 SF tenant marked up a couple $/SF is never "high".
- Below-market rent can also be a WARNING, not upside: if sales are weak or occupancyCost is already high, the low rent may reflect a struggling tenant or a soft market, and pushing rent at renewal risks losing them. Frame it as a risk in that case.
- If sales/occupancy-cost data is absent, stay measured: note the below-market rent as a POSSIBLE mark-to-market opportunity contingent on lease term/options and sales, rather than asserting upside.

ABOVE-MARKET RENT — this is MARK-TO-MARKET DOWNSIDE, never "upside." An in-place rent well ABOVE the market/database median is a premium that may not survive renewal: at the next expiry/option the rent can reset DOWN toward market, or the tenant can leave — and the above-market rent INFLATES current NOI, so a buyer capping that NOI overpays for income that rolls off. NEVER describe above-market rent as "mark-to-market upside," and never treat it as automatically a strength. Judge sustainability from the tenant's OWN signals:
- SUSTAINABLE (premium earned) → strong salesPSF and/or LOW occupancyCost % mean the store can afford the premium; the rent is defensible. Treat as reliable income / a productive location (a mild strength at most), but still note an exit buyer will discount above-market rent at sale.
- AT-RISK (rollover downside) → weak salesPSF or HIGH occupancyCost %, ESPECIALLY with an expiry/option INSIDE the ~5–7yr hold: the premium likely resets down or the tenant leaves. This is a RISK — put it in risks/redFlags and reflect it in the grade, sized to the tenant (an anchor or large rent share paying a big premium into a near-term reset is a headline risk; a small inline is minor). It also means the OM's in-place NOI overstates sustainable NOI.
- SIGNALS ABSENT (no sales/occ-cost) → do NOT call it a strength and do NOT assume upside. Flag it to VERIFY: "in-place rent is X% above market; confirm the tenant's sales/occupancy cost support the premium — if not, this is rollover/mark-to-market DOWNSIDE at the ~YYYY expiry/option and the OM's NOI may be overstated."
- The ONLY thing that helps an above-market premium is a STRONG, RISING trade area (high income/population, market rents climbing toward the in-place rent) — that lowers rollover risk. Mention it only when the demographics clearly support it, and never as scored upside.

KPR HOUSE VIEW (the "houseView" field, if present): this is the KPR team's distilled, cross-deal underwriting philosophy — what they consistently reward and penalize, their cap-rate expectations by product type and market, and recurring concerns, learned from their reviews of past deals. Apply this lens to the grade, strengths, risks, and narrative so the analysis reflects how KPR actually thinks — while staying grounded in THIS deal's data. A deal-specific kprReview or kprThesis (if present) takes precedence over the general House View where they conflict. If houseView is absent, ignore this.

KPR REVIEW (the "kprReview" field, if present): this is the KPR team's OVERALL HUMAN ASSESSMENT of THIS deal — what they like, what concerns them, and their read on the broker's pricing / cap rate. It is the team's verdict; weave it directly into the narrative, strengths, risks, and especially the grade rationale, and let it move the grade. You may add nuance or push back where the roster/financials clearly contradict it, but give it real weight (it reflects experienced underwriting judgment, not just optimism). Where the review questions pricing (e.g. "broker's 6.5% is too expensive for this product/market"), reflect that as a pricing/return risk. If kprReview is absent, ignore this.

KPR THESIS (the "kprThesis" field, if present): this is the KPR acquisitions team's own stated thesis / assumptions for the deal — why they like it, what they're underwriting to, risks they're discounting. Treat it as INFORMED INTERNAL CONTEXT and weave it into the narrative, strengths, and risks — but stay OBJECTIVE and ADVISORY: you may agree, add nuance, or PUSH BACK where the roster/financials don't support a claim. If a thesis point is contradicted by the data, say so plainly (e.g. as a risk or caveat) rather than parroting it. Do NOT let an optimistic thesis inflate the grade beyond what the numbers justify. If kprThesis is absent, ignore this.

COMPARABLE DEALS IN THE DATABASE (the "comparableDeals" field, if present): these are the MOST SIMILAR past deals KPR has already analyzed — matched by center type, shared anchor tenants, geography, and size — each with its location, key metrics (cap rate, occupancy, WALT, avg rent PSF), the grade it received, whether KPR actually OWNS it ("owned":true), the anchors it shares with THIS deal ("sharedAnchors"), and KPR's own take ("kprTake"). Use them as a RELATIVE-VALUE and CONSISTENCY anchor: position THIS deal against its closest precedents — e.g. "the in-place rent IS X% below the $Y avg across two comparable grocery-anchored centers in the database," or "priced ~50 bps tighter than [Owned Comp], which KPR bought at Z%." OWNED comps are the strongest precedents (a realized KPR trade), so weight them most. Keep the grade CONSISTENT with how similar past deals graded unless this deal's data justifies a difference — call out the difference if so. Do NOT invent comp numbers beyond what's provided, and do not treat a comp as a hard rule; it is context, not a substitute for THIS deal's data. If comparableDeals is absent, ignore this.

GROUND-TRUTH CALIBRATION (the "groundTruthCalibration" field, if present): this is a learned reality check — how OM-stated figures (NOI, cap rate, occupancy, price) have HISTORICALLY differed from what KPR ACTUALLY realized at close across the deals it owns. When the OM's headline NOI/cap/occupancy is in the direction the calibration says brokers run optimistic, treat the OM figure with appropriate skepticism in the grade and risks (e.g. "the OM's 6.5% cap likely overstates the true going-in yield; KPR's owned deals have closed ~X% wider"). Do NOT mechanically restate the figure for every deal — apply it as judgment where THIS deal's OM numbers look aggressive. If groundTruthCalibration is absent, ignore this.

LEASE RISK (anchor-dependency / co-tenancy): If a "leaseRiskExposure" block is present, it lists co-tenancy / sales-kickout exposure the APP computed from the lease documents — base rent that can convert to alternate/reduced rent (or grant a termination right) if a named anchor goes dark. NARRATE those figures; never re-derive or invent them. Fold the MATERIAL exposure into the Risks list and the narrative's risk sentence — e.g. a Tier-1 figure that is significant vs. the property's rent is a real risk ("~$X of base rent (TenantA, TenantB) converts to alternate rent if Anchor goes dark"). Tier-2 (needs a second event) is a lesser watch item. Where an executed lease has VERIFIED/mitigated a clause (Tier-1 reduced, or a tenant de-linked), reflect it as resolved rather than a live risk, and do not list a mitigated tenant as at-risk. Clauses still "OM-only (unverified)" should be framed as "subject to confirming the executed leases." Keep it proportional — a small Tier-1 relative to total rent is a minor note, not a headline. If no leaseRiskExposure block is present, ignore this.

NEW UNDERWRITING SIGNALS — fold these into the grade, strengths, risks AND the narrative when the data is present (do NOT ignore them just because they sit on individual tenants):
- EXPENSE-RECOVERY DURABILITY (reimbursementMethod): a tenant on FIXED CAM (a fixed/escalating CAM dollar amount) or a GROSS lease means the LANDLORD — not the tenant — absorbs CAM growth above the escalator, eroding NOI over the hold. If a MATERIAL share of GLA/rent is fixed-CAM or gross, raise an expense-recovery risk (underwrite conservative expense growth). Pro-rata NNN with a controllable-CAM cap is normal — NOT a flag.
- UNEXECUTED LEASES (leaseStatus = loi / proposed / signed-not-open): NOI that rests on leases not yet signed or open is NOT committed. Size it and flag it ("~$X of base rent rests on unexecuted/LOI leases — confirm execution; in-place NOI is overstated until signed").
- SALES TREND (priorSalesPSF vs salesPSF): a tenant whose sales FELL year-over-year is an early warning of renewal/credit risk — call out material decliners (especially anchors) in Risks. Rising sales support mark-to-market upside.
- PRICING POWER (recentRenewalSpreadPct): recent renewals at higher rents (e.g. +20%) are hard evidence of below-market in-place rents / pricing power — a strength supporting mark-to-market.
- OTHER INCOME (otherIncome): non-rent MARGIN income (utility resale, etc.) is less durable than contractual rent — note it and do not credit it like NOI.
- TAX REASSESSMENT: when currentAssessedValue and the purchase/asking price are both present, compare the assessed-implied market (assessedValue ÷ the state's commercial assessment ratio — e.g. Ohio ~35%, Texas ~100%) to the price. If the price is WELL ABOVE the implied current market, flag a likely property-tax reassessment INCREASE as a risk (a real go-forward NOI hit). A disclosed taxAbatement that may not survive the sale is also a risk (current taxes are artificially low).
- MOVIE THEATERS — JUDGE ON SALES PER SCREEN, NOT PSF (screens): a cinema is a big box, so its sales/SF looks tiny and is MEANINGLESS; theaters are underwritten on sales PER SCREEN (and per seat). When a theater tenant has both sales and a screen count, compute sales/screen = (salesPSF × sf) ÷ screens and judge productivity on THAT (a healthy modern theater is roughly ~$400k–$700k+ of sales per screen; well below that is a weak/at-risk location). Never call a theater's low sales/SF a red flag. If screens is null for a theater with sales, say the per-screen read needs the screen count. Same logic informs anchor viability for cinema anchors.
- LEASE VINTAGE (leaseStart): a lease's rent was priced the day it was SIGNED. A roster dominated by old paper (signed 8+ years ago) or by 2020–2021 COVID-era signings (cut when landlords had little leverage) likely sits below today's market — a mark-to-market story, gated by the timing tiers and options gate above. Conversely, the center's own RECENT signings (last ~24 months) are the best evidence of where market rent sits: if recent inline leases were signed well above the older paper, cite that spread as hard mark-to-market evidence. Ignore when leaseStart coverage is thin.
- LOCATION QUALITY (demographics: population3mi, avgHHIncome3mi/medianHHIncome3mi, trafficCountVPD): higher household income AND higher population — ESPECIALLY when BOTH are high together — generally support HIGHER rents and TIGHTER (lower) cap rates, and signal a dense INFILL / URBAN trade area where supply is constrained (a strength: durable demand, pricing power, stronger residual value). Use this as an interpretive lens: a high-density, high-income location helps justify above-average in-place rent or a tighter going-in cap, and supports mark-to-market upside; a thin or low-income trade area is the opposite (more cap-rate cushion warranted, weaker rent growth). Conversely, a deal whose rent/cap looks aggressive for a WEAK trade area is a pricing risk. Weave it into the location sentence of the narrative and the strengths/risks. Compare to comparableDeals' demographics where present rather than asserting absolute thresholds.
- OPERATOR INTEL (the "operatorIntel" field, if present): these are notes the KPR deal team typed in directly about THIS property — sales they've learned, lease changes that are expected, market/tenant color. Treat them as INFORMED FIRST-HAND CONTEXT and weave the material ones into the narrative, strengths, risks and upside. Two cautions: (1) a note tagged "(reported — not yet executed)" or "anecdotal" is an EXPECTATION / soft figure, not a committed fact — frame it as such ("Best Buy is reportedly extending five years — confirm the executed amendment") and don't let it inflate in-place NOI or the grade as if signed/verified; (2) where an intel note has already been applied to the structured data (sales/expiry), don't double-count it. If operatorIntel is absent, ignore this.

FINAL SELF-CHECK BEFORE YOU RETURN — re-read your own JSON and FIX any of these before outputting. These are the exact tie-outs verified downstream; catching them now keeps a wrong figure from landing:
- UNITS: occupancy is a PERCENT 0–100 (never a 0–1 fraction, never >100). capRate is a percent ~3–12 (not basis points like 650, not a fraction like 0.065). Per-tenant occupancyCost is a percent (e.g. 11.8, not 0.118).
- PER TENANT: rentPerSF × sf must ≈ annualRent (annualRent is BASE only — no recoveries/percentage/other folded in). salesPSF should EXCEED rentPerSF (sales below rent implies occupancy cost over 100% — almost always a units slip, e.g. sales in $000s or a total read as an annual PSF). leaseExpiry must be AFTER leaseStart (don't read the start/expiry from swapped columns). All dates ISO YYYY-MM-DD. Do not list the same tenant twice (it double-counts SF and rent), and do not merge two suites into one row.
- ROSTER vs BUILDING: occupied + vacant suite SF should reconcile to totalSF, and stated occupancy should ≈ occupied SF ÷ totalSF. If a grocery/anchor box appears on the site plan or stacking diagram but its rent-roll economics didn't come through, still include the tenant row (don't silently drop the anchor).
- VACANCY GAP — DO NOT UNDER-ROSTER THE BUILDING: if the sum of your tenant SF is materially BELOW totalSF (e.g. occupancy is 92% but your rows only cover ~83% of GLA), the missing space is almost always UNCAPTURED VACANT/AVAILABLE suites that you skipped because they had no rent. Go back to the rent roll / stacking plan / lease-up schedule and add a separate "Vacant" row (name "Vacant", its suite, its SF, null rent) for EACH available unit until the roster SF reconciles to the GLA and to the stated occupancy. Vacant suites are real data — never drop them just because they carry no rent.
- FINANCIAL THREE-WAY: NOI ÷ capRate ≈ price; NOI = EGI − OpEx and NOI ≤ EGI; pricePerSF ≈ price ÷ totalSF; grossPotentialRent ≥ the in-place base-rent roll-up. yearRenovated ≥ yearBuilt.
- When two source figures genuinely conflict, capture the rent-roll / most-recent value and NOTE the conflict in keyAssumptions rather than silently picking one. NEVER invent a precise number to force a tie-out — leave a field null if the OM doesn't disclose it.

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

// Load the full library once (or use the caller's already-loaded rows) so the snapshot
// can both RETRIEVE comparables and compute the GROUND-TRUTH calibration from it.
async function loadLibrary(library?: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  if (library) return library;
  const rows = await db.select().from(dealsTable);
  return rows.map((r) => r.data as Record<string, unknown>);
}

// Find the most-similar past deals in the library for retrieval-grounded analysis.
// Token-free; returns a compact comparables block the prompt narrates.
function buildComparablesBlock(dealData: Record<string, unknown>, all: Array<Record<string, unknown>>): Array<Record<string, unknown>> | undefined {
  const comps = findComparableDeals(dealData, all, 3);
  if (!comps.length) return undefined;
  // Trim to what the grade should reason from (drop the internal similarity score).
  return comps.map((c) => ({
    property: c.propertyName, location: c.location, centerType: c.centerType || undefined,
    totalSF: c.totalSF ?? undefined, occupancy: c.occupancy ?? undefined, walt: c.walt ?? undefined,
    capRate: c.capRate ?? undefined, noi: c.noi ?? undefined, avgRentPSF: c.weightedAvgRentPSF ?? undefined,
    grade: c.grade ?? undefined, owned: c.isOwned || undefined,
    sharedAnchors: c.sharedAnchors.length ? c.sharedAnchors : undefined,
    kprTake: c.kprTake || undefined,
  }));
}

// Build the curated snapshot the grade reads (tenant + deal subset + House View +
// lease-risk + KPR thesis/review + comparable past deals). Async because it pulls the
// shared House View text and the library. Exported so the Batch API path builds an
// IDENTICAL request to the live path. Pass `library` (already-loaded deal data rows) on
// bulk paths so we don't re-query the table per deal.
export async function buildRosterAnalysisSnapshot(dealData: Record<string, unknown>, leaseRiskSummary = "", library?: Array<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const houseView = await loadHouseViewText();
  // Retrieval (#2) + ground-truth calibration (#1): both ground the grade in KPR's own
  // data. Best-effort — never let library work break an analysis.
  let comparableDeals: Array<Record<string, unknown>> | undefined;
  let groundTruthCalibration: string | undefined;
  try {
    const all = await loadLibrary(library);
    comparableDeals = buildComparablesBlock(dealData, all);
    const cal = computePortfolioCalibration(all);
    groundTruthCalibration = cal.guidance || undefined;
  } catch { /* analysis proceeds without library grounding */ }
  const t = Array.isArray(dealData.tenants) ? (dealData.tenants as Array<Record<string, unknown>>) : [];
  const thesis = typeof dealData.dealThesis === "string" ? dealData.dealThesis.trim() : "";
  const review = typeof dealData.dealReview === "string" ? dealData.dealReview.trim() : "";
  // Operator-typed intel (Add-Intel box) — qualitative color + reported (not-yet-
  // executed) changes. Surface the recent notes so the grade/narrative reflects them.
  const intelArr = Array.isArray(dealData.dealIntel) ? (dealData.dealIntel as Array<Record<string, unknown>>) : [];
  const dealIntel = intelArr.length
    ? intelArr.slice(-12).map((e) => {
        const txt = typeof e.text === "string" ? e.text.trim() : "";
        const applied = typeof e.applied === "string" && e.applied ? ` [applied: ${e.applied}]` : "";
        return txt ? `${txt}${applied}` : null;
      }).filter(Boolean)
    : undefined;
  const snapshot = {
    houseView: houseView || undefined,
    leaseRiskExposure: leaseRiskSummary || undefined,
    kprReview: review || undefined,
    comparableDeals: comparableDeals && comparableDeals.length ? comparableDeals : undefined,
    groundTruthCalibration,
    propertyName: dealData.propertyName, address: dealData.address, city: dealData.city, state: dealData.state,
    assetType: dealData.assetType, centerType: dealData.centerType,
    totalSF: dealData.totalSF, occupancy: dealData.occupancy, walt: dealData.walt,
    askingPrice: dealData.askingPrice, capRate: dealData.capRate, noi: dealData.noi,
    weightedAvgRentPSF: dealData.weightedAvgRentPSF, grossPotentialRent: dealData.grossPotentialRent,
    tenantsAsOf: dealData.tenantsAsOf, tenantsSource: dealData.tenantsSource,
    marketDemographics: dealData.marketDemographics ?? null,
    // Flat demographic fields (the rent/cap ↔ income+population relationship): high
    // income AND population together signal an infill/urban location that supports
    // higher rents and tighter cap rates — see the LOCATION QUALITY signal in the prompt.
    population3mi: dealData.population3mi ?? undefined,
    medianHHIncome3mi: dealData.medianHHIncome3mi ?? undefined,
    avgHHIncome3mi: dealData.avgHHIncome3mi ?? undefined,
    trafficCountVPD: dealData.trafficCountVPD ?? undefined,
    kprThesis: thesis || undefined,
    operatorIntel: dealIntel && dealIntel.length ? dealIntel : undefined,
    // Center-level non-rent income (utility resale, EV, parking, storage) — durability
    // of NOI; and the current tax facts so the grade can flag a reassessment step-up.
    otherIncome: dealData.otherIncome ?? undefined,
    currentAssessedValue: dealData.currentAssessedValue, currentMarketValue: dealData.currentMarketValue,
    currentAnnualTaxes: dealData.currentAnnualTaxes, taxAbatement: dealData.taxAbatement ?? undefined,
    tenants: t.map((x) => ({
      name: x.name, sf: x.sf, rentPerSF: x.rentPerSF, annualRent: x.annualRent,
      // leaseStart = lease VINTAGE: when the rent was priced. Old or 2020–2021
      // (COVID-era) signings usually trail today's market — see LEASE VINTAGE signal.
      leaseStart: x.leaseStart,
      leaseExpiry: x.leaseExpiry, remainingTermYears: x.remainingTermYears,
      isAnchor: x.isAnchor, isNAP: x.isNAP, isDark: x.isDark, creditRating: x.creditRating,
      leaseType: x.leaseType, rentSchedule: x.rentSchedule,
      // Needed to judge whether below-market rent is REAL mark-to-market upside
      renewalOptions: x.renewalOptions, rentBumps: x.rentBumps,
      salesPSF: x.salesPSF, salesYear: x.salesYear, occupancyCost: x.occupancyCost,
      // Movie theaters are judged on sales PER SCREEN, not PSF — see ANCHOR / CINEMA signal.
      screens: x.screens,
      // Recovery durability (fixed-CAM/gross = landlord bears expense growth),
      // execution status (LOI/not-open = NOI not yet committed), sales TREND
      // (prior vs current = a declining-sales early warning), recent-renewal pricing
      // power, and overage rent — so the GRADE reflects these, not just the deal page.
      reimbursementMethod: x.reimbursementMethod, leaseStatus: x.leaseStatus,
      priorSalesPSF: x.priorSalesPSF, priorSalesYear: x.priorSalesYear,
      recentRenewalSpreadPct: x.recentRenewalSpreadPct, percentageRent: x.percentageRent,
    })),
  };
  return snapshot;
}

// The EXACT Anthropic request params for one roster-analysis pass. Shared by the live
// call (runRosterAnalysis) and the Batch API path so the two can never drift. Prompt
// caching: the static ROSTER_ANALYSIS_PROMPT is identical every refresh, so cache it;
// only the per-deal snapshot JSON varies.
export function rosterAnalysisParams(snapshot: Record<string, unknown>): Record<string, unknown> {
  return {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    messages: [{ role: "user", content: [
      { type: "text", text: ROSTER_ANALYSIS_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: JSON.stringify(snapshot, null, 1) },
    ] }],
  };
}

// Parse a roster-analysis MESSAGE (the Anthropic message object, { content, stop_reason })
// into the deal fields it writes. Shared by the live and Batch paths.
export function parseRosterAnalysisMessage(message: Record<string, unknown>): Record<string, unknown> {
  const blocks = message.content as Array<{ type: string; text?: string }>;
  const raw = blocks?.find((b) => b.type === "text")?.text ?? "";
  if (!raw) throw new Error(`AI returned empty content. stop_reason=${message.stop_reason}`);
  const parsed = robustParseJSON(raw) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (parsed.notes != null) out.notes = parsed.notes;
  if (parsed.dealScore != null) out.dealScore = parsed.dealScore;
  if (parsed.upsideItems != null) out.upsideItems = parsed.upsideItems;
  if (parsed.redFlags != null) out.redFlags = parsed.redFlags;
  return out;
}

export async function runRosterAnalysis(dealData: Record<string, unknown>, leaseRiskSummary = "", library?: Array<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const snapshot = await buildRosterAnalysisSnapshot(dealData, leaseRiskSummary, library);
  const upstream = await callAnthropicOnce(rosterAnalysisParams(snapshot));
  const data = await upstream.json() as Record<string, unknown>;
  if (!upstream.ok) {
    const errMsg = typeof data.error === "object" && data.error !== null
      ? (data.error as Record<string, unknown>).message ?? JSON.stringify(data.error)
      : String(data.error ?? "Unknown error");
    throw new Error(String(errMsg));
  }
  return parseRosterAnalysisMessage(data);
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
    // Post-extraction validators → fold into Import-Review questions. Two families:
    // (1) lease-risk (unverified OM co-tenancy/kickout, decreasing "increase" steps);
    // (2) deterministic arithmetic tie-outs (roster SF vs GLA, occupancy, NOI/cap/price,
    //     rent roll-up, per-tenant rent×SF, duplicate suites, unit sanity).
    // AUTO-CLEAN at import: apply the deterministic, UNAMBIGUOUS fixes (occupancy-cost
    // units, duplicate rows, derived metrics) BEFORE the audit, so the deal lands clean
    // and those classes never reach the user as flags. Rent/deal-level ambiguity is left
    // for the audit below. Must never break an upload.
    try {
      const fix = applyImportFixes(dealData);
      if (fix.changed) {
        Object.assign(dealData, fix.deal);
        log.info({ id, occCostFixed: fix.occCostFixed, dupeFixed: fix.dupeFixed, metricFixes: fix.metricFixes, dateFixed: fix.dateFixed, rentFilled: fix.rentFilled }, "Import auto-clean applied");
      }
    } catch { /* auto-clean must never break an upload */ }
    try {
      const lrChecks = validateLeaseRiskAtExtraction(dealData);
      const auditChecks = auditExtraction(dealData);
      // Source-level: warn up front if the OM's text layer was essentially empty
      // (scanned / image-based), so a sparse read isn't mistaken for "no data".
      const srcChecks = auditSourceText(text, pageCount);
      // Second-reader: a cheap Haiku pass re-checks the headline numbers against the
      // OM and flags quote-grounded disagreements. Best-effort — returns [] on any error.
      const verifyChecks = await verifyExtraction(text, dealData, log);
      const allChecks = [...lrChecks, ...auditChecks, ...srcChecks, ...verifyChecks];
      if (allChecks.length) {
        const existing = Array.isArray(dealData.reviewQuestions) ? dealData.reviewQuestions as unknown[] : [];
        const seen = new Set(existing.map((q) => (q as { id?: string })?.id));
        dealData.reviewQuestions = [...existing, ...allChecks.filter((q) => !seen.has(q.id))];
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
