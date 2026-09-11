---
name: kpr-retail-analysis
description: How KPR Centers analyses retail shopping centers, and which of its two data sources to use. KPR runs Datex (its property-management system of record — live rents, budgets, occupancy, tenant sales, option dates, loans, leasing pipeline for the properties it OWNS) and the KPR deal library (a broad market corpus of deals it has EVALUATED, mostly ones it did not buy, used to establish what is normal across tenants, brands, anchors, markets and pricing). Use this skill for ANY commercial real estate work involving KPR — reviewing a deal or offering memorandum, a lease, LOI or amendment, a purchase and sale agreement, estoppel or other legal document, a loan document or debt terms, an operating statement or rent roll, underwriting assumptions, a waterfall, promote, pref or IRR, an investor book or IC memo, property tax and closing costs, sale comps, or any question about a KPR property, tenant, rent or market read. It says which source answers which question, how to combine them, the row-level traps in each that silently produce wrong numbers, and the underwriting doctrine KPR applies. Load it before answering, not after.
---

# KPR retail analysis

KPR Centers acquires and operates **retail shopping centers** — not residential, not
office, not land. Read everything through that lens: anchor quality and sales, inline
health, rollover, trade area, co-tenancy exposure.

There are **two data sources**, and using the wrong one is the most common way to get a
confidently wrong answer.

## The two sources

**Datex** — KPR's property-management system of record. Live and continuously maintained by
the team. Covers the properties KPR **owns today**: current rents and NNN, budget vs actual,
occupancy history, tenant sales, option and notice dates, loans, percentage-rent
breakpoints, vacant suites, and the active leasing pipeline.

**The deal library** — a market corpus. KPR records essentially every retail deal it looks
at, bought or passed, to accumulate enough data points to see averages and trends. **Most
records are deals KPR did NOT buy**, and that is the point: they are the comparable set. It
is **static** — captured from an offering memorandum or rent roll and then essentially never
updated.

## Which one answers which question

| Question | Source |
|---|---|
| "What does our Ulta at Northgate pay?" | **Datex** — a fact about a KPR property |
| "When is their option notice due?" | **Datex** — it tracks option and notice dates |
| "How did that center perform against budget?" | **Datex** |
| "What's in our leasing pipeline?" | **Datex** |
| "Is that rent normal for Ulta?" | **The library** — a market question, and it has the sample |
| "What have centers like this traded at?" | **The library** — sale comps across the corpus |
| "What's the co-tenancy trigger structure?" | **The library** — parsed clause trees and abstracts |
| "What did we pass on, and why?" | **The library** — Datex has never seen those deals |

**Datex leads for anything about a property KPR owns.** The library's copy of an owned asset
is an acquisition-era snapshot and does not track what happened since; owned records carry an
`authority` field saying exactly that, and individual owned rows are flagged
`datexAuthoritative`.

**Datex is AS OF TODAY.** The team feeds it live, daily, so a figure for an owned, active
asset is the current number — quote it without as-of hedging. A figure from the library is
the opposite: always state its capture date.

**Don't reach for Datex on a market question.** It only knows KPR's own buildings, so using
it to judge what is normal shrinks the sample to KPR's holdings — the opposite of why the
corpus exists.

**On a disagreement about an owned property, Datex wins.** Say which source each figure came
from and flag the gap. Never average them. Never silently pick one.

## Documents: get the doctrine for the work in front of you

KPR's doctrine spans the whole deal lifecycle, and it lives in the deal-library connector
rather than in this file — so it stays in one place and cannot drift. Call `get_knowledge`
once for the core, then AGAIN with the `topic` that matches what you are actually doing:

| In front of you | `get_knowledge` topic |
|---|---|
| A lease, LOI, amendment or clause | `leases` (plus `brand_lease_terms` for precedent) |
| Rent, sales or trade-area questions | `rent_and_tenants` |
| A PSA, estoppel or transaction document | `psa_and_legal` |
| An operating statement, rent roll, owned asset | `underwriting` |
| A loan document or debt terms | `debt` |
| A promote, pref, waterfall, IRR, investor book | `waterfall_and_returns` |
| A reassessment or closing-cost estimate | `taxes_and_closing` |
| Drafting an investor letter or IC memo | `investor_materials` |
| Sale comps | `comps` |
| A figure that looks wrong | `data_integrity` |

The core response lists each topic with a one-line tripwire. **A tripwire is a warning, not
the rule** — fetch the topic before reasoning, don't work from the summary.

## Lean on the property data inside a legal document

Neither system holds PSAs, loan documents or leases as documents. But those documents are
full of tenant- and property-level facts that both systems know cold, and a review that does
not reach for them is generic commentary dressed up as analysis.

**Whenever a document names a tenant, a square footage, a rent, a date, an anchor, a share of
GLA or a dollar threshold — look it up before commenting on the clause.**

- Estoppels required from "Major Tenants over 10,000 SF" → name who actually qualifies and
  what share of base rent sits behind the condition. The clause restated is not an answer.
- A casualty or condemnation threshold → compare it to the centre's real scale.
- Delinquent-rent proration → check who is actually delinquent, and which percentage-rent
  true-ups land after closing.
- A ROFR or consent that could block a pad sale → the executed abstracts hold it. Check
  before anyone markets the pad.
- Assumed debt → Datex holds the live loan, the document holds the terms. Tie them together
  and say which figure came from where.
- A tax proration clause in a reassess-on-sale jurisdiction → that is a forward NOI item.
- A covenant, exclusive or co-tenancy clause naming an anchor → is that anchor open, what
  does it pay, when does it expire, and does a sale or a go-dark event trip anything?

If the document and the data disagree, that is a **finding** — name both figures and their
sources. Never reconcile it silently.

## Cite both, separately, on tenant and brand questions

Don't choose. They answer different questions and the best answer carries both:

> Across KPR's own properties we see rents of $X (Datex, current). Across the broader set of
> deals we've reviewed, the market shows $Y (corpus, leases struck 20NN–20NN).

What KPR **achieves as a landlord** is not the same thing as what the **market shows**, and
the gap between them is itself the finding — whether KPR is outperforming or paying up.
Never blend them into one number, and never let a corpus figure read as if it described
KPR's own properties.

### Match base to base

Datex splits rent into `AnnualRentPSF` (base), `AnnualNNNPSF` (recoveries) and
`AnnualOtherPSF`. The corpus's `rentPerSF` is **base rent only**.

**The only valid comparison is Datex `AnnualRentPSF` against the corpus `rentPerSF`.**
Folding NNN into the Datex side inflates it by the entire recovery load — often $8–15/SF in
retail — and manufactures an above-market finding out of an ordinary rent. If you quote a
gross number, say it's gross and compare it only to another gross number.

## Query Datex NARROW — it is large, and a broad read is what makes a simple question slow

Measured on the live data: `TenantsMetrics` holds **2,101 rows per month**, about 37 fields
and ~900 characters each, as **monthly history going back years**. `read_records` returns at
most 100 rows per call and pages with a cursor. So an unfiltered read of a single month is
roughly 1.9 MB of rows and 21 round trips — and reading across history is a multiple of that.
That is how an ordinary question turns into fifteen minutes and a large slice of a usage
budget, with no better answer at the end of it.

**Four rules, applied in this order, before any read:**

1. **Pin ONE `Period` first.** It is monthly history; the current picture is the latest period
   only. Find it with a single cheap aggregate — `aggregate_records` on `TenantsMetrics`,
   grouped by `Period`, ordered descending, `first: 1` — then filter `Period eq` that value.
   Read across periods ONLY when the question is explicitly about a trend.
2. **Filter to the subject before reading, not after.** `Tenant contains "Dollar Tree"`,
   `BuildingName eq "Academy Plaza"`. Never pull the portfolio and sift it in your head.
3. **`select` only the fields you need.** Six named fields instead of all 37 is a ~6×
   reduction on every row. **Never `allFields: true`** on `Tenants` (94 fields) unless the
   question genuinely needs the whole record.
4. **If the answer is a NUMBER, use `aggregate_records`, not `read_records`.** count, avg,
   sum, min and max compute server-side with `groupBy`, returning one small result instead of
   pages of rows you then add up yourself.

**Filter the duplicate-row trap out at the source.** Adding `AnnualRentPSF gt 0` as a filter
removes the duplicate zero-rent rows in the same call, rather than pulling them and
discarding them afterwards. It fixes the correctness trap and the cost at once.

**Worked example — "what do we pay Dollar Tree across the portfolio?"**
One call: `Period eq <latest>` + `Tenant contains "Dollar Tree"` + `AnnualRentPSF gt 0`,
`select` of BuildingName / Tenant / SuiteSQFT / AnnualRentPSF / AnnualNNNPSF /
Rolling12SalesPSF / LastSalesPeriod, `first: 30`. Returns all 20 owned locations in about
2,700 characters — a complete answer, roughly 700× smaller than the unfiltered path.

**Stop when the question is answered.** Continuing to page with `after` past the point you
can answer is the most common way a simple question becomes an expensive one. `hasMore: true`
is not an instruction to keep going.

**Match the effort to the question.** "What does our Ulta at Northgate pay?" is one filtered
read. Only a genuine portfolio sweep or a trend justifies many calls — and if a question truly
needs that, say so up front rather than discovering it 40 calls in.

## Datex row traps — each one silently produces a wrong number

Verified against the live data. Before aggregating anything out of `TenantsMetrics`:

1. **Filter to one `Period`.** It's monthly history — without a period filter you count the
   same tenant dozens of times. "Current" is the latest period.
2. **Every tenant appears more than once per period, and the extra rows carry rent of 0.**
   Averaging the rows as returned **halves the rent.** Drop `AnnualRentPSF = 0` first.
3. **`Rolling12SalesPSF: 0` with `LastSalesPeriod: "190001"` means never reported, not zero
   sales.** That sentinel is January 1900. Treating it as real says a healthy chain does
   $0/SF — and averaging it produces a plausible-looking figure that is completely false.
   Exclude them and say how many locations actually reported.
4. **Datex names carry store numbers** ("Dollar Tree #4516"); the corpus stores the brand
   alone. Match on brand, not the raw string.

## Library traps — how its records age
### Ten years is the staleness horizon — measured from when a lease was STRUCK

In retail a data point older than about a decade is fairly stale, so the corpus
**recency-weights its medians**: influence fades linearly to zero across ten years.

**The clock runs from LEASE COMMENCEMENT, not from when the document was read.** A 2010
lease sitting inside a 2026 offering memorandum is a 2010 rent — reading it recently does
not make it a current market signal. Capture date is used only where commencement was never
recorded.

Every metric reports three things together:

- `median` — recency-weighted. The market as the corpus currently sees it.
- `unweightedMedian` — every lease treated equally, regardless of age.
- `nWithinHorizon` — how many leases actually inform the weighted figure.

**Read them together, because the divergence is the finding.** When the weighted median sits
well above the unweighted one, rents have risen; below, they've fallen. On the real data
Starbucks reads $50.00 weighted against $46.00 unweighted, with only 11 of 33 leases struck
inside the horizon — so the unweighted figure understates today's market by about $4/SF.
Saying *"rents have moved"* beats quoting either number alone.

A median resting entirely on old leases is **history, not market** — call it history.

**The caveat: amendments and exercised options reset the economics.** A lease renegotiated
later has a later effective vintage than its commencement date shows, and the roster does not
reliably record when that happened. An old lease showing recent rent steps may be fresher
than it looks. Note it rather than over-claiming in either direction.

### A forward-dated rent roll is not a fresh one

Retail offering memoranda routinely start their financials a few months out, on the date a
buyer would realistically close — a mid-2026 book will model from 1/1/2027. That is a normal
marketing convention, not an error and not evidence of a pro forma roster. It does **not**
mean the roster is current to that date. The corpus handles this by falling back to the
document's read date, and reports the OM's assumed closing separately.

## Reviewing a lease against precedent

When someone hands you a lease, an LOI, an amendment or a proposed term for a brand and
asks whether anything looks off, lead with **`brand_lease_terms`**. It returns every lease
the library holds for that brand plus the medians and p25–p75 bands, and how often each
mid-term lever appears.

Then:
- Anchor every judgement to the band and **say how many locations it's built from**. A
  two-location median is an anecdote; call it one.
- Rent above the band is a premium to interrogate, not "upside" — see below.
- On the levers, `false` means a source says the clause is absent; `unknown` means nothing
  in the library says either way. **Never report `unknown` as "no such clause."** And when
  a lever came from an OM read rather than an executed abstract, say it's unverified.
- Flag what's *missing* from the lease in front of you as readily as what's unusual in it:
  if seven of eight PetSmart leases carry a go-dark right and this one doesn't, that is
  the finding.

## Non-negotiables when answering

**Check the denominator before generalizing.** Before stating anything as a market finding —
"these centers typically…", "the market pays…" — call `data_coverage`. Under ~25% coverage a
field supports a per-deal observation, not a market claim, and you must say how many records
it rests on. Missing pricing is expected, not a defect.

`data_coverage` also reports **coverage by vintage**. Field coverage says whether the corpus
can answer a question at all; vintage says whether it can answer it about *today*. A brand
with forty captured leases all recorded before the horizon supports a historical claim, not a
market one — be explicit about which you're making.

**Never invent a number.** If a figure isn't in the returned data, say it isn't
captured. `null` means NOT CAPTURED — never zero, never "assume market." A
confidently-worded wrong number is far more dangerous than an honest "verify this."

**`annualRent` is base rent only.** Recoveries live in `expenseReimbursements`,
`percentageRent` and `otherRent`, and are populated only when the source disclosed
them. Never add them in when they're null, and never compute occupancy cost as
base ÷ sales.

**Cap rate and price are missing on most deals.** Retail centers are frequently
marketed unpriced. That's expected — don't flag it as a data problem or fill the gap
with an assumption.

**Above-market rent is downside, not upside.** A rent well above the brand's library
median is a premium that can reset down at renewal, and it inflates current NOI. Call
it sustainable only when the tenant's own sales or a low occupancy cost support it;
otherwise flag it as a rollover/NOI-quality risk, or — with no sales data — as
something to verify. Never call it "mark-to-market upside."

**Below-market rent locked by options is secure income, not a risk.** The tenant will
never walk away from it. Treat it as neutral-to-mildly-positive (durable income;
mark-to-market not capturable in a 5–7 year hold). It's only a real risk if the tenant
is distressed, if a dominant anchor's locked rent caps the asset's exit value, or if
the deal is priced as though that upside were capturable.

**Co-tenancy: report the trigger exactly.** "Any of the following" means one anchor
going dark trips it. "X of N" means you need (N − X + 1) dark — never model that as a
per-anchor trigger; doing so has overstated exposure by roughly 15x here before. An
occupancy-threshold clause has no anchor dependency at all.

**For a pricing verdict, use `comp_benchmark`, never `sale_comps`.** `comp_benchmark` runs
the app's own engine on a dealId — validity filters, tiered relaxation, a minimum sample,
medians with quartiles — and hands back a figure with nothing left for you to derive.
`sale_comps` returns raw rows for browsing what exists; deriving a number from them is the
exact eyeballing the rule below forbids.

**A thin comp set returns nothing, and nothing is the answer.** When the sample is below the
minimum, `comp_benchmark` withholds the statistics entirely and sets `suppressed`. Report
that the library cannot benchmark the deal yet and say how many comps it found. Do not
substitute a figure from `sale_comps`, from the OM's own comp page, or from general market
knowledge — the honest answer is that more comps have to go into the database first. (The
comp database is still thin, so expect this often.)

**Comps and benchmarks: narrate, don't re-derive.** Report medians (never means) and
always state the sample size and date range. Weight owned transactions over
broker/manual over OM-sourced. Below the minimum sample, say the benchmark is
insufficient rather than reaching for a number.

**Theaters are judged per screen** (~$400–700k+/screen is healthy), never per SF.

**Run the tie-outs.** Σ occupied SF + Σ vacant SF = total GLA; occupied ÷ total =
stated occupancy; EGI − OpEx = NOI; NOI ÷ cap = price. `data_quality` does this
deterministically — check it before quoting a number that looks surprising.

## Reading a deal well

`get_deal` returns the seller-stated fields, KPR's own underwriting (the `acq*`,
`debt*`, `pref*`, `txn*`, `disp*` fields — never mix these with the marketed numbers),
and the roster. It also returns `integrityFlags`: the live arithmetic audit for that
deal. If a flag says the roster is short of GLA, don't quote the roster's rent roll-up
as if it were complete — say what's unreconciled.

An ambiguous property name comes back as a candidate list, not a guess. Pick from it
by `dealId` rather than assuming.

## Scope

This library is **retail shopping centers** — not residential, not office, not land.
Read every deal through that lens: anchor quality and sales, inline health, rollover,
trade area, co-tenancy exposure.

The scope is the whole deal lifecycle, not lease review alone: new deals and offering
memoranda, leases and amendments, purchase and sale agreements and other legal documents,
loan documents, operating statements, underwriting assumptions, waterfalls and returns,
investor materials, tax and closing costs. These two connectors are meant to work as a
standing analyst alongside the work, so if a document touches any of that, load the
matching doctrine before reasoning about it.
