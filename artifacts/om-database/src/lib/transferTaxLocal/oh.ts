// GENERATED from official-source research (OH.prep.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: county. Local table complete: True.
// Local-level source: Ohio Department of Taxation, 2025 Annual Report, "Real Property Conveyance Fees" (FY2025), p.136 (https://dam.assets.ohio.gov/image/upload/tax.ohio.gov/communications/publications/annual_reports/2025annualreport.pdf) as of 2025-01-01.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "Ohio Department of Taxation, Table PC-1 \"Real Property Conveyance Fees, Calendar Year 2024\" (July 10, 2025), permissive rate per thousand by county (survey of county auditors)";
const S1 = "https://dam.assets.ohio.gov/raw/upload/tax.ohio.gov/tax_analysis/tax_data_series/real_estate_and_public_utility/pc1/PC1CY24.xlsx";
const F0 = (rate: number, notes?: string): TaxLineItem => ({ name: "Real Property Conveyance Fee (county)", rate, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2025-07-10", ...(notes ? { notes } : {}) });

export const OH_LOCAL_LEVEL = "county" as const;
export const OH_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "Ohio Department of Taxation, 2025 Annual Report, \"Real Property Conveyance Fees\" (FY2025), p.136", sourceUrl: "https://dam.assets.ohio.gov/image/upload/tax.ohio.gov/communications/publications/annual_reports/2025annualreport.pdf", asOf: "2025-01-01",
  statement: "\"The fee consists of two parts: (1) a statewide mandatory fee of 1 mill ... and applies in all 88 counties and (2) an optional county permissive real property transfer fee of up to 3 mills ... The revenue from both the mandatory fee and the permissive fee is deposited into the general revenue fund of the county.\" \"The real property conveyance fee is paid by persons that transfer real estate.\" Survey data for 2024: all 88 counties levy a permissive fee of 1 to 3 mills. No municipal transfer tax exists in Ohio. stateLines is left EMPTY because the mandatory $1 is a county fee (not state revenue) — it is included in each county's single total line.",
};

export const OH_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: false,
  muniAbsentMeansNone: false,
  entries: [
  { id: "oh-adams-county", kind: "county", name: "Adams County", county: "Adams County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-allen-county", kind: "county", name: "Allen County", county: "Allen County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-ashland-county", kind: "county", name: "Ashland County", county: "Ashland County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-ashtabula-county", kind: "county", name: "Ashtabula County", county: "Ashtabula County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-athens-county", kind: "county", name: "Athens County", county: "Athens County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-auglaize-county", kind: "county", name: "Auglaize County", county: "Auglaize County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-belmont-county", kind: "county", name: "Belmont County", county: "Belmont County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-brown-county", kind: "county", name: "Brown County", county: "Brown County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-butler-county", kind: "county", name: "Butler County", county: "Butler County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-carroll-county", kind: "county", name: "Carroll County", county: "Carroll County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-champaign-county", kind: "county", name: "Champaign County", county: "Champaign County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-clark-county", kind: "county", name: "Clark County", county: "Clark County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-clermont-county", kind: "county", name: "Clermont County", county: "Clermont County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-clinton-county", kind: "county", name: "Clinton County", county: "Clinton County", lines: [
      F0(0.0035, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.50/$1,000 (R.C. 322.02) = $3.50/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-columbiana-county", kind: "county", name: "Columbiana County", county: "Columbiana County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-coshocton-county", kind: "county", name: "Coshocton County", county: "Coshocton County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-crawford-county", kind: "county", name: "Crawford County", county: "Crawford County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-cuyahoga-county", kind: "county", name: "Cuyahoga County", county: "Cuyahoga County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled). Confirmed $4.00/$1,000 total ($1 + $3) by the Cuyahoga County Fiscal Officer.")
    ] },
  { id: "oh-darke-county", kind: "county", name: "Darke County", county: "Darke County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-defiance-county", kind: "county", name: "Defiance County", county: "Defiance County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-delaware-county", kind: "county", name: "Delaware County", county: "Delaware County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled). Collections ratio slightly below 2x likely reflects a reduced homestead rate; commercial pays the full rate.")
    ] },
  { id: "oh-erie-county", kind: "county", name: "Erie County", county: "Erie County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-fairfield-county", kind: "county", name: "Fairfield County", county: "Fairfield County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-fayette-county", kind: "county", name: "Fayette County", county: "Fayette County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-franklin-county", kind: "county", name: "Franklin County", county: "Franklin County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled). County permits a lower permissive rate for homestead-exempt conveyances (hence CY2024 collections ratio < 2x); commercial pays the full rate.")
    ] },
  { id: "oh-fulton-county", kind: "county", name: "Fulton County", county: "Fulton County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-gallia-county", kind: "county", name: "Gallia County", county: "Gallia County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-geauga-county", kind: "county", name: "Geauga County", county: "Geauga County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-greene-county", kind: "county", name: "Greene County", county: "Greene County", lines: [
      F0(0.002, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $1.00/$1,000 (R.C. 322.02) = $2.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-guernsey-county", kind: "county", name: "Guernsey County", county: "Guernsey County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-hamilton-county", kind: "county", name: "Hamilton County", county: "Hamilton County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled). Temporary increase to $3 (2019) expired March 2021; back to $2 permissive.")
    ] },
  { id: "oh-hancock-county", kind: "county", name: "Hancock County", county: "Hancock County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-hardin-county", kind: "county", name: "Hardin County", county: "Hardin County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-harrison-county", kind: "county", name: "Harrison County", county: "Harrison County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-henry-county", kind: "county", name: "Henry County", county: "Henry County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-highland-county", kind: "county", name: "Highland County", county: "Highland County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-hocking-county", kind: "county", name: "Hocking County", county: "Hocking County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-holmes-county", kind: "county", name: "Holmes County", county: "Holmes County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-huron-county", kind: "county", name: "Huron County", county: "Huron County", lines: [
      F0(0.002, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $1.00/$1,000 (R.C. 322.02) = $2.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-jackson-county", kind: "county", name: "Jackson County", county: "Jackson County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-jefferson-county", kind: "county", name: "Jefferson County", county: "Jefferson County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-knox-county", kind: "county", name: "Knox County", county: "Knox County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-lake-county", kind: "county", name: "Lake County", county: "Lake County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-lawrence-county", kind: "county", name: "Lawrence County", county: "Lawrence County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-licking-county", kind: "county", name: "Licking County", county: "Licking County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-logan-county", kind: "county", name: "Logan County", county: "Logan County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-lorain-county", kind: "county", name: "Lorain County", county: "Lorain County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-lucas-county", kind: "county", name: "Lucas County", county: "Lucas County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-madison-county", kind: "county", name: "Madison County", county: "Madison County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-mahoning-county", kind: "county", name: "Mahoning County", county: "Mahoning County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-marion-county", kind: "county", name: "Marion County", county: "Marion County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-medina-county", kind: "county", name: "Medina County", county: "Medina County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-meigs-county", kind: "county", name: "Meigs County", county: "Meigs County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-mercer-county", kind: "county", name: "Mercer County", county: "Mercer County", lines: [
      F0(0.0035, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.50/$1,000 (R.C. 322.02) = $3.50/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-miami-county", kind: "county", name: "Miami County", county: "Miami County", lines: [
      F0(0.002, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $1.00/$1,000 (R.C. 322.02) = $2.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-monroe-county", kind: "county", name: "Monroe County", county: "Monroe County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-montgomery-county", kind: "county", name: "Montgomery County", county: "Montgomery County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-morgan-county", kind: "county", verify: "Ohio's CY2024 table lists a $2 permissive rate for Morgan but reports only $1 collected — a data anomaly. Confirm with the Morgan County auditor.", name: "Morgan County", county: "Morgan County", lines: [
      { name: "Real Property Conveyance Fee (county)", rate: 0.003, base: "price", party: "seller", verify: true, source: S0, sourceUrl: S1, asOf: "2025-07-10", notes: "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled). CY2024 table lists a $2 permissive rate but reports only $1 of permissive collections (data anomaly) — rate from the table used; verify with the Morgan County Auditor." }
    ] },
  { id: "oh-morrow-county", kind: "county", name: "Morrow County", county: "Morrow County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-muskingum-county", kind: "county", name: "Muskingum County", county: "Muskingum County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled). Permissive rate increased from $2 to $3 per $1,000 during 2024 (CY2023 table shows 2; CY2024 collections ratio 2.24x mandatory) — the $3 rate is the current one.")
    ] },
  { id: "oh-noble-county", kind: "county", name: "Noble County", county: "Noble County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-ottawa-county", kind: "county", name: "Ottawa County", county: "Ottawa County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-paulding-county", kind: "county", name: "Paulding County", county: "Paulding County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-perry-county", kind: "county", name: "Perry County", county: "Perry County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-pickaway-county", kind: "county", name: "Pickaway County", county: "Pickaway County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-pike-county", kind: "county", name: "Pike County", county: "Pike County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-portage-county", kind: "county", name: "Portage County", county: "Portage County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled). Confirmed $4.00/$1,000 total on the Portage County Auditor site.")
    ] },
  { id: "oh-preble-county", kind: "county", name: "Preble County", county: "Preble County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-putnam-county", kind: "county", name: "Putnam County", county: "Putnam County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-richland-county", kind: "county", name: "Richland County", county: "Richland County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-ross-county", kind: "county", name: "Ross County", county: "Ross County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-sandusky-county", kind: "county", name: "Sandusky County", county: "Sandusky County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-scioto-county", kind: "county", name: "Scioto County", county: "Scioto County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-seneca-county", kind: "county", name: "Seneca County", county: "Seneca County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-shelby-county", kind: "county", name: "Shelby County", county: "Shelby County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-stark-county", kind: "county", name: "Stark County", county: "Stark County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled). Confirmed $4.00/$1,000 total by the Stark County Auditor.")
    ] },
  { id: "oh-summit-county", kind: "county", name: "Summit County", county: "Summit County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-trumbull-county", kind: "county", name: "Trumbull County", county: "Trumbull County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-tuscarawas-county", kind: "county", name: "Tuscarawas County", county: "Tuscarawas County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-union-county", kind: "county", name: "Union County", county: "Union County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-van-wert-county", kind: "county", name: "Van Wert County", county: "Van Wert County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-vinton-county", kind: "county", name: "Vinton County", county: "Vinton County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-warren-county", kind: "county", name: "Warren County", county: "Warren County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-washington-county", kind: "county", name: "Washington County", county: "Washington County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-wayne-county", kind: "county", name: "Wayne County", county: "Wayne County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-williams-county", kind: "county", name: "Williams County", county: "Williams County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-wood-county", kind: "county", name: "Wood County", county: "Wood County", lines: [
      F0(0.003, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $2.00/$1,000 (R.C. 322.02) = $3.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled).")
    ] },
  { id: "oh-wyandot-county", kind: "county", name: "Wyandot County", county: "Wyandot County", lines: [
      F0(0.004, "Mandatory $1.00/$1,000 (R.C. 319.54(G)(3)) + county permissive $3.00/$1,000 (R.C. 322.02) = $4.00/$1,000. Both are county fees (all revenue to the county general fund). Paid by the grantor (seller) at transfer; plus $0.50/parcel transfer fee (not modeled). Confirmed $4.00/$1,000 total on the Wyandot County Auditor site.")
    ] },
  ],
};
