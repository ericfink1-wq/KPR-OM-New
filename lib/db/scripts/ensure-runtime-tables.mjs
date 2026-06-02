// Provision the tables/columns the app creates at runtime (users, login_events,
// tenant_index extras) directly on the dev database, using node-postgres (always
// available — unlike `psql`). Run from the pull hook so the DEV database matches
// what the app creates in PRODUCTION, which stops Replit's publish diff from
// proposing to DROP these tables from prod on every publish. Purely additive
// (CREATE/ADD ... IF NOT EXISTS); never drops; never fails the pull.
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[ensure-runtime-tables] no DATABASE_URL; skipping");
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: url });

const statements = [
  `CREATE TABLE IF NOT EXISTS users (
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
   )`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires timestamptz`,
  `CREATE TABLE IF NOT EXISTS login_events (
     id text PRIMARY KEY,
     user_id text,
     email text,
     success boolean NOT NULL,
     ip text,
     user_agent text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS lease_start text`,
  `ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS lease_start_date date`,
  `ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS expense_reimbursements double precision`,
  `ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS percentage_rent double precision`,
  `ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS other_rent double precision`,
  `ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS deal_status text`,
];

try {
  for (const s of statements) {
    try { await pool.query(s); }
    catch (e) { console.log("[ensure-runtime-tables] statement skipped:", e.message); }
  }
  console.log("[ensure-runtime-tables] done");
} finally {
  await pool.end();
}
