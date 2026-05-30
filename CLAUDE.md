# CLAUDE.md — KPR Deal Library / OM Database

Persistent context for this repo. Read this fully at the start of every session.

## Who I'm working with
- Eric Fink, acquisitions at **KPR Centers** (commercial real estate — almost always **retail shopping centers**; not residential, not raw land).
- **Beginner coder.** Take initiative. Do NOT ask him to edit files by hand, run shell commands, or do anything technical. Make the changes, verify them, and commit. Explain in plain English what changed and why.
- He values accuracy over speed. When a number can't be verified, say so and leave it null — never fabricate a precise-looking figure.

## What this is
- A web app: an Offering-Memorandum (OM) database / deal library for underwriting retail centers.
- Repo: `https://github.com/ericfink1-wq/KPR-OM-New` (public). Live app: `kpr-oms.replit.app`.
- Stack: **React** frontend + **Express** API + **Postgres via Drizzle**. Users are on **both desktop and mobile.**

## Architecture map
- Frontend: `artifacts/om-database/src/`
  - `components/` — DetailView.tsx (deal page), CompsSearch.tsx, TenantAnalytics.tsx, TenantView.tsx, PortfolioAnalytics.tsx, LeaseRollover.tsx, TenantRoster.tsx, DealGrid.tsx, Header.tsx, ClosingCostsCard.tsx, HelpModal.tsx, DealSummaryPDF.tsx
  - `lib/` — idb.ts (**Deal & Tenant interfaces — source of truth for field names**), api.ts, closingCosts.ts, exportExcel.ts
  - `hooks/use-mobile.tsx` (useIsMobile)
- API: `artifacts/api-server/src/`
  - `routes/` — deals.ts, comps.ts, analytics.ts, aliases.ts, auth.ts, clientErrors.ts
  - `lib/` — extract.ts (LLM extraction + runRosterAnalysis), compsIndex.ts, compBenchmark.ts, tenantBenchmarks.ts (rescoreDeal)
- DB schema: `lib/db/src/schema/` — compsIndex.ts, tenantIndex.ts

## Build & verify — ALWAYS do this before committing
Re-pull, then:
```
pnpm install
pnpm add -w @tanstack/react-query        # if not present
npx tsc -b lib/api-zod lib/api-client-react lib/db
cd artifacts/om-database && npx tsc --noEmit | grep -v TS6305 | grep "error TS"
cd ../api-server && npx tsc --noEmit | grep -v TS6305 | grep "error TS"
```
- `TS6305` = harmless monorepo build-order noise; ignore it.
- The api-server has **pre-existing** `TS7006 implicit any` errors in compBenchmark.ts / analytics.ts / comps.ts / deals.ts(list handler) / tenantIndex.ts. Those are not yours — the runtime build tolerates them. Only worry about NEW errors your change introduces.
- A clean change adds **zero** new errors.

## Cardinal rules
1. **Every UI/site change must work on desktop AND mobile** — by default, unprompted. Layouts reflow for narrow screens (grids/strips/tables collapse sensibly, not just shrink), finger-friendly tap targets, compact formatting, working touch interactions (modals, dropdowns, toggles). Wide tables (comps/tenants) break most easily on phones — test them.
2. **Verify field names against `artifacts/om-database/src/lib/idb.ts`** before writing or reading any Deal/Tenant JSON. Wrong field names = silent import failure. Never rely on memory for field names.
3. **Commit and push directly to `main` automatically** after each change — don't wait to be asked, and don't park work on side branches. Eric syncs Replit by pulling `main`, so the workflow is: make the change → run the build/verify type-checks → if clean, commit + push to `main` → tell Eric "ready, Pull in Replit." **Never push code that introduces new type errors.** Pause and confirm first ONLY for risky changes: DB schema/migrations, destructive actions (deletes, index rebuilds, restores), or anything ambiguous. Eric does not read the code himself, so the type-check gate is the safety net.
4. **Most past regressions came from stacking changes on shared files.** Make one change, verify, then the next.

## Data model — verified field names (confirm in idb.ts)
**Tenant:** `name` (brand only, no store #/lease structure), `sf`, `rentPerSF` (2 decimals), `annualRent` (**base rent only**), `leaseStart`, `leaseExpiry`, `remainingTermYears`, `leaseType`, `reimbursementMethod`, `rentBumps`, `rentSchedule`, `renewalOptions`, `salesPSF`, `salesYear`, `occupancyCost`, `expenseReimbursements`, `percentageRent`, `otherRent`, `creditRating`, `isAnchor`, `isNAP`, `parentCompany`, `assumptionNote`, `salesNotes`.
**Deal:** `propertyName` (NOT dealName), `address`, `city`, `state`, `assetType`, `centerType`, `totalSF`, `occupancy`, `walt`, `weightedAvgRentPSF`, `capRate`, `noi`, `askingPrice`, `grossPotentialRent`, `notes`, `dealScore`, `redFlags`, `upsideItems`, `keyAssumptions`, `shadowAnchors`, `tenants`, `tenantsAsOf`, `tenantsSource`, `tenantsManual`, `cashFlowProjection`, etc. KPR's own underwriting goes ONLY in `acq*`, `debt*`, `pref*`, `txn*`, `disp*` fields — never folded into the OM-stated display fields.

## OM extraction ruleset (when Eric says "extract for KPR" or drops an OM PDF)
- Output format: **flat deal fields wrapped in `{"deals": [{...all fields...}]}`** — matches the app's "Upload OMs → Upload JSON" button. NOT the nested `{id, data}` backup format. Deliver as a downloadable `.json`.
- **Always include the full deal** in the JSON (never a partial patch) — the bulk importer merges by address/propertyName match and overwrites non-preserved fields.
- **Tenants:** lease occupants only (rent roll / lease schedule with SF and/or rent at THIS address). Never competitors, comp-set, shadow-anchor-at-other-parcel, or trade-area mentions. All into the structured `tenants` array, not summary text.
- **Dates:** ISO `YYYY-MM-DD` everywhere (leaseStart, leaseExpiry, originalLeaseDate) — never `Mon-YYYY` strings.
- `rentSchedule` (**required for every tenant, never null**): all **future** dated rent steps as of the most recent OM/rent-roll date (drop past steps), including option-period bumps; note "flat" if flat.
- `annualRent` = **base only.** Recoveries go in SEPARATE numeric annual-$ fields **only when the OM/roll discloses them**: `expenseReimbursements` (CAM+tax+insurance), `percentageRent`, `otherRent`. Undisclosed → null.
- **Occupancy cost:** NEVER base÷sales, NEVER guess. `occupancyCost %` = (base+reimbursements+pctRent+other) ÷ gross sales, only when components are disclosed; else null. If the OM states an occ-cost %, use it.
- **WALT:** always calculate from lease expiry dates weighted by SF if not stated; never leave null when dates exist.
- `notes`: 5–8 sentence institutional underwriting narrative (asset/location, anchor quality+sales, inline mix, key metrics vs market, thesis, top risk) — references real OM numbers. Never a 2–3 sentence summary.
- `parentCompany`: only when confident (major public corps — TJX, Gap Inc, Ahold Delhaize, etc.). For regional/private/PE-owned, **ask Eric to confirm** before writing it. Same for tenant merges.
- Sales formatting: ≥$1M → "$2.0M / $157 PSF"; <$1M → "$930k".

## Updating an existing deal's roster (rent-roll paste) — IMPORTANT
- The bulk "Upload JSON" importer (`POST /deals/import`) merges by propertyName+address and **only preserves `USER_PRESERVED_KEYS`** (status, txn*, acq*, debt*, pref*, marketSale, marketDemographics, verified, tenantSalesHistory, uploadedAt, fileName, etc.). **Everything else not in the upload is wiped** — including noi, capRate, state, city, cashFlowProjection, notes. So a roster-only bulk upload destroys financials.
- To update only the roster, output `{"asOf":"YYYY-MM-DD","tenants":[...]}` for the deal page's **"Paste roster from Claude (no API)"** box. That path (`onUpdate` → full PUT) updates only tenants and recomputes occupancy/WALT, preserving everything else. It also sets `tenantsManual: true`.

## Re-analysis safety (built this — keep it)
- `tenantsManual: true` marks a manually-pasted roster.
- `POST /deals/:id/reanalyze` re-reads the stored OM and would overwrite the roster; it now **refuses if `tenantsManual` unless `overwriteRoster:true`**.
- `POST /deals/:id/refresh-analysis` (and `runRosterAnalysis` in extract.ts) regenerates summary/grade/strengths/risks/red flags from the **current roster**, not the OM — this is the safe refresh after a roster paste. UI: Actions → "✨ Refresh Analysis (current roster)".
- `POST /deals/:id/rescore` (rescoreDeal) is deterministic — refreshes dealScore + red flags from portfolio benchmarks, augments (doesn't replace) qualitative red flags.

## Comp database
- `comps_index` table (schema `lib/db/src/schema/compsIndex.ts`; route `routes/comps.ts`; builder `lib/compsIndex.ts`; UI `CompsSearch.tsx`).
- **Source tiers by quality:** owned (`isOwnTransaction`, KPR's verified trades) > broker/manual (`isManual`) > OM-sourced (from each deal's `comparableSales`; seller-cherry-picked = weakest). Tag every comp.
- Own transactions auto-add via `syncOwnTransactionComps` on deal write. Only insert OM-sourced comps with an identifying label AND positive salePrice (validation gate prevents empty junk comps).
- **Benchmark** (`POST /api/comps/benchmark`, `compBenchmark.ts`, deterministic, NO AI): validity filter (cap 3–12%, salePrice>0, no future dates, sane psf), tiered relaxation T1→T4, MIN_N=4, **medians + p25/p75** only, returns n/dateRange/sourceMix/tier. Below MIN_N → insufficient, suppress verdicts.
- **Cardinal comp rule:** the APP computes all comp stats in code; Claude only NARRATES the structured benchmark output (medians, n, tier, date range, source mix). Never eyeball raw comp rows or re-derive numbers. Never state a benchmark without **n + date range**. Medians, not means. Owned > broker/manual > OM-sourced.

## Closing-cost estimator (`lib/closingCosts.ts`, `ClosingCostsCard.tsx`)
- Title insurance + transfer taxes + mortgage recording taxes, per-state.
- Title is **regressive** (marginal-bracket `titleSchedule`): 6 states EXACT/promulgated (NJ, NY, PA, TX, FL, OH); the rest are representative curves tagged `promulgated:false`. NC and Iowa are special (regulated-low / state program). NM calibrated-high.
- Tax methods: `marginalTiers` (graduated, portion-by-portion — WA REET, CT… ), `tiers` (cliff, whole price — NJ mansion tax), or flat `rate`. Don't convert cliff taxes to marginal.
- **Locality is pick-one, not additive:** lines sharing an `altGroup` are alternatives; only the selected one applies (UI dropdown). `residentialOnly` lines are excluded (this is a commercial tool). These prevent the old stacking bug.
- All deals are commercial — use commercial treatments (e.g., CT conveyance is a flat 1.25% commercial, not the residential graduated scale).

## Other standing tasks
- **Investor book review:** run a full arithmetic audit on financial-summary + cash-flow pages — verify subtotals, sign conventions (income +, expenses/debt/capex −), debt service vs stated rate, sources=uses, waterfall math, loan payoff vs balance, tie IRR/yield back to the CF page. Do this automatically.
- **Investor letter (KPR deal pitches):** follow the saved Pointe Plaza format — bold property name; warm first-person open w/ size/location; price + in-place cap; lead anchor w/ sales; financing paragraph (lender, IO, LTV, bps over SOFR swap, cap-to-loan spread); RETURNS with CONSISTENT annual cash-on-cash + IRR; welcome participation; Overview (anchors + value levers). Deliver inline first, offer docx.

## Admin
- App has an admin gate: tap the KPR logo 5× within 3 sec → password prompt (checks `ADMIN_PASSWORD` env var). `isAdmin` gates destructive actions (delete, rebuild index, backup/restore).
