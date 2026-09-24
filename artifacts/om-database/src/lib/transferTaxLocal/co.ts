// GENERATED from official-source research (CO.auto.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: municipality. Local table complete: False.
// Local-level source: Colo. Const. art. X, §20(8)(a) (TABOR): 'new or increased transfer tax rates on real property are prohibited'; municipal RETTs exist only where adopted before 1992 under home-rule/statutory-town authority (https://leg.colorado.gov/) as of 2026-09-24.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "City of Aspen — Real Estate Transfer Taxes";
const S1 = "https://www.aspen.gov/1428/Real-Estate-Transfer-Taxes";
const S2 = "Town of Snowmass Village — Real Estate Transfer Taxes";
const S3 = "https://www.tosv.com/468/Real-Estate-Transfer-Taxes";
const S4 = "Town of Vail — Real Estate Transfer Tax (RETT); Vail Town Code Title 2 Ch. 6";
const S5 = "https://www.vail.gov/government/departments/finance/real-estate-transfer-tax-rett";
const S6 = "Town of Avon — Real Estate Transfer Tax; Avon Municipal Code Ch. 3.12";
const S7 = "https://www.avon.org/210/Real-Estate-Transfer-Tax";
const S8 = "Town of Gypsum — Property Transfer Info";
const S9 = "https://www.townofgypsum.com/community/public-works-utilities/property-transfer-info";
const S10 = "Town of Minturn — Fees, Rates and Charges schedule (2024/2025)";
const S11 = "https://mccmeetingspublic.blob.core.usgovcloudapi.net/minturnco-meet-87c18a6c7a634976856a26552148ff87/ITEM-Attachment-001-d2f8402c82604166bb0873d0801bf089.pdf";
const S12 = "Breckenridge Town Code §§3-3-3, 3-3-5, 3-3-6 (current through Ord. 7, Series 2026)";
const S13 = "https://breckenridge.town.codes/Code/3-3-5";
const S14 = "Town of Frisco — Real Estate Investment Fees (REIF)";
const S15 = "https://www.friscogov.com/departments/finance/real-estate-investment-fee/";
const S16 = "Town of Winter Park — Real Estate Transfer Tax";
const S17 = "https://www.wpgov.com/181/Real-Estate-Transfer-Tax";
const S18 = "Town of Telluride — RETT FAQ; Telluride Municipal Code §4-3-50";
const S19 = "https://www.telluride-co.gov/FAQ.aspx?QID=163";
const S20 = "Town of Crested Butte — Tax Information";
const S21 = "https://townofcrestedbutte.colorado.gov/government/tax-information";

export const CO_LOCAL_LEVEL = "municipality" as const;
export const CO_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "Colo. Const. art. X, §20(8)(a) (TABOR): 'new or increased transfer tax rates on real property are prohibited'; municipal RETTs exist only where adopted before 1992 under home-rule/statutory-town authority", sourceUrl: "https://leg.colorado.gov/", asOf: "2026-09-24",
  statement: "Only municipalities with a pre-TABOR (pre-Nov 1992) RETT can levy one; counties levy none. Entries list each town verified on its own official site/code.",
};

export const CO_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: false,
  muniAbsentMeansNone: true,
  placeBased: true,
  unincorporatedMeansNone: true,
  knownGaps: [
    { name: "Ophir town", county: "San Miguel County", reason: "reportedly a 4% RETT (Ord. 1979-03) but the official ordinance could not be retrieved", maxRate: 0.04, party: "buyer" },
    { name: "Silverthorne town", county: "Summit County", reason: "administers a Real Estate Transfer Assessment on certain properties; rate/applicability not verified (site blocked)", maxRate: 0.02, party: "buyer" },
  ],
  entries: [
  { id: "co-pitkin-county-aspen-city", kind: "municipal", name: "Aspen city", county: "Pitkin County", lines: [
      { name: "Aspen Wheeler Opera House / Arts RETT", rate: 0.005, base: "price", party: "buyer", source: S0, sourceUrl: S1, asOf: "2026-09-24", notes: "0.5% RETT (eff. 1979; extended through 2039). 'Transfer taxes are the responsibility of the purchasing party.'" },
      { name: "Aspen Housing RETT", rate: 0.01, marginalTiers: [{ over: 0, rate: 0 }, { over: 100000, rate: 0.01 }], base: "price", party: "buyer", source: S0, sourceUrl: S1, asOf: "2026-09-24", notes: "1.0% on consideration above the first $100,000 (eff. July 1, 1989; runs to 2060). Purchaser pays." }
    ] },
  { id: "co-pitkin-county-snowmass-village-town", kind: "municipal", name: "Snowmass Village town", county: "Pitkin County", lines: [
      { name: "Snowmass Village RETT", rate: 0.01, base: "price", party: "buyer", source: S2, sourceUrl: S3, asOf: "2026-09-24", notes: "1% of purchase price; 'The purchaser is responsible for the tax'." }
    ] },
  { id: "co-eagle-county-vail-town", kind: "municipal", verify: "Rate read from a search-engine copy of the town's official page (direct fetch failed), and the ordinance doesn't clearly name who pays. Confirm with the town/title.", name: "Vail town", county: "Eagle County", lines: [
      { name: "Vail RETT", rate: 0.01, base: "price", party: "split", source: S4, sourceUrl: S5, asOf: "2026-09-24", notes: "1% (created 1980). Parties jointly responsible; commonly allocated by contract. Page content obtained via search index — direct fetch 403." }
    ] },
  { id: "co-eagle-county-avon-town", kind: "municipal", verify: "The town's ordinance doesn't clearly say who pays — 'buyer' is an assumption; commercial exemptions not reviewed. Confirm with the town/title.", name: "Avon town", county: "Eagle County", lines: [
      { name: "Avon RETT", rate: 0.02, base: "price", party: "buyer", source: S6, sourceUrl: S7, asOf: "2026-09-24", notes: "2% on all transfers of real estate in the Town. Primary-residence exemption (first $500K) does not apply to commercial. Payer not stated on the page — confirm." }
    ] },
  { id: "co-eagle-county-gypsum-town", kind: "municipal", verify: "Rate read from a search-engine copy of the town's official page (direct fetch failed), and the ordinance doesn't clearly name who pays. Confirm with the town/title.", name: "Gypsum town", county: "Eagle County", lines: [
      { name: "Gypsum RETT", rate: 0.01, base: "price", party: "buyer", source: S8, sourceUrl: S9, asOf: "2026-09-24", notes: "1% on sale of property; transfer info due to Town 5 business days before closing. Page content via search index (direct fetch 404). Payer not confirmed." }
    ] },
  { id: "co-eagle-county-minturn-town", kind: "municipal", verify: "The town's ordinance doesn't clearly say who pays — 'buyer' is an assumption; commercial exemptions not reviewed. Confirm with the town/title.", name: "Minturn town", county: "Eagle County", lines: [
      { name: "Minturn RETT", rate: 0.01, base: "price", party: "buyer", source: S10, sourceUrl: S11, asOf: "2025-01-01", notes: "'Real Estate Transfer Tax per sale due at time of sale 1%'. Payer not stated." }
    ] },
  { id: "co-summit-county-breckenridge-town", kind: "municipal", name: "Breckenridge town", county: "Summit County", lines: [
      { name: "Breckenridge RETT", rate: 0.01, base: "price", party: "buyer", source: S12, sourceUrl: S13, asOf: "2026-07-28", notes: "1% of consideration (§3-3-5B). Purchaser/grantee liable and remits (§3-3-3). §3-3-6 exemptions contain NO commercial-property exemption." }
    ] },
  { id: "co-summit-county-frisco-town", kind: "municipal", verify: "The town's ordinance doesn't clearly say who pays — 'buyer' is an assumption; commercial exemptions not reviewed. Confirm with the town/title.", name: "Frisco town", county: "Summit County", lines: [
      { name: "Frisco Real Estate Investment Fee (REIF)", rate: 0.01, base: "price", party: "buyer", source: S14, sourceUrl: S15, asOf: "2026-09-24", notes: "1% on transfer of all real property within municipal limits, on total consideration, due at closing. Town Code does not specify grantor vs grantee — allocate in PSA." }
    ] },
  { id: "co-grand-county-winter-park-town", kind: "municipal", verify: "The town's ordinance doesn't clearly say who pays — 'buyer' is an assumption; commercial exemptions not reviewed. Confirm with the town/title.", name: "Winter Park town", county: "Grand County", lines: [
      { name: "Winter Park RETT", rate: 0.01, base: "price", party: "buyer", source: S16, sourceUrl: S17, asOf: "2026-09-24", notes: "1% on any real estate transfer in Town. An ADDITIONAL Real Estate Transfer Assessment (RETA) applies in certain developments (see Town map) — check the parcel. Payer not stated." }
    ] },
  { id: "co-san-miguel-county-telluride-town", kind: "municipal", verify: "Rate read from a search-engine copy of the town's official page (direct fetch failed), and the ordinance doesn't clearly name who pays. Confirm with the town/title.", name: "Telluride town", county: "San Miguel County", lines: [
      { name: "Telluride RETT", rate: 0.03, base: "price", party: "buyer", source: S18, sourceUrl: S19, asOf: "2026-09-24", notes: "3% of gross consideration paid to grantor by grantee, within Town limits and Sunset Ridge. Content via search index (direct fetch blocked). Payer by custom — confirm." }
    ] },
  { id: "co-gunnison-county-crested-butte-town", kind: "municipal", verify: "The town's ordinance doesn't clearly say who pays — 'buyer' is an assumption; commercial exemptions not reviewed. Confirm with the town/title.", name: "Crested Butte town", county: "Gunnison County", lines: [
      { name: "Crested Butte Land Transfer Excise Tax", rate: 0.03, base: "price", party: "buyer", source: S20, sourceUrl: S21, asOf: "2026-09-24", notes: "'A 3% land transfer excise tax is imposed on the sale of all real property within the Town limits.' Exemptions in Muni Code Ch. 4 Art. 5 (not reviewed). Payer not stated." }
    ] },
  ],
};
