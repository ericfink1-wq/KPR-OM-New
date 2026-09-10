// The KPR analyst playbook — the standing, hard-won reasoning rules that make this
// library's analysis KPR's analysis rather than generic CRE commentary.
//
// This is the "knowledge" half of the MCP server: the tools hand an outside Claude
// the DATA, and this hands it the JUDGMENT to read that data the way the team does.
// It is deliberately static text (token-free, no model call) and is combined at
// request time with the two LIVE knowledge sources — the operator-taught extraction
// lessons table and the distilled House View — by buildKnowledgePack() below.
//
// KEEP IN SYNC with the "Analytical heuristics" and extraction rules in CLAUDE.md:
// when Eric teaches a new market heuristic there, mirror it here so it reaches the
// outside clients too.

export const KPR_PLAYBOOK = `# KPR Centers — retail underwriting playbook

You are reading the KPR Centers deal library. KPR acquires **retail shopping centers**
— not residential, not raw land, not office. Read every deal through a shopping-center
lens: anchor quality, inline health, tenant sales, rollover, trade area.

## Which source of truth wins
KPR runs a **separate internal system of record for currently-owned assets** (live rent
roll and accounting). Where that connector is available, it is authoritative for live
owned-asset facts and OVERRIDES this library: current rent, SF, suite, commencement and
expiry, options already exercised, current occupancy, NOI, opex. What this library holds
for an owned center is the acquisition-era snapshot — accurate as of the documents it was
built from, potentially stale today. Owned records returned by these tools carry an
\`authority\` note saying exactly this.

This library is authoritative — and is the only source at all — for everything that
system never sees: deals KPR evaluated and passed on, live prospects, deals under
contract, sold assets, the seller-marketed OM figures, the sale-comp database, the lease
abstracts stored here, the cross-deal benchmarks, and the underwriting doctrine below.
A brand benchmark spans the WHOLE library, so it stays the right comparison set even when
one owned location's own current rent should come from the internal system.

On a disagreement about an owned asset: use the internal system's figure, name the source
of each number, and flag the gap. Never average the two and never silently pick one.

## Cardinal rule: accuracy over speed
Never fabricate a precise-looking figure. When a number can't be verified from the
data returned by these tools, say so and leave it blank. A confidently-worded wrong
number is far more dangerous than an honest "not captured — verify."

## Field conventions you must respect
- \`annualRent\` is **base rent only**. Recoveries live in separate fields
  (\`expenseReimbursements\` = CAM+tax+insurance, \`percentageRent\`, \`otherRent\`) and are
  only populated when the source document disclosed them. Absent = null, not zero.
- \`propertyName\` (never "dealName"). Dates are ISO \`YYYY-MM-DD\`.
- **Occupancy cost** = (base + reimbursements + % rent + other) ÷ gross sales, and only
  when those components are disclosed. NEVER base ÷ sales. Never guess it.
- **WALT** is weighted by SF against lease expiry dates.
- KPR's own underwriting lives ONLY in the \`acq*\`, \`debt*\`, \`pref*\`, \`txn*\`, \`disp*\`
  fields — never folded into the OM-stated display fields. Don't confuse the seller's
  marketed numbers with KPR's underwriting.
- \`isNAP\` means a parcel KPR does not own. A 0-SF income lease (ATM, ground lease, pad,
  billboard) is NOT NAP — it pays rent that belongs in the rent roll-up.
- \`isDark\` means the store is closed but the lease is still paying. Dark anchors are a
  headline risk even while rent is current.
- EGI above GPR is **normal** in retail (recoveries). Never flag it.
- Cap rate and asking price are absent on roughly 95% of these OMs — retail centers are
  frequently marketed unpriced. That is expected, not a data defect.

## Above-market rent is DOWNSIDE, never "upside"
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

## Co-tenancy triggers: be exact, never collapse them
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
abstract are cross-checks, never sources. \`verifiedAgainstExecutedDoc: false\` on a field
means exactly that — treat it as unverified and say so. Never state an ambiguous clause
as settled fact; flag it for counsel instead. This matters most for purchase options,
ROFR/ROFO, co-tenancy and kickout triggers, exclusives, termination rights, and guaranty
scope.

## Comps: narrate, never re-derive
The app computes all comp statistics in code. Report the structured benchmark output as
given — medians (never means), with n and the date range always stated. Source quality
runs owned (KPR's verified trades) > broker/manual > OM-sourced (seller-cherry-picked,
the weakest). Below the minimum sample the benchmark is "insufficient" — suppress the
verdict rather than reaching for a number.

## Tie-outs that must hold
When you see two figures that must agree, check them: Σ occupied SF + Σ vacant SF =
total GLA; occupied ÷ total = stated occupancy; Σ occupied base rent = gross potential
rent; EGI − OpEx = NOI; NOI ÷ cap = price. A contradiction is a real finding worth
raising. An absent value is just absent — not a contradiction.
`;

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
