---
name: kpr-deal-library
description: Query the KPR Centers deal library — the live offering-memorandum database of retail shopping centers — through its MCP connector. Use whenever a question touches KPR's own deals, centers, tenants, rents, lease rollover, sale comps, lease abstracts or portfolio analytics; whenever someone asks "what do we pay X elsewhere", "which of our centers…", "what rolls in 202X", "how does this rent compare to our library"; and before answering any retail-underwriting question that KPR's own data could ground. Also use when asked to write an IC memo, a deal screen, or a tenant/rollover analysis for a KPR center.
---

# KPR deal library

The KPR Centers deal library is a live database of retail shopping centers — offering
memoranda, rent rolls, tenant sales, lease abstracts and KPR's own underwriting. This
skill tells you how to read it well.

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
| Do these numbers tie out? | `data_quality` |

Every tool is read-only. You cannot change the library through this connector — if
someone asks you to fix a deal, tell them to do it in the app.

## Non-negotiables when answering

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
