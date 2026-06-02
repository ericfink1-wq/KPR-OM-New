#!/bin/bash
# Runs on every pull (wired via .replit [postMerge]). Its MOST important job is to
# mirror the tables/columns the app creates at runtime (session, users,
# login_events, extraction_lessons, tenant_index extras) onto the DEV database —
# Replit's Publish step diffs dev vs production and, if dev is missing one of
# these, proposes DROPping it from prod on every publish (e.g. dropping the login
# `session` table, which logs everyone out).
#
# DELIBERATELY no `set -e`: a hiccup in install or drizzle push must NEVER skip
# the provisioning below. Each step is independent and non-fatal. Install runs
# first (the node script needs `pg`), then the raw-SQL provisioning (always
# works), then drizzle push as a best-effort schema sync.
pnpm install --frozen-lockfile || pnpm install || echo "post-merge: install issue (non-fatal)"
node lib/db/scripts/ensure-runtime-tables.mjs || echo "post-merge: dev DB sync skipped (non-fatal)"
pnpm --filter db push || echo "post-merge: drizzle push skipped (non-fatal)"
