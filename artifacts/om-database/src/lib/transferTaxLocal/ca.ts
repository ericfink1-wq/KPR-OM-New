// GENERATED from official-source research (CA.prep.json) — do not hand-edit rates here
// without updating the source + asOf on the line. Level: municipality. Local table complete: True.
// Local-level source: California City Finance — California City Documentary and Property Transfer Tax Rates (secondary compilation, rev. 01 Dec 2025) (https://www.californiacityfinance.com/PropTransfTaxRates.pdf) as of 2025-12-01.
import type { LocalTaxTable, TaxLineItem, SourceRef } from "../closingCostTypes";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _T = TaxLineItem;

const S0 = "Los Angeles Office of Finance — Real Property Transfer Tax and Measure ULA FAQ";
const S1 = "https://finance.lacity.gov/faq/measure-ula";
const S2 = "City of Culver City — Real Property Transfer Tax (rptt)";
const S3 = "https://www.culvercity.gov/rptt";
const S4 = "City of Santa Monica — Documentary Transfer Tax (Real Property Transfer Tax)";
const S5 = "https://www.santamonica.gov/documentary-transfer-tax-real-property-transfer-tax";
const S6 = "LA County Registrar-Recorder/County Clerk — Documentary Transfer Tax (special city rates)";
const S7 = "https://www.lavote.gov/home/recorder/property-document-recording/documentary-transfer-taxes/general-info";
const S8 = "SF Office of the Assessor-Recorder — Transfer tax";
const S9 = "https://www.sf.gov/transfer-tax";
const S10 = "Alameda County Auditor-Controller/Clerk-Recorder — Documentary Transfer Tax / City Real Property Conveyance Tax";
const S11 = "https://auditor.alamedacountyca.gov/clerk-recorder-real-property-tax/";
const S12 = "Contra Costa County Clerk-Recorder — City of Richmond transfer tax";
const S13 = "https://www.contracostavote.gov/recorder/recording-fees/documentary-transfer-tax/city-of-richmond/";
const S14 = "Contra Costa County Clerk-Recorder — City of El Cerrito transfer tax";
const S15 = "https://www.contracostavote.gov/recorder/recording-fees/documentary-transfer-tax/city-of-el-cerrito/";
const S16 = "Santa Clara County Clerk-Recorder — city conveyance tax / Measure E / Measure G pages (403 to our fetcher; content via search index) + CCF";
const S17 = "https://clerkrecorder.santaclaracounty.gov/recording-documents/recording-real-estate/measure-e";
const S18 = "City of San Jose — Measure E Real Property Transfer Tax (403 to fetcher; content via search index); Santa Clara County Clerk-Recorder Measure E page";
const S19 = "https://www.sanjoseca.gov/your-government/departments-offices/housing/resource-library/housing-investment-plans-and-policy/measure-e-real-property-transfer-tax";
const S20 = "Santa Clara County Clerk-Recorder — Measure G (403 to fetcher; content via search index); City of Mountain View Measure G; CCF";
const S21 = "https://clerkrecorder.santaclaracounty.gov/measure-g";
const S22 = "City of San Mateo Municipal Code §3.48.010 (Measure CC, Nov 2022)";
const S23 = "https://law.cityofsanmateo.org/us/ca/cities/san-mateo/code/3.48.010";
const S24 = "California City Finance — California City Documentary and Property Transfer Tax Rates (secondary compilation, rev. 01 Dec 2025)";
const S25 = "https://www.californiacityfinance.com/PropTransfTaxRates.pdf";
const S26 = "Riverside County Assessor-County Clerk-Recorder — Recording Requirements (Documentary Transfer Tax)";
const S27 = "https://www.rivcoacr.org/RecordingRequirements";
const S28 = "Sonoma County Clerk-Recorder — Documentary Transfer Tax";
const S29 = "https://sonomacounty.gov/administrative-support-and-fiscal-services/clerk-recorder-assessor/clerk-recorder/recorder-services/documentary-transfer-tax";

export const CA_LOCAL_LEVEL = "municipality" as const;
export const CA_LOCAL_LEVEL_SOURCE: SourceRef & { statement: string } = {
  source: "California City Finance — California City Documentary and Property Transfer Tax Rates (secondary compilation, rev. 01 Dec 2025)", sourceUrl: "https://www.californiacityfinance.com/PropTransfTaxRates.pdf", asOf: "2025-12-01",
  statement: "CCF lists all 482 incorporated cities + SF by county with city rate and county rate. Exactly 26 jurisdictions (25 charter cities + SF) levy a tax beyond the $1.10 county base; every other city shows $0.55 city + $0.55 county = $1.10. Cross-checked against official recorder pages: LA County Recorder names exactly 5 special cities (Culver City, Los Angeles, Pomona, Redondo Beach, Santa Monica); Alameda Recorder lists exactly Alameda, Albany, Berkeley, Emeryville, Hayward, Oakland, Piedmont, San Leandro; Contra Costa Recorder lists only El Cerrito and Richmond; Sonoma lists only Santa Rosa and Petaluma; Sacramento County says only the City of Sacramento has one.",
};

export const CA_LOCAL: LocalTaxTable = {
  countyAbsentMeansNone: false,
  muniAbsentMeansNone: true,
  placeBased: true,
  entries: [
  { id: "ca-los-angeles-county-los-angeles-city", kind: "municipal", name: "Los Angeles city", county: "Los Angeles County", lines: [
      { name: "City of Los Angeles — Base Real Property Transfer Tax", rate: 0.0045, base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2026-09-24", notes: "$2.25 per $500 (=$4.50/$1,000 = 0.45%) on every conveyance > $100, rounded up to next $500. City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax). LA County Recorder confirms the county rate for LA City is the FULL $1.10 and gives the example total $96.75 on $21,500 (= $1.10 + $4.50 per $1,000). So standard LA City total = 0.56%. Seller by custom (Fidelity: LA County city tax seller)." },
      { name: "City of Los Angeles — Measure ULA special transfer tax", rate: 0.055, tiers: [{ over: 0, rate: 0 }, { over: 5400000, rate: 0.04 }, { over: 10899999, rate: 0.055 }], base: "price", party: "seller", source: S0, sourceUrl: S1, asOf: "2026-07-01", notes: "SINGLE line so the two ULA rates can never stack (old file had 4% and 5.5% as separate lines that BOTH fired above $10M). CLIFF: the ULA rate applies to the ENTIRE consideration. FY2026-27 thresholds (transactions closing after June 30, 2026): 4% when price > $5,400,000 and < $10,900,000; 5.5% when price >= $10,900,000 (tier coded over 10,899,999 so an exact $10.9M hits 5.5%). ON TOP of the 0.45% base and the county 0.11% => all-in 4.56% / 6.06%. Prior FY2025-26 thresholds (7/1/2025-6/30/2026 closings): $5,300,000 / $10,600,000 (LA County Recorder page lists both). Original 2023 thresholds were $5M/$10M. Thresholds re-index every July 1 by chained CPI — re-check each July. Applies to commercial. Pending Nov 2026 LA City ballot measure would exempt new apartment/mixed-use buildings within 10 years of construction — does not affect retail." }
    ] },
  { id: "ca-los-angeles-county-culver-city-city", kind: "municipal", verify: "Culver City's page was only readable through a fetch proxy; brackets corroborated by the LA County recorder. Confirm.", name: "Culver City city", county: "Los Angeles County", lines: [
      { name: "Culver City — Real Property Transfer Tax", rate: 0.04, marginalTiers: [{ over: 0, rate: 0.0045 }, { over: 1499999, rate: 0.015 }, { over: 2999999, rate: 0.03 }, { over: 9999999, rate: 0.04 }], base: "price", party: "seller", source: S2, sourceUrl: S3, asOf: "2021-04-01", notes: "MARGINAL / graduated (city's own worked example: $2.5M sale = $1,499,999 x 0.45% + $1,000,001 x 1.5% = $21,750). 0.45% on first $1,499,999; 1.5% $1.5M-$2,999,999; 3% $3M-$9,999,999; 4% on $10M+. Effective 4/1/2021 (Measure RE). City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax). LA County Recorder lists Culver City among the 5 special cities at full county $1.10. NOTE Culver's base INCLUDES liens/encumbrances (full value). City page was read via fetch (direct download blocked by the site's WAF); LA Recorder page corroborates the brackets." }
    ] },
  { id: "ca-los-angeles-county-santa-monica-city", kind: "municipal", name: "Santa Monica city", county: "Los Angeles County", lines: [
      { name: "Santa Monica — Documentary Transfer Tax incl. Measure GS", rate: 0.056, tiers: [{ over: 0, rate: 0.003 }, { over: 4999999, rate: 0.006 }, { over: 7999999, rate: 0.056 }], base: "price", party: "seller", source: S4, sourceUrl: S5, asOf: "2023-03-01", notes: "CLIFF, whole value (city's example: $8M transfer => city $448,000 = 5.6% x $8M). $3.00/$1,000 under $5M; $6.00/$1,000 $5M-$7,999,999.99; $56.00/$1,000 at $8M or more (Measure GS, from 3/1/2023). City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax). All-in at $8M+: 5.71%." }
    ] },
  { id: "ca-los-angeles-county-pomona-city", kind: "municipal", name: "Pomona city", county: "Los Angeles County", lines: [
      { name: "Pomona — City Documentary Transfer Tax", rate: 0.0022, base: "price", party: "seller", source: S6, sourceUrl: S7, asOf: "2026-09-24", notes: "$2.20 per $1,000 = 0.22%, flat. City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax)." }
    ] },
  { id: "ca-los-angeles-county-redondo-beach-city", kind: "municipal", name: "Redondo Beach city", county: "Los Angeles County", lines: [
      { name: "Redondo Beach — City Documentary Transfer Tax", rate: 0.0022, base: "price", party: "seller", source: S6, sourceUrl: S7, asOf: "2026-09-24", notes: "$2.20 per $1,000 = 0.22%, flat. City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax)." }
    ] },
  { id: "ca-los-angeles-county-west-hollywood-city", kind: "municipal", name: "West Hollywood city", county: "Los Angeles County", lines: [] },
  { id: "ca-san-francisco-county-san-francisco-city", kind: "municipal", name: "San Francisco city", county: "San Francisco County", replaces: ["ca-county-dtt"], lines: [
      { name: "San Francisco — Real Property Transfer Tax", rate: 0.06, tiers: [{ over: 0, rate: 0.005 }, { over: 250000, rate: 0.0068 }, { over: 999999, rate: 0.0075 }, { over: 4999999, rate: 0.0225 }, { over: 9999999, rate: 0.055 }, { over: 24999999, rate: 0.06 }], base: "price", party: "seller", source: S8, sourceUrl: S9, asOf: "2021-01-01", notes: "IMPORTANT: SF is a consolidated city-county and levies ONE transfer tax — there is NO separate $1.10 county DTT on top. Official TOTAL rates (whole value, cliff; 'if ENTIRE value or consideration is...'): 0.50% (>$100 to <=$250,000; $2.50/$500); 0.68% (>$250,000 to <$1M; $3.40/$500); 0.75% ($1M to <$5M; $3.75/$500); 2.25% ($5M to <$10M; $11.25/$500); 5.50% ($10M to <$25M; $27.50/$500); 6.00% ($25M+; $30.00/$500). Modeled at the official TOTALS; the statewide county 0.11% line is switched off for SF. Prop I (Nov 2020) raised $10M-$25M to 5.5% and $25M+ to 6.0% eff. 1/1/2021. Seller by custom (Fidelity)." }
    ] },
  { id: "ca-alameda-county-alameda-city", kind: "municipal", name: "Alameda city", county: "Alameda County", lines: [
      { name: "City of Alameda — Real Property Transfer Tax", rate: 0.012, base: "price", party: "split", source: S10, sourceUrl: S11, asOf: "2026-09-24", notes: "$12.00 per $1,000 = 1.20% flat (Ord. 2987). City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax). Alameda Recorder: 'on full value', rounded up to next $500. Party: Fidelity shows city tax customarily SPLIT buyer/seller in Alameda County (residential custom; negotiable on commercial)." }
    ] },
  { id: "ca-alameda-county-albany-city", kind: "municipal", name: "Albany city", county: "Alameda County", lines: [
      { name: "Albany — Real Property Transfer Tax", rate: 0.015, base: "price", party: "split", source: S10, sourceUrl: S11, asOf: "2026-09-24", notes: "$15.00 per $1,000 = 1.50% flat (Ord. 2020-09). City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax). Alameda Recorder: 'on full value', rounded up to next $500. Party: Fidelity shows city tax customarily SPLIT buyer/seller in Alameda County (residential custom; negotiable on commercial)." }
    ] },
  { id: "ca-alameda-county-berkeley-city", kind: "municipal", verify: "SCHEDULED CHANGE: Measure W adds 3% / 3.5% tiers on 1/1/2027 with thresholds still to be set; the $1.7M threshold is indexed annually. Confirm for any 2027 closing.", name: "Berkeley city", county: "Alameda County", lines: [
      { name: "Berkeley — Real Property Transfer Tax", rate: 0.025, tiers: [{ over: 0, rate: 0.015 }, { over: 1700000, rate: 0.025 }], base: "price", party: "split", source: S10, sourceUrl: S11, asOf: "2026-09-24", notes: "1.5% up to $1,700,000; 2.5% on the ENTIRE value above $1,700,000 (city example: $2M sale owes $50,000). Threshold is indexed annually (was $1.6M in CCF's Dec-2025 table; Recorder + City now show $1.7M). FUTURE: Measure W (Nov 2024) effective 1/1/2027 adds tiers 3.0% (>= ~$1.9M) and 3.5% (>= ~$3.0M) with thresholds to be recalculated before 1/1/2027 — update this entry then. City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax). Alameda Recorder: 'on full value', rounded up to next $500. Party: Fidelity shows city tax customarily SPLIT buyer/seller in Alameda County (residential custom; negotiable on commercial)." }
    ] },
  { id: "ca-alameda-county-emeryville-city", kind: "municipal", name: "Emeryville city", county: "Alameda County", lines: [
      { name: "Emeryville — Real Property Transfer Tax", rate: 0.025, tiers: [{ over: 0, rate: 0.012 }, { over: 999999, rate: 0.015 }, { over: 2000000, rate: 0.025 }], base: "price", party: "split", source: S10, sourceUrl: S11, asOf: "2026-09-24", notes: "Measure O: $12.00/$1,000 (1.2%) under $1,000,000; $15.00/$1,000 (1.5%) $1,000,000-$2,000,000; $25.00/$1,000 (2.5%) $2,000,001+, all on full value. (CCF's table misprints the middle band as '$1m-$1.5m'; the Recorder's $1M-$2M is used.) City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax). Alameda Recorder: 'on full value', rounded up to next $500. Party: Fidelity shows city tax customarily SPLIT buyer/seller in Alameda County (residential custom; negotiable on commercial)." }
    ] },
  { id: "ca-alameda-county-hayward-city", kind: "municipal", name: "Hayward city", county: "Alameda County", lines: [
      { name: "Hayward — Real Property Transfer Tax", rate: 0.0085, base: "price", party: "split", source: S10, sourceUrl: S11, asOf: "2026-09-24", notes: "$8.50 per $1,000 = 0.85% flat (Ord. 92-26). City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax). Alameda Recorder: 'on full value', rounded up to next $500. Party: Fidelity shows city tax customarily SPLIT buyer/seller in Alameda County (residential custom; negotiable on commercial)." }
    ] },
  { id: "ca-alameda-county-oakland-city", kind: "municipal", name: "Oakland city", county: "Alameda County", lines: [
      { name: "Oakland — Real Property Transfer Tax", rate: 0.025, tiers: [{ over: 0, rate: 0.01 }, { over: 300000, rate: 0.015 }, { over: 2000000, rate: 0.0175 }, { over: 5000000, rate: 0.025 }], base: "price", party: "split", source: S10, sourceUrl: S11, asOf: "2026-09-24", notes: "$10.00/$1,000 (1.0%) <= $300,000; $15.00 (1.5%) $300,001-$2,000,000; $17.50 (1.75%) $2,000,001-$5,000,000; $25.00 (2.5%) $5,000,001+, each on FULL value (Ord. 11628 CMS / Measure X 2018). The >$5M 2.5% tier was MISSING from our file. City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax). Alameda Recorder: 'on full value', rounded up to next $500. Party: Fidelity shows city tax customarily SPLIT buyer/seller in Alameda County (residential custom; negotiable on commercial)." }
    ] },
  { id: "ca-alameda-county-piedmont-city", kind: "municipal", name: "Piedmont city", county: "Alameda County", lines: [
      { name: "Piedmont — Real Property Transfer Tax", rate: 0.013, base: "price", party: "split", source: S10, sourceUrl: S11, asOf: "2026-09-24", notes: "$13.00 per $1,000 = 1.30% flat (Ord. 546 NS). City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax). Alameda Recorder: 'on full value', rounded up to next $500. Party: Fidelity shows city tax customarily SPLIT buyer/seller in Alameda County (residential custom; negotiable on commercial)." }
    ] },
  { id: "ca-alameda-county-san-leandro-city", kind: "municipal", name: "San Leandro city", county: "Alameda County", lines: [
      { name: "San Leandro — Real Property Transfer Tax", rate: 0.011, base: "price", party: "split", source: S10, sourceUrl: S11, asOf: "2026-09-24", notes: "$11.00 per $1,000 = 1.10% flat (Ord. 2020-08). City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax). Alameda Recorder: 'on full value', rounded up to next $500. Party: Fidelity shows city tax customarily SPLIT buyer/seller in Alameda County (residential custom; negotiable on commercial)." }
    ] },
  { id: "ca-contra-costa-county-richmond-city", kind: "municipal", name: "Richmond city", county: "Contra Costa County", lines: [
      { name: "Richmond — City Real Property Transfer Tax", rate: 0.03, tiers: [{ over: 0, rate: 0.007 }, { over: 999999, rate: 0.0125 }, { over: 2999999, rate: 0.025 }, { over: 9999999, rate: 0.03 }], base: "price", party: "split", source: S12, sourceUrl: S13, asOf: "2026-09-24", notes: "Collected in addition to the countywide DTT, 'based on the full value of the property' (Richmond Ord. 35-90 / Measure H 2018): $7.00/$1,000 under $1M; $12.50 $1M-$3M; $25.00 $3M-$10M; $30.00 over $10M. Band boundaries at exactly $1M/$3M/$10M follow Fidelity's '$1,000,000 to $2,999,999' wording. Rounded up to next $1,000. Party: Fidelity shows SPLIT in Contra Costa (residential custom)." }
    ] },
  { id: "ca-contra-costa-county-el-cerrito-city", kind: "municipal", name: "El Cerrito city", county: "Contra Costa County", lines: [
      { name: "El Cerrito — City Real Property Transfer Tax", rate: 0.012, base: "price", party: "split", source: S14, sourceUrl: S15, asOf: "2026-09-24", notes: "$12.00 per $1,000 = 1.20% flat, on full value, in addition to the countywide DTT (El Cerrito Ord. 18-03). NEW vs our file. Party: Fidelity shows SPLIT in Contra Costa." }
    ] },
  { id: "ca-santa-clara-county-san-jose-city", kind: "municipal", verify: "San Jose's Measure E tiers come from the city's page as indexed by search (direct download blocked). Confirm the current thresholds.", name: "San Jose city", county: "Santa Clara County", lines: [
      { name: "San Jose — City Conveyance Tax (base)", rate: 0.0033, base: "price", party: "split", source: S16, sourceUrl: S17, asOf: "2026-09-24", notes: "$1.65 per $500 = $3.30/$1,000 = 0.33%, applies to every sale. City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax). Party: Fidelity shows SPLIT in Santa Clara County." },
      { name: "San Jose — Measure E Real Property Transfer Tax", rate: 0.015, tiers: [{ over: 0, rate: 0 }, { over: 2300000, rate: 0.0075 }, { over: 5000000, rate: 0.01 }, { over: 10000000, rate: 0.015 }], base: "price", party: "split", source: S18, sourceUrl: S19, asOf: "2025-07-01", notes: "ON TOP of the 0.33% base. From 7/1/2025: 0.75% on $2,300,000.01-$5,000,000; 1.00% on $5,000,000.01-$10,000,000; 1.50% over $10,000,000 — applied to the ENTIRE value (not just the excess over the threshold). Exemption threshold was $2,000,000 from 7/1/2020 to 6/30/2025 and is re-indexed every 5 years (next ~7/1/2030). CCF's Dec-2025 table still shows the old $2M threshold. Official pages returned 403 to direct download — confirm the table before relying on it for a live deal." }
    ] },
  { id: "ca-santa-clara-county-palo-alto-city", kind: "municipal", verify: "Santa Clara County recorder page could not be downloaded; rate from the statewide city-finance table. Confirm.", name: "Palo Alto city", county: "Santa Clara County", lines: [
      { name: "Palo Alto — City Conveyance Tax", rate: 0.0033, base: "price", party: "split", source: S16, sourceUrl: S17, asOf: "2026-09-24", notes: "$1.65 per $500 = $3.30/$1,000 = 0.33% flat. City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax)." }
    ] },
  { id: "ca-santa-clara-county-mountain-view-city", kind: "municipal", verify: "Mountain View's Measure G tier comes from the city's page as indexed by search (direct download blocked). Confirm.", name: "Mountain View city", county: "Santa Clara County", lines: [
      { name: "Mountain View — Real Property Conveyance Tax incl. Measure G", rate: 0.015, tiers: [{ over: 0, rate: 0.0033 }, { over: 5999999, rate: 0.015 }], base: "price", party: "split", source: S20, sourceUrl: S21, asOf: "2024-12-20", notes: "$3.30/$1,000 (0.33%) below $6,000,000; $15.00/$1,000 (1.5%) of the TOTAL sale price when consideration is EQUAL TO OR EXCEEDS $6,000,000 (Measure G, Nov 2024; effective 12/20/2024, County collecting from 3/25/2025). Per the measure text ('increase from $3.30 to $15') and CCF, the $15 REPLACES the $3.30 (city total 1.5%, not 1.83%). Cliff: a $1 move across $6M adds ~$70K. Official pages 403'd — verify before a live deal." }
    ] },
  { id: "ca-san-mateo-county-san-mateo-city", kind: "municipal", name: "San Mateo city", county: "San Mateo County", lines: [
      { name: "City of San Mateo — Real Property Document Transfer Tax", rate: 0.015, tiers: [{ over: 0, rate: 0.005 }, { over: 9999999, rate: 0.015 }], base: "price", party: "split", source: S22, sourceUrl: S23, asOf: "2022-12-01", notes: "0.5% of the consideration when < $10,000,000; 1.5% of the consideration when >= $10,000,000 (ordinance text: rate applies to 'said consideration or value' — whole price). Base INCLUDES assumed/new purchase-money debt. San Mateo County Recorder confirms the city levies an additional conveyance tax. asOf = approx. Measure CC effective date (10 days after Dec-2022 certification; month-level). City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax). NEW vs our file. Party: Fidelity shows SPLIT in San Mateo County." }
    ] },
  { id: "ca-sacramento-county-sacramento-city", kind: "municipal", verify: "Rate rests on the statewide city-finance compilation + Fidelity (the county recorder confirms the tax exists). Confirm the rate.", name: "Sacramento city", county: "Sacramento County", lines: [
      { name: "City of Sacramento — City Real Property Transfer Tax", rate: 0.00275, base: "price", party: "split", source: S24, sourceUrl: S25, asOf: "2025-12-01", notes: "$2.75 per $1,000 = 0.275% flat (Sacramento City Code §3.16.020). Sacramento County Clerk-Recorder confirms the City of Sacramento is the ONLY Sacramento County city with its own transfer tax and that it is collected in ADDITION to the county DTT (city takes no DTT share, so the county keeps the full $1.10) — https://ccr.saccounty.gov/content/ccr/us/en/faq/faq-documentary-transfer-tax-dtt.html. Rate figure from CCF/Fidelity (city code not fetched). NOTE postal 'Sacramento' also covers unincorporated areas. NEW vs our file. Party: Fidelity SPLIT." }
    ] },
  { id: "ca-riverside-county-riverside-city", kind: "municipal", name: "Riverside city", county: "Riverside County", lines: [
      { name: "City of Riverside — additional documentary transfer tax", rate: 0.0011, base: "price", party: "seller", source: S26, sourceUrl: S27, asOf: "2026-09-24", notes: "Recorder: property in the city of Riverside is taxed at $1.10 per $500 (= $2.20/$1,000) vs $0.55/$500 countywide, i.e. an ADDITIONAL 0.11% city tax beyond the county's $1.10/$1,000. NEW vs our file (it listed Riverside as county-base-only). Party: Fidelity lists the rate but not the payer; seller assumed per county custom — confirm." }
    ] },
  { id: "ca-solano-county-vallejo-city", kind: "municipal", verify: "Rate rests on the statewide city-finance compilation + Fidelity, not the city's own page. Confirm.", name: "Vallejo city", county: "Solano County", lines: [
      { name: "Vallejo — City Real Property Transfer Tax", rate: 0.0033, base: "price", party: "seller", source: S24, sourceUrl: S25, asOf: "2025-12-01", notes: "$3.30 per $1,000 = 0.33% flat. City tax is ADDITIONAL to the full county $1.10/$1,000 (county gives no $0.55 city credit where the city levies its own tax). Corroborated by Fidelity ('Seller. Vallejo $3.30/$1,000'); Solano Recorder page not retrieved. NEW vs our file." }
    ] },
  { id: "ca-sonoma-county-petaluma-city", kind: "municipal", name: "Petaluma city", county: "Sonoma County", lines: [
      { name: "Petaluma — City Transfer Tax", rate: 0.002, base: "price", party: "seller", source: S28, sourceUrl: S29, asOf: "2026-09-24", notes: "$2.00 per $1,000 = 0.20% flat, collected in addition to County transfer tax; no exemption for assumed loans. Seller (Fidelity). NEW vs our file." }
    ] },
  { id: "ca-sonoma-county-santa-rosa-city", kind: "municipal", name: "Santa Rosa city", county: "Sonoma County", lines: [
      { name: "Santa Rosa — City Transfer Tax", rate: 0.002, base: "price", party: "seller", source: S28, sourceUrl: S29, asOf: "2026-09-24", notes: "$2.00 per $1,000 = 0.20% flat, collected in addition to County transfer tax; no exemption for assumed loans. Seller (Fidelity). NEW vs our file." }
    ] },
  { id: "ca-marin-county-san-rafael-city", kind: "municipal", verify: "PENDING: Measure W on the 11/3/2026 ballot would raise this from 0.2% to 1.0%. Rate also rests on the city-finance compilation. Confirm.", name: "San Rafael city", county: "Marin County", lines: [
      { name: "San Rafael — City Transfer Tax", rate: 0.002, base: "price", party: "seller", source: S24, sourceUrl: S25, asOf: "2025-12-01", notes: "$2.00 per $1,000 = 0.20% flat, in addition to county tax (Marin Recorder DTT transmittal form; CCF; Fidelity 'Seller pays'). PENDING: San Rafael Measure W on the Nov 3, 2026 ballot would raise this to 1.0% (5x) — re-check after the election. NEW vs our file." }
    ] },
  { id: "ca-san-joaquin-county-stockton-city", kind: "municipal", name: "Stockton city", county: "San Joaquin County", lines: [] },
  ],
};
