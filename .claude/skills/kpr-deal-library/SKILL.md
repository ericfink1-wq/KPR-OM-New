---
name: kpr-deal-library
description: Query the KPR Centers deal library — a broad MARKET CORPUS of retail shopping-center deals KPR has evaluated (mostly deals it looked at and did NOT buy), used to establish averages and trends across tenants, brands, anchors, markets, pricing and tenant sales. Use whenever a question is about what is NORMAL, TYPICAL, MARKET or OFF-MARKET in retail: "is this rent high for this brand", "what do these centers usually trade at", "how does this lease compare", "what have we seen for this anchor". Also use for any deal KPR does not own — passed deals, prospects, deals under contract, sold assets — and for sale comps, lease abstracts and KPR's underwriting doctrine. For facts about a property KPR OWNS, use Datex instead; this library holds only the acquisition-era snapshot of those.
---

# KPR deal library

## What this actually is

A **market corpus**, not a portfolio. KPR records essentially every retail deal it looks
at — bought, passed, still evaluating, long since sold — specifically to accumulate enough
data points to see averages and trends across tenants, brands, anchors, markets, pricing
and sales.

Most records here are deals KPR **looked at and did not buy**. That is the point: they are
the comparable set. Its value is **breadth** — n — and it is the right sample whenever the
question is what's normal, typical, market or off-market.

Two things follow, and both matter:
- **Never call a deal here "ours"** unless its status says Owned. Never present a
  corpus-wide roll-up (top tenants by rent, state mix, median cap rate) as KPR's own
  exposure, concentration or holdings — it describes the market KPR shops in.
- **For KPR's actual properties, this is not the source.** See below.

The tools arrive from the `kpr-deal-library` MCP connector. If they aren't available,
say so plainly — the connector needs an access key from Eric — and don't answer from
memory or general market knowledge as though it were KPR's data.

## Always start here

1. **`get_knowledge`** — once per conversation, before any analysis. It returns KPR's
   standing underwriting doctrine plus the live House View and operator-taught rules.
   Analysis that skips it will be wrong in the specific ways this team cares about
   (above-market rent, co-tenancy triggers, theater sales, comp discipline).
2. **`library_overview`** — what's actually in the library right now, plus the field
   glossary. Call it when you don't yet know the shape of the data.

Then work the specific question:

| Question | Tool |
|---|---|
| Which centers match…? | `search_deals` |
| Everything about one center | `get_deal` |
| Where else do we have this tenant? What rolls when? | `search_tenants` |
| Is this rent above or below market? | `tenant_benchmarks` |
| Rollover waterfall, concentration, credit mix | `portfolio_analytics` |
| What has traded, at what cap? | `sale_comps` |
| Lease terms, options, co-tenancy, kickouts | `lease_abstracts` |
| Is this lease off-market? | `brand_lease_terms` |
| Do these numbers tie out? | `data_quality` |
| Is there enough data to claim this? | `data_coverage` |

Every tool is read-only. You cannot change the library through this connector — if
someone asks you to fix a deal, tell them to do it in the app.

## Datex vs. this library

KPR runs **Datex**, its property-management system of record, as a separate connector.
Datex holds the live picture of the properties KPR **owns**: current rents and NNN, budget
vs actual, occupancy history, tenant sales, option and notice dates, loans, percentage-rent
breakpoints, vacant suites, and the active leasing pipeline.

**Split by question, not just by property:**

| Question | Source |
|---|---|
| "What does our Ulta at Northgate pay?" | **Datex** — a fact about a KPR property |
| "Is that rent normal for Ulta?" | **This library** — a market question, and it has the sample |
| "When is their option notice due?" | **Datex** — it tracks option and notice dates |
| "What have Ulta boxes traded at?" | **This library** — sale comps across the corpus |
| "What's the co-tenancy trigger structure?" | **This library** — it holds the parsed clause trees and abstracts |

The strongest pattern is the two together: **take the subject property's own figure from
Datex, then benchmark it against this corpus.** That's what the corpus is for, and Datex
structurally cannot do it — it only knows KPR's own buildings.

### Static vs living — why Datex leads

A deal here is captured from an offering memorandum or a rent roll and then **essentially
never updated.** Every figure is frozen as of its capture date, which each record reports as
`capturedAsOf`. Datex is fed continuously by KPR's team and reflects today.

So: default to Datex for anything that can change, and **always state the as-of date when
you quote this library.** A captured figure is never "the current rent."

This applies to averages too. A median across this corpus **blends vintages** over however
many years the captures span — it's the market as observed across that period, not today's
market. State the span, and weight recent captures when judging above or below market.

### On tenants and brands, cite BOTH

Don't pick one. They answer different questions, and the best answer carries both:

> Across KPR's own properties we see rents of $X (Datex, current). Across the broader set of
> deals we've reviewed, the market shows $Y (corpus, captures spanning 2019–2026).

What KPR **achieves as a landlord** is not the same thing as what the **market shows**, and
the gap between them is itself the finding — whether KPR is outperforming or paying up.
Never blend them into one number, and never let a corpus figure read as if it described
KPR's own properties.

**Rules:**
- For any live fact about a KPR-owned property, go to Datex first. This library's copy is
  the acquisition-era snapshot and doesn't track what happened since. Owned records here
  carry an `authority` field saying exactly that — read it.
- **Don't reach for Datex on a market question.** It shrinks the sample to KPR's own
  holdings, which defeats the reason this corpus exists.
- **On a disagreement about an owned property, Datex wins.** Say which source each figure
  came from and flag the gap. Never average them. Never silently pick one.
- If Datex isn't connected, use this library and say plainly that owned-asset figures are
  as-of the documents behind them, not today's rent roll.

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

**Check the denominator before generalizing.** Before stating anything as a portfolio
finding — "our centers typically…", "we usually pay…" — call `data_coverage`. Under ~25%
coverage a field supports a per-deal observation, not a portfolio claim, and you must say
how many records it rests on. Missing pricing is expected, not a defect.

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
