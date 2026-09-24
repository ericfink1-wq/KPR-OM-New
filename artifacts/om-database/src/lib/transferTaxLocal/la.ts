// GENERATED from official-source research (LA.auto.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: municipality. Local table complete: True.
// Local-level source: Orleans Parish Civil Clerk — Documentary Tax; La. Const. art. VII §2.3 (2011 Amendment 1, prohibiting new transfer taxes after 11/30/2011) (https://www.orleanscivilclerk.com/doctax.html) as of 2026-09-24.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "Orleans Parish Civil Clerk — Documentary Tax";
const S1 = "https://www.orleanscivilclerk.com/doctax.html";

export const LA_LOCAL_LEVEL = "municipality" as const;
export const LA_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "Orleans Parish Civil Clerk — Documentary Tax; La. Const. art. VII §2.3 (2011 Amendment 1, prohibiting new transfer taxes after 11/30/2011)", sourceUrl: "https://www.orleanscivilclerk.com/doctax.html", asOf: "2026-09-24",
  statement: "No state deed or mortgage tax. New taxes/fees on the sale or transfer of immovable property are constitutionally barred after 11/30/2011; the pre-existing New Orleans flat documentary tax is the only one.",
};

export const LA_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: false,
  muniAbsentMeansNone: true,
  placeBased: true,
  unincorporatedMeansNone: true,
  entries: [
  { id: "la-orleans-parish-new-orleans-city", kind: "municipal", name: "New Orleans city", county: "Orleans Parish", lines: [
      { name: "New Orleans Documentary Transaction Tax (flat)", rate: 0, base: "price", party: "seller", flatAmount: 325, source: S0, sourceUrl: S1, asOf: "2026-09-24", notes: "Flat $325.00 per document transferring real estate (and per mortgage >= $9,000); paid by 'the Seller, Donor, Mortgagor or party recording the commercial lease'. Model as a flat $325 fee, not a rate." }
    ] },
  ],
};
