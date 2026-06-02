#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Mirror the tables/columns the app creates at runtime (users, login_events,
# tenant_index extras) onto the DEV database. Replit's Publish step diffs the dev
# database against production; because these are created at runtime (prod has
# them) but were missing from dev, Replit proposed DROPping them from prod on
# every publish. This node script (uses node-postgres, always available — unlike
# psql) makes the dev DB match. Purely additive; never blocks a pull.
node lib/db/scripts/ensure-runtime-tables.mjs || echo "post-merge: dev DB sync skipped (non-fatal)"
