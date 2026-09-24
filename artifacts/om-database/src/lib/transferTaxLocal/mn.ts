// GENERATED from official-source research (MN.prep.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: county. Local table complete: True.
// Local-level source: MN Dept of Revenue — Deed Tax Rate / Mortgage Tax Rate pages; Minn. Stat. 383A.80 (Ramsey) and 383B.80 (Hennepin) (https://www.revenue.state.mn.us/deed-tax-rate) as of 2026-09-24.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "MN Dept of Revenue — Deed Tax Rate";
const S1 = "https://www.revenue.state.mn.us/deed-tax-rate";
const S2 = "MN Dept of Revenue — Mortgage Tax Rate";
const S3 = "https://www.revenue.state.mn.us/mortgage-tax-rate";

export const MN_LOCAL_LEVEL = "county" as const;
export const MN_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "MN Dept of Revenue — Deed Tax Rate / Mortgage Tax Rate pages; Minn. Stat. 383A.80 (Ramsey) and 383B.80 (Hennepin)", sourceUrl: "https://www.revenue.state.mn.us/deed-tax-rate", asOf: "2026-09-24",
  statement: "DOR rate tables: \"State rate for all Minnesota counties 0.0033 ... Hennepin County (ERF Tax) 0.0001, Ramsey County (ERF Tax) 0.0001\"; example \"All other Minnesota Counties 0.0033\". The Environmental Response Fund surcharge is authorized only for Hennepin and Ramsey by county-specific statutes, so no other county levies one.",
};

export const MN_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: true,
  muniAbsentMeansNone: false,
  entries: [
  { id: "mn-hennepin-county", kind: "county", name: "Hennepin County", county: "Hennepin County", lines: [
      { name: "Environmental Response Fund Deed Tax — Hennepin County", rate: 0.0001, base: "price", party: "seller", effectiveUntil: "2036-01-01", source: S0, sourceUrl: S1, asOf: "2026-09-24", notes: "Additional 0.0001 (0.01%) of net consideration in Hennepin County (Minn. Stat. 383B.80); total deed tax 0.34%. Follows the deed tax → seller. Authority expires 1/1/2036 (extended from 1/1/2028 by Laws 2026, ch. 128, art. 8, §§8–9)." },
      { name: "Environmental Response Fund Mortgage Tax — Hennepin County", rate: 0.0001, base: "loan", party: "buyer", effectiveUntil: "2036-01-01", source: S2, sourceUrl: S3, asOf: "2026-09-24", notes: "Additional 0.0001 (0.01%) of debt secured in Hennepin County (Minn. Stat. 383B.80); total mortgage tax 0.24%. Borrower pays. Authority expires 1/1/2036 (extended from 1/1/2028 by Laws 2026, ch. 128, art. 8, §§8–9)." }
    ] },
  { id: "mn-ramsey-county", kind: "county", name: "Ramsey County", county: "Ramsey County", lines: [
      { name: "Environmental Response Fund Deed Tax — Ramsey County", rate: 0.0001, base: "price", party: "seller", effectiveUntil: "2036-01-01", source: S0, sourceUrl: S1, asOf: "2026-09-24", notes: "Additional 0.0001 (0.01%) of net consideration in Ramsey County (Minn. Stat. 383A.80); total deed tax 0.34%. Follows the deed tax → seller. Authority expires 1/1/2036 (extended from 1/1/2028 by Laws 2026, ch. 128, art. 8, §§8–9)." },
      { name: "Environmental Response Fund Mortgage Tax — Ramsey County", rate: 0.0001, base: "loan", party: "buyer", effectiveUntil: "2036-01-01", source: S2, sourceUrl: S3, asOf: "2026-09-24", notes: "Additional 0.0001 (0.01%) of debt secured in Ramsey County (Minn. Stat. 383A.80); total mortgage tax 0.24%. Borrower pays. Authority expires 1/1/2036 (extended from 1/1/2028 by Laws 2026, ch. 128, art. 8, §§8–9)." }
    ] },
  ],
};
