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

export interface TaxLineItem {
  name: string;
  rate: number;             // representative/flat rate (0.004 = 0.4%); for tiered items, the top-tier rate
  rateMin?: number;         // sliding/tiered low end (for display)
  rateMax?: number;         // sliding/tiered high end (for display)
  tiers?: TaxTier[];        // if present: rate is chosen by price tier, applied to entire price
  base: "price" | "loan";
  party: Party;
  entitySaleOnly?: boolean; // e.g. controlling-interest transfer tax — only on entity sales, not deed sales
  notes?: string;
}

export interface JurisdictionRates {
  state: string;
  stateName: string;
  ratesAsOf: string;             // e.g. "2026-05" — when the RATES were last verified
  titleInsuranceRate: number;    // owner's policy, % of price (approximate)
  titleInsuranceParty: Party;
  transferTaxes: TaxLineItem[];
  mortgageRecordingTax?: TaxLineItem;
  recordingFeesFlat: number;
  notes?: string;
}

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
    transferTaxes: [
      { name: "State Conveyance Tax", rate: 0.0125, rateMin: 0.0075, rateMax: 0.0225,
        base: "price", party: "seller",
        tiers: [{ over: 0, rate: 0.0075 }, { over: 800000, rate: 0.0125 }, { over: 2500000, rate: 0.0225 }],
        notes: "Tiered: 0.75% ≤$800K; 1.25% $800K–$2.5M; 2.25% >$2.5M. Seller pays. No county-level add-on." },
      { name: "Municipal Conveyance Tax", rate: 0.005, rateMin: 0.0025, rateMax: 0.005,
        base: "price", party: "seller",
        notes: "All CT towns levy 0.25% base municipal tax. Eligible 'targeted-investment' municipalities may charge up to 0.5%: includes Hartford, New Haven, Bridgeport, Waterbury, New London, Windham. Seller pays. Combined max in targeted cities: state 2.25% + local 0.5% = 2.75%." },
    ],
    recordingFeesFlat: 100,
    notes: "State + municipal conveyance taxes both seller-paid (Fidelity Aug-2025). Title insurance buyer-paid. No county-level transfer taxes in CT.",
  },

  DE: {
    state: "DE", stateName: "Delaware", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "State Realty Transfer Tax", rate: 0.02, base: "price", party: "split",
        notes: "2% state. Split 50/50: buyer 1% + seller 1%." },
      { name: "New Castle County Transfer Tax (Wilmington area)", rate: 0.015, rateMin: 0, rateMax: 0.015,
        base: "price", party: "split",
        notes: "New Castle County ONLY (Wilmington, Newark, Dover area): 1.5% each side. Combined with state: 4.0% total (2% buyer / 2% seller). One of the highest combined transfer tax burdens in the US." },
      { name: "Kent & Sussex County Transfer Tax", rate: 0.005, rateMin: 0, rateMax: 0.005,
        base: "price", party: "split",
        notes: "Kent County (Dover) and Sussex County (Rehoboth Beach, Lewes): 0.5% each side. Combined with state: 2.5% total (1.5% buyer / 1.5% seller). Significant but lower than New Castle." },
    ],
    recordingFeesFlat: 100,
    notes: "Always verify county. New Castle (most commercial activity): 4% combined. Kent/Sussex: 2.5% combined. All split 50/50. Title insurance buyer-paid.",
  },

  MA: {
    state: "MA", stateName: "Massachusetts", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "Deeds Excise Tax — Standard (all counties except island counties)",
        rate: 0.00456, base: "price", party: "seller",
        notes: "$4.56 per $1,000 = 0.456%. Seller pays. Applies in Essex, Middlesex, Norfolk, Suffolk (Boston), Worcester, Hampden, Hampshire, Franklin, Plymouth, Bristol counties." },
      { name: "Deeds Excise Tax — Island Counties (Cape Cod / Martha's Vineyard / Nantucket)",
        rate: 0.00656, rateMin: 0.00656, rateMax: 0.00656, base: "price", party: "seller",
        notes: "Barnstable (Cape Cod), Dukes (Martha's Vineyard), and Nantucket counties ONLY. Standard $4.56/$1K + Land Bank surcharge $2.00/$1K = $6.56 per $1,000 = 0.656% total. Seller pays. Surcharge goes to county land bank conservation fund." },
    ],
    recordingFeesFlat: 175,
    notes: "No city-level transfer taxes in MA as of 2026 (several cities including Boston and Somerville have proposed local transfer fees but none enacted). Boston: standard 0.456% only. Cape/Vineyard/Nantucket: 0.656%.",
  },

  ME: {
    state: "ME", stateName: "Maine", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
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
    transferTaxes: [
      { name: "Realty Transfer Fee (RTF) — Graduated", rate: 0.0121, rateMin: 0.004, rateMax: 0.0121,
        base: "price", party: "seller",
        notes: "Graduated: $2/$500 (0.4%) on first $150K; $3.35/$500 (0.67%) on $150K–$200K; $4.25/$500 (0.85%) on $200K–$350K; $5.25/$500 (1.05%) on $350K–$550K; $6.05/$500 (1.21%) above $550K. Seller pays. No county or city RTF add-ons." },
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
    transferTaxes: [
      { name: "NYS Real Estate Transfer Tax", rate: 0.004, base: "price", party: "seller",
        notes: "0.4% statewide. Seller pays. Applies in NYC, Nassau, Suffolk, Westchester, and all upstate counties. Base rate; additional NYC taxes apply below." },
      { name: "NYC Real Property Transfer Tax — Class 4 Commercial", rate: 0.02625, rateMin: 0.01425, rateMax: 0.02625,
        base: "price", party: "seller",
        tiers: [{ over: 0, rate: 0.01425 }, { over: 500000, rate: 0.02625 }],
        notes: "NYC 5 boroughs ONLY. Class 4 commercial: 1.425% ≤$500K; 2.625% above. Seller pays. Combined with state 0.4%: total NYC seller burden ~3.0% on large commercial. Absolutely NO city transfer tax outside the 5 boroughs (Nassau, Suffolk, Westchester: state only)." },
      { name: "NYC Real Property Transfer Tax — Class 1 & 2 Residential", rate: 0.01425, rateMin: 0.01, rateMax: 0.01425,
        base: "price", party: "seller",
        tiers: [{ over: 0, rate: 0.01 }, { over: 500000, rate: 0.01425 }],
        notes: "NYC residential: 1.0% ≤$500K; 1.425% above. Seller pays. Commercial rate (2.625%) applies to most investment property." },
      { name: "Yonkers City Transfer Tax", rate: 0.025, rateMin: 0, rateMax: 0.025,
        base: "price", party: "seller",
        notes: "City of Yonkers (Westchester County) ONLY: 2.5% city transfer tax in addition to state 0.4%. Combined Yonkers: 2.9% total. Other Westchester municipalities: no local tax. Verify property is in Yonkers city limits." },
      { name: "NYS Additional Transfer Tax (residential COOP/condo >$2M)", rate: 0.0025, rateMin: 0, rateMax: 0.0025,
        base: "price", party: "seller",
        notes: "Residential coops/condos and townhomes over $2M in NYC only: 0.25% additional seller tax. Commercial properties: generally not applicable. Verify property type." },
    ],
    mortgageRecordingTax: { name: "Mortgage Recording Tax (MRT)", rate: 0.028, rateMin: 0.0105, rateMax: 0.028,
      base: "loan", party: "buyer",
      notes: "NYC commercial ≥$500K: 2.8% (2.05% state + 0.75% NYC). NYC residential: 2.05%. Nassau/Suffolk/Westchester: ~1.05%–1.3%. Other NY: 1.05%. Buyer pays. MRT is the largest single buyer cost in NYC transactions." },
    recordingFeesFlat: 250,
    notes: "NYC is among the most expensive closing jurisdictions nationally. State 0.4% + NYC RPTT 2.625% = ~3.025% seller; MRT 2.8% buyer. Total NYC transfer cost on a $20M deal: seller ~$605K + buyer ~$364K = ~$969K. Upstate: state 0.4% seller only. Always identify borough/county.",
  },

  RI: {
    state: "RI", stateName: "Rhode Island", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
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
    transferTaxes: [
      { name: "State Transfer Tax", rate: 0.005, base: "price", party: "split",
        notes: "0.5% state. Split equally by custom (buyer 0.25% + seller 0.25%). First-time homebuyers get exemption — not applicable to commercial." },
      { name: "County Transfer Tax — Baltimore City", rate: 0.015, rateMin: 0, rateMax: 0.015,
        base: "price", party: "split",
        notes: "Baltimore City ONLY: 1.5% city transfer tax. Split 50/50. Combined with state: 2.0% transfer tax total. PLUS Baltimore City recordation tax 1.0% (see mortgage recordation line). Grand total deed burden in Baltimore City: ~3.0%." },
      { name: "County Transfer Tax — Baltimore County, Howard County", rate: 0.015, rateMin: 0, rateMax: 0.015,
        base: "price", party: "split",
        notes: "Baltimore County (Towson) and Howard County (Columbia): 1.5% county transfer tax each. Split 50/50. Combined with state: 2.0% total transfer tax." },
      { name: "County Transfer Tax — Prince George's County", rate: 0.014, rateMin: 0, rateMax: 0.014,
        base: "price", party: "split",
        notes: "Prince George's County (Landover, Bowie, Hyattsville): 1.4% county. Split 50/50. Combined with state: 1.9% total." },
      { name: "County Transfer Tax — Anne Arundel, Harford, Montgomery, St. Mary's",
        rate: 0.01, rateMin: 0, rateMax: 0.01, base: "price", party: "split",
        notes: "Anne Arundel (Annapolis), Harford (Bel Air), Montgomery (Rockville, Bethesda, Silver Spring), St. Mary's: 1.0% county each. Split 50/50. Combined with state: 1.5% total." },
      { name: "County Transfer Tax — All Other MD Counties",
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
    transferTaxes: [
      { name: "State Realty Transfer Tax", rate: 0.01, base: "price", party: "split",
        notes: "1.0% state. Split 50/50: buyer 0.5% + seller 0.5%." },
      { name: "Philadelphia Local RTT", rate: 0.03278, rateMin: 0, rateMax: 0.03278,
        base: "price", party: "split",
        notes: "City of Philadelphia ONLY: 3.278% local RTT (city 2.0% + school district 1.278%). Split 50/50. Combined with state: 4.278% total (buyer 2.139% + seller 2.139%). Apply ONLY when property is within Philadelphia city limits." },
      { name: "Pittsburgh / Allegheny County Local RTT", rate: 0.02, rateMin: 0, rateMax: 0.02,
        base: "price", party: "split",
        notes: "City of Pittsburgh: 1.0% city + 1.0% Pittsburgh school district = 2.0% local. Split 50/50. Combined with state: 3.0% total. Allegheny County outside Pittsburgh: school district + municipality varies ~1%–2%; typically 2%–3% combined. Verify municipality + school district." },
      { name: "Scranton / Lackawanna County Area Local RTT", rate: 0.02, rateMin: 0, rateMax: 0.02,
        base: "price", party: "split",
        notes: "City of Scranton: 2.0% local (city 1% + school district 1%). Split 50/50. Combined: 3.0% total. Surrounding Lackawanna County municipalities: ~1%–2% local." },
      { name: "Harrisburg / Dauphin County Area Local RTT", rate: 0.02, rateMin: 0, rateMax: 0.02,
        base: "price", party: "split",
        notes: "City of Harrisburg: 2.0% local. Split 50/50. Combined: 3.0% total. Surrounding Dauphin County: ~1%–2%." },
      { name: "Allentown / Lehigh Valley Area Local RTT", rate: 0.02, rateMin: 0, rateMax: 0.02,
        base: "price", party: "split",
        notes: "City of Allentown, Bethlehem: ~2.0% local. Split 50/50. Combined: ~3.0% total. Lehigh/Northampton County suburbs: typically 1%–2% local." },
      { name: "Suburban PA / Standard Municipalities", rate: 0.01, rateMin: 0.005, rateMax: 0.015,
        base: "price", party: "split",
        notes: "Most PA suburban boroughs and townships outside major cities: 1.0% local (municipality 0.5% + school district 0.5%). Split 50/50. Combined with state: 2.0% total. Some localities range 0.5%–1.5% local depending on municipality and school district. ALWAYS verify specific municipality + school district for the property." },
    ],
    recordingFeesFlat: 100,
    notes: "PA RTT = state (1.0%) + local (municipality + school district, varies). ALL splits 50/50 by statute. Philadelphia: 4.278% combined. Pittsburgh city: 3.0%. Most suburbs: 2.0%. NO mortgage recording tax. Title premium buyer-paid, all-inclusive.",
  },

  VA: {
    state: "VA", stateName: "Virginia", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "State Grantor Tax", rate: 0.001, base: "price", party: "seller",
        notes: "$1 per $1,000 = 0.1%. Seller (grantor) pays. Statewide." },
      { name: "State Recordation Tax (Grantee/Buyer)", rate: 0.0025, base: "price", party: "buyer",
        notes: "$2.50 per $1,000 = 0.25%. Buyer pays. Statewide." },
      { name: "Local 1/3 Recordation Tax (Buyer)", rate: 0.000833, base: "price", party: "buyer",
        notes: "Each Virginia locality also charges 1/3 of the state grantee recordation tax = ~$0.83/$1K = 0.083%. Buyer pays. Combined buyer recordation: 0.25% + 0.083% = ~0.333%." },
      { name: "Northern Virginia / Hampton Roads Regional Grantor Tax",
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
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Mississippi has NO deed transfer tax at any level — state, county, or city. Jackson, Gulfport, Biloxi: no transfer taxes. Owner's policy customarily seller-paid. One of the lowest-cost closing states.",
  },

  NC: {
    state: "NC", stateName: "North Carolina", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "State Excise Tax on Conveyances", rate: 0.002, base: "price", party: "seller",
        notes: "$1 per $500 = 0.20%. Seller pays. Statewide; applies to all NC counties as base." },
      { name: "Orange County Local Land Transfer Tax", rate: 0.004, rateMin: 0, rateMax: 0.004,
        base: "price", party: "buyer",
        notes: "Orange County (Chapel Hill, Carrboro, Hillsborough) ONLY: 0.4% Local Land Transfer Tax adopted by voter referendum. Buyer pays. Combined with state: 0.60% total (0.20% seller + 0.40% buyer)." },
      { name: "Chatham County Local Land Transfer Tax", rate: 0.004, rateMin: 0, rateMax: 0.004,
        base: "price", party: "buyer",
        notes: "Chatham County (Pittsboro, Siler City, southern Triangle area) ONLY: 0.4% LTT. Buyer pays. Combined: 0.60% total." },
      { name: "Mecklenburg County Local Land Transfer Tax", rate: 0.004, rateMin: 0, rateMax: 0.004,
        base: "price", party: "buyer",
        notes: "Mecklenburg County (Charlotte, Charlotte suburbs) ONLY: 0.4% LTT adopted by voter referendum. Buyer pays. Combined in Charlotte area: 0.60% total. Verify current status — some LTT referendums have been contested." },
    ],
    recordingFeesFlat: 75,
    notes: "Most NC counties: 0.20% seller only. Charlotte (Mecklenburg), Chapel Hill (Orange), and Chatham County: add 0.40% buyer LTT. All other 97 NC counties have NO local LTT. Always check the county.",
  },

  SC: {
    state: "SC", stateName: "South Carolina", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
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
    transferTaxes: [],
    mortgageRecordingTax: { name: "Documentary Tax on Mortgage / Note", rate: 0.0035, base: "loan", party: "buyer",
      notes: "~$0.35/$100 = 0.35% of loan. Buyer pays. Applies to the note/mortgage instrument. Statewide; no parish (county) or city add-ons. No deed transfer tax in Louisiana (civil-law Act of Sale system)." },
    recordingFeesFlat: 75,
    notes: "Louisiana uses Civil Code Act of Sale; no deed transfer tax at any level. New Orleans, Baton Rouge, Shreveport: no transfer taxes. Parish recording fees vary; $75 is typical for commercial. Title insurance less common (closings handled by notaries); premium split when obtained. Verify with a Louisiana notary.",
  },

  OK: {
    state: "OK", stateName: "Oklahoma", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "seller",
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
    transferTaxes: [
      { name: "State Real Estate Transfer Tax", rate: 0.001, base: "price", party: "seller",
        notes: "$0.50 per $500 = 0.10%. Seller pays. Applies statewide." },
      { name: "Cook County Transfer Tax", rate: 0.0005, base: "price", party: "seller",
        notes: "$0.25 per $500 = 0.05%. Cook County ONLY (Chicago and all Cook County suburbs). Seller pays." },
      { name: "City of Chicago RPTT — Buyer Portion", rate: 0.0075, base: "price", party: "buyer",
        notes: "City of Chicago ONLY: $3.75 per $500 = 0.75%. BUYER pays. Does NOT apply in any suburb, even those within Cook County. Verify property address is in Chicago city limits. Chicago combined: state 0.10% + Cook 0.05% + city 1.05% (0.75% buyer + 0.30% seller) = 1.20% total." },
      { name: "City of Chicago RPTT — Seller Portion", rate: 0.003, base: "price", party: "seller",
        notes: "City of Chicago ONLY: $1.50 per $500 = 0.30%. Seller pays. Combined Chicago city RPTT: 1.05% (0.75% buyer + 0.30% seller)." },
      { name: "Evanston Municipal Transfer Tax", rate: 0.005, rateMin: 0, rateMax: 0.005,
        base: "price", party: "seller",
        notes: "City of Evanston ONLY: 0.5% city transfer tax. Seller pays. Combined Evanston: state 0.10% + Cook 0.05% + Evanston 0.50% = 0.65%." },
      { name: "Oak Park Municipal Transfer Tax", rate: 0.001, rateMin: 0, rateMax: 0.001,
        base: "price", party: "seller",
        notes: "Village of Oak Park ONLY: 0.1% municipal transfer tax. Combined: 0.25%." },
    ],
    recordingFeesFlat: 100,
    notes: "ALWAYS verify city/municipality. Chicago: 1.20% combined (buyer 0.80%, seller 0.40%). Evanston: 0.65%. Oak Park: 0.25%. Suburban Cook County without municipal tax (Schaumburg, Naperville, etc.): 0.15% seller only. Downstate IL outside Cook County: 0.10% seller only. Title premium seller-paid. No IL mortgage recording tax.",
  },

  IN: {
    state: "IN", stateName: "Indiana", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "seller",
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Indiana has NO deed transfer tax, NO county transfer tax, and NO mortgage recording tax. Indianapolis, Fort Wayne, Evansville, South Bend: no transfer taxes. Owner's policy customarily seller-paid.",
  },

  KS: {
    state: "KS", stateName: "Kansas", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "buyer",
    transferTaxes: [],
    mortgageRecordingTax: { name: "Mortgage Registration Tax", rate: 0.0026, base: "loan", party: "buyer",
      notes: "0.26% of loan. Buyer pays. Statewide; no county or city variations. Kansas City and Wichita use same rate." },
    recordingFeesFlat: 50,
    notes: "Kansas has NO deed transfer tax at any level. Mortgage registration tax (0.26%) is the main buyer closing cost. Title insurance buyer-paid.",
  },

  MI: {
    state: "MI", stateName: "Michigan", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "seller",
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
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Missouri has NO deed transfer tax, NO county transfer tax, and NO mortgage tax. Kansas City and St. Louis have no city transfer taxes. Owner's policy customarily seller-paid.",
  },

  ND: {
    state: "ND", stateName: "North Dakota", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "buyer",
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "North Dakota has NO deed transfer tax at state, county, or city level. Fargo, Bismarck, Grand Forks: no transfer taxes. Title insurance buyer-paid.",
  },

  NE: {
    state: "NE", stateName: "Nebraska", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "buyer",
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
    transferTaxes: [],
    recordingFeesFlat: 75,
    notes: "Alaska has NO statewide deed transfer tax. Anchorage, Fairbanks, Juneau: no city transfer taxes. A few small municipalities may have local transfer taxes — verify for the specific borough/city. Title premium typically split.",
  },

  AZ: {
    state: "AZ", stateName: "Arizona", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    transferTaxes: [],
    recordingFeesFlat: 30,
    notes: "Arizona has NO deed transfer tax at state, county, or city level. Phoenix, Scottsdale, Tucson, Tempe, Chandler, Mesa, Glendale: absolutely no transfer taxes. Among the lowest closing-cost states. Title premium typically split.",
  },

  CA: {
    state: "CA", stateName: "California", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    transferTaxes: [
      { name: "County Documentary Transfer Tax (base — all CA counties)",
        rate: 0.0011, base: "price", party: "seller",
        notes: "$1.10 per $1,000 = 0.11%. Seller pays. Base county DTT applied statewide per California Revenue & Taxation Code §11911. For incorporated cities: county keeps $0.55/$1K (0.055%) and city keeps $0.55/$1K (0.055%) minimum — unless city imposes its own higher rate." },
      { name: "City of Los Angeles — Base City DTT",
        rate: 0.0045, base: "price", party: "seller",
        notes: "City of LA ONLY: $4.50/$1K = 0.45% city DTT. Seller pays. Combined with county: 0.56% for standard LA transactions <$5M." },
      { name: "Los Angeles Measure ULA — $5M to $10M Tier",
        rate: 0.04, rateMin: 0, rateMax: 0.04, base: "price", party: "seller",
        tiers: [{ over: 5000000, rate: 0.04 }],
        notes: "City of Los Angeles ONLY (effective April 1, 2023). Properties sold $5M–$10M: additional 4.0% seller tax applied to ENTIRE price. Combined with base 0.56%: 4.56% total on full sale price. Applies to commercial, multifamily, and residential. ONLY within City of LA limits — not Beverly Hills, Culver City, Santa Monica, West Hollywood, etc." },
      { name: "Los Angeles Measure ULA — Over $10M Tier",
        rate: 0.055, rateMin: 0, rateMax: 0.055, base: "price", party: "seller",
        tiers: [{ over: 10000000, rate: 0.055 }],
        notes: "City of Los Angeles ONLY. Properties sold >$10M: additional 5.5% seller tax on ENTIRE price. Combined with base 0.56%: 6.06% total. A $20M LA deal: ~$1.21M in transfer taxes alone. This is one of the highest city transfer tax burdens nationally." },
      { name: "San Francisco — City/County DTT (tiered)",
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
      { name: "Oakland — City DTT (Alameda County)",
        rate: 0.0175, rateMin: 0.01, rateMax: 0.0175, base: "price", party: "seller",
        tiers: [
          { over: 0,       rate: 0.01   },
          { over: 300000,  rate: 0.015  },
          { over: 2000000, rate: 0.0175 },
        ],
        notes: "City of Oakland ONLY. Tiered: 1.0% (≤$300K); 1.5% ($300K–$2M); 1.75% (>$2M). Plus Alameda County base 0.055%. Combined Oakland total: ~1.055%–1.805%. Seller pays." },
      { name: "Berkeley — City DTT (Alameda County)",
        rate: 0.015, base: "price", party: "seller",
        notes: "City of Berkeley ONLY: $15/$1K = 1.5% city DTT. Plus Alameda County 0.055%. Combined: ~1.555%. Seller pays." },
      { name: "Santa Monica — City DTT (LA County)",
        rate: 0.003, base: "price", party: "seller",
        notes: "City of Santa Monica ONLY: $3/$1K = 0.30% city. Plus LA County 0.055%. Combined: ~0.355%. Seller pays." },
      { name: "Culver City — City DTT (LA County)",
        rate: 0.0045, base: "price", party: "seller",
        notes: "City of Culver City ONLY: $4.50/$1K = 0.45% city. Plus LA County 0.055%. Combined: ~0.505%. Seller pays." },
      { name: "West Hollywood — City DTT (LA County)",
        rate: 0.0055, base: "price", party: "seller",
        notes: "City of West Hollywood ONLY: $5.50/$1K = 0.55% city. Plus LA County 0.055%. Combined: ~0.605%. Seller pays." },
      { name: "San Jose — City DTT (Santa Clara County)",
        rate: 0.0033, base: "price", party: "seller",
        notes: "City of San Jose ONLY: $3.30/$1K = 0.33% city. Plus Santa Clara County 0.055%. Combined: ~0.385%. Seller pays." },
      { name: "Palo Alto — City DTT (Santa Clara County)",
        rate: 0.0033, base: "price", party: "seller",
        notes: "City of Palo Alto ONLY: $3.30/$1K = 0.33% city. Plus Santa Clara County 0.055%. Combined: ~0.385%. Seller pays." },
      { name: "Mountain View — City DTT (Santa Clara County)",
        rate: 0.0033, base: "price", party: "seller",
        notes: "City of Mountain View ONLY: $3.30/$1K = 0.33% city. Plus Santa Clara County 0.055%. Combined: ~0.385%. Seller pays." },
      { name: "Richmond — City DTT (Contra Costa County)",
        rate: 0.007, base: "price", party: "seller",
        notes: "City of Richmond ONLY: $7.00/$1K = 0.70% city. Plus Contra Costa County 0.055%. Combined: ~0.755%. Seller pays." },
      { name: "Stockton — City DTT (San Joaquin County)",
        rate: 0.00275, base: "price", party: "seller",
        notes: "City of Stockton ONLY: $2.75/$1K = 0.275% city. Plus San Joaquin County 0.055%. Combined: ~0.33%. Seller pays." },
      { name: "All Other CA Cities — County Base Only",
        rate: 0.0011, base: "price", party: "seller",
        notes: "Cities that do NOT impose a city-specific DTT: San Diego, Sacramento, Fresno, Bakersfield, Anaheim, Riverside, Long Beach, San Bernardino, Irvine, Pasadena, Burbank, Glendale, and most other CA incorporated cities. These collect only the county base rate: 0.11% total. Seller pays. Confirm at the county recorder." },
    ],
    recordingFeesFlat: 125,
    notes: "CRITICAL: California transfer taxes vary enormously by city. City of LA: 0.56% standard; 4.56%–6.06% for deals over $5M (Measure ULA). SF: 0.50%–3.0% tiered. Oakland: 1.0%–1.75%. Most other cities outside this list: 0.11% county only. Beverly Hills, San Diego, Sacramento, Fresno: county base only (0.11%). ALWAYS confirm exact city limits — adjacent cities can differ by 5%+ on a large deal. All seller-paid.",
  },

  CO: {
    state: "CO", stateName: "Colorado", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "seller",
    transferTaxes: [
      { name: "State Documentary Fee", rate: 0.0001, base: "price", party: "buyer",
        notes: "$0.01 per $100 = 0.01%. Nominal statewide filing fee. Buyer pays. Denver, Boulder, Colorado Springs, Aurora: no additional municipal transfer taxes." },
      { name: "Mountain Resort Town RETT — Aspen / Vail / Keystone / Breckenridge tier",
        rate: 0.015, rateMin: 0.01, rateMax: 0.015, base: "price", party: "buyer",
        notes: "MOUNTAIN RESORT MUNICIPALITIES ONLY. Aspen: 1.5%. Breckenridge: 1.0%. Vail: 1.5%. Snowmass Village: 1.0%. Frisco: 1.0%. Dillon: 1.0%. Avon: 2.0%. Keystone Resort area: 1.5%. Buyer pays. These are home-rule Real Estate Transfer Taxes for affordable housing funds. Applies only if property is within the specific town limits." },
      { name: "Mountain Resort Town RETT — Telluride / Crested Butte tier",
        rate: 0.03, rateMin: 0.03, rateMax: 0.03, base: "price", party: "buyer",
        notes: "Telluride: 3.0% RETT. Crested Butte: 3.0% RETT. Buyer pays. Highest Colorado transfer taxes — a $5M Telluride property: $150K in transfer taxes. These also only apply within the specific town limits." },
    ],
    recordingFeesFlat: 50,
    notes: "Denver, Colorado Springs, Aurora, Fort Collins, Boulder city proper, Pueblo: effectively NO transfer taxes (only $0.01/$100 state filing fee). Mountain resort towns: 1.0%–3.0% buyer-paid RETT. Always check if the property is within a resort town's municipal limits. Owner's policy seller-paid by custom.",
  },

  HI: {
    state: "HI", stateName: "Hawaii", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
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
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Idaho has NO deed transfer tax at state, county, or city level. Boise, Nampa, Meridian, Twin Falls, Idaho Falls: no transfer taxes. Title premium typically split.",
  },

  MT: {
    state: "MT", stateName: "Montana", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Montana has NO deed transfer tax at state, county, or city level. Billings, Missoula, Great Falls, Bozeman: no transfer taxes. Title premium typically split.",
  },

  NM: {
    state: "NM", stateName: "New Mexico", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
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
    transferTaxes: [
      { name: "State Real Property Transfer Tax", rate: 0.0013, base: "price", party: "seller",
        notes: "$0.65 per $500 = 0.13%. Seller pays. Statewide base." },
      { name: "Clark County (Las Vegas) Additional Transfer Tax",
        rate: 0.0013, rateMin: 0, rateMax: 0.0013, base: "price", party: "seller",
        notes: "Clark County (Las Vegas, Henderson, North Las Vegas, Boulder City) ONLY: additional $0.65/$500 = 0.13%. Combined Clark total: 0.26%. No Las Vegas city-level transfer tax." },
      { name: "Washoe County (Reno) Additional Transfer Tax",
        rate: 0.0013, rateMin: 0, rateMax: 0.0013, base: "price", party: "seller",
        notes: "Washoe County (Reno, Sparks) ONLY: additional $0.65/$500 = 0.13%. Combined Washoe total: 0.26%." },
    ],
    recordingFeesFlat: 75,
    notes: "Nevada: state 0.13% + county up to 0.13% = 0.26% max combined. Las Vegas (Clark) and Reno (Washoe): both at max 0.26%. Rural NV counties: may be only state 0.13%. No city-level transfer taxes in NV. Title premium typically split.",
  },

  OR: {
    state: "OR", stateName: "Oregon", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "split",
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
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Utah has NO deed transfer tax at state, county, or city level. Salt Lake City, Provo, Ogden, St. George: no transfer taxes. Title premium typically split.",
  },

  WA: {
    state: "WA", stateName: "Washington", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    transferTaxes: [
      { name: "State REET — Tiered (commercial)", rate: 0.03, rateMin: 0.011, rateMax: 0.03,
        base: "price", party: "seller",
        tiers: [
          { over: 0,       rate: 0.011  },
          { over: 525000,  rate: 0.0128 },
          { over: 1525000, rate: 0.0275 },
          { over: 3025000, rate: 0.03   },
        ],
        notes: "State REET per RCW 82.45: 1.1% (≤$525K); 1.28% ($525K–$1.525M); 2.75% ($1.525M–$3.025M); 3.0% (>$3.025M). Seller pays. These are commercial thresholds; residential thresholds differ slightly." },
      { name: "Local REET — King County (Seattle metro)",
        rate: 0.005, rateMin: 0, rateMax: 0.005, base: "price", party: "seller",
        notes: "King County (Seattle, Bellevue, Kirkland, Redmond, etc.) ONLY: 0.5% additional local REET per RCW 82.46.035. Seller pays. Combined King County total: 1.6% (small deals) up to 3.5% (deals >$3M)." },
      { name: "Local REET — Pierce, Snohomish, Spokane Counties",
        rate: 0.005, rateMin: 0, rateMax: 0.005, base: "price", party: "seller",
        notes: "Pierce County (Tacoma), Snohomish County (Everett), Spokane County: typically 0.5% additional local REET. Seller pays." },
      { name: "Local REET — Most Other WA Counties",
        rate: 0.0025, rateMin: 0, rateMax: 0.005, base: "price", party: "seller",
        notes: "Most other WA counties levy 0.25%–0.5% local REET. Verify specific county. Seller pays." },
    ],
    recordingFeesFlat: 200,
    notes: "Washington's REET is tiered and seller-paid. For $5M+ commercial deals: state REET alone is 3.0% — plus local REET 0.25%–0.5% = 3.25%–3.5% total. King County (Seattle) at maximum local: 3.5% combined on large deals. Always identify county for accurate local REET.",
  },

  WY: {
    state: "WY", stateName: "Wyoming", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
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

/** Format a rate for display: single %, sliding/tiered range, or flat fee. */
export function formatRate(item: { rate: number; rateMin?: number; rateMax?: number; tiers?: TaxTier[]; base?: "price" | "loan" }): string {
  const pct = (r: number) => `${(r * 100).toFixed(r > 0 && r < 0.001 ? 4 : r < 0.01 ? 3 : 2).replace(/\.?0+$/, "")}%`;
  const baseLabel = item.base === "loan" ? " of loan" : item.base === "price" ? " of price" : "";
  if (item.rateMin != null && item.rateMax != null && item.rateMin !== item.rateMax) {
    const tag = item.tiers ? " (tiered)" : " (sliding)";
    return `${pct(item.rateMin)}-${pct(item.rateMax)}${baseLabel}${tag}`;
  }
  if (item.rate === 0) return "flat fee";
  return `${pct(item.rate)}${baseLabel}`;
}

export interface ClosingCostLine {
  name: string; rate: number; rateMin?: number; rateMax?: number; tiers?: TaxTier[];
  base: "price" | "loan"; party: Party; entitySaleOnly?: boolean;
  amount: number; buyer: number; seller: number; notes?: string;
}

export interface ClosingCostBreakdown {
  jurisdiction: JurisdictionRates;
  price: number; loan: number;
  lines: ClosingCostLine[];
  totals: { buyer: number; seller: number; combined: number };
}

export function calculateClosingCosts(jurisdiction: JurisdictionRates, price: number, loan: number, includeEntityTaxes = false): ClosingCostBreakdown {
  const lines: ClosingCostLine[] = [];
  const splitOf = (amt: number, party: Party) =>
    party === "buyer" ? { buyer: amt, seller: 0 }
    : party === "seller" ? { buyer: 0, seller: amt }
    : { buyer: amt / 2, seller: amt / 2 };

  const titleAmt = price * jurisdiction.titleInsuranceRate;
  const ts = splitOf(titleAmt, jurisdiction.titleInsuranceParty);
  lines.push({ name: "Title Insurance (Owner's Policy)", rate: jurisdiction.titleInsuranceRate, base: "price",
    party: jurisdiction.titleInsuranceParty, amount: titleAmt, buyer: ts.buyer, seller: ts.seller,
    notes: jurisdiction.titleInsuranceParty === "split" ? "Customarily split per local practice" : undefined });

  for (const tx of jurisdiction.transferTaxes) {
    if (tx.entitySaleOnly && !includeEntityTaxes) {
      // Show the line (rate visible) but zero $ for a standard asset/deed sale.
      lines.push({ ...tx, amount: 0, buyer: 0, seller: 0 });
      continue;
    }
    const effRate = tx.tiers ? resolveTierRate(tx.tiers, price) : tx.rate;
    const base = tx.base === "loan" ? loan : price;
    const amt = base * effRate;
    const sp = splitOf(amt, tx.party);
    lines.push({ ...tx, amount: amt, buyer: sp.buyer, seller: sp.seller });
  }

  if (jurisdiction.mortgageRecordingTax) {
    const mt = jurisdiction.mortgageRecordingTax;
    const effRate = mt.tiers ? resolveTierRate(mt.tiers, loan) : mt.rate;
    const amt = loan > 0 ? loan * effRate : 0;
    const sp = splitOf(amt, mt.party);
    lines.push({ ...mt, amount: amt, buyer: sp.buyer, seller: sp.seller });
  }

  lines.push({ name: "Document Recording Fees (est.)", rate: 0, base: "price", party: "buyer",
    amount: jurisdiction.recordingFeesFlat, buyer: jurisdiction.recordingFeesFlat, seller: 0 });

  const totalBuyer = lines.reduce((s, l) => s + l.buyer, 0);
  const totalSeller = lines.reduce((s, l) => s + l.seller, 0);
  return { jurisdiction, price, loan, lines, totals: { buyer: totalBuyer, seller: totalSeller, combined: totalBuyer + totalSeller } };
}
