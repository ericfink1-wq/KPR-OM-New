// GENERATED from official-source research (AK.auto.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: municipality. Local table complete: False.
// Local-level source: No Alaska statute imposes a deed/real-estate transfer tax (AS Title 29 municipal taxing powers; recording fees are flat per-document) (https://www.commerce.alaska.gov/web/dcra/OfficeoftheStateAssessor/TaxJurisdictions.aspx) as of 2026-09-24.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;



export const AK_LOCAL_LEVEL = "municipality" as const;
export const AK_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "No Alaska statute imposes a deed/real-estate transfer tax (AS Title 29 municipal taxing powers; recording fees are flat per-document)", sourceUrl: "https://www.commerce.alaska.gov/web/dcra/OfficeoftheStateAssessor/TaxJurisdictions.aspx", asOf: "2026-09-24",
  statement: "No state transfer tax. Research found no municipality or borough levying one. Alaska home-rule municipalities have broad taxing powers and the state's official local-tax list (DCRA 'Alaska Taxable') could not be retrieved — so no locality is treated as VERIFIED until it is.",
};

export const AK_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: false,
  muniAbsentMeansNone: false,
  entries: [],
};
