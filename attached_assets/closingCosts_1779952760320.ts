// Customary commercial real estate closing cost data by state.
// Rates and party responsibility reflect typical CRE transactions; actual
// closing costs are negotiable per deal. Always verify with title company
// and counsel before relying on for an offer.
//
// Sources (compiled 2025-2026): ATTOM, ALTA, NCSL transfer tax tables,
// state department of revenue publications. Update annually.

export type Party = "buyer" | "seller" | "split";

export interface TaxLineItem {
  name: string;
  rate: number;             // decimal effective/representative rate (0.004 = 0.4%)
  rateMin?: number;         // sliding-scale low end
  rateMax?: number;         // sliding-scale high end
  base: "price" | "loan";
  party: Party;
  notes?: string;
}

export interface JurisdictionRates {
  state: string;
  stateName: string;
  titleInsuranceRate: number;
  titleInsuranceParty: Party;
  transferTaxes: TaxLineItem[];
  mortgageRecordingTax?: TaxLineItem;
  recordingFeesFlat: number;
  notes?: string;
}

// Default loan-to-value when a loan amount isn't supplied.
export const DEFAULT_LTV = 0.65;

export const CLOSING_COSTS_BY_STATE: Record<string, JurisdictionRates> = {
  NY: {
    state: "NY", stateName: "New York",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "NYS Real Estate Transfer Tax", rate: 0.004, base: "price", party: "seller" },
      { name: "NYS Mansion Tax (over $1M)", rate: 0.015, rateMin: 0.01, rateMax: 0.029, base: "price", party: "buyer", notes: "Only on deals over $1M; sliding 1% up to 2.9% at $25M+" },
      { name: "NYC Real Property Transfer Tax (commercial)", rate: 0.02625, rateMin: 0.01425, rateMax: 0.02625, base: "price", party: "seller", notes: "1.425% up to $500K, 2.625% above. Outside NYC, no city tax." },
    ],
    mortgageRecordingTax: { name: "Mortgage Recording Tax (NYC commercial)", rate: 0.028, rateMin: 0.0105, rateMax: 0.028, base: "loan", party: "buyer", notes: "2.8% on commercial loans > $500K in NYC; ~1.05% outside NYC." },
    recordingFeesFlat: 250,
    notes: "NYC has the highest combined transfer + mortgage taxes in the US. Verify locality — Upstate NY is far lower.",
  },
  NJ: {
    state: "NJ", stateName: "New Jersey",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "Realty Transfer Fee", rate: 0.0104, rateMin: 0.004, rateMax: 0.0104, base: "price", party: "seller", notes: "Sliding ~0.4% on first $150K up to 1.04% over $1M" },
      { name: "Mansion Tax (over $1M)", rate: 0.01, base: "price", party: "buyer" },
      { name: "Controlling Interest Transfer Tax", rate: 0.01, base: "price", party: "buyer", notes: "Entity sales > $1M of qualifying real property" },
    ],
    recordingFeesFlat: 200,
  },
  FL: {
    state: "FL", stateName: "Florida",
    titleInsuranceRate: 0.00575, titleInsuranceParty: "seller",
    transferTaxes: [
      { name: "Documentary Stamp Tax on Deed", rate: 0.007, base: "price", party: "seller", notes: "Higher in Miami-Dade (~0.6% surtax on non-single-family)" },
      { name: "Documentary Stamp Tax on Note", rate: 0.0035, base: "loan", party: "buyer" },
      { name: "Intangibles Tax on Mortgage", rate: 0.002, base: "loan", party: "buyer" },
    ],
    recordingFeesFlat: 100,
    notes: "Title insurance rates are promulgated (state-set). Customary split varies by county.",
  },
  CA: {
    state: "CA", stateName: "California",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    transferTaxes: [
      { name: "State Documentary Transfer Tax", rate: 0.0011, base: "price", party: "split", notes: "Split varies by county (NorCal split; SoCal seller)" },
      { name: "City/County Transfer Tax", rate: 0.0045, rateMin: 0.0011, rateMax: 0.06, base: "price", party: "split", notes: "Varies widely. SF 0.5%-6% sliding (Measure ULA); LA 0.45% + ULA 4-5.5% over $5M." },
    ],
    recordingFeesFlat: 125,
    notes: "California city/county transfer taxes vary dramatically — verify locality.",
  },
  IL: {
    state: "IL", stateName: "Illinois",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "seller",
    transferTaxes: [
      { name: "State Transfer Tax", rate: 0.001, base: "price", party: "seller" },
      { name: "County Transfer Tax", rate: 0.0005, base: "price", party: "seller" },
      { name: "Chicago Transfer Tax (where applicable)", rate: 0.0105, base: "price", party: "split", notes: "Chicago only: 0.75% buyer + 0.30% seller. Suburban: state+county only." },
    ],
    recordingFeesFlat: 100,
  },
  PA: {
    state: "PA", stateName: "Pennsylvania",
    titleInsuranceRate: 0.0055, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "State Realty Transfer Tax", rate: 0.01, base: "price", party: "split" },
      { name: "Local Transfer Tax", rate: 0.01, rateMin: 0.01, rateMax: 0.04, base: "price", party: "split", notes: "Most municipalities 1%. Philadelphia ~3.278% combined; Pittsburgh ~4%." },
    ],
    recordingFeesFlat: 100,
    notes: "PA customarily 50/50 buyer/seller split on transfer tax.",
  },
  TX: {
    state: "TX", stateName: "Texas",
    titleInsuranceRate: 0.0055, titleInsuranceParty: "seller",
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Texas has NO transfer or recording tax — one of the lowest-cost states for CRE closings.",
  },
  WA: {
    state: "WA", stateName: "Washington",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    transferTaxes: [
      { name: "Real Estate Excise Tax (REET)", rate: 0.0278, rateMin: 0.011, rateMax: 0.035, base: "price", party: "seller", notes: "Sliding 1.1% on first $525K up to 3% over $3.025M, plus local 0.25-0.5%." },
    ],
    recordingFeesFlat: 200,
  },
  MA: {
    state: "MA", stateName: "Massachusetts",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "Deeds Excise Tax", rate: 0.00456, base: "price", party: "seller" },
    ],
    recordingFeesFlat: 175,
    notes: "Some municipalities (Boston, Cambridge) have proposed additional transfer taxes — verify locality.",
  },
  MN: {
    state: "MN", stateName: "Minnesota",
    titleInsuranceRate: 0.004, titleInsuranceParty: "split",
    transferTaxes: [
      { name: "State Deed Tax", rate: 0.0033, base: "price", party: "seller" },
    ],
    mortgageRecordingTax: { name: "Mortgage Registry Tax", rate: 0.0023, base: "loan", party: "buyer" },
    recordingFeesFlat: 100,
  },
  AZ: {
    state: "AZ", stateName: "Arizona",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    transferTaxes: [],
    recordingFeesFlat: 30,
    notes: "Arizona has no transfer tax — only nominal recording fees.",
  },
  CO: {
    state: "CO", stateName: "Colorado",
    titleInsuranceRate: 0.005, titleInsuranceParty: "seller",
    transferTaxes: [
      { name: "Documentary Fee", rate: 0.0001, base: "price", party: "buyer", notes: "$0.01 per $100 — nominal; effectively no-transfer-tax." },
    ],
    recordingFeesFlat: 50,
  },
  GA: {
    state: "GA", stateName: "Georgia",
    titleInsuranceRate: 0.0055, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "Real Estate Transfer Tax", rate: 0.001, base: "price", party: "seller" },
    ],
    mortgageRecordingTax: { name: "Intangibles Tax on Mortgage", rate: 0.003, base: "loan", party: "buyer", notes: "$1.50 per $500 of loan; capped at $25K" },
    recordingFeesFlat: 50,
  },
  NC: {
    state: "NC", stateName: "North Carolina",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "Excise Tax on Conveyances", rate: 0.002, base: "price", party: "seller" },
    ],
    recordingFeesFlat: 75,
  },
  VA: {
    state: "VA", stateName: "Virginia",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "State Recordation Tax (Grantor)", rate: 0.001, base: "price", party: "seller" },
      { name: "State Recordation Tax (Grantee)", rate: 0.0025, base: "price", party: "buyer" },
      { name: "Local Recordation Tax", rate: 0.000833, base: "price", party: "buyer", notes: "1/3 of state grantee tax" },
    ],
    mortgageRecordingTax: { name: "Mortgage Recordation Tax", rate: 0.0025, base: "loan", party: "buyer", notes: "Plus local recordation ~0.333% combined" },
    recordingFeesFlat: 100,
  },
  OH: {
    state: "OH", stateName: "Ohio",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    transferTaxes: [
      { name: "Conveyance Fee", rate: 0.004, base: "price", party: "seller", notes: "$1/$1,000 state + ~$3/$1,000 county ~0.4% combined" },
    ],
    recordingFeesFlat: 50,
  },
  MO: {
    state: "MO", stateName: "Missouri",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Missouri has no state transfer tax. Recording fees only.",
  },
};

export const DEFAULT_JURISDICTION: JurisdictionRates = {
  state: "—", stateName: "Other / Not Specified",
  titleInsuranceRate: 0.005, titleInsuranceParty: "split",
  transferTaxes: [
    { name: "Transfer Tax (estimated)", rate: 0.005, rateMin: 0, rateMax: 0.02, base: "price", party: "seller", notes: "National CRE average — verify actual state/local rates" },
  ],
  recordingFeesFlat: 100,
  notes: "Rates not specifically configured for this state. Showing national CRE averages.",
};

export function getJurisdiction(stateAbbr?: string | null): JurisdictionRates {
  if (!stateAbbr) return DEFAULT_JURISDICTION;
  return CLOSING_COSTS_BY_STATE[stateAbbr.toUpperCase().trim()] ?? DEFAULT_JURISDICTION;
}

/** Format a rate for display: single %, sliding range, or flat fee. */
export function formatRate(item: { rate: number; rateMin?: number; rateMax?: number; base?: "price" | "loan" }): string {
  const pct = (r: number) => {
    const v = (r * 100).toFixed(r > 0 && r < 0.001 ? 4 : r < 0.01 ? 3 : 2);
    return `${v.replace(/\.?0+$/, "")}%`;
  };
  const baseLabel = item.base === "loan" ? " of loan" : item.base === "price" ? " of price" : "";
  if (item.rateMin != null && item.rateMax != null && item.rateMin !== item.rateMax) {
    return `${pct(item.rateMin)}-${pct(item.rateMax)}${baseLabel} (sliding)`;
  }
  if (item.rate === 0) return "flat fee";
  return `${pct(item.rate)}${baseLabel}`;
}

export interface ClosingCostLine {
  name: string;
  rate: number;
  rateMin?: number;
  rateMax?: number;
  base: "price" | "loan";
  party: Party;
  amount: number;
  buyer: number;
  seller: number;
  notes?: string;
}

export interface ClosingCostBreakdown {
  jurisdiction: JurisdictionRates;
  price: number;
  loan: number;
  lines: ClosingCostLine[];
  totals: { buyer: number; seller: number; combined: number };
}

export function calculateClosingCosts(jurisdiction: JurisdictionRates, price: number, loan: number): ClosingCostBreakdown {
  const lines: ClosingCostLine[] = [];
  const splitOf = (amount: number, party: Party) =>
    party === "buyer" ? { buyer: amount, seller: 0 }
    : party === "seller" ? { buyer: 0, seller: amount }
    : { buyer: amount / 2, seller: amount / 2 };

  const titleAmt = price * jurisdiction.titleInsuranceRate;
  const ts = splitOf(titleAmt, jurisdiction.titleInsuranceParty);
  lines.push({
    name: "Title Insurance (Owner's Policy)",
    rate: jurisdiction.titleInsuranceRate, base: "price", party: jurisdiction.titleInsuranceParty,
    amount: titleAmt, buyer: ts.buyer, seller: ts.seller,
    notes: jurisdiction.titleInsuranceParty === "split" ? "Customarily split per local practice" : undefined,
  });

  for (const tx of jurisdiction.transferTaxes) {
    const base = tx.base === "loan" ? loan : price;
    const amt = base * tx.rate;
    const sp = splitOf(amt, tx.party);
    lines.push({ name: tx.name, rate: tx.rate, rateMin: tx.rateMin, rateMax: tx.rateMax, base: tx.base, party: tx.party, amount: amt, buyer: sp.buyer, seller: sp.seller, notes: tx.notes });
  }

  if (jurisdiction.mortgageRecordingTax) {
    const mt = jurisdiction.mortgageRecordingTax;
    const amt = loan > 0 ? loan * mt.rate : 0;
    const sp = splitOf(amt, mt.party);
    lines.push({ name: mt.name, rate: mt.rate, rateMin: mt.rateMin, rateMax: mt.rateMax, base: mt.base, party: mt.party, amount: amt, buyer: sp.buyer, seller: sp.seller, notes: mt.notes });
  }

  lines.push({
    name: "Document Recording Fees (est.)",
    rate: 0, base: "price", party: "buyer",
    amount: jurisdiction.recordingFeesFlat, buyer: jurisdiction.recordingFeesFlat, seller: 0,
  });

  const totalBuyer = lines.reduce((s, l) => s + l.buyer, 0);
  const totalSeller = lines.reduce((s, l) => s + l.seller, 0);
  return { jurisdiction, price, loan, lines, totals: { buyer: totalBuyer, seller: totalSeller, combined: totalBuyer + totalSeller } };
}
