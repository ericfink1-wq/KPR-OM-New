import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { ensureUsersTable } from "./routes/auth";
import { ensureTenantIndexColumns } from "./lib/tenantIndex";
import { ensureExtractionLessonsTable } from "./lib/extractionLessons";
import { ensureSessionTable } from "./lib/sessionStore";
import { ensureUploadLogTable } from "./routes/uploadLog";
import { ensureLeaseAbstractsTable } from "./routes/leaseAbstracts";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

// Restore/provision the accounts tables on startup: recreates `users` and
// `login_events` (CREATE TABLE IF NOT EXISTS) and re-seeds the owner admin from
// ADMIN_PASSWORD if they were missing — so a dropped/missing accounts schema is
// healed the moment a healthy build boots, without waiting for a login attempt.
// Best-effort: never crash the server if the database is briefly unreachable.
ensureUsersTable()
  .then(() => logger.info("Accounts tables ensured on startup"))
  .catch((err) => logger.error({ err }, "ensureUsersTable failed on startup (will retry on first auth request)"));

// Provision the runtime-added tenant_index columns on startup too, so the DEV
// database (which only gets them when these run) matches PROD. That keeps
// Replit's publish diff clean and stops it proposing to DROP these columns on
// every publish. Best-effort. Keep in sync with schema/tenantIndex.ts.
ensureTenantIndexColumns()
  .then(() => logger.info("tenant_index columns ensured on startup"))
  .catch((err) => logger.error({ err }, "ensureTenantIndexColumns failed on startup (will retry on first index query)"));

// Provision the operator-taught extraction-lessons table on startup (CREATE
// TABLE IF NOT EXISTS), so DEV matches PROD and Replit's publish diff stays
// clean. Best-effort. Keep in sync with lib/extractionLessons.ts.
ensureExtractionLessonsTable()
  .then(() => logger.info("extraction_lessons table ensured on startup"))
  .catch((err) => logger.error({ err }, "ensureExtractionLessonsTable failed on startup (will retry on first use)"));

// Provision the DB-backed session table before requests need it (best-effort).
ensureSessionTable()
  .then(() => logger.info("session table ensured on startup"))
  .catch((err) => logger.error({ err }, "ensureSessionTable failed on startup (will retry on next boot)"));

// Provision the upload-activity audit log (best-effort).
ensureUploadLogTable()
  .then(() => logger.info("upload_log table ensured on startup"))
  .catch((err) => logger.error({ err }, "ensureUploadLogTable failed on startup (will retry on first use)"));

// Provision the lease-abstracts table on startup, so DEV matches PROD and
// Replit's publish diff stays clean. Best-effort. Keep in sync with
// schema/leaseAbstracts.ts and routes/leaseAbstracts.ts.
ensureLeaseAbstractsTable()
  .then(() => logger.info("lease_abstracts table ensured on startup"))
  .catch((err) => logger.error({ err }, "ensureLeaseAbstractsTable failed on startup (will retry on first use)"));

// Clear ZOMBIE database connections on every boot. A stuck/idle-in-transaction
// connection (left by an earlier hung request, and kept alive across app restarts
// by the managed pooler) holds a row lock on deal_images, which makes every later
// image save (cover / site plan) hang until the client times out. Terminating those
// backends on startup unjams the table — so a redeploy reliably fixes a stuck save.
// Best-effort and self-excluding; never blocks or crashes startup.
pool.query(`
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE pid <> pg_backend_pid() AND datname = current_database()
    AND ( (state = 'idle in transaction' AND now() - state_change > interval '15 seconds')
       OR (state = 'active' AND query ILIKE '%deal_images%' AND now() - query_start > interval '15 seconds') )
`)
  .then((r) => logger.info({ cleared: r.rowCount ?? 0 }, "Cleared stuck DB connections on startup"))
  .catch((err) => logger.error({ err }, "Startup DB-unjam query failed (non-fatal)"));

// Allow long-running AI calls (AnalystChat, lookup endpoints) up to 5 minutes.
// The PDF ingest route is not affected since it returns immediately.
server.timeout = 5 * 60 * 1000;
server.keepAliveTimeout = 5 * 60 * 1000;
server.headersTimeout = 5 * 60 * 1000 + 1000;
