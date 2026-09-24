// GENERATED from official-source research (MA.auto.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: county. Local table complete: True.
// Local-level source: M.G.L. c.64D §1 (Barnstable proviso) + Barnstable County Registry fee schedule + Nantucket Land Bank (https://malegislature.gov/Laws/GeneralLaws/PartI/TitleIX/Chapter64D/Section1) as of 2026-09-24.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "Barnstable County Registry of Deeds — Fee Schedule & Recording Procedures";
const S1 = "https://www.capecod.gov/departments/registry-of-deeds/general-information/fee-schedule-recording-procedures/";
const S2 = "Nantucket Islands Land Bank — Transfer FAQ (Acts 1983 c.669)";
const S3 = "https://www.nantucketlandbank.org/filing/faq/";
const S4 = "Town of Brookline (MA) report 'Land Banks in Nantucket, Martha's Vineyard, and Cape Cod' (Acts 1985 c.736)";
const S5 = "https://www.brooklinema.gov/DocumentCenter/View/18488/HP-Report-on-Land-Banks-in-Massachusetts";

export const MA_LOCAL_LEVEL = "county" as const;
export const MA_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "M.G.L. c.64D §1 (Barnstable proviso) + Barnstable County Registry fee schedule + Nantucket Land Bank", sourceUrl: "https://malegislature.gov/Laws/GeneralLaws/PartI/TitleIX/Chapter64D/Section1", asOf: "2026-09-24",
  statement: "Only county-level variations exist: Barnstable County's reduced state rate + county excise, and the island land-bank fees (Nantucket County; Martha's Vineyard towns in Dukes County). No city/town deed transfer tax is enacted in MA (local-option transfer fees have been proposed but c.64D has no municipal levy).",
};

export const MA_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: true,
  muniAbsentMeansNone: false,
  entries: [
  { id: "ma-barnstable-county", kind: "county", name: "Barnstable County", county: "Barnstable County", replaces: ["ma-deeds-excise"], lines: [
      { name: "Deeds Excise — state portion in Barnstable (REPLACES the 0.456% statewide line)", rate: 0.00342, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2019-12-31", notes: "State $3.42/$1,000 (c.64D §1 $1.50/$500 + surtax)." },
      { name: "Barnstable County Deeds Excise", rate: 0.00306, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2019-12-31", notes: "County $3.06/$1,000; combined $6.48/$1,000 (multiply consideration by .00648)." }
    ] },
  { id: "ma-nantucket-county", kind: "county", name: "Nantucket County", county: "Nantucket County", lines: [
      { name: "Nantucket Islands Land Bank transfer fee", rate: 0.02, base: "price", party: "buyer", source: S2, sourceUrl: S3, asOf: "2026-01-01", notes: "'two percent of the purchase price'; 'the purchaser is responsible for payment'. In addition to the $4.56/$1,000 state excise." }
    ] },
  { id: "ma-dukes-county", kind: "county", name: "Dukes County", county: "Dukes County", lines: [
      { name: "Martha's Vineyard Land Bank fee", rate: 0.02, base: "price", party: "buyer", source: S4, sourceUrl: S5, asOf: "2026-09-24", notes: "2% of purchase price, buyer-paid, on transfers in the six Martha's Vineyard towns (Aquinnah, Chilmark, Edgartown, Oak Bluffs, Tisbury, West Tisbury). Gosnold (Elizabeth Islands, also Dukes County) is NOT in the MV Land Bank. The mvlandbank.com pages did not state the rate; the Dukes Registry page returned 403/503." }
    ] },
  ],
};
