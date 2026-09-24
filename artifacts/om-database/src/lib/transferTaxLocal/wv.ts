// GENERATED from official-source research (WV.auto.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: county. Local table complete: False.
// Local-level source: W. Va. Code §11-22-2(b); 110 CSR 22 (WV State Tax Dept rule) (https://tax.wv.gov/Documents/ProposedRules/PropertyTransferTax.110-CSR-22.pdf) as of 2026-09-24.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "Cabell County Clerk — Recording Department";
const S1 = "https://www.cabellcountyclerk.org/departments/recording/index.php";

export const WV_LOCAL_LEVEL = "county" as const;
export const WV_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "W. Va. Code §11-22-2(b); 110 CSR 22 (WV State Tax Dept rule)", sourceUrl: "https://tax.wv.gov/Documents/ProposedRules/PropertyTransferTax.110-CSR-22.pdf", asOf: "2026-09-24",
  statement: "The additional excise is set per county at $0.55, $1.10 or $1.65 per $500; no municipal levy.",
};

export const WV_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: false,
  muniAbsentMeansNone: false,
  unverifiedRange: {
    county: { minRate: 0, maxRate: 0.0022, party: "seller", note: "WV county add-on beyond the statutory $0.55/$500 minimum: 0% to 0.22% (counties may set $0.55, $1.10 or $1.65 per $500 — 110 CSR 22 §3)" },
  },
  entries: [
  { id: "wv-cabell-county", kind: "county", name: "Cabell County", county: "Cabell County", lines: [
      { name: "Additional County Excise (Cabell) — increment over the 0.11% minimum", rate: 0.0022, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2026-09-24", notes: "Clerk: 'Transfer Tax Fee is $5.50 for every $1,000.00 of the purchase price' = 0.55% total = $1.10 base + $1.65 county per $500 (this line = the $1.10/$500 above the $0.55 minimum line)." }
    ] },
  ],
};
