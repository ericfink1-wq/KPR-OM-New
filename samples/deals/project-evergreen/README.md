# Project Evergreen — CBRE portfolio extractions

CBRE is marketing this group of shopping centers as "Project Evergreen." Each book is a
10-page teaser with an identical structure:

| page | content |
|---|---|
| 2 | property summary (GLA, occupancy, acres, in-place NOI, NOI CAGR, parking) |
| 3 | property highlights + headline stats |
| 4 | site plan roster — suite, tenant, SF, lease expiry, **current** rent PSF |
| 5 | demographics (1 / 3 / 5 mile + true trade area) |
| 6-7 | location maps |
| 8 | Argus assumptions (market rents, absorption, TI/LC, downtime, expense source) |
| 9 | **In-Place Pro-Forma, CY2027** — the real rent roll: lease dates, base rent, recoveries, percentage rent, sales, health ratio |
| 10 | 11-year Argus cash flow, CY2027-CY2037 |

## Extraction conventions used in these files

- **Roster basis is page 9 (the CY2027 in-place pro-forma)**, not page 4. Page 9 is what
  the headline NOI, EGI and recovery lines tie to. Page 4's *current* rent PSF is recorded
  in each tenant's `rentSchedule` where the two differ (a 2027 step or a modeled renewal).
- **Lease dates.** Page 9 prints month-year only (Bryan Station is the exception — it
  prints full dates). Commencements are recorded as the FIRST day and expirations as the
  LAST day of the printed month. Stated as a convention in every file's `keyAssumptions`.
- **Vacant suites are in the roster** so `Σ tenant SF = totalSF` and occupied/total equals
  the stated occupancy.
- **0-SF rows.** Rows that PAY BASE RENT (Planet Fitness ground lease, Wells Fargo ATMs)
  are ordinary tenants — marking them NAP would drop real rent out of the roll-up. Rows
  that pay only CAM (REA shadow outparcels, Kroger's NAP parcel) are `isNAP: true`.
- **No price, no cap rate** is quoted in any of these books. Left null.
- **Taxes are NOT reassessed** in any pro-forma — CBRE says so explicitly on page 8.

## Verification

Every file was checked against the app's own `auditExtraction` and a four-way tie-out
(SF↔GLA, occupancy, base-rent roll-up ↔ the OM's printed total, EGI − OpEx = NOI) before
being committed. All five are clean; the only flag raised is a deliberate low-severity
"confirm these are separate suites" prompt on 1942 Social at Freeway Junction, which
genuinely occupies two suites (16 plus a 2,450 SF expansion in 14).

## Files

- `project-evergreen-5-deals.json` — all five, for a single **Upload OMs → Upload JSON**
- `lagrange-marketplace-lagrange-ga.json`
- `parkway-plaza-brunswick-ga.json`
- `bryan-station-lexington-ky.json`
- `fort-howard-square-rincon-ga.json`
- `freeway-junction-stockbridge-ga.json`
