# Project Evergreen (CBRE) — 8-deal extraction QA

Source: eight CBRE "Project Evergreen" offering memoranda (10 pages each), extracted
into `project-evergreen-2026.json` for the app's **Upload OMs → Upload JSON** importer.

Every deal's roster and financials come from the OM's **In-Place Pro-Forma (page 9)**,
which is stated on a **CY-2027 basis** (Jan-27 through Dec-27 contractual rent and
recoveries, no general vacancy loss) — not a current-day rent roll. Site-plan "current"
rents therefore differ where a 2027 step is embedded; those differences are recorded in
each tenant's `assumptionNote`. Vacant suites are carried as `Vacant` rows so Σ tenant
SF = stated GLA.

## Deterministic tie-outs (all 8 deals)

| Check | Result |
|---|---|
| Σ tenant SF = stated GLA | passes on all 8 |
| Σ occupied SF ÷ GLA = stated occupancy | passes on all 8 |
| Σ tenant base rent = OM's printed base-rent total | passes on 7 of 8 (Westland Square fails — see below) |
| Σ tenant recoveries = OM's printed recovery total | passes on 7 of 8 (Westland Square fails — see below) |
| EGI − OpEx = NOI | passes on all 8 ($1 rounding at Crockett Square) |
| Expense lines (CAM+MF+INS+RET+N/R) = total OpEx | passes on all 8 |
| Gross potential rent ≥ in-place base rent | passes on all 8 |
| Every cash-flow year: EGR − OpEx = NOI | passes on all 8 (11 years each) |
| WALT recomputed (SF-weighted, as of 1/1/27) vs OM-stated | matches on 7 of 8 (Pierpont — see below) |

## Contradictions found INSIDE the OMs (flagged, not silently fixed)

1. **Westland Square — the rent roll does not foot.** The twelve printed tenant rows sum
   to $555,654 base rent / $168,964 recoveries, but the printed totals are $563,664 /
   $172,056 — a gap of $8,010 / $3,092. Suite letter "K" is skipped on both the rent roll
   and the site plan, so a row appears to be missing from the presentation. The roster
   carries the twelve disclosed rows; NOI/EGI/recoveries carry the OM's printed totals
   (which tie to each other: $735,720 − $192,736 = $542,984).
2. **Westland Square — two different in-place NOIs.** Page 2 says $535,784; the page-9
   pro-forma says $542,984. The page-9 figure is used because it ties to EGI − OpEx.
3. **Pierpont Centre — the headline WALT and the NOI disagree.** Recomputing WALT from the
   pro-forma's own expiries gives 4.1 years; the OM's stated ±3.7 years is only
   reproducible if Dollar Tree expires January 2027 (as the site plan shows) rather than
   January 2032 (as the income model carries it). The marketing WALT excludes a renewal
   the income statement counts. Mail & More has the same shape (site plan Dec-2027 vs
   modeled Sep-2031).
4. **Laburnum Square — Rent-A-Center.** Site plan states $12.50/SF current rent ($47,250);
   the pro-forma models $8.33/SF ($31,500) for CY-2027 on a lease expiring 08/31/27.
5. **Brook Run — Dollar Tree is an LOI, not a lease.** $85,290 of base rent plus $33,924 of
   recoveries (11.3% of total revenue) is modeled in-place from 01/01/27 on an
   unexecuted LOI. Captured as `leaseStatus: "loi"`.

## Other portfolio-wide notes

- **No asking price or cap rate is published in any of the eight OMs**, so `askingPrice`,
  `capRate` and `pricePerSF` are null throughout (expected for this offering).
- **Real estate taxes are un-reassessed in every model** — they equal each property's 2026
  budget. VA, SC and WV all reset or re-appraise on/after a sale; a step-up should be
  underwritten deal by deal.
- Grocer sales at Laburnum Square, Village of Martinsville and Pierpont Centre are
  described by the OM as **anecdotal** (not tenant-reported) and are marked as such.
- Pierpont Centre carries ten **NAP parcels** (Lowe's, two hotels, Wendy's, Outback, etc.)
  that contribute $38,520 of CAM reimbursement and no base rent; their pro-forma lease
  dates are 01/01/27–12/31/46 placeholders and are stored as null.

## Import behaviour (how these land in an existing library)

`POST /deals/import` matches an existing deal on **propertyName (exact, case-insensitive)
+ address** (address compared only when both sides have one, after abbreviating
road/street/avenue/boulevard/drive/lane/parkway). Addresses here are stored in each OM's
own printed form to maximise a clean match. Two consequences worth knowing:

- **A match MERGES**, and `USER_PRESERVED_KEYS` win — which includes `tenants`,
  `tenantsAsOf`, `tenantsManual`, `occupancy`, `walt`, `weightedAvgRentPSF` and
  `dealScore`. So an existing deal takes the new financials, narrative, red flags and
  cash flow, but KEEPS its old roster. Refresh the roster deliberately (deal page →
  "Paste roster from Claude") if the stored one is stale.
- **A near-miss creates a duplicate.** A stored name like "Brook Run" vs
  "Brook Run Shopping Center", or an address the normaliser can't reconcile
  ("Commonwealth Blvd W" vs "Commonwealth Boulevard West"), will insert a second deal.
  `auditDuplicates` (Data Audit → "Possible duplicate deals") only groups on an exact
  name match, so a differently-named duplicate will not be caught there either — search
  the library by name before importing.
