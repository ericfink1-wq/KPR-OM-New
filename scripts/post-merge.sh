#!/bin/bash
# Runs on every pull (wired via .replit [postMerge]). Its MOST important job is to
# mirror the tables/columns/indexes the app creates AT RUNTIME onto the DEV database.
#
# WHY: Replit's Publish step diffs DEV against PRODUCTION. Production grows these
# tables the moment a feature is first used; dev only gets them if something puts
# them there. A table that exists only in production reads to that diff as one you
# deleted, so it proposes `DROP TABLE "<t>" CASCADE` — and the rows go with it. That
# is how a live MCP access key was destroyed on 2026-09-10, and it recurs on EVERY
# publish until dev has the table.
#
# ORDER MATTERS. The .replit [postMerge] hook is time-budgeted, so the cheap,
# critical step runs FIRST — before `pnpm install` and the much slower `drizzle push`
# can eat the budget and leave the mirror undone. `pg` resolves from the existing
# node_modules, so this works before install on any repo that has been installed once;
# on a cold clone it fails harmlessly and the post-install retry below covers it.
#
# DELIBERATELY no `set -e`: a hiccup in any step must NEVER skip the ones after it.
node lib/db/scripts/ensure-runtime-tables.mjs || echo "post-merge: pre-install dev DB sync skipped (retried after install)"

pnpm install --frozen-lockfile || pnpm install || echo "post-merge: install issue (non-fatal)"

# Retry after install — covers a cold clone where `pg` wasn't resolvable above.
# Idempotent (everything is CREATE/ADD ... IF NOT EXISTS), so a second run is free.
node lib/db/scripts/ensure-runtime-tables.mjs || echo "post-merge: dev DB sync skipped (non-fatal)"

# Best-effort schema sync for everything declared in drizzle (slowest, least critical —
# the raw-SQL step above already covers the runtime-created tables that publish drops).
pnpm --filter db push || echo "post-merge: drizzle push skipped (non-fatal)"
