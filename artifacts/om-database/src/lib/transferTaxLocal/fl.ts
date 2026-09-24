// GENERATED from official-source research (FL.auto.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: county. Local table complete: True.
// Local-level source: Fla. Stat. §201.031 (http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0200-0299/0201/Sections/0201.031.html) as of 2026-09-24.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "FL DOR GT-800014";
const S1 = "https://floridarevenue.com/Forms_library/current/gt800014.pdf";
const S2 = "Fla. Stat. §201.031; FL DOR GT-800014";

export const FL_LOCAL_LEVEL = "county" as const;
export const FL_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "Fla. Stat. §201.031", sourceUrl: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0200-0299/0201/Sections/0201.031.html", asOf: "2026-09-24",
  statement: "Only a county defined by s.125.011(1) (Miami-Dade) may levy the discretionary deed surtax; every other county uses the state rate.",
};

export const FL_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: true,
  muniAbsentMeansNone: false,
  entries: [
  { id: "fl-miami-dade-county", kind: "county", name: "Miami-Dade County", county: "Miami-Dade County", replaces: ["fl-deed-stamps"], lines: [
      { name: "Deed doc stamps — Miami-Dade reduced state rate (REPLACES 0.70%)", rate: 0.006, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2017-12-01", notes: "'$.60 per $100' in Miami-Dade." },
      { name: "Miami-Dade Discretionary Surtax (non-single-family)", rate: 0.0045, base: "price", party: "seller", source: S2, sourceUrl: S1, asOf: "2017-12-01", notes: "'$.60 plus $.45 surtax per $100' for anything other than a single-family residence = 1.05% commercial." }
    ] },
  ],
};
