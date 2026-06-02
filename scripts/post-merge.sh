#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Keep the dev database's tenant_index columns in sync with the ones the app
# provisions at runtime (see ensureTenantIndexColumns in api-server). Replit's
# Publish step diffs the DEV database against PRODUCTION; because these columns
# are added at runtime (prod has them) but were missing from the dev DB, Replit
# proposed DROPping them from prod on every publish — and the app just re-added
# them, so it never stopped. Provisioning them on the dev DB here makes the
# dev→prod diff clean. Strictly additive (ADD COLUMN IF NOT EXISTS — never drops)
# and fully tolerant: any failure here must never block a pull.
if [ -n "$DATABASE_URL" ] && command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" <<'SQL' || echo "post-merge: dev DB table/column sync skipped (non-fatal)"
ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS lease_start text;
ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS lease_start_date date;
ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS expense_reimbursements double precision;
ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS percentage_rent double precision;
ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS other_rent double precision;
ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS deal_status text;
-- Auth tables are created at runtime by the app (ensureUsersTable). Mirror them
-- on the dev DB so Replit's publish diff doesn't try to DROP them from prod.
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'pending',
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by text,
  last_login_at timestamptz,
  reset_token_hash text,
  reset_token_expires timestamptz
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires timestamptz;
CREATE TABLE IF NOT EXISTS login_events (
  id text PRIMARY KEY,
  user_id text,
  email text,
  success boolean NOT NULL,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
SQL
fi
