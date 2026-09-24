// Shared types for the closing-cost / transfer-tax engine (closingCosts.ts) and the
// per-state local tables in ./transferTaxLocal/. Kept in their own module so the
// big local data tables can import them without a circular import.

export type Party = "buyer" | "seller" | "split";

export interface TaxTier {
  over: number;   // applies when the base exceeds this amount (tiers ascending)
  rate: number;   // CLIFF tiers (`tiers`): rate on the ENTIRE base; MARGINAL (`marginalTiers`): rate on the slice above `over`
}

export interface TitleBracket {
  over: number;     // bracket starts when price exceeds this amount
  base: number;     // flat premium accrued up to this bracket
  per1000: number;  // rate (dollars per $1,000 of price above `over`)
}

export interface TitleSchedule {
  source: string;
  asOf: string;          // YYYY-MM-DD — when this schedule was effective / verified
  promulgated: boolean;
  minPremium?: number;
  brackets: TitleBracket[];
}

/** Every rate line carries its own citation. A test fails the build if any line lacks one. */
export interface SourceRef {
  source: string;        // who publishes the rate (statute / DOR / county / ordinance)
  sourceUrl?: string;
  asOf: string;          // YYYY-MM-DD — effective / published date of the SOURCE
}

export interface TaxLineItem extends SourceRef {
  id?: string;           // stable id so a local entry can `replace` a state line
  name: string;
  rate: number;
  rateMin?: number;
  rateMax?: number;
  tiers?: TaxTier[];         // CLIFF: bracket rate applies to the whole base (never stack alternatives — one line per tax)
  marginalTiers?: TaxTier[]; // GRADUATED: each rate applies only to its slice
  base: "price" | "loan";
  party: Party;
  /** A flat dollar fee per transfer instead of a rate (e.g. an IL village's $50 stamp). */
  flatAmount?: number;
  entitySaleOnly?: boolean;
  residentialOnly?: boolean; // suppress on commercial (non-residential) deals
  verify?: boolean;          // best-effort / pending change — flag prominently, confirm with title
  /** YYYY-MM-DD — line applies only to closings ON/AFTER this date (scheduled rate changes). */
  effectiveFrom?: string;
  /** YYYY-MM-DD — line applies only to closings BEFORE this date (superseded by a scheduled change). */
  effectiveUntil?: string;
  notes?: string;
}

/**
 * The level of government that sets LOCAL transfer taxes in a state.
 *   none                 — no local transfer tax anywhere (positively confirmed, cited)
 *   county               — set by the county (MD, NV, OH, WV, FL-Miami-Dade, MN surcharge…)
 *   municipality         — set by the city/town (CT, CA, WA, CO…)
 *   municipality+school  — municipality AND school district (PA)
 *   county+municipality  — both layers can apply (IL, NY…)
 */
export type LocalLevel = "none" | "county" | "municipality" | "municipality+school" | "county+municipality";

export interface LocalEntry {
  id: string;
  kind: "county" | "municipal";
  name: string;              // display name ("Whitpain Township", "Cook County")
  county?: string;           // Census county name; for municipal entries restricts the match to that county
  match?: string[];          // extra normalized names (Census subdivision/place spellings) that mean this jurisdiction
  schoolDistrict?: string;   // PA: the school district half of a muni+SD pair
  replaces?: string[];       // ids of STATE lines this locality supersedes (e.g. Miami-Dade doc stamps)
  lines: TaxLineItem[];      // [] = positively confirmed: no local tax here
}

export interface LocalTaxTable {
  /** County layer: when a county is NOT listed, is that positive proof of no county tax? */
  countyAbsentMeansNone: boolean;
  /** Municipal layer: when a town is NOT listed, is that positive proof of no municipal tax? */
  muniAbsentMeansNone: boolean;
  /**
   * Municipal matching uses ONLY the Census incorporated place (the county
   * subdivisions in these states are statistical, not taxing governments). A
   * location with no incorporated place matches the county's entry whose
   * `match` includes "unincorporated".
   */
  placeBased?: boolean;
  /** Only with placeBased: a location outside every incorporated place positively owes no municipal tax. */
  unincorporatedMeansNone?: boolean;
  /**
   * Localities we KNOW levy (or may levy) a tax we could not confirm from an official
   * source. A property there is always UNVERIFIED, shown as a 0–maxRate range — so a
   * gap in our research can never read as "no tax".
   */
  /**
   * When a layer can't be resolved and the listed entries don't span every possibility
   * (e.g. WV: only some counties' add-on is officially confirmed), the honest range for
   * that layer. Replaces the range computed from the listed candidates.
   */
  unverifiedRange?: Partial<Record<"county" | "municipal", { minRate: number; maxRate: number; party: Party; note: string }>>;
  knownGaps?: Array<{ name: string; county?: string; kind?: "county" | "municipal"; reason: string; maxRate: number; party: Party }>;
  entries: LocalEntry[];
}

export interface JurisdictionRates {
  state: string;
  stateName: string;
  /** YYYY-MM-DD the state's rates were last checked against the cited sources. >12 months → stale warning. */
  ratesAsOf: string;
  titleInsuranceRate: number;
  titleInsuranceParty: Party;
  titleSchedule?: TitleSchedule;
  transferTaxes: TaxLineItem[];      // STATE-level lines (apply everywhere in the state)
  mortgageRecordingTax?: TaxLineItem;
  recordingFeesFlat: number;
  localLevel: LocalLevel;
  /** Citation for the local-level claim — including "no local tax". */
  localLevelSource: SourceRef & { statement: string };
  local?: LocalTaxTable;
  notes?: string;
}

export interface ResolvedJurisdiction {
  matched: boolean;
  matchedAddress?: string | null;
  state?: string | null;
  county?: string | null;
  municipality?: string | null;
  place?: string | null;
  schoolDistrict?: string | null;
  lat?: number | null;
  lng?: number | null;
  source?: string;
}
