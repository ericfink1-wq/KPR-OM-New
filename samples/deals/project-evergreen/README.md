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
- **Lease dates.** Some books print month-year only on page 9 (LaGrange, Parkway,
  Fort Howard, Freeway Junction); there, commencements are recorded as the FIRST day and
  expirations as the LAST day of the printed month, stated as a convention in that file's
  `keyAssumptions`. The rest (Bryan Station and all of batch 2) print full MM/DD/YY dates,
  which are used verbatim.
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
being committed. All ten are clean. The only flags raised are two deliberate low-severity
"confirm these are separate suites" prompts, both correct: 1942 Social at Freeway Junction
(suite 16 plus a 2,450 SF expansion in 14) and MBM Sports at Washington Center Shoppes
(suite 005 at $18.20/SF plus suite 005A at $1.48/SF with no recovery).

WALT is computed SF-weighted from the roster's expiries as of 1/1/2027, the analysis
commencement date. Where the OM states a WALT it reproduces exactly — Bryan Station 3.64,
Harrodsburg 2.07, Lumber River 4.04, Pine Grove 4.3, Washington Center 4.0, Fairview 4.5 —
which is itself proof the roster is complete.

## Files

**Batch 1** — `project-evergreen-5-deals.json` uploads all five at once:
- `lagrange-marketplace-lagrange-ga.json` — Food Depot, LaGrange GA
- `parkway-plaza-brunswick-ga.json` — Aldi, Brunswick GA
- `bryan-station-lexington-ky.json` — shadow Kroger, Lexington KY
- `fort-howard-square-rincon-ga.json` — Bealls/Harbor Freight, Rincon GA
- `freeway-junction-stockbridge-ga.json` — Goodwill/Northern Tool, Stockbridge GA

**Batch 2** — `project-evergreen-batch-2.json` uploads all five at once:
- `harrodsburg-marketplace-harrodsburg-ky.json` — Kroger, Harrodsburg KY
- `lumber-river-lumberton-nc.json` — Food Lion, Lumberton NC
- `pine-grove-plaza-browns-mills-nj.json` — Ollie's + shadow ACME, Browns Mills NJ
- `washington-center-shoppes-sewell-nj.json` — ACME + Planet Fitness, Sewell NJ
- `fairview-commons-new-cumberland-pa.json` — Grocery Outlet, New Cumberland PA

Do NOT upload a combined file twice — the importer merges by propertyName + address,
so re-importing batch 1 after editing a deal in the app would overwrite those edits.
