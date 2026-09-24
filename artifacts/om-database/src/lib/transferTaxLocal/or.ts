// GENERATED from official-source research (OR.auto.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: county. Local table complete: False.
// Local-level source: ORS 306.815 (Oregon Legislature) (https://www.oregonlegislature.gov/bills_laws/ors/ors306.html) as of 2026-09-24.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "Washington County (OR) Assessment & Taxation — Transfer Tax Exemption & Application Forms";
const S1 = "https://www.washingtoncountyor.gov/at/recording/transfer-tax-exemption";

export const OR_LOCAL_LEVEL = "county" as const;
export const OR_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "ORS 306.815 (Oregon Legislature)", sourceUrl: "https://www.oregonlegislature.gov/bills_laws/ors/ors306.html", asOf: "2026-09-24",
  statement: "ORS 306.815(1) bars any city, county or district from taxing the transfer of a fee estate; (4) grandfathers only taxes in effect and operative on March 31, 1997 — Washington County's is the one such tax.",
};

export const OR_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: true,
  muniAbsentMeansNone: false,
  entries: [
  { id: "or-washington-county", kind: "county", name: "Washington County", county: "Washington County", lines: [
      { name: "Washington County Real Property Transfer Tax", rate: 0.001, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2026-09-24", notes: "'one dollar per thousand dollars of the selling price' = 0.10%; transfers with selling price ≤ $13,999 exempt; 'Liability for the tax is between the purchaser and seller' (allocate in PSA). Due within 15 days of recording." }
    ] },
  ],
};
