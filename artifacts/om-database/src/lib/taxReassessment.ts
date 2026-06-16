// ─────────────────────────────────────────────────────────────────────────────
// Property-tax REASSESSMENT engine, by state (+ DC).
//
// Answers the underwriting question a broker pro forma quietly ignores: when we
// BUY this center, do the taxes reset — and by how much?
//
// TWO LAYERS (kept distinct on purpose — see the project notes on county-vs-state):
//   1. STATE FRAMEWORK (this file): the LEGAL rules — does a sale reset the
//      assessment, on what BASIS, the assessment RATIO (assessed ÷ market), the
//      reassessment CYCLE, and any growth CAP. These are statute, with a source +
//      confidence tier per state (same discipline as closingCosts.ts).
//   2. THE PROPERTY'S ACTUAL BILL (engine inputs): current assessed value + current
//      annual taxes from the OM's tax page (or hand-entered). The engine grounds the
//      dollar estimate in the property's REAL effective rate (taxes ÷ assessed),
//      which sidesteps modeling thousands of local millages — even for an
//      un-codified county the step-up math is right because it uses the real bill.
//
// `countyDriven: true` flags states where the CYCLE/RATIO is set locally (PA, NJ,
// NY, OH, ME, NC, …) — the framework still holds, but confirm the specific
// county's cadence/equalization for a live deal.
//
// Rates/rules CHANGE. Every entry carries a confidence tier and a source; treat as
// a careful estimate, verify for any live deal, and never present a bare number.
// ─────────────────────────────────────────────────────────────────────────────

export type SaleTrigger = "yes" | "no" | "partial";
// What the assessment resets toward on/after a qualifying sale:
//   acquisition_price — locked to the purchase price (CA Prop 13)
//   market_value      — full market value (often ≈ purchase price for an arm's-length deal)
//   equalized_value   — a statutory equalized/state-equalized value (MI SEV = 50% of market; PA CLR)
//   none              — assessment does not reset on sale at all
export type ResetBasis = "acquisition_price" | "market_value" | "equalized_value" | "none";
export type CapType = "assessment" | "tax_bill" | null; // some caps limit the BILL, not the value
export type Confidence = "high" | "medium" | "low";

export interface TaxSource { title: string; url: string }

export interface TaxJurisdiction {
  state: string;            // 2-letter (or "DC")
  stateName: string;
  saleTriggersReassessment: SaleTrigger;
  reassessmentBasis: ResetBasis;
  saleTriggerNote: string;  // plain-English mechanic shown to the user
  assessmentCycleYears: number;   // 1 = annual-to-market; 0 = no fixed cycle (locality-driven); N = every N years
  cycleNote?: string;
  assessmentRatioCommercialPct: number | null; // assessed = market × ratio/100; null = no single statewide ratio
  ratioNote?: string;
  annualCapPctCommercial: number | null;        // cap on growth; null = none
  capType?: CapType;
  capNote?: string;
  countyDriven?: boolean;   // cycle/ratio set at county/municipal level
  buyerFavorableCeiling?: boolean; // sale sets a one-year MAX value (GA) — protective, not a step-up
  scAtiExemption?: boolean; // SC: optional up-to-25% ATI exemption on the post-sale value
  // Known SCHEDULED statutory changes (ratio phase-downs, cap sunsets) with an
  // effective date — surfaced as a forward-looking trigger when they fall in the hold.
  upcomingChanges?: { effective: string; direction: "increase" | "decrease" | "uncertain"; note: string }[];
  confidence: Confidence;
  sources: TaxSource[];
  caveat?: string;
}

// ── The ruleset ──────────────────────────────────────────────────────────────
// 40 states codified from statutory/DOR research (Jun 2026). The remaining 11
// (HI, ID, IL, SD, TN, TX, UT, WV, WI, WY, DC) resolve to a graceful "not yet
// codified" fallback until added.
export const TAX_JURISDICTIONS: Record<string, TaxJurisdiction> = {
  AL: { state: "AL", stateName: "Alabama", saleTriggersReassessment: "partial", reassessmentBasis: "market_value",
    saleTriggerNote: "Class II commercial is assessed at 20% of market. A sale STRIPS the new 7%/yr assessed-value cap (Act 2024-344), so the property resets to full market value the following year.",
    assessmentCycleYears: 1, cycleNote: "Annual to fair market value; 4-yr equalization (¼ of county/yr).",
    assessmentRatioCommercialPct: 20, ratioNote: "Class II (commercial) = 20% of fair market value.",
    annualCapPctCommercial: 7, capType: "assessment", capNote: "7% cap removed on sale/transfer (Act 2024-344, eff. 2025).",
    confidence: "high", sources: [{ title: "Alabama DOR — 7% Cap (HB73/Act 2024-344)", url: "https://www.revenue.alabama.gov/property-tax/7-cap-information-hb73-act-2024-344/" }] },
  AK: { state: "AK", stateName: "Alaska", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Purely local (borough/city) tax; all property assessed annually at 100% of full & true (market) value. A sale does not reset the parcel — it just informs the next annual value.",
    assessmentCycleYears: 1, cycleNote: "Annual to full market value; only ~24 municipalities levy a property tax.",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null, countyDriven: true,
    confidence: "high", sources: [{ title: "Alaska Office of the State Assessor — Tax Facts", url: "https://www.commerce.alaska.gov/web/dcra/officeofthestateassessor/alaskataxfacts.aspx" }] },
  AZ: { state: "AZ", stateName: "Arizona", saleTriggersReassessment: "no", reassessmentBasis: "none",
    saleTriggerNote: "A sale does NOT reset value. The Limited Property Value (the taxable value) carries through the sale and grows max 5%/yr (Prop 117) — a buyer INHERITS the seller's capped basis, a positive vs. California.",
    assessmentCycleYears: 1, cycleNote: "Annual; LPV recomputed under the 5% cap, reset only on new construction/use change/split.",
    assessmentRatioCommercialPct: 16, ratioNote: "Class 1 commercial ratio, phasing ~0.5%/yr toward 15% (~2027); 16% for TY2025.",
    annualCapPctCommercial: 5, capType: "assessment", capNote: "5% LPV cap; NOT reset by sale.",
    upcomingChanges: [{ effective: "2027", direction: "decrease", note: "SB1828 phases the Class 1 (commercial) assessment ratio down toward 15% (~0.5%/yr) — a modest tailwind on the assessed-value side." }],
    confidence: "high", sources: [{ title: "Arizona DOR — Limited Property Value (Prop 117)", url: "https://azdor.gov/sites/default/files/2023-03/PROPERTY_LimitedPropertyValue.pdf" }],
    caveat: "Commercial ratio is a moving target (SB1828 phase-down); confirm the exact current-year ratio." },
  AR: { state: "AR", stateName: "Arkansas", saleTriggersReassessment: "partial", reassessmentBasis: "market_value",
    saleTriggerNote: "A sale strips the Amendment 79 10%/yr cap; the property snaps to full 20%-of-appraised (county market) value the next assessment — not to the purchase price, but a real step-up.",
    assessmentCycleYears: 5, cycleNote: "County 3/4/5-yr reappraisal cycle (4 typical); 3-yr when growth >15%.",
    assessmentRatioCommercialPct: 20, ratioNote: "20% of appraised value (all classes).",
    annualCapPctCommercial: 10, capType: "assessment", capNote: "Amendment 79 commercial cap (10%); removed on sale.",
    countyDriven: true, confidence: "high", sources: [{ title: "Arkansas Constitution Amendment 79", url: "https://law.justia.com/constitution/arkansas/amendments/amendment-79/" }] },
  CA: { state: "CA", stateName: "California", saleTriggersReassessment: "yes", reassessmentBasis: "acquisition_price",
    saleTriggerNote: "Prop 13: a change of ownership reassesses to current market value — for an arm's-length purchase, the PURCHASE PRICE — as the new base-year value (+2%/yr until the next sale). The single biggest tax surprise in CA retail underwriting.",
    assessmentCycleYears: 0, cycleNote: "Acquisition-value (event-driven); no periodic market reappraisal.",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: 2, capType: "assessment", capNote: "2%/yr inflation cap between ownership changes.",
    confidence: "high", sources: [{ title: "California BOE — Change in Ownership FAQs", url: "https://www.boe.ca.gov/proptaxes/faqs/changeinownership.htm" }] },
  CO: { state: "CO", stateName: "Colorado", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Biennial reappraisal to market; a sale does not reset the parcel. Next odd-year reappraisal steps toward market.",
    assessmentCycleYears: 2, cycleNote: "Biennial (odd-year) reappraisal.",
    assessmentRatioCommercialPct: 25, ratioNote: "Improved commercial 25% (2025/26); general nonresidential 27%→25% by 2027.",
    annualCapPctCommercial: null,
    upcomingChanges: [{ effective: "2027", direction: "decrease", note: "SB24-233 steps the general nonresidential assessment ratio from 27% down to 25% by 2027 — a slight assessed-value reduction." }],
    confidence: "high", sources: [{ title: "Colorado General Assembly — SB24-233", url: "https://leg.colorado.gov/bills/sb24-233" }] },
  CT: { state: "CT", stateName: "Connecticut", saleTriggersReassessment: "no", reassessmentBasis: "none",
    saleTriggerNote: "Assessed at 70% of market from the town's last revaluation; value is frozen between 5-yr revals (except new construction). A sale does not trigger reassessment.",
    assessmentCycleYears: 5, cycleNote: "Municipal revaluation ≥ every 5 yrs (CGS 12-62).",
    assessmentRatioCommercialPct: 70, ratioNote: "Uniform 70% of fair market value (CGS 12-62a).",
    annualCapPctCommercial: null, countyDriven: true, confidence: "high", sources: [{ title: "CT OPM — Statutes Governing Property Assessment", url: "https://portal.ct.gov/OPM/IGPP/Services-and-Forms/Statutes-Governing-Property-Assessment-and-Taxation" }] },
  DE: { state: "DE", stateName: "Delaware", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "County-administered, 100% of market from the recent court-ordered reassessments; new ~5-yr cycle going forward. No sale reset.",
    assessmentCycleYears: 5, cycleNote: "Post-2024 reassessments; ≥ every 5 yrs going forward.",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null, countyDriven: true,
    confidence: "medium", sources: [{ title: "Morris Nichols — DE Reassessment (commercial)", url: "https://www.morrisnichols.com/insights-delaware-issues-long-awaited-property-tax-reassessments-what-commercial-propety-owners-should-know" }],
    caveat: "Post-reassessment millages still settling (2024-26); verify per county." },
  FL: { state: "FL", stateName: "Florida", saleTriggersReassessment: "partial", reassessmentBasis: "market_value",
    saleTriggerNote: "Assessed to just (market) value every Jan 1. For non-homestead/commercial, the 10%/yr cap RESETS on a qualifying change of ownership — value steps to full market the following Jan 1 (and school millage is on full value regardless).",
    assessmentCycleYears: 1, cycleNote: "Annual to just value by the County Property Appraiser.",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: 10, capType: "assessment", capNote: "10% non-homestead cap; resets on change of ownership.",
    confidence: "high", sources: [{ title: "Pinellas County PA — Non-Homestead 10% Cap", url: "https://www.pcpao.gov/learn-more/non-homestead-10-cap" }] },
  GA: { state: "GA", stateName: "Georgia", saleTriggersReassessment: "partial", reassessmentBasis: "market_value",
    saleTriggerNote: "Assessed at 40% of market annually. A recent arm's-length sale sets the MAXIMUM next-year value at the sale price (O.C.G.A. 48-5-2) — a one-year CEILING that protects the buyer, not an upward reset.",
    assessmentCycleYears: 1, cycleNote: "Annual county valuation; no fixed multi-year cycle.",
    assessmentRatioCommercialPct: 40, ratioNote: "40% of fair market value (O.C.G.A. 48-5-7).",
    annualCapPctCommercial: null, buyerFavorableCeiling: true,
    confidence: "high", sources: [{ title: "O.C.G.A. 48-5-2 (sale price = max next-year value)", url: "https://law.justia.com/codes/georgia/title-48/chapter-5/article-1/section-48-5-2/" }] },
  KY: { state: "KY", stateName: "Kentucky", saleTriggersReassessment: "partial", reassessmentBasis: "market_value",
    saleTriggerNote: "The constitution requires annual assessment at 100% fair cash value; in practice PVAs commonly move a sold parcel toward the purchase price at the next Jan 1. A market reset, not a statutory acquisition lock.",
    assessmentCycleYears: 1, cycleNote: "Annual (Jan 1); physical inspection ≥ every 4 yrs.",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null,
    confidence: "high", sources: [{ title: "Kentucky DOR — Assessment Process for Real Property", url: "https://revenue.ky.gov/Property/Pages/TheAssessmentProcessforRealProperty.aspx" }] },
  LA: { state: "LA", stateName: "Louisiana", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Quadrennial reappraisal; commercial improvements at 15% / land at 10% of market. Sales-chasing is prohibited — value steps up at the next 4-yr cycle (next statewide 2028), not on the sale itself.",
    assessmentCycleYears: 4, cycleNote: "Constitutional 4-yr (quadrennial) reappraisal.",
    assessmentRatioCommercialPct: 15, ratioNote: "Commercial improvements 15% / land 10% of market.",
    annualCapPctCommercial: null, confidence: "high", sources: [{ title: "Louisiana Constitution Art. VII §18", url: "https://www.lawserver.com/law/state/louisiana/la-constitution/louisiana_constitution_art_7_sec_18" }] },
  ME: { state: "ME", stateName: "Maine", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Municipal 'just value' (target 100%, often a lower uniform certified ratio). No fixed statewide cycle and no acquisition reset; a sale informs the next town revaluation.",
    assessmentCycleYears: 0, cycleNote: "Municipal; revaluation forced when assessment/sales ratio < 70%.",
    assessmentRatioCommercialPct: 100, ratioNote: "Target 100% of just value; towns may use a lower certified ratio.",
    annualCapPctCommercial: null, countyDriven: true, confidence: "medium", sources: [{ title: "Maine Title 36 §701-A — Just value", url: "https://www.mainelegislature.org/legis/statutes/36/title36sec701-A.html" }] },
  MD: { state: "MD", stateName: "Maryland", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "SDAT reassesses on a 3-yr cycle to market; increases phase in over 3 yrs. The homestead cap does NOT apply to commercial — so at the next scheduled reassessment a commercial parcel steps fully to market (a recent sale is strong evidence), with no cap protection.",
    assessmentCycleYears: 3, cycleNote: "Triennial (state split into 3 groups); increases phase in over 3 yrs.",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null,
    confidence: "high", sources: [{ title: "Maryland SDAT — Real Property Assessment Q&A", url: "https://dat.maryland.gov/realproperty/Pages/Questions-and-Answers-About-Real-Property-Assessments.aspx" }] },
  IN: { state: "IN", stateName: "Indiana", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Annual market 'trending'; 'sales-chasing' a single sold parcel is barred. The tax BILL is capped at 3% of gross assessed value (circuit breaker). No sale reset.",
    assessmentCycleYears: 1, cycleNote: "Annual trending; 4-yr rolling physical reassessment.",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: 3, capType: "tax_bill", capNote: "Circuit-breaker: bill ≤ 3% of gross assessed value (commercial).",
    confidence: "high", sources: [{ title: "Indiana DLGF — Circuit Breaker Caps", url: "https://www.in.gov/dlgf/files/240429-Fact-Sheet-Circuit-Breaker-Caps.pdf" }] },
  IA: { state: "IA", stateName: "Iowa", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Biennial (odd-year) revaluation to 100% market; a statewide 'rollback' converts assessed to taxable value (commercial 90% above $150k). No sale reset.",
    assessmentCycleYears: 2, cycleNote: "Revaluation in odd years; even years carry forward.",
    assessmentRatioCommercialPct: 100, ratioNote: "Assessed at 100% market; rollback applies to get taxable value.",
    annualCapPctCommercial: null, confidence: "high", sources: [{ title: "Iowa DOR — Property Tax Overview", url: "https://revenue.iowa.gov/taxes/tax-guidance/property-tax/iowa-property-tax-overview" }] },
  KS: { state: "KS", stateName: "Kansas", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Annual market appraisal; commercial assessed at 25% of market. A sale informs but does not legally reset the parcel.",
    assessmentCycleYears: 1, cycleNote: "Annual (Jan 1) mass appraisal.",
    assessmentRatioCommercialPct: 25, ratioNote: "Commercial 25% of fair market value (K.S.A. 79-1439).",
    annualCapPctCommercial: null, confidence: "high", sources: [{ title: "K.S.A. 79-1439 — Assessment rates", url: "https://ksrevisor.gov/statutes/chapters/ch79/079_014_0039.html" }] },
  MA: { state: "MA", stateName: "Massachusetts", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Annual 100%-of-market mass appraisal (DOR recert ≥ every 5 yrs). Many towns adopt a split rate (higher commercial RATE). No per-parcel reset on sale.",
    assessmentCycleYears: 1, cycleNote: "Annual adjustment; DOR full certification every 5 yrs.",
    assessmentRatioCommercialPct: 100, ratioNote: "100% of full & fair cash value (split RATE ≠ split ratio).",
    annualCapPctCommercial: null, confidence: "high", sources: [{ title: "Mass.gov — Property Assessments & Taxation (commercial)", url: "https://www.mass.gov/info-details/re103c17-property-assessments-valuation-taxation-in-commercial-real-estate" }] },
  MI: { state: "MI", stateName: "Michigan", saleTriggersReassessment: "yes", reassessmentBasis: "equalized_value",
    saleTriggerNote: "Proposal A: a transfer of ownership UNCAPS taxable value to the State Equalized Value (50% of market) the next year (MCL 211.27a) — and a >50% (even cumulative) entity-interest transfer counts. Taxes can jump sharply vs. the seller's long-capped figure.",
    assessmentCycleYears: 1, cycleNote: "SEV set annually (50% of true cash value); taxable value capped below it until uncapping.",
    assessmentRatioCommercialPct: 50, ratioNote: "Assessed/SEV = 50% of true cash value; taxable resets to SEV the year after transfer.",
    annualCapPctCommercial: 5, capType: "assessment", capNote: "Taxable-value cap = lesser of 5% or CPI; uncaps on transfer.",
    confidence: "high", sources: [{ title: "MCL 211.27a — Michigan Legislature", url: "https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-211-27a" }] },
  MN: { state: "MN", stateName: "Minnesota", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Annual 100%-of-market (EMV); class-rate system loads extra burden on commercial. No per-parcel reset on sale.",
    assessmentCycleYears: 1, cycleNote: "Annual (Jan 2); 5-yr quintile physical reinspection.",
    assessmentRatioCommercialPct: 100, ratioNote: "EMV 100% of market; class rates + state C/I levy raise the effective burden.",
    annualCapPctCommercial: null, confidence: "high", sources: [{ title: "Minnesota DOR — Estimated Market Value", url: "https://www.revenue.state.mn.us/estimated-market-value" }] },
  MS: { state: "MS", stateName: "Mississippi", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "≤4-yr county reappraisal; commercial (Class II) at 15% of true value. No sale reset.",
    assessmentCycleYears: 4, cycleNote: "Reappraisal ≥ every 4 yrs.",
    assessmentRatioCommercialPct: 15, ratioNote: "Class II commercial = 15% of true value.",
    annualCapPctCommercial: null, confidence: "high", sources: [{ title: "Mississippi DOR — Property Tax FAQ", url: "https://www.dor.ms.gov/county-services/property-tax-frequently-asked-questions" }] },
  MO: { state: "MO", stateName: "Missouri", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Biennial odd-year reassessment; commercial at 32% of market. No sale reset; next odd-year steps to market.",
    assessmentCycleYears: 2, cycleNote: "Biennial reassessment in odd years.",
    assessmentRatioCommercialPct: 32, ratioNote: "Commercial (subclass 3) = 32% of true value.",
    annualCapPctCommercial: null, confidence: "high", sources: [{ title: "Missouri State Tax Commission — Reassessment", url: "https://stc.mo.gov/wp-content/uploads/sites/5/2019/05/Property-Reassessment-Pamphlet-5-23-19.pdf" }] },
  MT: { state: "MT", stateName: "Montana", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Central DOR biennial reappraisal at 100% of market. No sale reset.",
    assessmentCycleYears: 2, cycleNote: "Biennial reappraisal (statewide DOR).",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null, confidence: "medium",
    sources: [{ title: "Montana Legislative Fiscal — Property Tax Overview 2025", url: "https://archive.legmt.gov/content/Publications/fiscal/2027-Biennium/Publications-and-Libraries/Libraries/Property-Tax/Property-Tax-Overview-2025.pdf" }],
    caveat: "2025 reform changed class rates/tiering — verify current commercial treatment." },
  NE: { state: "NE", stateName: "Nebraska", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Annual assessment at 100% of market (statutory 92-100% range). No sale reset.",
    assessmentCycleYears: 1, cycleNote: "Annual (Jan 1).",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null, confidence: "high",
    sources: [{ title: "Nebraska DOR — Real Property Assessment Guide", url: "https://revenue.nebraska.gov/sites/default/files/doc/pad/info/Real_Property_Assessment.pdf" }] },
  NV: { state: "NV", stateName: "Nevada", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Cost method (land market + depreciated replacement cost); assessed = 35% of taxable value. A sale does NOT reset to price, and the 8% tax-bill cap runs with the property. Cost method can under-tax older improvements vs. market.",
    assessmentCycleYears: 5, cycleNote: "Reappraisal ≥ every 5 yrs (many counties annual).",
    assessmentRatioCommercialPct: 35, ratioNote: "Assessed = 35% of taxable value (cost-method taxable value).",
    annualCapPctCommercial: 8, capType: "tax_bill", capNote: "8% commercial tax-bill abatement cap (runs with property).",
    confidence: "high", sources: [{ title: "Clark County NV — Tax Abatement / Cap", url: "https://www.clarkcountynv.gov/government/general_information/tax-abatement" }] },
  NH: { state: "NH", stateName: "New Hampshire", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Municipal full revaluation ≥ every 5 yrs to ~100% of market. A sale informs the next reval, not an automatic reset.",
    assessmentCycleYears: 5, cycleNote: "Full reval ≥ every 5 yrs (RSA 75:8-a).",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null, countyDriven: true,
    confidence: "high", sources: [{ title: "NH Municipal Assoc. — Revaluation (RSA 75:8-a)", url: "https://www.nhmunicipal.org/town-city-magazine/new-hampshire-town-and-city-july-august-2024/legal-qa-assessing-re-assessments" }] },
  NJ: { state: "NJ", stateName: "New Jersey", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "No fixed cycle; assessed at a municipal equalization ('director's') ratio of true value. A sale doesn't statutorily reset the parcel ('welcome stranger' barred), but a high price can feed a lawful reassessment in annual-reassessment towns.",
    assessmentCycleYears: 0, cycleNote: "No mandated cycle; revaluation ordered when the assessment/sales ratio drifts.",
    assessmentRatioCommercialPct: 100, ratioNote: "Legal 100% of true value, but apply the municipality's equalization ratio (often well below 100%).",
    annualCapPctCommercial: null, countyDriven: true, confidence: "high",
    sources: [{ title: "NJ Division of Taxation — Revaluations", url: "https://www.nj.gov/treasury/taxation/pdf/lpt/revaluation.pdf" }] },
  NM: { state: "NM", stateName: "New Mexico", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Commercial is valued to market annually at 1/3 (33.33%) of value; the 3% cap is residential-only. A change of ownership is largely irrelevant for commercial.",
    assessmentCycleYears: 1, cycleNote: "Annual market valuation (NMSA 7-36-15).",
    assessmentRatioCommercialPct: 33.33, ratioNote: "1/3 of market value (all classes).",
    annualCapPctCommercial: null, confidence: "high", sources: [{ title: "NMSA 7-36-21.2 (residential-only cap)", url: "https://law.justia.com/codes/new-mexico/chapter-7/article-36/section-7-36-21-2/" }] },
  NY: { state: "NY", stateName: "New York", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "No statewide cycle/ratio; locally set. Singling out a sold parcel ('welcome stranger') is improper. NYC Class 4 commercial = 45% of DOF market value, with increases phased in 20%/yr over 5 yrs. No sale reset.",
    assessmentCycleYears: 0, cycleNote: "No statewide cycle; ~half of localities reassess annually, others lag.",
    assessmentRatioCommercialPct: null, ratioNote: "No single statewide ratio; use the locality's level/equalization rate (NYC Class 4 = 45%).",
    annualCapPctCommercial: null, countyDriven: true, confidence: "high",
    sources: [{ title: "NYS Tax — Reassessments", url: "https://www.tax.ny.gov/pit/property/learn/reassess.htm" }] },
  NC: { state: "NC", stateName: "North Carolina", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Octennial (≤8-yr; many urban/retail counties advance to 4-yr) reappraisal at 100% of market. Interim changes for a sale are barred (G.S. 105-287) — value holds until the next reappraisal.",
    assessmentCycleYears: 8, cycleNote: "General reappraisal ≥ every 8 yrs; commonly 4 yrs in urban counties.",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null, countyDriven: true,
    confidence: "high", sources: [{ title: "N.C. G.S. 105-286 / 105-287", url: "https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/BySection/Chapter_105/GS_105-287.pdf" }] },
  ND: { state: "ND", stateName: "North Dakota", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Annual to true & full value; commercial taxable = 5% of market (50% assessed × 10% commercial). No sale reset.",
    assessmentCycleYears: 1, cycleNote: "Annual valuation (Feb 1); multi-yr physical reinspection.",
    assessmentRatioCommercialPct: 5, ratioNote: "Taxable = 5% of market (50% assessed × 10% commercial).",
    annualCapPctCommercial: null, confidence: "high", sources: [{ title: "ND Office of State Tax Commissioner — Commercial Property Tax", url: "https://www.tax.nd.gov/commercial-property-tax" }] },
  OH: { state: "OH", stateName: "Ohio", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Sexennial (6-yr) reappraisal + 3-yr update; commercial at 35% of market. A sale does NOT auto-reset outside the cycle (HB126 curbed sale-based value challenges), though the auditor may use a sale as evidence at the next update.",
    assessmentCycleYears: 6, cycleNote: "6-yr sexennial reappraisal + year-3 triennial update (county-staggered).",
    assessmentRatioCommercialPct: 35, ratioNote: "35% of true value (all real property).",
    annualCapPctCommercial: null, countyDriven: true, confidence: "high",
    sources: [{ title: "Ohio Dept of Taxation — Sexennial/Triennial schedule", url: "https://dam.assets.ohio.gov/image/upload/tax.ohio.gov/real_estate/yearofsexennialreappraisalandupdate-2025-2030.pdf" }] },
  OK: { state: "OK", stateName: "Oklahoma", saleTriggersReassessment: "partial", reassessmentBasis: "market_value",
    saleTriggerNote: "A 5%/yr cap holds commercial fair-cash value down; a transfer REMOVES the cap and resets the parcel to full market value the following year. Not to acquisition price, but a real sale-driven step-up.",
    assessmentCycleYears: 1, cycleNote: "Annual; 4-yr visual inspection cycle.",
    assessmentRatioCommercialPct: 11, ratioNote: "Real-property ratio 11-13.5% (county-set; ~11% in Tulsa/Oklahoma Co.).",
    annualCapPctCommercial: 5, capType: "assessment", capNote: "5% commercial cap; removed on transfer.",
    countyDriven: true, confidence: "medium", sources: [{ title: "Okla. Const. Art. X §8/§8B", url: "https://oksenate.gov/sites/default/files/2022-05/oc10.pdf" }],
    caveat: "Confirm the county's exact ratio (11-13.5%) and §2817.1 reset timing." },
  OR: { state: "OR", stateName: "Oregon", saleTriggersReassessment: "no", reassessmentBasis: "none",
    saleTriggerNote: "Measure 50: the Maximum Assessed Value grows ≤3%/yr and does NOT reset on sale — the buyer INHERITS the seller's low MAV. A genuine positive vs. California (taxable = lesser of MAV or market).",
    assessmentCycleYears: 1, cycleNote: "Annual; MAV +3%/yr, reset only on new construction/use change/split.",
    assessmentRatioCommercialPct: 100, ratioNote: "Taxable = lesser of MAV or real market value; MAV usually well below market.",
    annualCapPctCommercial: 3, capType: "assessment", capNote: "MAV growth capped at 3%/yr; not reset by sale.",
    confidence: "high", sources: [{ title: "Oregon DOR — Maximum Assessed Value Manual", url: "https://www.oregon.gov/DOR/forms/FormsPubs/maximum-assessed-value-manual_303-438.pdf" }] },
  PA: { state: "PA", stateName: "Pennsylvania", saleTriggersReassessment: "no", reassessmentBasis: "equalized_value",
    saleTriggerNote: "No statewide cycle; county base-year + a Common Level Ratio. Spot reassessment on sale is barred (53 Pa.C.S. §8843), BUT a school district can file a sale-price APPEAL to raise the assessment — a real post-purchase risk.",
    assessmentCycleYears: 0, cycleNote: "No mandated cycle; some counties decades-stale, equalized by the annual CLR.",
    assessmentRatioCommercialPct: null, ratioNote: "No statewide ratio; effective ratio = the county's Common Level Ratio (varies widely).",
    annualCapPctCommercial: null, countyDriven: true, confidence: "high",
    sources: [{ title: "53 Pa.C.S. §8843 — Spot reassessment", url: "https://law.justia.com/codes/pennsylvania/title-53/chapter-88/section-8843/" }],
    caveat: "Confirm the county base year + current CLR; school-district sale appeals are common in PA." },
  RI: { state: "RI", stateName: "Rhode Island", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "9-yr full revaluation + statistical updates at yrs 3 & 6 to ~100% of market. No sale reset; the next update steps to market.",
    assessmentCycleYears: 9, cycleNote: "Full reval every 9 yrs; statistical updates at +3 and +6 yrs.",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null, countyDriven: true,
    confidence: "high", sources: [{ title: "R.I. Gen. Laws §44-5-11.6", url: "https://law.justia.com/codes/rhode-island/title-44/chapter-44-5/section-44-5-11-6/" }] },
  SC: { state: "SC", stateName: "South Carolina", saleTriggersReassessment: "yes", reassessmentBasis: "market_value",
    saleTriggerNote: "An Assessable Transfer of Interest (a sale) reassesses the parcel to FULL fair market value the next year (commercial ratio 6%), outside the 5-yr/15% cap. An optional ATI exemption can cut the new value up to 25% — but it must be affirmatively applied for.",
    assessmentCycleYears: 5, cycleNote: "Countywide reassessment every 5 yrs; 15% cap between sales, reset by an ATI.",
    assessmentRatioCommercialPct: 6, ratioNote: "Commercial / non-owner-occupied = 6% of fair market value.",
    annualCapPctCommercial: null, scAtiExemption: true, confidence: "high",
    sources: [{ title: "SC ATI (Assessable Transfer of Interest) — county summary", url: "https://www.gtcounty.org/265/Assessable-Transfer-of-Interest-ATI" }] },
  VT: { state: "VT", stateName: "Vermont", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "6-yr municipal reappraisal (Act 68) to 100% of market; the Common Level of Appraisal equalizes towns. A sale is evidence, not a per-parcel reset.",
    assessmentCycleYears: 6, cycleNote: "6-yr reappraisal cycle (Act 68 of 2023).",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null, countyDriven: true,
    confidence: "high", sources: [{ title: "Vermont Dept of Taxes — Reappraisals", url: "https://tax.vermont.gov/municipal-officials/listers-and-assessors/reappraisals" }] },
  VA: { state: "VA", stateName: "Virginia", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Locality-driven cycle (cities ≥30k biennial; counties ~4-yr default, up to 6) at 100% of market. No acquisition reset; a sale informs the next reassessment.",
    assessmentCycleYears: 4, cycleNote: "Cities ≥30k biennial; county default ~4-yr (up to 6 for small counties).",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null, countyDriven: true,
    confidence: "high", sources: [{ title: "Code of Virginia §58.1-3253", url: "https://law.lis.virginia.gov/vacode/title58.1/chapter32/section58.1-3253/" }] },
  WA: { state: "WA", stateName: "Washington", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Annual revaluation to 100% of market (physical inspection ≤ every 6 yrs). The well-known '1%' is a LEVY/rate limit, NOT an assessment cap — value already tracks market yearly, so acquisition reassessment risk is effectively nil.",
    assessmentCycleYears: 1, cycleNote: "Annual revaluation (since 2014); 6-yr physical inspection.",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null,
    confidence: "high", sources: [{ title: "RCW 84.40.030 — 100% of true & fair value", url: "https://app.leg.wa.gov/rcw/default.aspx?cite=84.40.030" }] },
  TX: { state: "TX", stateName: "Texas", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "No acquisition-value system. Appraised to Jan 1 market value ANNUALLY (Tax Code 23.01) — a sale is one comparable among many, not a reset. The 10% appraisal cap is homestead-only; commercial is effectively uncapped.",
    assessmentCycleYears: 1, cycleNote: "Annual to market (districts reappraise ≥ every 3 yrs; practice is annual).",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null,
    upcomingChanges: [{ effective: "2027", direction: "increase", note: "The temporary 20% circuit-breaker appraisal cap on smaller commercial parcels (≤ ~$5.3M) SUNSETS after TY2026 — a small center now sheltered by it can jump to full market value in 2027." }],
    confidence: "high", sources: [{ title: "Texas Comptroller — Valuing Property", url: "https://www.comptroller.texas.gov/taxes/property-tax/valuing-property.php" }],
    caveat: "Commercial is annual-to-market and uncapped for most retail (>$5.3M); a temporary 20% small-parcel circuit-breaker sunsets after TY2026." },
  IL: { state: "IL", stateName: "Illinois", saleTriggersReassessment: "no", reassessmentBasis: "equalized_value",
    saleTriggerNote: "No acquisition-value reset. Assessed at a statutory fraction of market, then a state equalization multiplier is applied. A sale does NOT reset to purchase price.",
    assessmentCycleYears: 4, cycleNote: "Cook County triennial; the other 101 counties quadrennial. Value as of Jan 1.",
    assessmentRatioCommercialPct: 33.33, ratioNote: "Most counties assess at 33⅓%; COOK County classifies commercial at 25% (see county override). A state multiplier then equalizes.",
    annualCapPctCommercial: null, countyDriven: true, confidence: "high",
    sources: [{ title: "Cook County Assessor — Assessment & Tax Bill", url: "https://www.cookcountyassessoril.gov/your-assessment-notice-and-tax-bill" }],
    caveat: "Cook bill = 25% commercial level × state multiplier (~3.0) × local rate; ratio shown is the classification level, not the effective burden." },
  HI: { state: "HI", stateName: "Hawaii", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "County-administered; each county assesses to 100% of market value annually. A sale does NOT reset to purchase price.",
    assessmentCycleYears: 1, cycleNote: "Annual to FMV (Jan 1) via mass appraisal; 4 counties.",
    assessmentRatioCommercialPct: 100, ratioNote: "100% of FMV; use-classes differ in RATE, not ratio.",
    annualCapPctCommercial: null, countyDriven: true, confidence: "high",
    sources: [{ title: "Honolulu Real Property Assessment Division — FAQ", url: "https://realproperty.honolulu.gov/help-resources/faq/" }] },
  ID: { state: "ID", stateName: "Idaho", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "No Prop-13 system. A sale does NOT reset to purchase price; assessors value to market annually from comparable sales.",
    assessmentCycleYears: 1, cycleNote: "Trued to market yearly; physical reappraisal ≥ every 5 yrs.",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null, countyDriven: true,
    confidence: "high", sources: [{ title: "Idaho State Tax Commission — Understanding Property Taxes", url: "https://tax.idaho.gov/taxes/property/understanding-property-taxes/" }] },
  SD: { state: "SD", stateName: "South Dakota", saleTriggersReassessment: "no", reassessmentBasis: "equalized_value",
    saleTriggerNote: "No acquisition-value system. Assessed to full market value annually, then a state factor equalizes to ~85% of market. A sale does NOT reset to purchase price.",
    assessmentCycleYears: 1, cycleNote: "Annual by the county Director of Equalization; DOR audits to keep level 85-100%.",
    assessmentRatioCommercialPct: 85, ratioNote: "~85% state equalization/taxable factor (floats 85-100%), applies to commercial.",
    annualCapPctCommercial: null, countyDriven: true, confidence: "medium",
    sources: [{ title: "SD Dept of Revenue — Property Tax 101", url: "https://dor.sd.gov/individuals/taxes/property-tax/" }],
    caveat: "85% is a floating equalization factor, not a fixed statutory ratio — verify the current county factor." },
  TN: { state: "TN", stateName: "Tennessee", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "No acquisition-value system. A sale does NOT reset value or restart the cycle; interim changes only for new construction/remodel/use change.",
    assessmentCycleYears: 5, cycleNote: "County-elected 4-, 5-, or 6-yr reappraisal cycle (5 most common); held between.",
    assessmentRatioCommercialPct: 40, ratioNote: "Commercial & industrial real property = 40% of appraised value.",
    annualCapPctCommercial: null, countyDriven: true, confidence: "high",
    sources: [{ title: "TN Comptroller — Understanding TN Property Assessments", url: "https://comptroller.tn.gov/office-functions/pa/property-taxes/understanding-tennessee-property-assessments.html" }] },
  UT: { state: "UT", stateName: "Utah", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "No Prop-13 system. A sale does NOT reset to purchase price; commercial valued at 100% FMV annually (the 45% exemption is owner-occupied residential only).",
    assessmentCycleYears: 1, cycleNote: "Annual FMV; ~5-yr detailed-review physical rotation.",
    assessmentRatioCommercialPct: 100, annualCapPctCommercial: null, countyDriven: true,
    confidence: "high", sources: [{ title: "Utah State Tax Commission — Property Tax", url: "https://tax.utah.gov/propertytax/locally-assessed/residential/" }] },
  WV: { state: "WV", stateName: "West Virginia", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Not acquisition-value. A sale does NOT reset to purchase price; valued at true & actual (market) value as of July 1 annually, assessed at 60% of that.",
    assessmentCycleYears: 1, cycleNote: "Annual (FMV July 1); physical reappraisal ≥ every 3 yrs.",
    assessmentRatioCommercialPct: 60, ratioNote: "Constitutionally assessed at 60% of true & actual value (all classes).",
    annualCapPctCommercial: null, countyDriven: true, confidence: "high",
    sources: [{ title: "WV Tax Division — Ad Valorem Property Tax", url: "https://tax.wv.gov/Business/PropertyTax/Pages/AdValoremPropertyTax.aspx" }] },
  WI: { state: "WI", stateName: "Wisconsin", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Not acquisition-value. A sale does NOT reset to price; municipal assessors value at full market value (a recent sale is strong evidence, not an automatic reset).",
    assessmentCycleYears: 0, cycleNote: "No fixed cycle; municipality-driven; state 'within 10% of full value' mandate over a 4-yr window.",
    assessmentRatioCommercialPct: null, ratioNote: "100% full value; uniformity clause bars a separate commercial ratio class.",
    annualCapPctCommercial: null, countyDriven: true, confidence: "high",
    sources: [{ title: "WI Dept of Revenue — Equalized Values", url: "https://www.revenue.wi.gov/DOR%20Publications/wieqval.pdf" }] },
  WY: { state: "WY", stateName: "Wyoming", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Not acquisition-value. A sale does NOT reset to purchase price; all property valued at FMV (Jan 1) annually, commercial assessed at 9.5% of FMV.",
    assessmentCycleYears: 1, cycleNote: "Annual valuation (Jan 1).",
    assessmentRatioCommercialPct: 9.5, ratioNote: "Commercial / all-other = 9.5% of FMV (industrial 11.5%).",
    annualCapPctCommercial: null, countyDriven: true, confidence: "high",
    sources: [{ title: "Wyoming Dept of Revenue — Commercial & Industrial", url: "https://wyo-prop-div.wyo.gov/commercial-industrial" }] },
  DC: { state: "DC", stateName: "District of Columbia", saleTriggersReassessment: "no", reassessmentBasis: "market_value",
    saleTriggerNote: "Not acquisition-value. A sale does NOT reset to purchase price; OTR assesses annually at 100% of estimated market value (Class 2 commercial taxed at tiered RATES, not a capped ratio).",
    assessmentCycleYears: 1, cycleNote: "Annual at 100% of estimated market value (DC OTR).",
    assessmentRatioCommercialPct: 100, ratioNote: "100% of market; Class 2 commercial rate tiers $1.65/$1.77/$1.89 per $100 by value.",
    annualCapPctCommercial: null, confidence: "high",
    sources: [{ title: "DC OTR — Real Property Tax Rates", url: "https://otr.cfo.dc.gov/page/real-property-tax-rates" }],
    caveat: "10% assessment cap is residential-homestead only; Class 2 commercial is not capped." },
};

export function getTaxJurisdiction(state: string | null | undefined): TaxJurisdiction | null {
  if (!state) return null;
  const key = state.trim().toUpperCase();
  return TAX_JURISDICTIONS[key] ?? null;
}

// ── County overrides ─────────────────────────────────────────────────────────
// In county-driven states the CYCLE / RATIO / equalization is set locally. We can't
// codify 3,000 counties, so this is a curated set for the high-volume retail
// counties where the local rule materially differs from the state default. Anything
// not listed falls back to the state framework (which flags "confirm locally").
export interface CountyTaxOverride {
  assessmentCycleYears?: number;
  assessmentRatioCommercialPct?: number | null;
  phaseInYears?: number;        // a reassessment increase that phases in over N yrs (NYC Class 4 = 5 yrs at 20%/yr)
  nextReassessmentYear?: number; // the next scheduled value event (reappraisal OR update) — lets the forecaster land the deferred step on the real year, not a generic cycle
  note: string;                 // county-specific mechanic (CLR, multiplier, cycle, base year)
  confidence?: Confidence;
}

function normCounty(s: string): string {
  return s.toLowerCase().replace(/\b(county|parish|borough|city and county|township)\b/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

export const COUNTY_TAX_OVERRIDES: Record<string, CountyTaxOverride> = {
  // Illinois — Cook is the exception to the 33⅓% norm.
  "IL|cook": { assessmentCycleYears: 3, assessmentRatioCommercialPct: 25, confidence: "high",
    note: "Cook County: commercial assessed at 25% (vs 33⅓% statewide), reassessed triennially, then a state equalization multiplier (~3.0) is applied. Your bill's effective rate already bakes in the multiplier." },
  // Pennsylvania — no state cycle; each county runs a base year + Common Level Ratio.
  "PA|philadelphia": { assessmentCycleYears: 1, assessmentRatioCommercialPct: 100, confidence: "high",
    note: "Philadelphia (AVI): assessed at 100% of market, updated roughly annually by the OPA — closer to a market-value system than the rest of PA." },
  "PA|allegheny": { assessmentCycleYears: 0, assessmentRatioCommercialPct: 50.14, confidence: "high",
    note: "Allegheny County (Pittsburgh): 2012 base year; CLR 50.14% (2024, eff. 7/1/2025) bridges to market. A high purchase price commonly draws a school-district appeal." },
  // PA Common Level Ratios = the 2024 CLR (effective 7/1/2025–6/30/2026); assessed ÷
  // market. PA republishes these every July, so they're dated — verify the current-year
  // CLR for a live deal. No sale reset in PA, but a high price commonly draws a
  // school-district appeal (the real post-purchase mechanism). Verified Jun 2026 (STEB).
  "PA|montgomery": { assessmentCycleYears: 0, assessmentRatioCommercialPct: 30.76, note: "Montgomery County (Philly collar; incl. Ambler/Blue Bell/Lansdale): ~1996 base year, CLR 30.76% (2024, eff. 7/1/2025). No sale reset — but watch for a school-district sale-price appeal.", confidence: "high" },
  "PA|bucks": { assessmentCycleYears: 0, assessmentRatioCommercialPct: 5.86, note: "Bucks County (Philly collar; incl. Doylestown/Chalfont/Perkasie): 1972 base year — assessments are a tiny fraction of market, CLR just 5.86% (2024, eff. 7/1/2025). No sale reset, but a high-priced purchase is a prime school-district appeal target. Confirm the current CLR.", confidence: "high" },
  "PA|chester": { assessmentCycleYears: 0, assessmentRatioCommercialPct: 31.84, note: "Chester County: 1998 base year, CLR 31.84% (2024, eff. 7/1/2025). No sale reset; school-district appeal risk on a high price.", confidence: "high" },
  "PA|delaware": { assessmentCycleYears: 0, assessmentRatioCommercialPct: 57.33, note: "Delaware County, PA: court-ordered 2021 reassessment (the freshest base in the Philly collar), CLR 57.33% (2024, eff. 7/1/2025). No sale reset; appeal risk.", confidence: "high" },
  "PA|berks": { assessmentCycleYears: 0, assessmentRatioCommercialPct: 34.37, note: "Berks County (Reading): stale base year, CLR 34.37% (2024, eff. 7/1/2025). No sale reset; school-district appeal risk.", confidence: "medium" },
  "PA|york": { assessmentCycleYears: 0, assessmentRatioCommercialPct: 50.46, note: "York County: CLR 50.46% (eff. 7/1/2025). No sale reset; school-district appeal risk on a high price.", confidence: "medium" },
  // New Jersey — annual-reassessment (Demonstration Program) counties move toward market every year.
  "NJ|monmouth": { assessmentCycleYears: 1, note: "Monmouth County (Assessment Demonstration Program): true ANNUAL reassessment to market — a recent purchase can pull the assessment up the next year via the lawful annual reval.", confidence: "high" },
  "NJ|gloucester": { assessmentCycleYears: 1, note: "Gloucester County (Demonstration Program): annual reassessment to market.", confidence: "high" },
  // New York — NYC's five boroughs run the Class 4 (45% / 5-yr transitional) system.
  // Increases to a Class 4 assessment phase in at 20%/yr over 5 yrs (transitional AV).
  "NY|new york": { assessmentRatioCommercialPct: 45, phaseInYears: 5, note: "NYC Class 4 commercial: assessed at 45% of DOF market value, increases phased in 20%/yr over 5 yrs (transitional assessment).", confidence: "high" },
  "NY|kings": { assessmentRatioCommercialPct: 45, phaseInYears: 5, note: "NYC (Brooklyn) Class 4: 45% of DOF market, 5-yr transitional phase-in (20%/yr).", confidence: "high" },
  "NY|queens": { assessmentRatioCommercialPct: 45, phaseInYears: 5, note: "NYC (Queens) Class 4: 45% of DOF market, 5-yr transitional phase-in (20%/yr).", confidence: "high" },
  "NY|bronx": { assessmentRatioCommercialPct: 45, phaseInYears: 5, note: "NYC (Bronx) Class 4: 45% of DOF market, 5-yr transitional phase-in (20%/yr).", confidence: "high" },
  "NY|richmond": { assessmentRatioCommercialPct: 45, phaseInYears: 5, note: "NYC (Staten Island) Class 4: 45% of DOF market, 5-yr transitional phase-in (20%/yr).", confidence: "high" },
  // Texas — major metro appraisal districts reappraise annually to market; a recent
  // arm's-length price is strong evidence ARB will chase the next Jan 1 value to it.
  "TX|harris": { assessmentCycleYears: 1, note: "Harris County (Houston/HCAD): annual reappraisal to Jan 1 market; commercial is uncapped, so a recent purchase price commonly pulls next year's value toward it. Protest annually.", confidence: "high" },
  "TX|dallas": { assessmentCycleYears: 1, note: "Dallas County (DCAD): annual reappraisal to market; uncapped commercial — expect the value to track a recent sale within a year or two.", confidence: "high" },
  "TX|tarrant": { assessmentCycleYears: 1, note: "Tarrant County (TAD/Fort Worth): annual reappraisal to market; uncapped commercial.", confidence: "high" },
  "TX|bexar": { assessmentCycleYears: 1, note: "Bexar County (BCAD/San Antonio): annual reappraisal to market; uncapped commercial.", confidence: "high" },
  "TX|travis": { assessmentCycleYears: 1, note: "Travis County (TCAD/Austin): annual reappraisal to market; uncapped commercial.", confidence: "high" },
  "TX|collin": { assessmentCycleYears: 1, note: "Collin County (CCAD): annual reappraisal to market; uncapped commercial.", confidence: "high" },
  // Florida — county property appraisers reset the non-homestead 10% cap to full just
  // value the Jan 1 after a qualifying change of ownership (school millage uncapped anyway).
  "FL|miami-dade": { assessmentCycleYears: 1, note: "Miami-Dade: just-value annually; the 10% non-homestead cap RESETS to full market the Jan 1 after sale — model the step to your basis.", confidence: "high" },
  "FL|broward": { assessmentCycleYears: 1, note: "Broward: 10% non-homestead cap resets on a change of ownership; value steps to full just value the next Jan 1.", confidence: "high" },
  "FL|hillsborough": { assessmentCycleYears: 1, note: "Hillsborough (Tampa): 10% non-homestead cap resets on sale; CDD lines are common — net them out as non-ad-valorem.", confidence: "high" },
  "FL|orange": { assessmentCycleYears: 1, note: "Orange (Orlando): 10% non-homestead cap resets on sale; watch for CDD/special-district lines (non-ad-valorem).", confidence: "high" },
  // Georgia — sale price sets the MAX next-year value (buyer-favorable ceiling) but the
  // 40% ratio and annual valuation still apply; large metros are aggressive on reval.
  "GA|fulton": { assessmentCycleYears: 1, note: "Fulton (Atlanta): annual valuation at 40% of market; a recent sale CAPS next year's value at the price (O.C.G.A. 48-5-2) — protective, not a step-up.", confidence: "high" },
  "GA|gwinnett": { assessmentCycleYears: 1, note: "Gwinnett: annual valuation at 40% of market; sale price = max next-year value.", confidence: "high" },
  // ── Portfolio counties (county-driven states where the local cycle differs from the
  // state default) — verified Jun 2026 against county-assessor schedules. ──
  // Ohio's 88 counties are loaded from the full ODT reappraisal schedule below (OH_REAPPRAISAL).
  // North Carolina — Wake left the 8-yr default; now a short cycle (no interim sale reset).
  "NC|wake": { assessmentCycleYears: 3, nextReassessmentYear: 2027, note: "Wake County (Raleigh; incl. Knightdale): reappraised 2024, NEXT revaluation 2027, then moving to a 2-yr cycle (2029…) — far shorter than NC's 8-yr default. 100% of market; interim sale-based changes barred, so the step lands at the 2027 reval.", confidence: "high" },
  // Other NC counties are loaded from the full NCDOR table below (NC_REVAL).
  // Virginia — NoVA jurisdictions reassess ANNUALLY, not the ~4-yr county default.
  "VA|arlington": { assessmentCycleYears: 1, note: "Arlington County (incl. Pentagon City): assesses ANNUALLY (Jan 1) at 100% of market — not Virginia's multi-year county default. A recent purchase price flows into value within a year; income-&-expense filing is requested under Code of VA §58.1-3294.", confidence: "high" },
  "VA|fairfax": { assessmentCycleYears: 1, note: "Fairfax County: annual (Jan 1) reassessment to 100% of market — value tracks the market yearly, so a recent sale flows in quickly.", confidence: "high" },
  // New Jersey — Morris is NOT in the annual-reassessment Demonstration Program (that's
  // Monmouth/Gloucester); it follows standard NJ (no fixed cycle, equalization ratio).
  "NJ|morris": { assessmentCycleYears: 0, note: "Morris County (incl. Rockaway): standard NJ — NO fixed cycle and NOT in the annual-reassessment Demonstration Program, so no automatic sale reset. Apply the municipality's equalization ratio; a reval is ordered only when the assessment/sales ratio drifts.", confidence: "high" },
};

// ── Pennsylvania — FULL 2024 Common Level Ratio table (all 67 counties) ────────
// Source: PA State Tax Equalization Board, "RATIO-2024" (effective 7/1/2025–6/30/2026),
// loaded from the official table. The CLR (assessed ÷ market) is a SINGLE uniform ratio
// per county — PA's constitutional uniformity clause bars a separate commercial class —
// so it applies to commercial as-is. PA has no sale reset; a high purchase price draws a
// school-district appeal (the real post-purchase mechanism). CLRs republish each July —
// treat as dated and verify the current-year figure for a live deal.
const PA_CLR_2024: Record<string, number> = {
  adams: 72.44, allegheny: 50.14, armstrong: 30.56, beaver: 77.13, bedford: 54.52,
  berks: 34.37, blair: 85.80, bradford: 17.32, bucks: 5.86, butler: 6.00,
  cambria: 12.18, cameron: 21.44, carbon: 17.91, centre: 17.10, chester: 31.84,
  clarion: 11.23, clearfield: 17.94, clinton: 50.47, columbia: 14.27, crawford: 16.26,
  cumberland: 67.80, dauphin: 40.42, delaware: 57.33, elk: 18.58, erie: 53.21,
  fayette: 43.03, forest: 13.05, franklin: 7.68, fulton: 22.89, greene: 38.23,
  huntingdon: 12.58, indiana: 75.32, jefferson: 20.02, juniata: 8.11, lackawanna: 5.68,
  lancaster: 53.43, lawrence: 46.96, lebanon: 54.15, lehigh: 49.40, luzerne: 86.20,
  lycoming: 46.94, mckean: 59.43, mercer: 11.11, mifflin: 20.91, monroe: 45.47,
  montgomery: 30.76, montour: 46.23, northampton: 17.01, northumberland: 9.63, perry: 57.70,
  philadelphia: 90.70, pike: 9.18, potter: 16.54, schuylkill: 18.86, snyder: 9.85,
  somerset: 18.38, sullivan: 43.64, susquehanna: 17.74, tioga: 83.79, union: 46.84,
  venango: 51.02, warren: 13.89, washington: 67.41, wayne: 72.34, westmoreland: 8.88,
  wyoming: 11.46, york: 50.46,
};
// Fill any PA county not already given a richer hand-written entry above.
for (const [cty, clr] of Object.entries(PA_CLR_2024)) {
  const key = `PA|${cty}`;
  if (COUNTY_TAX_OVERRIDES[key]) continue;
  const name = cty === "mckean" ? "McKean" : cty.charAt(0).toUpperCase() + cty.slice(1);
  COUNTY_TAX_OVERRIDES[key] = {
    assessmentCycleYears: 0,
    assessmentRatioCommercialPct: clr,
    note: `${name} County, PA: 2024 Common Level Ratio ${clr}% (assessed ÷ market; STEB, eff. 7/1/2025). PA has no sale reset — a high purchase price commonly draws a school-district appeal. CLRs republish each July; verify the current-year figure.`,
    confidence: "high",
  };
}

const titleCase = (s: string) => s.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

// ── North Carolina — FULL NCDOR revaluation schedule (all 100 counties) ────────
// Source: NC Dept of Revenue, "2025 NC County Property Tax Rates / Revaluation
// Schedule" (Aug 2025). [latestReval, nextScheduledReval]. NC values ALL property
// (commercial + residential) at 100% of market on the SAME cycle (no class split),
// and bars interim sale-based changes (G.S. 105-287) — so a deferred step toward a
// recent purchase price lands at the next scheduled revaluation.
const NC_REVAL: Record<string, [number, number]> = {
  "alamance": [2023, 2027], "alexander": [2023, 2027], "alleghany": [2021, 2027], "anson": [2018, 2026],
  "ashe": [2023, 2027], "avery": [2022, 2027], "beaufort": [2025, 2031], "bertie": [2020, 2028],
  "bladen": [2022, 2026], "brunswick": [2023, 2027], "buncombe": [2021, 2026], "burke": [2023, 2027],
  "cabarrus": [2024, 2028], "caldwell": [2025, 2029], "camden": [2023, 2031], "carteret": [2025, 2029],
  "caswell": [2024, 2028], "catawba": [2023, 2027], "chatham": [2025, 2029], "cherokee": [2020, 2028],
  "chowan": [2022, 2026], "clay": [2018, 2026], "cleveland": [2025, 2029], "columbus": [2021, 2029],
  "craven": [2023, 2028], "cumberland": [2025, 2033], "currituck": [2021, 2029], "dare": [2025, 2030],
  "davidson": [2021, 2026], "davie": [2025, 2029], "duplin": [2025, 2030], "durham": [2025, 2029],
  "edgecombe": [2024, 2032], "forsyth": [2025, 2029], "franklin": [2024, 2030], "gaston": [2023, 2027],
  "gates": [2025, 2033], "graham": [2023, 2027], "granville": [2024, 2030], "greene": [2021, 2029],
  "guilford": [2022, 2026], "halifax": [2024, 2028], "harnett": [2022, 2026], "haywood": [2021, 2027],
  "henderson": [2023, 2027], "hertford": [2019, 2027], "hoke": [2022, 2030], "hyde": [2024, 2030],
  "iredell": [2023, 2027], "jackson": [2025, 2029], "johnston": [2025, 2029], "jones": [2022, 2030],
  "lee": [2023, 2027], "lenoir": [2025, 2033], "lincoln": [2023, 2027], "macon": [2023, 2027],
  "madison": [2024, 2032], "martin": [2025, 2033], "mcdowell": [2023, 2027], "mecklenburg": [2023, 2027],
  "mitchell": [2022, 2027], "montgomery": [2020, 2028], "moore": [2023, 2027], "nash": [2024, 2032],
  "new hanover": [2025, 2029], "northampton": [2023, 2031], "onslow": [2022, 2026], "orange": [2025, 2029],
  "pamlico": [2020, 2026], "pasquotank": [2022, 2030], "pender": [2019, 2026], "perquimans": [2024, 2032],
  "person": [2025, 2029], "pitt": [2024, 2028], "polk": [2025, 2029], "randolph": [2023, 2027],
  "richmond": [2024, 2028], "robeson": [2024, 2030], "rockingham": [2024, 2029], "rowan": [2023, 2027],
  "rutherford": [2023, 2027], "sampson": [2024, 2028], "scotland": [2019, 2026], "stanly": [2025, 2029],
  "stokes": [2025, 2029], "surry": [2025, 2029], "swain": [2021, 2029], "transylvania": [2025, 2029],
  "tyrrell": [2025, 2033], "union": [2025, 2029], "vance": [2024, 2032], "wake": [2024, 2027],
  "warren": [2025, 2033], "washington": [2021, 2029], "watauga": [2022, 2027], "wayne": [2025, 2033],
  "wilkes": [2025, 2029], "wilson": [2024, 2029], "yadkin": [2023, 2027], "yancey": [2024, 2032],
};
for (const [cty, [latest, next]] of Object.entries(NC_REVAL)) {
  const key = `NC|${cty}`;
  if (COUNTY_TAX_OVERRIDES[key]) continue; // Wake has a richer hand entry
  const cycle = next - latest;
  COUNTY_TAX_OVERRIDES[key] = {
    assessmentCycleYears: cycle, assessmentRatioCommercialPct: 100, nextReassessmentYear: next,
    note: `${titleCase(cty)} County, NC: revalued ${latest}, next revaluation ${next} (${cycle}-yr cycle). 100% of market (commercial = residential); interim sale-based changes barred (G.S. 105-287), so a deferred step toward your price lands at the ${next} reval.`,
    confidence: "high",
  };
}

// ── Ohio — FULL ODT sexennial reappraisal schedule (all 88 counties) ───────────
// Source: Ohio Dept of Taxation, "Year of Sexennial Reappraisal and Triennial Update
// for Ohio's 88 Counties" (the value is the county's REAPPRAISAL year). Value events
// occur every 3 yrs: reappraisal at R, R+6, …; update at R+3, R+9, …. Commercial 35%
// of market; a sale doesn't reset outside the cycle (HB126), so a step toward a recent
// price lands at the next value event. nextReassessmentYear is computed live.
const OH_REAPPRAISAL: Record<string, number> = {
  "adams": 2022, "allen": 2021, "ashland": 2020, "ashtabula": 2020, "athens": 2020, "auglaize": 2023,
  "belmont": 2024, "brown": 2024, "butler": 2020, "carroll": 2025, "champaign": 2025, "clark": 2025,
  "clermont": 2020, "clinton": 2023, "columbiana": 2022, "coshocton": 2021, "crawford": 2024, "cuyahoga": 2024,
  "darke": 2023, "defiance": 2023, "delaware": 2023, "erie": 2024, "fairfield": 2025, "fayette": 2024,
  "franklin": 2023, "fulton": 2020, "gallia": 2023, "geauga": 2023, "greene": 2020, "guernsey": 2021,
  "hamilton": 2023, "hancock": 2022, "hardin": 2023, "harrison": 2023, "henry": 2023, "highland": 2024,
  "hocking": 2022, "holmes": 2022, "huron": 2024, "jackson": 2023, "jefferson": 2024, "knox": 2020,
  "lake": 2024, "lawrence": 2022, "licking": 2023, "logan": 2025, "lorain": 2024, "lucas": 2024,
  "madison": 2020, "mahoning": 2023, "marion": 2025, "medina": 2025, "meigs": 2022, "mercer": 2023,
  "miami": 2025, "monroe": 2022, "montgomery": 2020, "morgan": 2024, "morrow": 2023, "muskingum": 2024,
  "noble": 2020, "ottawa": 2024, "paulding": 2022, "perry": 2023, "pickaway": 2023, "pike": 2023,
  "portage": 2024, "preble": 2023, "putnam": 2023, "richland": 2023, "ross": 2025, "sandusky": 2021,
  "scioto": 2022, "seneca": 2023, "shelby": 2023, "stark": 2024, "summit": 2020, "trumbull": 2023,
  "tuscarawas": 2022, "union": 2025, "van wert": 2023, "vinton": 2021, "warren": 2024, "washington": 2022,
  "wayne": 2020, "williams": 2024, "wood": 2023, "wyandot": 2025,
};
const OH_LABEL: Record<string, string> = {
  cuyahoga: "Cleveland; incl. Rocky River", franklin: "Columbus", hamilton: "Cincinnati", summit: "Akron",
  montgomery: "Dayton", lucas: "Toledo", stark: "Canton", delaware: "Columbus suburbs; incl. Powell",
  lake: "NE Cleveland suburbs", lorain: "W Cleveland suburbs", butler: "N Cincinnati suburbs",
  warren: "Mason; Cincy–Dayton", clermont: "E Cincinnati suburbs", licking: "Newark; E Columbus",
};
{
  const thisYear = new Date().getFullYear();
  for (const [cty, R] of Object.entries(OH_REAPPRAISAL)) {
    const key = `OH|${cty}`;
    if (COUNTY_TAX_OVERRIDES[key]) continue;
    let nextEvt = R; while (nextEvt < thisYear) nextEvt += 3; // value event every 3 yrs
    const isReappraisal = (nextEvt - R) % 6 === 0;
    const label = OH_LABEL[cty] ? ` (${OH_LABEL[cty]})` : "";
    COUNTY_TAX_OVERRIDES[key] = {
      assessmentCycleYears: 6, assessmentRatioCommercialPct: 35, nextReassessmentYear: nextEvt,
      note: `${titleCase(cty)} County, OH${label}: ${R} sexennial reappraisal (6-yr cycle, 3-yr update). Next value event is the ${nextEvt} ${isReappraisal ? "reappraisal" : "triennial update"}. Commercial 35% of market; a sale doesn't reset outside the cycle (HB126), so a step toward your price lands ~${nextEvt}.`,
      confidence: "high",
    };
  }
}

export function getCountyOverride(state: string | null | undefined, county: string | null | undefined): CountyTaxOverride | null {
  if (!state || !county) return null;
  return COUNTY_TAX_OVERRIDES[`${state.trim().toUpperCase()}|${normCounty(county)}`] ?? null;
}

// State framework with any county override merged in (ratio/cycle/note).
export interface ResolvedJurisdiction extends TaxJurisdiction { countyNote?: string | null; countyPhaseInYears?: number | null; countyNextReassessYear?: number | null }
export function resolveJurisdiction(state: string | null | undefined, county?: string | null): ResolvedJurisdiction | null {
  const base = getTaxJurisdiction(state);
  if (!base) return null;
  const co = getCountyOverride(state, county);
  if (!co) return { ...base, countyNote: null, countyPhaseInYears: null, countyNextReassessYear: null };
  return {
    ...base,
    assessmentCycleYears: co.assessmentCycleYears ?? base.assessmentCycleYears,
    assessmentRatioCommercialPct: co.assessmentRatioCommercialPct !== undefined ? co.assessmentRatioCommercialPct : base.assessmentRatioCommercialPct,
    countyNote: co.note,
    countyPhaseInYears: co.phaseInYears ?? null,
    countyNextReassessYear: co.nextReassessmentYear ?? null,
  };
}

// ── The estimator ────────────────────────────────────────────────────────────
export interface ReassessInput {
  state: string | null | undefined;
  county?: string | null;                // refines cycle/ratio in county-driven states
  acquisitionPrice: number | null;       // the price we'd pay
  currentAssessedValue?: number | null;  // current taxable/assessed value from the OM tax page
  currentAnnualTaxes?: number | null;    // current annual RE taxes from the OM (TOTAL bill)
  nonAdValoremAnnual?: number | null;    // $ of non-ad-valorem charges inside the total — netted out of the reassessing base
  applyScAtiExemption?: boolean;         // SC only — model the optional 25% ATI exemption
}

export interface ReassessResult {
  jurisdiction: ResolvedJurisdiction | null;
  codified: boolean;
  // sale-time reset
  resetsOnSale: boolean;            // yes/partial (and not a buyer-favorable ceiling)
  effectiveRateOnAssessed: number | null;  // currentTaxes ÷ currentAssessed (the property's real rate)
  impliedCurrentMarket: number | null;     // currentAssessed ÷ ratio
  estPostSaleAssessed: number | null;
  estPostSaleTaxes: number | null;
  estAnnualStepUp: number | null;          // post-sale taxes − current taxes (sale-time, for reset states)
  stepUpPct: number | null;
  // deferred (no reset on sale, but the next cycle moves toward market if buying above assessed)
  estNextCycleTaxes: number | null;
  estNextCycleStepUp: number | null;
  headline: string;                 // one-line plain-English answer
  detail: string[];                 // supporting lines
  confidence: Confidence;
}

const r2 = (n: number) => Math.round(n);

export function estimateReassessment(input: ReassessInput): ReassessResult {
  const j = resolveJurisdiction(input.state, input.county);
  const price = numOrNull(input.acquisitionPrice);
  const curAssessed = numOrNull(input.currentAssessedValue);
  const curTaxes = numOrNull(input.currentAnnualTaxes);
  const ratio = j?.assessmentRatioCommercialPct ?? null;

  // Isolate the AD-VALOREM (value-based) portion of the bill — only that reassesses.
  // Non-ad-valorem special-district / fixed charges (CDD, Mello-Roos, BID, PACE) are
  // flat: scaling them up with the new value would OVERSTATE the step-up. Net them out
  // of the rate base, then add them back unchanged to the post-sale total.
  const nav = numOrNull(input.nonAdValoremAnnual);
  const navInBill = nav != null && curTaxes != null && nav < curTaxes ? nav : 0;
  const adValoremTaxes = curTaxes != null ? curTaxes - navInBill : null;

  // The property's REAL ad-valorem effective rate on its assessed value — the most
  // accurate multiplier for a new assessment. Null when we lack the bill.
  const effRate = adValoremTaxes != null && curAssessed != null && curAssessed > 0 ? adValoremTaxes / curAssessed : null;
  const impliedMarket = curAssessed != null && ratio != null && ratio > 0 ? curAssessed / (ratio / 100) : null;

  const detail: string[] = [];
  const out: ReassessResult = {
    jurisdiction: j, codified: !!j,
    resetsOnSale: false, effectiveRateOnAssessed: effRate, impliedCurrentMarket: impliedMarket,
    estPostSaleAssessed: null, estPostSaleTaxes: null, estAnnualStepUp: null, stepUpPct: null,
    estNextCycleTaxes: null, estNextCycleStepUp: null,
    headline: "", detail, confidence: j?.confidence ?? "low",
  };

  if (!j) {
    out.headline = `${(input.state || "This state").toUpperCase()} isn't codified yet — confirm the reassessment rule locally.`;
    detail.push("Enter the current assessed value + taxes and the purchase price and we can still estimate the step-up once the rule is added.");
    return out;
  }

  if (j.countyNote) detail.push(j.countyNote);

  // New assessment if the parcel is taken to full value at the purchase price.
  // SC ATI exemption optionally trims up to 25%. (For MI the ratio is 50 = SEV.)
  const resetFactor = j.scAtiExemption && input.applyScAtiExemption ? 0.75 : 1;
  const fullValueAssessed = price != null && ratio != null ? price * (ratio / 100) * resetFactor : null;

  const reset = j.saleTriggersReassessment !== "no" && !j.buyerFavorableCeiling;
  out.resetsOnSale = reset;

  if (j.buyerFavorableCeiling) {
    // GA — a sale CAPS next-year value at the price (protective). No upward step-up.
    out.headline = `Sale does NOT raise taxes — in fact ${j.stateName} caps next year's value at your purchase price.`;
    detail.push(j.saleTriggerNote);
    if (effRate != null && fullValueAssessed != null && curTaxes != null) {
      out.estPostSaleAssessed = r2(fullValueAssessed);
      out.estPostSaleTaxes = r2(fullValueAssessed * effRate + navInBill);
    }
    return out;
  }

  if (reset && fullValueAssessed != null && effRate != null && curTaxes != null) {
    const postTaxes = fullValueAssessed * effRate + navInBill; // reassessed ad-valorem + flat non-ad-valorem
    out.estPostSaleAssessed = r2(fullValueAssessed);
    out.estPostSaleTaxes = r2(postTaxes);
    out.estAnnualStepUp = r2(postTaxes - curTaxes);
    out.stepUpPct = curTaxes > 0 ? Math.round(((postTaxes - curTaxes) / curTaxes) * 100) : null;
    if (navInBill > 0) detail.push(`Excludes $${navInBill.toLocaleString()}/yr of non-ad-valorem special-district charges from the reassessing base (they're flat — added back unchanged).`);
    const basisWord = j.reassessmentBasis === "acquisition_price" ? "your purchase price"
      : j.reassessmentBasis === "equalized_value" ? "the equalized value (≈50% of price)"
      : "full market value";
    out.headline = out.estAnnualStepUp! > 0
      ? `Buying likely RAISES taxes ~$${out.estAnnualStepUp!.toLocaleString()}/yr (${out.stepUpPct}%) — ${j.stateName} resets to ${basisWord}.`
      : `${j.stateName} resets to ${basisWord} on sale, but at this price taxes don't rise materially.`;
    detail.push(j.saleTriggerNote);
    if (j.scAtiExemption) detail.push(input.applyScAtiExemption ? "Modeled WITH the 25% ATI exemption (must be applied for)." : "Toggle the 25% ATI exemption if you'll qualify and apply.");
  } else if (reset) {
    out.headline = `${j.stateName} resets taxes toward market on sale — enter current assessed value + taxes to size the step-up.`;
    detail.push(j.saleTriggerNote);
  } else {
    // No reset on sale. But if buying ABOVE the current assessed/implied market,
    // the NEXT scheduled reassessment will move toward the price — deferred, not avoided.
    out.headline = `Sale does NOT reset taxes in ${j.stateName}.`;
    detail.push(j.saleTriggerNote);
    if (j.assessmentCycleYears > 1) detail.push(`Reassessed every ${j.assessmentCycleYears} years — the next cycle is when value moves toward what you paid.`);
    else if (j.assessmentCycleYears === 1) detail.push("Valued to market annually, so a price above the current assessment can flow in within a year or two.");
    else detail.push("No fixed cycle — confirm the county's reassessment cadence (and equalization ratio).");
    if (fullValueAssessed != null && effRate != null && curTaxes != null && impliedMarket != null && price != null && price > impliedMarket * 1.05) {
      const nextTaxes = fullValueAssessed * effRate + navInBill; // reassessed ad-valorem + flat non-ad-valorem
      out.estNextCycleTaxes = r2(nextTaxes);
      out.estNextCycleStepUp = r2(nextTaxes - curTaxes);
      detail.push(`If/when reassessed to your ~$${price.toLocaleString()} basis: taxes ≈ $${r2(nextTaxes).toLocaleString()}/yr (≈ +$${(out.estNextCycleStepUp!).toLocaleString()}/yr vs. today) — model this at the next cycle, not day one.`);
    }
  }
  return out;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Capture-completeness / sanity checks (the fringe-case guards) ─────────────
// These are DETERMINISTIC (no model): they verify the tax figures the extractor
// captured are complete and internally consistent BEFORE the estimate is trusted.

interface TaxParcelLike { assessedValue?: unknown; marketValue?: unknown; annualTaxes?: unknown }
interface TaxDealLike {
  state?: string | null;
  currentAssessedValue?: unknown; currentMarketValue?: unknown; currentAnnualTaxes?: unknown;
  taxParcels?: TaxParcelLike[] | null;
  taxAbatement?: { present?: boolean | null; type?: string | null; note?: string | null; expiry?: string | null } | null;
  specialAssessments?: string | null;
  nonAdValoremAnnual?: unknown;
  expenseBreakdown?: Record<string, number | null> | null;
}

export interface TaxWarning { severity: "high" | "medium" | "info"; message: string }

export interface TaxCaptureCheck {
  parcelCount: number;
  parcelSumAssessed: number | null;
  parcelSumTaxes: number | null;
  // The totals to USE — the deterministic parcel sum when parcels exist, else the
  // extractor's stated total. (source tells the UI which.)
  assessed: number | null;
  taxes: number | null;             // TOTAL current bill
  nonAdValorem: number | null;      // non-ad-valorem portion to net out of the reassessing base
  assessedSource: "parcels" | "stated" | "none";
  taxesSource: "parcels" | "stated" | "none";
  impliedRatioPct: number | null;   // assessed ÷ market × 100
  warnings: TaxWarning[];
}

const sum = (rows: TaxParcelLike[], key: keyof TaxParcelLike): number | null => {
  const vals = rows.map((r) => numOrNull(r[key])).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
};

export function reconcileTaxCapture(deal: TaxDealLike): TaxCaptureCheck {
  const parcels = Array.isArray(deal.taxParcels) ? deal.taxParcels : [];
  const parcelSumAssessed = parcels.length ? sum(parcels, "assessedValue") : null;
  const parcelSumTaxes = parcels.length ? sum(parcels, "annualTaxes") : null;
  const statedAssessed = numOrNull(deal.currentAssessedValue);
  const statedTaxes = numOrNull(deal.currentAnnualTaxes);
  const market = numOrNull(deal.currentMarketValue);
  const j = getTaxJurisdiction(deal.state);
  const warnings: TaxWarning[] = [];

  // Prefer the deterministic parcel sum (we add the rows in code, not the model).
  const assessed = parcelSumAssessed ?? statedAssessed;
  const taxes = parcelSumTaxes ?? statedTaxes;
  const assessedSource: TaxCaptureCheck["assessedSource"] = parcelSumAssessed != null ? "parcels" : statedAssessed != null ? "stated" : "none";
  const taxesSource: TaxCaptureCheck["taxesSource"] = parcelSumTaxes != null ? "parcels" : statedTaxes != null ? "stated" : "none";

  // 1) Parcel sum vs the extractor's stated total — a gap means a parcel was likely dropped.
  const off = (a: number | null, b: number | null) => a != null && b != null && b > 0 && Math.abs(a - b) / b > 0.02;
  if (parcelSumTaxes != null && off(parcelSumTaxes, statedTaxes)) {
    warnings.push({ severity: "high", message: `${parcels.length} parcels sum to $${Math.round(parcelSumTaxes).toLocaleString()} in taxes, but the captured total is $${Math.round(statedTaxes!).toLocaleString()} — a parcel may be missing or double-counted. Verify against the OM's tax table.` });
  }
  if (parcelSumAssessed != null && off(parcelSumAssessed, statedAssessed)) {
    warnings.push({ severity: "medium", message: `Parcel assessed values sum to $${Math.round(parcelSumAssessed).toLocaleString()} vs. the captured total $${Math.round(statedAssessed!).toLocaleString()} — confirm no parcel was dropped.` });
  }

  // 2) Market-vs-assessed: if the captured "assessed" looks like MARKET value (implied
  // ratio well above the state's), we likely grabbed the wrong column → step-up understated.
  let impliedRatioPct: number | null = null;
  if (assessed != null && market != null && market > 0) {
    impliedRatioPct = Math.round((assessed / market) * 1000) / 10;
    if (assessed > market * 1.02) {
      warnings.push({ severity: "high", message: `Captured assessed value ($${Math.round(assessed).toLocaleString()}) exceeds the market value ($${Math.round(market).toLocaleString()}) — these are likely swapped. Assessed/taxable should be ≤ market.` });
    } else if (j?.assessmentRatioCommercialPct != null && j.assessmentRatioCommercialPct < 95 && impliedRatioPct > j.assessmentRatioCommercialPct * 1.4) {
      warnings.push({ severity: "high", message: `The captured "assessed" value implies a ${impliedRatioPct}% ratio, but ${j.stateName} assesses commercial at ~${j.assessmentRatioCommercialPct}% — you may have captured the MARKET value instead of assessed/taxable, which would understate the post-sale step-up.` });
    }
  }

  // 2b) Same swap, caught WITHOUT a market column: in a strongly fractional-ratio
  // state (e.g. OH 35%) the tax rate computed on the ASSESSED value is grossed up
  // (≈ market-rate ÷ ratio), so a LOW rate-on-assessed means the captured "assessed"
  // is almost certainly the MARKET value (the assessor's two columns got swapped) —
  // which silently hides a large reassessment step-up.
  if (market == null && assessed != null && taxes != null && taxes > 0 &&
      j?.assessmentRatioCommercialPct != null && j.assessmentRatioCommercialPct < 50) {
    const rateOnAssessed = taxes / assessed;
    if (rateOnAssessed < 0.03) {
      const expectAssessed = j.assessmentRatioCommercialPct / 100;
      warnings.push({ severity: "high", message: `The implied tax rate on this assessed value is only ${(rateOnAssessed * 100).toFixed(1)}% — far too low for ${j.stateName}, where commercial is assessed at ~${j.assessmentRatioCommercialPct}% of market (so the rate ON the assessed value normally runs several times higher). This almost always means the MARKET value was captured instead of the ASSESSED value — the assessed value should be ~${j.assessmentRatioCommercialPct}% of market (≈ ${Math.round(assessed * expectAssessed).toLocaleString()} if ${Math.round(assessed).toLocaleString()} is actually the market value). Fix the Current Assessed Value, or a real reassessment step-up will be hidden.` });
    }
  }

  // 3) Current bill vs the pro-forma RE-tax line (a sanity tie, not necessarily an error).
  const proformaTax = numOrNull(deal.expenseBreakdown?.realEstateTax);
  if (taxes != null && proformaTax != null && Math.abs(taxes - proformaTax) / Math.max(taxes, proformaTax) > 0.15) {
    warnings.push({ severity: "info", message: `Current taxes ($${Math.round(taxes).toLocaleString()}) differ >15% from the underwritten RE-tax line ($${Math.round(proformaTax).toLocaleString()}) — expected if the pro forma already steps taxes up, but worth a glance.` });
  }

  // 4) Abatement / special assessments — real acquisition risks the engine can't model.
  if (deal.taxAbatement?.present) {
    const t = deal.taxAbatement.type ? `${deal.taxAbatement.type} ` : "";
    const exp = deal.taxAbatement.expiry ? ` (expires ${deal.taxAbatement.expiry})` : "";
    warnings.push({ severity: "high", message: `Tax ${t}abatement in place${exp} — current taxes are artificially LOW. Confirm whether it survives the sale, and underwrite the un-abated taxes.` });
  }
  // Non-ad-valorem $ to net out of the reassessing base (a flat charge mustn't scale
  // with value). Guard against a captured value that exceeds the whole bill.
  const navRaw = numOrNull(deal.nonAdValoremAnnual);
  let nonAdValorem: number | null = null;
  if (navRaw != null) {
    if (taxes != null && navRaw >= taxes) {
      warnings.push({ severity: "medium", message: `Captured non-ad-valorem charges ($${Math.round(navRaw).toLocaleString()}/yr) are not less than the total tax bill ($${Math.round(taxes).toLocaleString()}/yr) — that can't be right, so it's ignored until corrected.` });
    } else {
      nonAdValorem = navRaw;
    }
  }
  if (deal.specialAssessments && String(deal.specialAssessments).trim()) {
    warnings.push({ severity: "info", message: nonAdValorem != null
      ? `Special / non-ad-valorem assessments present (${String(deal.specialAssessments).trim()}); ~$${Math.round(nonAdValorem).toLocaleString()}/yr is netted OUT of the reassessing base and added back flat.`
      : `Special / non-ad-valorem assessments present (${String(deal.specialAssessments).trim()}) — these don't reassess like ad-valorem taxes. Enter their annual $ below so they're netted out of the step-up.` });
  }

  return { parcelCount: parcels.length, parcelSumAssessed, parcelSumTaxes, assessed, taxes, nonAdValorem, assessedSource, taxesSource, impliedRatioPct, warnings };
}

// ── Forward-looking REASSESSMENT TRIGGERS beyond the ordinary sale-reset ───────
// The sale-reset engine above answers "do taxes reset when we buy?" These are the
// OTHER levers that move a tax bill during the hold, each of which the broker pro
// forma quietly ignores. All deterministic; dollar magnitudes are sized only when
// the inputs allow an honest number (never fabricated — see the project notes).
export type TaxTriggerKind = "exemption_loss" | "low_tax_trap" | "ag_rollback" | "renovation" | "abatement_expiry" | "law_change";

export interface TaxTrigger {
  kind: TaxTriggerKind;
  severity: "high" | "medium" | "low";
  title: string;
  message: string;
  confidence: Confidence;
}

export interface TaxTriggerInput {
  state?: string | null;
  county?: string | null;
  acquisitionPrice?: number | null;
  currentAnnualTaxes?: number | null;
  currentAssessedValue?: number | null;
  nonAdValoremAnnual?: number | null;
  sellerName?: string | null;            // deal.seller / txnSeller — heuristic exemption detector
  sellerTaxExempt?: boolean | null;
  agOrGreenbeltAssessed?: boolean | null;
  taxAbatement?: { present?: boolean | null; type?: string | null; expiry?: string | null; survivesSale?: boolean | null; unabatedAnnualTaxes?: number | null; abatementPct?: number | null } | null;
  specialAssessments?: string | null;
  renovationYear?: number | null;
  acqStrategy?: string | null;           // value-add / reposition / redevelopment keywords
  notes?: string | null;
  holdYears?: number | null;
}

// Entities whose ownership usually means the parcel is off the tax roll (or PILOT-only).
// Deliberately CONSERVATIVE: only unambiguous institutional-owner phrases, NOT bare
// nouns like "university"/"church"/"college" that routinely appear in retail center
// names (e.g. "University Plaza LLC", "Church Street Plaza") and would false-positive.
// Confirmed cases still flag HIGH via the explicit sellerTaxExempt field.
const EXEMPT_OWNER_RE = /\b(city of|county of|town of|village of|township of|state of|united states|u\.s\. government|federal government|housing authority|redevelopment authority|public housing|school district|board of education|diocese of|archdiocese|ministries\b|salvation army|goodwill industries|habitat for humanity|young men's christian|ymca|catholic charities|lutheran social|jewish federation|not-?for-?profit corporation|non-?profit corporation|501\(c\)|port authority|transit authority)\b/i;
const AG_GREENBELT_RE = /\b(greenbelt|green belt|agricultural|agriculture|use[- ]value|open[- ]space|farmland|williamson act|rollback|roll-back|current use|conservation use)\b/i;
const VALUE_ADD_RE = /\b(value[- ]?add|reposition|redevelop|re-?develop|renovat|remodel|expansion|expand|densif|ground[- ]up|new construction|build[- ]?out|pad (site|development)|outparcel develop)\b/i;

const yearsUntil = (expiry: string | null | undefined): number | null => {
  if (!expiry) return null;
  const s = String(expiry).trim();
  const yr = /^\d{4}$/.test(s) ? Number(s) : (Date.parse(s) ? new Date(Date.parse(s)).getFullYear() : null);
  if (yr == null || !Number.isFinite(yr)) return null;
  return yr - new Date().getFullYear();
};
const fmtUSD = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;

export function assessTaxTriggers(input: TaxTriggerInput): TaxTrigger[] {
  const out: TaxTrigger[] = [];
  const j = resolveJurisdiction(input.state, input.county);
  const price = numOrNull(input.acquisitionPrice);
  const taxes = numOrNull(input.currentAnnualTaxes);
  const hold = input.holdYears != null && Number.isFinite(Number(input.holdYears)) ? Math.round(Number(input.holdYears)) : 10;

  // 1) Loss of exemption — a tax-exempt seller means the OM's current-tax figure is
  // NOT what a taxable KPR buyer will pay. The single biggest "taxes look like ~$0" trap.
  const sellerLooksExempt = !!input.sellerName && EXEMPT_OWNER_RE.test(input.sellerName);
  if (input.sellerTaxExempt === true || sellerLooksExempt) {
    out.push({
      kind: "exemption_loss",
      severity: "high",
      title: "Loss of tax exemption on sale",
      message: `The current owner appears to be a tax-exempt entity${sellerLooksExempt && input.sellerName ? ` (${input.sellerName.trim()})` : ""}, so the property is likely off the tax roll or PILOT-only today. A taxable buyer faces a NEW, fully-assessed ad-valorem bill the OM's current-tax line does not reflect — pull the assessor's market value × the local mill rate to size the post-close bill before underwriting. Do NOT trust the in-place tax figure.`,
      confidence: input.sellerTaxExempt === true ? "high" : "medium",
    });
  } else if (price != null && taxes != null && taxes > 0 && taxes / price < 0.001) {
    // 2) Abnormally low effective tax (no exempt-seller flag, but the bill is tiny vs
    // price) — possible undisclosed exemption/abatement or a capture error. Flag to verify.
    out.push({
      kind: "low_tax_trap",
      severity: "medium",
      title: "Current taxes look abnormally low",
      message: `Current taxes (${fmtUSD(taxes)}/yr) are under 0.1% of the ${fmtUSD(price)} price — unusually low for commercial. Confirm the bill isn't suppressed by an exemption, abatement, or a stale/partial assessment; a taxable, fully-assessed bill could be materially higher. Verify against the assessor record.`,
      confidence: "low",
    });
  }

  // 3) Agricultural / greenbelt rollback — change of use to retail recaptures deferred
  // back-taxes plus steps the parcel to full value. Real on outparcels / converted land.
  const agText = `${input.specialAssessments || ""} ${input.notes || ""}`;
  if (input.agOrGreenbeltAssessed === true || AG_GREENBELT_RE.test(agText)) {
    out.push({
      kind: "ag_rollback",
      severity: input.agOrGreenbeltAssessed === true ? "high" : "medium",
      title: "Agricultural / greenbelt rollback risk",
      message: `The parcel appears to be assessed under an agricultural / greenbelt / use-value program. Converting (or having already converted) it to retail use triggers ROLLBACK taxes — recapture of the deferred tax savings for the prior 3–7 years PLUS a step to full market assessment. Confirm the parcel's current-use status and quantify any rollback liability with the assessor; it can be a six-figure closing item.`,
      confidence: input.agOrGreenbeltAssessed === true ? "medium" : "low",
    });
  }

  // 4) Capital improvements / renovation — new construction is reassessed (the ADDED
  // value) in virtually every state, INCLUDING acquisition-value states like CA where a
  // plain sale otherwise wouldn't reset much. Relevant for any value-add business plan.
  const renoText = `${input.acqStrategy || ""} ${input.notes || ""}`;
  const planningReno = VALUE_ADD_RE.test(renoText);
  const reno = numOrNull(input.renovationYear);
  const nowY = new Date().getFullYear();
  if (planningReno || (reno != null && reno >= nowY)) {
    out.push({
      kind: "renovation",
      severity: "low",
      title: "Capital improvements add assessed value",
      message: `${planningReno ? "The business plan involves renovation / repositioning / new construction. " : `A renovation is dated ${reno}. `}Improvements are reassessed (the added value) in essentially every jurisdiction — even acquisition-value states like California reassess NEW construction while leaving the existing basis alone. Budget the incremental tax on the improved value, separate from any sale-driven reset.`,
      confidence: "medium",
    });
  }

  // 5) Abatement expiry — the bill steps to un-abated taxes when the break ends. (The
  // forecaster sizes the step; this surfaces the timing + whether it survives the sale.)
  if (input.taxAbatement?.present) {
    const yrs = yearsUntil(input.taxAbatement.expiry);
    const within = yrs != null && yrs >= 0 && yrs <= hold;
    const survives = input.taxAbatement.survivesSale;
    out.push({
      kind: "abatement_expiry",
      severity: within ? "high" : "medium",
      title: "Tax abatement / PILOT in place",
      message: `${input.taxAbatement.type ? `A ${input.taxAbatement.type} ` : "A tax break "}holds the CURRENT bill artificially low${input.taxAbatement.expiry ? ` and ${within ? `expires ~${input.taxAbatement.expiry} — within the ${hold}-yr hold` : `expires ${input.taxAbatement.expiry}`}` : ""}. ${survives === false ? "It does NOT transfer to a buyer — underwrite the full bill from day one. " : survives === true ? "It transfers to a buyer, but " : "Confirm whether it survives the sale; if not, the full bill hits at close. "}Model the step UP to un-abated taxes${within ? " inside the hold" : " at expiry"} — don't carry the abated figure to perpetuity.`,
      confidence: "medium",
    });
  }

  // 6) Known scheduled statutory changes within the hold (ratio phase-downs, cap sunsets).
  if (j?.upcomingChanges?.length) {
    for (const ch of j.upcomingChanges) {
      const yrs = yearsUntil(ch.effective);
      if (yrs != null && yrs > hold) continue; // beyond the hold — skip
      out.push({
        kind: "law_change",
        severity: ch.direction === "increase" ? "medium" : "low",
        title: `Scheduled ${j.stateName} tax-law change (${ch.effective})`,
        message: `${ch.note}${ch.direction === "increase" ? " Treat as a headwind to underwrite." : ch.direction === "decrease" ? " A modest tailwind, but don't bank on it surviving future sessions." : " Monitor."}`,
        confidence: j.confidence,
      });
    }
  }

  return out;
}
