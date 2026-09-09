# Preston Village (Newmark) — extraction QA

Source: `G:\My Drive\Claude\OMs\Preston Vilage` — three PDFs read in full:
Offering Memorandum, Financial Narrative, and Detailed Tenant Underwriting. A fourth
file, the Argus model (`NMRK - Preston Village Center (2026)_.avux`), was NOT opened;
it holds the per-lease recovery methodology if that detail is ever needed.

8700 Preston Rd, Plano TX 75024 · 302,993 SF power center · 93.6% leased · in-place NOI
$4,646,126 as of 11/01/2026 · no asking price or cap rate published.

## Tie-outs

The Detailed Tenant Underwriting prints subtotals for each tenant category. The
transcribed roster reproduces **all five of them exactly** — square feet, weighted-average
in-place base rent, and weighted-average NNN recovery:

| Section | Tenants | SF | Base rent PSF | NNN PSF |
|---|---|---|---|---|
| Anchors & Jr. Anchors | 4 | 83,378 ✓ | $16.59 ✓ | $4.75 ✓ |
| Food & Beverage | 6 | 12,588 ✓ | $28.52 ✓ | $6.57 ✓ |
| Shops < 10,000 RSF | 5 | 12,575 ✓ | $31.34 ✓ | $6.54 ✓ |
| Limited Sales | 21 | 149,414 ✓ | $14.37 ✓ | $5.59 ✓ |
| Outparcel | 4 | 25,755 ✓ | $28.84 ✓ | $8.81 ✓ |
| Available | 10 | 19,283 ✓ | — | — |

Also passing: roster SF = 302,993 GLA; leased SF 283,710 = 93.6%; base rent $5,025,763 =
$17.71 PSF (printed $17.71); recoveries $1,623,297 = $5.72 PSF (printed $5.72); year-1
expense lines sum to $2,052,005; WALT recomputed 4.05 years vs the OM's stated 4.1; and
each of the 11 cash-flow years reconciles EGR − OpEx = NOI (three years differ by $1,
which is the OM's own line-level rounding, carried unchanged).

## Judgement calls recorded in the file

- **`noi` = $4,646,126**, the OM's stated in-place NOI as of 11/01/2026. `effectiveGrossIncome`
  and `operatingExpenses` are year-1 (FY ending Oct-2027) figures, which produce $4,739,716;
  the $93,590 difference is contractual growth across year one, noted in `keyAssumptions`.
- **Sales**: only the TTM column is captured. The OM's 2022-2025 per-year sales columns did
  not extract in a reliably aligned way, so no prior-year trend is recorded rather than risk
  a wrong trend. TTM figures cross-check against the printed sales volumes (e.g. Yama Sushi
  3,574 SF × $550 = $1,964,792, matching the OM to the dollar).
- **Below-market rent is split into capturable vs locked** per KPR's standing rule. Petco
  (no options) and Pure Hockey (FMV option) reprice inside a hold and are recorded as upside;
  HomeGoods, Total Wine, Michaels and PGA are locked behind fixed options and are recorded as
  secure, sticky income, not as mark-to-market.
- **$495,171 of base rent (9.9%)** is from tenants not open and paying at the analysis start
  (Lupe Tortilla and Ono Hawaiian BBQ under construction, Joy Thai not commenced). Those three
  carry `leaseStatus: "signed-not-open"`.
- **Texas reassessment is not in the OM's model.** 2025 assessed value $56,039,137 with a
  $945,696 bill (1.69% effective); the projection grows taxes 3%/yr with no sale step-up. Stored
  as `currentAssessedValue` / `currentAnnualTaxes` / `assessmentYear` so the tax forecaster can
  work from the real bill.
