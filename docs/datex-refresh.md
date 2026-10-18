# Refreshing live Datex data into the deal library

> Admins can read this page in a browser at **`/api/admin/docs/datex-refresh`** (plain text).

The deal library holds the **acquisition-era snapshot** for every deal — the figures taken
from the offering documents at the time. Those are deliberately frozen; they are the record
of what was marketed. Datex holds what the owned assets are doing **today**. This brings the
second one alongside the first without disturbing it.

## Why it works by file rather than automatically

Datex's MCP endpoint is OAuth-only, and its authorization server offers
`authorization_code`, `refresh_token` and token-exchange — **no machine-to-machine grant** —
with no dynamic client registration. A background job on the site has no browser and no user,
so it cannot obtain a token. Asking Datex to issue KPR an OAuth client was declined.

So the pull happens in a Claude session, where a person is already authenticated, and the
result is imported as a file. Everything that protects the data lives on the SERVER
(`artifacts/api-server/src/lib/datexImport.ts`), not in these instructions — the payload is
treated as untrusted regardless of what produced it.

## To refresh

1. In a Claude session with the Datex connector, ask for a Datex snapshot for the library.
2. Save the JSON it produces.
3. In the app: **Portfolio Analytics → maintenance menu → 📡 Import Datex snapshot (JSON)**.
4. It dry-runs, shows what would change and the notable differences, and waits. Nothing is
   written until you accept; the library is snapshotted first, so it is reversible.

## Generating the payload

Latest period first — one cheap aggregate rather than scanning:
`aggregate_records` on `Occupancy`, `groupBy: ["Period"]`, ordered descending, `first: 1`.

Then **one call** covers every building:
`read_records` on `Occupancy`, filtered `Period eq <latest>`, `first: 60`, selecting
`BuildingId, BuildingName, TotalGLA, TotalGLAOccupied, TotalGLAVacant, TotalUnits,
TotalOccupiedUnits, TotalVacantUnits, ShopGLA, ShopOccupiedGLA, MajorGLA, MajorOccupiedGLA,
PadGLA, PadOccupiedGLA, GroundLeaseGLA, GroundLeaseOccupiedGLA`.

Map each `dealId` from `artifacts/api-server/src/data/datex-deal-map.json`, summing every
building for a deal that has more than one (Rockaway Centers has three).

```json
{
  "source": "datex",
  "asOf": "YYYY-MM-DD",
  "deals": [
    { "dealId": "...", "bldgIds": ["..."], "period": "YYYYMM",
      "totalGLA": 0, "occupiedGLA": 0, "vacantGLA": 0, "occupancyPct": 0,
      "totalUnits": 0, "occupiedUnits": 0, "vacantUnits": 0,
      "segments": { "shop": { "gla": 0, "occupiedGLA": 0 } } }
  ]
}
```

Per-tenant rent and sales are optional; add them from `TenantsMetrics` for one property at a
time when they are actually needed, since that table is ~2,100 rows per month.

## Five rules, each verified against live Datex on 2026-09-15

**Occupancy comes from the `Occupancy` entity.** Not from summing `TenantsMetrics` — that
returned 340,824 SF for a 300,386 SF building, because it carries rows that are not leasable
area. `Occupancy` already reports totals, unit counts and the segment split.

**Never source GLA from `Buildings`.** `BLDGGLA` is 0 on 46 buildings, and `OCCGLA` is the
SHOP-occupied figure rather than the total. Dividing one by the other is where a reported
"48.9% occupancy" at Cooks Corner came from; the true figure is 67.2% against a 67.6%
acquisition snapshot — a move of 0.4 points, not nineteen.

**A superseded lease generation is marked by a DOT in `TenantId`,** not by any one suffix.
Real examples: `t0000062.1.30`, `t0000069.2.6`, `t0000070.2.70`. These repeat a tenant's
square footage at zero dollars, so leaving them in roughly doubles GLA and unit counts.

**Do not filter zero-rent rows when computing area.** Big Lots occupies 40,000 SF at $0 rent
with no dot suffix — a real dark anchor. A rent filter silently deletes it. (For rent
*averages* the opposite holds: exclude zero-rent rows, or duplicates halve the average.)

**Filter `BLDGID` with `contains`, never `eq`.** Datex character fields are fixed-width and
carry trailing spaces, so `eq` silently matches nothing.

## What the server refuses

Only the `datexLive` block is ever written; the merge is built so no other field can change.
Beyond that it rejects a deal that is not in the map, a deal that is not `Owned`, a payload
whose building ids disagree with the map, occupied GLA above total GLA, and a missing or
future `asOf`. A null is treated as unknown and omitted — never written as zero. The deal
that is not yet set up in Datex is skipped by name rather than erroring.

`datexLive` is in `USER_PRESERVED_KEYS`, so re-importing an OM does not wipe it.

## Reading the result

The deal page shows a **Live from Datex** card beside the acquisition figures, leading with
the differences. A segment standing at zero occupancy is called out explicitly, because a
healthy headline occupancy hides it — Cooks Corner reads 67% occupied while a 29,000 SF major
box is empty.

Two differences are expected rather than alarming: a deal whose library record was built from
part of a multi-building property will show a large GLA jump on refresh (Rockaway Centers,
302,289 → 535,571 SF across its three buildings), and a Datex building that covers more than
the deal does will do the same. Check the map note before treating either as a data error.

## Snapshot v2 — Asset Management (10/18/26)

The **Asset Mgmt** tab (Debt · Dates · Properties · Credit Watch) and the owned-deal panel
read the same `datexLive` block, so they also need the v2 fields. Every block is optional; a
missing block just shows as "no Datex data" on the page. Generate them **per property**, filtered
to that property's buildings before reading (`BuildingId contains <id>`; `Loans` uses `BLDGID`).

The deal ↔ building map now lives in the database and is edited on **Asset Mgmt → Properties →
Datex building map** (admin). It was seeded from `datex-deal-map.json`; it is never inferred
from names. Providence (PTC) is not in Datex, so it has no map row.

| Field | Entity · how |
|---|---|
| `assetManager` | `Occupancy.AssetManager` for the latest period |
| `tenants[]` (add) `nationalTenant`, `annualNNN`, `annualOther`, `leaseStart`, `delinquency`, `lastSalesPeriod`, `coTenancy`, `salesReportType` | `TenantsMetrics` for ONE `Period` (latest), `AnnualRent gt 0`, dotted (superseded) `TenantId`s dropped; `EXPIR` / `NationalTenant` / `COTENANT` from `Tenants` |
| `salesHistory[]` `{tenantId, period, amount, reportingType}` | `SalesHistory`, `SalesType` GROSS, last 24 months, sent RAW. The server keeps each tenant's 12 most recent REPORTED months — **never** `TenantsMetrics.Rolling12Sales`, which is wrong whenever `LastSalesPeriod < Period` (Michaels @ Keene: stopped reporting 12/2025). `190001` = never reports. |
| `arAging` `{totalOpen, over60, over90, byTenant[]}` | `TenantLedger`, `TransactionOpenAmount gt 0`, bucketed by `TransactionDate` age. over90 must be ≤ over60 or the deal is rejected. |
| `financials` `{period, noiYtdActual, noiYtdBudget, noiTtmActual, noiYearBudget}` | `FinancialGroups`, `AccountGroupId` NOI, the last COMPLETED month (the current month is partial). Send the values RAW — Datex reports NOI as a NEGATIVE number (credit convention) and the server flips it. TTM = sum of the last 12 `MtdActual`. |
| `leasing[]` `{tenant, suite, gla, rentPSF, stage, submitted, executed, rentCommencement, termMonths}` | `LeaseAppDealHistoryBySuite` — `DBA`, `SuiteId`, `ProposedGLA`, `ProposedRentInitialPSFRent`, `DocumentStageDesc`, `ExecutionDate`, `AnticipatedRentCommencementDate`; last 12 months |
| `loans[]` | `Loans`, `Inactive` false, filtered on `BLDGID`. **Returns 0 rows through the connector today** — loans and swaps are entered on the Debt tab (or imported) instead. A Datex loan, if one ever arrives, is superseded by an entered loan for the same deal. |
| `vacantSuites[]` | `VacantSuites` — needed so the roster GLA ties to `Occupancy.TotalGLA` (the panel warns beyond 2%) |

**Never pending-sale data.** Nothing about a pending sale goes in a snapshot or a record.

## Loans, swaps and dates (Asset Mgmt → Debt / Dates, admin)

Paste JSON or CSV into **Import loans & swaps**. It previews first (create / update / rejected,
with the reason) and writes only on Save. Re-importing the same row updates it — ids are stable.

```json
{ "loans": [{ "property": "Plaza at Bensalem", "lender": "M&T", "originalBalance": 13650000,
              "maturityDate": "2030-02-01", "rateType": "swapped", "index": "1M CME Term SOFR",
              "spreadBps": 236, "source": "Loan summary (Drive)" }],
  "swaps": [{ "bldgId": "bensalem", "counterparty": "M&T", "notional": 13650000,
              "fixedSwapRatePct": 4.08, "maturityDate": "2030-02-01",
              "index": "1M CME Term SOFR", "source": "Derivative Advisors MTM 6/9/26" }],
  "dates": [{ "dealId": "...", "date": "2026-12-01", "type": "Co-tenancy", "tenant": "Ulta",
              "description": "Opening co-tenancy outside date", "source": "lease §12" }] }
```

Optional on every row: `loanLabel` (which loan at a multi-loan property — Rockaway's Commons /
Town Court / Town Plaza; a swap with a `loanLabel` attaches only to the loan with the same label),
`covenants`, `prepayment`, `notes`, `openQuestions` (text, a list or a small object), `confidence`.
A swap missing notional, fixed rate or maturity saves as **terms pending** — shown, never priced.
**Preferred equity** goes under `"preferredEquity": [{ property|dealId|bldgId, investor, loanLabel,
amount, ratePct, currentPayPct, accrualPct, fundingDate, maturityDate, redemption, notes, source }]`
(a `loans` row whose `type`/`instrument`/`loanLabel` says "preferred equity" is routed there too). It
is capital, not debt: kept out of total debt and the weighted rate. Labels and the new text fields
are not part of a row's id, so re-importing the same seed fills them into the existing rows.

A property is matched by `dealId`, a Datex `bldgId`, or its EXACT owned name — never a fuzzy
guess. Rates may be given as `4.08`, `"4.08%"` or `0.0408`; spreads as bps or percent. Index
"Daily Simple SOFR" (Overland / ONB) prices swaps on the OIS curve; everything else on the 1M
Term SOFR curve, the same engine as the deal page's breakage estimate.

## Covenants, acquisitions and option status (10/18/26)

The same **Import** box (Asset Mgmt → Debt) takes three more keys. Each row names its property
the same way (`dealId`, `bldgId` or exact name) and can carry a `source`.

- **`covenants`** — `{ type: "DSCR"|"DY"|"LTV"|"cash sweep"|"cash trap"|"other", threshold, sweepBelow,
  testFrequency: "quarterly"|"annual"|…, firstTestDate, testMonthDay: "12-31", amortYears (the test's
  amortization, e.g. 25), testRatePct, linkedTenant, triggerDate, trigger, loanLabel | loanId }`.
  Shown on each owned deal's Asset tab with live headroom; a `triggerDate` and the next test date
  land on the Dates calendar. **Detect from loan docs** (Asset tab, admin) proposes them from KPR's
  covenant brief and the `covenants` text on each loan row, previewed before saving.
- **`acquisitions`** — one per property (re-importing replaces it): `{ purchasePrice, closeDate,
  seller, kpPct, jvPartner, mzlEquity, kpMemberEquity, totalEquity, noiAtPurchase, goingInCapPct,
  budgetNoi, budgetYear }` — a column named `budgetNoi2026` is read as budgetNoi + budgetYear 2026.
  Fills the Transaction tab's Acquisition card; "Fill blank deal fields" copies price / close date /
  seller / going-in cap / NOI at close into the deal only where the deal is blank.
- **`optionStatuses`** — `{ tenant, option, noticeDate, status: "Exercised"|"Pending"|"Lapsed" }`
  (also set by an admin straight from the roster's "NOTICE PASSED" chip).

**Columns the importer doesn't model are kept, not dropped**, and any column whose name mentions
drive / file / doc / link / url is read for Google Drive file ids (bare ids, `/d/<id>/` links or
`{id, name}` objects) — those show as clickable "Source doc" links on the Financing tab.
`amortization: "IO to 1/15/2030, then 30-yr amortization"` is read as interest-only until 1/15/2030,
then a 30-year amortization, so debt service and DSCR use interest only until then.
