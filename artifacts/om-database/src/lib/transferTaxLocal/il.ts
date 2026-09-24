// GENERATED from official-source research (IL.prep.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: county+municipality. Local table complete: False.
// Local-level source: IDOR — Real Estate Transfer Tax Stamp Purchase Forms/Procedures (Counties); IDOR Form PTAX-203 (R-10/24) (https://tax.illinois.gov/research/taxinformation/property/realestate.html) as of 2026-09-24.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "Cook County Code of Ordinances Ch. 74, Art. III (Real Estate Transfer Tax); IDOR Form PTAX-203 line 20; First American IL Transfer Stamp Listing rev. 11/25/2024";
const S1 = "https://library.municode.com/il/cook_county/codes/code_of_ordinances?nodeId=PTIGEOR_CH74TA_ARTIIIREESTRTA";
const S2 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Addison (Addison Village Code Art. VII, Sec. 8-23); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S3 = "https://www.atgf.com/tax-ordinance/addison";
const S4 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Alsip (Alsip Code of Ordinances Article VI, Sec. 18-100); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S5 = "https://www.atgf.com/tax-ordinance/alsip";
const S6 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Bartlett (Bartlett Municipal Code 12-1-1); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S7 = "https://www.atgf.com/tax-ordinance/bartlett";
const S8 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Bedford Park (Bedford Park Mun. Code 5-21-1); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S9 = "https://www.atgf.com/tax-ordinance/bedford-park";
const S10 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Bellwood (Bellwood Mun. Code Title III Ch. 35-110); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S11 = "https://www.atgf.com/tax-ordinance/bellwood";
const S12 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Berwyn (Berwyn Code of Ordinances Sec. 888.001); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S13 = "https://www.atgf.com/tax-ordinance/berwyn";
const S14 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Bolingbrook (Bolingbrook Ord. 91-025); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S15 = "https://www.atgf.com/tax-ordinance/bolingbrook";
const S16 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Buffalo Grove (Buffalo Grove Mun. Code 3.44.080); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S17 = "https://www.atgf.com/tax-ordinance/buffalo-grove";
const S18 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Burbank (Burbank Mun. Code Article X, Sec. 14-107); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S19 = "https://www.atgf.com/tax-ordinance/burbank";
const S20 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Burnham (Burnham Mun. Code Article X, Sec. 86-341); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S21 = "https://www.atgf.com/tax-ordinance/burnham";
const S22 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Calumet Park (Village Code Title IX, Ch. 96.45); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S23 = "https://www.atgf.com/tax-ordinance/calumet-park";
const S24 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Carol Stream (Carol Stream Mun. Code Sec. 5-10-1); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S25 = "https://www.atgf.com/tax-ordinance/carol-stream";
const S26 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Channahon (Channon Mun. Code Title III, Section 37.76); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S27 = "https://www.atgf.com/tax-ordinance/channahon";
const S28 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Chicago Heights (Chicago Heights MIS. 92.98, 92.46); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S29 = "https://www.atgf.com/tax-ordinance/chicago-heights";
const S30 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Cicero (Cicero Village Code Article VII, Sec. 90-221); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S31 = "https://www.atgf.com/tax-ordinance/cicero";
const S32 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Country Club Hills (Village Code 8.9.01); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S33 = "https://www.atgf.com/tax-ordinance/country-club-hills";
const S34 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Countryside (Countryside Mun. Code 3-10-1); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S35 = "https://www.atgf.com/tax-ordinance/countryside";
const S36 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Des Plaines (Des Plaines Mun. Code 15-7-1); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S37 = "https://www.atgf.com/tax-ordinance/des-plaines";
const S38 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Dolton (ordinance cite not listed); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S39 = "https://www.atgf.com/tax-ordinance/dolton";
const S40 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — East Hazel Crest (East Hazel Crest Mun. Code Sec. 19-161); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S41 = "https://www.atgf.com/tax-ordinance/east-hazel-crest";
const S42 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Elk Grove Village (Elk Grove Village Code 3-2-5); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S43 = "https://www.atgf.com/tax-ordinance/elk-grove-village";
const S44 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Elmhurst (Elmhurst City Code Sec. 11.01); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S45 = "https://www.atgf.com/tax-ordinance/elmhurst";
const S46 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Elmwood Park (Elmwood Park Village Code 41A-1); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S47 = "https://www.atgf.com/tax-ordinance/elmwood-park";
const S48 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Evergreen Park (Evergreen Park Mun. Code Ch. 11 Div. 3 Sec. 11-61); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S49 = "https://www.atgf.com/tax-ordinance/evergreen-park";
const S50 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Freeport (Freeport Ord. 92-21); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S51 = "https://www.atgf.com/tax-ordinance/freeport";
const S52 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Glen Ellyn (Village Code 3-42-1); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S53 = "https://www.atgf.com/tax-ordinance/glen-ellyn";
const S54 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Glendale Heights (Glendale Heights Ord. 94-48); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S55 = "https://www.atgf.com/tax-ordinance/glendale-heights";
const S56 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Glenwood (Glenwood Village Code Article X, Sec. 94-291); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S57 = "https://www.atgf.com/tax-ordinance/glenwood";
const S58 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Hanover Park (Hanover Park Code of Ordinances, Article VII, Sec. 94-167); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S59 = "https://www.atgf.com/tax-ordinance/hanover-park";
const S60 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Harvey (Harvey Ord. 2963); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S61 = "https://www.atgf.com/tax-ordinance/harvey";
const S62 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Harwood Heights (Harwood Heights Ord. 96-03); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S63 = "https://www.atgf.com/tax-ordinance/harwood-heights";
const S64 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Highland Park (Code of Ordinances Title IX, Article X Ch. 97.1000); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S65 = "https://www.atgf.com/tax-ordinance/highland-park";
const S66 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Hillside (Hillside Code of Ordinances Article XII, Sec. 82-351); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S67 = "https://www.atgf.com/tax-ordinance/hillside";
const S68 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Hoffman Estates (Hoffman Estates Ord. 1884-1987); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S69 = "https://www.atgf.com/tax-ordinance/hoffman-estates";
const S70 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Joliet (Joliet Mun. Code Sec. 28-251); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S71 = "https://www.atgf.com/tax-ordinance/joliet";
const S72 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Lake Forest (ordinance cite not listed); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S73 = "https://www.atgf.com/tax-ordinance/lake-forest";
const S74 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Lincolnshire (Lincolnshire Village Code 3-1-6); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S75 = "https://www.atgf.com/tax-ordinance/lincolnshire";
const S76 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Maywood (Maywood Ord. Co-89-9); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S77 = "https://www.atgf.com/tax-ordinance/maywood";
const S78 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — McCook (Village Code Article IV, Sec. 74-81); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S79 = "https://www.atgf.com/tax-ordinance/mccook";
const S80 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Mettawa (Village Code Section 19.201); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S81 = "https://www.atgf.com/tax-ordinance/mettawa";
const S82 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Morton Grove (Village Code 1-10B-2); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S83 = "https://www.atgf.com/tax-ordinance/morton-grove";
const S84 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Mount Prospect (Mount Prospect Village Code 8.801); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S85 = "https://www.atgf.com/tax-ordinance/mount-prospect";
const S86 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Naperville (Village Code 3-1-8); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S87 = "https://www.atgf.com/tax-ordinance/naperville";
const S88 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Niles (Village Code Sec. 94-28); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S89 = "https://www.atgf.com/tax-ordinance/niles";
const S90 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — North Chicago (North Chicago Ord. 6-15); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S91 = "https://www.atgf.com/tax-ordinance/north-chicago";
const S92 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Oak Lawn (Oak Lawn Ord. 81-36-81); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S93 = "https://www.atgf.com/tax-ordinance/oak-lawn";
const S94 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Oak Park (Oak Park Ord. 1983-0-77); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S95 = "https://www.atgf.com/tax-ordinance/oak-park";
const S96 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Oswego (Ordinance No. 22-54); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S97 = "https://www.atgf.com/tax-ordinance/oswego";
const S98 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Park Forest (Park Forest Ord. No. 1575); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S99 = "https://www.atgf.com/tax-ordinance/park-forest";
const S100 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Park Ridge (Park Ridge Code of Ordinances 2-18-1); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S101 = "https://www.atgf.com/tax-ordinance/park-ridge";
const S102 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Peoria (Article X, Sec. 27-226); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S103 = "https://www.atgf.com/tax-ordinance/peoria";
const S104 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — River Forest (Village Code 11-2-2); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S105 = "https://www.atgf.com/tax-ordinance/river-forest";
const S106 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Robbins (ordinance cite not listed); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S107 = "https://www.atgf.com/tax-ordinance/robbins";
const S108 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Rolling Meadows (Rolling Meadows Code of Ordinances 102-91); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S109 = "https://www.atgf.com/tax-ordinance/rolling-meadows";
const S110 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Romeoville (Romeoville Ord. 04-0170); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S111 = "https://www.atgf.com/tax-ordinance/romeoville";
const S112 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Schaumburg (Village Code Title 3, Chapter 36); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S113 = "https://www.atgf.com/tax-ordinance/schaumburg";
const S114 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Skokie (Village Code Section 98-75); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S115 = "https://www.atgf.com/tax-ordinance/skokie";
const S116 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Stickney (Stickney Mun. Code Ch. 78-121); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S117 = "https://www.atgf.com/tax-ordinance/stickney";
const S118 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Stone Park (Village Code Section 35.100); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S119 = "https://www.atgf.com/tax-ordinance/stone-park";
const S120 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Streamwood (Streamwood Mun. Code 3-11-2); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S121 = "https://www.atgf.com/tax-ordinance/streamwood";
const S122 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Sycamore (Sycamore Mun. Code 3-20-1); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S123 = "https://www.atgf.com/tax-ordinance/sycamore";
const S124 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — University Park (University Park Ord. 755); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S125 = "https://www.atgf.com/tax-ordinance/university-park";
const S126 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Wheaton (Wheaton Municipal Code Sec. 66-181); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S127 = "https://www.atgf.com/tax-ordinance/wheaton";
const S128 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Wilmette (Wilmette Mun. code Sec.9-15); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S129 = "https://www.atgf.com/tax-ordinance/wilmette";
const S130 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Woodridge (Woodridge Ord. 80-10); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S131 = "https://www.atgf.com/tax-ordinance/woodridge";
const S132 = "City of Chicago Dept. of Finance — Real Property Transfer Tax (7551), Mun. Code Ch. 3-33";
const S133 = "https://www.chicago.gov/city/en/depts/fin/supp_info/revenue/tax_list/real_property_transfertax.html";
const S134 = "City of Chicago Dept. of Finance — Real Property Transfer Tax (7551), Mun. Code Sec. 3-33-030/040(F)";
const S135 = "City of Evanston — Real Estate Transfer Tax page (rates per Ordinance 148-O-18; City Code 3-25-2)";
const S136 = "https://www.cityofevanston.org/how-to/real-estate-transfer-tax";
const S137 = "ATG Real Estate Transfer Tax Ordinances — Calumet City (Ch. 26, Art. VI)";
const S138 = "https://www.atgf.com/tax-ordinance/calumet-city";
const S139 = "ATG Real Estate Transfer Tax Ordinances — Highwood (Fort Sheridan area only)";
const S140 = "https://www.atgf.com/tax-ordinance/highwood-fort-sheridan-area-only";
const S141 = "ATG Real Estate Transfer Tax Ordinances — Franklin Park; First American list 11/2024";
const S142 = "https://www.atgf.com/tax-ordinance/franklin-park";
const S143 = "55 ILCS 5/5-1031 county RETT; IDOR Form PTAX-203 (R-10/24) line 20 'County tax stamps — multiply Line 18 by 0.25'; IDOR RETT page ('Counties may impose a tax of 25 cents per $500'); ATG 'All Illinois Counties $0.25/$500'";
const S144 = "https://tax.illinois.gov/content/dam/soi/en/web/tax/localgovernments/property/documents/ptax-203.pdf";
const S145 = "ATG (Attorneys' Title Guaranty Fund) Real Estate Transfer Tax Ordinances — Aurora (Aurora Code Article X, Sec. 44-211); cross-checked vs First American IL Transfer Stamp Listing rev. 11/25/2024";
const S146 = "https://www.atgf.com/tax-ordinance/aurora";
const F0 = (rate: number, notes?: string): TaxLineItem => ({ name: "County Real Estate Transfer Tax", rate, base: "price", party: "seller", source: S143, sourceUrl: S144, asOf: "2024-10-01", ...(notes ? { notes } : {}) });
const F1 = (rate: number, notes?: string): TaxLineItem => ({ name: "Aurora Real Estate Transfer Tax", rate, base: "price", party: "seller", source: S145, sourceUrl: S146, asOf: "2025-03-25", ...(notes ? { notes } : {}) });

export const IL_LOCAL_LEVEL = "county+municipality" as const;
export const IL_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "IDOR — Real Estate Transfer Tax Stamp Purchase Forms/Procedures (Counties); IDOR Form PTAX-203 (R-10/24)", sourceUrl: "https://tax.illinois.gov/research/taxinformation/property/realestate.html", asOf: "2026-09-24",
  statement: "IDOR: 'Counties may impose a tax of 25 cents per $500 of value on real estate transactions. Home rule municipalities may also impose an additional real estate transfer tax.' The statewide PTAX-203 computes 'County tax stamps — multiply Line 18 by 0.25' for every transfer, and counties buy combined state+county stamps from IDOR (86 Ill. Adm. Code 120.10). IDOR does NOT publish a list of home-rule municipal RETTs; municipal list compiled from ATG's ordinance database (Chicagoland + selected downstate, confirmed with municipalities ~3/2025, individual updates through 9/2026) cross-checked against First American (11/2024) and the Illinois Realtors 'Listing of all Municipal RETTs' (1/2018).",
};

export const IL_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: false,
  muniAbsentMeansNone: false,
  placeBased: true,
  unincorporatedMeansNone: true, // IL municipal RETTs are levied only by (home-rule) municipalities
  entries: [
  { id: "il-adams-county", kind: "county", name: "Adams County", county: "Adams County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-alexander-county", kind: "county", name: "Alexander County", county: "Alexander County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-bond-county", kind: "county", name: "Bond County", county: "Bond County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-boone-county", kind: "county", name: "Boone County", county: "Boone County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-brown-county", kind: "county", name: "Brown County", county: "Brown County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-bureau-county", kind: "county", name: "Bureau County", county: "Bureau County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-calhoun-county", kind: "county", name: "Calhoun County", county: "Calhoun County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-carroll-county", kind: "county", name: "Carroll County", county: "Carroll County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-cass-county", kind: "county", name: "Cass County", county: "Cass County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-champaign-county", kind: "county", name: "Champaign County", county: "Champaign County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-christian-county", kind: "county", name: "Christian County", county: "Christian County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-clark-county", kind: "county", name: "Clark County", county: "Clark County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-clay-county", kind: "county", name: "Clay County", county: "Clay County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-clinton-county", kind: "county", name: "Clinton County", county: "Clinton County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-coles-county", kind: "county", name: "Coles County", county: "Coles County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-cook-county", kind: "county", name: "Cook County", county: "Cook County", lines: [
      { name: "Cook County Real Estate Transfer Tax", rate: 0.0005, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2024-11-25", notes: "$0.25 per $500 (or fraction) = 0.05%. Cook levies under its home-rule ordinance (same rate as the 55 ILCS 5/5-1031 county tax). Either party liable; seller customary. Cook requires MyDec/Cook County transfer declaration." }
    ] },
  { id: "il-crawford-county", kind: "county", name: "Crawford County", county: "Crawford County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-cumberland-county", kind: "county", name: "Cumberland County", county: "Cumberland County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-dekalb-county", kind: "county", name: "DeKalb County", county: "DeKalb County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-de-witt-county", kind: "county", name: "De Witt County", county: "De Witt County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-douglas-county", kind: "county", name: "Douglas County", county: "Douglas County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-dupage-county", kind: "county", name: "DuPage County", county: "DuPage County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-edgar-county", kind: "county", name: "Edgar County", county: "Edgar County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-edwards-county", kind: "county", name: "Edwards County", county: "Edwards County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-effingham-county", kind: "county", name: "Effingham County", county: "Effingham County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-fayette-county", kind: "county", name: "Fayette County", county: "Fayette County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-ford-county", kind: "county", name: "Ford County", county: "Ford County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-franklin-county", kind: "county", name: "Franklin County", county: "Franklin County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-fulton-county", kind: "county", name: "Fulton County", county: "Fulton County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-gallatin-county", kind: "county", name: "Gallatin County", county: "Gallatin County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-greene-county", kind: "county", name: "Greene County", county: "Greene County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-grundy-county", kind: "county", name: "Grundy County", county: "Grundy County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-hamilton-county", kind: "county", name: "Hamilton County", county: "Hamilton County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-hancock-county", kind: "county", name: "Hancock County", county: "Hancock County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-hardin-county", kind: "county", name: "Hardin County", county: "Hardin County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-henderson-county", kind: "county", name: "Henderson County", county: "Henderson County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-henry-county", kind: "county", name: "Henry County", county: "Henry County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-iroquois-county", kind: "county", name: "Iroquois County", county: "Iroquois County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-jackson-county", kind: "county", name: "Jackson County", county: "Jackson County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-jasper-county", kind: "county", name: "Jasper County", county: "Jasper County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-jefferson-county", kind: "county", name: "Jefferson County", county: "Jefferson County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-jersey-county", kind: "county", name: "Jersey County", county: "Jersey County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-jo-daviess-county", kind: "county", name: "Jo Daviess County", county: "Jo Daviess County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-johnson-county", kind: "county", name: "Johnson County", county: "Johnson County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-kane-county", kind: "county", name: "Kane County", county: "Kane County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-kankakee-county", kind: "county", name: "Kankakee County", county: "Kankakee County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-kendall-county", kind: "county", name: "Kendall County", county: "Kendall County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-knox-county", kind: "county", name: "Knox County", county: "Knox County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-lake-county", kind: "county", name: "Lake County", county: "Lake County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-lasalle-county", kind: "county", name: "LaSalle County", county: "LaSalle County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-lawrence-county", kind: "county", name: "Lawrence County", county: "Lawrence County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-lee-county", kind: "county", name: "Lee County", county: "Lee County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-livingston-county", kind: "county", name: "Livingston County", county: "Livingston County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-logan-county", kind: "county", name: "Logan County", county: "Logan County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-mcdonough-county", kind: "county", name: "McDonough County", county: "McDonough County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-mchenry-county", kind: "county", name: "McHenry County", county: "McHenry County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-mclean-county", kind: "county", name: "McLean County", county: "McLean County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-macon-county", kind: "county", name: "Macon County", county: "Macon County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-macoupin-county", kind: "county", name: "Macoupin County", county: "Macoupin County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-madison-county", kind: "county", name: "Madison County", county: "Madison County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-marion-county", kind: "county", name: "Marion County", county: "Marion County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-marshall-county", kind: "county", name: "Marshall County", county: "Marshall County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-mason-county", kind: "county", name: "Mason County", county: "Mason County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-massac-county", kind: "county", name: "Massac County", county: "Massac County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-menard-county", kind: "county", name: "Menard County", county: "Menard County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-mercer-county", kind: "county", name: "Mercer County", county: "Mercer County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-monroe-county", kind: "county", name: "Monroe County", county: "Monroe County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-montgomery-county", kind: "county", name: "Montgomery County", county: "Montgomery County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-morgan-county", kind: "county", name: "Morgan County", county: "Morgan County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-moultrie-county", kind: "county", name: "Moultrie County", county: "Moultrie County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-ogle-county", kind: "county", name: "Ogle County", county: "Ogle County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-peoria-county", kind: "county", name: "Peoria County", county: "Peoria County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-perry-county", kind: "county", name: "Perry County", county: "Perry County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-piatt-county", kind: "county", name: "Piatt County", county: "Piatt County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-pike-county", kind: "county", name: "Pike County", county: "Pike County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-pope-county", kind: "county", name: "Pope County", county: "Pope County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-pulaski-county", kind: "county", name: "Pulaski County", county: "Pulaski County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-putnam-county", kind: "county", name: "Putnam County", county: "Putnam County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-randolph-county", kind: "county", name: "Randolph County", county: "Randolph County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-richland-county", kind: "county", name: "Richland County", county: "Richland County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-rock-island-county", kind: "county", name: "Rock Island County", county: "Rock Island County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-st-clair-county", kind: "county", name: "St. Clair County", county: "St. Clair County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-saline-county", kind: "county", name: "Saline County", county: "Saline County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-sangamon-county", kind: "county", name: "Sangamon County", county: "Sangamon County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-schuyler-county", kind: "county", name: "Schuyler County", county: "Schuyler County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-scott-county", kind: "county", name: "Scott County", county: "Scott County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-shelby-county", kind: "county", name: "Shelby County", county: "Shelby County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-stark-county", kind: "county", name: "Stark County", county: "Stark County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-stephenson-county", kind: "county", name: "Stephenson County", county: "Stephenson County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-tazewell-county", kind: "county", name: "Tazewell County", county: "Tazewell County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-union-county", kind: "county", name: "Union County", county: "Union County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-vermilion-county", kind: "county", name: "Vermilion County", county: "Vermilion County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-wabash-county", kind: "county", name: "Wabash County", county: "Wabash County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-warren-county", kind: "county", name: "Warren County", county: "Warren County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-washington-county", kind: "county", name: "Washington County", county: "Washington County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-wayne-county", kind: "county", name: "Wayne County", county: "Wayne County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-white-county", kind: "county", name: "White County", county: "White County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-whiteside-county", kind: "county", name: "Whiteside County", county: "Whiteside County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-will-county", kind: "county", name: "Will County", county: "Will County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-williamson-county", kind: "county", name: "Williamson County", county: "Williamson County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-winnebago-county", kind: "county", name: "Winnebago County", county: "Winnebago County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-woodford-county", kind: "county", name: "Woodford County", county: "Woodford County", lines: [
      F0(0.0005, "$0.25 per $500 of net consideration (or fraction) = 0.05%. Sold as combined state+county stamps ($0.75/$500) by the county recorder. Either party liable; seller customary. Existing-mortgage balance excluded from base only if deed so states.")
    ] },
  { id: "il-dupage-county-addison-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Addison village", county: "DuPage County", lines: [
      { name: "Addison Real Estate Transfer Tax", rate: 0.0025, base: "price", party: "buyer", source: S2, sourceUrl: S3, asOf: "2017-03-14", notes: "ATG: '$2.50/$1,000 (round to nearest $1,000)', party 'Buyer'." }
    ] },
  { id: "il-cook-county-alsip-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Alsip village", county: "Cook County", lines: [
      { name: "Alsip Real Estate Transfer Tax", rate: 0.0035, base: "price", party: "seller", source: S4, sourceUrl: S5, asOf: "2017-03-14", notes: "ATG: '$3.50/$1,000 ($100 minimum; no rounding)', party 'Seller'. $100 minimum." }
    ] },
  { id: "il-kane-county-aurora-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Aurora city", county: "Kane County", lines: [
      F1(0.003, "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'. Aurora Code Sec. 44-211. Some 'Naperville' mailing addresses are inside Aurora.")
    ] },
  { id: "il-dupage-county-aurora-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Aurora city", county: "DuPage County", lines: [
      F1(0.003, "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'. Aurora Code Sec. 44-211. Some 'Naperville' mailing addresses are inside Aurora.")
    ] },
  { id: "il-will-county-aurora-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Aurora city", county: "Will County", lines: [
      F1(0.003, "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'. Aurora Code Sec. 44-211. Some 'Naperville' mailing addresses are inside Aurora.")
    ] },
  { id: "il-kendall-county-aurora-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Aurora city", county: "Kendall County", lines: [
      F1(0.003, "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'. Aurora Code Sec. 44-211. Some 'Naperville' mailing addresses are inside Aurora.")
    ] },
  { id: "il-cook-county-bartlett-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Bartlett village", county: "Cook County", lines: [
      { name: "Bartlett Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S6, sourceUrl: S7, asOf: "2017-03-14", notes: "ATG: '$3.00/$1,000 (no rounding)', party 'Seller'." }
    ] },
  { id: "il-dupage-county-bartlett-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Bartlett village", county: "DuPage County", lines: [
      { name: "Bartlett Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S6, sourceUrl: S7, asOf: "2017-03-14", notes: "ATG: '$3.00/$1,000 (no rounding)', party 'Seller'." }
    ] },
  { id: "il-kane-county-bartlett-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Bartlett village", county: "Kane County", lines: [
      { name: "Bartlett Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S6, sourceUrl: S7, asOf: "2017-03-14", notes: "ATG: '$3.00/$1,000 (no rounding)', party 'Seller'." }
    ] },
  { id: "il-cook-county-bedford-park-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Bedford Park village", county: "Cook County", lines: [
      { name: "Bedford Park Real Estate Transfer Tax", rate: 0, base: "price", party: "seller", flatAmount: 50, source: S8, sourceUrl: S9, asOf: "2017-03-20", notes: "ATG: '$50.00', party 'Seller'. FLAT $50 per transfer (not a % tax)." }
    ] },
  { id: "il-cook-county-bellwood-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Bellwood village", county: "Cook County", lines: [
      { name: "Bellwood Real Estate Transfer Tax", rate: 0.005, base: "price", party: "seller", source: S10, sourceUrl: S11, asOf: "2025-03-04", notes: "ATG: '$5.00/$1,000 (no rounding)', party 'Seller'." }
    ] },
  { id: "il-cook-county-berwyn-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Berwyn city", county: "Cook County", lines: [
      { name: "Berwyn Real Estate Transfer Tax", rate: 0.01, base: "price", party: "seller", source: S12, sourceUrl: S13, asOf: "2025-03-04", notes: "ATG: '$10.000/1,000', party 'Seller'. Berwyn Code Sec. 888.001." }
    ] },
  { id: "il-will-county-bolingbrook-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Bolingbrook village", county: "Will County", lines: [
      { name: "Bolingbrook Real Estate Transfer Tax", rate: 0.0075, base: "price", party: "split", source: S14, sourceUrl: S15, asOf: "2011-02-07", notes: "ATG: '$$7.50/$1,000 (round to nearest $500)', party 'Buyer/Seller split 50/50'. Bolingbrook Ord. 91-025; 50/50 buyer/seller; rounded to nearest $500." }
    ] },
  { id: "il-dupage-county-bolingbrook-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Bolingbrook village", county: "DuPage County", lines: [
      { name: "Bolingbrook Real Estate Transfer Tax", rate: 0.0075, base: "price", party: "split", source: S14, sourceUrl: S15, asOf: "2011-02-07", notes: "ATG: '$$7.50/$1,000 (round to nearest $500)', party 'Buyer/Seller split 50/50'. Bolingbrook Ord. 91-025; 50/50 buyer/seller; rounded to nearest $500." }
    ] },
  { id: "il-lake-county-buffalo-grove-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Buffalo Grove village", county: "Lake County", lines: [
      { name: "Buffalo Grove Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S16, sourceUrl: S17, asOf: "2017-03-13", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-cook-county-buffalo-grove-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Buffalo Grove village", county: "Cook County", lines: [
      { name: "Buffalo Grove Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S16, sourceUrl: S17, asOf: "2017-03-13", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-cook-county-burbank-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Burbank city", county: "Cook County", lines: [
      { name: "Burbank Real Estate Transfer Tax", rate: 0.005, base: "price", party: "seller", source: S18, sourceUrl: S19, asOf: "2025-03-04", notes: "ATG: '$5.00/$1,000 (no rounding) No less than $100', party 'Seller'. $100 minimum." }
    ] },
  { id: "il-cook-county-burnham-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Burnham village", county: "Cook County", lines: [
      { name: "Burnham Real Estate Transfer Tax", rate: 0.005, base: "price", party: "buyer", source: S20, sourceUrl: S21, asOf: "2025-03-04", notes: "ATG: '$5.00/$1,000 (no rounding)', party 'Buyer'." }
    ] },
  { id: "il-cook-county-calumet-park-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Calumet Park village", county: "Cook County", lines: [
      { name: "Calumet Park Real Estate Transfer Tax", rate: 0.005, base: "price", party: "buyer", source: S22, sourceUrl: S23, asOf: "2025-03-04", notes: "ATG: '$5.00/$1,000 (round to nearest $1,000)', party 'Buyer'. ATG: buyer; First American 2024 list: 'Either'." }
    ] },
  { id: "il-dupage-county-carol-stream-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Carol Stream village", county: "DuPage County", lines: [
      { name: "Carol Stream Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S24, sourceUrl: S25, asOf: "2011-02-07", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-will-county-channahon-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Channahon village", county: "Will County", lines: [
      { name: "Channahon Real Estate Transfer Tax", rate: 0.003, base: "price", party: "buyer", source: S26, sourceUrl: S27, asOf: "2017-03-14", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Buyer'." }
    ] },
  { id: "il-grundy-county-channahon-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Channahon village", county: "Grundy County", lines: [
      { name: "Channahon Real Estate Transfer Tax", rate: 0.003, base: "price", party: "buyer", source: S26, sourceUrl: S27, asOf: "2017-03-14", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Buyer'." }
    ] },
  { id: "il-cook-county-chicago-heights-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Chicago Heights city", county: "Cook County", lines: [
      { name: "Chicago Heights Real Estate Transfer Tax", rate: 0.004, base: "price", party: "seller", source: S28, sourceUrl: S29, asOf: "2025-03-04", notes: "ATG: '$4.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-cook-county-cicero-town", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Cicero town", county: "Cook County", lines: [
      { name: "Cicero Real Estate Transfer Tax", rate: 0.01, base: "price", party: "seller", source: S30, sourceUrl: S31, asOf: "2018-12-06", notes: "ATG: '$10.00/$1,000 (round to nearest $1,000)', party 'Seller. In HUD deals, Buyer pays the transfer tax. HUD is not exempt.'. Cicero Code Sec. 90-221. Compliance inspection required before all transfers." }
    ] },
  { id: "il-cook-county-country-club-hills-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Country Club Hills city", county: "Cook County", lines: [
      { name: "Country Club Hills Real Estate Transfer Tax", rate: 0.005, base: "price", party: "seller", source: S32, sourceUrl: S33, asOf: "2025-03-04", notes: "ATG: '$5.00/$1,000 (minimum: $50) (round to nearest $5)', party 'Seller'. $50 minimum." }
    ] },
  { id: "il-cook-county-countryside-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Countryside city", county: "Cook County", lines: [
      { name: "Countryside Real Estate Transfer Tax", rate: 0, base: "price", party: "seller", flatAmount: 50, source: S34, sourceUrl: S35, asOf: "2017-03-20", notes: "ATG: '$50', party 'Seller'. FLAT $50 per transfer (not a % tax)." }
    ] },
  { id: "il-cook-county-des-plaines-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Des Plaines city", county: "Cook County", lines: [
      { name: "Des Plaines Real Estate Transfer Tax", rate: 0.002, base: "price", party: "seller", source: S36, sourceUrl: S37, asOf: "2025-03-04", notes: "ATG: '$2.00/$1,000', party 'Seller'." }
    ] },
  { id: "il-cook-county-dolton-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Dolton village", county: "Cook County", lines: [
      { name: "Dolton Real Estate Transfer Tax", rate: 0.005, base: "price", party: "seller", source: S38, sourceUrl: S39, asOf: "2025-03-04", notes: "ATG: '$5.00/$1,000', party 'Seller'. Was $10/property in the 2018 Realtors list; now $5.00/$1,000 per ATG (3/2025) and First American (11/2024)." }
    ] },
  { id: "il-cook-county-east-hazel-crest-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "East Hazel Crest village", county: "Cook County", lines: [
      { name: "East Hazel Crest Real Estate Transfer Tax", rate: 0, base: "price", party: "buyer", flatAmount: 25, source: S40, sourceUrl: S41, asOf: "2025-03-04", notes: "ATG: '$25', party 'Buyer'. FLAT $25 per transfer (not a % tax)." }
    ] },
  { id: "il-cook-county-elk-grove-village-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Elk Grove Village village", county: "Cook County", lines: [
      { name: "Elk Grove Village Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S42, sourceUrl: S43, asOf: "2017-03-20", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-dupage-county-elk-grove-village-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Elk Grove Village village", county: "DuPage County", lines: [
      { name: "Elk Grove Village Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S42, sourceUrl: S43, asOf: "2017-03-20", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-dupage-county-elmhurst-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Elmhurst city", county: "DuPage County", lines: [
      { name: "Elmhurst Real Estate Transfer Tax", rate: 0.0015, base: "price", party: "seller", source: S44, sourceUrl: S45, asOf: "2026-03-17", notes: "ATG: '$1.50/$1,000 (round to nearest $1,000)', party 'Seller'. Elmhurst City Code Sec. 11.01; follows state exemptions." }
    ] },
  { id: "il-cook-county-elmhurst-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Elmhurst city", county: "Cook County", lines: [
      { name: "Elmhurst Real Estate Transfer Tax", rate: 0.0015, base: "price", party: "seller", source: S44, sourceUrl: S45, asOf: "2026-03-17", notes: "ATG: '$1.50/$1,000 (round to nearest $1,000)', party 'Seller'. Elmhurst City Code Sec. 11.01; follows state exemptions." }
    ] },
  { id: "il-cook-county-elmwood-park-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Elmwood Park village", county: "Cook County", lines: [
      { name: "Elmwood Park Real Estate Transfer Tax", rate: 0.005, base: "price", party: "seller", source: S46, sourceUrl: S47, asOf: "2025-03-04", notes: "ATG: '$5.00/$1,000 (round to nearest $1,000) No less than $35', party 'Seller'. $35 minimum." }
    ] },
  { id: "il-cook-county-evergreen-park-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Evergreen Park village", county: "Cook County", lines: [
      { name: "Evergreen Park Real Estate Transfer Tax", rate: 0.005, base: "price", party: "seller", source: S48, sourceUrl: S49, asOf: "2017-03-20", notes: "ATG: '$5.00/$1,000 (round to nearest $1,000) Minimum: $100', party 'Seller'. $100 minimum." }
    ] },
  { id: "il-stephenson-county-freeport-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Freeport city", county: "Stephenson County", lines: [
      { name: "Freeport Real Estate Transfer Tax", rate: 0.004, base: "price", party: "seller", source: S50, sourceUrl: S51, asOf: "2025-03-04", notes: "ATG: '$2.00/$500 (or part thereof)', party 'Seller'. $2.00 per $500 (or part) = 0.40%. Freeport Ord. 92-21. Downstate." }
    ] },
  { id: "il-dupage-county-glen-ellyn-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Glen Ellyn village", county: "DuPage County", lines: [
      { name: "Glen Ellyn Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S52, sourceUrl: S53, asOf: "2025-03-04", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-dupage-county-glendale-heights-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Glendale Heights village", county: "DuPage County", lines: [
      { name: "Glendale Heights Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S54, sourceUrl: S55, asOf: "2017-11-14", notes: "ATG: 'The greater of $25 or $3.00/$1,000 or fraction thereof', party 'Seller'. Greater of $25 or $3.00/$1,000." }
    ] },
  { id: "il-cook-county-glenwood-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Glenwood village", county: "Cook County", lines: [
      { name: "Glenwood Real Estate Transfer Tax", rate: 0.005, base: "price", party: "seller", source: S56, sourceUrl: S57, asOf: "2025-03-04", notes: "ATG: '$5.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-cook-county-hanover-park-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Hanover Park village", county: "Cook County", lines: [
      { name: "Hanover Park Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S58, sourceUrl: S59, asOf: "2025-03-04", notes: "ATG: '$1.50/$500 of value or fraction thereof stated.', party 'Seller'. $1.50 per $500." }
    ] },
  { id: "il-dupage-county-hanover-park-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Hanover Park village", county: "DuPage County", lines: [
      { name: "Hanover Park Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S58, sourceUrl: S59, asOf: "2025-03-04", notes: "ATG: '$1.50/$500 of value or fraction thereof stated.', party 'Seller'. $1.50 per $500." }
    ] },
  { id: "il-cook-county-harvey-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Harvey city", county: "Cook County", lines: [
      { name: "Harvey Real Estate Transfer Tax", rate: 0.005, base: "price", party: "split", source: S60, sourceUrl: S61, asOf: "2011-02-07", notes: "ATG: '$5.00/$1,000 (Buyer also responsible for $60 administrative fee)', party 'Buyer/Seller split 50/50'. Harvey Ord. 2963; 50/50; buyer also pays $60 admin fee; $300 commercial inspection." }
    ] },
  { id: "il-cook-county-harwood-heights-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Harwood Heights village", county: "Cook County", lines: [
      { name: "Harwood Heights Real Estate Transfer Tax", rate: 0.01, base: "price", party: "buyer", source: S62, sourceUrl: S63, asOf: "2011-02-07", notes: "ATG: '$10.00/$1,000', party 'Buyer'." }
    ] },
  { id: "il-lake-county-highland-park-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Highland Park city", county: "Lake County", lines: [
      { name: "Highland Park Real Estate Transfer Tax", rate: 0.005, base: "price", party: "seller", source: S64, sourceUrl: S65, asOf: "2025-03-04", notes: "ATG: '$5.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-cook-county-hillside-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Hillside village", county: "Cook County", lines: [
      { name: "Hillside Real Estate Transfer Tax", rate: 0.0075, base: "price", party: "buyer", source: S66, sourceUrl: S67, asOf: "2017-03-20", notes: "ATG: '$3.75/$500 (no rounding)', party 'Buyer'. $3.75 per $500." }
    ] },
  { id: "il-cook-county-hoffman-estates-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Hoffman Estates village", county: "Cook County", lines: [
      { name: "Hoffman Estates Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S68, sourceUrl: S69, asOf: "2025-03-04", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-kane-county-hoffman-estates-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Hoffman Estates village", county: "Kane County", lines: [
      { name: "Hoffman Estates Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S68, sourceUrl: S69, asOf: "2025-03-04", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-will-county-joliet-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Joliet city", county: "Will County", lines: [
      { name: "Joliet Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S70, sourceUrl: S71, asOf: "2017-03-14", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-kendall-county-joliet-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Joliet city", county: "Kendall County", lines: [
      { name: "Joliet Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S70, sourceUrl: S71, asOf: "2017-03-14", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-lake-county-lake-forest-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Lake Forest city", county: "Lake County", lines: [
      { name: "Lake Forest Real Estate Transfer Tax", rate: 0.004, base: "price", party: "buyer", source: S72, sourceUrl: S73, asOf: "2017-02-10", notes: "ATG: '$4.00/1000 (round to the next $5)', party 'Buyer'. Resident move-within-city rebate (residential only; n/a commercial)." }
    ] },
  { id: "il-lake-county-lincolnshire-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Lincolnshire village", county: "Lake County", lines: [
      { name: "Lincolnshire Real Estate Transfer Tax", rate: 0.003, base: "price", party: "buyer", source: S74, sourceUrl: S75, asOf: "2025-03-04", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Buyer'." }
    ] },
  { id: "il-cook-county-maywood-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Maywood village", county: "Cook County", lines: [
      { name: "Maywood Real Estate Transfer Tax", rate: 0.004, base: "price", party: "seller", source: S76, sourceUrl: S77, asOf: "2025-03-04", notes: "ATG: '$4.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-cook-county-mccook-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "McCook village", county: "Cook County", lines: [
      { name: "McCook Real Estate Transfer Tax", rate: 0.005, base: "price", party: "seller", source: S78, sourceUrl: S79, asOf: "2017-03-08", notes: "ATG: '$5.00/$1,000 (round to nearest $1,000) No less than $100', party 'Seller'. $100 minimum." }
    ] },
  { id: "il-lake-county-mettawa-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Mettawa village", county: "Lake County", lines: [
      { name: "Mettawa Real Estate Transfer Tax", rate: 0.005, base: "price", party: "buyer", source: S80, sourceUrl: S81, asOf: "2017-03-08", notes: "ATG: '$5.00/$1,000 (round to nearest $1,000)', party 'Buyer'." }
    ] },
  { id: "il-cook-county-morton-grove-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Morton Grove village", county: "Cook County", lines: [
      { name: "Morton Grove Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S82, sourceUrl: S83, asOf: "2025-03-04", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-cook-county-mount-prospect-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Mount Prospect village", county: "Cook County", lines: [
      { name: "Mount Prospect Real Estate Transfer Tax", rate: 0.003, base: "price", party: "buyer", source: S84, sourceUrl: S85, asOf: "2017-03-20", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Buyer'." }
    ] },
  { id: "il-dupage-county-naperville-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Naperville city", county: "DuPage County", lines: [
      { name: "Naperville Real Estate Transfer Tax", rate: 0.003, base: "price", party: "buyer", source: S86, sourceUrl: S87, asOf: "2021-05-17", notes: "ATG: '$1.50/$500 (round to nearest $500)', party 'Buyer'. $1.50 per $500 (rounded to nearest $500). Some Naperville mailing addresses are in Aurora (Aurora tax applies instead)." }
    ] },
  { id: "il-will-county-naperville-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Naperville city", county: "Will County", lines: [
      { name: "Naperville Real Estate Transfer Tax", rate: 0.003, base: "price", party: "buyer", source: S86, sourceUrl: S87, asOf: "2021-05-17", notes: "ATG: '$1.50/$500 (round to nearest $500)', party 'Buyer'. $1.50 per $500 (rounded to nearest $500). Some Naperville mailing addresses are in Aurora (Aurora tax applies instead)." }
    ] },
  { id: "il-cook-county-niles-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Niles village", county: "Cook County", lines: [
      { name: "Niles Real Estate Transfer Tax", rate: 0.003, base: "price", party: "buyer", source: S88, sourceUrl: S89, asOf: "2025-03-04", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Buyer'." }
    ] },
  { id: "il-lake-county-north-chicago-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "North Chicago city", county: "Lake County", lines: [
      { name: "North Chicago Real Estate Transfer Tax", rate: 0.005, base: "price", party: "buyer", source: S90, sourceUrl: S91, asOf: "2011-02-08", notes: "ATG: '$5.00/$1,000 (round to nearest $1,000)', party 'Buyer'." }
    ] },
  { id: "il-cook-county-oak-lawn-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Oak Lawn village", county: "Cook County", lines: [
      { name: "Oak Lawn Real Estate Transfer Tax", rate: 0.005, base: "price", party: "seller", source: S92, sourceUrl: S93, asOf: "2021-04-01", notes: "ATG: '$5.00/$1,000 (or fraction thereof)', party 'Seller'." }
    ] },
  { id: "il-cook-county-oak-park-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Oak Park village", county: "Cook County", lines: [
      { name: "Oak Park Real Estate Transfer Tax", rate: 0.008, base: "price", party: "seller", source: S94, sourceUrl: S95, asOf: "2017-02-14", notes: "ATG: '$8.00/$1,000 (round to nearest $1,000)', party 'Seller'. Oak Park Ord. 1983-0-77; $8.00/$1,000 rounded to nearest $1,000." }
    ] },
  { id: "il-kendall-county-oswego-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Oswego village", county: "Kendall County", lines: [
      { name: "Oswego Real Estate Transfer Tax", rate: 0.003, base: "price", party: "buyer", source: S96, sourceUrl: S97, asOf: "2023-03-06", notes: "ATG: '$3 per $1000 of purchase price (0.3%)', party 'Buyer'. Voter-approved 6/28/2022 (Ord. 22-54); new since the 2018 Realtors list." }
    ] },
  { id: "il-will-county-oswego-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Oswego village", county: "Will County", lines: [
      { name: "Oswego Real Estate Transfer Tax", rate: 0.003, base: "price", party: "buyer", source: S96, sourceUrl: S97, asOf: "2023-03-06", notes: "ATG: '$3 per $1000 of purchase price (0.3%)', party 'Buyer'. Voter-approved 6/28/2022 (Ord. 22-54); new since the 2018 Realtors list." }
    ] },
  { id: "il-cook-county-park-forest-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Park Forest village", county: "Cook County", lines: [
      { name: "Park Forest Real Estate Transfer Tax", rate: 0.005, base: "price", party: "seller", source: S98, sourceUrl: S99, asOf: "2025-03-04", notes: "ATG: '$5.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-will-county-park-forest-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Park Forest village", county: "Will County", lines: [
      { name: "Park Forest Real Estate Transfer Tax", rate: 0.005, base: "price", party: "seller", source: S98, sourceUrl: S99, asOf: "2025-03-04", notes: "ATG: '$5.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-cook-county-park-ridge-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Park Ridge city", county: "Cook County", lines: [
      { name: "Park Ridge Real Estate Transfer Tax", rate: 0.002, base: "price", party: "seller", source: S100, sourceUrl: S101, asOf: "2025-03-04", notes: "ATG: '$2.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-peoria-county-peoria-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Peoria city", county: "Peoria County", lines: [
      { name: "Peoria Real Estate Transfer Tax", rate: 0.0025, base: "price", party: "seller", source: S102, sourceUrl: S103, asOf: "2025-03-04", notes: "ATG: '$2.50/$1,000 (round to nearest $1,000)', party 'Seller'. Peoria Code Art. X, Sec. 27-226. Downstate." }
    ] },
  { id: "il-cook-county-river-forest-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "River Forest village", county: "Cook County", lines: [
      { name: "River Forest Real Estate Transfer Tax", rate: 0.001, base: "price", party: "seller", source: S104, sourceUrl: S105, asOf: "2025-03-04", notes: "ATG: '$1.00/$1,000 (round up by $1)', party 'Seller'. Rate is $1.00/$1,000 per ATG (3/2025) and First American (11/2024); the 2018 Realtors list showed $0.50." }
    ] },
  { id: "il-cook-county-robbins-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Robbins village", county: "Cook County", lines: [
      { name: "Robbins Real Estate Transfer Tax", rate: 0, base: "price", party: "seller", flatAmount: 100, source: S106, sourceUrl: S107, asOf: "2017-03-08", notes: "ATG: '$100', party 'Seller'. FLAT $100 stamp per PIN (not a % tax)." }
    ] },
  { id: "il-cook-county-rolling-meadows-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Rolling Meadows city", county: "Cook County", lines: [
      { name: "Rolling Meadows Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S108, sourceUrl: S109, asOf: "2025-03-04", notes: "ATG: '$3.00/$1,000 (round to next highest $1,000)', party 'Seller'." }
    ] },
  { id: "il-will-county-romeoville-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Romeoville village", county: "Will County", lines: [
      { name: "Romeoville Real Estate Transfer Tax", rate: 0.0035, base: "price", party: "buyer", source: S110, sourceUrl: S111, asOf: "2025-03-04", notes: "ATG: '$1.75/$500', party 'Buyer'. $1.75 per $500." }
    ] },
  { id: "il-cook-county-schaumburg-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Schaumburg village", county: "Cook County", lines: [
      { name: "Schaumburg Real Estate Transfer Tax", rate: 0.001, base: "price", party: "seller", source: S112, sourceUrl: S113, asOf: "2026-04-10", notes: "ATG: '$1.00/$1,000 (round to nearest $1)', party 'Seller'. Village Code Title 3, Ch. 36." }
    ] },
  { id: "il-dupage-county-schaumburg-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Schaumburg village", county: "DuPage County", lines: [
      { name: "Schaumburg Real Estate Transfer Tax", rate: 0.001, base: "price", party: "seller", source: S112, sourceUrl: S113, asOf: "2026-04-10", notes: "ATG: '$1.00/$1,000 (round to nearest $1)', party 'Seller'. Village Code Title 3, Ch. 36." }
    ] },
  { id: "il-cook-county-skokie-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Skokie village", county: "Cook County", lines: [
      { name: "Skokie Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S114, sourceUrl: S115, asOf: "2026-09-04", notes: "ATG: '$3.00/$1,000 (or fraction thereof)', party 'Seller'. Village Code Sec. 98-75." }
    ] },
  { id: "il-cook-county-stickney-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Stickney village", county: "Cook County", lines: [
      { name: "Stickney Real Estate Transfer Tax", rate: 0.005, base: "price", party: "seller", source: S116, sourceUrl: S117, asOf: "2025-03-04", notes: "ATG: '$5.00/$1,000 (round to nearest $1)', party 'Seller'." }
    ] },
  { id: "il-cook-county-stone-park-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Stone Park village", county: "Cook County", lines: [
      { name: "Stone Park Real Estate Transfer Tax", rate: 0.004, base: "price", party: "seller", source: S118, sourceUrl: S119, asOf: "2025-03-04", notes: "ATG: '$2/$500', party 'Seller'. $2 per $500." }
    ] },
  { id: "il-cook-county-streamwood-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Streamwood village", county: "Cook County", lines: [
      { name: "Streamwood Real Estate Transfer Tax", rate: 0.003, base: "price", party: "seller", source: S120, sourceUrl: S121, asOf: "2017-03-14", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-dekalb-county-sycamore-city", kind: "municipal", name: "Sycamore city", county: "DeKalb County", lines: [
      { name: "Sycamore Real Estate Transfer Tax", rate: 0.005, base: "price", party: "buyer", source: S122, sourceUrl: S123, asOf: "2017-03-14", notes: "ATG: '$5.00/$1,000 (no rounding)', party 'Buyer'. Resident exemption is residential only. Confirmed on cityofsycamore.com. Downstate." }
    ] },
  { id: "il-will-county-university-park-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "University Park village", county: "Will County", lines: [
      { name: "University Park Real Estate Transfer Tax", rate: 0.001, base: "price", party: "seller", source: S124, sourceUrl: S125, asOf: "2011-02-08", notes: "ATG: '$1.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-cook-county-university-park-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "University Park village", county: "Cook County", lines: [
      { name: "University Park Real Estate Transfer Tax", rate: 0.001, base: "price", party: "seller", source: S124, sourceUrl: S125, asOf: "2011-02-08", notes: "ATG: '$1.00/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-dupage-county-wheaton-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Wheaton city", county: "DuPage County", lines: [
      { name: "Wheaton Real Estate Transfer Tax", rate: 0.0025, base: "price", party: "buyer", source: S126, sourceUrl: S127, asOf: "2019-12-17", notes: "ATG: '$2.50/$1,000 (round to nearest $1,000)', party 'Buyer'." }
    ] },
  { id: "il-cook-county-wilmette-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Wilmette village", county: "Cook County", lines: [
      { name: "Wilmette Real Estate Transfer Tax", rate: 0.003, base: "price", party: "buyer", source: S128, sourceUrl: S129, asOf: "2017-03-14", notes: "ATG: '$3.00/$1,000 (round to nearest $1,000)', party 'Buyer'." }
    ] },
  { id: "il-dupage-county-woodridge-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Woodridge village", county: "DuPage County", lines: [
      { name: "Woodridge Real Estate Transfer Tax", rate: 0.0025, base: "price", party: "seller", source: S130, sourceUrl: S131, asOf: "2017-02-14", notes: "ATG: '$2.50/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-will-county-woodridge-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Woodridge village", county: "Will County", lines: [
      { name: "Woodridge Real Estate Transfer Tax", rate: 0.0025, base: "price", party: "seller", source: S130, sourceUrl: S131, asOf: "2017-02-14", notes: "ATG: '$2.50/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-cook-county-woodridge-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Woodridge village", county: "Cook County", lines: [
      { name: "Woodridge Real Estate Transfer Tax", rate: 0.0025, base: "price", party: "seller", source: S130, sourceUrl: S131, asOf: "2017-02-14", notes: "ATG: '$2.50/$1,000 (round to nearest $1,000)', party 'Seller'." }
    ] },
  { id: "il-cook-county-chicago-city", kind: "municipal", name: "Chicago city", county: "Cook County", lines: [
      { name: "Chicago Real Property Transfer Tax — City portion", rate: 0.0075, base: "price", party: "buyer", source: S132, sourceUrl: S133, asOf: "2026-09-24", notes: "$3.75 per $500 (or fraction) = 0.75%, FLAT (no tiers). Buyer/transferee liable (shifts to seller only if buyer exempt by state law). Commercial-relevant exemptions (Sec. 3-33-060): enterprise-zone property used primarily for commercial/industrial purposes; parent/subsidiary mergers; foreclosure/deed-in-lieu to lender. Transfers of controlling interests / 30+yr ground leases are taxable." },
      { name: "Chicago Real Property Transfer Tax — CTA portion", rate: 0.003, base: "price", party: "seller", source: S134, sourceUrl: S133, asOf: "2026-09-24", notes: "Supplemental $1.50 per $500 = 0.30% (transfers on/after 4/1/2008), seller/transferor liable. Total Chicago = $5.25/$500 = 1.05%. 2024 'Bring Chicago Home' tiered referendum FAILED (3/19/2024, ~54% no); flat rate remains per the official DOF page." }
    ] },
  { id: "il-dupage-county-chicago-city", kind: "municipal", name: "Chicago city", county: "DuPage County", lines: [
      { name: "Chicago Real Property Transfer Tax — City portion", rate: 0.0075, base: "price", party: "buyer", source: S132, sourceUrl: S133, asOf: "2026-09-24", notes: "$3.75 per $500 (or fraction) = 0.75%, FLAT (no tiers). Buyer/transferee liable (shifts to seller only if buyer exempt by state law). Commercial-relevant exemptions (Sec. 3-33-060): enterprise-zone property used primarily for commercial/industrial purposes; parent/subsidiary mergers; foreclosure/deed-in-lieu to lender. Transfers of controlling interests / 30+yr ground leases are taxable." },
      { name: "Chicago Real Property Transfer Tax — CTA portion", rate: 0.003, base: "price", party: "seller", source: S134, sourceUrl: S133, asOf: "2026-09-24", notes: "Supplemental $1.50 per $500 = 0.30% (transfers on/after 4/1/2008), seller/transferor liable. Total Chicago = $5.25/$500 = 1.05%. 2024 'Bring Chicago Home' tiered referendum FAILED (3/19/2024, ~54% no); flat rate remains per the official DOF page." }
    ] },
  { id: "il-cook-county-evanston-city", kind: "municipal", verify: "Evanston's tiers are modeled as whole-price (0.9% of the full price above $5M) from the city's range table; the code text wasn't retrieved.", name: "Evanston city", county: "Cook County", lines: [
      { name: "Evanston Real Estate Transfer Tax", rate: 0.009, tiers: [{ over: 0, rate: 0.005 }, { over: 1500000, rate: 0.007 }, { over: 5000000, rate: 0.009 }], base: "price", party: "seller", source: S135, sourceUrl: S136, asOf: "2019-01-01", notes: "Sale price up to $1,500,000: $5/$1,000; $1,500,000.01–$5,000,000: $7/$1,000; over $5,000,000: $9/$1,000. Rate is selected by SALE PRICE RANGE and applied to the whole price (cliff) — the official table is keyed to the price range and published examples apply $7 to the full $1.5M; the code text itself (municode) could not be fetched to confirm verbatim. Seller pays. $100 exempt-stamp fee." }
    ] },
  { id: "il-cook-county-calumet-city-city", kind: "municipal", verify: "Bands above $2M come only from a 2011 title-underwriter record, and whole-price vs slice isn't confirmed (another list shows a flat $8/$1,000).", name: "Calumet City city", county: "Cook County", lines: [
      { name: "Calumet City Real Estate Transfer Tax", rate: 0.016, tiers: [{ over: 0, rate: 0.008 }, { over: 2000000, rate: 0.01 }, { over: 5000000, rate: 0.012 }, { over: 10000000, rate: 0.014 }, { over: 20000000, rate: 0.016 }], base: "price", party: "split", verify: true, source: S137, sourceUrl: S138, asOf: "2011-02-07", notes: "ATG: 'Transfers less than $2M: $8.00/1,000; $2M-$5M: $10/1,000; $5M-$10M: $12/1,000; $10M-$20M: $14/1,000; Over $20M: $16.00/1,000 (round to nearest $1,000)'; 50/50 split. First American 11/2024 list shows only $8.00/$1,000 (residential-focused). Cliff vs marginal NOT verified against the ordinance text — treat >$2M bands as UNVERIFIED; confirm with Calumet City clerk. UNCONFIRMED: bands above $2M come only from ATG (last updated 2011) and whole-price vs slice is not confirmed; First American shows a flat $8/$1,000. Confirm with title." }
    ] },
  { id: "il-lake-county-highwood-city", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Highwood city", county: "Lake County", lines: [
      { name: "Highwood Real Estate Transfer Tax (Fort Sheridan area ONLY)", rate: 0.005, base: "price", party: "seller", source: S139, sourceUrl: S140, asOf: "2011-02-07", notes: "Applies ONLY within the Fort Sheridan annexation area of Highwood; rest of Highwood has no transfer tax (pre-transfer inspection only; $120 commercial). ATG entry last updated 2011 — confirm." }
    ] },
  { id: "il-cook-county-franklin-park-village", kind: "municipal", verify: "Rate from the ATG title-underwriter ordinance database (cross-checked against First American's 11/2024 list), not the village/city's own website. Confirm with the municipality or title.", name: "Franklin Park village", county: "Cook County", lines: [
      { name: "Franklin Park transfer stamp (fee schedule)", rate: 0, base: "price", party: "seller", source: S141, sourceUrl: S142, asOf: "2017-02-07", notes: "Not a %-of-price tax: flat fee by property type (ATG: '$40 minimum, depending on property type'; First American: '$80 flat fee - single dwelling'). Commercial fee NOT verified — confirm with village." }
    ] },
  { id: "il-algonquin", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Algonquin", lines: [] },
  { id: "il-arlington-heights", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Arlington Heights", lines: [] },
  { id: "il-barrington", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Barrington", lines: [] },
  { id: "il-batavia", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Batavia", lines: [] },
  { id: "il-bensenville", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Bensenville", lines: [] },
  { id: "il-bloomingdale", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Bloomingdale", lines: [] },
  { id: "il-broadview", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Broadview", lines: [] },
  { id: "il-brookfield", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Brookfield", lines: [] },
  { id: "il-carpentersville", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Carpentersville", lines: [] },
  { id: "il-clarendon-hills", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Clarendon Hills", lines: [] },
  { id: "il-crystal-lake", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Crystal Lake", lines: [] },
  { id: "il-darien", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Darien", lines: [] },
  { id: "il-deerfield", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Deerfield", lines: [] },
  { id: "il-dekalb", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "DeKalb", lines: [] },
  { id: "il-downers-grove", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Downers Grove", lines: [] },
  { id: "il-elgin", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Elgin", lines: [] },
  { id: "il-flossmoor", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Flossmoor", lines: [] },
  { id: "il-fox-river-grove", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Fox River Grove", lines: [] },
  { id: "il-frankfort", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Frankfort", lines: [] },
  { id: "il-glencoe", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Glencoe", lines: [] },
  { id: "il-glenview", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Glenview", lines: [] },
  { id: "il-golf", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Golf", lines: [] },
  { id: "il-green-oaks", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Green Oaks", lines: [] },
  { id: "il-gurnee", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Gurnee", lines: [] },
  { id: "il-hainesville", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Hainesville", lines: [] },
  { id: "il-hampshire", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Hampshire", lines: [] },
  { id: "il-harvard", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Harvard", lines: [] },
  { id: "il-hazel-crest", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Hazel Crest", lines: [] },
  { id: "il-hickory-hills", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Hickory Hills", lines: [] },
  { id: "il-hinsdale", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Hinsdale", lines: [] },
  { id: "il-hometown", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Hometown", lines: [] },
  { id: "il-homewood", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Homewood", lines: [] },
  { id: "il-huntley", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Huntley", lines: [] },
  { id: "il-indian-head-park", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Indian Head Park", lines: [] },
  { id: "il-island-lake", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Island Lake", lines: [] },
  { id: "il-itasca", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Itasca", lines: [] },
  { id: "il-johnsburg", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Johnsburg", lines: [] },
  { id: "il-justice", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Justice", lines: [] },
  { id: "il-la-grange-park", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "La Grange Park", lines: [] },
  { id: "il-lake-bluff", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Lake Bluff", lines: [] },
  { id: "il-lake-in-the-hills", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Lake in the Hills", lines: [] },
  { id: "il-lake-villa", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Lake Villa", lines: [] },
  { id: "il-lake-zurich", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Lake Zurich", lines: [] },
  { id: "il-lakemoor", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Lakemoor", lines: [] },
  { id: "il-lansing", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Lansing", lines: [] },
  { id: "il-lemont", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Lemont", lines: [] },
  { id: "il-leyden-township", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Leyden Township", lines: [] },
  { id: "il-libertyville", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Libertyville", lines: [] },
  { id: "il-lincolnwood", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Lincolnwood", lines: [] },
  { id: "il-lisle", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Lisle", lines: [] },
  { id: "il-lockport", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Lockport", lines: [] },
  { id: "il-lombard", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Lombard", lines: [] },
  { id: "il-lynwood", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Lynwood", lines: [] },
  { id: "il-lyons", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Lyons", lines: [] },
  { id: "il-manteno", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Manteno", lines: [] },
  { id: "il-matteson", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Matteson", lines: [] },
  { id: "il-melrose-park", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Melrose Park", lines: [] },
  { id: "il-midlothian", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Midlothian", lines: [] },
  { id: "il-mokena", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Mokena", lines: [] },
  { id: "il-monee", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Monee", lines: [] },
  { id: "il-mundelein", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Mundelein", lines: [] },
  { id: "il-new-lenox", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "New Lenox", lines: [] },
  { id: "il-north-aurora", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "North Aurora", lines: [] },
  { id: "il-north-riverside", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "North Riverside", lines: [] },
  { id: "il-northbrook", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Northbrook", lines: [] },
  { id: "il-northfield", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Northfield", lines: [] },
  { id: "il-oak-brook", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Oak Brook", lines: [] },
  { id: "il-oak-forest", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Oak Forest", lines: [] },
  { id: "il-oakbrook-terrace", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Oakbrook Terrace", lines: [] },
  { id: "il-olympia-fields", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Olympia Fields", lines: [] },
  { id: "il-orland-park", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Orland Park", lines: [] },
  { id: "il-palatine", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Palatine", lines: [] },
  { id: "il-palos-heights", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Palos Heights", lines: [] },
  { id: "il-palos-hills", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Palos Hills", lines: [] },
  { id: "il-phoenix", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Phoenix", lines: [] },
  { id: "il-plainfield", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Plainfield", lines: [] },
  { id: "il-posen", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Posen", lines: [] },
  { id: "il-richton-park", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Richton Park", lines: [] },
  { id: "il-river-grove", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "River Grove", lines: [] },
  { id: "il-riverdale", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Riverdale", lines: [] },
  { id: "il-riverside", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Riverside", lines: [] },
  { id: "il-roselle", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Roselle", lines: [] },
  { id: "il-rosemont", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Rosemont", lines: [] },
  { id: "il-round-lake-beach", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Round Lake Beach", lines: [] },
  { id: "il-round-lake-heights", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Round Lake Heights", lines: [] },
  { id: "il-round-lake-park", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Round Lake Park", lines: [] },
  { id: "il-sauk-village", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Sauk Village", lines: [] },
  { id: "il-schiller-park", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Schiller Park", lines: [] },
  { id: "il-shorewood", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Shorewood", lines: [] },
  { id: "il-sleepy-hollow", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Sleepy Hollow", lines: [] },
  { id: "il-south-chicago-heights", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "South Chicago Heights", lines: [] },
  { id: "il-south-elgin", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "South Elgin", lines: [] },
  { id: "il-south-holland", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "South Holland", lines: [] },
  { id: "il-st-charles", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "St. Charles", lines: [] },
  { id: "il-steger", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Steger", lines: [] },
  { id: "il-sugar-grove", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Sugar Grove", lines: [] },
  { id: "il-summit", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Summit", lines: [] },
  { id: "il-thornton", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Thornton", lines: [] },
  { id: "il-tinley-park", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Tinley Park", lines: [] },
  { id: "il-villa-park", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Villa Park", lines: [] },
  { id: "il-wauconda", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Wauconda", lines: [] },
  { id: "il-waukegan", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Waukegan", lines: [] },
  { id: "il-west-chicago", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "West Chicago", lines: [] },
  { id: "il-west-dundee", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "West Dundee", lines: [] },
  { id: "il-western-springs", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Western Springs", lines: [] },
  { id: "il-wheeling", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Wheeling", lines: [] },
  { id: "il-willowbrook", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Willowbrook", lines: [] },
  { id: "il-winfield", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Winfield", lines: [] },
  { id: "il-winnetka", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Winnetka", lines: [] },
  { id: "il-winthrop-harbor", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Winthrop Harbor", lines: [] },
  { id: "il-woodstock", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Woodstock", lines: [] },
  { id: "il-worth", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Worth", lines: [] },
  { id: "il-yorkville", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Yorkville", lines: [] },
  { id: "il-zion", kind: "municipal", verify: "'No municipal transfer tax' is per the ATG title-underwriter database, not the municipality itself (some still charge flat compliance/inspection stamp fees). Confirm with title.", name: "Zion", lines: [] },
  ],
};
