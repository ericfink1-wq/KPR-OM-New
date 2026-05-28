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

// ── Portfolio states (splits per Fidelity Aug-2025; rates per statute) ──────────
export const CLOSING_COSTS_BY_STATE: Record<string, JurisdictionRates> = {

  NJ: {
    state: "NJ", stateName: "New Jersey", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "Realty Transfer Fee (RTF)", rate: 0.0121, rateMin: 0.004, rateMax: 0.0121, base: "price", party: "seller",
        notes: "Graduated; ~0.4% on first $150K rising to ~1.21% effective on high-value consideration. Seller pays." },
      { name: "Mansion Tax / Supplemental RTF", rate: 0.035, rateMin: 0.01, rateMax: 0.035, base: "price", party: "seller",
        tiers: [
          { over: 1000000, rate: 0.01 },
          { over: 2000000, rate: 0.02 },
          { over: 2500000, rate: 0.025 },
          { over: 3000000, rate: 0.03 },
          { over: 3500000, rate: 0.035 },
        ],
        notes: "Effective 2025-07-10: SELLER now pays (was buyer), tiered 1%-3.5% applied to the ENTIRE price, over $1M. Class 4A commercial included. Each tier rate applies to the whole consideration." },
      { name: "Controlling Interest Transfer Tax (entity sales only)", rate: 0.035, rateMin: 0.01, rateMax: 0.035, base: "price", party: "seller", entitySaleOnly: true,
        tiers: [
          { over: 1000000, rate: 0.01 }, { over: 2000000, rate: 0.02 }, { over: 2500000, rate: 0.025 },
          { over: 3000000, rate: 0.03 }, { over: 3500000, rate: 0.035 },
        ],
        notes: "Only applies to transfer of a controlling interest in an entity owning Class 4 commercial property (not a standard deed/asset sale). Now seller-paid, mirrors mansion-tax tiers." },
    ],
    recordingFeesFlat: 200,
    notes: "NJ mansion tax was overhauled effective 2025-07-10 — shifted to seller and raised to a tiered 1%-3.5% on the entire price. On a high-value commercial sale the seller's combined transfer burden approaches 4.5-4.7%. Fidelity's Aug-2025 customs chart still showed buyer-paid; the statute governs.",
  },

  CT: {
    state: "CT", stateName: "Connecticut", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "State Real Estate Conveyance Tax", rate: 0.0125, rateMin: 0.0075, rateMax: 0.0225, base: "price", party: "seller",
        tiers: [ { over: 0, rate: 0.0075 }, { over: 800000, rate: 0.0125 }, { over: 2500000, rate: 0.0225 } ],
        notes: "Tiered: 0.75% to $800K, 1.25% $800K-$2.5M, 2.25% over $2.5M (residential mansion bracket; commercial generally 1.25%). Seller pays." },
      { name: "Municipal Conveyance Tax", rate: 0.0025, rateMin: 0.0025, rateMax: 0.005, base: "price", party: "seller",
        notes: "0.25% base; eligible 'targeted investment' municipalities up to 0.5%. Seller pays." },
    ],
    recordingFeesFlat: 100,
    notes: "Seller pays state + municipal conveyance tax (Fidelity Aug-2025). Title insurance buyer-paid.",
  },

  MO: {
    state: "MO", stateName: "Missouri", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "seller",
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Missouri imposes NO deed transfer tax and NO mortgage tax (Fidelity Aug-2025). Essentially just title + recording fees — one of the lowest-cost states. Owner's policy customarily seller-paid (varies locally).",
  },

  IN: {
    state: "IN", stateName: "Indiana", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "seller",
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "Indiana imposes NO deed transfer tax and NO mortgage tax (Fidelity Aug-2025). Owner's policy customarily seller-paid; closing fees usually split 50/50.",
  },

  PA: {
    state: "PA", stateName: "Pennsylvania", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0055, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "State Realty Transfer Tax", rate: 0.01, base: "price", party: "split", notes: "1% state. Customarily split 50/50 buyer/seller." },
      { name: "Local Realty Transfer Tax", rate: 0.01, rateMin: 0.01, rateMax: 0.04, base: "price", party: "split",
        notes: "Most municipalities ~1% (split). Philadelphia ~3.278% total; Pittsburgh ~4%. Split 50/50 by custom." },
    ],
    recordingFeesFlat: 100,
    notes: "Transfer tax customarily divided equally (Fidelity Aug-2025). Title premium is all-inclusive (PA filed rate).",
  },

  OH: {
    state: "OH", stateName: "Ohio", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    transferTaxes: [
      { name: "Real Property Conveyance Fee", rate: 0.004, rateMin: 0.001, rateMax: 0.004, base: "price", party: "seller",
        notes: "$1/$1,000 state (0.1%) + county permissive up to $3/$1,000 (0.3%) = ~0.4% typical. Seller pays." },
    ],
    recordingFeesFlat: 50,
    notes: "Conveyance fee seller-paid; title premium often split (Fidelity Aug-2025).",
  },

  AL: {
    state: "AL", stateName: "Alabama", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    transferTaxes: [
      { name: "Deed Recordation Tax", rate: 0.001, base: "price", party: "buyer", notes: "$0.50 per $500 = 0.1%. Buyer pays (can be negotiated)." },
    ],
    mortgageRecordingTax: { name: "Mortgage Recordation Tax", rate: 0.0015, base: "loan", party: "buyer", notes: "$0.15 per $100 = 0.15% of loan. Buyer pays." },
    recordingFeesFlat: 50,
    notes: "Deed and mortgage tax both buyer-paid (Fidelity Aug-2025). Owner's policy negotiable; seller customary in Jefferson/Shelby counties.",
  },

  MN: {
    state: "MN", stateName: "Minnesota", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.004, titleInsuranceParty: "split",
    transferTaxes: [
      { name: "State Deed Tax", rate: 0.0033, base: "price", party: "seller", notes: "0.33% of price. Seller pays." },
    ],
    mortgageRecordingTax: { name: "Mortgage Registry Tax", rate: 0.0023, base: "loan", party: "buyer", notes: "0.23% of loan. Buyer pays." },
    recordingFeesFlat: 100,
    notes: "Deed tax seller-paid, mortgage registry tax buyer-paid (Fidelity Aug-2025).",
  },

  NC: {
    state: "NC", stateName: "North Carolina", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "Excise Tax on Conveyances", rate: 0.002, base: "price", party: "seller", notes: "$1 per $500 = 0.2%. Seller pays. A few counties add a local land transfer tax." },
    ],
    recordingFeesFlat: 75,
    notes: "Excise tax seller-paid; title insurance buyer-paid (Fidelity Aug-2025).",
  },

  VA: {
    state: "VA", stateName: "Virginia", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "State Recordation Tax (Grantee)", rate: 0.0025, base: "price", party: "buyer", notes: "~0.25% state, buyer (grantee) pays." },
      { name: "Local Recordation Tax (Grantee)", rate: 0.000833, base: "price", party: "buyer", notes: "1/3 of state grantee tax; buyer." },
      { name: "Grantor Tax", rate: 0.001, base: "price", party: "seller", notes: "~0.1% ($1 per $1,000); seller (grantor) pays. NoVA localities add a regional WMATA grantor tax." },
    ],
    mortgageRecordingTax: { name: "Recordation Tax on Deed of Trust", rate: 0.0025, base: "loan", party: "buyer", notes: "~0.25% state + local on the financing; buyer pays." },
    recordingFeesFlat: 100,
    notes: "Split grantor/grantee structure: buyer pays grantee + mortgage recordation, seller pays grantor tax (Fidelity Aug-2025).",
  },

  WV: {
    state: "WV", stateName: "West Virginia", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "State + County Excise Tax", rate: 0.0044, rateMin: 0.0022, rateMax: 0.0055, base: "price", party: "seller",
        notes: "$1.10 per $500 state (0.22%) + county may impose an equal or greater amount; ~0.44% typical. Seller's obligation (buyer can pay)." },
    ],
    recordingFeesFlat: 75,
    notes: "Excise tax seller-paid; title insurance buyer-paid (Fidelity Aug-2025).",
  },

  IL: {
    state: "IL", stateName: "Illinois", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "seller",
    transferTaxes: [
      { name: "State Transfer Tax", rate: 0.001, base: "price", party: "seller", notes: "$0.50 per $500 = 0.1%. Seller pays." },
      { name: "County Transfer Tax", rate: 0.0005, base: "price", party: "seller", notes: "$0.25 per $500 = 0.05%. Customarily seller." },
      { name: "Municipal Transfer Tax (where applicable)", rate: 0.0105, rateMin: 0, rateMax: 0.0105, base: "price", party: "split",
        notes: "Varies by municipality. Chicago 1.05% (0.75% buyer + 0.30% seller). Many suburbs have none." },
    ],
    recordingFeesFlat: 100,
    notes: "State + county seller-paid; municipal varies (Fidelity Aug-2025). Title premium seller-paid.",
  },

  MD: {
    state: "MD", stateName: "Maryland", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "State Transfer Tax", rate: 0.005, base: "price", party: "split", notes: "0.5% state. Split equally by custom on commercial." },
      { name: "County/Local Transfer Tax", rate: 0.01, rateMin: 0, rateMax: 0.015, base: "price", party: "split",
        notes: "Varies by county (0%-1.5%). Split equally by custom." },
    ],
    mortgageRecordingTax: { name: "Recordation Tax", rate: 0.0075, rateMin: 0.005, rateMax: 0.012, base: "loan", party: "split",
      notes: "Per-$ recordation tax varies by county (~$5-$12 per $1,000). Split equally by custom." },
    recordingFeesFlat: 100,
    notes: "Transfer AND recordation tax customarily SPLIT EQUALLY (Fidelity Aug-2025) — unusual; most states assign each to one party. Title insurance buyer-paid.",
  },

  CO: {
    state: "CO", stateName: "Colorado", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "seller",
    transferTaxes: [
      { name: "Documentary Fee", rate: 0.0001, base: "price", party: "buyer", notes: "$0.01 per $100 = 0.01%. Nominal. Buyer pays. (A few home-rule towns levy a separate local transfer tax.)" },
    ],
    recordingFeesFlat: 50,
    notes: "Colorado's documentary fee is nominal (0.01%) — effectively a no-transfer-tax state (Fidelity Aug-2025). Owner's policy seller-paid.",
  },

  MA: {
    state: "MA", stateName: "Massachusetts", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "Deeds Excise Tax", rate: 0.00456, base: "price", party: "seller", notes: "$4.56 per $1,000 = 0.456%. Seller pays. Barnstable County and the islands differ." },
    ],
    recordingFeesFlat: 175,
    notes: "Deeds excise seller-paid; title insurance buyer-paid (Fidelity Aug-2025). Some municipalities have proposed local transfer fees — verify locality.",
  },

  // ── Other common CRE states (kept for coverage; splits per Fidelity Aug-2025) ──
  NY: {
    state: "NY", stateName: "New York", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.005, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "NYS Real Estate Transfer Tax", rate: 0.004, base: "price", party: "seller", notes: "0.4% state. Seller pays (unless negotiated)." },
      { name: "NYS Mansion Tax (over $1M)", rate: 0.029, rateMin: 0.01, rateMax: 0.029, base: "price", party: "buyer",
        tiers: [ { over: 1000000, rate: 0.01 }, { over: 2000000, rate: 0.0125 }, { over: 3000000, rate: 0.015 },
                 { over: 5000000, rate: 0.0225 }, { over: 10000000, rate: 0.0325 }, { over: 25000000, rate: 0.029 } ],
        notes: "Buyer-paid, tiered 1%-3.9% (NYC brackets). Primarily residential; verify applicability to commercial." },
      { name: "NYC Real Property Transfer Tax (commercial)", rate: 0.02625, rateMin: 0.01425, rateMax: 0.02625, base: "price", party: "seller",
        notes: "NYC only: 1.425% up to $500K, 2.625% above. Seller pays. No city tax outside NYC." },
    ],
    mortgageRecordingTax: { name: "Mortgage Recording Tax (NYC commercial)", rate: 0.028, rateMin: 0.0105, rateMax: 0.028, base: "loan", party: "buyer",
      notes: "NYC commercial 2.8% on loans >$500K; ~1.05% in much of upstate. Buyer pays." },
    recordingFeesFlat: 250,
    notes: "Highest combined transfer + mortgage taxes in the US in NYC. Verify locality — upstate rates are far lower.",
  },
  FL: {
    state: "FL", stateName: "Florida", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.00575, titleInsuranceParty: "seller",
    transferTaxes: [
      { name: "Documentary Stamp Tax on Deed", rate: 0.007, base: "price", party: "seller", notes: "0.7% ($0.70 per $100). Seller pays. Miami-Dade differs." },
      { name: "Doc Stamp Tax on Note", rate: 0.0035, base: "loan", party: "buyer", notes: "0.35% of loan. Buyer." },
      { name: "Intangible Tax on Mortgage", rate: 0.002, base: "loan", party: "buyer", notes: "0.2% of loan. Buyer." },
    ],
    recordingFeesFlat: 100,
    notes: "Promulgated title rates. Owner's policy commercial: negotiable.",
  },
  CA: {
    state: "CA", stateName: "California", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    transferTaxes: [
      { name: "County Documentary Transfer Tax", rate: 0.0011, base: "price", party: "seller", notes: "0.11% ($1.10 per $1,000). Seller pays customarily." },
      { name: "City Transfer Tax (where applicable)", rate: 0.0045, rateMin: 0.0011, rateMax: 0.06, base: "price", party: "split",
        notes: "Varies hugely. SF 0.5%-6% sliding; LA Measure ULA 4%-5.5% over $5M; many cities none." },
    ],
    recordingFeesFlat: 125,
    notes: "City/county transfer taxes vary dramatically — verify locality (SF, LA have large mansion-style taxes).",
  },
  TX: {
    state: "TX", stateName: "Texas", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0055, titleInsuranceParty: "seller",
    transferTaxes: [],
    recordingFeesFlat: 50,
    notes: "No transfer or mortgage tax. Promulgated title rates; owner's policy seller-paid.",
  },
  WA: {
    state: "WA", stateName: "Washington", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    transferTaxes: [
      { name: "Real Estate Excise Tax (REET)", rate: 0.03, rateMin: 0.011, rateMax: 0.035, base: "price", party: "seller",
        tiers: [ { over: 0, rate: 0.011 }, { over: 525000, rate: 0.0128 }, { over: 1525000, rate: 0.0275 }, { over: 3025000, rate: 0.03 } ],
        notes: "State REET tiered 1.1%-3% + local 0.25-0.5%. Seller's obligation." },
    ],
    recordingFeesFlat: 200,
    notes: "Seller pays REET (Fidelity Aug-2025).",
  },
  GA: {
    state: "GA", stateName: "Georgia", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0055, titleInsuranceParty: "buyer",
    transferTaxes: [
      { name: "Real Estate Transfer Tax", rate: 0.001, base: "price", party: "seller", notes: "$1 per $1,000 = 0.1%. Commercial split negotiable." },
    ],
    mortgageRecordingTax: { name: "Intangible Recording Tax", rate: 0.003, base: "loan", party: "buyer", notes: "$1.50 per $500 = 0.3% of loan, capped at $25K. Buyer." },
    recordingFeesFlat: 50,
  },
  AZ: {
    state: "AZ", stateName: "Arizona", ratesAsOf: "2026-05",
    titleInsuranceRate: 0.0045, titleInsuranceParty: "split",
    transferTaxes: [],
    recordingFeesFlat: 30,
    notes: "No transfer or mortgage tax — only nominal recording fees (Fidelity Aug-2025).",
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
