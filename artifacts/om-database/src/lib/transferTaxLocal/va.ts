// GENERATED from official-source research (VA.auto.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: county. Local table complete: True.
// Local-level source: Code of Va. §§58.1-3800, 58.1-802.3, 58.1-802.4, 58.1-802.5; OES Circuit Court Fee Schedule (Rev 07/26) (https://www.vacourts.gov/static/courts/circuit/resources/manuals/appendixc.pdf) as of 2026-07-01.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "Code of Va. §58.1-802.3";
const S1 = "https://law.lis.virginia.gov/vacode/title58.1/chapter8/section58.1-802.3/";
const S2 = "Code of Va. §58.1-802.4 (Planning District 8; funds to §33.2-2509 NVTA Fund)";
const S3 = "https://law.lis.virginia.gov/vacode/title58.1/chapter8/section58.1-802.4/";
const S4 = "Code of Va. §58.1-802.5; OES Circuit Court Fee Schedule (Rev 07/26) acct 022";
const S5 = "https://law.lis.virginia.gov/vacode/title58.1/chapter8/section58.1-802.5/";
const F0 = (rate: number, notes?: string): TaxLineItem => ({ name: "Regional WMATA Capital Fee (grantor)", rate, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2026-09-24", ...(notes ? { notes } : {}) });
const F1 = (rate: number, notes?: string): TaxLineItem => ({ name: "Regional Congestion Relief Fee (grantor)", rate, base: "price", party: "seller", source: S2, sourceUrl: S3, asOf: "2026-09-24", ...(notes ? { notes } : {}) });
const F2 = (rate: number, notes?: string): TaxLineItem => ({ name: "Hampton Roads Regional Transit Fund fee (grantor)", rate, base: "price", party: "seller", source: S4, sourceUrl: S5, asOf: "2026-09-24", ...(notes ? { notes } : {}) });

export const VA_LOCAL_LEVEL = "county" as const;
export const VA_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "Code of Va. §§58.1-3800, 58.1-802.3, 58.1-802.4, 58.1-802.5; OES Circuit Court Fee Schedule (Rev 07/26)", sourceUrl: "https://www.vacourts.gov/static/courts/circuit/resources/manuals/appendixc.pdf", asOf: "2026-07-01",
  statement: "Localities (counties and independent cities) levy the 1/3 local recordation; the only locality-specific grantor add-ons are the NoVA WMATA + congestion-relief fees and the Hampton Roads transit fee.",
};

export const VA_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: true,
  muniAbsentMeansNone: false,
  entries: [
  { id: "va-arlington-county", kind: "county", name: "Arlington County", county: "Arlington County", lines: [
      F0(0.001, "$0.10 per $100 in NVTA member counties/cities; paid by grantor."),
      F1(0.001, "$0.10 per $100 in Planning District 8; paid by grantor.")
    ] },
  { id: "va-fairfax-county", kind: "county", name: "Fairfax County", county: "Fairfax County", lines: [
      F0(0.001, "$0.10 per $100 in NVTA member counties/cities; paid by grantor."),
      F1(0.001, "$0.10 per $100 in Planning District 8; paid by grantor.")
    ] },
  { id: "va-loudoun-county", kind: "county", name: "Loudoun County", county: "Loudoun County", lines: [
      F0(0.001, "$0.10 per $100 in NVTA member counties/cities; paid by grantor."),
      F1(0.001, "$0.10 per $100 in Planning District 8; paid by grantor.")
    ] },
  { id: "va-prince-william-county", kind: "county", name: "Prince William County", county: "Prince William County", lines: [
      F0(0.001, "$0.10 per $100 in NVTA member counties/cities; paid by grantor."),
      F1(0.001, "$0.10 per $100 in Planning District 8; paid by grantor.")
    ] },
  { id: "va-alexandria-city", kind: "county", name: "Alexandria city", county: "Alexandria city", lines: [
      F0(0.001, "$0.10 per $100 in NVTA member counties/cities; paid by grantor."),
      F1(0.001, "$0.10 per $100 in Planning District 8; paid by grantor.")
    ] },
  { id: "va-fairfax-city", kind: "county", name: "Fairfax city", county: "Fairfax city", lines: [
      F0(0.001, "$0.10 per $100 in NVTA member counties/cities; paid by grantor."),
      F1(0.001, "$0.10 per $100 in Planning District 8; paid by grantor.")
    ] },
  { id: "va-falls-church-city", kind: "county", name: "Falls Church city", county: "Falls Church city", lines: [
      F0(0.001, "$0.10 per $100 in NVTA member counties/cities; paid by grantor."),
      F1(0.001, "$0.10 per $100 in Planning District 8; paid by grantor.")
    ] },
  { id: "va-manassas-city", kind: "county", name: "Manassas city", county: "Manassas city", lines: [
      F0(0.001, "$0.10 per $100 in NVTA member counties/cities; paid by grantor."),
      F1(0.001, "$0.10 per $100 in Planning District 8; paid by grantor.")
    ] },
  { id: "va-manassas-park-city", kind: "county", name: "Manassas Park city", county: "Manassas Park city", lines: [
      F0(0.001, "$0.10 per $100 in NVTA member counties/cities; paid by grantor."),
      F1(0.001, "$0.10 per $100 in Planning District 8; paid by grantor.")
    ] },
  { id: "va-chesapeake-city", kind: "county", name: "Chesapeake city", county: "Chesapeake city", lines: [
      F2(0.0006, "$0.06 per $100 on realty in a county/city in the Hampton Roads transportation district created under §33.2-1903 (the HRT district — the six cities HRT serves). Paid by grantor.")
    ] },
  { id: "va-hampton-city", kind: "county", name: "Hampton city", county: "Hampton city", lines: [
      F2(0.0006, "$0.06 per $100 on realty in a county/city in the Hampton Roads transportation district created under §33.2-1903 (the HRT district — the six cities HRT serves). Paid by grantor.")
    ] },
  { id: "va-newport-news-city", kind: "county", name: "Newport News city", county: "Newport News city", lines: [
      F2(0.0006, "$0.06 per $100 on realty in a county/city in the Hampton Roads transportation district created under §33.2-1903 (the HRT district — the six cities HRT serves). Paid by grantor.")
    ] },
  { id: "va-norfolk-city", kind: "county", name: "Norfolk city", county: "Norfolk city", lines: [
      F2(0.0006, "$0.06 per $100 on realty in a county/city in the Hampton Roads transportation district created under §33.2-1903 (the HRT district — the six cities HRT serves). Paid by grantor.")
    ] },
  { id: "va-portsmouth-city", kind: "county", name: "Portsmouth city", county: "Portsmouth city", lines: [
      F2(0.0006, "$0.06 per $100 on realty in a county/city in the Hampton Roads transportation district created under §33.2-1903 (the HRT district — the six cities HRT serves). Paid by grantor.")
    ] },
  { id: "va-virginia-beach-city", kind: "county", name: "Virginia Beach city", county: "Virginia Beach city", lines: [
      F2(0.0006, "$0.06 per $100 on realty in a county/city in the Hampton Roads transportation district created under §33.2-1903 (the HRT district — the six cities HRT serves). Paid by grantor.")
    ] },
  ],
};
