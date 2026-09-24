// GENERATED from official-source research (DE.auto.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: municipality. Local table complete: True.
// Local-level source: Kent/Sussex/New Castle County Recorder of Deeds rate sheets + 30 Del. C. §5402 (https://www.kentcountyde.gov/files/sharedassets/public/v/1/content-publishers/deeds/deeds-pdf/forms-new/realty-transfer-tax-rates.pdf) as of 2025-05-23.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "Kent County Recorder of Deeds — Realty Transfer Tax Rates (KCROD-10.0)";
const S1 = "https://www.kentcountyde.gov/files/sharedassets/public/v/1/content-publishers/deeds/deeds-pdf/forms-new/realty-transfer-tax-rates.pdf";
const S2 = "30 Del. C. §5402(a)";
const S3 = "https://delcode.delaware.gov/title30/c054/sc01/index.html";
const S4 = "Sussex County Recorder of Deeds — Town Transfer Tax sheet (rev. 9-1-2020)";
const S5 = "https://sussexcountyde.gov/sites/default/files/PDFs/ROD_Town_Transfer_Tax.pdf";
const S6 = "New Castle County Recorder of Deeds — Transfer Tax Information Sheet";
const S7 = "https://newcastlede.gov/DocumentCenter/View/35/Transfer-Tax-Information-Sheet-PDF";

export const DE_LOCAL_LEVEL = "municipality" as const;
export const DE_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "Kent/Sussex/New Castle County Recorder of Deeds rate sheets + 30 Del. C. §5402", sourceUrl: "https://www.kentcountyde.gov/files/sharedassets/public/v/1/content-publishers/deeds/deeds-pdf/forms-new/realty-transfer-tax-rates.pdf", asOf: "2025-05-23",
  statement: "Local tax is levied by the county in unincorporated areas and by municipalities within town limits (one local levy, not both). All three county recorders publish their lists.",
};

export const DE_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: false,
  muniAbsentMeansNone: false,
  placeBased: true,
  entries: [
  { id: "de-kent-county-unincorporated", kind: "municipal", name: "Unincorporated Kent County", county: "Kent County", match: ["unincorporated"], lines: [
      { name: "Local Realty Transfer Tax — Kent County (unincorporated)", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Unincorporated Kent County 1.5%." }
    ] },
  { id: "de-kent-county-bowers-town", kind: "municipal", name: "Bowers town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Bowers town", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-camden-town", kind: "municipal", name: "Camden town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Camden town", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-cheswold-town", kind: "municipal", name: "Cheswold town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Cheswold town", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-clayton-town", kind: "municipal", name: "Clayton town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Clayton town", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-dover-city", kind: "municipal", name: "Dover city", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Dover city", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-farmington-town", kind: "municipal", name: "Farmington town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Farmington town", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-felton-town", kind: "municipal", name: "Felton town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Felton town", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-frederica-town", kind: "municipal", name: "Frederica town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Frederica town", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-harrington-city", kind: "municipal", name: "Harrington city", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Harrington city", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-hartly-town", kind: "municipal", name: "Hartly town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Hartly town", rate: 0.01, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate). Chart shows town 1% / state 3% (total still 4%)." },
      { name: "State RTT top-up (3.0% state rate applies where local levy is below the full 1.5%)", rate: 0.005, base: "price", party: "split", source: S2, sourceUrl: S3, asOf: "2026-09-24", notes: "State rate is 3% unless the municipality/county has enacted the full 1.5%; so state 3.0% + local = total." }
    ] },
  { id: "de-kent-county-houston-town", kind: "municipal", name: "Houston town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Houston town", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-kenton-town", kind: "municipal", name: "Kenton town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Kenton town", rate: 0.01, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate). Chart shows town 1% / state 3% (total still 4%)." },
      { name: "State RTT top-up (3.0% state rate applies where local levy is below the full 1.5%)", rate: 0.005, base: "price", party: "split", source: S2, sourceUrl: S3, asOf: "2026-09-24", notes: "State rate is 3% unless the municipality/county has enacted the full 1.5%; so state 3.0% + local = total." }
    ] },
  { id: "de-kent-county-leipsic-town", kind: "municipal", name: "Leipsic town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Leipsic town", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-little-creek-town", kind: "municipal", name: "Little Creek town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Little Creek town", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-magnolia-town", kind: "municipal", name: "Magnolia town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Magnolia town", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-milford-city", kind: "municipal", name: "Milford city", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Milford city", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-smyrna-town", kind: "municipal", name: "Smyrna town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Smyrna town", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-viola-town", kind: "municipal", name: "Viola town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Viola town", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-kent-county-woodside-town", kind: "municipal", name: "Woodside town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Woodside town", rate: 0.01, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate). Chart shows town 1% / state 3% (total still 4%)." },
      { name: "State RTT top-up (3.0% state rate applies where local levy is below the full 1.5%)", rate: 0.005, base: "price", party: "split", source: S2, sourceUrl: S3, asOf: "2026-09-24", notes: "State rate is 3% unless the municipality/county has enacted the full 1.5%; so state 3.0% + local = total." }
    ] },
  { id: "de-kent-county-wyoming-town", kind: "municipal", name: "Wyoming town", county: "Kent County", lines: [
      { name: "Local Realty Transfer Tax — Wyoming town", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-05-23", notes: "Rate per Kent County chart (town rate / state rate)." }
    ] },
  { id: "de-sussex-county-unincorporated", kind: "municipal", name: "Unincorporated Sussex County", county: "Sussex County", match: ["unincorporated"], lines: [
      { name: "Local Realty Transfer Tax — Sussex County (unincorporated)", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "1.50% Sussex County unincorporated realty transfer tax." }
    ] },
  { id: "de-sussex-county-bethany-beach-town", kind: "municipal", name: "Bethany Beach town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Bethany Beach town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-bethel-town", kind: "municipal", name: "Bethel town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Bethel town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-blades-town", kind: "municipal", name: "Blades town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Blades town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-bridgeville-town", kind: "municipal", name: "Bridgeville town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Bridgeville town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-dagsboro-town", kind: "municipal", name: "Dagsboro town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Dagsboro town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-delmar-town", kind: "municipal", name: "Delmar town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Delmar town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-dewey-beach-town", kind: "municipal", name: "Dewey Beach town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Dewey Beach town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-ellendale-town", kind: "municipal", name: "Ellendale town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Ellendale town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-fenwick-island-town", kind: "municipal", name: "Fenwick Island town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Fenwick Island town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-frankford-town", kind: "municipal", name: "Frankford town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Frankford town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-georgetown-town", kind: "municipal", name: "Georgetown town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Georgetown town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-greenwood-town", kind: "municipal", name: "Greenwood town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Greenwood town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-henlopen-acres-town", kind: "municipal", name: "Henlopen Acres town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Henlopen Acres town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-laurel-town", kind: "municipal", name: "Laurel town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Laurel town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-lewes-city", kind: "municipal", name: "Lewes city", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Lewes city", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-millsboro-town", kind: "municipal", name: "Millsboro town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Millsboro town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-millville-town", kind: "municipal", name: "Millville town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Millville town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-milton-town", kind: "municipal", name: "Milton town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Milton town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-ocean-view-town", kind: "municipal", name: "Ocean View town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Ocean View town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-rehoboth-beach-city", kind: "municipal", name: "Rehoboth Beach city", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Rehoboth Beach city", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-seaford-city", kind: "municipal", name: "Seaford city", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Seaford city", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-selbyville-town", kind: "municipal", name: "Selbyville town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Selbyville town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-slaughter-beach-town", kind: "municipal", name: "Slaughter Beach town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — Slaughter Beach town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-sussex-county-south-bethany-town", kind: "municipal", name: "South Bethany town", county: "Sussex County", lines: [
      { name: "Local Realty Transfer Tax — South Bethany town", rate: 0.015, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2020-09-01", notes: "Listed as a levying town; sheet states 'Town Transfer Tax 1.50% (no change)'. Individual town ordinance rates not separately published — confirm." }
    ] },
  { id: "de-new-castle-county-unincorporated", kind: "municipal", name: "Unincorporated New Castle County", county: "New Castle County", match: ["unincorporated"], lines: [
      { name: "Local Realty Transfer Tax — New Castle County (unincorporated)", rate: 0.015, base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2022-02-17", notes: "New Castle County 1.50% (unincorporated)." }
    ] },
  { id: "de-new-castle-county-arden-village", kind: "municipal", name: "Arden village", county: "New Castle County", lines: [
      { name: "State RTT (no local transfer tax — 3% state only)", rate: 0.005, base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2022-02-17", notes: "Sheet: 'No Local Transfer Tax 3% tax required' — state 3.0% total (this line is the 0.5% top-up over the 2.5% state line; NO local tax)." }
    ] },
  { id: "de-new-castle-county-ardentown-village", kind: "municipal", name: "Ardentown village", county: "New Castle County", lines: [
      { name: "State RTT (no local transfer tax — 3% state only)", rate: 0.005, base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2022-02-17", notes: "Sheet: 'No Local Transfer Tax 3% tax required' — state 3.0% total (this line is the 0.5% top-up over the 2.5% state line; NO local tax)." }
    ] },
  { id: "de-new-castle-county-ardencroft-village", kind: "municipal", name: "Ardencroft village", county: "New Castle County", lines: [
      { name: "State RTT (no local transfer tax — 3% state only)", rate: 0.005, base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2022-02-17", notes: "Sheet: 'No Local Transfer Tax 3% tax required' — state 3.0% total (this line is the 0.5% top-up over the 2.5% state line; NO local tax)." }
    ] },
  { id: "de-new-castle-county-bellefonte-town", kind: "municipal", verify: "New Castle County's sheet lists this town as levying a local tax but doesn't print the rate; 1.5% is inferred from the 2.5% state rate. Confirm with the town.", name: "Bellefonte town", county: "New Castle County", lines: [
      { name: "Local Realty Transfer Tax — Bellefonte town", rate: 0.015, base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2022-02-17", notes: "Listed as levying a municipal transfer tax (2 State affidavits; state 2.5%). The sheet does not print the municipal rate — 1.5% inferred from the 2.5% state rate (30 Del. C. §5402 drops the state to 2.5% only where the full 1.5% is enacted). Confirm." }
    ] },
  { id: "de-new-castle-county-delaware-city-city", kind: "municipal", verify: "New Castle County's sheet lists this town as levying a local tax but doesn't print the rate; 1.5% is inferred from the 2.5% state rate. Confirm with the town.", name: "Delaware City city", county: "New Castle County", lines: [
      { name: "Local Realty Transfer Tax — Delaware City city", rate: 0.015, base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2022-02-17", notes: "Listed as levying a municipal transfer tax (2 State affidavits; state 2.5%). The sheet does not print the municipal rate — 1.5% inferred from the 2.5% state rate (30 Del. C. §5402 drops the state to 2.5% only where the full 1.5% is enacted). Confirm." }
    ] },
  { id: "de-new-castle-county-elsmere-town", kind: "municipal", verify: "New Castle County's sheet lists this town as levying a local tax but doesn't print the rate; 1.5% is inferred from the 2.5% state rate. Confirm with the town.", name: "Elsmere town", county: "New Castle County", lines: [
      { name: "Local Realty Transfer Tax — Elsmere town", rate: 0.015, base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2022-02-17", notes: "Listed as levying a municipal transfer tax (2 State affidavits; state 2.5%). The sheet does not print the municipal rate — 1.5% inferred from the 2.5% state rate (30 Del. C. §5402 drops the state to 2.5% only where the full 1.5% is enacted). Confirm." }
    ] },
  { id: "de-new-castle-county-new-castle-city", kind: "municipal", verify: "New Castle County's sheet lists this town as levying a local tax but doesn't print the rate; 1.5% is inferred from the 2.5% state rate. Confirm with the town.", name: "New Castle city", county: "New Castle County", lines: [
      { name: "Local Realty Transfer Tax — New Castle city", rate: 0.015, base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2022-02-17", notes: "Listed as levying a municipal transfer tax (2 State affidavits; state 2.5%). The sheet does not print the municipal rate — 1.5% inferred from the 2.5% state rate (30 Del. C. §5402 drops the state to 2.5% only where the full 1.5% is enacted). Confirm." }
    ] },
  { id: "de-new-castle-county-newark-city", kind: "municipal", verify: "New Castle County's sheet lists this town as levying a local tax but doesn't print the rate; 1.5% is inferred from the 2.5% state rate. Confirm with the town.", name: "Newark city", county: "New Castle County", lines: [
      { name: "Local Realty Transfer Tax — Newark city", rate: 0.015, base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2022-02-17", notes: "Listed as levying a municipal transfer tax (2 State affidavits; state 2.5%). The sheet does not print the municipal rate — 1.5% inferred from the 2.5% state rate (30 Del. C. §5402 drops the state to 2.5% only where the full 1.5% is enacted). Confirm." }
    ] },
  { id: "de-new-castle-county-newport-town", kind: "municipal", verify: "New Castle County's sheet lists this town as levying a local tax but doesn't print the rate; 1.5% is inferred from the 2.5% state rate. Confirm with the town.", name: "Newport town", county: "New Castle County", lines: [
      { name: "Local Realty Transfer Tax — Newport town", rate: 0.015, base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2022-02-17", notes: "Listed as levying a municipal transfer tax (2 State affidavits; state 2.5%). The sheet does not print the municipal rate — 1.5% inferred from the 2.5% state rate (30 Del. C. §5402 drops the state to 2.5% only where the full 1.5% is enacted). Confirm." }
    ] },
  { id: "de-new-castle-county-middletown-town", kind: "municipal", verify: "New Castle County's sheet lists this town as levying a local tax but doesn't print the rate; 1.5% is inferred from the 2.5% state rate. Confirm with the town.", name: "Middletown town", county: "New Castle County", lines: [
      { name: "Local Realty Transfer Tax — Middletown town", rate: 0.015, base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2022-02-17", notes: "Listed as levying a municipal transfer tax (2 State affidavits; state 2.5%). The sheet does not print the municipal rate — 1.5% inferred from the 2.5% state rate (30 Del. C. §5402 drops the state to 2.5% only where the full 1.5% is enacted). Confirm." }
    ] },
  { id: "de-new-castle-county-odessa-town", kind: "municipal", verify: "New Castle County's sheet lists this town as levying a local tax but doesn't print the rate; 1.5% is inferred from the 2.5% state rate. Confirm with the town.", name: "Odessa town", county: "New Castle County", lines: [
      { name: "Local Realty Transfer Tax — Odessa town", rate: 0.015, base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2022-02-17", notes: "Listed as levying a municipal transfer tax (2 State affidavits; state 2.5%). The sheet does not print the municipal rate — 1.5% inferred from the 2.5% state rate (30 Del. C. §5402 drops the state to 2.5% only where the full 1.5% is enacted). Confirm." }
    ] },
  { id: "de-new-castle-county-townsend-town", kind: "municipal", verify: "New Castle County's sheet lists this town as levying a local tax but doesn't print the rate; 1.5% is inferred from the 2.5% state rate. Confirm with the town.", name: "Townsend town", county: "New Castle County", lines: [
      { name: "Local Realty Transfer Tax — Townsend town", rate: 0.015, base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2022-02-17", notes: "Listed as levying a municipal transfer tax (2 State affidavits; state 2.5%). The sheet does not print the municipal rate — 1.5% inferred from the 2.5% state rate (30 Del. C. §5402 drops the state to 2.5% only where the full 1.5% is enacted). Confirm." }
    ] },
  { id: "de-new-castle-county-wilmington-city", kind: "municipal", verify: "New Castle County's sheet lists this town as levying a local tax but doesn't print the rate; 1.5% is inferred from the 2.5% state rate. Confirm with the town.", name: "Wilmington city", county: "New Castle County", lines: [
      { name: "Local Realty Transfer Tax — Wilmington city", rate: 0.015, base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2022-02-17", notes: "Listed as levying a municipal transfer tax (2 State affidavits; state 2.5%). The sheet does not print the municipal rate — 1.5% inferred from the 2.5% state rate (30 Del. C. §5402 drops the state to 2.5% only where the full 1.5% is enacted). Confirm." }
    ] },
  ],
};
