// ─────────────────────────────────────────────────────────────────────────────
// Customary commercial real estate closing cost data, by state.
//
// TWO-LAYER SOURCING (so you can judge how far to trust each figure):
//
//   1. WHO PAYS (buyer/seller/split): anchored to Fidelity National Title's
//      "Real Estate Laws & Customs by State" guide, current as of Aug 2025.
//      See FIDELITY_SOURCE_URL. This is authoritative for customary splits and
//      for which taxes a state imposes.
//
//   2. RATES (the %): from state statute / DOR. Rates CHANGE — each jurisdiction
//      carries a `ratesAsOf` date. Treat rates as a careful estimate, not gospel,
//      and verify for any live deal. (Case in point: NJ overhauled its mansion
//      tax effective 2025-07-10, and even Fidelity's Aug-2025 guide hadn't caught
//      up — the statute is more current than the customs chart on that point.)
//
// Customary splits are negotiable per deal. Always confirm with the title company
// and counsel before relying on these for an offer.
// ─────────────────────────────────────────────────────────────────────────────

export const FIDELITY_SOURCE_URL = "https://media.fntic.com/ncs/flipbooks/lawsandcustoms/";
export const SPLITS_SOURCE = "Fidelity National Title — Laws & Customs by State (Aug 2025)";
export const DEFAULT_LTV = 0.65;

export type Party = "buyer" | "seller" | "split";

export interface TaxTier {
  over: number;   // applies when price exceeds this amount (tiers ascending)
  rate: number;   // rate applied to the ENTIRE price at this tier
}

// ── Title insurance MARGINAL schedule ────────────────────────────────────────
// Title premiums are regressive and computed on the INCREMENT, not the whole
// price (unlike TaxTier, which is a cliff applied to the entire price). Each
// bracket says: once price passes `over`, premium = `base` + `per1000` per
// $1,000 of price ABOVE `over`. This matches how promulgated/filed-rate manuals
// (NJ, NY/TIRSA, PA/TIRBOP, TX, FL) actually publish their schedules.
export interface TitleBracket {
  over: number;     // threshold; bracket applies when price > over
  base: number;     // cumulative premium AT the threshold
  per1000: number;  // $ per $1,000 of price above the threshold (marginal)
}

export interface TitleSchedule {
  source: string;          // citation for the schedule
  promulgated: boolean;    // true = state-set / filed-rate official schedule; false = representative
  minPremium?: number;     // floor (e.g. NJ $200)
  brackets: TitleBracket[]; // ascending by `over`; first bracket should have over: 0
}

export interface TaxLineItem {
  name: string;
  rate: number;             // representative/flat rate (0.004 = 0.4%); for tiered items, the top-tier rate
  rateMin?: number;         // sliding/tiered low end (for display)
  rateMax?: number;         // sliding/tiered high end (for display)
  tiers?: TaxTier[];        // CLIFF method: rate chosen by price tier, applied to the ENTIRE price (e.g. NJ mansion tax)
  marginalTiers?: TaxTier[];// MARGINAL method: each rate applies only to the PORTION of price within that bracket (e.g. WA REET, CT conveyance, NJ RTF). Takes precedence over `tiers`.
  base: "price" | "loan";
  party: Party;
  entitySaleOnly?: boolean; // e.g. controlling-interest transfer tax — only on entity sales, not deed sales
  // ── Mutually-exclusive locality options ──────────────────────────────────
  // Lines sharing an `altGroup` are ALTERNATIVES (different county/city), not
  // additive. Only the selected one applies to the total; the rest show $0.
  altGroup?: string;        // group id, e.g. "NY-local", "CA-city", "MD-county"
  altLabel?: string;        // short label for the locality picker (e.g. "NYC (commercial)")
  altDefault?: boolean;     // the option applied when the user hasn't picked a locality
  residentialOnly?: boolean;// excluded from a commercial deal's total (shown $0 w/ note)
  notes?: string;
}

export interface JurisdictionRates {
  state: string;
  stateName: string;
  ratesAsOf: string;             // e.g. "2026-05" — when the RATES were last verified
  titleInsuranceRate: number;    // owner's policy, % of price (FLAT fallback when no titleSchedule)
  titleInsuranceParty: Party;
  titleSchedule?: TitleSchedule; // when present, used INSTEAD of the flat titleInsuranceRate (regressive)
  transferTaxes: TaxLineItem[];
  mortgageRecordingTax?: TaxLineItem;
  recordingFeesFlat: number;
  notes?: string;
}

// ── Representative title schedule for COMPETITIVE (file-and-use) states ──────────
// These states have no single promulgated/filed-bureau rate — each underwriter
// files its own. This is a REPRESENTATIVE regressive curve (promulgated: false),
// anchored to published competitive-Northeast commercial rates (~$3.5/$1,000 in
// the $200K–$500K band) and the standard regressive shape underwriters use.
// Directionally accurate (~0.22%–0.35% at commercial sizes) and far better than a
// flat %, but NOT a sourced per-state filed rate — confirm an underwriter quote
// for any live deal. Shared so it's clear this is one regional estimate, not many.
const REP_TITLE_NE_COMPETITIVE: TitleSchedule = {
  source: "Representative regressive schedule — competitive (file-and-use) state with no single filed rate; anchored to published NE commercial title rates. Confirm underwriter quote for live deals.",
  promulgated: false,
  minPremium: 175,
  brackets: [
    { over: 0,         base: 0,     per1000: 5.00 },
    { over: 100000,    base: 500,   per1000: 3.75 },
    { over: 500000,    base: 2000,  per1000: 3.00 },
    { over: 1000000,   base: 3500,  per1000: 2.50 },
    { over: 5000000,   base: 13500, per1000: 2.25 },
    { over: 10000000,  base: 24750, per1000: 2.00 },
  ],
};

// ── Representative title schedule for SOUTHEAST competitive states ──────────────
// GA/SC/TN/AL/MS/KY/WV/AR/LA are competitive (file-and-use); GA anchors the region
// at ~$3.65/$1,000 in the $100K–$500K band — essentially the same curve as the NE.
// Representative (promulgated: false); confirm an underwriter quote for live deals.
const REP_TITLE_SE_COMPETITIVE: TitleSchedule = {
  source: "Representative regressive schedule — competitive (file-and-use) Southeast state; anchored to published GA commercial title rates (~$3.65/$1,000). Confirm underwriter quote for live deals.",
  promulgated: false,
  minPremium: 150,
  brackets: [
    { over: 0,         base: 0,     per1000: 5.00 },
    { over: 100000,    base: 500,   per1000: 3.65 },
    { over: 500000,    base: 1960,  per1000: 3.00 },
    { over: 1000000,   base: 3460,  per1000: 2.50 },
    { over: 5000000,   base: 13460, per1000: 2.25 },
    { over: 10000000,  base: 24710, per1000: 2.00 },
  ],
};

// ── North Carolina — regulated low-cost outlier (NC Title Ins. Rating Bureau) ───
// NC premiums are roughly HALF the national norm (~$2.17/$1,000 blended). NCTIRB
// sets a state-regulated tiered schedule. Representative bracketed curve calibrated
// to that level (promulgated: false — exact NCTIRB brackets not encoded).
const REP_TITLE_NC: TitleSchedule = {
  source: "NC Title Insurance Rating Bureau (NCTIRB) state-regulated rate — representative curve calibrated to the ~$2.17/$1,000 NC level. Confirm exact NCTIRB premium for live deals.",
  promulgated: false,
  minPremium: 120,
  brackets: [
    { over: 0,         base: 0,     per1000: 2.40 },
    { over: 100000,    base: 240,   per1000: 2.10 },
    { over: 500000,    base: 1080,  per1000: 1.90 },
    { over: 1000000,   base: 2030,  per1000: 1.75 },
    { over: 5000000,   base: 9030,  per1000: 1.60 },
    { over: 10000000,  base: 17030, per1000: 1.50 },
  ],
};

// ── Representative title schedule for MIDWEST competitive states ────────────────
// IL/IN/MI/WI/MN/MO/KS/NE are competitive (file-and-use), broadly ~$3.5–5/$1,000
// declining. Representative (promulgated: false); confirm an underwriter quote.
const REP_TITLE_MW_COMPETITIVE: TitleSchedule = {
  source: "Representative regressive schedule — competitive (file-and-use) Midwest state with no single filed rate. Confirm underwriter quote for live deals.",
  promulgated: false,
  minPremium: 150,
  brackets: [
    { over: 0,         base: 0,     per1000: 5.00 },
    { over: 100000,    base: 500,   per1000: 3.50 },
    { over: 500000,    base: 1900,  per1000: 2.90 },
    { over: 1000000,   base: 3350,  per1000: 2.50 },
    { over: 5000000,   base: 13350, per1000: 2.25 },
    { over: 10000000,  base: 24600, per1000: 2.00 },
  ],
};

// ── Iowa — unique: private title insurance is effectively barred; the state-run ──
// Iowa Title Guaranty (ITG) issues coverage at very low statutory-ish fees (far
// below private-market premiums). Representative low schedule (promulgated: false);
// confirm exact ITG commercial fee for live deals.
const REP_TITLE_IA: TitleSchedule = {
  source: "Iowa Title Guaranty (state program; private title insurance barred in IA) — representative low fee schedule, well below private-market rates. Confirm exact ITG commercial fee for live deals.",
  promulgated: false,
  minPremium: 175,
  brackets: [
    { over: 0,         base: 0,    per1000: 1.00 },
    { over: 1000000,   base: 1000, per1000: 0.90 },
    { over: 5000000,   base: 4600, per1000: 0.75 },
    { over: 10000000,  base: 8350, per1000: 0.65 },
  ],
};

// ── Representative title schedule for WEST / MOUNTAIN / non-contiguous states ────
// CA/OR/NV/AZ/UT/CO/ID/MT/WY/OK/AK/HI/SD/ND are competitive (file-and-use). The
// West is heterogeneous (HI tends higher; SD/ND lower), so this is a mid-range
// representative curve, slightly above the eastern norm. Representative
// (promulgated: false) — confirm an underwriter quote for live deals.
const REP_TITLE_WEST_COMPETITIVE: TitleSchedule = {
  source: "Representative regressive schedule — competitive (file-and-use) Western/Mountain state with no single filed rate (region is heterogeneous; HI runs higher, SD/ND lower). Confirm underwriter quote for live deals.",
  promulgated: false,
  minPremium: 175,
  brackets: [
    { over: 0,         base: 0,     per1000: 5.50 },
    { over: 100000,    base: 550,   per1000: 4.00 },
    { over: 500000,    base: 2150,  per1000: 3.25 },
    { over: 1000000,   base: 3775,  per1000: 2.75 },
    { over: 5000000,   base: 14775, per1000: 2.40 },
    { over: 10000000,  base: 26775, per1000: 2.10 },
  ],
};

// New Mexico is a PROMULGATED single-rate state (OSI sets one statewide schedule),
// historically on the high side. Exact Appendix A basic-premium brackets not encoded
// here, so this is a representative curve calibrated to NM's promulgated level.
const REP_TITLE_NM: TitleSchedule = {
  source: "New Mexico OSI promulgated single statewide rate (historically high). Representative curve calibrated to NM's promulgated level — confirm exact OSI Appendix A basic-premium brackets for live deals.",
  promulgated: false,
  minPremium: 200,
  brackets: [
    { over: 0,         base: 0,     per1000: 6.00 },
    { over: 100000,    base: 600,   per1000: 4.40 },
    { over: 500000,    base: 2360,  per1000: 3.50 },
    { over: 1000000,   base: 4110,  per1000: 3.00 },
    { over: 5000000,   base: 16110, per1000: 2.60 },
    { over: 10000000,  base: 29110, per1000: 2.30 },
  ],
};

// ── All 50 states + DC: state, county, and major city/local transfer taxes ───────
// THREE-LAYER SOURCING:
//   1. WHO PAYS: Fidelity National Title Laws & Customs (Aug 2025)
//   2. STATE RATES: state DOR statutes / revenue codes
//   3. LOCAL RATES: county recorder offices, municipal codes, city ordinances
// ratesAsOf = "2026-05". Verify all rates before closing — local rates change.
export const CLOSING_COSTS_BY_STATE: Record<string, JurisdictionRates> = {

  // ─────────────────────────────────────────────────────────────────────────
  // NORTHEAST
  // ─────────────────────────────────────────────────────────────────────────

  CT: {
    state: "CT", stateName: "Connecticut", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_NE_COMPETITIVE,
    transferTaxes: [
      { name: "State Conveyance Tax", rate: 0.0125, base: "price", party: "seller",
        notes: "Commercial / non-residential conveyances: flat 1.25% per CGS §12-494. (The graduated 0.75%/1.25%/2.25% schedule applies only to RESIDENTIAL dwellings — not commercial.) Seller pays." },
      { name: "Municipal Conveyance Tax", rate: 0.0025, base: "price", party: "seller",
        notes: "Base 0.25% — every CT town levies it (most common). Eligible 'targeted-investment' municipalities (Hartford, New Haven, Bridgeport, Waterbury, New London, Windham) may charge up to 0.5%. Seller pays." },
    ],
    recordingFeesFlat: 100,
    notes: "State + municipal conveyance taxes both seller-paid (Fidelity Aug-2025). Title insurance buyer-paid. No county-level transfer taxes in CT.",
  },

  DE: {
    state: "DE", stateName: "Delaware", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_NE_COMPETITIVE,
    transferTaxes: [
      { name: "State Realty Transfer Tax", rate: 0.02, base: "price", party: "split",
        notes: "2% state. Split 50/50: buyer 1% + seller 1%." },
      { name: "New Castle County Transfer Tax (Wilmington area)", altGroup: "DE-county", altLabel: "New Castle County", altDefault: true, rate: 0.015, rateMin: 0, rateMax: 0.015,
        base: "price", party: "split",
        notes: "New Castle County ONLY (Wilmington, Newark, Dover area): 1.5% each side. Combined with state: 4.0% total (2% buyer / 2% seller). One of the highest combined transfer tax burdens in the US." },
      { name: "Kent & Sussex County Transfer Tax", altGroup: "DE-county", altLabel: "Kent / Sussex County", rate: 0.005, rateMin: 0, rateMax: 0.005,
        base: "price", party: "split",
        notes: "Kent County (Dover) and Sussex County (Rehoboth Beach, Lewes): 0.5% each side. Combined with state: 2.5% total (1.5% buyer / 1.5% seller). Significant but lower than New Castle." },
    ],
    recordingFeesFlat: 100,
    notes: "Always verify county. New Castle (most commercial activity): 4% combined. Kent/Sussex: 2.5% combined. All split 50/50. Title insurance buyer-paid.",
  },

  MA: {
    state: "MA", stateName: "Massachusetts", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_NE_COMPETITIVE,
    transferTaxes: [
      { name: "Deeds Excise Tax — Standard (all counties except island counties)", altGroup: "MA-region", altLabel: "Mainland (standard)", altDefault: true,
        rate: 0.00456, base: "price", party: "seller",
        notes: "$4.56 per $1,000 = 0.456%. Seller pays. Applies in Essex, Middlesex, Norfolk, Suffolk (Boston), Worcester, Hampden, Hampshire, Franklin, Plymouth, Bristol counties." },
      { name: "Deeds Excise Tax — Island Counties (Cape Cod / Martha's Vineyard / Nantucket)", altGroup: "MA-region", altLabel: "Cape / Islands",
        rate: 0.00656, rateMin: 0.00656, rateMax: 0.00656, base: "price", party: "seller",
        notes: "Barnstable (Cape Cod), Dukes (Martha's Vineyard), and Nantucket counties ONLY. Standard $4.56/$1K + Land Bank surcharge $2.00/$1K = $6.56 per $1,000 = 0.656% total. Seller pays. Surcharge goes to county land bank conservation fund." },
    ],
    recordingFeesFlat: 175,
    notes: "No city-level transfer taxes in MA as of 2026 (several cities including Boston and Somerville have proposed local transfer fees but none enacted). Boston: standard 0.456% only. Cape/Vineyard/Nantucket: 0.656%.",
  },

  ME: {
    state: "ME", stateName: "Maine", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_NE_COMPETITIVE,
    transferTaxes: [
      { name: "Real Estate Transfer Tax", rate: 0.0044, base: "price", party: "split",
        notes: "$2.20 per $500 = 0.44% total; split evenly 0.22% buyer + 0.22% seller. Statewide uniform rate. No county or city add-ons in Maine." },
    ],
    recordingFeesFlat: 50,
    notes: "State-only, split 50/50. No county or city variations. Portland, Bangor, Augusta all use same rate.",
  },

  NH: {
    state: "NH", stateName: "New Hampshire", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_NE_COMPETITIVE,
    transferTaxes: [
      { name: "Real Estate Transfer Tax — Buyer", rate: 0.0075, base: "price", party: "buyer",
        notes: "$0.75 per $100 = 0.75%. Buyer pays separately." },
      { name: "Real Estate Transfer Tax — Seller", rate: 0.0075, base: "price", party: "seller",
        notes: "$0.75 per $100 = 0.75%. Seller pays separately. Total combined: 1.5%. No county or city add-ons — Manchester, Concord, Nashua all use same rate." },
    ],
    recordingFeesFlat: 50,
    notes: "Both buyer AND seller each pay 0.75% (1.5% combined total). No county or city variations in NH.",
  },

  NJ: {
    state: "NJ", stateName: "New Jersey", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: {
      source: "NJ Land Title Insurance Rating Bureau — standard owner's rate schedule (NJ DOBI-approved; Rate Manual eff. 2023-11-01)",
      promulgated: true,
      minPremium: 200,
      brackets: [
        { over: 0,        base: 0,    per1000: 5.25 },
        { over: 100000,   base: 525,  per1000: 4.25 },
        { over: 500000,   base: 2225, per1000: 2.75 },
        { over: 2000000,  base: 6350, per1000: 2.00 },
      ],
    },
    transferTaxes: [
      { name: "Realty Transfer Fee (RTF) — Graduated", rate: 0.0121, rateMin: 0.004, rateMax: 0.0121,
        base: "price", party: "seller",
        marginalTiers: [
          { over: 0,      rate: 0.004 },
          { over: 150000, rate: 0.0067 },
          { over: 200000, rate: 0.0085 },
          { over: 350000, rate: 0.0105 },
          { over: 550000, rate: 0.0121 },
        ],
        notes: "Graduated (marginal): 0.4% on first $150K; 0.67% $150K–$200K; 0.85% $200K–$350K; 1.05% $350K–$550K; 1.21% above $550K. Each rate applies only to the portion in that band. Seller pays. No county or city RTF add-ons." },
      { name: "Mansion Tax / Supplemental RTF (over $1M) — Seller", rate: 0.035, rateMin: 0.01, rateMax: 0.035,
        base: "price", party: "seller",
        tiers: [
          { over: 1000000, rate: 0.01 }, { over: 2000000, rate: 0.02 },
          { over: 2500000, rate: 0.025 }, { over: 3000000, rate: 0.03 },
          { over: 3500000, rate: 0.035 },
        ],
        notes: "Effective 2025-07-10: SELLER now pays this tax (prior law: buyer). Tiered 1%–3.5% applied to ENTIRE price above $1M. Includes Class 4A commercial and Class 4B industrial. Rate applied to full price, not just the excess." },
      { name: "Controlling Interest Transfer Tax (entity sales only)", rate: 0.035, rateMin: 0.01, rateMax: 0.035,
        base: "price", party: "seller", entitySaleOnly: true,
        tiers: [
          { over: 1000000, rate: 0.01 }, { over: 2000000, rate: 0.02 },
          { over: 2500000, rate: 0.025 }, { over: 3000000, rate: 0.03 },
          { over: 3500000, rate: 0.035 },
        ],
        notes: "Entity sale only (controlling interest in entity owning Class 4 commercial/industrial). Same tiered structure as mansion tax. Seller-paid post 2025-07-10." },
    ],
    recordingFeesFlat: 200,
    notes: "No county or city-level transfer taxes beyond state RTF. Newark, Jersey City, Hoboken, Trenton: all use state rates only. NJ mansion tax restructure (2025-07-10) means seller's combined RTF + mansion tax can approach 4.5%+ on large deals.",
  },

  NY: {
    state: "NY", stateName: "New York", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: {
      source: "TIRSA (Title Insurance Rate Service Assoc.) filed Owner's Rate, Zone 2 — NYC metro/downstate (Albany, Bronx, Kings, Nassau, NY, Queens, Richmond, Rockland, Suffolk, Westchester, etc.). Standard schedule; upstate Zone 1 differs slightly.",
      promulgated: true,
      minPremium: 402,
      brackets: [
        { over: 0,         base: 402,      per1000: 0 },
        { over: 35000,     base: 402,      per1000: 6.67 },
        { over: 50000,     base: 502.05,   per1000: 5.43 },
        { over: 100000,    base: 773.55,   per1000: 4.36 },
        { over: 500000,    base: 2517.55,  per1000: 3.98 },
        { over: 1000000,   base: 4507.55,  per1000: 3.66 },
        { over: 5000000,   base: 19147.55, per1000: 3.25 },
        { over: 10000000,  base: 35397.55, per1000: 3.07 },
        { over: 15000000,  base: 50747.55, per1000: 2.76 },
      ],
    },
    transferTaxes: [
      { name: "No local transfer tax (default)", rate: 0, base: "price", party: "seller", altGroup: "NY-local", altLabel: "Outside NYC / Yonkers", altDefault: true, notes: "Most of NY (Nassau, Suffolk, Westchester ex-Yonkers, upstate): no city transfer tax — state 0.4% only." },
      { name: "NYS Real Estate Transfer Tax", rate: 0.004, base: "price", party: "seller",
        notes: "0.4% statewide. Seller pays. Applies in NYC, Nassau, Suffolk, Westchester, and all upstate counties. Base rate; additional NYC taxes apply below." },
      { name: "NYC Real Property Transfer Tax — Class 4 Commercial", altGroup: "NY-local", altLabel: "NYC (commercial)", rate: 0.02625, rateMin: 0.01425, rateMax: 0.02625,
        base: "price", party: "seller",
        tiers: [{ over: 0, rate: 0.01425 }, { over: 500000, rate: 0.02625 }],
        notes: "NYC 5 boroughs ONLY. Class 4 commercial: 1.425% ≤$500K; 2.625% above. Seller pays. Combined with state 0.4%: total NYC seller burden ~3.0% on large commercial. Absolutely NO city transfer tax outside the 5 boroughs (Nassau, Suffolk, Westchester: state only)." },
      { name: "NYC Real Property Transfer Tax — Class 1 & 2 Residential", residentialOnly: true, rate: 0.01425, rateMin: 0.01, rateMax: 0.01425,
        base: "price", party: "seller",
        tiers: [{ over: 0, rate: 0.01 }, { over: 500000, rate: 0.01425 }],
        notes: "NYC residential: 1.0% ≤$500K; 1.425% above. Seller pays. Commercial rate (2.625%) applies to most investment property." },
      { name: "Yonkers City Transfer Tax", altGroup: "NY-local", altLabel: "Yonkers", rate: 0.025, rateMin: 0, rateMax: 0.025,
        base: "price", party: "seller",
        notes: "City of Yonkers (Westchester County) ONLY: 2.5% city transfer tax in addition to state 0.4%. Combined Yonkers: 2.9% total. Other Westchester municipalities: no local tax. Verify property is in Yonkers city limits." },
      { name: "NYS Additional Transfer Tax (residential COOP/condo >$2M)", residentialOnly: true, rate: 0.0025, rateMin: 0, rateMax: 0.0025,
        base: "price", party: "seller",
        notes: "Residential coops/condos and townhomes over $2M in NYC only: 0.25% additional seller tax. Commercial properties: generally not applicable. Verify property type." },
    ],
    mortgageRecordingTax: { name: "Mortgage Recording Tax (MRT)", rate: 0.028, rateMin: 0.0105, rateMax: 0.028,
      base: "loan", party: "buyer",
      notes: "Shown at the NYC COMMERCIAL rate: 2.8% (2.05% state + 0.75% NYC) on loans ≥$500K. Outside NYC the MRT is lower — Nassau/Suffolk/Westchester ~1.05%–1.3%, rest of NY ~1.05%; reduce accordingly if the property isn't in NYC. Buyer pays; MRT is the largest single buyer cost in NYC deals." },
    recordingFeesFlat: 250,
    notes: "NYC is among the most expensive closing jurisdictions nationally. State 0.4% + NYC RPTT 2.625% = ~3.025% seller; MRT 2.8% buyer. Total NYC transfer cost on a $20M deal: seller ~$605K + buyer ~$364K = ~$969K. Upstate: state 0.4% seller only. Always identify borough/county.",
  },

  RI: {
    state: "RI", stateName: "Rhode Island", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_NE_COMPETITIVE,
    transferTaxes: [
      { name: "Realty Transfer Tax", rate: 0.0046, base: "price", party: "seller",
        notes: "$2.30 per $500 = 0.46%. Seller pays. Uniform statewide rate. Providence, Warwick, and all RI cities/towns: no municipal add-ons." },
    ],
    recordingFeesFlat: 50,
    notes: "State-only; no county or city variations in RI. Title insurance buyer-paid.",
  },

  VT: {
    state: "VT", stateName: "Vermont", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_NE_COMPETITIVE,
    transferTaxes: [
      { name: "Property Transfer Tax — Commercial/Non-Primary-Residence",
        rate: 0.0125, base: "price", party: "buyer",
        notes: "1.25% of purchase price. Buyer pays. Commercial, investment, and non-primary-residence property always taxed at 1.25%. (Primary residence first $100K: 0.5%; remainder: 1.25%.) No county or town-level add-ons in VT." },
    ],
    recordingFeesFlat: 50,
    notes: "State-only at 1.25% for commercial — one of the higher buyer-paid transfer tax rates. Burlington and all VT towns use same rate.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // MID-ATLANTIC
  // ─────────────────────────────────────────────────────────────────────────

  DC: {
    state: "DC", stateName: "District of Columbia", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_NE_COMPETITIVE,
    transferTaxes: [
      { name: "Deed Transfer Tax — Buyer", rate: 0.0145, base: "price", party: "buyer",
        notes: "1.45% buyer share of DC deed transfer tax. Commercial properties >$400K. (<$400K: 0.55% buyer.)" },
      { name: "Deed Transfer Tax — Seller", rate: 0.0145, base: "price", party: "seller",
        notes: "1.45% seller share. Commercial >$400K. Combined deed transfer: 2.9% total (1.45% + 1.45%)." },
      { name: "Deed Recordation Tax", rate: 0.0145, base: "price", party: "buyer",
        notes: "1.45% ADDITIONAL recordation tax on deed. Separate from and in addition to the transfer tax above. Buyer pays. This means total buyer deed burden on a large commercial: 1.45% transfer + 1.45% recordation = 2.9%." },
    ],
    mortgageRecordingTax: { name: "Mortgage Recordation Tax", rate: 0.0145, base: "loan", party: "buyer",
      notes: "1.45% of loan amount. Buyer pays. On a 65% LTV deal: adds ~0.94% of purchase price. Combined with deed taxes, a DC acquisition can carry 4%+ in taxes on the price alone." },
    recordingFeesFlat: 150,
    notes: "DC is among the most expensive US closing jurisdictions. Seller: 1.45%. Buyer: 1.45% transfer + 1.45% recordation = 2.9% on price + 1.45% on loan. Total tax on a $10M deal at 65% LTV: ~$527K. Verify current rates with DC OTR (otr.cfo.dc.gov) before closing.",
  },

  MD: {
    state: "MD", stateName: "Maryland", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_NE_COMPETITIVE,
    transferTaxes: [
      { name: "State Transfer Tax", rate: 0.005, base: "price", party: "split",
        notes: "0.5% state. Split equally by custom (buyer 0.25% + seller 0.25%). First-time homebuyers get exemption — not applicable to commercial." },
      { name: "County Transfer Tax — Baltimore City", altGroup: "MD-county", altLabel: "Baltimore City", rate: 0.015, rateMin: 0, rateMax: 0.015,
        base: "price", party: "split",
        notes: "Baltimore City ONLY: 1.5% city transfer tax. Split 50/50. Combined with state: 2.0% transfer tax total. PLUS Baltimore City recordation tax 1.0% (see mortgage recordation line). Grand total deed burden in Baltimore City: ~3.0%." },
      { name: "County Transfer Tax — Baltimore County, Howard County", altGroup: "MD-county", altLabel: "Baltimore / Howard County", rate: 0.015, rateMin: 0, rateMax: 0.015,
        base: "price", party: "split",
        notes: "Baltimore County (Towson) and Howard County (Columbia): 1.5% county transfer tax each. Split 50/50. Combined with state: 2.0% total transfer tax." },
      { name: "County Transfer Tax — Prince George's County", altGroup: "MD-county", altLabel: "Prince George County", rate: 0.014, rateMin: 0, rateMax: 0.014,
        base: "price", party: "split",
        notes: "Prince George's County (Landover, Bowie, Hyattsville): 1.4% county. Split 50/50. Combined with state: 1.9% total." },
      { name: "County Transfer Tax — Anne Arundel, Harford, Montgomery, St. Mary's", altGroup: "MD-county", altLabel: "Anne Arundel / Montgomery / Harford",
        rate: 0.01, rateMin: 0, rateMax: 0.01, base: "price", party: "split",
        notes: "Anne Arundel (Annapolis), Harford (Bel Air), Montgomery (Rockville, Bethesda, Silver Spring), St. Mary's: 1.0% county each. Split 50/50. Combined with state: 1.5% total." },
      { name: "County Transfer Tax — All Other MD Counties", altGroup: "MD-county", altLabel: "All Other MD Counties", altDefault: true,
        rate: 0.005, rateMin: 0, rateMax: 0.005, base: "price", party: "split",
        notes: "Allegany, Calvert, Caroline, Carroll, Cecil, Charles, Dorchester, Frederick, Garrett, Kent, Queen Anne's, Somerset, Talbot, Washington, Wicomico, Worcester: 0.5% county each. Split 50/50. Combined with state: 1.0% total." },
    ],
    mortgageRecordingTax: { name: "County Recordation Tax (assessed on deed value / deed of trust)",
      rate: 0.0089, rateMin: 0.003, rateMax: 0.011, base: "loan", party: "split",
      notes: "SEPARATE from transfer tax. Also assessed on the deed and on deeds of trust. Varies by county: Allegany/Garrett/Kent $3/$1K (0.30%); most mid-tier counties $5–$6/$1K (0.50%–0.60%); Anne Arundel $7/$1K (0.70%); Baltimore City $10/$1K (1.00%); Montgomery $8.90/$1K (0.89%); Prince George's $11/$1K (1.10%); Talbot $7/$1K (0.70%). Split equally by custom. Baltimore City total deed burden: state 0.5% + county transfer 1.5% + city recordation 1.0% = 3.0% on price." },
    recordingFeesFlat: 100,
    notes: "ALWAYS verify the exact county. Maryland has both a Transfer Tax AND a Recordation Tax on the deed — each varies by county and both are split equally. Baltimore City: ~3.0% combined. Montgomery/Prince George's (DC suburbs): ~2.4–2.5%. Rural counties: ~1.0–1.3%. Transfer taxes + recordation taxes together represent the full MD closing cost burden.",
  },

  PA: {
    state: "PA", stateName: "Pennsylvania", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0055, titleInsuranceParty: "buyer",
    titleSchedule: {
      source: "Title Insurance Rating Bureau of Pennsylvania (TIRBOP) — filed all-inclusive Sale Rate (applies to all PA purchases statewide; one schedule, no zones)",
      promulgated: true,
      minPremium: 569,
      brackets: [
        { over: 0,         base: 569,    per1000: 0 },
        { over: 30000,     base: 569,    per1000: 7.41 },
        { over: 45000,     base: 680.15, per1000: 6.27 },
        { over: 100000,    base: 1025,   per1000: 5.70 },
        { over: 500000,    base: 3305,   per1000: 4.56 },
        { over: 1000000,   base: 5585,   per1000: 3.42 },
        { over: 2000000,   base: 9005,   per1000: 2.28 },
        { over: 7000000,   base: 20405,  per1000: 1.71 },
        { over: 30000000,  base: 59735,  per1000: 1.42 },
      ],
    },
    transferTaxes: [
      { name: "State Realty Transfer Tax", rate: 0.01, base: "price", party: "split",
        notes: "1.0% state. Split 50/50: buyer 0.5% + seller 0.5%." },
      { name: "Philadelphia Local RTT", altGroup: "PA-local", altLabel: "Philadelphia", rate: 0.03278, rateMin: 0, rateMax: 0.03278,
        base: "price", party: "split",
        notes: "City of Philadelphia ONLY: 3.278% local RTT (city 2.0% + school district 1.278%). Split 50/50. Combined with state: 4.278% total (buyer 2.139% + seller 2.139%). Apply ONLY when property is within Philadelphia city limits." },
      { name: "Pittsburgh / Allegheny County Local RTT", altGroup: "PA-local", altLabel: "Pittsburgh / Allegheny", rate: 0.02, rateMin: 0, rateMax: 0.02,
        base: "price", party: "split",
        notes: "City of Pittsburgh: 1.0% city + 1.0% Pittsburgh school district = 2.0% local. Split 50/50. Combined with state: 3.0% total. Allegheny County outside Pittsburgh: school district + municipality varies ~1%–2%; typically 2%–3% combined. Verify municipality + school district." },
      { name: "Scranton / Lackawanna County Area Local RTT", altGroup: "PA-local", altLabel: "Scranton / Lackawanna", rate: 0.02, rateMin: 0, rateMax: 0.02,
        base: "price", party: "split",
        notes: "City of Scranton: 2.0% local (city 1% + school district 1%). Split 50/50. Combined: 3.0% total. Surrounding Lackawanna County municipalities: ~1%–2% local." },
      { name: "Harrisburg / Dauphin County Area Local RTT", altGroup: "PA-local", altLabel: "Harrisburg / Dauphin", rate: 0.02, rateMin: 0, rateMax: 0.02,
        base: "price", party: "split",
        notes: "City of Harrisburg: 2.0% local. Split 50/50. Combined: 3.0% total. Surrounding Dauphin County: ~1%–2%." },
      { name: "Allentown / Lehigh Valley Area Local RTT", altGroup: "PA-local", altLabel: "Allentown / Lehigh Valley", rate: 0.02, rateMin: 0, rateMax: 0.02,
        base: "price", party: "split",
        notes: "City of Allentown, Bethlehem: ~2.0% local. Split 50/50. Combined: ~3.0% total. Lehigh/Northampton County suburbs: typically 1%–2% local." },
      { name: "Suburban PA / Standard Municipalities", altGroup: "PA-local", altLabel: "Suburban / Standard", altDefault: true, rate: 0.01, rateMin: 0.005, rateMax: 0.015,
        base: "price", party: "split",
        notes: "Most PA suburban boroughs and townships outside major cities: 1.0% local (municipality 0.5% + school district 0.5%). Split 50/50. Combined with state: 2.0% total. Some localities range 0.5%–1.5% local depending on municipality and school district. ALWAYS verify specific municipality + school district for the property." },
    ],
    recordingFeesFlat: 100,
    notes: "PA RTT = state (1.0%) + local (municipality + school district, varies). ALL splits 50/50 by statute. Philadelphia: 4.278% combined. Pittsburgh city: 3.0%. Most suburbs: 2.0%. NO mortgage recording tax. Title premium buyer-paid, all-inclusive.",
  },

  VA: {
    state: "VA", stateName: "Virginia", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_NE_COMPETITIVE,
    transferTaxes: [
      { name: "No local transfer tax (default)", rate: 0, base: "price", party: "seller", altGroup: "VA-region", altLabel: "Rest of Virginia", altDefault: true, notes: "Regional congestion grantor tax applies ONLY in the Northern Virginia & Hampton Roads districts; elsewhere none." },
      { name: "State Grantor Tax", rate: 0.001, base: "price", party: "seller",
        notes: "$1 per $1,000 = 0.1%. Seller (grantor) pays. Statewide." },
      { name: "State Recordation Tax (Grantee/Buyer)", rate: 0.0025, base: "price", party: "buyer",
        notes: "$2.50 per $1,000 = 0.25%. Buyer pays. Statewide." },
      { name: "Local 1/3 Recordation Tax (Buyer)", rate: 0.000833, base: "price", party: "buyer",
        notes: "Each Virginia locality also charges 1/3 of the state grantee recordation tax = ~$0.83/$1K = 0.083%. Buyer pays. Combined buyer recordation: 0.25% + 0.083% = ~0.333%." },
      { name: "Northern Virginia / Hampton Roads Regional Grantor Tax", altGroup: "VA-region", altLabel: "NoVA / Hampton Roads",
        rate: 0.0015, rateMin: 0, rateMax: 0.0015, base: "price", party: "seller",
        notes: "ONLY in these jurisdictions: Fairfax County, Arlington County, Loudoun County, Prince William County, City of Alexandria, City of Falls Church, City of Manassas, City of Manassas Park (NoVA); and Cities of Norfolk, Virginia Beach, Portsmouth, Chesapeake, Hampton, Newport News (Hampton Roads). Additional $1.50/$1K = 0.15% grantor tax for WMATA / regional transportation. Seller pays. NoVA seller total grantor tax: 0.10% state + 0.15% regional = 0.25%. If outside NoVA/Hampton Roads: 0.10% only." },
    ],
    mortgageRecordingTax: { name: "Recordation Tax on Deed of Trust", rate: 0.0025, base: "loan", party: "buyer",
      notes: "$2.50 per $1,000 = 0.25% state + local 1/3 = ~$0.83/$1K. Total ~$3.33/$1K = ~0.333% of loan. Buyer pays. NoVA localities may have nominal additional recording fees." },
    recordingFeesFlat: 100,
    notes: "VA structure: seller pays grantor tax (0.10% statewide; 0.25% in NoVA/Hampton Roads). Buyer pays grantee recordation (~0.333%) + deed of trust recordation (~0.333%). No county-level additions beyond the regional grantor tax in NoVA/Hampton Roads.",
  },

  WV: {
    state: "WV", stateName: "West Virginia", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_SE_COMPETITIVE,
    transferTaxes: [
      { name: "State Excise Tax on Deeds", rate: 0.0022, base: "price", party: "seller",
        notes: "$1.10 per $500 = 0.22%. Seller pays. Statewide base." },
      { name: "County Additional Excise Tax", rate: 0.0022, rateMin: 0, rateMax: 0.0033,
        base: "price", party: "seller",
        notes: "Counties may levy up to $1.65/$500 = 0.33% additional (for a total up to $2.75/$500 = 0.55%). Most counties levy an amount equal to the state: 0.22%, making typical combined total 0.44%. Some WV counties at maximum 0.55%. No city-level add-ons. Verify county." },
    ],
    recordingFeesFlat: 75,
    notes: "State + county excise tax, seller-paid. Typical combined: 0.44%. Max combined: 0.55%. No city transfer taxes in WV.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SOUTHEAST
  // ─────────────────────────────────────────────────────────────────────────

  AL: {
    state: "AL", stateName: "Alabama", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    titleSchedule: REP_TITLE_SE_COMPETITIVE,
    transferTaxes: [
      { name: "State Deed Recordation Tax", rate: 0.001, base: "price", party: "buyer",
        notes: "$0.50 per $500 = 0.10%. Buyer pays. Statewide flat rate. No county or city additions — Birmingham, Huntsville, Mobile, Montgomery: same rate." },
    ],
    mortgageRecordingTax: { name: "Mortgage Recordation Tax", rate: 0.0015, base: "loan", party: "buyer",
      notes: "$0.15 per $100 = 0.15% of loan. Buyer pays. Statewide; no county or city add-ons." },
    recordingFeesFlat: 50,
    notes: "Statewide uniform rates; no county or city variations. Owner's policy customarily seller-paid in Jefferson/Shelby counties but negotiable elsewhere.",
  },

  AR: {
    state: "AR", stateName: "Arkansas", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_SE_COMPETITIVE,
    transferTaxes: [
      { name: "Real Property Transfer Tax", rate: 0.0033, base: "price", party: "buyer",
        notes: "$3.30 per $1,000 = 0.33%. Buyer pays. Statewide uniform rate. No county or city add-ons — Little Rock, Fort Smith, Fayetteville: same rate." },
    ],
    recordingFeesFlat: 50,
    notes: "State-only transfer tax; no county or city variations. Title insurance buyer-paid.",
  },

  FL: {
    state: "FL", stateName: "Florida", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.00575, titleInsuranceParty: "seller",
    titleSchedule: {
      source: "Florida Admin. Code R. 69O-186.003 — state-promulgated original owner's title premium (current as of 2025)",
      promulgated: true,
      minPremium: 100,
      brackets: [
        { over: 0,         base: 0,     per1000: 5.75 },
        { over: 100000,    base: 575,   per1000: 5.00 },
        { over: 1000000,   base: 5075,  per1000: 2.50 },
        { over: 5000000,   base: 15075, per1000: 2.25 },
        { over: 10000000,  base: 26325, per1000: 2.00 },
      ],
    },
    transferTaxes: [
      { name: "Documentary Stamp Tax on Deed — All Counties Except Miami-Dade",
        rate: 0.007, base: "price", party: "seller",
        notes: "$0.70 per $100 = 0.70%. Seller pays. Applies in Broward, Palm Beach, Orange (Orlando), Hillsborough (Tampa), Pinellas (St. Pete), Duval (Jacksonville), Lee (Fort Myers), Collier (Naples), Sarasota, and all other FL counties except Miami-Dade." },
      { name: "Documentary Stamp Tax on Deed — Miami-Dade County Only",
        rate: 0.0105, rateMin: 0, rateMax: 0.0105, base: "price", party: "seller",
        notes: "Miami-Dade ONLY: standard $0.70/$100 state doc stamps + $0.45/$100 Miami-Dade county surtax = $1.05/$100 = 1.05% total. Seller pays. 50% higher than rest of Florida. Always confirm property is in Miami-Dade (not Broward or Monroe which use standard 0.70%)." },
      { name: "Documentary Stamp Tax on Promissory Note / Mortgage",
        rate: 0.0035, base: "loan", party: "buyer",
        notes: "$0.35 per $100 = 0.35% of loan. Buyer pays. Applies statewide including Miami-Dade — no county variations on the note tax." },
      { name: "Intangible Tax on New Mortgage", rate: 0.002, base: "loan", party: "buyer",
        notes: "0.20% of loan. Buyer pays. Statewide; no county or city variations." },
    ],
    recordingFeesFlat: 100,
    notes: "Florida uses promulgated title insurance rates (seller-paid). Critical: Miami-Dade deed stamps (1.05%) are 50% higher than all other FL counties (0.70%). Broward (Fort Lauderdale) and Monroe (Florida Keys) use standard 0.70% — do not confuse with Miami-Dade. Doc stamps on note + intangible tax on mortgage apply statewide regardless of county.",
  },

  GA: {
    state: "GA", stateName: "Georgia", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0055, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_SE_COMPETITIVE,
    transferTaxes: [
      { name: "Real Estate Transfer Tax", rate: 0.001, base: "price", party: "seller",
        notes: "$1 per $1,000 = 0.10%. Seller pays. Statewide uniform rate. No county or city add-ons — Atlanta/Fulton, Gwinnett, Cobb, DeKalb, Chatham (Savannah): all same rate." },
    ],
    mortgageRecordingTax: { name: "Intangible Recording Tax", rate: 0.003, base: "loan", party: "buyer",
      notes: "$1.50 per $500 = 0.30% of loan, capped at $25,000 per loan instrument. Buyer pays. Statewide; no county or city add-ons. The $25K cap makes this particularly significant for smaller loans relative to value." },
    recordingFeesFlat: 50,
    notes: "Georgia has no county or city transfer taxes. The intangible recording tax on the loan (0.30%, capped $25K) is the primary buyer closing cost. Title insurance buyer-paid.",
  },

  KY: {
    state: "KY", stateName: "Kentucky", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_SE_COMPETITIVE,
    transferTaxes: [
      { name: "State Transfer Tax", rate: 0.001, base: "price", party: "buyer",
        notes: "$0.50 per $500 = 0.10%. Buyer pays. Statewide uniform rate. No county or city add-ons — Louisville, Lexington, Bowling Green, Covington: all same rate." },
    ],
    recordingFeesFlat: 50,
    notes: "Very low transfer tax state. No county or city additions. No mortgage recording tax. Title insurance buyer-paid.",
  },

  MS: {
    state: "MS", stateName: "Mississippi", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "seller",
    titleSchedule: REP_TITLE_SE_COMPETITIVE,
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Mississippi has NO deed transfer tax at any level — state, county, or city. Jackson, Gulfport, Biloxi: no transfer taxes. Owner's policy customarily seller-paid. One of the lowest-cost closing states.",
  },

  NC: {
    state: "NC", stateName: "North Carolina", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_NC,
    transferTaxes: [
      { name: "No local transfer tax (default)", rate: 0, base: "price", party: "seller", altGroup: "NC-county", altLabel: "Other NC (no local)", altDefault: true, notes: "Only a few NC counties levy a local land transfer tax; most (incl. Wake/Charlotte-metro outside Mecklenburg) have none." },
      { name: "State Excise Tax on Conveyances", rate: 0.002, base: "price", party: "seller",
        notes: "$1 per $500 = 0.20%. Seller pays. Statewide; applies to all NC counties as base." },
      { name: "Orange County Local Land Transfer Tax", altGroup: "NC-county", altLabel: "Orange County", rate: 0.004, rateMin: 0, rateMax: 0.004,
        base: "price", party: "buyer",
        notes: "Orange County (Chapel Hill, Carrboro, Hillsborough) ONLY: 0.4% Local Land Transfer Tax adopted by voter referendum. Buyer pays. Combined with state: 0.60% total (0.20% seller + 0.40% buyer)." },
      { name: "Chatham County Local Land Transfer Tax", altGroup: "NC-county", altLabel: "Chatham County", rate: 0.004, rateMin: 0, rateMax: 0.004,
        base: "price", party: "buyer",
        notes: "Chatham County (Pittsboro, Siler City, southern Triangle area) ONLY: 0.4% LTT. Buyer pays. Combined: 0.60% total." },
      { name: "Mecklenburg County Local Land Transfer Tax", altGroup: "NC-county", altLabel: "Mecklenburg County", rate: 0.004, rateMin: 0, rateMax: 0.004,
        base: "price", party: "buyer",
        notes: "Mecklenburg County (Charlotte, Charlotte suburbs) ONLY: 0.4% LTT adopted by voter referendum. Buyer pays. Combined in Charlotte area: 0.60% total. Verify current status — some LTT referendums have been contested." },
    ],
    recordingFeesFlat: 75,
    notes: "Most NC counties: 0.20% seller only. Charlotte (Mecklenburg), Chapel Hill (Orange), and Chatham County: add 0.40% buyer LTT. All other 97 NC counties have NO local LTT. Always check the county.",
  },

  SC: {
    state: "SC", stateName: "South Carolina", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_SE_COMPETITIVE,
    transferTaxes: [
      { name: "Deed Recording Fee", rate: 0.0037, base: "price", party: "seller",
        notes: "$1.85 per $500 = 0.37%. Seller pays. Uniform statewide — no county or city add-ons in SC. Charleston, Columbia, Greenville, Myrtle Beach: all same rate." },
    ],
    recordingFeesFlat: 50,
    notes: "Statewide flat deed recording fee; no county or city transfer taxes. Title insurance buyer-paid. One of the simpler/lower-cost closing states.",
  },

  TN: {
    state: "TN", stateName: "Tennessee", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_SE_COMPETITIVE,
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Tennessee has NO deed/transfer tax at state, county, or city level. Nashville, Memphis, Knoxville, Chattanooga: no transfer taxes. One of the lowest-cost closing states. Title insurance buyer-paid.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SOUTH-CENTRAL
  // ─────────────────────────────────────────────────────────────────────────

  LA: {
    state: "LA", stateName: "Louisiana", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "split",
    titleSchedule: REP_TITLE_SE_COMPETITIVE,
    transferTaxes: [],
    mortgageRecordingTax: { name: "Documentary Tax on Mortgage / Note", rate: 0.0035, base: "loan", party: "buyer",
      notes: "~$0.35/$100 = 0.35% of loan. Buyer pays. Applies to the note/mortgage instrument. Statewide; no parish (county) or city add-ons. No deed transfer tax in Louisiana (civil-law Act of Sale system)." },
    recordingFeesFlat: 75,
    notes: "Louisiana uses Civil Code Act of Sale; no deed transfer tax at any level. New Orleans, Baton Rouge, Shreveport: no transfer taxes. Parish recording fees vary; $75 is typical for commercial. Title insurance less common (closings handled by notaries); premium split when obtained. Verify with a Louisiana notary.",
  },

  OK: {
    state: "OK", stateName: "Oklahoma", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "seller",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [
      { name: "Deed Stamps (Documentary Stamps)", rate: 0.003, base: "price", party: "seller",
        notes: "$1.50 per $500 = 0.30%. Seller pays. Uniform statewide — no county or city add-ons. Oklahoma City and Tulsa have no municipal transfer taxes." },
    ],
    recordingFeesFlat: 50,
    notes: "State-only deed stamps (0.30%), seller-paid. No county or city variations. Owner's policy customarily seller-paid.",
  },

  TX: {
    state: "TX", stateName: "Texas", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0055, titleInsuranceParty: "seller",
    titleSchedule: {
      source: "Texas Dept. of Insurance — promulgated Basic Premium Rate schedule, Commissioner Order 2025-9697, eff. 2026-03-01 (after −6.2% rate reduction)",
      promulgated: true,
      minPremium: 328,
      brackets: [
        { over: 0,         base: 0,      per1000: 7.80 },  // up-to-$100K table approximated linearly to $780 @ $100K
        { over: 100000,    base: 780,    per1000: 4.94 },
        { over: 1000000,   base: 5226,   per1000: 4.06 },
        { over: 5000000,   base: 21466,  per1000: 3.35 },
        { over: 15000000,  base: 54966,  per1000: 2.38 },  // schedule published through $25M; rate declines further above $25M
      ],
    },
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Texas has NO deed transfer tax at state, county, or city level. Houston, Dallas, Austin, San Antonio, Fort Worth: no transfer taxes. Promulgated title rates; owner's policy seller-paid by custom. Title company handles escrow.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // MIDWEST
  // ─────────────────────────────────────────────────────────────────────────

  IA: {
    state: "IA", stateName: "Iowa", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    titleSchedule: REP_TITLE_IA,
    transferTaxes: [
      { name: "Real Estate Transfer Tax", rate: 0.0016, base: "price", party: "seller",
        notes: "$1.60 per $1,000 = 0.16%. Seller pays. Uniform statewide — Des Moines, Cedar Rapids, Davenport: no county or city add-ons." },
    ],
    recordingFeesFlat: 50,
    notes: "State-only; no county or city variations. Title premium typically split.",
  },

  IL: {
    state: "IL", stateName: "Illinois", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "seller",
    titleSchedule: REP_TITLE_MW_COMPETITIVE,
    transferTaxes: [
      { name: "No local transfer tax (default)", rate: 0, base: "price", party: "seller", altGroup: "IL-local", altLabel: "Other IL (state only)", altDefault: true, notes: "Most IL outside Chicago/Cook and the named municipalities: state transfer tax only." },
      { name: "State Real Estate Transfer Tax", rate: 0.001, base: "price", party: "seller",
        notes: "$0.50 per $500 = 0.10%. Seller pays. Applies statewide." },
      { name: "Cook County Transfer Tax", altGroup: "IL-local", altLabel: "Chicago (incl. Cook County)", rate: 0.0005, base: "price", party: "seller",
        notes: "$0.25 per $500 = 0.05%. Cook County ONLY (Chicago and all Cook County suburbs). Seller pays." },
      { name: "City of Chicago RPTT — Buyer Portion", altGroup: "IL-local", altLabel: "Chicago (incl. Cook County)", rate: 0.0075, base: "price", party: "buyer",
        notes: "City of Chicago ONLY: $3.75 per $500 = 0.75%. BUYER pays. Does NOT apply in any suburb, even those within Cook County. Verify property address is in Chicago city limits. Chicago combined: state 0.10% + Cook 0.05% + city 1.05% (0.75% buyer + 0.30% seller) = 1.20% total." },
      { name: "City of Chicago RPTT — Seller Portion", altGroup: "IL-local", altLabel: "Chicago (incl. Cook County)", rate: 0.003, base: "price", party: "seller",
        notes: "City of Chicago ONLY: $1.50 per $500 = 0.30%. Seller pays. Combined Chicago city RPTT: 1.05% (0.75% buyer + 0.30% seller)." },
      { name: "Evanston Municipal Transfer Tax", altGroup: "IL-local", altLabel: "Evanston", rate: 0.005, rateMin: 0, rateMax: 0.005,
        base: "price", party: "seller",
        notes: "City of Evanston ONLY: 0.5% city transfer tax. Seller pays. Combined Evanston: state 0.10% + Cook 0.05% + Evanston 0.50% = 0.65%." },
      { name: "Oak Park Municipal Transfer Tax", altGroup: "IL-local", altLabel: "Oak Park", rate: 0.001, rateMin: 0, rateMax: 0.001,
        base: "price", party: "seller",
        notes: "Village of Oak Park ONLY: 0.1% municipal transfer tax. Combined: 0.25%." },
    ],
    recordingFeesFlat: 100,
    notes: "ALWAYS verify city/municipality. Chicago: 1.20% combined (buyer 0.80%, seller 0.40%). Evanston: 0.65%. Oak Park: 0.25%. Suburban Cook County without municipal tax (Schaumburg, Naperville, etc.): 0.15% seller only. Downstate IL outside Cook County: 0.10% seller only. Title premium seller-paid. No IL mortgage recording tax.",
  },

  IN: {
    state: "IN", stateName: "Indiana", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "seller",
    titleSchedule: REP_TITLE_MW_COMPETITIVE,
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Indiana has NO deed transfer tax, NO county transfer tax, and NO mortgage recording tax. Indianapolis, Fort Wayne, Evansville, South Bend: no transfer taxes. Owner's policy customarily seller-paid.",
  },

  KS: {
    state: "KS", stateName: "Kansas", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_MW_COMPETITIVE,
    transferTaxes: [],
    mortgageRecordingTax: { name: "Mortgage Registration Tax", rate: 0.0026, base: "loan", party: "buyer",
      notes: "0.26% of loan. Buyer pays. Statewide; no county or city variations. Kansas City and Wichita use same rate." },
    recordingFeesFlat: 50,
    notes: "Kansas has NO deed transfer tax at any level. Mortgage registration tax (0.26%) is the main buyer closing cost. Title insurance buyer-paid.",
  },

  MI: {
    state: "MI", stateName: "Michigan", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "seller",
    titleSchedule: REP_TITLE_MW_COMPETITIVE,
    transferTaxes: [
      { name: "State Real Estate Transfer Tax", rate: 0.0015, base: "price", party: "seller",
        notes: "$0.75 per $500 = 0.15%. Seller pays. Statewide." },
      { name: "County Real Estate Transfer Tax", rate: 0.0011, base: "price", party: "seller",
        notes: "$0.55 per $500 = 0.11%. Seller pays. ALL Michigan counties levy this amount — Wayne (Detroit), Oakland, Macomb, Kent (Grand Rapids), Ingham (Lansing): uniform rate. No city-level transfer taxes in MI. Combined state + county = 0.26% everywhere." },
    ],
    recordingFeesFlat: 50,
    notes: "Michigan has a perfectly uniform transfer tax across all counties (state 0.15% + county 0.11% = 0.26% combined). No Detroit city transfer tax or any other municipal transfer tax. Seller pays both. Owner's policy customarily seller-paid.",
  },

  MN: {
    state: "MN", stateName: "Minnesota", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.004, titleInsuranceParty: "split",
    titleSchedule: REP_TITLE_MW_COMPETITIVE,
    transferTaxes: [
      { name: "State Deed Tax", rate: 0.0033, base: "price", party: "seller",
        notes: "0.33% of price. Seller pays. Statewide uniform — Minneapolis, St. Paul, Rochester, Duluth, all MN counties: no county or city add-ons." },
    ],
    mortgageRecordingTax: { name: "Mortgage Registry Tax", rate: 0.0023, base: "loan", party: "buyer",
      notes: "0.23% of loan. Buyer pays. Statewide uniform — no county or city variations." },
    recordingFeesFlat: 100,
    notes: "Minnesota has no county or city-level transfer taxes. Deed tax (0.33%) seller-paid; mortgage registry tax (0.23%) buyer-paid. Title premium split.",
  },

  MO: {
    state: "MO", stateName: "Missouri", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "seller",
    titleSchedule: REP_TITLE_MW_COMPETITIVE,
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Missouri has NO deed transfer tax, NO county transfer tax, and NO mortgage tax. Kansas City and St. Louis have no city transfer taxes. Owner's policy customarily seller-paid.",
  },

  ND: {
    state: "ND", stateName: "North Dakota", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "North Dakota has NO deed transfer tax at state, county, or city level. Fargo, Bismarck, Grand Forks: no transfer taxes. Title insurance buyer-paid.",
  },

  NE: {
    state: "NE", stateName: "Nebraska", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_MW_COMPETITIVE,
    transferTaxes: [
      { name: "Documentary Stamp Tax", rate: 0.00225, base: "price", party: "seller",
        notes: "$2.25 per $1,000 = 0.225%. Seller pays. Statewide uniform — Omaha, Lincoln: no county or city add-ons." },
    ],
    recordingFeesFlat: 50,
    notes: "State-only documentary stamp tax; no county or city variations. Title insurance buyer-paid.",
  },

  OH: {
    state: "OH", stateName: "Ohio", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    titleSchedule: {
      source: "Ohio Title Insurance Rating Bureau (OTIRB) — filed/approved owner's risk premium, effective 2026-01-01 (first increase since 2002). Statewide, same for all agencies.",
      promulgated: true,
      minPremium: 225,
      brackets: [
        { over: 0,         base: 0,     per1000: 5.80 },
        { over: 250000,    base: 1450,  per1000: 4.10 },
        { over: 500000,    base: 2475,  per1000: 3.20 },
        { over: 1000000,   base: 4075,  per1000: 3.10 },
        { over: 5000000,   base: 16475, per1000: 2.90 },
        { over: 10000000,  base: 30975, per1000: 2.60 },
      ],
    },
    transferTaxes: [
      { name: "Real Property Conveyance Fee — State", rate: 0.001, base: "price", party: "seller",
        notes: "$1 per $1,000 = 0.10%. Seller pays. Applies statewide as the base." },
      { name: "Real Property Conveyance Fee — County (at maximum levy)",
        rate: 0.003, rateMin: 0, rateMax: 0.003, base: "price", party: "seller",
        notes: "Franklin County (Columbus), Cuyahoga County (Cleveland), Hamilton County (Cincinnati), Summit County (Akron), Lucas County (Toledo), Montgomery County (Dayton), Butler County, Lorain County, Mahoning County (Youngstown), Stark County (Canton): all at maximum permissive levy of $3/$1K = 0.30%. Combined with state: 0.40% total seller-paid. Some rural/small counties: $1–$2/$1K = 0.10%–0.20% additional. No city-level transfer taxes in Ohio. Verify county." },
    ],
    recordingFeesFlat: 50,
    notes: "Ohio has no city-level transfer taxes. Most major metro counties are at maximum 0.40% combined (state + county). Rural counties: as low as 0.10%. All seller-paid. No mortgage recording tax. Title premium often split.",
  },

  SD: {
    state: "SD", stateName: "South Dakota", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [
      { name: "Transfer Fee", rate: 0.001, base: "price", party: "seller",
        notes: "$0.50 per $500 = 0.10%. Seller pays. Statewide uniform — Sioux Falls, Rapid City: no county or city add-ons." },
    ],
    recordingFeesFlat: 50,
    notes: "Low-cost state; statewide flat rate. No county or city variations. Title insurance buyer-paid.",
  },

  WI: {
    state: "WI", stateName: "Wisconsin", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_MW_COMPETITIVE,
    transferTaxes: [
      { name: "Real Estate Transfer Return Fee", rate: 0.003, base: "price", party: "seller",
        notes: "$0.30 per $100 = 0.30%. Seller pays. Filed on WI form PE-500. Statewide uniform — Milwaukee, Madison, Green Bay, Racine: no county or city add-ons. Perfectly uniform across all 72 WI counties." },
    ],
    recordingFeesFlat: 50,
    notes: "Uniform 0.30% statewide; absolutely no county or city variations in Wisconsin. Title insurance buyer-paid.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // MOUNTAIN / WEST
  // ─────────────────────────────────────────────────────────────────────────

  AK: {
    state: "AK", stateName: "Alaska", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "split",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [],
    recordingFeesFlat: 75,
    notes: "Alaska has NO statewide deed transfer tax. Anchorage, Fairbanks, Juneau: no city transfer taxes. A few small municipalities may have local transfer taxes — verify for the specific borough/city. Title premium typically split.",
  },

  AZ: {
    state: "AZ", stateName: "Arizona", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [],
    recordingFeesFlat: 30,
    notes: "Arizona has NO deed transfer tax at state, county, or city level. Phoenix, Scottsdale, Tucson, Tempe, Chandler, Mesa, Glendale: absolutely no transfer taxes. Among the lowest closing-cost states. Title premium typically split.",
  },

  CA: {
    state: "CA", stateName: "California", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [
      { name: "County Documentary Transfer Tax (base — all CA counties)",
        rate: 0.0011, base: "price", party: "seller",
        notes: "$1.10 per $1,000 = 0.11%. Seller pays. Base county DTT applied statewide per California Revenue & Taxation Code §11911. For incorporated cities: county keeps $0.55/$1K (0.055%) and city keeps $0.55/$1K (0.055%) minimum — unless city imposes its own higher rate." },
      { name: "City of Los Angeles — Base City DTT", altGroup: "CA-city", altLabel: "Los Angeles (incl. ULA)",
        rate: 0.0045, base: "price", party: "seller",
        notes: "City of LA ONLY: $4.50/$1K = 0.45% city DTT. Seller pays. Combined with county: 0.56% for standard LA transactions <$5M." },
      { name: "Los Angeles Measure ULA — $5M to $10M Tier", altGroup: "CA-city", altLabel: "Los Angeles (incl. ULA)",
        rate: 0.04, rateMin: 0, rateMax: 0.04, base: "price", party: "seller",
        tiers: [{ over: 5000000, rate: 0.04 }],
        notes: "City of Los Angeles ONLY (effective April 1, 2023). Properties sold $5M–$10M: additional 4.0% seller tax applied to ENTIRE price. Combined with base 0.56%: 4.56% total on full sale price. Applies to commercial, multifamily, and residential. ONLY within City of LA limits — not Beverly Hills, Culver City, Santa Monica, West Hollywood, etc." },
      { name: "Los Angeles Measure ULA — Over $10M Tier", altGroup: "CA-city", altLabel: "Los Angeles (incl. ULA)",
        rate: 0.055, rateMin: 0, rateMax: 0.055, base: "price", party: "seller",
        tiers: [{ over: 10000000, rate: 0.055 }],
        notes: "City of Los Angeles ONLY. Properties sold >$10M: additional 5.5% seller tax on ENTIRE price. Combined with base 0.56%: 6.06% total. A $20M LA deal: ~$1.21M in transfer taxes alone. This is one of the highest city transfer tax burdens nationally." },
      { name: "San Francisco — City/County DTT (tiered)", altGroup: "CA-city", altLabel: "San Francisco",
        rate: 0.03, rateMin: 0.005, rateMax: 0.03, base: "price", party: "seller",
        tiers: [
          { over: 0,        rate: 0.005  },
          { over: 250000,   rate: 0.0068 },
          { over: 1000000,  rate: 0.0075 },
          { over: 5000000,  rate: 0.01   },
          { over: 10000000, rate: 0.015  },
          { over: 25000000, rate: 0.03   },
        ],
        notes: "San Francisco consolidated city-county ONLY. Tiered: 0.50% (≤$250K); 0.68% ($250K–$1M); 0.75% ($1M–$5M); 1.0% ($5M–$10M); 1.5% ($10M–$25M); 3.0% (>$25M). No separate county DTT (SF is its own county). Seller pays. A $30M SF deal: $900K in transfer taxes." },
      { name: "Oakland — City DTT (Alameda County)", altGroup: "CA-city", altLabel: "Oakland",
        rate: 0.0175, rateMin: 0.01, rateMax: 0.0175, base: "price", party: "seller",
        tiers: [
          { over: 0,       rate: 0.01   },
          { over: 300000,  rate: 0.015  },
          { over: 2000000, rate: 0.0175 },
        ],
        notes: "City of Oakland ONLY. Tiered: 1.0% (≤$300K); 1.5% ($300K–$2M); 1.75% (>$2M). Plus Alameda County base 0.055%. Combined Oakland total: ~1.055%–1.805%. Seller pays." },
      { name: "Berkeley — City DTT (Alameda County)", altGroup: "CA-city", altLabel: "Berkeley",
        rate: 0.015, base: "price", party: "seller",
        notes: "City of Berkeley ONLY: $15/$1K = 1.5% city DTT. Plus Alameda County 0.055%. Combined: ~1.555%. Seller pays." },
      { name: "Santa Monica — City DTT (LA County)", altGroup: "CA-city", altLabel: "Santa Monica",
        rate: 0.003, base: "price", party: "seller",
        notes: "City of Santa Monica ONLY: $3/$1K = 0.30% city. Plus LA County 0.055%. Combined: ~0.355%. Seller pays." },
      { name: "Culver City — City DTT (LA County)", altGroup: "CA-city", altLabel: "Culver City",
        rate: 0.0045, base: "price", party: "seller",
        notes: "City of Culver City ONLY: $4.50/$1K = 0.45% city. Plus LA County 0.055%. Combined: ~0.505%. Seller pays." },
      { name: "West Hollywood — City DTT (LA County)", altGroup: "CA-city", altLabel: "West Hollywood",
        rate: 0.0055, base: "price", party: "seller",
        notes: "City of West Hollywood ONLY: $5.50/$1K = 0.55% city. Plus LA County 0.055%. Combined: ~0.605%. Seller pays." },
      { name: "San Jose — City DTT (Santa Clara County)", altGroup: "CA-city", altLabel: "San Jose",
        rate: 0.0033, base: "price", party: "seller",
        notes: "City of San Jose ONLY: $3.30/$1K = 0.33% city. Plus Santa Clara County 0.055%. Combined: ~0.385%. Seller pays." },
      { name: "Palo Alto — City DTT (Santa Clara County)", altGroup: "CA-city", altLabel: "Palo Alto",
        rate: 0.0033, base: "price", party: "seller",
        notes: "City of Palo Alto ONLY: $3.30/$1K = 0.33% city. Plus Santa Clara County 0.055%. Combined: ~0.385%. Seller pays." },
      { name: "Mountain View — City DTT (Santa Clara County)", altGroup: "CA-city", altLabel: "Mountain View",
        rate: 0.0033, base: "price", party: "seller",
        notes: "City of Mountain View ONLY: $3.30/$1K = 0.33% city. Plus Santa Clara County 0.055%. Combined: ~0.385%. Seller pays." },
      { name: "Richmond — City DTT (Contra Costa County)", altGroup: "CA-city", altLabel: "Richmond",
        rate: 0.007, base: "price", party: "seller",
        notes: "City of Richmond ONLY: $7.00/$1K = 0.70% city. Plus Contra Costa County 0.055%. Combined: ~0.755%. Seller pays." },
      { name: "Stockton — City DTT (San Joaquin County)", altGroup: "CA-city", altLabel: "Stockton",
        rate: 0.00275, base: "price", party: "seller",
        notes: "City of Stockton ONLY: $2.75/$1K = 0.275% city. Plus San Joaquin County 0.055%. Combined: ~0.33%. Seller pays." },
      { name: "All Other CA Cities — County Base Only", altGroup: "CA-city", altLabel: "Other CA (county base only)", altDefault: true,
        rate: 0, base: "price", party: "seller",
        notes: "No city-specific DTT (San Diego, Sacramento, Fresno, Anaheim, Long Beach, Irvine, most CA cities). Only the county base rate above applies — no city add-on. Seller pays." },
    ],
    recordingFeesFlat: 125,
    notes: "CRITICAL: California transfer taxes vary enormously by city. City of LA: 0.56% standard; 4.56%–6.06% for deals over $5M (Measure ULA). SF: 0.50%–3.0% tiered. Oakland: 1.0%–1.75%. Most other cities outside this list: 0.11% county only. Beverly Hills, San Diego, Sacramento, Fresno: county base only (0.11%). ALWAYS confirm exact city limits — adjacent cities can differ by 5%+ on a large deal. All seller-paid.",
  },

  CO: {
    state: "CO", stateName: "Colorado", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "seller",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [
      { name: "No local transfer tax (default)", rate: 0, base: "price", party: "seller", altGroup: "CO-resort", altLabel: "Other CO (no resort RETT)", altDefault: true, notes: "Resort-town RETT applies ONLY in a handful of mountain towns; the rest of CO (Denver metro, etc.) has only the state documentary fee." },
      { name: "State Documentary Fee", rate: 0.0001, base: "price", party: "buyer",
        notes: "$0.01 per $100 = 0.01%. Nominal statewide filing fee. Buyer pays. Denver, Boulder, Colorado Springs, Aurora: no additional municipal transfer taxes." },
      { name: "Mountain Resort Town RETT — Aspen / Vail / Keystone / Breckenridge tier", altGroup: "CO-resort", altLabel: "Aspen / Vail / Breck",
        rate: 0.015, rateMin: 0.01, rateMax: 0.015, base: "price", party: "buyer",
        notes: "MOUNTAIN RESORT MUNICIPALITIES ONLY. Aspen: 1.5%. Breckenridge: 1.0%. Vail: 1.5%. Snowmass Village: 1.0%. Frisco: 1.0%. Dillon: 1.0%. Avon: 2.0%. Keystone Resort area: 1.5%. Buyer pays. These are home-rule Real Estate Transfer Taxes for affordable housing funds. Applies only if property is within the specific town limits." },
      { name: "Mountain Resort Town RETT — Telluride / Crested Butte tier", altGroup: "CO-resort", altLabel: "Telluride / Crested Butte",
        rate: 0.03, rateMin: 0.03, rateMax: 0.03, base: "price", party: "buyer",
        notes: "Telluride: 3.0% RETT. Crested Butte: 3.0% RETT. Buyer pays. Highest Colorado transfer taxes — a $5M Telluride property: $150K in transfer taxes. These also only apply within the specific town limits." },
    ],
    recordingFeesFlat: 50,
    notes: "Denver, Colorado Springs, Aurora, Fort Collins, Boulder city proper, Pueblo: effectively NO transfer taxes (only $0.01/$100 state filing fee). Mountain resort towns: 1.0%–3.0% buyer-paid RETT. Always check if the property is within a resort town's municipal limits. Owner's policy seller-paid by custom.",
  },

  HI: {
    state: "HI", stateName: "Hawaii", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [
      { name: "State Conveyance Tax — Commercial/Non-Residential", rate: 0.0085, rateMin: 0.001, rateMax: 0.0085,
        base: "price", party: "seller",
        tiers: [
          { over: 0,       rate: 0.001  },
          { over: 600000,  rate: 0.002  },
          { over: 1000000, rate: 0.003  },
          { over: 2000000, rate: 0.005  },
          { over: 4000000, rate: 0.0085 },
        ],
        notes: "Per HI Revised Statutes §247. Tiered: 0.1% (≤$600K); 0.2% ($600K–$1M); 0.3% ($1M–$2M); 0.5% ($2M–$4M); 0.85% (>$4M) for commercial/non-residential. Seller pays. All four HI counties (Honolulu, Maui, Hawaii County, Kauai) use SAME state rate — no county or city add-ons." },
    ],
    recordingFeesFlat: 100,
    notes: "Uniform statewide rate across all Hawaiian islands. Honolulu, Maui, Kona, Kauai: same rate, no local add-ons. Commercial deals over $4M: 0.85%. Title insurance buyer-paid.",
  },

  ID: {
    state: "ID", stateName: "Idaho", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Idaho has NO deed transfer tax at state, county, or city level. Boise, Nampa, Meridian, Twin Falls, Idaho Falls: no transfer taxes. Title premium typically split.",
  },

  MT: {
    state: "MT", stateName: "Montana", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Montana has NO deed transfer tax at state, county, or city level. Billings, Missoula, Great Falls, Bozeman: no transfer taxes. Title premium typically split.",
  },

  NM: {
    state: "NM", stateName: "New Mexico", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    titleSchedule: REP_TITLE_NM,
    transferTaxes: [
      { name: "Deed Recording Fee", rate: 0.0033, base: "price", party: "seller",
        notes: "$1.65 per $500 = 0.33%. Seller pays. Statewide uniform — Albuquerque, Santa Fe, Las Cruces: no county or city add-ons." },
    ],
    recordingFeesFlat: 50,
    notes: "State-only deed recording fee. No county or city transfer taxes. Title insurance buyer-paid.",
  },

  NV: {
    state: "NV", stateName: "Nevada", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "split",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [
      { name: "No local transfer tax (default)", rate: 0, base: "price", party: "seller", altGroup: "NV-county", altLabel: "Other NV counties", altDefault: true, notes: "Counties other than Clark (Las Vegas) and Washoe (Reno): state base RPTT only, no county add-on." },
      { name: "State Real Property Transfer Tax", rate: 0.0013, base: "price", party: "seller",
        notes: "$0.65 per $500 = 0.13%. Seller pays. Statewide base." },
      { name: "Clark County (Las Vegas) Additional Transfer Tax", altGroup: "NV-county", altLabel: "Clark County (Las Vegas)",
        rate: 0.0013, rateMin: 0, rateMax: 0.0013, base: "price", party: "seller",
        notes: "Clark County (Las Vegas, Henderson, North Las Vegas, Boulder City) ONLY: additional $0.65/$500 = 0.13%. Combined Clark total: 0.26%. No Las Vegas city-level transfer tax." },
      { name: "Washoe County (Reno) Additional Transfer Tax", altGroup: "NV-county", altLabel: "Washoe County (Reno)",
        rate: 0.0013, rateMin: 0, rateMax: 0.0013, base: "price", party: "seller",
        notes: "Washoe County (Reno, Sparks) ONLY: additional $0.65/$500 = 0.13%. Combined Washoe total: 0.26%." },
    ],
    recordingFeesFlat: 75,
    notes: "Nevada: state 0.13% + county up to 0.13% = 0.26% max combined. Las Vegas (Clark) and Reno (Washoe): both at max 0.26%. Rural NV counties: may be only state 0.13%. No city-level transfer taxes in NV. Title premium typically split.",
  },

  OR: {
    state: "OR", stateName: "Oregon", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "split",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [
      { name: "Washington County (Portland West Side) Local Transfer Tax",
        rate: 0.001, rateMin: 0, rateMax: 0.001, base: "price", party: "seller",
        notes: "Washington County ONLY (Hillsboro, Beaverton, Tigard, Tualatin, Cornelius, Forest Grove): $1/$1K = 0.10% county transfer tax. Seller pays. This is the ONLY county-level transfer tax in Oregon — all other counties and the City of Portland have none." },
    ],
    recordingFeesFlat: 100,
    notes: "Oregon has a near-total ban on transfer taxes (ORS 306.815). Washington County (Portland west metro) is the one exception at 0.10%. Portland proper (Multnomah County), Salem (Marion County), Eugene (Lane County), Bend (Deschutes County), Medford (Jackson County): zero transfer taxes. Title premium typically split.",
  },

  UT: {
    state: "UT", stateName: "Utah", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Utah has NO deed transfer tax at state, county, or city level. Salt Lake City, Provo, Ogden, St. George: no transfer taxes. Title premium typically split.",
  },

  WA: {
    state: "WA", stateName: "Washington", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [
      { name: "State REET — Graduated (commercial)", rate: 0.03, rateMin: 0.011, rateMax: 0.03,
        base: "price", party: "seller",
        marginalTiers: [
          { over: 0,       rate: 0.011  },
          { over: 525000,  rate: 0.0128 },
          { over: 1525000, rate: 0.0275 },
          { over: 3025000, rate: 0.03   },
        ],
        notes: "State REET per RCW 82.45 is GRADUATED — each rate applies only to the portion in that band: 1.1% (≤$525K); 1.28% ($525K–$1.525M); 2.75% ($1.525M–$3.025M); 3.0% (>$3.025M). Seller pays. (Thresholds are the 2025 figures.)" },
      { name: "Local REET — King County (Seattle metro)", altGroup: "WA-county", altLabel: "King County (Seattle)",
        rate: 0.005, rateMin: 0, rateMax: 0.005, base: "price", party: "seller",
        notes: "King County (Seattle, Bellevue, Kirkland, Redmond, etc.) ONLY: 0.5% additional local REET per RCW 82.46.035. Seller pays. Combined King County total: 1.6% (small deals) up to 3.5% (deals >$3M)." },
      { name: "Local REET — Pierce, Snohomish, Spokane Counties", altGroup: "WA-county", altLabel: "Pierce / Snohomish / Spokane",
        rate: 0.005, rateMin: 0, rateMax: 0.005, base: "price", party: "seller",
        notes: "Pierce County (Tacoma), Snohomish County (Everett), Spokane County: typically 0.5% additional local REET. Seller pays." },
      { name: "Local REET — Most Other WA Counties", altGroup: "WA-county", altLabel: "Most Other WA Counties", altDefault: true,
        rate: 0.0025, rateMin: 0, rateMax: 0.005, base: "price", party: "seller",
        notes: "Most other WA counties levy 0.25%–0.5% local REET. Verify specific county. Seller pays." },
    ],
    recordingFeesFlat: 200,
    notes: "Washington's REET is tiered and seller-paid. For $5M+ commercial deals: state REET alone is 3.0% — plus local REET 0.25%–0.5% = 3.25%–3.5% total. King County (Seattle) at maximum local: 3.5% combined on large deals. Always identify county for accurate local REET.",
  },

  WY: {
    state: "WY", stateName: "Wyoming", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    titleSchedule: REP_TITLE_WEST_COMPETITIVE,
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Wyoming has NO deed transfer tax at state, county, or city level. Cheyenne, Casper, Jackson Hole: no transfer taxes. Title premium typically split.",
  },

};
export const DEFAULT_JURISDICTION: JurisdictionRates = {
  state: "—", stateName: "Other / Not Configured", ratesAsOf: "—",
  titleInsuranceRate: 0.005, titleInsuranceParty: "split",
  transferTaxes: [
    { name: "Transfer Tax (estimated)", rate: 0.005, rateMin: 0, rateMax: 0.02, base: "price", party: "seller",
      notes: "National CRE average — this state isn't configured yet. Verify actual rates and splits via the Fidelity guide or a local title officer." },
  ],
  recordingFeesFlat: 100,
  notes: "This state is not yet configured with sourced data. Figures are national-average placeholders — do not rely on them; check the Fidelity guide.",
};

export function getJurisdiction(stateAbbr?: string | null): JurisdictionRates {
  if (!stateAbbr) return DEFAULT_JURISDICTION;
  return CLOSING_COSTS_BY_STATE[stateAbbr.toUpperCase().trim()] ?? DEFAULT_JURISDICTION;
}

/** Resolve a tiered rate (entire-price method): highest tier whose threshold the price exceeds. */
export function resolveTierRate(tiers: TaxTier[], price: number): number {
  let rate = 0;
  for (const t of tiers) if (price > t.over) rate = t.rate;
  return rate;
}

/** Resolve a MARGINAL/graduated tax: each tier's rate applies only to the portion
 *  of the base between that tier's `over` and the next tier's `over`. Returns a
 *  dollar amount. Used by genuinely-graduated taxes (WA REET, CT conveyance, NJ RTF)
 *  — as opposed to cliff taxes (resolveTierRate), which hit the entire price. */
export function resolveMarginalTax(tiers: TaxTier[], base: number): number {
  if (base <= 0) return 0;
  let tax = 0;
  for (let i = 0; i < tiers.length; i++) {
    const lo = tiers[i].over;
    const hi = i + 1 < tiers.length ? tiers[i + 1].over : Infinity;
    if (base > lo) tax += (Math.min(base, hi) - lo) * tiers[i].rate;
  }
  return tax;
}

/** Resolve a title premium (MARGINAL/incremental method): base at the highest
 *  bracket the price clears, plus per-$1,000 on the increment above it. Floored
 *  at the schedule minimum. This is the regressive schedule real title manuals use. */
export function resolveTitlePremium(schedule: TitleSchedule, price: number): number {
  if (price <= 0) return 0;
  let b = schedule.brackets[0];
  for (const br of schedule.brackets) if (price > br.over) b = br;
  const premium = b.base + ((price - b.over) / 1000) * b.per1000;
  return Math.max(premium, schedule.minPremium ?? 0);
}

/** Format a rate for display: single %, sliding/tiered range, or flat fee. */
export function formatRate(item: { rate: number; rateMin?: number; rateMax?: number; tiers?: TaxTier[]; marginalTiers?: TaxTier[]; base?: "price" | "loan" }): string {
  const pct = (r: number) => `${(r * 100).toFixed(r > 0 && r < 0.001 ? 4 : r < 0.01 ? 3 : 2).replace(/\.?0+$/, "")}%`;
  const baseLabel = item.base === "loan" ? " of loan" : item.base === "price" ? " of price" : "";
  if (item.rateMin != null && item.rateMax != null && item.rateMin !== item.rateMax) {
    const tag = item.marginalTiers ? " (graduated)" : item.tiers ? " (tiered)" : " (sliding)";
    return `${pct(item.rateMin)}-${pct(item.rateMax)}${baseLabel}${tag}`;
  }
  if (item.rate === 0) return "flat fee";
  return `${pct(item.rate)}${baseLabel}`;
}

export interface ClosingCostLine {
  name: string; rate: number; rateMin?: number; rateMax?: number; tiers?: TaxTier[]; marginalTiers?: TaxTier[];
  base: "price" | "loan"; party: Party; entitySaleOnly?: boolean;
  altGroup?: string; altLabel?: string; residentialOnly?: boolean; inactive?: boolean;
  amount: number; buyer: number; seller: number; notes?: string;
}

export interface ClosingCostBreakdown {
  jurisdiction: JurisdictionRates;
  price: number; loan: number;
  lines: ClosingCostLine[];
  totals: { buyer: number; seller: number; combined: number };
}

export interface LocalityGroup {
  group: string;                                  // altGroup id
  options: { label: string; isDefault: boolean }[]; // selectable localities
}

/** List the locality picker groups for a jurisdiction (states with county/city
 *  alternatives). The UI renders one dropdown per group. */
export function getLocalityGroups(jurisdiction: JurisdictionRates): LocalityGroup[] {
  const groups: Record<string, { label: string; isDefault: boolean }[]> = {};
  for (const tx of jurisdiction.transferTaxes) {
    if (!tx.altGroup) continue;
    (groups[tx.altGroup] ??= []).push({ label: tx.altLabel ?? tx.name, isDefault: !!tx.altDefault });
  }
  return Object.entries(groups).map(([group, options]) => ({ group, options }));
}

export interface CalcOptions {
  includeEntityTaxes?: boolean;
  /** chosen locality per altGroup, e.g. { "NY-local": "NYC (commercial)" }. Falls back to each group's altDefault. */
  localities?: Record<string, string>;
}

export function calculateClosingCosts(jurisdiction: JurisdictionRates, price: number, loan: number, opts: CalcOptions | boolean = {}): ClosingCostBreakdown {
  // Back-compat: a boolean 3rd arg used to mean includeEntityTaxes.
  const options: CalcOptions = typeof opts === "boolean" ? { includeEntityTaxes: opts } : opts;
  const includeEntityTaxes = !!options.includeEntityTaxes;
  const localities = options.localities ?? {};

  // Resolve the active locality for each altGroup (chosen, else the group default, else the first).
  const activeAlt: Record<string, string> = {};
  for (const tx of jurisdiction.transferTaxes) {
    if (!tx.altGroup) continue;
    if (activeAlt[tx.altGroup] === undefined) {
      activeAlt[tx.altGroup] = localities[tx.altGroup] ?? "";
    }
    if (tx.altDefault && !localities[tx.altGroup]) activeAlt[tx.altGroup] = tx.altLabel ?? tx.name;
  }

  const lines: ClosingCostLine[] = [];
  const splitOf = (amt: number, party: Party) =>
    party === "buyer" ? { buyer: amt, seller: 0 }
    : party === "seller" ? { buyer: 0, seller: amt }
    : { buyer: amt / 2, seller: amt / 2 };

  const sched = jurisdiction.titleSchedule;
  const titleAmt = sched ? resolveTitlePremium(sched, price) : price * jurisdiction.titleInsuranceRate;
  const ts = splitOf(titleAmt, jurisdiction.titleInsuranceParty);
  const titleRate = price > 0 && sched ? titleAmt / price : jurisdiction.titleInsuranceRate;
  const titleMin = sched ? sched.brackets[sched.brackets.length - 1].per1000 / 1000 : undefined;
  const titleMax = sched ? sched.brackets[0].per1000 / 1000 : undefined;
  lines.push({ name: "Title Insurance (Owner's Policy)", rate: titleRate, rateMin: titleMin, rateMax: titleMax, base: "price",
    party: jurisdiction.titleInsuranceParty, amount: titleAmt, buyer: ts.buyer, seller: ts.seller,
    notes: sched
      ? `Regressive ${sched.promulgated ? "filed-rate" : "representative"} schedule — premium % declines as price rises. ${sched.source}`
      : (jurisdiction.titleInsuranceParty === "split" ? "Customarily split per local practice" : undefined) });

  for (const tx of jurisdiction.transferTaxes) {
    // Residential-only lines never apply to a commercial deal — show $0.
    if (tx.residentialOnly) { lines.push({ ...tx, amount: 0, buyer: 0, seller: 0, inactive: true }); continue; }
    // Entity-sale-only lines are dormant for a standard asset/deed sale.
    if (tx.entitySaleOnly && !includeEntityTaxes) { lines.push({ ...tx, amount: 0, buyer: 0, seller: 0, inactive: true }); continue; }
    // Locality alternatives: only the selected member of each altGroup applies.
    if (tx.altGroup && (tx.altLabel ?? tx.name) !== activeAlt[tx.altGroup]) {
      lines.push({ ...tx, amount: 0, buyer: 0, seller: 0, inactive: true }); continue;
    }
    const base = tx.base === "loan" ? loan : price;
    let amt: number;
    if (tx.marginalTiers) {
      amt = resolveMarginalTax(tx.marginalTiers, base);                // graduated: portion-by-portion
    } else if (tx.tiers) {
      amt = base * resolveTierRate(tx.tiers, base);                    // cliff: top tier rate × entire base
    } else {
      amt = base * tx.rate;                                            // flat
    }
    const sp = splitOf(amt, tx.party);
    lines.push({ ...tx, amount: amt, buyer: sp.buyer, seller: sp.seller });
  }

  if (jurisdiction.mortgageRecordingTax) {
    const mt = jurisdiction.mortgageRecordingTax;
    let amt: number;
    if (loan <= 0) {
      amt = 0;
    } else if (mt.marginalTiers) {
      amt = resolveMarginalTax(mt.marginalTiers, loan);
    } else if (mt.tiers) {
      amt = loan * resolveTierRate(mt.tiers, loan);
    } else {
      amt = loan * mt.rate;
    }
    const sp = splitOf(amt, mt.party);
    lines.push({ ...mt, amount: amt, buyer: sp.buyer, seller: sp.seller });
  }

  lines.push({ name: "Document Recording Fees (est.)", rate: 0, base: "price", party: "buyer",
    amount: jurisdiction.recordingFeesFlat, buyer: jurisdiction.recordingFeesFlat, seller: 0 });

  const totalBuyer = lines.reduce((s, l) => s + l.buyer, 0);
  const totalSeller = lines.reduce((s, l) => s + l.seller, 0);
  return { jurisdiction, price, loan, lines, totals: { buyer: totalBuyer, seller: totalSeller, combined: totalBuyer + totalSeller } };
}
