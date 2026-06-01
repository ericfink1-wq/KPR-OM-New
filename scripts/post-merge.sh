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
  psql "$DATABASE_URL" <<'SQL' || echo "post-merge: tenant_index column sync skipped (non-fatal)"
ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS lease_start text;
ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS lease_start_date date;
ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS expense_reimbursements double precision;
ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS percentage_rent double precision;
ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS other_rent double precision;
ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS deal_status text;
SQL
fi
