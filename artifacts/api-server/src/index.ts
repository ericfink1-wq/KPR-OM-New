import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { runStartupSequence } from "./lib/startup";
import { ensureRateCurvesTable, refreshSwapCurves } from "./lib/rateCurves";
import { ensureUserPrefsTable } from "./lib/userPrefs";
import { ensureAssetMgmtTables, healSwapTermsPending } from "./lib/assetMgmt";
import { ensureUsersTable } from "./routes/auth";
import { ensureTenantIndexColumns } from "./lib/tenantIndex";
import { ensureExtractionLessonsTable } from "./lib/extractionLessons";
import { ensureSessionTable } from "./lib/sessionStore";
import { ensureUploadLogTable } from "./routes/uploadLog";
import { ensureLeaseAbstractsTable } from "./routes/leaseAbstracts";
import { ensureSiteAgreementsTable } from "./routes/siteAgreements";
import { ensureTraceTables } from "./lib/traceTables";
import { ensureHouseViewTable } from "./lib/houseView";
import { ensureMcpKeysTable } from "./lib/mcpKeys";
import { startSelfImproveScheduler } from "./lib/selfImprove";
import { applyRecordedSales, addMissingProperties, applySingleTenantProperties, applyAnsweredRecourse } from "./lib/recordedSales";
import { purgePendingSaleData } from "./lib/pendingSale";
import { runFailedUploadCleanup } from "./lib/failedUploadCleanup";
import { retireSupersededOms } from "./lib/supersededOms";
import { sweepOmDates, sweepPropertyHistory } from "./lib/omDateSweep";
import { runCompsCleanupIfNeeded, runCompDedupe } from "./routes/comps";
import { startAnalysisAutoRefresh, sweepAnalysisGuardrails } from "./lib/analysisAutoRefresh";

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
  // Everything below runs ONE AT A TIME, after the server is already answering (the
  // healthcheck never waits on it). See lib/startup.ts for why.
  const log = (msg: string) => (r: unknown) => { if (r) logger.info({ result: r }, msg); };
  void runStartupSequence([
    // Clear ZOMBIE database connections. A stuck/idle-in-transaction connection (left by an
    // earlier hung request, and kept alive across restarts by the managed pooler) holds a
    // row lock on deal_images, which makes every later image save hang. Self-excluding.
    { name: "unjam stuck connections", run: () => pool.query(`
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE pid <> pg_backend_pid() AND datname = current_database()
          AND ( (state = 'idle in transaction' AND now() - state_change > interval '15 seconds')
             OR (state = 'active' AND query ILIKE '%deal_images%' AND now() - query_start > interval '15 seconds') )
      `).then(r => log("Cleared stuck DB connections")(r.rowCount || null)) },
    // Runtime-created tables (so DEV matches PROD and the publish diff never proposes a
    // DROP — see CLAUDE.md). Accounts + sessions first: sign-in depends on them.
    { name: "users table", run: () => ensureUsersTable() },
    { name: "session table", run: () => ensureSessionTable() },
    { name: "tenant_index columns", run: () => ensureTenantIndexColumns() },
    { name: "extraction_lessons table", run: () => ensureExtractionLessonsTable() },
    { name: "upload_log table", run: () => ensureUploadLogTable() },
    { name: "lease_abstracts table", run: () => ensureLeaseAbstractsTable() },
    { name: "site_agreements table", run: () => ensureSiteAgreementsTable() },
    { name: "trace tables", run: () => ensureTraceTables() },
    { name: "house view table", run: () => ensureHouseViewTable() },
    { name: "mcp_api_keys table", run: () => ensureMcpKeysTable() },
    { name: "rate_curves table", run: () => ensureRateCurvesTable() },
    { name: "user_prefs table", run: () => ensureUserPrefsTable() },
    { name: "asset mgmt tables", run: () => ensureAssetMgmtTables() },
    { name: "swap terms-pending heal", run: () => healSwapTermsPending().then(log("Re-derived swap terms-pending flags")) },
    // One-time / idempotent data jobs.
    { name: "failed-upload cleanup", run: () => runFailedUploadCleanup().then(plan => log("Failed-upload cleanup done")(plan.filter(a => a.kind !== "keep").length || null)) },
    { name: "write-up guardrails", run: () => sweepAnalysisGuardrails().then(log("Applied write-up guardrails to stored analyses")) },
    { name: "comp clean-up", run: () => runCompsCleanupIfNeeded().then(r => log("Comp clean-up applied")(r.applied ? r : null)) },
    { name: "comp duplicate merge", run: () => runCompDedupe(true).then(r => log("Merged duplicate comps")(r.applied ? { groups: r.groups, removed: r.removed, examples: r.examples } : null)) },
    { name: "OM dates", run: () => sweepOmDates() },
    { name: "superseded OMs", run: () => retireSupersededOms().then(log("Retired superseded OMs")) },
    { name: "property history", run: () => sweepPropertyHistory() },
    { name: "pending-sale purge", run: () => purgePendingSaleData().then(log("Deleted stored pending-sale data")) },
    { name: "missing properties", run: () => addMissingProperties().then(log("Added missing owned/sold properties")) },
    { name: "single-tenant owned properties", run: () => applySingleTenantProperties().then(log("Filled single-tenant rosters")) },
    { name: "answered recourse questions", run: () => applyAnsweredRecourse().then(log("Resolved answered recourse questions")) },
    { name: "recorded sales", run: () => applyRecordedSales().then(log("Recorded confirmed sale closings")) },
    // SOFR swap curves from DTCC (newest day + 12 month-ends for the sparkline). Last, and
    // time-boxed: it downloads public files, so it never holds up the jobs above.
    { name: "swap curves", run: () => refreshSwapCurves(60_000, true).then(r => log("Swap curves refreshed")(r.eodIngested || r.intradaySlices ? r : null)) },
  ], logger).then(() => {
    // Every 15 minutes (only effective where the host keeps running between requests — on
    // autoscale the rates request and the app's refresh step top it up instead).
    setInterval(() => { void refreshSwapCurves(30_000); }, 15 * 60_000).unref?.();
    // Recurring work starts only once the one-time jobs are finished.
    startSelfImproveScheduler();
    startAnalysisAutoRefresh();
  });
});

// Allow long-running AI calls (AnalystChat, lookup endpoints) up to 5 minutes.
// The PDF ingest route is not affected since it returns immediately.
server.timeout = 5 * 60 * 1000;
server.keepAliveTimeout = 5 * 60 * 1000;
server.headersTimeout = 5 * 60 * 1000 + 1000;
