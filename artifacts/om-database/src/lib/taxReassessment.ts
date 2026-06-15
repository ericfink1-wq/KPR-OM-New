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
    annualCapPctCommercial: null, confidence: "high", sources: [{ title: "Colorado General Assembly — SB24-233", url: "https://leg.colorado.gov/bills/sb24-233" }] },
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
    confidence: "high", sources: [{ title: "Texas Comptroller — Valuing Property", url: "https://www.comptroller.texas.gov/taxes/property-tax/valuing-property.php" }],
    caveat: "Commercial is annual-to-market and uncapped for most retail (>$5.3M); a temporary 20% small-parcel circuit-breaker sunsets after TY2026." },
  IL: { state: "IL", stateName: "Illinois", saleTriggersReassessment: "no", reassessmentBasis: "equalized_value",
    saleTriggerNote: "No acquisition-value reset. Assessed at a statutory fraction of market, then a state equalization multiplier is applied. A sale does NOT reset to purchase price.",
    assessmentCycleYears: 3, cycleNote: "Cook County triennial; the other 101 counties quadrennial. Value as of Jan 1.",
    assessmentRatioCommercialPct: 25, ratioNote: "Cook classifies commercial at 25% of market; all other counties uniform 33⅓%. A state multiplier then equalizes.",
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

// ── The estimator ────────────────────────────────────────────────────────────
export interface ReassessInput {
  state: string | null | undefined;
  acquisitionPrice: number | null;       // the price we'd pay
  currentAssessedValue?: number | null;  // current taxable/assessed value from the OM tax page
  currentAnnualTaxes?: number | null;    // current annual RE taxes from the OM
  applyScAtiExemption?: boolean;         // SC only — model the optional 25% ATI exemption
}

export interface ReassessResult {
  jurisdiction: TaxJurisdiction | null;
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
  const j = getTaxJurisdiction(input.state);
  const price = numOrNull(input.acquisitionPrice);
  const curAssessed = numOrNull(input.currentAssessedValue);
  const curTaxes = numOrNull(input.currentAnnualTaxes);
  const ratio = j?.assessmentRatioCommercialPct ?? null;

  // The property's REAL effective rate on its assessed value — the most accurate
  // multiplier for a new assessment. Falls back to null when we lack the bill.
  const effRate = curTaxes != null && curAssessed != null && curAssessed > 0 ? curTaxes / curAssessed : null;
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
      out.estPostSaleTaxes = r2(fullValueAssessed * effRate);
    }
    return out;
  }

  if (reset && fullValueAssessed != null && effRate != null && curTaxes != null) {
    const postTaxes = fullValueAssessed * effRate;
    out.estPostSaleAssessed = r2(fullValueAssessed);
    out.estPostSaleTaxes = r2(postTaxes);
    out.estAnnualStepUp = r2(postTaxes - curTaxes);
    out.stepUpPct = curTaxes > 0 ? Math.round(((postTaxes - curTaxes) / curTaxes) * 100) : null;
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
      const nextTaxes = fullValueAssessed * effRate;
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
