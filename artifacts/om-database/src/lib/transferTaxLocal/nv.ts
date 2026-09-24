// GENERATED from official-source research (NV.auto.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: county. Local table complete: True.
// Local-level source: Nevada Dept. of Taxation — RPTT 1st Quarter FY2025-26 Report (published Feb 27, 2026), rate table p.19; NRS 375.020/375.023/375.026 (https://tax.nv.gov/wp-content/uploads/2026/02/Q1-FY-2025-2026-RPTT-Quarterly-Report.pdf) as of 2026-02-27.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "Nevada Dept. of Taxation — RPTT 1st Quarter FY2025-26 Report (published Feb 27, 2026), rate table p.19; NRS 375.020/375.023/375.026";
const S1 = "https://tax.nv.gov/wp-content/uploads/2026/02/Q1-FY-2025-2026-RPTT-Quarterly-Report.pdf";
const F0 = (rate: number, notes?: string): TaxLineItem => ({ name: "NRS 375.020 county-level RPTT (pop. <700,000: $0.65/$500)", rate, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2026-02-27", ...(notes ? { notes } : {}) });

export const NV_LOCAL_LEVEL = "county" as const;
export const NV_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "Nevada Dept. of Taxation — RPTT 1st Quarter FY2025-26 Report (published Feb 27, 2026), rate table p.19; NRS 375.020/375.023/375.026", sourceUrl: "https://tax.nv.gov/wp-content/uploads/2026/02/Q1-FY-2025-2026-RPTT-Quarterly-Report.pdf", asOf: "2026-02-27",
  statement: "RPTT varies only by county: $2.55/$500 in Clark (only county ≥700K pop.), $2.05 in Churchill & Washoe (LGTA levy), $1.95 in all other counties. NRS 375.026 plant-industry levy (up to $0.05) — 'no counties have levied' it. No city-level RPTT.",
};

export const NV_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: false,
  muniAbsentMeansNone: false,
  entries: [
  { id: "nv-carson-city", kind: "county", name: "Carson City", county: "Carson City", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500.")
    ] },
  { id: "nv-churchill-county", kind: "county", name: "Churchill County", county: "Churchill County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500."),
      { name: "LGTA optional RPTT (1991)", rate: 0.0002, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2026-02-27", notes: "Additional $0.10 per $500; DoTax: 'Currently, only Churchill County and Washoe County impose an additional $0.10 levy.' Total $2.05/$500 = 0.41%." }
    ] },
  { id: "nv-clark-county", kind: "county", name: "Clark County", county: "Clark County", lines: [
      { name: "NRS 375.020 county-level RPTT (pop. ≥700,000: $1.25/$500)", rate: 0.0025, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2026-02-27", notes: "$0.55 consolidated tax + $0.60 Clark County School District + $0.10 low-income housing = $1.25 per $500. Combined with state $1.30 → $2.55/$500 = 0.51%." }
    ] },
  { id: "nv-douglas-county", kind: "county", name: "Douglas County", county: "Douglas County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500.")
    ] },
  { id: "nv-elko-county", kind: "county", name: "Elko County", county: "Elko County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500.")
    ] },
  { id: "nv-esmeralda-county", kind: "county", name: "Esmeralda County", county: "Esmeralda County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500.")
    ] },
  { id: "nv-eureka-county", kind: "county", name: "Eureka County", county: "Eureka County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500.")
    ] },
  { id: "nv-humboldt-county", kind: "county", name: "Humboldt County", county: "Humboldt County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500.")
    ] },
  { id: "nv-lander-county", kind: "county", name: "Lander County", county: "Lander County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500.")
    ] },
  { id: "nv-lincoln-county", kind: "county", name: "Lincoln County", county: "Lincoln County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500.")
    ] },
  { id: "nv-lyon-county", kind: "county", name: "Lyon County", county: "Lyon County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500.")
    ] },
  { id: "nv-mineral-county", kind: "county", name: "Mineral County", county: "Mineral County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500.")
    ] },
  { id: "nv-nye-county", kind: "county", name: "Nye County", county: "Nye County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500.")
    ] },
  { id: "nv-pershing-county", kind: "county", name: "Pershing County", county: "Pershing County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500.")
    ] },
  { id: "nv-storey-county", kind: "county", name: "Storey County", county: "Storey County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500.")
    ] },
  { id: "nv-washoe-county", kind: "county", name: "Washoe County", county: "Washoe County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500."),
      { name: "LGTA optional RPTT (1991)", rate: 0.0002, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2026-02-27", notes: "Additional $0.10 per $500; DoTax: 'Currently, only Churchill County and Washoe County impose an additional $0.10 levy.' Total $2.05/$500 = 0.41%." }
    ] },
  { id: "nv-white-pine-county", kind: "county", name: "White Pine County", county: "White Pine County", lines: [
      F0(0.0013, "$0.55 consolidated tax + $0.10 low-income housing = $0.65 per $500.")
    ] },
  ],
};
