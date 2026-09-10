# Claude access (MCP) — connecting Claude to the deal library

Plain-English guide. Nothing here needs a terminal unless you want the Claude Code option.

## What this does

It lets Claude read your deal library **live**, in any Claude chat — the desktop app,
claude.ai, or Claude Code. Instead of exporting deals and pasting them in, you just ask:

> "What do we pay Starbucks across the portfolio, and what rolls before 2028?"
> "Compare the in-place rents at Blue Bell Commons to our library medians."
> "Which of our centers have a dark anchor or a co-tenancy clause close to tripping?"

Claude also reads your **underwriting playbook and House View** through the same
connection, so its answers follow KPR's rules (above-market rent is downside, locked
below-market rent is secure income, theaters judged per screen, comps as medians with
n) rather than generic real-estate commentary.

**Claude can only read.** Every tool on this connection is read-only — nothing Claude
does through it can change, delete or re-analyze a deal, and it can't spend AI credits.

## How access is protected

**Only KPR members can connect, using their own credentials.**

The library's normal login is a browser session, which an outside app can't hold. So this
connection has its own door: a long random **access key**. But the key isn't handed out —
it's tied to a person's KPR account:

- **You create your own key**, from inside the app, after signing in with your password and
  authenticator code. There is no way to get one without a live, approved KPR account, and
  no way to create one on someone else's behalf.
- **Every request re-checks the account behind the key.** If that account is suspended,
  un-approved or deleted, the key stops working on the very next request — nothing to
  remember, nothing to clean up. **Removing someone's login removes their Claude access
  with it.**
- A key is **personal**. Passing it to a colleague isn't sharing access, it's lending them
  your identity — and they can make their own in ten seconds.
- Keys are stored scrambled (hashed) — even the database never holds the readable key.
- A key is shown **once**, at creation. Lose it and you make a new one.
- "Turn off" takes effect on the very next request, permanently.
- Admins can see and revoke **everyone's** keys, for oversight.

## Connecting (each person does this themselves)

1. Sign in to the app.
2. Click **Claude access** in the top bar.
3. Name it for the device (e.g. "My laptop"), click **Create key**.
4. Copy the key straight away — it won't be shown again.
5. Pick the tab for how you use Claude and follow the one-step instructions. The panel
   gives you a ready-to-paste config with your key already filled in.

Never send your key to anyone. They make their own.

### The three ways to connect

- **Claude desktop app** — Settings → Connectors → Add custom connector, or paste the
  supplied JSON into `claude_desktop_config.json`.
- **Claude Code** — one `claude mcp add …` command, supplied ready to run.
- **claude.ai** — Settings → Connectors → Add custom connector, using the link that has
  the key built into it. Convenient, but that link *is* the password: only paste it into
  your own Claude settings, never into a chat or an email thread.

## Taking access away

Two ways, and the first is usually automatic:

- **Remove or suspend their KPR account** (Members screen). Every key that account owns
  stops working on the next request. This is the one that matters — offboarding someone
  removes their Claude access without anyone having to remember this feature exists.
- **Claude access → Turn off** next to a specific key, to kill one device without touching
  the person's account. Admins see everyone's keys; members see their own.

Either way the record stays in the "Switched off" list, so you can see who had access and
when it ended.

## What Claude can see

Ten read-only tools:

| Tool | What it returns |
|---|---|
| `library_overview` | Deal counts, states, center types, portfolio totals, field glossary |
| `get_knowledge` | The KPR underwriting playbook + House View + operator-taught rules |
| `search_deals` | Find centers by name, market, anchor, size, occupancy, cap rate |
| `get_deal` | One center in full, including the rent roll and its integrity flags |
| `search_tenants` | Every location of a brand, with rent, SF, dates, sales |
| `comp_benchmark` | The deterministic pricing benchmark for a deal — medians, quartiles, sample size, source mix (and it withholds the figure when the sample is too thin) |
| `brand_lease_terms` | Every lease we hold for a brand + medians/ranges + how often each clause appears — the "does this lease look off?" tool |
| `tenant_benchmarks` | Library medians for rent PSF, sales PSF and store size, by brand |
| `portfolio_analytics` | Lease rollover waterfall, concentration, anchor share, credit mix |
| `sale_comps` | The sale-comp database, tagged by source quality |
| `lease_abstracts` | Reconciled lease terms, options, co-tenancy, kickouts |
| `data_quality` | The deterministic tie-out audit, per deal or portfolio-wide |

## Two sources of truth

KPR also runs an internal system of record for **currently-owned** assets — the live rent
roll and accounting. That system is more current than this website for those centers, so
the rule baked into this connector is:

- **Owned asset → the internal system wins** on live facts (current rent, SF, suite,
  dates, options exercised, occupancy, NOI, opex). Every owned record this connector
  returns carries an `authority` note saying exactly that.
- **This library wins, and is the only source, for everything that system never sees** —
  deals we looked at and passed, live prospects, deals under contract, sold assets, the
  seller-marketed OM figures, the sale comps, the lease abstracts, the cross-deal
  benchmarks, and the underwriting doctrine.
- **On a disagreement**, Claude uses the internal system's number for the owned asset,
  says where each figure came from, and flags the gap — it never averages the two.

Claude does not infer this on its own. The rule is sent to the client on every
connection, repeated in the playbook, and attached to each owned record — so it holds
even in a fresh chat where nobody explained it.

## Also in the repo: a matching skill

`.claude/skills/kpr-deal-library/SKILL.md` teaches Claude how to *use* these tools well
— which one to reach for, and the KPR rules it must not break. Claude Code picks it up
automatically in this repo. To use it elsewhere, upload that folder as a skill in Claude
settings.

## For developers

- Endpoint: `POST /api/mcp` (MCP Streamable HTTP, stateless), auth via
  `Authorization: Bearer <key>`, `X-API-Key`, `/api/mcp/k/<key>`, or `?key=`.
- Code: `artifacts/api-server/src/routes/mcp.ts` (transport + key admin),
  `src/lib/mcpTools.ts` (the tools), `src/lib/mcpKeys.ts` (key store),
  `src/lib/mcpKnowledge.ts` (the playbook — keep in sync with CLAUDE.md's analytical
  heuristics).
- Keys live in `mcp_api_keys` (declared in `lib/db/src/schema/mcpKeys.ts`, runtime-
  provisioned by `ensureMcpKeysTable`). Revocation is a timestamp, never a delete.
- The protocol route is mounted **before** the session/2FA gate (it has its own auth);
  key management is mounted **after** it (admin + 2FA required).
- Rate limit: 120 requests/minute per key.
- Tests: `artifacts/api-server/src/lib/__tests__/mcpAccess.test.ts`.
