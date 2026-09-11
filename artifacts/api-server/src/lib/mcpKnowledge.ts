// The KPR analyst playbook — the standing, hard-won reasoning rules that make this
// library's analysis KPR's analysis rather than generic CRE commentary.
//
// This is the "knowledge" half of the MCP server: the tools hand an outside Claude
// the DATA, and this hands it the JUDGMENT to read that data the way the team does.
// It is deliberately static text (token-free, no model call) and is combined at
// request time with the two LIVE knowledge sources — the operator-taught extraction
// lessons table and the distilled House View — by buildKnowledgePack() below.
//
// STRUCTURED AS CORE + TOPICS, and that is a budget decision as much as an editorial
// one. Eric's ask (9/11/26) is an "always-on real estate brain" covering the whole deal
// lifecycle — new deals, PSAs, legal documents, underwriting assumptions, waterfalls —
// not just leases. Returning all of that on every call would blow the 40 KB response
// budget and bury the rule that actually applies. So KPR_CORE is always returned and
// carries a one-line TRIPWIRE for each topic, and the depth is fetched per topic.
//
// KEEP IN SYNC with CLAUDE.md: when Eric teaches a heuristic there, mirror it into the
// matching topic here, or outside chats keep making the mistake the site already learned.
// Where a topic is NOT grounded in a rule he has taught, it says so in its own text.

export const KPR_CORE = `# KPR Centers — retail underwriting playbook

You are reading the KPR Centers deal library. KPR acquires **retail shopping centers**
— not residential, not raw land, not office. Read every deal through a shopping-center
lens: anchor quality, inline health, tenant sales, rollover, trade area.

## What this library IS — read this before you interpret anything
This is **not KPR's portfolio.** It is a deliberately broad MARKET-INTELLIGENCE CORPUS:
KPR records essentially every retail deal it looks at — bought, passed, still evaluating,
long since sold — specifically to accumulate enough data points to see averages and
trends across tenants, brands, anchors, markets, pricing and tenant sales.

That changes how you read almost everything here:
- A deal in this library is usually a deal KPR **looked at**, not one it owns. Most of the
  records are passed or prospective deals, and that is the point — they are the comparable
  set, not a portfolio.
- "Top tenants by rent" and similar roll-ups describe **how often a brand appears across
  the deals we've seen**, not KPR's own exposure. Never present a corpus-wide figure as
  KPR's concentration, holdings or income.
- The value here is **breadth**: n. When you are asked what is normal, typical, market or
  off-market, this corpus is the right sample — bigger and wider than KPR's own holdings.
- Never say "our centers", "we own" or "our portfolio" about a deal in this library unless
  its status actually says Owned.

## Which source of truth wins
KPR runs **Datex**, its property-management system of record, as a separate connector.
Datex holds the live, thorough picture of the assets KPR actually OWNS — current rents,
budgets, prospective leases, tenant sales, occupancy, operating detail — and it is more
current and more complete on those properties than this library will ever be.

**For anything about a property KPR owns, reach for Datex first.** This library's copy of
an owned asset is an acquisition-era snapshot, captured from the offering documents at the
time of the deal, and it does not track what has happened since. Records here for owned
assets carry an \\\`authority\\\` note saying exactly that.

**This library is the source — and usually the ONLY source — for the market picture:**
deals KPR evaluated and passed, live prospects, deals under contract, assets sold, the
seller-marketed figures from every OM, the sale-comp database, the lease abstracts stored
here, and every cross-deal average, benchmark and trend. Datex knows KPR's own buildings;
it does not know the hundreds of deals KPR looked at and declined, which is where the
market signal actually lives.

So the split is by QUESTION, not just by property:
- *"What is the rent at our center?"* → a fact about a KPR property → **Datex.**
- *"Is that rent normal for this brand?"* → a market question → **this library**, because it
  has the sample. Take the subject property's own figure from Datex, then compare it
  against this corpus.
- On a disagreement about an owned property: **Datex wins.** Say which source each figure
  came from, and flag the gap. Never average the two, and never silently pick one.

**Why Datex leads — static vs living.** A deal in this library is captured from an offering
memorandum or a rent roll and then essentially never updated. Every figure is frozen as of
its capture date (each record reports \\\`capturedAsOf\\\`). Datex is fed continuously by KPR's
team and reflects today. So default to Datex for anything that can change, and always state
the as-of date when quoting from this library. A captured figure is never "the current rent."

**Ten years is the staleness horizon.** In retail a data point older than about a decade is
fairly stale, so this corpus recency-weights its medians: a capture's influence fades
linearly to zero across ten years. Every metric reports \\\`median\\\` (recency-weighted — the
market as the corpus currently sees it), \\\`unweightedMedian\\\` (everything ever captured), and
\\\`nWithinHorizon\\\` (how many records fall inside the horizon).

Read them together. When the weighted and unweighted medians diverge materially, **rents
have moved**, and saying so is a better answer than either number alone. A median resting
entirely on stale captures is history, not market — call it history. And distinguish the two
clocks: a capture date ages the NUMBER, while a lease commencement date ages the DEAL. A
lease struck fifteen years ago is legacy rent even if it was recorded last month, so
\\\`leasesStruckWithinHorizon\\\` — leases actually negotiated inside the horizon — is the truest
market signal in the set.

**Comparing to Datex: match BASE to BASE.** Datex reports rent in separate components —
\\\`AnnualRentPSF\\\` (base), \\\`AnnualNNNPSF\\\` (recoveries) and \\\`AnnualOtherPSF\\\`. This corpus's
\\\`rentPerSF\\\` and \\\`annualRent\\\` are **base rent only**. So the only valid comparison is Datex
\\\`AnnualRentPSF\\\` against this corpus's \\\`rentPerSF\\\`. Adding NNN into the Datex figure and
setting it against a corpus base rent inflates the Datex side by the whole recovery load —
often $8–15/SF in retail — and would make a perfectly ordinary in-place rent look wildly
above market. If you quote a gross number, say it is gross and compare it only to another
gross number.

Two more alignment notes for Datex: \\\`TenantsMetrics\\\` is MONTHLY history keyed by \\\`Period\\\`
(YYYYMM), so "current" means the LATEST period — never an arbitrary row. And Datex sales are
\\\`Rolling12SalesPSF\\\` (trailing twelve months, live), while this corpus's \\\`salesPSF\\\` is the
figure a document disclosed as of its capture date. Both are sales PSF, but one is current
and one is historical — label which is which.

**Datex row-level traps — verified against the live data, and each one silently produces a
wrong number.** Before aggregating anything out of \\\`TenantsMetrics\\\`:
1. **Filter to one \\\`Period\\\`.** It is monthly history. Without a period filter you aggregate
   the same tenant dozens of times. "Current" is the latest period.
2. **Every tenant appears more than once per period, and the extra rows carry rent of 0.**
   Averaging the rows as they come back HALVES the rent. Drop rows where \\\`AnnualRentPSF\\\` is
   0 before you compute anything.
3. **\\\`Rolling12SalesPSF: 0\\\` with \\\`LastSalesPeriod: "190001"\\\` means NEVER REPORTED, not zero
   sales.** That sentinel date is January 1900. Treating those zeros as real sales says a
   healthy chain does $0/SF, and averaging them produces a plausible-looking figure that is
   completely false. Exclude them; report how many locations actually reported.
4. **Datex tenant names carry store numbers** ("Dollar Tree #4516"); this corpus stores the
   brand alone. Match on the brand, not the raw string.

**A lease ages from when it was STRUCK, not from when we read it.** A 2010 lease sitting
inside a 2026 offering memorandum is a 2010 rent — reading it recently does not make it a
current market signal. Benchmarks here are therefore weighted by LEASE COMMENCEMENT, with
capture date used only where commencement was never recorded. The caveat: amendments and
exercised options RESET the economics, so a lease renegotiated later has a later effective
vintage than its commencement date shows, and the roster does not reliably record when that
happened. An old lease with recent rent steps may be fresher than it looks — say so rather
than over-claiming in either direction.

**A rent roll dated in the FUTURE is the OM's assumed closing date, not a capture date.**
Retail offering memoranda routinely start their financials a few months out, on the date a
buyer would realistically own the asset — a mid-2026 book will model from 1/1/2027. That is
a normal marketing convention, not an error and not evidence of a pro forma roster. It does
NOT mean the roster is current to that date, so never read a forward as-of date as freshness.

**On tenants and brands, use BOTH sources and cite BOTH.** They answer different questions:
  *"Across KPR's own properties we see rents of X (Datex, current). Across the broader set of
  deals we've reviewed, the market shows Y (corpus, captures spanning 20NN–20NN)."*
What KPR achieves as a landlord is not what the market shows, and the gap between the two is
itself the finding — whether KPR is outperforming, or paying up. Never blend them into one
number, and never let a corpus figure be read as describing KPR's own properties.

## Cardinal rule: accuracy over speed
Never fabricate a precise-looking figure. When a number can't be verified from the
data returned by these tools, say so and leave it blank. A confidently-worded wrong
number is far more dangerous than an honest "not captured — verify."

## Field conventions you must respect
- \\\`annualRent\\\` is **base rent only**. Recoveries live in separate fields
  (\\\`expenseReimbursements\\\` = CAM+tax+insurance, \\\`percentageRent\\\`, \\\`otherRent\\\`) and are
  only populated when the source document disclosed them. Absent = null, not zero.
- \\\`propertyName\\\` (never "dealName"). Dates are ISO \\\`YYYY-MM-DD\\\`.
- **Occupancy cost** = (base + reimbursements + % rent + other) ÷ gross sales, and only
  when those components are disclosed. NEVER base ÷ sales. Never guess it.
- **WALT** is weighted by SF against lease expiry dates.
- KPR's own underwriting lives ONLY in the \\\`acq*\\\`, \\\`debt*\\\`, \\\`pref*\\\`, \\\`txn*\\\`, \\\`disp*\\\`
  fields — never folded into the OM-stated display fields. Don't confuse the seller's
  marketed numbers with KPR's underwriting.
- \\\`isNAP\\\` means a parcel KPR does not own. A 0-SF income lease (ATM, ground lease, pad,
  billboard) is NOT NAP — it pays rent that belongs in the rent roll-up.
- \\\`isDark\\\` means the store is closed but the lease is still paying. Dark anchors are a
  headline risk even while rent is current.
- EGI above GPR is **normal** in retail (recoveries). Never flag it.
- Cap rate and asking price are absent on roughly 95% of these OMs — retail centers are
  frequently marketed unpriced. That is expected, not a data defect.

## Tie-outs that must hold
When you see two figures that must agree, check them: Σ occupied SF + Σ vacant SF =
total GLA; occupied ÷ total = stated occupancy; Σ occupied base rent = gross potential
rent; EGI − OpEx = NOI; NOI ÷ cap = price. A contradiction is a real finding worth
raising. An absent value is just absent — not a contradiction.

## Ground every document in the actual property — this is the whole point

Neither this library nor Datex holds PSAs, loan documents or leases as documents. But
those documents are FULL of tenant- and property-level facts that both systems know
cold, and a review that does not reach for them is generic commentary dressed up as
analysis. Whenever a document in front of you names a tenant, a square footage, a rent, a
date, an anchor, a percentage of GLA or a dollar threshold, LOOK IT UP before you comment
on the clause.

Worked examples of the reflex:
- A PSA conditions closing on estoppels from "Major Tenants" over 10,000 SF. Pull the
  roster, list exactly who qualifies, and say what share of base rent sits behind that
  condition. "Estoppels required from majors" is a restatement; "the condition covers six
  tenants and 61 percent of base rent, including both anchors" is an answer.
- A casualty clause lets either party terminate above a damage threshold. Compare that
  threshold to the centre's actual GLA and replacement scale — a number that sounds large
  can be a single inline unit.
- A PSA allocates delinquent rent after closing. Check the roll for who is actually
  delinquent and for percentage-rent tenants whose true-up lands post-closing.
- A lease consent or ROFR could block a pad sale. The executed abstracts hold those
  rights; check before anyone markets the pad.
- Debt is being assumed. Datex holds the live loan; the document holds the terms. Tie the
  balance and rate to each other and say which came from where.
- A tax proration clause meets a jurisdiction that reassesses on sale. That is not a
  proration detail, it is a forward NOI item — size it.
- A covenant, exclusive or co-tenancy clause names an anchor. Check whether that anchor is
  currently open, what it pays, when it expires, and whether a sale or a going-dark event
  trips anything.

Which system to ask: a fact about a property KPR OWNS goes to Datex first, because it is
live. Treat Datex data on an owned, active asset as AS OF TODAY — the team feeds it daily,
so it does not need the as-of hedging this library does. Quote a Datex figure as the
current number. Quote a figure from here with its capture date, always. A market question — is this rent, this threshold, this term normal — belongs here,
because this is the sample. When you have both, cite both separately and let the gap be
part of the finding.

Two disciplines carry over unchanged. If the document and the data disagree, that is a
FINDING, not something to reconcile silently — name both figures and which source each
came from. And if the data does not cover it, say so; an unverified clause read out with
confidence is exactly the failure mode this playbook exists to prevent.

## Doctrine topics — call get_knowledge again with the topic you need

What you have just read is the CORE: what this library is, which source wins, field
conventions and the tie-outs. The depth for each kind of work is held separately so a
single response stays readable. Call get_knowledge with \`topic\` set to any of these the
moment the conversation touches that ground — do not reason from the tripwire alone.

- \`rent_and_tenants\` — above- and below-market rent, demographics, cinema per-screen math.
  TRIPWIRE: above-market rent is mark-to-market DOWNSIDE, never upside.
- \`leases\` — co-tenancy triggers, mid-term tenant levers, abstracting from executed
  documents, the ten issue dimensions.
  TRIPWIRE: an "X of N" co-tenancy clause is NOT a per-anchor trigger; collapsing it has
  overstated real exposure by roughly fifteen times.
- \`underwriting\` — owned-asset financials, the four-way tie-out, what looks wrong and is not.
  TRIPWIRE: an owner's income statement books treasury income ABOVE the NOI line, so its
  reported NOI is inflated — strip it.
- \`debt\` — loan terms, deriving the loan from the interest line, cash-sweep triggers.
  TRIPWIRE: never fabricate a loan amount or rate; derive it and tie it to the dollar.
- \`waterfall_and_returns\` — investor-book arithmetic audit, pref and promote structure, exits.
  TRIPWIRE: never quote an IRR you have not tied back to the cash-flow line.
- \`psa_and_legal\` — purchase and sale agreements, conditions, prorations, risk allocation.
  TRIPWIRE: never state a deadline without its clause and whether days are business or calendar —
  and never read a clause without looking up the tenants and figures it actually turns on.
- \`taxes_and_closing\` — reassessment on sale, closing costs, transfer taxes.
  TRIPWIRE: commercial treatment always; cliff taxes are never modelled as marginal.
- \`investor_materials\` — investor letter format, IC memos, internal consistency.
  TRIPWIRE: every headline figure must recompute from its own components.
- \`comps\` — comp discipline and what counts as a comparable.
  TRIPWIRE: the app computes comp statistics; you narrate them, never re-derive them.
- \`data_integrity\` — the deterministic audit, and contradiction versus staleness.
  TRIPWIRE: a lease that rolled after capture is not an extraction error.

\`topic: "all"\` returns every section at once. It is long — prefer the topic you need.
`;

export const DOCTRINE_TOPICS: Record<string, string> = {
  rent_and_tenants: `## Above-market rent is DOWNSIDE, never "upside"
An in-place rent well ABOVE the brand/library median is a premium that may not survive
renewal: at the next expiry or option it can reset DOWN toward market, or the tenant
leaves — and it inflates current NOI, so a buyer capping that NOI overpays for income
that rolls off. NEVER call above-market rent "mark-to-market upside."
- **Sustainable** (mild strength) when the tenant's own sales support it: strong sales
  PSF and/or a LOW occupancy cost.
- **A risk** (rollover / NOI-quality) when sales are weak or occupancy cost is high —
  especially with a reset inside the ~5–7 year hold, sized to the tenant. A big anchor
  premium rolling into a near-term reset is a headline risk.
- With no sales data (the common case), assume neither — flag it to VERIFY that sales
  support the premium.
- The one thing that helps a premium is a strong, rising trade area. Never score that
  as upside on its own.

## Below-market rent locked by options is NOT a risk — it is sticky income
A tenant never walks away from a below-market deal, so a locked below-market lease is
the most durable income in the center (near-zero vacancy/re-leasing risk). The only
thing "lost" is theoretical upside that was never underwritable. Treat it as a NEUTRAL
call-out (secure income; mark-to-market not capturable in a 5–7 year hold), and for a
healthy credit a mild income-durability strength. NEVER frame a healthy locked tenant
as "rent compression" or "structural underperformance." It becomes a genuine risk only
when (i) the tenant is distressed (weak sales / high occupancy cost, so even the low
rent is shaky), (ii) a DOMINANT anchor's locked rent materially caps income growth and
resale value (a valuation/exit point — the income is still secure), or (iii) the deal is
priced as though that upside were capturable. A single below-market inline tenant with
cheap long options is never a "key risk."

## Demographics tie to rent and cap rate
Higher household income AND higher population — especially both together — generally go
with higher rents and tighter (lower) cap rates, and signal a dense infill trade area
where supply is constrained. Use it as an interpretive lens, not a hard rule: a dense,
high-income location helps justify above-average in-place rent or a tighter going-in
cap; a thin or low-income trade area warrants more cap-rate cushion and weaker rent
growth. A deal whose rent/cap looks aggressive for a WEAK trade area is a pricing risk.

## Movie theaters are judged per SCREEN, not per SF
A cinema is a big box, so sales/SF is meaningless — theaters underwrite on sales per
screen (roughly $400–700k+/screen is healthy) and per seat. If a theater's salesPSF
looks impossible (thousands of dollars per SF), it is almost certainly a per-screen
figure mis-stored — flag it rather than reporting it. A screen count above ~30 or below
3 is suspect and should be confirmed, not silently used.
`,

  leases: `## Co-tenancy triggers: be exact, never collapse them
The single most important thing about a co-tenancy clause is what actually trips it.
- **"ANY named tenant"**: losing ONE named anchor DOES trip it — a real single-anchor
  dependency.
- **"X of N"** ("at least 7 of these 10 must stay open"): losing one named store does
  NOT trip it — you need (N − X + 1) dark. Never model these as per-anchor solo
  triggers; doing so has overstated headline exposure by ~15x in this library's history.
- **Occupancy-threshold** ("below 75% of GLA occupied"): no named anchor at all — don't
  invent anchor dependencies.
Always carry the exact remedy (substitute rent = X% of gross sales, or 50% of minimum
rent), the relief period before a termination right opens, and the notice window.

## Mid-term tenant levers are headline items, not footnotes
Any right a tenant can exercise mid-term to cut rent or get out is among the most
important facts about a center: co-tenancy outs, sales/kickout terminations, go-dark
rights and recaptures, exclusive-violation abatement, early-termination options, ROFO /
ROFR, casualty terminations, and any landlord obligation offsettable against rent. For
each, state the trigger, the remedy, the cure/notice window, and whether it is currently
close to being triggered.

## The rent roll is the final say on roster facts
For an owned asset, the current rent roll is the most recent record and it WINS every
roster conflict — tenant name, suite, SF, current rent, commencement/expiry, steps,
options. Flyers, sales reports and abstracts are cross-checks and disambiguation aids
only; marketing flyers in particular carry stale or swapped tenant↔box labels. A figure
that comes from the roll is settled — do not tell the user to "verify the SF against the
lease." Flag only what is genuinely absent from the roll.

## Lease abstracting runs on the executed documents alone
When reading lease abstracts from this library: executed legal instruments govern, in
this authority order — (1) the lease plus every amendment, (2) the Commencement Date
Agreement / delivery memo, (3) the estoppel certificate. The rent roll and any draft
abstract are cross-checks, never sources. \\\`verifiedAgainstExecutedDoc: false\\\` on a field
means exactly that — treat it as unverified and say so. Never state an ambiguous clause
as settled fact; flag it for counsel instead. This matters most for purchase options,
ROFR/ROFO, co-tenancy and kickout triggers, exclusives, termination rights, and guaranty
scope.


## Lease abstracting — authority order, and what counts as a source
Abstract from the EXECUTED legal instruments alone, in this order:
1. The lease plus EVERY amendment. Walk the chain to its end — amendments number
   sequentially and each one's recitals list the full prior chain, so use them as a
   completeness checklist. The most recent amendment governs current term and rent.
2. The Commencement Date Agreement / Delivery Memorandum — the both-party-signed
   document that fixes the real commencement when the lease ties it to "delivery" or
   "opening" and prints no calendar date. This, not the rent roll, is where a
   commencement date comes from.
3. The estoppel certificate — the tenant's own certification of commencement,
   expiration, rent, deposit and no-defaults. Strong corroboration.

The rent roll and any draft abstract are NOT sources. They are cross-checks and
tripwires. When one disagrees with the executed documents, the DOCUMENTS govern and you
flag the roll — never pull a value from it into the abstract. If a commencement memo is
genuinely absent, the honest output is "commencement not memorialised in the documents —
flag", or the roll's date recorded PROVISIONALLY, marked unverified and raised as a
missing-document request. Never silently, never as if document-sourced.

## Never leave a knowable field null, and never assume one
An open store with a blank term date or an undated rent step is a DEFECT, not
"documents-only correctness" — go find the commencement memo or estoppel and cite it.
Only leave a date null when the store genuinely has not commenced, and then say so.
Equally: when a document is ambiguous, internally inconsistent, partly illegible or its
governing exhibit is missing, do NOT pick a value. Capture what it appears to say, mark
it unverified, and flag exactly what needs confirming — most critically for purchase
options, ROFR/ROFO, co-tenancy and kickout triggers, exclusives, termination rights and
guaranty scope. A confidently-worded wrong abstract is far more dangerous than an honest
"verify this".

## Every abstract carries all ten issue dimensions
KPR's workbook renders a cross-tenant matrix, and an unpopulated cell reads as "None".
So each abstract needs an explicit value or an explicit "None" for: renewal options,
radius restriction, security deposit, landlord restrictions, tenant restrictions,
co-tenancy, exclusives, TENANT termination rights, LANDLORD termination rights, and
relocation. Tenant and landlord termination are tracked separately — never lump them.`,

  underwriting: `## Underwriting an owned asset from the owner's own statements

### Strip non-property treasury income out of NOI
KPR's MRI comparative income statements book Interest Income, Dividend Income and
money-market gain/loss into "TOTAL OTHER INCOME" ABOVE the net-operating-income line, so
the statement's REPORTED NOI is inflated by entity treasury income that no buyer would
ever capitalise. Compute property NOI as:

  (Total Rental Income + Total Expense Reimbursement + property-tenant other income)
  − Total Operating Expenses

Property-tenant other income means late fees, lease-termination fees and write-offs —
those are real property income, keep them. Interest, dividends and MMF gains are not.
Set effective gross income to the clean property EGI so that EGI − OpEx = NOI actually
ties. State BOTH the clean property NOI and the statement's reported NOI, naming the
dollars stripped, so the two can be reconciled. Inflation seen on real KPR assets has
run from nothing to roughly 77,000 dollars a year — and some entities are already clean,
so never strip what isn't there.

Below the NOI line and never in OpEx: debt service, depreciation, amortisation, capital
expenditure, leasing costs.

### The roster must reconcile to the building, not just to the occupied space
Build to the roll's printed total GLA. Add a Vacant row for every vacant suite the roll
lists, so the sum of tenant SF equals total SF and occupied over total equals the stated
occupancy. An occupied-only roster silently under-builds the asset — real misses have
run past 22,000 SF including an entire former big-box. Never fabricate a suite number:
if the roll doesn't give one, omit the field and note that it wasn't captured.

### Zero-SF income leases are not NAP
An ATM, ground lease, pad or billboard pays rent that IS inside the roll's base-rent
total. Include them as ordinary zero-SF tenants so base rent ties. Marking them
not-a-part drops their rent from the roll-up and breaks the tie-out. Reserve NAP for
parcels that genuinely are not owned.

### Sales figures that are not retail sales
A bank's or credit union's "sales" in a five-year sales report are deposit or
transaction VOLUME — exclude them from sales history. Gym figures are memberships, not
comparable retail sales per square foot: keep them but mark them non-comparable.

### The four-way tie-out — run it before delivering any owned deal
1. Occupied SF + vacant SF = stated total SF
2. Occupied / total = stated occupancy
3. Sum of occupied annual base rent = gross potential rent = the roll's printed total
4. Effective gross income − operating expenses = NOI
Prove it by computation over the data, never by eye.

### Two things that look wrong and are not
Effective gross income ABOVE gross potential rent is NORMAL in retail — recoveries sit
in EGI. Do not flag it. And cap rate and asking price are absent on the large majority
of retail offering memoranda because retail is frequently marketed unpriced; that is a
fact about how the asset class trades, not a data gap.`,

  debt: `## Debt — derive it from the statement, never from assumption

### Tie the loan to the actual interest line
Monthly first-mortgage interest times twelve is annual debt service; divided by the rate
it implies the loan balance, and it must tie to the statement to the dollar. When the
rate is supplied, VERIFY it reproduces the statement's monthly interest before using it.
When loan amount, rate or maturity are not in the folder, record what the interest line
shows, ask for the loan documents, and leave the rest null. Never fabricate an amount or
a rate — a precise-looking wrong number is worse than an acknowledged gap.

### What to capture from a loan document
Recourse: non-recourse with bad-boy carve-outs, or recourse to a named party, and who
the guarantor is. Prepayment: open period, yield maintenance, defeasance, and the exact
formula. Interest-only period and the amortisation that follows it. The rate: fixed
all-in, or a spread in basis points over a named index (Term SOFR, the swap rate) — and
say which index, since the spread alone is not a rate. Maturity plus extension options
and the CONDITIONS on exercising them (fee, minimum debt yield, DSCR test). Financial
covenants and the tests that trip them. Reserves and escrows.

### Flag anything that can intercept cash
A cash-management or lockbox trigger, a distribution block, a DSCR or debt-yield floor
that sweeps cash — these decide whether the equity actually receives money and belong at
the top of a summary, not in a footnote. Say what the test is, where it currently
stands, and how much headroom is left.`,

  waterfall_and_returns: `## Investor books, waterfalls and returns

### Audit the arithmetic automatically — do not wait to be asked
On any financial-summary or cash-flow page, verify: every subtotal and total; sign
conventions (income positive, expenses, debt service and capital negative); debt service
against the stated rate and balance; sources equal uses; the waterfall math tier by
tier; loan payoff against the projected balance at that date; and that the headline IRR
and yield actually tie back to the cash-flow line they claim to come from. Report what
does not tie, with both figures and the page.

### Never quote a return you have not tied out
An IRR or equity multiple lifted from a summary page and not reconciled to the cash-flow
stream is a marketing number. Tie it, or say plainly that it is unverified.

### Reading a waterfall precisely
State the structure rather than summarising it: return OF capital and return ON capital
and which comes first; the preferred return rate, whether it COMPOUNDS or is simple, and
whether unpaid pref accrues; each promote tier with its hurdle, and whether the hurdle
is an IRR or a multiple — they behave very differently as the hold extends; whether
there is a catch-up and how fast; whether the promote is computed deal-level or
per-investor; and what happens on a capital event versus operating cash flow. A
"20 percent promote" means nothing without its hurdle and its basis.

### Interrogate the exit before the returns
Compare the exit cap to the going-in cap. An exit cap equal to or tighter than going-in
is an assumption that the market improves, and it usually carries a large share of the
projected return — size how much of the IRR comes from cap compression versus from
actual net operating income growth. Check the hold period, the sale costs, and whether
the terminal NOI includes income that rolls off before the exit.`,

  psa_and_legal: `## Purchase and sale agreements, and other transaction documents

NOTE ON PROVENANCE: unlike the lease, underwriting and tax doctrine here, this section
is a standard institutional review framework rather than a set of rules Eric has taught
from a specific KPR deal. Treat it as scaffolding to be corrected — when he rules on
something, that ruling wins and should be recorded as an operator-taught rule.

### Read every clause against the real roster, never in the abstract
A PSA is mostly a set of triggers pointed at tenants, dates and dollar thresholds — and
you have the roster, the rents, the expiries, the abstracts and, for an owned asset, the
live Datex record. Resolve each trigger against that data before commenting: who the
named or qualifying tenants actually are, what share of rent and GLA they represent,
which leases the consent or estoppel provisions actually capture, whether a threshold is
large or trivial for a centre this size. See "Ground every document in the actual
property" in the core doctrine for the full reflex. A clause summarised without its
subjects is not a review.

### Never state a deadline without its clause and its day-count basis
Business days and calendar days are different deals. Say which the document uses, name
the section, and state what event starts the clock — effective date, delivery of a
specified item, or expiry of a prior period. A date quoted without its basis is the
single easiest way to miss a deposit going hard.

### The economics of the deal
Deposit: amount, when each instalment is due, exactly what makes it non-refundable, and
whether it is applicable to the purchase price. Due diligence: the period, its
extension rights and what each extension costs, and precisely which termination right
survives its expiry. Closing: the outside date, who may extend it and on what terms.
Purchase price adjustments, holdbacks and earnouts, and what releases them.

### Conditions that can actually stop a closing
Estoppels: what percentage of the roster is required, whether named anchors are
separately required, what form is acceptable, and the remedy if they are not delivered —
this is the condition most likely to bite on a retail centre. Required consents, REA or
OEA estoppels and waivers, tenant rights of first refusal triggered by the sale, title
and survey objection and cure mechanics, and any lender consent for assumed debt.

### Risk allocation
Representations and warranties: survival period, cap, basket or deductible, and
knowledge qualifiers including whose knowledge. Indemnities and their survival.
Casualty and condemnation: the dollar or percentage threshold that lets either party
walk, and who takes the insurance proceeds. Assignment rights and cooperation with a
1031 exchange. Default remedies on each side — specific performance versus liquidated
damages capped at the deposit is a materially different bargain.

### Prorations are where money quietly moves
Rents and the treatment of DELINQUENT rent after closing; percentage-rent true-ups;
the CAM and tax reconciliation for the year of sale and who bears a shortfall; real
estate taxes and whether a pending reassessment is addressed; security deposits; and
leasing costs — tenant improvement allowances and commissions for leases signed before
closing but paid after. State who pays each.

### The same uncertainty discipline as a lease abstract
When a provision is ambiguous, inconsistent with another section, or its governing
exhibit is missing, do not resolve it silently. Quote it, mark it unverified, say what
needs confirming and flag that it may need counsel. Deal-defining rights — purchase
options, rights of first refusal affecting a pad sale, termination rights — get raised
prominently rather than buried.`,

  taxes_and_closing: `## Property taxes on a sale, and closing costs

### Reassessment — commercial treatment, always
Where a state or county differentiates by class, use the COMMERCIAL figure: the
commercial assessment ratio, commercial caps, the commercial class rate. Never import a
residential-only cap or ratio.

Ground the dollar step-up in the property's REAL bill — taxes divided by assessed value
gives the effective rate that actually applies. County-level data refines the TIMING of
the reset and the RATIO; it is not what makes the dollar math right. The step is largest
where base years are stale and reset on sale, and smallest where assessment is already
annual-to-market.

Pennsylvania and Ohio carry the most value: Pennsylvania combines stale base years with
an annually republished Common Level Ratio (reissued each July — verify the current
year), and Ohio runs staggered reappraisal and update years. Texas, Florida and most of
the West are already close to annual market value, so the reset is small.

Forward triggers worth modelling separately from the sale: loss of an exemption or a
non-profit seller, agricultural or greenbelt rollback, renovation and new construction,
an abatement burning off, and scheduled statutory changes.

NEVER ASSUME a county figure. If an authoritative number is not in hand, keep the state
framework, mark the confidence, and say plainly that county-specific data is not
available and should be confirmed locally. An invented millage or ratio is exactly the
precise-looking fabrication this team refuses.

### Closing costs
Title insurance is REGRESSIVE — priced on marginal brackets, so the rate falls as price
rises; never apply a flat percentage. A handful of states publish promulgated or exact
schedules; elsewhere the curve is representative and should be labelled as such.

Transfer and recording taxes come in three shapes and must not be converted into one
another: graduated marginal tiers applied portion by portion; CLIFF tiers where crossing
a threshold applies the higher rate to the WHOLE price; and flat rates. A cliff tax
modelled as marginal understates the bill materially at the threshold.

Local lines are PICK-ONE, not additive — a city and a county line covering the same
transfer are alternatives, and stacking them is a real and expensive error. Exclude
residential-only lines: every KPR deal is commercial, and commercial treatment can differ
from the residential schedule entirely.`,

  investor_materials: `## Investor letters and IC memos

### The investor letter format
Follow the house format: the property name in bold; a warm first-person opening giving
size and location; price and in-place cap rate; the lead anchor with its sales; a
financing paragraph naming the lender, the interest-only period, loan-to-value, the
spread in basis points over the SOFR swap, and the spread between the going-in cap and
the loan constant; a RETURNS paragraph with annual cash-on-cash and IRR stated
CONSISTENTLY; an invitation to participate; and an overview covering anchors and the
value levers. Deliver it inline first, then offer a document version.

### Consistency is the whole job
Every figure in a letter or memo must tie to the model and to the other figures in the
same document. Cash-on-cash quoted for one year and IRR for a different hold, or a cap
rate that does not reproduce from the stated NOI and price, is what readers notice.
Before sending, recompute each headline number from its components.

### What an IC memo owes the reader
The thesis in the first paragraph, not the last. The anchor and its sales productivity.
Rollover concentration and the largest single expiry. The two or three things that would
actually break the deal, sized in dollars rather than described as risks. What is being
assumed rather than observed — and say which figures are seller-stated.`,

  comps: `## Comps: narrate, never re-derive
The app computes all comp statistics in code. Report the structured benchmark output as
given — medians (never means), with n and the date range always stated. Source quality
runs owned (KPR's verified trades) > broker/manual > OM-sourced (seller-cherry-picked,
the weakest). Below the minimum sample the benchmark is "insufficient" — suppress the
verdict rather than reaching for a number.


### What makes a comparable actually comparable
A sale comp is a property that TRADED: it carries a price and a date. A competitive set,
a nearby-centres map or a trade-area list is not a comp, however it is labelled in an
offering memorandum, and a row with neither price nor date should be omitted rather than
recorded as a shell.

Rank sources by quality and say which you used: KPR's own verified trades first, then
broker or manually entered comps, then comps lifted from a seller's own offering
memorandum — the last of those is a cherry-picked set and the weakest evidence there is.

Never state a benchmark without n and the date range, and never quote a median resting
on fewer than a handful of trades. Below that threshold the honest answer is that the
set is insufficient, with the statistics suppressed rather than reported with a caveat —
a warning attached to a number is the part that gets dropped when the number is repeated.`,

  data_integrity: `## Tie-outs and the deterministic audit

Every deal in this library is run through arithmetic checks that fire only on genuine
CONTRADICTIONS, never on absent values. When you are handed a figure that looks
surprising, call data_quality before trusting it.

What is checked: roster SF against building GLA, and stated occupancy against the
occupancy the roster implies; NOI divided by cap rate against price, the classic
three-way tie-out; weighted average rent against the roster roll-up; per-tenant rent per
SF times SF against annual rent, which catches OCR and column errors; duplicate suite
rows; unit-of-measure sanity such as occupancy stored as a fraction or a cap rate stored
in basis points; price per SF against price divided by GLA; NOI against effective gross
income, which is impossible if NOI is larger; NOI equals EGI minus operating expenses;
cash-flow year-one NOI against the headline NOI; recoveries roll-up; gross potential rent
against in-place base rent; lease-date chronology; and leases whose expiry precedes the
rent roll's own as-of date.

That last one matters more than it looks. Weighted average lease term is remaining term
weighted by square footage, and an expired lease floors at zero years while still
carrying its full square footage in the denominator — so one stale anchor row drags a
centre's WALT toward zero while every WALT figure still agrees with every other.

Two distinctions to keep straight when reading the audit. A DETERMINISTIC TIE-OUT is
arithmetic that contradicts itself and is recomputed on every call: treat it as fact. A
STORED CAPTURE is a question raised when the document was first read and never answered,
so it may well be stale. And a contradiction is not the same as staleness: this library
is captured from documents and rarely updated, so a lease that has simply rolled since
capture is not an extraction error — check the as-of date before calling anything wrong.`,

};

export const TOPIC_NAMES = Object.keys(DOCTRINE_TOPICS);

/** Everything at once. Kept as KPR_PLAYBOOK so existing callers (section: "playbook",
 *  and the extraction-side guidance) keep working unchanged. */
export const KPR_PLAYBOOK = [KPR_CORE, ...TOPIC_NAMES.map(t => DOCTRINE_TOPICS[t])].join("\n\n");

/** Resolve a requested topic to its doctrine. Unknown topics return null so the caller
 *  can say what IS available rather than silently handing back the core again — a
 *  silent fallback would read as "there is no such doctrine", which is the opposite of
 *  the truth. */
export function doctrineForTopic(topic: string | null | undefined): { markdown: string; topic: string } | null {
  const t = String(topic ?? "").trim().toLowerCase();
  if (!t || t === "core") return { markdown: KPR_CORE, topic: "core" };
  if (t === "all") return { markdown: KPR_PLAYBOOK, topic: "all" };
  const hit = DOCTRINE_TOPICS[t];
  return hit ? { markdown: [KPR_CORE.split("## Doctrine topics")[0].trim(), hit].join("\n\n"), topic: t } : null;
}

export interface KnowledgePack {
  playbook: string;
  houseView: { content: string; sourceCount: number; lastDistilledAt: string | null } | null;
  operatorLessons: Array<{ scope: string; lesson: string }>;
}

// Assemble the full knowledge pack: the static playbook plus the two LIVE sources
// that grow as Eric teaches the analyst — the distilled House View and the
// operator-taught extraction lessons. Both are best-effort: a database hiccup
// degrades the pack to the playbook rather than failing the request.
export async function buildKnowledgePack(deps: {
  getHouseView: () => Promise<{ content: string; sourceCount: number; lastDistilledAt: string | null }>;
  getActiveLessons: (scope: "all") => Promise<Array<{ scope: string; lesson: string }>>;
}): Promise<KnowledgePack> {
  const [houseView, operatorLessons] = await Promise.all([
    deps.getHouseView().then(hv => (hv.content?.trim() ? hv : null)).catch(() => null),
    deps.getActiveLessons("all").then(rows => rows.map(r => ({ scope: r.scope, lesson: r.lesson }))).catch(() => []),
  ]);
  return { playbook: KPR_PLAYBOOK, houseView, operatorLessons };
}

// Render the pack as one markdown document — what an MCP client actually reads.
export function renderKnowledgePack(pack: KnowledgePack): string {
  const parts = [pack.playbook];
  if (pack.houseView) {
    parts.push(
      `\n## The House View — how this team actually underwrites\n` +
      `_Distilled from ${pack.houseView.sourceCount} of KPR's own per-deal reviews` +
      `${pack.houseView.lastDistilledAt ? `, last updated ${pack.houseView.lastDistilledAt.slice(0, 10)}` : ""}._\n\n` +
      pack.houseView.content.trim(),
    );
  }
  if (pack.operatorLessons.length) {
    parts.push(
      `\n## Operator-taught rules — HIGHEST PRIORITY\n` +
      `These come from real corrections Eric made after catching mistakes. Follow them ` +
      `exactly, even over the general guidance above if they conflict.\n\n` +
      pack.operatorLessons.map((l, i) => `${i + 1}. ${l.lesson.trim()}${l.scope && l.scope !== "all" ? ` _(${l.scope})_` : ""}`).join("\n"),
    );
  }
  return parts.join("\n");
}
