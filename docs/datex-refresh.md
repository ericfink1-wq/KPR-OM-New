# Refreshing live Datex data into the deal library

> Admins can read this page in a browser at **`/api/admin/docs/datex-refresh`** (plain text).
> A complete example snapshot — every v2 key populated, exact field names — is at
> **`/api/admin/docs/datex-snapshot-example`**. A test imports that exact file, so it always
> matches what the importer reads.

## Automated refresh — the scheduled task (10/18/26)

A scheduled Claude task (which IS signed in to Datex) posts changes straight to the site — no
browser, no file. An admin creates the token at **Asset Mgmt → Properties → Datex auto-refresh**
(shown once, stored hashed, turn it off there). The token can call exactly two endpoints:

- `GET https://kpr-oms.replit.app/api/datex/state` — header `Authorization: Bearer kpr_dx_…`.
  Per mapped owned deal: `dealId`, `bldgIds`, `asOf`, `blockAsOf` (one date per block),
  `occupancy {period, totalGLA, occupiedGLA, totalUnits, occupiedUnits}`, `tenants {count, hash}`,
  `sales {maxPeriod, byTenant: {tenantId: lastPeriod}}`, `leasing {count, latestSubmitted}`,
  `financials {period, basis}`, `arAging {asOf}`. `tenants.hash` = sha256 of the sorted lines
  `tenantId|sf|annualRent|leaseExpiry` (numbers rounded to 2 dp, blank when unknown, C + N tenants
  only), joined by `\n`, first 16 hex chars — compute the same from Datex to see if a roll changed.
- `POST https://kpr-oms.replit.app/api/datex/ingest` (add `?dryRun=1` to preview) — same body as
  the file (`{source, asOf, deals:[…]}`, same field names), but **MERGE MODE**: send only the blocks
  that changed. A block a deal doesn't carry is KEPT. `tenants` replaces the rent roll only when
  sent; `salesHistory` APPENDS (upsert by tenantId + period, last 24 months kept, a reported month
  never overwritten by an estimate); `leasing` upserts by tenant + suite + submitted date;
  `occupancy` fields, `vacantSuites`, `arAging`, `financials` replace when sent. Every block is
  stamped with the payload's `asOf`. Same guardrails as the file import (Owned + in the map,
  `bldgIds` must match, occupied ≤ total, over90 ≤ over60, no sale fields of any kind). Limits:
  10 MB per call, 20 calls a minute per token. A library snapshot is taken before any write. The
  reply lists, per deal, the blocks sent, what changed and any warnings.

**The job kit (use this — it encodes the recipe below).** `GET /api/datex/job-kit` (same Bearer
token) returns `job_kit.py` — Python 3, standard library only:

```
export DATEX_INGEST_TOKEN=kpr_dx_...            # KPR_BASE_URL defaults to https://kpr-oms.replit.app
curl -s -H "Authorization: Bearer $DATEX_INGEST_TOKEN" https://kpr-oms.replit.app/api/datex/job-kit -o job_kit.py
python3 job_kit.py state --out state.json
python3 job_kit.py plan --state state.json [--mode weekly|monthly]          # phase 1: the one Occupancy call
#   make it; then extract the session's Datex results:
python3 job_kit.py extract --transcript "/root/.claude/projects/*/<session-id>.jsonl" --out calls.jsonl
python3 job_kit.py plan --state state.json --calls calls.jsonl [--mode …]  # phase 2: every remaining call
#   make those (follow nextCursor while hasMore), extract again, then:
python3 job_kit.py build --state state.json --calls calls.jsonl --out payload.json
python3 job_kit.py post --payload payload.json --dry-run
python3 job_kit.py post --payload payload.json
```

`plan` prints each call as `{tool, why, args}` — pass `args` to the Datex tool unchanged. Verified
against live Datex (10/18/26): `Period` and `SalesPeriod` are TEXT fields (only eq / startsWith /
contains work — no gt), so sales are read per building per YEAR and the site upserts; `Basis`
arrives as a one-letter code ("C" = Cash); `AccountGroupId` is padded ("NOI     "); a read returns
`{items, nextCursor, hasMore}` and an aggregate `{results: [{group, value}]}`. `extract` reads
tool results that were too large and "saved to <path>.txt" from that file. `build` only sends a
block for a deal when the calls covered that deal's buildings (building filter, or none = all), so
the payload is a true delta. Rockaway's three buildings are summed. Tests:
`tools/datex-job-kit/test_job_kit.py` (fixture in `fixtures/`), plus a server-side test that the
built payload passes the merge rules and both roster hashes agree.

**Delta recipe — each run, in this order (pin ONE period; aggregate, don't page):**
1. **State:** `GET /api/datex/state` once.
2. **Occupancy, all buildings, latest period — 1 call:** `Occupancy`, latest `Period`, all mapped
   BLDGIDs (`contains`, ids are fixed-width). Send `period`, `totalGLA`, `occupiedGLA`, `vacantGLA`,
   unit counts, `segments` for every deal (cheap, and it keeps occupancy current).
3. **Rent roll only where it moved:** re-pull `TenantsMetrics` (latest Period only; do NOT drop
   zero-rent rows — a dark anchor pays $0, see "Do not filter zero-rent rows" below) + `Tenants`
   (OCCPSTAT decides which rows count) ONLY for buildings whose
   `occupiedGLA` / `occupiedUnits` differ from state — plus every building on the monthly run.
   Send `tenants[]` (with `occStatus`) and `vacantSuites[]` for those deals only.
4. **Sales — only new months:** `SalesHistory` per building, `SalesPeriod startsWith <year>` for each year
   since `state.sales.maxPeriod` − 3 months (SalesPeriod is text — no `gt`). Send just those rows in `salesHistory[]`; the server appends them and
   recomputes trailing 12. First run for a deal (no stored months): send the last 24 months.
5. **A/R:** `TenantLedger` `TransactionOpenAmount gt 0`, aggregated by building + tenant into
   `over60` / `over90` (and `totalOpen`). Put the tenant's OCCPSTAT on each `byTenant[]` row as
   `occpstat` (or `occStatus`) so balances left by vacated tenants are labelled as such.
6. **Financials:** `FinancialGroups` NOI for the last CLOSED period, all buildings, raw sign; include
   `basis` ("Cash" or "Accrual"). Skip when `state.financials.period` already equals that period.
7. **Leasing:** `LeaseAppDealHistoryBySuite` with `DateSubmitted ge <state.leasing.latestSubmitted>`;
   send only those rows in `leasing[]`.
8. **Post** with `?dryRun=1` first if anything looks unusual, then without it. Stop when done —
   `hasMore:true` from Datex is not an instruction to keep paging.

Suggested cadence: weekly = steps 1–2, 4, 5, 7 (+3 where occupancy moved); monthly (after close) =
everything, including step 3 for all buildings and step 6. The last run is shown on Asset Mgmt →
Properties ("Last auto-refresh").

## The file, in one paragraph (10/18/26)

One JSON file: `{ "source": "datex", "asOf": "YYYY-MM-DD", "generatedBy": "...", "deals": [ ... ] }`
with ONE object per owned deal — **all 38 in one file is fine** (the server accepts up to 50 MB;
2–4 MB is nothing). Each deal object: `dealId` and `bldgIds` exactly as the Datex building map
lists them (Rockaway = all three), then `period`, `totalGLA`, `occupiedGLA`, `vacantGLA`,
`occupancyPct`, `totalUnits`, `occupiedUnits`, `vacantUnits`, `segments`, `assetManager`,
`tenants[]`, `vacantSuites[]`, `salesHistory[]`, `arAging`, `financials`, `leasing[]`, `loans[]`.
Tenant fields: `tenantId, name, nationalTenant, suite, sf, annualRent, annualRentPSF, annualNNN,
annualNNNPSF, annualOther, leaseStart, leaseExpiry, delinquency, lastSalesPeriod, salesPSF,
salesPeriod, salesReportType, coTenancy, occStatus` — **`occStatus` = Tenants.OCCPSTAT (C current,
N future, I vacated) decides which rows count**: I is dropped, N is kept but flagged as a future
lease (not in-place rent, not in the GLA tie-out), and only when it is missing does a dotted
TenantId fall back to "superseded generation" (live leases do sit under dotted ids — Academy's
Giant Fitness 003, Trexlertown's Kiku 010). Small GLA tie-out gaps (<5%) show as a note, not a
warning. `leasing[]` rows from LeaseAppDealHistoryBySuite are APPLICATIONS (stage "Lease
Application", no ExecutionDate) and are labelled "leasing pipeline (applications)" (`gla`, `rentPSF`, `expiration` are accepted as
spellings of `sf`, `annualRentPSF`, `leaseExpiry`). Send EVERY occupied tenant (the roster's GLA is
checked against `totalGLA`, ±2%) and every vacant suite in `vacantSuites`. `salesHistory.tenantId`
must match `tenants[].tenantId`. Dates ISO, periods `YYYYMM`, money as plain numbers, NOI raw
(negative) from Datex. Missing blocks are fine; a null is never stored as zero.

**To load it:** Portfolio Analytics → maintenance menu (🧹) → **📡 Import Datex snapshot (JSON)** →
pick the FILE. It checks the whole file first and shows what would change and anything
rejected (with the reason, per property); nothing is written until you accept, and the library is
snapshotted first.

The deal library holds the **acquisition-era snapshot** for every deal — the figures taken
from the offering documents at the time. Those are deliberately frozen; they are the record
of what was marketed. Datex holds what the owned assets are doing **today**. This brings the
second one alongside the first without disturbing it.

## Why it originally worked by file (the automated path above now covers it)

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
| `arAging` `{totalOpen, over60, over90, byTenant[]}` | `TenantLedger`, `TransactionOpenAmount gt 0`, bucketed by `TransactionDate` age. over90 must be ≤ over60 or the deal is rejected. Add `occStatus` (OCCPSTAT) to each `byTenant` row so a VACATED tenant's balance (e.g. Big Lots after closing) is labelled "former tenants" rather than counted as current delinquency; without it the app infers "former" from the tenant no longer being on the rent roll. |
| `financials` `{period, basis, noiYtdActual, noiYtdBudget, noiTtmActual, noiYearBudget}` | `FinancialGroups`, `AccountGroupId` NOI, the last COMPLETED month (the current month is partial). Send the values RAW — Datex reports NOI as a NEGATIVE number (credit convention) and the server flips it. TTM = sum of the last 12 `MtdActual`. `basis` = the ledger's book ("Cash" or "Accrual") — the app shows it next to NOI vs budget, because cash-basis timing (a reimbursement reconciliation or tax bill landing in a different month than budgeted) can swing YTD vs budget a long way. |
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
