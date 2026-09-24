// GENERATED from official-source research (NC.auto.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: county. Local table complete: True.
// Local-level source: Perquimans County Tax Administrator — Land Transfer Tax (https://www.perquimanscountync.gov/land-transfer-tax) as of 2026-09-24.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "Dare County — Land Transfer Tax";
const S1 = "https://tax.darecountync.gov/landtransfer/";
const S2 = "Perquimans County Tax Administrator — Land Transfer Tax";
const S3 = "https://www.perquimanscountync.gov/land-transfer-tax";
const F0 = (rate: number, notes?: string): TaxLineItem => ({ name: "Local Land Transfer Tax (local act)", rate, base: "price", party: "seller", source: S2, sourceUrl: S3, asOf: "2026-09-24", ...(notes ? { notes } : {}) });

export const NC_LOCAL_LEVEL = "county" as const;
export const NC_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "Perquimans County Tax Administrator — Land Transfer Tax", sourceUrl: "https://www.perquimanscountync.gov/land-transfer-tax", asOf: "2026-09-24",
  statement: "Exactly seven counties levy a 1% local land transfer tax under 1980s local acts; the 2007 Article 60 local-option LTT was repealed in 2011 and all referendums failed.",
};

export const NC_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: true,
  muniAbsentMeansNone: false,
  entries: [
  { id: "nc-camden-county", kind: "county", name: "Camden County", county: "Camden County", lines: [
      F0(0.01, "$1.00 per $100 (1%). Perquimans: 'one of only seven counties ... The other counties that levy a land transfer tax are: Camden, Chowan, Currituck, Dare, Pasquotank and Washington.' Also applies to leases >10 yrs incl. options. Payer customarily grantor — confirm local act.")
    ] },
  { id: "nc-chowan-county", kind: "county", name: "Chowan County", county: "Chowan County", lines: [
      F0(0.01, "$1.00 per $100 (1%). Perquimans: 'one of only seven counties ... The other counties that levy a land transfer tax are: Camden, Chowan, Currituck, Dare, Pasquotank and Washington.' Also applies to leases >10 yrs incl. options. Payer customarily grantor — confirm local act.")
    ] },
  { id: "nc-currituck-county", kind: "county", name: "Currituck County", county: "Currituck County", lines: [
      F0(0.01, "$1.00 per $100 (1%). Perquimans: 'one of only seven counties ... The other counties that levy a land transfer tax are: Camden, Chowan, Currituck, Dare, Pasquotank and Washington.' Also applies to leases >10 yrs incl. options. Payer customarily grantor — confirm local act.")
    ] },
  { id: "nc-dare-county", kind: "county", name: "Dare County", county: "Dare County", lines: [
      { name: "Local Land Transfer Tax (local act)", rate: 0.01, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2026-09-24", notes: "$1.00 per $100 (1%). Perquimans: 'one of only seven counties ... The other counties that levy a land transfer tax are: Camden, Chowan, Currituck, Dare, Pasquotank and Washington.' Also applies to leases >10 yrs incl. options. Payer customarily grantor — confirm local act." }
    ] },
  { id: "nc-pasquotank-county", kind: "county", name: "Pasquotank County", county: "Pasquotank County", lines: [
      F0(0.01, "$1.00 per $100 (1%). Perquimans: 'one of only seven counties ... The other counties that levy a land transfer tax are: Camden, Chowan, Currituck, Dare, Pasquotank and Washington.' Also applies to leases >10 yrs incl. options. Payer customarily grantor — confirm local act.")
    ] },
  { id: "nc-perquimans-county", kind: "county", name: "Perquimans County", county: "Perquimans County", lines: [
      F0(0.01, "$1.00 per $100 (1%). Perquimans: 'one of only seven counties ... The other counties that levy a land transfer tax are: Camden, Chowan, Currituck, Dare, Pasquotank and Washington.' Also applies to leases >10 yrs incl. options. Payer customarily grantor — confirm local act.")
    ] },
  { id: "nc-washington-county", kind: "county", name: "Washington County", county: "Washington County", lines: [
      F0(0.01, "$1.00 per $100 (1%). Perquimans: 'one of only seven counties ... The other counties that levy a land transfer tax are: Camden, Chowan, Currituck, Dare, Pasquotank and Washington.' Also applies to leases >10 yrs incl. options. Payer customarily grantor — confirm local act.")
    ] },
  ],
};
