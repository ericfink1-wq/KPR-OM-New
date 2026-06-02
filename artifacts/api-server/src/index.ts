import app from "./app";
import { logger } from "./lib/logger";
import { ensureUsersTable } from "./routes/auth";
import { ensureTenantIndexColumns } from "./lib/tenantIndex";

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

// Allow long-running AI calls (AnalystChat, lookup endpoints) up to 5 minutes.
// The PDF ingest route is not affected since it returns immediately.
server.timeout = 5 * 60 * 1000;
server.keepAliveTimeout = 5 * 60 * 1000;
server.headersTimeout = 5 * 60 * 1000 + 1000;
