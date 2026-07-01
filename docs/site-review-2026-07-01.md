# KPR Deal Library — Full Site Review (July 1, 2026)

A top-to-bottom review of the app as an institutional shopping-center analyst would see it:
what's already strong, what's missing, and the highest-impact builds — layout, data analysis,
OM extraction, and self-learning. Ordered by impact.

---

## Where the site stands today (honest verdict)

The **data plumbing is genuinely institutional-grade** — better than most real acquisition
shops have internally: 28 deterministic audit checks that run on every write, a self-healing
daily sweep, operator-taught extraction lessons, recency-weighted tenant benchmarks, a tiered
comps database with a deterministic benchmark engine, co-tenancy cascade modeling, per-state
closing-cost and tax-reassessment engines, and an IC memo generator.

The two big gaps, in one sentence each:

1. **The analysis stops at "what is" and never gets to "what could be."** The site describes
   a deal precisely (rent, WALT, occupancy, flags) but never builds the value-creation story —
   where NOI goes over the hold, what the upside is worth, and what price makes the deal work.
   That's the analysis an IC actually debates.
2. **The site computes far more than it shows.** There is exactly one chart in the whole app
   (the lease rollover bar chart). Mark-to-market gaps, concentration, credit mix, tenant mix,
   comps trends — all computed, all rendered as text and tables. Eric's own words: "lots of
   text will get lost with my team."

Everything below is organized around closing those two gaps, plus extraction and data-quality
upgrades.

---

## TIER 1 — The five highest-impact builds

### 1. The NOI Bridge — the missing centerpiece (deal page + IC memo)

The single most valuable thing a shopping-center analyst produces is the walk from
**in-place NOI to stabilized NOI**:

```
In-place NOI
  + mark-to-market capture on near-term rollover (already computed in MarkToMarket.tsx!)
  + vacancy lease-up at market rent (vacant suites × benchmark rent for that size/center)
  − downtime, TI/LC drag (simple assumptions: 9 mo downtime, $30–50 PSF TI on new leases)
  = Stabilized NOI
  → at exit cap = stabilized value → value creation vs asking price
```

Every input already exists in the data model: the roster with vacant suites, the tenant
rent benchmarks (median rent PSF per brand/size), lease expiries, the asking price. This is
deterministic (zero tokens), and it converts the library from a *descriptive* tool into an
*underwriting* tool. Render it as a waterfall chart (Recharts is already installed) on the
deal page and in the IC memo. This is the #1 recommendation.

### 2. Renewal-option overhang — upside that isn't really there

**This is the classic shopping-center trap the site currently can't see.** A tenant at $8/SF
against a $14 market looks like upside in Mark-to-Market — but if that tenant holds
4 × 5-year options at $8.50 fixed, the upside is locked away for 20 years. Right now
`renewalOptions` is captured as free text and never parsed, so the MTM panel **systematically
overstates upside** on deals with cheap options.

- At extraction: structure options as `{count, termYears, rentPSF or bump%, type: fixed/FMV/CPI}`
  (keep the free-text as backup).
- In analysis: split rollover into **"free" rollover** (no options, or FMV options — landlord
  can mark to market) vs **"encumbered" rollover** (fixed-rate options below market). MTM
  upside only counts the free portion; flag the encumbered portion as a red flag when the
  option rent is >15% below market.
- Bonus signal in reverse: fixed options **above** today's market rent = embedded rent growth
  a buyer gets paid for. Worth a strength bullet.

### 3. Renewal probability from occupancy cost — make the rollover chart intelligent

The rollover chart shows *when* leases expire but not *whether the tenant will stay*. The
strongest single predictor in retail is **occupancy cost ratio** (already captured/computed):

- Occ cost < 8% for inline (< 3% for anchors): tenant is healthy and cheap → near-certain
  renewal, and the landlord has pricing power at the bump.
- Occ cost 12–15%+: renewal risk; expect a fight or a vacancy.
- No sales data: fall back to credit + watchlist + category resilience (all already exist).

Color the rollover bars by renewal risk (green/yellow/red stacks), and produce one number per
deal: **"rent at genuine risk in the next 36 months"** — expiring rent × non-renewal
probability. That's a better risk metric than WALT and it feeds the NOI bridge's downtime
assumptions. Deterministic, zero tokens.

### 4. "What must I believe" — bid solver + sensitivity grid

Underwriting in reverse, on the deal page:

- **Sensitivity grid:** a small matrix — exit cap (±100 bps) × rent growth / MTM capture —
  showing IRR or equity multiple in each cell, using the deal's actual NOI, price, and the
  debt fields the site already captures (loan rate/LTV or the acq/debt underwriting fields).
- **Bid solver:** "to hit a 15% IRR / 1.8x with these assumptions, the max price is $X
  (cap rate Y)." Solve deterministically.

This respects the stated direction — not full Argus DCF, just the smart, fast math an
acquisitions officer does on a napkin, done instantly and consistently on every deal. Also
belongs in the IC memo ("price needed to clear our hurdle: $X vs ask $Y").

### 5. Portfolio tenant stress test — "Joann just filed"

The per-deal co-tenancy cascade already exists (CoTenancyCascade/LeaseRiskPanel). Lift it to
the portfolio: pick any tenant or parent company → across every owned/pipeline deal show
**total rent at risk = direct rent + co-tenancy knock-on exposure** (kickouts and rent
reductions triggered if that tenant goes dark), per deal and summed. One screen answers the
question every retail owner asks the morning a chain files Chapter 11. All the data exists;
this is an aggregation + UI job. Pair it with the watchlist so watchlisted tenants show their
portfolio-wide blast radius automatically.

---

## TIER 2 — Analysis & intelligence upgrades

### 6. Thread the captured-but-unused fields into the analysis
The extraction captures several fields that never influence a score, flag, or narrative:

| Field | What it should do |
|---|---|
| `parkingRatio` / `parkingSpaces` | Flag vs center-type norm (grocery-anchored wants ~4–5/1,000 SF). Under-parked = operating risk; massively over-parked = pad-site clue (see #7). |
| `trafficCountVPD` | Fold into the location-quality signal alongside population/income (a 45k VPD corner vs a 8k VPD side street is a different asset). |
| `population1mi` / `population5mi` | Use the *gradient*: steep 1-mi density = true infill; flat 1→5mi = commodity suburban. Better than 3-mi alone. |
| `leaseStart` | Lease *vintage* analysis: rents signed 2020–2021 are systematically below today's market; a roster full of COVID-vintage leases is an MTM story. Also enables "recent leasing spread" (newest leases' rent vs older ones — the OM's own proof of market rent). |
| `lotSizeAcres` + `zoning` | See #7. |
| `assumableDebt` / `loanRate` | When assumable below-market debt exists, that's a headline strength (positive leverage day one) — should appear in the grade and memo. |
| `cashFlowProjection` | Currently only used for tie-out audits. Extract the OM's implied growth rate (Yr1→Yr5 NOI CAGR) and flag when the broker's growth assumption is aggressive vs the roster's contractual bumps. That's a genuinely dynamic "call the broker's bluff" check. |

### 7. Pad-site / excess-land detector (something you likely haven't thought of in-app)
Compute a rough **site coverage ratio**: `totalSF ÷ (lotSizeAcres × 43,560)`. Shopping centers
typically run 20–30% coverage. When coverage is **well under ~18%** AND traffic count is
healthy, flag *"possible excess land / pad development opportunity — verify against site
plan."* Outparcel creation is one of the highest-return value levers in this asset class and
brokers routinely under-market it. Deterministic, data already captured.

### 8. Unified tenant health score → deal income-durability score
The pieces all exist as separate flags (sales trend, occupancy cost, credit/IG, watchlist,
dark flag, category e-commerce resilience, size-vs-prototype). Combine them into one 0–100
**tenant health score** shown as a colored chip in the roster, then roll up rent-weighted to a
**deal income durability score** next to the deal grade. One glance = "how safe is this rent
stream." This is also the score that should color the rollover chart (#3).

### 9. Anchor productivity vs viability thresholds
The brand-median benchmark says how a grocer compares to *itself elsewhere in the library*.
Add category viability floors (codified constants, not AI): conventional grocers below roughly
$400–450/SF are vulnerable; a grocer at $650+/SF anchors the center for a decade. Same for
warehouse clubs, discounters, gyms (members ≠ PSF), theaters (per-screen). Surface as
"anchor health" in the exec band — for a grocery-anchored strategy this is *the* number.

### 10. Broker/seller calibration index (self-learning you haven't tapped)
The sale-lookup feature already finds what pipeline deals actually traded for. Aggregate it:
**by broker and by market, the median spread between OM ask (or whisper cap) and achieved
price/cap.** After 50 lookups the library literally knows "this shop's pricing guidance runs
40 bps tight." Show it as a badge on new deals from that broker, and feed
`groundTruthCalibration` (which already exists in the roster-analysis prompt) with it. No
other buyer has this — it's the compounding advantage of the library.

### 11. Comps intelligence: trend + spread context
The comps benchmark returns medians for a point in time. Add: (a) a **cap-rate-over-time
scatter/trend** for the filtered segment (grocery-anchored vs power vs unanchored strip), and
(b) **spread vs the 10-year Treasury** at sale date (RatesPanel already exists) — cap rates
only mean something relative to rates. "Grocery-anchored trading 250 bps over the 10-yr,
tightest since 2024" is an institutional sentence the site could generate deterministically.

### 12. Debt-aware risk (for owned + underwritten deals)
Two cheap, high-value checks: (a) **rollover inside the loan term** — % of rent expiring
before loan maturity (a 2028 maturity with 40% of rent rolling in 2027 is a refinance story,
flag it); (b) a simple **DSCR now vs stressed** (NOI −10% / rate +200 bps at refi). Plus a
portfolio **maturity wall** bar chart (loan balances by maturity year).

---

## TIER 3 — Layout & visual layer

The app computes charts' worth of data and renders text. Recharts is already a dependency —
each of these is an afternoon, not a project (all must reflow on mobile per the cardinal rule):

13. **MTM dot plot** — every tenant as a dot: in-place rent vs brand-median market rent,
    sized by SF, colored by gap. Instantly shows where the upside lives. (Data: MarkToMarket
    already computes it.)
14. **Portfolio rollover heatmap** — deals × years grid, cell color = % of that deal's rent
    expiring. The whole portfolio's lease risk on one screen.
15. **Tenant-mix treemap** per deal — GLA by category (retailCategory.ts already classifies),
    colored defensive → discretionary. The "is this center Amazon-proof" picture.
16. **NOI bridge waterfall** (from #1) on the deal page and in the IC memo PDF.
17. **Concentration donut + credit mix ring** on Portfolio Analytics (currently text/bars).
18. **Map view** — portfolio + pipeline + comps pins (lat/long already geocoded via
    `marketGeo`). Include 3-mi trade-area circles for owned assets: overlapping circles =
    cannibalization/synergy check when underwriting a deal near an owned center — another one
    brokers won't volunteer.
19. **Deal verdict block** — at the top of the AI tab, a fixed-format card: grade, 3 reasons
    to buy, 3 reasons to pass, top 3 diligence items, and (from #4) the bid range that clears
    the hurdle. The long narrative stays below for those who read. This is the "my team won't
    read text" fix, extended from the exec stat band to the *judgment* itself.
20. **"What changed" strip on home** — deals whose flags/score/data changed in the last 7
    days ("Analysis refreshed", "New sales data", "Audit flag added"). Makes the library feel
    alive and tells the team what to look at today.
21. **Flag language consistency** — one severity scale (color + icon + one-line "so what")
    across all 19 flag types, audit checks, and AI red flags. Today they're visually
    different species; a shared chip design makes the risk surface scannable.

---

## TIER 4 — OM extraction & data-quality upgrades

22. **Page-cited provenance for headline numbers.** Have extraction return
    `{"noi": 2100000, "_cite": {"noi": "p.14 Financial Summary"}}`-style citations for the
    ~8 headline fields (NOI, cap, price, GLA, occupancy, GPR, taxes, WALT). Import Review then
    shows the citation next to each number → verification becomes a 5-second glance instead of
    a PDF hunt. Also makes the second-reader's disagreements resolvable instantly.
23. **Golden-set extraction eval.** Keep 10–15 hand-verified OM→JSON pairs in the repo
    (`samples/`); a script scores any prompt change against them (field accuracy, roster
    completeness, tie-out pass rate). Right now prompt edits ship on faith; this makes
    extraction quality *measurable* — the missing piece of the self-improvement loop.
24. **Structure the option/bump data** (needed for #2): `renewalOptions` and `rentSchedule`
    → structured arrays at extraction, with dates and dollars, not prose.
25. **Capture the OM's underwriting assumptions**: pro-forma growth rate, market-rent
    assumption for vacancy, TI/LC and downtime assumptions when stated, expense-recovery
    ratio. These are what you negotiate against — and they feed #6's "broker growth bluff"
    check and #1's bridge defaults.
26. **New deterministic audit checks** (extending the suite per the standing instruction):
    - Rent-schedule monotonicity: steps should not go *down* mid-term (OCR column slip).
    - Percentage-rent natural breakpoint: breakpoint ≈ base rent ÷ rate; a big deviation
      means a mis-read (or a genuinely unnatural breakpoint worth flagging).
    - Expense ratio vs center-type band (NNN strip should run ~15–25% of EGI; 45% is a
      mis-read or a story).
    - Tax math: currentAnnualTaxes ≈ assessed × implied rate; catches decimal slips.
    - Sales staleness: `salesYear` more than 2 years before the OM date → "stale sales" flag.
    - Duplicate-deal guard at import: normalized address match against the library.
27. **Site-plan cross-check (ambitious but killer):** run the site-plan image through vision
    extraction for suite→tenant labels and diff against the roster. Catches the exact class of
    miss (dropped/mislabeled suites) that caused past bugs — from a *second source*, which is
    what makes audits strong.

---

## TIER 5 — Reports & workflow

28. **Weekly pipeline digest** (auto-generated, deterministic): new deals in, status changes,
    flags raised, upcoming critical dates, stale-analysis count — one page, emailable/PDF.
29. **IC memo visuals**: fold the NOI bridge, rollover chart, and mix treemap into the PDF
    memo — one page of charts + one page of text is the institutional standard.
30. **Retail news watch**: a scheduled sweep (web search) for portfolio + watchlist tenants —
    bankruptcy filings, closure lists, M&A — appended to the watchlist with dates/sources.
    Token-costed, so weekly and only for tenants actually in the library.

---

## Suggested build order

| Phase | Items | Why first |
|---|---|---|
| 1 | #1 NOI bridge, #3 renewal-risk rollover, #13/#16 their charts | Turns the site from descriptive to underwriting; all deterministic |
| 2 | #2 option overhang (extraction + analysis), #22 citations, #24 structured options | Fixes the one place current analysis is actually *wrong* (overstated MTM) |
| 3 | #4 bid solver + sensitivity, #19 verdict block | The IC conversation on one screen |
| 4 | #5 portfolio stress test, #18 map, #14 heatmap | Portfolio-level intelligence |
| 5 | #10 broker calibration, #23 eval harness, #26 new audits | Compounding self-learning |

Everything in Tiers 1–3 is deterministic (no per-deal token cost) except where noted, and all
of it rides on data the extraction already captures — which is the strongest sign the
foundation was built right.
