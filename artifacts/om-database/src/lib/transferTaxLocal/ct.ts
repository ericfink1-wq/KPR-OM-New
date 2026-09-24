// GENERATED from official-source research (CT.prep.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: municipality. Local table complete: True.
// Local-level source: CT Office of Legislative Research, "Real Estate Conveyance Tax", OLR Report 2020-R-0020 (July 9, 2020) — Table 2 + text; CGS §12-494 as amended by PA 19-117; CT DRS Special Notice SN 2004(6) (https://www.cga.ct.gov/2020/rpt/pdf/2020-R-0020.pdf) as of 2020-07-09.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "Town of Groton — Town Council Committee of the Whole agenda item 2021-706 'Conveyance Tax' (10/5/2021), draft motion under CGS §12-494(c)";
const S1 = "https://agendasuite.org/iip/groton/file/getfile/57573";
const S2 = "CT Office of Legislative Research, \"Real Estate Conveyance Tax\", OLR Report 2020-R-0020 (July 9, 2020) — Table 2 + text; CGS §12-494 as amended by PA 19-117";
const S3 = "https://www.cga.ct.gov/2020/rpt/pdf/2020-R-0020.pdf";
const F0 = (rate: number, notes?: string): TaxLineItem => ({ name: "Municipal Conveyance Tax", rate, base: "price", party: "seller", source: S2, sourceUrl: S3, asOf: "2020-07-09", ...(notes ? { notes } : {}) });

export const CT_LOCAL_LEVEL = "municipality" as const;
export const CT_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "CT Office of Legislative Research, \"Real Estate Conveyance Tax\", OLR Report 2020-R-0020 (July 9, 2020) — Table 2 + text; CGS §12-494 as amended by PA 19-117; CT DRS Special Notice SN 2004(6)", sourceUrl: "https://www.cga.ct.gov/2020/rpt/pdf/2020-R-0020.pdf", asOf: "2020-07-09",
  statement: "The conveyance tax has a state and a municipal component; the municipal base rate is 0.25% in all municipalities, plus up to an additional 0.25% in the 19 eligible municipalities (18 targeted investment communities + Bloomfield) that choose to impose it. There is no county-level tax (CT has no county government). Raw copy of the OLR report obtained from the CT State Library mirror: https://cslib.contentdm.oclc.org/digital/api/collection/p128501coll2/id/690349/download",
};

export const CT_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: false,
  muniAbsentMeansNone: false,
  entries: [
  { id: "ct-capitol-planning-region-andover-town", kind: "municipal", name: "Andover town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Andover is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-ansonia-town", kind: "municipal", name: "Ansonia town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Ansonia is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-ashford-town", kind: "municipal", name: "Ashford town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Ashford is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-avon-town", kind: "municipal", name: "Avon town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Avon is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-barkhamsted-town", kind: "municipal", name: "Barkhamsted town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Barkhamsted is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-beacon-falls-town", kind: "municipal", name: "Beacon Falls town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Beacon Falls is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-berlin-town", kind: "municipal", name: "Berlin town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Berlin is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-south-central-connecticut-planning-region-bethany-town", kind: "municipal", name: "Bethany town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Bethany is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-western-connecticut-planning-region-bethel-town", kind: "municipal", name: "Bethel town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Bethel is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-bethlehem-town", kind: "municipal", name: "Bethlehem town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Bethlehem is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-bloomfield-town", kind: "municipal", name: "Bloomfield town", county: "Capitol Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (Bloomfield is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-capitol-planning-region-bolton-town", kind: "municipal", name: "Bolton town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Bolton is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-bozrah-town", kind: "municipal", name: "Bozrah town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Bozrah is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-south-central-connecticut-planning-region-branford-town", kind: "municipal", name: "Branford town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Branford is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-greater-bridgeport-planning-region-bridgeport-town", kind: "municipal", name: "Bridgeport town", county: "Greater Bridgeport Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (Bridgeport is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-western-connecticut-planning-region-bridgewater-town", kind: "municipal", name: "Bridgewater town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Bridgewater is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-bristol-town", kind: "municipal", name: "Bristol town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (Bristol is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-western-connecticut-planning-region-brookfield-town", kind: "municipal", name: "Brookfield town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Brookfield is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-brooklyn-town", kind: "municipal", name: "Brooklyn town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Brooklyn is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-burlington-town", kind: "municipal", name: "Burlington town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Burlington is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-canaan-town", kind: "municipal", name: "Canaan town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Canaan is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-canterbury-town", kind: "municipal", name: "Canterbury town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Canterbury is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-canton-town", kind: "municipal", name: "Canton town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Canton is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-chaplin-town", kind: "municipal", name: "Chaplin town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Chaplin is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-cheshire-town", kind: "municipal", name: "Cheshire town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Cheshire is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-chester-town", kind: "municipal", name: "Chester town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Chester is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-clinton-town", kind: "municipal", name: "Clinton town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Clinton is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-colchester-town", kind: "municipal", name: "Colchester town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Colchester is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-colebrook-town", kind: "municipal", name: "Colebrook town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Colebrook is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-columbia-town", kind: "municipal", name: "Columbia town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Columbia is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-cornwall-town", kind: "municipal", name: "Cornwall town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Cornwall is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-coventry-town", kind: "municipal", name: "Coventry town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Coventry is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-cromwell-town", kind: "municipal", name: "Cromwell town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Cromwell is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-western-connecticut-planning-region-danbury-town", kind: "municipal", name: "Danbury town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Danbury is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-western-connecticut-planning-region-darien-town", kind: "municipal", name: "Darien town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Darien is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-deep-river-town", kind: "municipal", name: "Deep River town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Deep River is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-derby-town", kind: "municipal", name: "Derby town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Derby is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-durham-town", kind: "municipal", name: "Durham town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Durham is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-east-granby-town", kind: "municipal", name: "East Granby town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). East Granby is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-east-haddam-town", kind: "municipal", name: "East Haddam town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). East Haddam is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-east-hampton-town", kind: "municipal", name: "East Hampton town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). East Hampton is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-east-hartford-town", kind: "municipal", name: "East Hartford town", county: "Capitol Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (East Hartford is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-south-central-connecticut-planning-region-east-haven-town", kind: "municipal", name: "East Haven town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). East Haven is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-east-lyme-town", kind: "municipal", name: "East Lyme town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). East Lyme is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-east-windsor-town", kind: "municipal", name: "East Windsor town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). East Windsor is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-eastford-town", kind: "municipal", name: "Eastford town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Eastford is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-greater-bridgeport-planning-region-easton-town", kind: "municipal", name: "Easton town", county: "Greater Bridgeport Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Easton is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-ellington-town", kind: "municipal", name: "Ellington town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Ellington is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-enfield-town", kind: "municipal", name: "Enfield town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Enfield is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-essex-town", kind: "municipal", name: "Essex town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Essex is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-greater-bridgeport-planning-region-fairfield-town", kind: "municipal", name: "Fairfield town", county: "Greater Bridgeport Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Fairfield is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-farmington-town", kind: "municipal", name: "Farmington town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Farmington is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-franklin-town", kind: "municipal", name: "Franklin town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Franklin is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-glastonbury-town", kind: "municipal", name: "Glastonbury town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Glastonbury is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-goshen-town", kind: "municipal", name: "Goshen town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Goshen is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-granby-town", kind: "municipal", name: "Granby town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Granby is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-western-connecticut-planning-region-greenwich-town", kind: "municipal", name: "Greenwich town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Greenwich is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-griswold-town", kind: "municipal", name: "Griswold town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Griswold is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-groton-town", kind: "municipal", name: "Groton town", county: "Southeastern Connecticut Planning Region", lines: [
      { name: "Municipal Conveyance Tax", rate: 0.005, base: "price", party: "seller", verify: true, source: S0, sourceUrl: S1, asOf: "2021-11-01", notes: "0.25% base + 0.25% additional (Groton re-entered the Distressed Municipalities list in 2021; the Council agenda proposed adopting the additional 0.25% effective 11/1/2021, staff-recommended). OLR 2020-R-0020 (July 2020) predates this and shows 0.25%. The adopted minutes were not retrieved — CONFIRM with the Groton town clerk. Seller pays." }
    ] },
  { id: "ct-south-central-connecticut-planning-region-guilford-town", kind: "municipal", name: "Guilford town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Guilford is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-haddam-town", kind: "municipal", name: "Haddam town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Haddam is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-south-central-connecticut-planning-region-hamden-town", kind: "municipal", name: "Hamden town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (Hamden is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-hampton-town", kind: "municipal", name: "Hampton town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Hampton is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-hartford-town", kind: "municipal", name: "Hartford town", county: "Capitol Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (Hartford is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-northwest-hills-planning-region-hartland-town", kind: "municipal", name: "Hartland town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Hartland is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-harwinton-town", kind: "municipal", name: "Harwinton town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Harwinton is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-hebron-town", kind: "municipal", name: "Hebron town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Hebron is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-kent-town", kind: "municipal", name: "Kent town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Kent is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-killingly-town", kind: "municipal", name: "Killingly town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Killingly is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-killingworth-town", kind: "municipal", name: "Killingworth town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Killingworth is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-lebanon-town", kind: "municipal", name: "Lebanon town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Lebanon is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-ledyard-town", kind: "municipal", name: "Ledyard town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Ledyard is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-lisbon-town", kind: "municipal", name: "Lisbon town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Lisbon is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-litchfield-town", kind: "municipal", name: "Litchfield town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Litchfield is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-lyme-town", kind: "municipal", name: "Lyme town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Lyme is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-south-central-connecticut-planning-region-madison-town", kind: "municipal", name: "Madison town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Madison is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-manchester-town", kind: "municipal", name: "Manchester town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Manchester is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-mansfield-town", kind: "municipal", name: "Mansfield town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Mansfield is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-marlborough-town", kind: "municipal", name: "Marlborough town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Marlborough is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-south-central-connecticut-planning-region-meriden-town", kind: "municipal", name: "Meriden town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (Meriden is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-middlebury-town", kind: "municipal", name: "Middlebury town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Middlebury is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-middlefield-town", kind: "municipal", name: "Middlefield town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Middlefield is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-middletown-town", kind: "municipal", name: "Middletown town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (Middletown is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-south-central-connecticut-planning-region-milford-town", kind: "municipal", name: "Milford town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Milford is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-greater-bridgeport-planning-region-monroe-town", kind: "municipal", name: "Monroe town", county: "Greater Bridgeport Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Monroe is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-montville-town", kind: "municipal", name: "Montville town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Montville is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-morris-town", kind: "municipal", name: "Morris town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Morris is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-naugatuck-town", kind: "municipal", name: "Naugatuck town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Naugatuck is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-new-britain-town", kind: "municipal", name: "New Britain town", county: "Capitol Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (New Britain is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-western-connecticut-planning-region-new-canaan-town", kind: "municipal", name: "New Canaan town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). New Canaan is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-western-connecticut-planning-region-new-fairfield-town", kind: "municipal", name: "New Fairfield town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). New Fairfield is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-new-hartford-town", kind: "municipal", name: "New Hartford town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). New Hartford is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-south-central-connecticut-planning-region-new-haven-town", kind: "municipal", name: "New Haven town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (New Haven is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-new-london-town", kind: "municipal", name: "New London town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (New London is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-western-connecticut-planning-region-new-milford-town", kind: "municipal", name: "New Milford town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). New Milford is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-newington-town", kind: "municipal", name: "Newington town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Newington is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-western-connecticut-planning-region-newtown-town", kind: "municipal", name: "Newtown town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Newtown is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-norfolk-town", kind: "municipal", name: "Norfolk town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Norfolk is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-south-central-connecticut-planning-region-north-branford-town", kind: "municipal", name: "North Branford town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). North Branford is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-north-canaan-town", kind: "municipal", name: "North Canaan town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). North Canaan is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-south-central-connecticut-planning-region-north-haven-town", kind: "municipal", name: "North Haven town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). North Haven is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-north-stonington-town", kind: "municipal", name: "North Stonington town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). North Stonington is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-western-connecticut-planning-region-norwalk-town", kind: "municipal", name: "Norwalk town", county: "Western Connecticut Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (Norwalk is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-norwich-town", kind: "municipal", name: "Norwich town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (Norwich is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-old-lyme-town", kind: "municipal", name: "Old Lyme town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Old Lyme is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-old-saybrook-town", kind: "municipal", name: "Old Saybrook town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Old Saybrook is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-south-central-connecticut-planning-region-orange-town", kind: "municipal", name: "Orange town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Orange is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-oxford-town", kind: "municipal", name: "Oxford town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Oxford is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-plainfield-town", kind: "municipal", name: "Plainfield town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Plainfield is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-plainville-town", kind: "municipal", name: "Plainville town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Plainville is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-plymouth-town", kind: "municipal", name: "Plymouth town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Plymouth is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-pomfret-town", kind: "municipal", name: "Pomfret town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Pomfret is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-portland-town", kind: "municipal", name: "Portland town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Portland is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-preston-town", kind: "municipal", name: "Preston town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Preston is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-prospect-town", kind: "municipal", name: "Prospect town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Prospect is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-putnam-town", kind: "municipal", name: "Putnam town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Putnam is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-western-connecticut-planning-region-redding-town", kind: "municipal", name: "Redding town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Redding is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-western-connecticut-planning-region-ridgefield-town", kind: "municipal", name: "Ridgefield town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Ridgefield is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-rocky-hill-town", kind: "municipal", name: "Rocky Hill town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Rocky Hill is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-roxbury-town", kind: "municipal", name: "Roxbury town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Roxbury is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-salem-town", kind: "municipal", name: "Salem town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Salem is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-salisbury-town", kind: "municipal", name: "Salisbury town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Salisbury is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-scotland-town", kind: "municipal", name: "Scotland town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Scotland is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-seymour-town", kind: "municipal", name: "Seymour town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Seymour is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-sharon-town", kind: "municipal", name: "Sharon town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Sharon is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-shelton-town", kind: "municipal", name: "Shelton town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Shelton is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-western-connecticut-planning-region-sherman-town", kind: "municipal", name: "Sherman town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Sherman is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-simsbury-town", kind: "municipal", name: "Simsbury town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Simsbury is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-somers-town", kind: "municipal", name: "Somers town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Somers is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-south-windsor-town", kind: "municipal", name: "South Windsor town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). South Windsor is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-southbury-town", kind: "municipal", name: "Southbury town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Southbury is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-southington-town", kind: "municipal", name: "Southington town", county: "Capitol Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (Southington is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-sprague-town", kind: "municipal", name: "Sprague town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Sprague is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-stafford-town", kind: "municipal", name: "Stafford town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Stafford is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-western-connecticut-planning-region-stamford-town", kind: "municipal", name: "Stamford town", county: "Western Connecticut Planning Region", lines: [
      { name: "Municipal Conveyance Tax", rate: 0.005, marginalTiers: [{ over: 0, rate: 0.0035 }, { over: 1000000, rate: 0.005 }], base: "price", party: "seller", source: S2, sourceUrl: S3, asOf: "2020-07-09", notes: "0.25% base + Stamford additional tax of 0.10% on properties sold for up to $1M and 0.25% on all other properties (OLR 2020-R-0020). Practitioner sources describe it as 0.35% on the price up to $1,000,000 with the balance at 0.50% (i.e. marginal) — modeled as marginal. Stamford ordinance text (Code ch. 220) not retrieved; if it is actually a cliff, a >$1M deal would owe 0.50% on the whole price (max difference $1,500). Seller pays." }
    ] },
  { id: "ct-northeastern-connecticut-planning-region-sterling-town", kind: "municipal", name: "Sterling town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Sterling is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-stonington-town", kind: "municipal", name: "Stonington town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Stonington is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-greater-bridgeport-planning-region-stratford-town", kind: "municipal", name: "Stratford town", county: "Greater Bridgeport Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Stratford is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-suffield-town", kind: "municipal", name: "Suffield town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Suffield is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-thomaston-town", kind: "municipal", name: "Thomaston town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax only. Thomaston is ELIGIBLE for the additional 0.25% under CGS §12-494(b) but per OLR 2020-R-0020 does not impose it. Verify with the Thomaston town clerk (some non-official web sources list Thomaston at 0.50%). Seller pays.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-thompson-town", kind: "municipal", name: "Thompson town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Thompson is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-tolland-town", kind: "municipal", name: "Tolland town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Tolland is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-torrington-town", kind: "municipal", name: "Torrington town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Torrington is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-greater-bridgeport-planning-region-trumbull-town", kind: "municipal", name: "Trumbull town", county: "Greater Bridgeport Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Trumbull is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-union-town", kind: "municipal", name: "Union town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Union is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-vernon-town", kind: "municipal", name: "Vernon town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Vernon is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-voluntown-town", kind: "municipal", name: "Voluntown town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Voluntown is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-south-central-connecticut-planning-region-wallingford-town", kind: "municipal", name: "Wallingford town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Wallingford is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-warren-town", kind: "municipal", name: "Warren town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Warren is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-washington-town", kind: "municipal", name: "Washington town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Washington is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-waterbury-town", kind: "municipal", name: "Waterbury town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (Waterbury is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-waterford-town", kind: "municipal", name: "Waterford town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Waterford is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-watertown-town", kind: "municipal", name: "Watertown town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Watertown is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-west-hartford-town", kind: "municipal", name: "West Hartford town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). West Hartford is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-south-central-connecticut-planning-region-west-haven-town", kind: "municipal", name: "West Haven town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). West Haven is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-lower-connecticut-river-valley-planning-region-westbrook-town", kind: "municipal", name: "Westbrook town", county: "Lower Connecticut River Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Westbrook is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-western-connecticut-planning-region-weston-town", kind: "municipal", name: "Weston town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Weston is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-western-connecticut-planning-region-westport-town", kind: "municipal", name: "Westport town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Westport is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-wethersfield-town", kind: "municipal", name: "Wethersfield town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Wethersfield is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-willington-town", kind: "municipal", name: "Willington town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Willington is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-western-connecticut-planning-region-wilton-town", kind: "municipal", name: "Wilton town", county: "Western Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Wilton is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northwest-hills-planning-region-winchester-town", kind: "municipal", name: "Winchester town", county: "Northwest Hills Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Winchester is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-southeastern-connecticut-planning-region-windham-town", kind: "municipal", name: "Windham town", county: "Southeastern Connecticut Planning Region", lines: [
      F0(0.005, "0.25% base municipal tax + 0.25% additional local-option tax (Windham is one of the 19 municipalities eligible under CGS §12-494(b) — targeted investment communities + Bloomfield — and per OLR 2020-R-0020 imposes the maximum additional 0.25%). Seller pays; collected by the town clerk at recording.")
    ] },
  { id: "ct-capitol-planning-region-windsor-locks-town", kind: "municipal", name: "Windsor Locks town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Windsor Locks is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-capitol-planning-region-windsor-town", kind: "municipal", name: "Windsor town", county: "Capitol Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Windsor is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-wolcott-town", kind: "municipal", name: "Wolcott town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Wolcott is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-south-central-connecticut-planning-region-woodbridge-town", kind: "municipal", name: "Woodbridge town", county: "South Central Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Woodbridge is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-naugatuck-valley-planning-region-woodbury-town", kind: "municipal", name: "Woodbury town", county: "Naugatuck Valley Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Woodbury is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  { id: "ct-northeastern-connecticut-planning-region-woodstock-town", kind: "municipal", name: "Woodstock town", county: "Northeastern Connecticut Planning Region", lines: [
      F0(0.0025, "0.25% base municipal tax (all 169 towns). Woodstock is not among the 19 municipalities eligible for the additional local-option tax under CGS §12-494(b). Seller pays.")
    ] },
  ],
};
