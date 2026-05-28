// Customary commercial real estate closing cost data by state.
// Rates and party responsibility reflect typical CRE transactions; actual
// closing costs are negotiable per deal. Always verify with title company
// and counsel before relying on for an offer.
//
// Sources (compiled as of 2025-2026): ATTOM, ALTA, NCSL transfer tax tables,
// state department of revenue publications. Update annually.

export type Party = "buyer" | "seller" | "split";

export interface TaxLineItem {
  name: string;
  rate: number;           // decimal (0.004 = 0.4%)
  base: "price" | "loan";
  party: Party;
  notes?: string;
}

export interface JurisdictionRates {
  state: string;          // 2-letter postal
  stateName: string;
  titleInsuranceRate: number;     // owner's policy, % of price
  titleInsuranceParty: Party;
  transferTaxes: TaxLineItem[];   // can be empty array
  mortgageRecordingTax?: TaxLineItem;
  recordingFeesFlat: number;      // typical document recording fees, $
  notes?: string;
}

// Per-state customary rates. Where city/county taxes vary significantly,
// the dominant CRE jurisdiction is used (e.g., NYC for NY, Chicago for IL).
// For other localities, the user can override.
export const CLOSING_COSTS_BY_STATE: Record<string, JurisdictionRates> = {
  NY: {
    state: "NY",
    stateName: "New York",
    titleInsuranceRate: 0.005,
    titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "NYS Real Estate Transfer Tax", rate: 0.004, base: "price", party: "seller" },
      { name: "NYS Mansion Tax (over $1M)", rate: 0.01, base: "price", party: "buyer", notes: "Applies only to transactions over $1M; sliding additional brackets up to 2.9% at $25M+" },
      { name: "NYC Real Property Transfer Tax (commercial)", rate: 0.02625, base: "price", party: "seller", notes: "2.625% on commercial > $500K. Outside NYC, no city tax." },
    ],
    mortgageRecordingTax: { name: "Mortgage Recording Tax (NYC commercial)", rate: 0.028, base: "loan", party: "buyer", notes: "2.8% on commercial loans > $500K in NYC. Outside NYC, varies (~1.05%)." },
    recordingFeesFlat: 250,
    notes: "NYC has the highest combined transfer + mortgage taxes in the US. Verify locality — Upstate NY rates are far lower.",
  },
  NJ: {
    state: "NJ",
    stateName: "New Jersey",
    titleInsuranceRate: 0.005,
    titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "Realty Transfer Fee", rate: 0.0104, base: "price", party: "seller", notes: "Sliding scale; ~0.4% on first $150K up to 1.04% on portion over $1M" },
      { name: "Mansion Tax (over $1M)", rate: 0.01, base: "price", party: "buyer" },
      { name: "Controlling Interest Transfer Tax", rate: 0.01, base: "price", party: "buyer", notes: "Applies to entity sales > $1M of qualifying real property" },
    ],
    recordingFeesFlat: 200,
  },
  FL: {
    state: "FL",
    stateName: "Florida",
    titleInsuranceRate: 0.00575,
    titleInsuranceParty: "seller",
    transferTaxes: [
      { name: "Documentary Stamp Tax on Deed", rate: 0.007, base: "price", party: "seller", notes: "Higher in Miami-Dade (~0.6% surtax on non-single-family)" },
      { name: "Documentary Stamp Tax on Note", rate: 0.0035, base: "loan", party: "buyer" },
      { name: "Intangibles Tax on Mortgage", rate: 0.002, base: "loan", party: "buyer" },
    ],
    recordingFeesFlat: 100,
    notes: "Title insurance rates are promulgated (state-set). Customary buyer/seller split varies by county.",
  },
  CA: {
    state: "CA",
    stateName: "California",
    titleInsuranceRate: 0.0045,
    titleInsuranceParty: "split",
    transferTaxes: [
      { name: "State Documentary Transfer Tax", rate: 0.0011, base: "price", party: "split", notes: "Buyer/seller split varies by county (Northern CA: split; Southern CA: seller customarily)" },
      { name: "City/County Transfer Tax (LA County example)", rate: 0.0045, base: "price", party: "split", notes: "Varies widely. San Francisco: sliding scale 0.5%-6% (Measure ULA). Los Angeles: 0.45% + Measure ULA 4-5.5% over $5M." },
    ],
    recordingFeesFlat: 125,
    notes: "California city/county transfer taxes vary dramatically — verify locality. SF & LA have substantial mansion taxes (Measure ULA in LA, Prop I in SF).",
  },
  IL: {
    state: "IL",
    stateName: "Illinois",
    titleInsuranceRate: 0.0045,
    titleInsuranceParty: "seller",
    transferTaxes: [
      { name: "State Transfer Tax", rate: 0.001, base: "price", party: "seller" },
      { name: "County Transfer Tax", rate: 0.0005, base: "price", party: "seller" },
      { name: "Chicago Transfer Tax (where applicable)", rate: 0.0105, base: "price", party: "split", notes: "Chicago only: 0.75% buyer + 0.30% seller. Suburban: only state+county apply." },
    ],
    recordingFeesFlat: 100,
  },
  PA: {
    state: "PA",
    stateName: "Pennsylvania",
    titleInsuranceRate: 0.0055,
    titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "State Realty Transfer Tax", rate: 0.01, base: "price", party: "split" },
      { name: "Local Transfer Tax", rate: 0.01, base: "price", party: "split", notes: "Most municipalities. Philadelphia: 3.278% combined (split). Pittsburgh: 4% combined." },
    ],
    recordingFeesFlat: 100,
    notes: "PA customarily 50/50 buyer/seller split on transfer tax.",
  },
  TX: {
    state: "TX",
    stateName: "Texas",
    titleInsuranceRate: 0.0055,
    titleInsuranceParty: "seller",
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Texas has NO transfer or recording tax — one of the lowest-cost states for CRE closings.",
  },
  WA: {
    state: "WA",
    stateName: "Washington",
    titleInsuranceRate: 0.0045,
    titleInsuranceParty: "split",
    transferTaxes: [
      { name: "Real Estate Excise Tax (REET)", rate: 0.0278, base: "price", party: "seller", notes: "Sliding scale: 1.1% on first $525K, scaling up to 3% over $3.025M. Local additions of 0.25-0.5%." },
    ],
    recordingFeesFlat: 200,
  },
  MA: {
    state: "MA",
    stateName: "Massachusetts",
    titleInsuranceRate: 0.0045,
    titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "Deeds Excise Tax", rate: 0.00456, base: "price", party: "seller" },
    ],
    recordingFeesFlat: 175,
    notes: "Some municipalities (Boston, Cambridge, others) have proposed additional transfer taxes — verify locality.",
  },
  MN: {
    state: "MN",
    stateName: "Minnesota",
    titleInsuranceRate: 0.004,
    titleInsuranceParty: "split",
    transferTaxes: [
      { name: "State Deed Tax", rate: 0.0033, base: "price", party: "seller" },
    ],
    mortgageRecordingTax: { name: "Mortgage Registry Tax", rate: 0.0023, base: "loan", party: "buyer" },
    recordingFeesFlat: 100,
  },
  AZ: {
    state: "AZ",
    stateName: "Arizona",
    titleInsuranceRate: 0.0045,
    titleInsuranceParty: "split",
    transferTaxes: [
      { name: "Recording Fee (flat)", rate: 0, base: "price", party: "split", notes: "Arizona has no transfer tax — only nominal recording fees." },
    ],
    recordingFeesFlat: 30,
  },
  CO: {
    state: "CO",
    stateName: "Colorado",
    titleInsuranceRate: 0.005,
    titleInsuranceParty: "seller",
    transferTaxes: [
      { name: "Documentary Fee", rate: 0.0001, base: "price", party: "buyer", notes: "$0.01 per $100. Nominal — Colorado is essentially no-transfer-tax." },
    ],
    recordingFeesFlat: 50,
  },
  GA: {
    state: "GA",
    stateName: "Georgia",
    titleInsuranceRate: 0.0055,
    titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "Real Estate Transfer Tax", rate: 0.001, base: "price", party: "seller" },
    ],
    mortgageRecordingTax: { name: "Intangibles Tax on Mortgage", rate: 0.003, base: "loan", party: "buyer", notes: "$1.50 per $500 of loan amount; capped at $25K" },
    recordingFeesFlat: 50,
  },
  NC: {
    state: "NC",
    stateName: "North Carolina",
    titleInsuranceRate: 0.005,
    titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "Excise Tax on Conveyances", rate: 0.002, base: "price", party: "seller" },
    ],
    recordingFeesFlat: 75,
  },
  VA: {
    state: "VA",
    stateName: "Virginia",
    titleInsuranceRate: 0.005,
    titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "State Recordation Tax (Grantor)", rate: 0.001, base: "price", party: "seller" },
      { name: "State Recordation Tax (Grantee)", rate: 0.0025, base: "price", party: "buyer" },
      { name: "Local Recordation Tax", rate: 0.000833, base: "price", party: "buyer", notes: "1/3 of state grantee tax" },
    ],
    mortgageRecordingTax: { name: "Mortgage Recordation Tax", rate: 0.0025, base: "loan", party: "buyer", notes: "Plus local recordation = ~0.333% combined" },
    recordingFeesFlat: 100,
  },
  OH: {
    state: "OH",
    stateName: "Ohio",
    titleInsuranceRate: 0.0045,
    titleInsuranceParty: "split",
    transferTaxes: [
      { name: "Conveyance Fee", rate: 0.004, base: "price", party: "seller", notes: "$1 per $1,000 state + $3 per $1,000 county = ~0.4% combined" },
    ],
    recordingFeesFlat: 50,
  },
  MO: {
    state: "MO",
    stateName: "Missouri",
    titleInsuranceRate: 0.0045,
    titleInsuranceParty: "split",
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Missouri has no state transfer tax. Recording fees only.",
  },
};

// Generic fallback for states not in the table — uses national CRE averages.
export const DEFAULT_JURISDICTION: JurisdictionRates = {
  state: "—",
  stateName: "Other / Not Specified",
  titleInsuranceRate: 0.005,
  titleInsuranceParty: "split",
  transferTaxes: [
    { name: "Transfer Tax (estimated)", rate: 0.005, base: "price", party: "seller", notes: "National CRE average — verify with title company for actual state/local rates" },
  ],
  recordingFeesFlat: 100,
  notes: "Rates not specifically configured for this state. Showing national CRE averages.",
};

export function getJurisdiction(stateAbbr?: string | null): JurisdictionRates {
  if (!stateAbbr) return DEFAULT_JURISDICTION;
  const key = stateAbbr.toUpperCase().trim();
  return CLOSING_COSTS_BY_STATE[key] ?? DEFAULT_JURISDICTION;
}

export interface ClosingCostBreakdown {
  jurisdiction: JurisdictionRates;
  price: number;
  loan: number;
  lines: {
    name: string;
    rate: number;
    base: "price" | "loan";
    amount: number;
    buyer: number;
    seller: number;
    notes?: string;
  }[];
  totals: { buyer: number; seller: number; combined: number };
}

export function calculateClosingCosts(
  jurisdiction: JurisdictionRates,
  price: number,
  loan: number
): ClosingCostBreakdown {
  const lines: ClosingCostBreakdown["lines"] = [];
  const splitOf = (amount: number, party: Party): { buyer: number; seller: number } => {
    if (party === "buyer") return { buyer: amount, seller: 0 };
    if (party === "seller") return { buyer: 0, seller: amount };
    return { buyer: amount / 2, seller: amount / 2 };
  };

  // Title insurance (owner's policy)
  const titleAmt = price * jurisdiction.titleInsuranceRate;
  const titleSplit = splitOf(titleAmt, jurisdiction.titleInsuranceParty);
  lines.push({
    name: "Title Insurance (Owner's Policy)",
    rate: jurisdiction.titleInsuranceRate,
    base: "price",
    amount: titleAmt,
    buyer: titleSplit.buyer,
    seller: titleSplit.seller,
    notes: jurisdiction.titleInsuranceParty === "split" ? "Customarily split per local practice" : undefined,
  });

  // Transfer taxes
  for (const tx of jurisdiction.transferTaxes) {
    const base = tx.base === "loan" ? loan : price;
    const amt = base * tx.rate;
    const sp = splitOf(amt, tx.party);
    lines.push({ name: tx.name, rate: tx.rate, base: tx.base, amount: amt, buyer: sp.buyer, seller: sp.seller, notes: tx.notes });
  }

  // Mortgage recording tax (if applicable)
  if (jurisdiction.mortgageRecordingTax && loan > 0) {
    const mt = jurisdiction.mortgageRecordingTax;
    const amt = loan * mt.rate;
    const sp = splitOf(amt, mt.party);
    lines.push({ name: mt.name, rate: mt.rate, base: mt.base, amount: amt, buyer: sp.buyer, seller: sp.seller, notes: mt.notes });
  }

  // Recording fees (flat)
  lines.push({
    name: "Document Recording Fees (est.)",
    rate: 0,
    base: "price",
    amount: jurisdiction.recordingFeesFlat,
    buyer: jurisdiction.recordingFeesFlat,
    seller: 0,
  });

  const totalBuyer = lines.reduce((s, l) => s + l.buyer, 0);
  const totalSeller = lines.reduce((s, l) => s + l.seller, 0);
  return {
    jurisdiction,
    price,
    loan,
    lines,
    totals: { buyer: totalBuyer, seller: totalSeller, combined: totalBuyer + totalSeller },
  };
}
