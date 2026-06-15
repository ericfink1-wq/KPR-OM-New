import { pool } from "@workspace/db";

// Diagnostic trace tables (operational telemetry, not deal data): img_trace records
// recent image-save attempts (/api/image-save-diag); upload_trace records per-OM
// extraction timing (/api/upload-timing). They are otherwise created lazily, inline
// in routes/deals.ts and lib/extract.ts, the first time those paths run.
//
// Provisioning them at startup (CREATE TABLE IF NOT EXISTS) makes the DEV database
// match PROD even when those endpoints are never exercised in dev — which keeps
// Replit's publish diff clean and stops it proposing to DROP these runtime-created
// tables on every publish. Best-effort and idempotent. The column definitions MUST
// stay identical to the inline creates in routes/deals.ts and lib/extract.ts and to
// schema/deals.ts (imgTraceTable / uploadTraceTable).
let ready: Promise<void> | null = null;
export function ensureTraceTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS img_trace (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS upload_trace (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL)`);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}
