// GENERATED from official-source research (WA.prep.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: municipality. Local table complete: True.
// Local-level source: WA DOR — Local Real Estate Excise Tax Rates, Rates Effective May 1, 2026 (84-0013) (https://dor.wa.gov/sites/default/files/2026-03/84-0013-May26_REET.xlsx) as of 2026-05-01.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "WA DOR — Local Real Estate Excise Tax Rates (form 84-0013), Rates Effective May 1, 2026";
const S1 = "https://dor.wa.gov/sites/default/files/2026-03/84-0013-May26_REET.xlsx";
const S2 = "San Juan County Treasurer — Land Bank Tax; RCW 82.46.070(1)(a) ('The tax shall be the obligation of the purchaser')";
const S3 = "https://www.sanjuancountywa.gov/324/Land-Bank-Tax";
const S4 = "RCW 82.46.075(3) (at least half purchaser); SJCC ch. 3.10 (99% purchaser / 1% seller)";
const S5 = "https://app.leg.wa.gov/RCW/default.aspx?cite=82.46.075";
const F0 = (rate: number, notes?: string): TaxLineItem => ({ name: "Local REET", rate, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2026-05-01", ...(notes ? { notes } : {}) });

export const WA_LOCAL_LEVEL = "municipality" as const;
export const WA_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "WA DOR — Local Real Estate Excise Tax Rates, Rates Effective May 1, 2026 (84-0013)", sourceUrl: "https://dor.wa.gov/sites/default/files/2026-03/84-0013-May26_REET.xlsx", asOf: "2026-05-01",
  statement: "Local REET is imposed by cities within their limits and by counties in unincorporated areas (RCW 82.46.010/.035), so the rate is set per DOR location code (city, or 'County Unincorp.'). DOR publishes one combined local rate per location code; the table has 324 codes covering every incorporated place in the 2020 Census WA list (all 281 matched, incl. 4 cities split across two counties with a code per county part) plus the 39 unincorporated county areas. The 'rate' is the full local rate for that code.",
};

export const WA_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: false,
  muniAbsentMeansNone: false,
  placeBased: true,
  entries: [
  { id: "wa-adams-county-unincorporated-0100", kind: "municipal", name: "Unincorporated Adams County", county: "Adams County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 0100. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-adams-county-hatton-town-0101", kind: "municipal", name: "Hatton town", county: "Adams County", lines: [
      F0(0.0025, "DOR location code 0101. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-adams-county-lind-town-0102", kind: "municipal", name: "Lind town", county: "Adams County", lines: [
      F0(0.0025, "DOR location code 0102. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-adams-county-othello-city-0103", kind: "municipal", name: "Othello city", county: "Adams County", lines: [
      F0(0.0025, "DOR location code 0103. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-adams-county-ritzville-city-0104", kind: "municipal", name: "Ritzville city", county: "Adams County", lines: [
      F0(0.0025, "DOR location code 0104. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-adams-county-washtucna-town-0105", kind: "municipal", name: "Washtucna town", county: "Adams County", lines: [
      F0(0.0025, "DOR location code 0105. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-asotin-county-unincorporated-0200", kind: "municipal", name: "Unincorporated Asotin County", county: "Asotin County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 0200. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-asotin-county-asotin-city-0201", kind: "municipal", name: "Asotin city", county: "Asotin County", lines: [
      F0(0.0025, "DOR location code 0201. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-asotin-county-clarkston-city-0202", kind: "municipal", name: "Clarkston city", county: "Asotin County", lines: [
      F0(0.0025, "DOR location code 0202. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-benton-county-unincorporated-0300", kind: "municipal", name: "Unincorporated Benton County", county: "Benton County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 0300. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-benton-county-benton-city-city-0301", kind: "municipal", name: "Benton City city", county: "Benton County", lines: [
      F0(0.005, "DOR location code 0301. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-benton-county-kennewick-city-0302", kind: "municipal", name: "Kennewick city", county: "Benton County", lines: [
      F0(0.005, "DOR location code 0302. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-benton-county-prosser-city-0303", kind: "municipal", name: "Prosser city", county: "Benton County", lines: [
      F0(0.005, "DOR location code 0303. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-benton-county-richland-city-0304", kind: "municipal", name: "Richland city", county: "Benton County", lines: [
      F0(0.005, "DOR location code 0304. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-benton-county-west-richland-city-0305", kind: "municipal", name: "West Richland city", county: "Benton County", lines: [
      F0(0.005, "DOR location code 0305. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-chelan-county-unincorporated-0400", kind: "municipal", name: "Unincorporated Chelan County", county: "Chelan County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 0400. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-chelan-county-cashmere-city-0401", kind: "municipal", name: "Cashmere city", county: "Chelan County", lines: [
      F0(0.0025, "DOR location code 0401. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-chelan-county-chelan-city-0402", kind: "municipal", name: "Chelan city", county: "Chelan County", lines: [
      F0(0.005, "DOR location code 0402. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-chelan-county-entiat-city-0403", kind: "municipal", name: "Entiat city", county: "Chelan County", lines: [
      F0(0.0025, "DOR location code 0403. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-chelan-county-leavenworth-city-0404", kind: "municipal", name: "Leavenworth city", county: "Chelan County", lines: [
      F0(0.005, "DOR location code 0404. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-chelan-county-wenatchee-city-0405", kind: "municipal", name: "Wenatchee city", county: "Chelan County", lines: [
      F0(0.005, "DOR location code 0405. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-clallam-county-unincorporated-0500", kind: "municipal", name: "Unincorporated Clallam County", county: "Clallam County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 0500. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-clallam-county-forks-city-0501", kind: "municipal", name: "Forks city", county: "Clallam County", lines: [
      F0(0.0025, "DOR location code 0501. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-clallam-county-port-angeles-city-0502", kind: "municipal", name: "Port Angeles city", county: "Clallam County", lines: [
      F0(0.005, "DOR location code 0502. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-clallam-county-sequim-city-0503", kind: "municipal", name: "Sequim city", county: "Clallam County", lines: [
      F0(0.005, "DOR location code 0503. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-clark-county-unincorporated-0600", kind: "municipal", name: "Unincorporated Clark County", county: "Clark County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 0600. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-clark-county-battle-ground-city-0601", kind: "municipal", name: "Battle Ground city", county: "Clark County", lines: [
      F0(0.005, "DOR location code 0601. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-clark-county-camas-city-0602", kind: "municipal", name: "Camas city", county: "Clark County", lines: [
      F0(0.005, "DOR location code 0602. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-clark-county-la-center-city-0603", kind: "municipal", name: "La Center city", county: "Clark County", lines: [
      F0(0.005, "DOR location code 0603. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-clark-county-ridgefield-city-0604", kind: "municipal", name: "Ridgefield city", county: "Clark County", lines: [
      F0(0.005, "DOR location code 0604. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-clark-county-vancouver-city-0605", kind: "municipal", name: "Vancouver city", county: "Clark County", lines: [
      F0(0.005, "DOR location code 0605. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-clark-county-washougal-city-0606", kind: "municipal", name: "Washougal city", county: "Clark County", lines: [
      F0(0.005, "DOR location code 0606. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-clark-county-yacolt-town-0607", kind: "municipal", name: "Yacolt town", county: "Clark County", lines: [
      F0(0.0025, "DOR location code 0607. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-columbia-county-unincorporated-0700", kind: "municipal", name: "Unincorporated Columbia County", county: "Columbia County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 0700. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-columbia-county-dayton-city-0701", kind: "municipal", name: "Dayton city", county: "Columbia County", lines: [
      F0(0.0025, "DOR location code 0701. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-columbia-county-starbuck-town-0702", kind: "municipal", name: "Starbuck town", county: "Columbia County", lines: [] },
  { id: "wa-cowlitz-county-unincorporated-0800", kind: "municipal", name: "Unincorporated Cowlitz County", county: "Cowlitz County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 0800. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-cowlitz-county-castle-rock-city-0801", kind: "municipal", name: "Castle Rock city", county: "Cowlitz County", lines: [
      F0(0.0025, "DOR location code 0801. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-cowlitz-county-kalama-city-0802", kind: "municipal", name: "Kalama city", county: "Cowlitz County", lines: [
      F0(0.0025, "DOR location code 0802. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-cowlitz-county-kelso-city-0803", kind: "municipal", name: "Kelso city", county: "Cowlitz County", lines: [
      F0(0.0025, "DOR location code 0803. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-cowlitz-county-longview-city-0804", kind: "municipal", name: "Longview city", county: "Cowlitz County", lines: [
      F0(0.0025, "DOR location code 0804. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-cowlitz-county-woodland-city-0805", kind: "municipal", name: "Woodland city", county: "Cowlitz County", lines: [
      F0(0.005, "DOR location code 0805. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-douglas-county-unincorporated-0900", kind: "municipal", name: "Unincorporated Douglas County", county: "Douglas County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 0900. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-douglas-county-bridgeport-city-0901", kind: "municipal", name: "Bridgeport city", county: "Douglas County", lines: [
      F0(0.0025, "DOR location code 0901. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-douglas-county-east-wenatchee-city-0902", kind: "municipal", name: "East Wenatchee city", county: "Douglas County", lines: [
      F0(0.005, "DOR location code 0902. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-douglas-county-mansfield-town-0903", kind: "municipal", name: "Mansfield town", county: "Douglas County", lines: [
      F0(0.005, "DOR location code 0903. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-douglas-county-rock-island-city-0904", kind: "municipal", name: "Rock Island city", county: "Douglas County", lines: [
      F0(0.0025, "DOR location code 0904. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-douglas-county-waterville-town-0905", kind: "municipal", name: "Waterville town", county: "Douglas County", lines: [
      F0(0.005, "DOR location code 0905. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-ferry-county-unincorporated-1000", kind: "municipal", name: "Unincorporated Ferry County", county: "Ferry County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 1000. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-ferry-county-republic-city-1001", kind: "municipal", name: "Republic city", county: "Ferry County", lines: [
      F0(0.0025, "DOR location code 1001. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-franklin-county-unincorporated-1100", kind: "municipal", name: "Unincorporated Franklin County", county: "Franklin County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 1100. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-franklin-county-connell-city-1101", kind: "municipal", name: "Connell city", county: "Franklin County", lines: [
      F0(0.005, "DOR location code 1101. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-franklin-county-kahlotus-city-1102", kind: "municipal", name: "Kahlotus city", county: "Franklin County", lines: [
      F0(0.0025, "DOR location code 1102. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-franklin-county-mesa-city-1103", kind: "municipal", name: "Mesa city", county: "Franklin County", lines: [
      F0(0.0025, "DOR location code 1103. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-franklin-county-pasco-city-1104", kind: "municipal", name: "Pasco city", county: "Franklin County", lines: [
      F0(0.005, "DOR location code 1104. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-garfield-county-unincorporated-1200", kind: "municipal", name: "Unincorporated Garfield County", county: "Garfield County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 1200. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-garfield-county-pomeroy-city-1201", kind: "municipal", name: "Pomeroy city", county: "Garfield County", lines: [
      F0(0.0025, "DOR location code 1201. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grant-county-unincorporated-1300", kind: "municipal", name: "Unincorporated Grant County", county: "Grant County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 1300. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grant-county-coulee-city-town-1301", kind: "municipal", name: "Coulee City town", county: "Grant County", lines: [
      F0(0.0025, "DOR location code 1301. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grant-county-electric-city-city-1302", kind: "municipal", name: "Electric City city", county: "Grant County", lines: [
      F0(0.005, "DOR location code 1302. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grant-county-ephrata-city-1303", kind: "municipal", name: "Ephrata city", county: "Grant County", lines: [
      F0(0.005, "DOR location code 1303. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grant-county-george-city-1304", kind: "municipal", name: "George city", county: "Grant County", lines: [
      F0(0.005, "DOR location code 1304. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grant-county-grand-coulee-city-1305", kind: "municipal", name: "Grand Coulee city", county: "Grant County", lines: [
      F0(0.0025, "DOR location code 1305. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grant-county-hartline-town-1306", kind: "municipal", name: "Hartline town", county: "Grant County", lines: [
      F0(0.0025, "DOR location code 1306. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grant-county-krupp-marlin-town-1307", kind: "municipal", name: "Krupp (Marlin) town", county: "Grant County", match: ["krupp", "marlin"], lines: [] },
  { id: "wa-grant-county-mattawa-city-1308", kind: "municipal", name: "Mattawa city", county: "Grant County", lines: [
      F0(0.005, "DOR location code 1308. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grant-county-moses-lake-city-1309", kind: "municipal", name: "Moses Lake city", county: "Grant County", lines: [
      F0(0.005, "DOR location code 1309. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grant-county-quincy-city-1310", kind: "municipal", name: "Quincy city", county: "Grant County", lines: [
      F0(0.005, "DOR location code 1310. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grant-county-royal-city-city-1311", kind: "municipal", name: "Royal City city", county: "Grant County", lines: [
      F0(0.005, "DOR location code 1311. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grant-county-soap-lake-city-1312", kind: "municipal", name: "Soap Lake city", county: "Grant County", lines: [
      F0(0.005, "DOR location code 1312. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grant-county-warden-city-1313", kind: "municipal", name: "Warden city", county: "Grant County", lines: [
      F0(0.005, "DOR location code 1313. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grant-county-wilson-creek-town-1315", kind: "municipal", name: "Wilson Creek town", county: "Grant County", lines: [
      F0(0.005, "DOR location code 1315. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grays-harbor-county-unincorporated-1400", kind: "municipal", name: "Unincorporated Grays Harbor County", county: "Grays Harbor County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 1400. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grays-harbor-county-aberdeen-city-1401", kind: "municipal", name: "Aberdeen city", county: "Grays Harbor County", lines: [
      F0(0.0025, "DOR location code 1401. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grays-harbor-county-cosmopolis-city-1402", kind: "municipal", name: "Cosmopolis city", county: "Grays Harbor County", lines: [
      F0(0.0025, "DOR location code 1402. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grays-harbor-county-elma-city-1403", kind: "municipal", name: "Elma city", county: "Grays Harbor County", lines: [
      F0(0.0025, "DOR location code 1403. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grays-harbor-county-hoquiam-city-1404", kind: "municipal", name: "Hoquiam city", county: "Grays Harbor County", lines: [
      F0(0.0025, "DOR location code 1404. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grays-harbor-county-mccleary-city-1405", kind: "municipal", name: "McCleary city", county: "Grays Harbor County", lines: [
      F0(0.0025, "DOR location code 1405. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grays-harbor-county-montesano-city-1406", kind: "municipal", name: "Montesano city", county: "Grays Harbor County", lines: [
      F0(0.0025, "DOR location code 1406. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grays-harbor-county-oakville-city-1407", kind: "municipal", name: "Oakville city", county: "Grays Harbor County", lines: [
      F0(0.0025, "DOR location code 1407. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grays-harbor-county-westport-city-1408", kind: "municipal", name: "Westport city", county: "Grays Harbor County", lines: [
      F0(0.0025, "DOR location code 1408. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-grays-harbor-county-ocean-shores-city-1409", kind: "municipal", name: "Ocean Shores city", county: "Grays Harbor County", lines: [
      F0(0.0025, "DOR location code 1409. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-island-county-unincorporated-1500", kind: "municipal", name: "Unincorporated Island County", county: "Island County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 1500. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-island-county-coupeville-town-1501", kind: "municipal", name: "Coupeville town", county: "Island County", lines: [
      F0(0.005, "DOR location code 1501. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-island-county-langley-city-1502", kind: "municipal", name: "Langley city", county: "Island County", lines: [
      F0(0.005, "DOR location code 1502. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-island-county-oak-harbor-city-1503", kind: "municipal", name: "Oak Harbor city", county: "Island County", lines: [
      F0(0.005, "DOR location code 1503. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-jefferson-county-unincorporated-1600", kind: "municipal", name: "Unincorporated Jefferson County", county: "Jefferson County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 1600. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-jefferson-county-port-townsend-city-1601", kind: "municipal", name: "Port Townsend city", county: "Jefferson County", lines: [
      F0(0.005, "DOR location code 1601. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-unincorporated-1700", kind: "municipal", name: "Unincorporated King County", county: "King County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 1700. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-algona-city-1701", kind: "municipal", name: "Algona city", county: "King County", lines: [
      F0(0.005, "DOR location code 1701. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-auburn-city-1702", kind: "municipal", name: "Auburn city", county: "King County", lines: [
      F0(0.005, "DOR location code 1702. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-beaux-arts-village-town-1703", kind: "municipal", name: "Beaux Arts Village town", county: "King County", lines: [
      F0(0.005, "DOR location code 1703. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-bellevue-city-1704", kind: "municipal", name: "Bellevue city", county: "King County", lines: [
      F0(0.005, "DOR location code 1704. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-black-diamond-city-1705", kind: "municipal", name: "Black Diamond city", county: "King County", lines: [
      F0(0.005, "DOR location code 1705. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-bothell-city-1706", kind: "municipal", name: "Bothell city", county: "King County", lines: [
      F0(0.005, "DOR location code 1706. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-carnation-city-1707", kind: "municipal", name: "Carnation city", county: "King County", lines: [
      F0(0.005, "DOR location code 1707. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-clyde-hill-city-1708", kind: "municipal", name: "Clyde Hill city", county: "King County", lines: [
      F0(0.005, "DOR location code 1708. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-des-moines-city-1709", kind: "municipal", name: "Des Moines city", county: "King County", lines: [
      F0(0.005, "DOR location code 1709. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-duvall-city-1710", kind: "municipal", name: "Duvall city", county: "King County", lines: [
      F0(0.005, "DOR location code 1710. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-enumclaw-city-1711", kind: "municipal", name: "Enumclaw city", county: "King County", lines: [
      F0(0.005, "DOR location code 1711. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-covington-city-1712", kind: "municipal", name: "Covington city", county: "King County", lines: [
      F0(0.005, "DOR location code 1712. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-hunts-point-town-1713", kind: "municipal", name: "Hunts Point town", county: "King County", lines: [
      F0(0.005, "DOR location code 1713. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-issaquah-city-1714", kind: "municipal", name: "Issaquah city", county: "King County", lines: [
      F0(0.005, "DOR location code 1714. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-kent-city-1715", kind: "municipal", name: "Kent city", county: "King County", lines: [
      F0(0.005, "DOR location code 1715. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-kirkland-city-1716", kind: "municipal", name: "Kirkland city", county: "King County", lines: [
      F0(0.005, "DOR location code 1716. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-lake-forest-park-city-1717", kind: "municipal", name: "Lake Forest Park city", county: "King County", lines: [
      F0(0.005, "DOR location code 1717. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-medina-city-1718", kind: "municipal", name: "Medina city", county: "King County", lines: [
      F0(0.005, "DOR location code 1718. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-mercer-island-city-1719", kind: "municipal", name: "Mercer Island city", county: "King County", lines: [
      F0(0.005, "DOR location code 1719. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-maple-valley-city-1720", kind: "municipal", name: "Maple Valley city", county: "King County", lines: [
      F0(0.005, "DOR location code 1720. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-normandy-park-city-1721", kind: "municipal", name: "Normandy Park city", county: "King County", lines: [
      F0(0.005, "DOR location code 1721. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-north-bend-city-1722", kind: "municipal", name: "North Bend city", county: "King County", lines: [
      F0(0.005, "DOR location code 1722. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-pacific-city-1723", kind: "municipal", name: "Pacific city", county: "King County", lines: [
      F0(0.005, "DOR location code 1723. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-redmond-city-1724", kind: "municipal", name: "Redmond city", county: "King County", lines: [
      F0(0.005, "DOR location code 1724. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-renton-city-1725", kind: "municipal", name: "Renton city", county: "King County", lines: [
      F0(0.005, "DOR location code 1725. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-seattle-city-1726", kind: "municipal", name: "Seattle city", county: "King County", lines: [
      F0(0.005, "DOR location code 1726. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-skykomish-town-1727", kind: "municipal", name: "Skykomish town", county: "King County", lines: [
      F0(0.0025, "DOR location code 1727. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-snoqualmie-city-1728", kind: "municipal", name: "Snoqualmie city", county: "King County", lines: [
      F0(0.005, "DOR location code 1728. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-tukwila-city-1729", kind: "municipal", name: "Tukwila city", county: "King County", lines: [
      F0(0.005, "DOR location code 1729. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-yarrow-point-town-1730", kind: "municipal", name: "Yarrow Point town", county: "King County", lines: [
      F0(0.005, "DOR location code 1730. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-milton-city-1731", kind: "municipal", name: "Milton city", county: "King County", lines: [
      F0(0.005, "DOR location code 1731. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-federal-way-city-1732", kind: "municipal", name: "Federal Way city", county: "King County", lines: [
      F0(0.005, "DOR location code 1732. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-seatac-city-1733", kind: "municipal", name: "SeaTac city", county: "King County", lines: [
      F0(0.005, "DOR location code 1733. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-burien-city-1734", kind: "municipal", name: "Burien city", county: "King County", lines: [
      F0(0.005, "DOR location code 1734. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-woodinville-city-1735", kind: "municipal", name: "Woodinville city", county: "King County", lines: [
      F0(0.005, "DOR location code 1735. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-newcastle-city-1736", kind: "municipal", name: "Newcastle city", county: "King County", lines: [
      F0(0.005, "DOR location code 1736. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-shoreline-city-1737", kind: "municipal", name: "Shoreline city", county: "King County", lines: [
      F0(0.005, "DOR location code 1737. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-kenmore-city-1738", kind: "municipal", name: "Kenmore city", county: "King County", lines: [
      F0(0.005, "DOR location code 1738. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-king-county-sammamish-city-1739", kind: "municipal", name: "Sammamish city", county: "King County", lines: [
      F0(0.005, "DOR location code 1739. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-kitsap-county-unincorporated-1800", kind: "municipal", name: "Unincorporated Kitsap County", county: "Kitsap County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 1800. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-kitsap-county-bremerton-city-1801", kind: "municipal", name: "Bremerton city", county: "Kitsap County", lines: [
      F0(0.005, "DOR location code 1801. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-kitsap-county-port-orchard-city-1802", kind: "municipal", name: "Port Orchard city", county: "Kitsap County", lines: [
      F0(0.005, "DOR location code 1802. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-kitsap-county-poulsbo-city-1803", kind: "municipal", name: "Poulsbo city", county: "Kitsap County", lines: [
      F0(0.005, "DOR location code 1803. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-kitsap-county-bainbridge-island-city-1804", kind: "municipal", name: "Bainbridge Island city", county: "Kitsap County", lines: [
      F0(0.005, "DOR location code 1804. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-kittitas-county-unincorporated-1900", kind: "municipal", name: "Unincorporated Kittitas County", county: "Kittitas County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 1900. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-kittitas-county-cle-elum-city-1901", kind: "municipal", name: "Cle Elum city", county: "Kittitas County", lines: [
      F0(0.005, "DOR location code 1901. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-kittitas-county-ellensburg-city-1902", kind: "municipal", name: "Ellensburg city", county: "Kittitas County", lines: [
      F0(0.005, "DOR location code 1902. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-kittitas-county-kittitas-city-1903", kind: "municipal", name: "Kittitas city", county: "Kittitas County", lines: [
      F0(0.0025, "DOR location code 1903. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-kittitas-county-roslyn-city-1904", kind: "municipal", name: "Roslyn city", county: "Kittitas County", lines: [
      F0(0.005, "DOR location code 1904. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-kittitas-county-south-cle-elum-town-1905", kind: "municipal", name: "South Cle Elum town", county: "Kittitas County", lines: [
      F0(0.0025, "DOR location code 1905. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-klickitat-county-unincorporated-2000", kind: "municipal", name: "Unincorporated Klickitat County", county: "Klickitat County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 2000. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-klickitat-county-bingen-city-2001", kind: "municipal", name: "Bingen city", county: "Klickitat County", lines: [
      F0(0.0025, "DOR location code 2001. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-klickitat-county-goldendale-city-2002", kind: "municipal", name: "Goldendale city", county: "Klickitat County", lines: [
      F0(0.0025, "DOR location code 2002. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-klickitat-county-white-salmon-city-2003", kind: "municipal", name: "White Salmon city", county: "Klickitat County", lines: [
      F0(0.0025, "DOR location code 2003. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lewis-county-unincorporated-2100", kind: "municipal", name: "Unincorporated Lewis County", county: "Lewis County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 2100. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lewis-county-centralia-city-2101", kind: "municipal", name: "Centralia city", county: "Lewis County", lines: [
      F0(0.005, "DOR location code 2101. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lewis-county-chehalis-city-2102", kind: "municipal", name: "Chehalis city", county: "Lewis County", lines: [
      F0(0.005, "DOR location code 2102. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lewis-county-morton-city-2103", kind: "municipal", name: "Morton city", county: "Lewis County", lines: [
      F0(0.005, "DOR location code 2103. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lewis-county-mossyrock-city-2104", kind: "municipal", name: "Mossyrock city", county: "Lewis County", lines: [
      F0(0.005, "DOR location code 2104. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lewis-county-napavine-city-2105", kind: "municipal", name: "Napavine city", county: "Lewis County", lines: [
      F0(0.005, "DOR location code 2105. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lewis-county-pe-ell-town-2106", kind: "municipal", name: "Pe Ell town", county: "Lewis County", lines: [
      F0(0.0025, "DOR location code 2106. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lewis-county-toledo-city-2107", kind: "municipal", name: "Toledo city", county: "Lewis County", lines: [
      F0(0.005, "DOR location code 2107. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lewis-county-vader-city-2108", kind: "municipal", name: "Vader city", county: "Lewis County", lines: [
      F0(0.005, "DOR location code 2108. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lewis-county-winlock-city-2109", kind: "municipal", name: "Winlock city", county: "Lewis County", lines: [
      F0(0.005, "DOR location code 2109. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lincoln-county-unincorporated-2200", kind: "municipal", name: "Unincorporated Lincoln County", county: "Lincoln County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 2200. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lincoln-county-almira-town-2201", kind: "municipal", name: "Almira town", county: "Lincoln County", lines: [
      F0(0.0025, "DOR location code 2201. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lincoln-county-creston-town-2202", kind: "municipal", name: "Creston town", county: "Lincoln County", lines: [
      F0(0.0025, "DOR location code 2202. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lincoln-county-davenport-city-2203", kind: "municipal", name: "Davenport city", county: "Lincoln County", lines: [
      F0(0.0025, "DOR location code 2203. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lincoln-county-harrington-city-2204", kind: "municipal", name: "Harrington city", county: "Lincoln County", lines: [
      F0(0.0025, "DOR location code 2204. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lincoln-county-odessa-town-2205", kind: "municipal", name: "Odessa town", county: "Lincoln County", lines: [
      F0(0.0025, "DOR location code 2205. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lincoln-county-reardan-town-2206", kind: "municipal", name: "Reardan town", county: "Lincoln County", lines: [
      F0(0.0025, "DOR location code 2206. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lincoln-county-sprague-city-2207", kind: "municipal", name: "Sprague city", county: "Lincoln County", lines: [
      F0(0.0025, "DOR location code 2207. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-lincoln-county-wilbur-town-2208", kind: "municipal", name: "Wilbur town", county: "Lincoln County", lines: [
      F0(0.0025, "DOR location code 2208. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-mason-county-unincorporated-2300", kind: "municipal", name: "Unincorporated Mason County", county: "Mason County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 2300. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-mason-county-shelton-city-2301", kind: "municipal", name: "Shelton city", county: "Mason County", lines: [
      F0(0.005, "DOR location code 2301. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-okanogan-county-unincorporated-2400", kind: "municipal", name: "Unincorporated Okanogan County", county: "Okanogan County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 2400. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-okanogan-county-brewster-city-2401", kind: "municipal", name: "Brewster city", county: "Okanogan County", lines: [
      F0(0.0025, "DOR location code 2401. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-okanogan-county-conconully-town-2402", kind: "municipal", name: "Conconully town", county: "Okanogan County", lines: [
      F0(0.0025, "DOR location code 2402. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-okanogan-county-coulee-dam-town-2403", kind: "municipal", name: "Coulee Dam town", county: "Okanogan County", lines: [
      F0(0.005, "DOR location code 2403. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-okanogan-county-elmer-city-town-2404", kind: "municipal", name: "Elmer City town", county: "Okanogan County", lines: [
      F0(0.0025, "DOR location code 2404. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-okanogan-county-nespelem-town-2405", kind: "municipal", name: "Nespelem town", county: "Okanogan County", lines: [
      F0(0.0025, "DOR location code 2405. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-okanogan-county-okanogan-city-2406", kind: "municipal", name: "Okanogan city", county: "Okanogan County", lines: [
      F0(0.0025, "DOR location code 2406. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-okanogan-county-omak-city-2407", kind: "municipal", name: "Omak city", county: "Okanogan County", lines: [
      F0(0.0025, "DOR location code 2407. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-okanogan-county-oroville-city-2408", kind: "municipal", name: "Oroville city", county: "Okanogan County", lines: [
      F0(0.0025, "DOR location code 2408. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-okanogan-county-pateros-city-2409", kind: "municipal", name: "Pateros city", county: "Okanogan County", lines: [
      F0(0.0025, "DOR location code 2409. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-okanogan-county-riverside-town-2410", kind: "municipal", name: "Riverside town", county: "Okanogan County", lines: [
      F0(0.0025, "DOR location code 2410. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-okanogan-county-tonasket-city-2411", kind: "municipal", name: "Tonasket city", county: "Okanogan County", lines: [
      F0(0.005, "DOR location code 2411. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-okanogan-county-twisp-town-2412", kind: "municipal", name: "Twisp town", county: "Okanogan County", lines: [
      F0(0.0025, "DOR location code 2412. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-okanogan-county-winthrop-town-2413", kind: "municipal", name: "Winthrop town", county: "Okanogan County", lines: [
      F0(0.0025, "DOR location code 2413. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pacific-county-unincorporated-2500", kind: "municipal", name: "Unincorporated Pacific County", county: "Pacific County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 2500. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pacific-county-ilwaco-city-2501", kind: "municipal", name: "Ilwaco city", county: "Pacific County", lines: [
      F0(0.0025, "DOR location code 2501. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pacific-county-long-beach-city-2502", kind: "municipal", name: "Long Beach city", county: "Pacific County", lines: [
      F0(0.0025, "DOR location code 2502. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pacific-county-raymond-city-2503", kind: "municipal", name: "Raymond city", county: "Pacific County", lines: [
      F0(0.0025, "DOR location code 2503. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pacific-county-south-bend-city-2504", kind: "municipal", name: "South Bend city", county: "Pacific County", lines: [
      F0(0.0025, "DOR location code 2504. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pend-oreille-county-unincorporated-2600", kind: "municipal", name: "Unincorporated Pend Oreille County", county: "Pend Oreille County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 2600. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pend-oreille-county-cusick-town-2601", kind: "municipal", name: "Cusick town", county: "Pend Oreille County", lines: [
      F0(0.0025, "DOR location code 2601. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pend-oreille-county-ione-town-2602", kind: "municipal", name: "Ione town", county: "Pend Oreille County", lines: [
      F0(0.0025, "DOR location code 2602. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pend-oreille-county-metaline-town-2603", kind: "municipal", name: "Metaline town", county: "Pend Oreille County", lines: [] },
  { id: "wa-pend-oreille-county-metaline-falls-town-2604", kind: "municipal", name: "Metaline Falls town", county: "Pend Oreille County", lines: [
      F0(0.0025, "DOR location code 2604. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pend-oreille-county-newport-city-2605", kind: "municipal", name: "Newport city", county: "Pend Oreille County", lines: [
      F0(0.005, "DOR location code 2605. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-unincorporated-2700", kind: "municipal", name: "Unincorporated Pierce County", county: "Pierce County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 2700. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-bonney-lake-city-2701", kind: "municipal", name: "Bonney Lake city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2701. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-buckley-city-2702", kind: "municipal", name: "Buckley city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2702. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-carbonado-town-2703", kind: "municipal", name: "Carbonado town", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2703. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-dupont-city-2704", kind: "municipal", name: "DuPont city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2704. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-eatonville-town-2705", kind: "municipal", name: "Eatonville town", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2705. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-fife-city-2706", kind: "municipal", name: "Fife city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2706. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-fircrest-city-2707", kind: "municipal", name: "Fircrest city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2707. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-gig-harbor-city-2708", kind: "municipal", name: "Gig Harbor city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2708. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-milton-city-2709", kind: "municipal", name: "Milton city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2709. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-orting-city-2710", kind: "municipal", name: "Orting city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2710. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-puyallup-city-2711", kind: "municipal", name: "Puyallup city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2711. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-roy-city-2712", kind: "municipal", name: "Roy city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2712. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-ruston-town-2713", kind: "municipal", name: "Ruston town", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2713. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-south-prairie-town-2714", kind: "municipal", name: "South Prairie town", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2714. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-steilacoom-town-2715", kind: "municipal", name: "Steilacoom town", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2715. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-sumner-city-2716", kind: "municipal", name: "Sumner city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2716. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-tacoma-city-2717", kind: "municipal", name: "Tacoma city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2717. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-wilkeson-town-2718", kind: "municipal", name: "Wilkeson town", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2718. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-university-place-city-2719", kind: "municipal", name: "University Place city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2719. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-edgewood-city-2720", kind: "municipal", name: "Edgewood city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2720. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-lakewood-city-2721", kind: "municipal", name: "Lakewood city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2721. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-pacific-city-2723", kind: "municipal", name: "Pacific city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2723. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-pierce-county-auburn-city-2724", kind: "municipal", name: "Auburn city", county: "Pierce County", lines: [
      F0(0.005, "DOR location code 2724. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-san-juan-county-unincorporated-2800", kind: "municipal", name: "Unincorporated San Juan County", county: "San Juan County", match: ["unincorporated"], lines: [
      { name: "Local REET (REET 1 + REET 2, RCW 82.46.010/.035)", rate: 0.005, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2026-05-01", notes: "DOR location code 2800; DOR table shows 2.00% combined local; 0.5% is the remainder after the two purchaser-obligation San Juan taxes below (derived: 2.0% - 1.0% - 0.5%)." },
      { name: "San Juan County Land Bank (conservation area) REET, RCW 82.46.070", rate: 0.01, base: "price", party: "buyer", source: S2, sourceUrl: S3, asOf: "2026-05-01", notes: "Purchaser obligation by statute. Included in DOR's 2.00% local rate." },
      { name: "San Juan County Affordable Housing REET, RCW 82.46.075 / SJCC 3.10", rate: 0.005, base: "price", party: "buyer", source: S4, sourceUrl: S5, asOf: "2026-05-01", notes: "SJCC 3.10 allocates 99% to purchaser and 1% to seller (county code text not directly readable — codepublishing redirects to eCode360; allocation per search snippet of SJCC 3.10). Modeled as buyer. Included in DOR's 2.00% local rate." }
    ] },
  { id: "wa-san-juan-county-friday-harbor-town-2801", kind: "municipal", name: "Friday Harbor town", county: "San Juan County", lines: [
      { name: "Local REET (REET 1 + REET 2, RCW 82.46.010/.035)", rate: 0.005, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2026-05-01", notes: "DOR location code 2801; DOR table shows 2.00% combined local; 0.5% is the remainder after the two purchaser-obligation San Juan taxes below (derived: 2.0% - 1.0% - 0.5%)." },
      { name: "San Juan County Land Bank (conservation area) REET, RCW 82.46.070", rate: 0.01, base: "price", party: "buyer", source: S2, sourceUrl: S3, asOf: "2026-05-01", notes: "Purchaser obligation by statute. Included in DOR's 2.00% local rate." },
      { name: "San Juan County Affordable Housing REET, RCW 82.46.075 / SJCC 3.10", rate: 0.005, base: "price", party: "buyer", source: S4, sourceUrl: S5, asOf: "2026-05-01", notes: "SJCC 3.10 allocates 99% to purchaser and 1% to seller (county code text not directly readable — codepublishing redirects to eCode360; allocation per search snippet of SJCC 3.10). Modeled as buyer. Included in DOR's 2.00% local rate." }
    ] },
  { id: "wa-skagit-county-unincorporated-2900", kind: "municipal", name: "Unincorporated Skagit County", county: "Skagit County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 2900. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-skagit-county-anacortes-city-2901", kind: "municipal", name: "Anacortes city", county: "Skagit County", lines: [
      F0(0.005, "DOR location code 2901. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-skagit-county-burlington-city-2902", kind: "municipal", name: "Burlington city", county: "Skagit County", lines: [
      F0(0.005, "DOR location code 2902. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-skagit-county-concrete-town-2903", kind: "municipal", name: "Concrete town", county: "Skagit County", lines: [
      F0(0.005, "DOR location code 2903. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-skagit-county-hamilton-town-2904", kind: "municipal", name: "Hamilton town", county: "Skagit County", lines: [
      F0(0.005, "DOR location code 2904. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-skagit-county-la-conner-town-2905", kind: "municipal", name: "La Conner town", county: "Skagit County", lines: [
      F0(0.005, "DOR location code 2905. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-skagit-county-lyman-town-2906", kind: "municipal", name: "Lyman town", county: "Skagit County", lines: [
      F0(0.005, "DOR location code 2906. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-skagit-county-mount-vernon-city-2907", kind: "municipal", name: "Mount Vernon city", county: "Skagit County", lines: [
      F0(0.005, "DOR location code 2907. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-skagit-county-sedro-woolley-city-2908", kind: "municipal", name: "Sedro-Woolley city", county: "Skagit County", lines: [
      F0(0.005, "DOR location code 2908. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-skamania-county-unincorporated-3000", kind: "municipal", name: "Unincorporated Skamania County", county: "Skamania County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 3000. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-skamania-county-north-bonneville-city-3001", kind: "municipal", name: "North Bonneville city", county: "Skamania County", lines: [
      F0(0.0025, "DOR location code 3001. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-skamania-county-stevenson-city-3002", kind: "municipal", name: "Stevenson city", county: "Skamania County", lines: [
      F0(0.0025, "DOR location code 3002. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-unincorporated-3100", kind: "municipal", name: "Unincorporated Snohomish County", county: "Snohomish County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 3100. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-arlington-city-3101", kind: "municipal", name: "Arlington city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3101. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-brier-city-3102", kind: "municipal", name: "Brier city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3102. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-darrington-town-3103", kind: "municipal", name: "Darrington town", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3103. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-edmonds-city-3104", kind: "municipal", name: "Edmonds city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3104. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-everett-city-3105", kind: "municipal", name: "Everett city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3105. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-gold-bar-city-3106", kind: "municipal", name: "Gold Bar city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3106. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-granite-falls-city-3107", kind: "municipal", name: "Granite Falls city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3107. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-index-town-3108", kind: "municipal", name: "Index town", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3108. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-lake-stevens-city-3109", kind: "municipal", name: "Lake Stevens city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3109. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-lynnwood-city-3110", kind: "municipal", name: "Lynnwood city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3110. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-marysville-city-3111", kind: "municipal", name: "Marysville city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3111. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-monroe-city-3112", kind: "municipal", name: "Monroe city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3112. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-mountlake-terrace-city-3113", kind: "municipal", name: "Mountlake Terrace city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3113. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-mukilteo-city-3114", kind: "municipal", name: "Mukilteo city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3114. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-snohomish-city-3115", kind: "municipal", name: "Snohomish city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3115. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-stanwood-city-3116", kind: "municipal", name: "Stanwood city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3116. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-sultan-city-3117", kind: "municipal", name: "Sultan city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3117. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-woodway-city-3118", kind: "municipal", name: "Woodway city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3118. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-mill-creek-city-3119", kind: "municipal", name: "Mill Creek city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3119. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-snohomish-county-bothell-city-3120", kind: "municipal", name: "Bothell city", county: "Snohomish County", lines: [
      F0(0.005, "DOR location code 3120. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-spokane-county-unincorporated-3200", kind: "municipal", name: "Unincorporated Spokane County", county: "Spokane County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 3200. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-spokane-county-airway-heights-city-3201", kind: "municipal", name: "Airway Heights city", county: "Spokane County", lines: [
      F0(0.005, "DOR location code 3201. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-spokane-county-cheney-city-3202", kind: "municipal", name: "Cheney city", county: "Spokane County", lines: [
      F0(0.005, "DOR location code 3202. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-spokane-county-deer-park-city-3203", kind: "municipal", name: "Deer Park city", county: "Spokane County", lines: [
      F0(0.005, "DOR location code 3203. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-spokane-county-fairfield-town-3204", kind: "municipal", name: "Fairfield town", county: "Spokane County", lines: [
      F0(0.0025, "DOR location code 3204. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-spokane-county-latah-town-3205", kind: "municipal", name: "Latah town", county: "Spokane County", lines: [
      F0(0.0025, "DOR location code 3205. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-spokane-county-medical-lake-city-3206", kind: "municipal", name: "Medical Lake city", county: "Spokane County", lines: [
      F0(0.0025, "DOR location code 3206. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-spokane-county-millwood-city-3207", kind: "municipal", name: "Millwood city", county: "Spokane County", lines: [
      F0(0.005, "DOR location code 3207. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-spokane-county-rockford-town-3208", kind: "municipal", name: "Rockford town", county: "Spokane County", lines: [
      F0(0.0025, "DOR location code 3208. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-spokane-county-spangle-city-3209", kind: "municipal", name: "Spangle city", county: "Spokane County", lines: [
      F0(0.0025, "DOR location code 3209. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-spokane-county-spokane-city-3210", kind: "municipal", name: "Spokane city", county: "Spokane County", lines: [
      F0(0.005, "DOR location code 3210. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-spokane-county-waverly-town-3211", kind: "municipal", name: "Waverly town", county: "Spokane County", lines: [] },
  { id: "wa-spokane-county-liberty-lake-city-3212", kind: "municipal", name: "Liberty Lake city", county: "Spokane County", lines: [
      F0(0.005, "DOR location code 3212. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-spokane-county-spokane-valley-city-3213", kind: "municipal", name: "Spokane Valley city", county: "Spokane County", lines: [
      F0(0.005, "DOR location code 3213. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-stevens-county-unincorporated-3300", kind: "municipal", name: "Unincorporated Stevens County", county: "Stevens County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 3300. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-stevens-county-chewelah-city-3301", kind: "municipal", name: "Chewelah city", county: "Stevens County", lines: [
      F0(0.0025, "DOR location code 3301. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-stevens-county-colville-city-3302", kind: "municipal", name: "Colville city", county: "Stevens County", lines: [
      F0(0.0025, "DOR location code 3302. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-stevens-county-kettle-falls-city-3303", kind: "municipal", name: "Kettle Falls city", county: "Stevens County", lines: [
      F0(0.0025, "DOR location code 3303. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-stevens-county-marcus-town-3304", kind: "municipal", name: "Marcus town", county: "Stevens County", lines: [
      F0(0.0025, "DOR location code 3304. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-stevens-county-northport-town-3305", kind: "municipal", name: "Northport town", county: "Stevens County", lines: [
      F0(0.0025, "DOR location code 3305. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-stevens-county-springdale-town-3306", kind: "municipal", name: "Springdale town", county: "Stevens County", lines: [
      F0(0.0025, "DOR location code 3306. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-thurston-county-unincorporated-3400", kind: "municipal", name: "Unincorporated Thurston County", county: "Thurston County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 3400. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-thurston-county-bucoda-town-3401", kind: "municipal", name: "Bucoda town", county: "Thurston County", lines: [
      F0(0.005, "DOR location code 3401. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-thurston-county-lacey-city-3402", kind: "municipal", name: "Lacey city", county: "Thurston County", lines: [
      F0(0.005, "DOR location code 3402. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-thurston-county-olympia-city-3403", kind: "municipal", name: "Olympia city", county: "Thurston County", lines: [
      F0(0.005, "DOR location code 3403. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-thurston-county-rainier-city-3404", kind: "municipal", name: "Rainier city", county: "Thurston County", lines: [
      F0(0.0025, "DOR location code 3404. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-thurston-county-tenino-city-3405", kind: "municipal", name: "Tenino city", county: "Thurston County", lines: [
      F0(0.005, "DOR location code 3405. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-thurston-county-tumwater-city-3406", kind: "municipal", name: "Tumwater city", county: "Thurston County", lines: [
      F0(0.005, "DOR location code 3406. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-thurston-county-yelm-city-3407", kind: "municipal", name: "Yelm city", county: "Thurston County", lines: [
      F0(0.005, "DOR location code 3407. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-wahkiakum-county-unincorporated-3500", kind: "municipal", name: "Unincorporated Wahkiakum County", county: "Wahkiakum County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 3500. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-wahkiakum-county-cathlamet-town-3501", kind: "municipal", name: "Cathlamet town", county: "Wahkiakum County", lines: [
      F0(0.0025, "DOR location code 3501. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-walla-walla-county-unincorporated-3600", kind: "municipal", name: "Unincorporated Walla Walla County", county: "Walla Walla County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 3600. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-walla-walla-county-college-place-city-3601", kind: "municipal", name: "College Place city", county: "Walla Walla County", lines: [
      F0(0.005, "DOR location code 3601. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-walla-walla-county-prescott-city-3602", kind: "municipal", name: "Prescott city", county: "Walla Walla County", lines: [] },
  { id: "wa-walla-walla-county-waitsburg-city-3603", kind: "municipal", name: "Waitsburg city", county: "Walla Walla County", lines: [
      F0(0.005, "DOR location code 3603. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-walla-walla-county-walla-walla-city-3604", kind: "municipal", name: "Walla Walla city", county: "Walla Walla County", lines: [
      F0(0.0025, "DOR location code 3604. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whatcom-county-unincorporated-3700", kind: "municipal", name: "Unincorporated Whatcom County", county: "Whatcom County", match: ["unincorporated"], lines: [
      F0(0.005, "DOR location code 3700. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whatcom-county-bellingham-city-3701", kind: "municipal", name: "Bellingham city", county: "Whatcom County", lines: [
      F0(0.005, "DOR location code 3701. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whatcom-county-blaine-city-3702", kind: "municipal", name: "Blaine city", county: "Whatcom County", lines: [
      F0(0.005, "DOR location code 3702. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whatcom-county-everson-city-3703", kind: "municipal", name: "Everson city", county: "Whatcom County", lines: [
      F0(0.005, "DOR location code 3703. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whatcom-county-ferndale-city-3704", kind: "municipal", name: "Ferndale city", county: "Whatcom County", lines: [
      F0(0.005, "DOR location code 3704. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whatcom-county-lynden-city-3705", kind: "municipal", name: "Lynden city", county: "Whatcom County", lines: [
      F0(0.005, "DOR location code 3705. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whatcom-county-nooksack-city-3706", kind: "municipal", name: "Nooksack city", county: "Whatcom County", lines: [
      F0(0.005, "DOR location code 3706. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whatcom-county-sumas-city-3707", kind: "municipal", name: "Sumas city", county: "Whatcom County", lines: [
      F0(0.005, "DOR location code 3707. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-unincorporated-3800", kind: "municipal", name: "Unincorporated Whitman County", county: "Whitman County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 3800. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-albion-town-3801", kind: "municipal", name: "Albion town", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3801. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-colfax-city-3802", kind: "municipal", name: "Colfax city", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3802. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-colton-town-3803", kind: "municipal", name: "Colton town", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3803. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-endicott-town-3804", kind: "municipal", name: "Endicott town", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3804. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-farmington-town-3805", kind: "municipal", name: "Farmington town", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3805. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-garfield-town-3806", kind: "municipal", name: "Garfield town", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3806. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-lacrosse-town-3807", kind: "municipal", name: "LaCrosse town", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3807. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-lamont-town-3808", kind: "municipal", name: "Lamont town", county: "Whitman County", lines: [] },
  { id: "wa-whitman-county-malden-town-3809", kind: "municipal", name: "Malden town", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3809. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-oakesdale-town-3810", kind: "municipal", name: "Oakesdale town", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3810. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-palouse-city-3811", kind: "municipal", name: "Palouse city", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3811. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-pullman-city-3812", kind: "municipal", name: "Pullman city", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3812. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-rosalia-town-3813", kind: "municipal", name: "Rosalia town", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3813. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-st-john-town-3814", kind: "municipal", name: "St. John town", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3814. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-tekoa-city-3815", kind: "municipal", name: "Tekoa city", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3815. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-whitman-county-uniontown-town-3816", kind: "municipal", name: "Uniontown town", county: "Whitman County", lines: [
      F0(0.0025, "DOR location code 3816. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-unincorporated-3900", kind: "municipal", name: "Unincorporated Yakima County", county: "Yakima County", match: ["unincorporated"], lines: [
      F0(0.0025, "DOR location code 3900. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-grandview-city-3901", kind: "municipal", name: "Grandview city", county: "Yakima County", lines: [
      F0(0.005, "DOR location code 3901. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-granger-city-3902", kind: "municipal", name: "Granger city", county: "Yakima County", lines: [
      F0(0.005, "DOR location code 3902. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-harrah-town-3903", kind: "municipal", name: "Harrah town", county: "Yakima County", lines: [
      F0(0.0025, "DOR location code 3903. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-mabton-city-3904", kind: "municipal", name: "Mabton city", county: "Yakima County", lines: [
      F0(0.005, "DOR location code 3904. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-moxee-city-3905", kind: "municipal", name: "Moxee city", county: "Yakima County", lines: [
      F0(0.0025, "DOR location code 3905. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-naches-town-3906", kind: "municipal", name: "Naches town", county: "Yakima County", lines: [
      F0(0.0025, "DOR location code 3906. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-selah-city-3907", kind: "municipal", name: "Selah city", county: "Yakima County", lines: [
      F0(0.005, "DOR location code 3907. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-sunnyside-city-3908", kind: "municipal", name: "Sunnyside city", county: "Yakima County", lines: [
      F0(0.005, "DOR location code 3908. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-tieton-city-3909", kind: "municipal", name: "Tieton city", county: "Yakima County", lines: [
      F0(0.0025, "DOR location code 3909. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-toppenish-city-3910", kind: "municipal", name: "Toppenish city", county: "Yakima County", lines: [
      F0(0.005, "DOR location code 3910. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-union-gap-city-3911", kind: "municipal", name: "Union Gap city", county: "Yakima County", lines: [
      F0(0.005, "DOR location code 3911. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-wapato-city-3912", kind: "municipal", name: "Wapato city", county: "Yakima County", lines: [
      F0(0.005, "DOR location code 3912. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-yakima-city-3913", kind: "municipal", name: "Yakima city", county: "Yakima County", lines: [
      F0(0.005, "DOR location code 3913. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  { id: "wa-yakima-county-zillah-city-3914", kind: "municipal", name: "Zillah city", county: "Yakima County", lines: [
      F0(0.005, "DOR location code 3914. Combined local REET (REET 1 + REET 2). Seller.")
    ] },
  ],
};
