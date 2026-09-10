// Provision the tables/columns/indexes the app creates at runtime directly on the
// DEV database, using node-postgres (always available — unlike `psql`). Run from the
// pull hook so DEV matches what the app creates in PRODUCTION.
//
// WHY THIS FILE IS LOAD-BEARING: Replit's publish step diffs the DEV database against
// PRODUCTION. A table (or index) that exists only in prod looks to that diff like
// something you deleted, so it proposes `DROP TABLE "<t>" CASCADE` — and the data goes
// with it. That is not hypothetical: mcp_api_keys was missing from this list, the diff
// proposed the drop on 2026-09-10, it was approved, and a live Claude access key was
// destroyed. EVERY table the app creates at runtime must be listed below, or it is a
// standing candidate for deletion on the next publish.
//
// schemaRuntimeDrift.test.ts fails if a runtime-created table is missing from here.
// Purely additive (CREATE/ADD ... IF NOT EXISTS); never drops; never fails the pull.
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[ensure-runtime-tables] no DATABASE_URL; skipping");
  process.exit(0);
}

// Bounded connect + per-statement timeouts: this runs from `postinstall` as well as the
// pull hook, so an unreachable database must never hang an install or a deployment build.
const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000, statement_timeout: 15000 });

// PROVE the database is reachable ONCE, and bail out if it is not. Without this the
// script degrades badly instead of failing fast: every statement below would open its
// own connection, wait out the full connect timeout and be caught by its own try/catch,
// so an unreachable host costs (statements x timeout) — minutes of a hung install rather
// than five seconds. Measured, not theorised: this path hung past 120s before the guard.
try {
  const probe = await pool.connect();
  probe.release();
} catch (e) {
  console.log("[ensure-runtime-tables] database unreachable; skipping:", e.message);
  await pool.end().catch(() => {});
  process.exit(0);
}

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
  // DB-backed login sessions (connect-pg-simple) — added later, so the dev DB
  // must learn about it too or Replit's publish keeps proposing to DROP it.
  `CREATE TABLE IF NOT EXISTS "session" (
     "sid" varchar NOT NULL PRIMARY KEY,
     "sess" json NOT NULL,
     "expire" timestamp(6) NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`,
  // Operator-taught extraction rules ("Teach the extractor").
  `CREATE TABLE IF NOT EXISTS extraction_lessons (
     id text PRIMARY KEY,
     scope text NOT NULL DEFAULT 'all',
     lesson text NOT NULL,
     active boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now(),
     created_by text
   )`,
  // MCP access keys (Claude connector credentials). THIS ONE BIT US: it was missing
  // here, so dev never had the table, the publish diff saw it only in production, and
  // it proposed `DROP TABLE "mcp_api_keys" CASCADE` — destroying a live access key.
  // Its indexes matter too; an index present in prod but not dev is dropped the same way.
  `CREATE TABLE IF NOT EXISTS mcp_api_keys (
     id text PRIMARY KEY,
     user_id text,
     name text NOT NULL,
     key_hash text NOT NULL,
     key_prefix text NOT NULL,
     scope text NOT NULL DEFAULT 'read',
     created_at timestamptz NOT NULL DEFAULT now(),
     created_by text,
     created_by_email text,
     last_used_at timestamptz,
     use_count integer NOT NULL DEFAULT 0,
     expires_at timestamptz,
     revoked_at timestamptz,
     revoked_by text
   )`,
  `ALTER TABLE mcp_api_keys ADD COLUMN IF NOT EXISTS user_id text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mcp_api_keys_hash_idx ON mcp_api_keys (key_hash)`,
  `CREATE INDEX IF NOT EXISTS mcp_api_keys_user_idx ON mcp_api_keys (user_id)`,
  // Executed lease abstracts + REA/OEA site agreements (per deal).
  `CREATE TABLE IF NOT EXISTS lease_abstracts (
     id text PRIMARY KEY,
     deal_id text NOT NULL,
     tenant_name text NOT NULL,
     data jsonb NOT NULL,
     version integer NOT NULL DEFAULT 1,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS site_agreements (
     id text PRIMARY KEY,
     deal_id text NOT NULL,
     agreement_name text NOT NULL,
     data jsonb NOT NULL,
     version integer NOT NULL DEFAULT 1,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  // Retailer watchlist + its news scanner.
  `CREATE TABLE IF NOT EXISTS retailer_watchlist (
     id text PRIMARY KEY,
     brand text NOT NULL,
     status text NOT NULL,
     note text,
     source_url text,
     added_by text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS watchlist_news_signals (
     brand_norm text PRIMARY KEY,
     brand text NOT NULL,
     suggested_status text,
     exceeds_current boolean NOT NULL DEFAULT false,
     headline text,
     url text,
     headline_at timestamptz,
     scanned_at timestamptz NOT NULL DEFAULT now()
   )`,
  // Self-improvement loop: the daily run marker + the audit metrics trend.
  `CREATE TABLE IF NOT EXISTS self_improve_runs (
     kind text PRIMARY KEY,
     last_run date NOT NULL DEFAULT now(),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS audit_history (
     day date PRIMARY KEY,
     deals_with_issues integer NOT NULL DEFAULT 0,
     total_issues integer NOT NULL DEFAULT 0,
     deals_scanned integer NOT NULL DEFAULT 0,
     breakdown jsonb,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  // The distilled analyst "house view" (single row).
  `CREATE TABLE IF NOT EXISTS analyst_house_view (
     id integer PRIMARY KEY DEFAULT 1,
     content text NOT NULL DEFAULT '',
     source_count integer NOT NULL DEFAULT 0,
     pending_reviews integer NOT NULL DEFAULT 0,
     last_distilled_at timestamptz,
     updated_at timestamptz NOT NULL DEFAULT now(),
     updated_by text
   )`,
  // Upload history + the two diagnostic ring buffers.
  `CREATE TABLE IF NOT EXISTS upload_log (
     id text PRIMARY KEY,
     file_name text,
     doc_type text,
     status text NOT NULL,
     detail text,
     deal_id text,
     user_id text,
     user_email text,
     user_name text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS img_trace (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS upload_trace (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL)`,
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
