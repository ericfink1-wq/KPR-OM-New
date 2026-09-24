// GENERATED from official-source research (MD.auto.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: county. Local table complete: True.
// Local-level source: MD Dept of Legislative Services — Other Local Tax Rates in Maryland (FY2025/FY2026) + Guide to Local Government Taxing Authority (Aug 2026), Appendix 2 'Quick Reference Guide to Local Transfer Taxes' (https://dls.maryland.gov/pubs/prod/NoPblTabPDF/2026CountyLocalTaxRates.pdf) as of 2026-08-01.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "MD Dept of Legislative Services — 'Other Local Tax Rates in Maryland' (FY2026 recordation per $500 & transfer %)";
const S1 = "https://dls.maryland.gov/pubs/prod/NoPblTabPDF/2026CountyLocalTaxRates.pdf";
const S2 = "Anne Arundel County Finance — Recordation and Transfer Tax";
const S3 = "https://www.aacounty.org/finance/tax-information/recordation-and-transfer-tax";
const S4 = "DLS Guide to Local Government Taxing Authority (Aug 2026), Montgomery County";
const S5 = "https://dls.maryland.gov/pubs/prod/InterGovMatters/LocFinTaxRte/FinalGuidetoLocalGovernmentTaxingAuthority.pdf";
const S6 = "Montgomery County Dept of Finance — Bill 17-23 recordation tiers + official calculation examples";
const S7 = "https://www.montgomerycountymd.gov/department-finance/bill-17-23-recordation-tax-changes-effective-october-1-2023";

export const MD_LOCAL_LEVEL = "county" as const;
export const MD_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "MD Dept of Legislative Services — Other Local Tax Rates in Maryland (FY2025/FY2026) + Guide to Local Government Taxing Authority (Aug 2026), Appendix 2 'Quick Reference Guide to Local Transfer Taxes'", sourceUrl: "https://dls.maryland.gov/pubs/prod/NoPblTabPDF/2026CountyLocalTaxRates.pdf", asOf: "2026-08-01",
  statement: "DLS publishes recordation and transfer rates for all 24 jurisdictions (23 counties + Baltimore City). Both taxes are county-level; MD municipalities do not levy separate deed transfer/recordation taxes (none appear in DLS's taxing-authority guide).",
};

export const MD_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: false,
  muniAbsentMeansNone: false,
  entries: [
  { id: "md-allegany-county", kind: "county", name: "Allegany County", county: "Allegany County", lines: [
      { name: "County Transfer Tax — Allegany County", rate: 0.005, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01" },
      { name: "County Recordation Tax — Allegany County", rate: 0.007, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$3.50 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-anne-arundel-county", kind: "county", name: "Anne Arundel County", county: "Anne Arundel County", lines: [
      { name: "County Transfer Tax — Anne Arundel", rate: 0.01, tiers: [{ over: 0, rate: 0.01 }, { over: 999999.99, rate: 0.015 }], base: "price", party: "split", source: S2, sourceUrl: S3, asOf: "2026-09-24", notes: "1.0% on transactions up to $999,999.99; for transactions of $1,000,000 or more the County rate is 1.5% — i.e. 1.5% on the WHOLE consideration (a cliff, not 0.5% on the excess). County Code §4-3A-102; revenue above 1% goes to affordable housing." },
      { name: "County Recordation Tax — Anne Arundel County", rate: 0.007, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$3.50 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-baltimore-city", kind: "county", name: "Baltimore city", county: "Baltimore city", lines: [
      { name: "County Transfer Tax — Baltimore city", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01" },
      { name: "County Recordation Tax — Baltimore city", rate: 0.01, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$5.00 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-baltimore-county", kind: "county", name: "Baltimore County", county: "Baltimore County", lines: [
      { name: "County Transfer Tax — Baltimore County", rate: 0.015, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01" },
      { name: "County Recordation Tax — Baltimore County", rate: 0.005, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$2.50 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-calvert-county", kind: "county", name: "Calvert County", county: "Calvert County", lines: [
      { name: "County Transfer Tax — Calvert County", rate: 0, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "No county transfer tax imposed (0.0%)." },
      { name: "County Recordation Tax — Calvert County", rate: 0.01, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$5.00 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-caroline-county", kind: "county", name: "Caroline County", county: "Caroline County", lines: [
      { name: "County Transfer Tax — Caroline County", rate: 0.005, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01" },
      { name: "County Recordation Tax — Caroline County", rate: 0.01, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$5.00 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-carroll-county", kind: "county", name: "Carroll County", county: "Carroll County", lines: [
      { name: "County Transfer Tax — Carroll County", rate: 0, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "No county transfer tax imposed (0.0%)." },
      { name: "County Recordation Tax — Carroll County", rate: 0.013, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$6.50 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-cecil-county", kind: "county", name: "Cecil County", county: "Cecil County", lines: [
      { name: "County Transfer Tax — Cecil County", rate: 0.005, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "Cecil calls it a 'deed transfer fee'; state exemptions (TP §13-207) do not apply." },
      { name: "County Recordation Tax — Cecil County", rate: 0.0082, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$4.10 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-charles-county", kind: "county", name: "Charles County", county: "Charles County", lines: [
      { name: "County Transfer Tax — Charles County", rate: 0.005, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01" },
      { name: "County Recordation Tax — Charles County", rate: 0.014, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$7.00 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-dorchester-county", kind: "county", name: "Dorchester County", county: "Dorchester County", lines: [
      { name: "County Transfer Tax — Dorchester County", rate: 0.0075, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01" },
      { name: "County Recordation Tax — Dorchester County", rate: 0.01, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$5.00 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-frederick-county", kind: "county", name: "Frederick County", county: "Frederick County", lines: [
      { name: "County Transfer Tax — Frederick County", rate: 0, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "No county transfer tax imposed (0.0%)." },
      { name: "County Recordation Tax — Frederick County", rate: 0.014, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$7.00 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-garrett-county", kind: "county", name: "Garrett County", county: "Garrett County", lines: [
      { name: "County Transfer Tax — Garrett County", rate: 0.01, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "First $50,000 of consideration exempt (all transfers) per DLS guide." },
      { name: "County Recordation Tax — Garrett County", rate: 0.007, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$3.50 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-harford-county", kind: "county", name: "Harford County", county: "Harford County", lines: [
      { name: "County Transfer Tax — Harford County", rate: 0.01, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01" },
      { name: "County Recordation Tax — Harford County", rate: 0.0066, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$3.30 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-howard-county", kind: "county", name: "Howard County", county: "Howard County", lines: [
      { name: "County Transfer Tax — Howard County", rate: 0.0125, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "1% fixed by State law + 0.25% county increase (DLS FY2026 table: 1.25%)." },
      { name: "County Recordation Tax — Howard County", rate: 0.005, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$2.50 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-kent-county", kind: "county", name: "Kent County", county: "Kent County", lines: [
      { name: "County Transfer Tax — Kent County", rate: 0.005, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01" },
      { name: "County Recordation Tax — Kent County", rate: 0.0066, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$3.30 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-montgomery-county", kind: "county", name: "Montgomery County", county: "Montgomery County", lines: [
      { name: "County Transfer Tax — Montgomery County", rate: 0.01, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "Improved nonresidential and unimproved property: flat 1% (residential is tiered 0.25%-1%)." },
      { name: "County Transfer Tax — Montgomery", rate: 0.01, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2026-08-01", notes: "Improved nonresidential and unimproved property: flat 1% (residential is tiered 0.25%-1%)." },
      { name: "County Recordation Tax — Montgomery (marginal tiers)", rate: 0.0089, marginalTiers: [{ over: 0, rate: 0.0089 }, { over: 500000, rate: 0.0135 }, { over: 600000, rate: 0.0204 }, { over: 750000, rate: 0.02156 }, { over: 1000000, rate: 0.0227 }], base: "price", party: "split", source: S6, sourceUrl: S7, asOf: "2023-10-01", notes: "Base $4.45/$500 ($2.08 general + $2.37 school) on all consideration; the premium applies ONLY to the slice in each band (county's own worked examples: $1,075,000 non-residence = $500K@$4.45 + $100K@$6.75 + $150K@$10.20 + $250K@$10.78 + $75K@$11.35 per $500). Principal-residence $100K exemption not applicable to commercial." }
    ] },
  { id: "md-prince-george-s-county", kind: "county", name: "Prince George's County", county: "Prince George's County", lines: [
      { name: "County Transfer Tax — Prince George's County", rate: 0.014, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "PG transfer tax also reaches mortgages/deeds of trust, but purchase-money mortgages/DOTs are exempt (DLS guide)." },
      { name: "County Recordation Tax — Prince George's County", rate: 0.0055, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$2.75 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-queen-anne-s-county", kind: "county", name: "Queen Anne's County", county: "Queen Anne's County", lines: [
      { name: "County Transfer Tax — Queen Anne's County", rate: 0.005, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01" },
      { name: "County Recordation Tax — Queen Anne's County", rate: 0.0099, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$4.95 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-st-mary-s-county", kind: "county", name: "St. Mary's County", county: "St. Mary's County", lines: [
      { name: "County Transfer Tax — St. Mary's County", rate: 0.01, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "County authority for the transfer tax expires Oct 1, 2028 (DLS guide)." },
      { name: "County Recordation Tax — St. Mary's County", rate: 0.008, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$4.00 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-somerset-county", kind: "county", name: "Somerset County", county: "Somerset County", lines: [
      { name: "County Transfer Tax — Somerset County", rate: 0, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "No county transfer tax imposed (0.0%)." },
      { name: "County Recordation Tax — Somerset County", rate: 0.0066, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$3.30 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-talbot-county", kind: "county", name: "Talbot County", county: "Talbot County", lines: [
      { name: "County Transfer Tax — Talbot County", rate: 0.01, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "First $50,000 of consideration exempt (DLS guide)." },
      { name: "County Recordation Tax — Talbot County", rate: 0.012, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$6.00 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-washington-county", kind: "county", name: "Washington County", county: "Washington County", lines: [
      { name: "County Transfer Tax — Washington County", rate: 0.005, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01" },
      { name: "County Recordation Tax — Washington County", rate: 0.0076, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$3.80 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-wicomico-county", kind: "county", name: "Wicomico County", county: "Wicomico County", lines: [
      { name: "County Transfer Tax — Wicomico County", rate: 0, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "Authorized (1%) but not imposed — 2000 referendum rejected it (DLS guide). No county transfer tax imposed (0.0%)." },
      { name: "County Recordation Tax — Wicomico County", rate: 0.007, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$3.50 per $500 of consideration (FY2026)." }
    ] },
  { id: "md-worcester-county", kind: "county", name: "Worcester County", county: "Worcester County", lines: [
      { name: "County Transfer Tax — Worcester County", rate: 0.005, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01" },
      { name: "County Recordation Tax — Worcester County", rate: 0.0066, base: "price", party: "split", source: S0, sourceUrl: S1, asOf: "2025-07-01", notes: "$3.30 per $500 of consideration (FY2026)." }
    ] },
  ],
};
