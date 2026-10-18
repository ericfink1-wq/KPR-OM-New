import { db, dealsTable } from "@workspace/db";
import { JSON_REPAIR_VERSION } from "./jsonRepair";
import { sql } from "drizzle-orm";
import { updateDealSafely } from "./dealWrite";
import type { Logger } from "pino";
import { logger } from "./logger";
import { BUILD_COMMIT } from "./buildInfo";
import { startupComplete, startupStepRunning } from "./startup";
import { ANALYSIS_VERSION } from "./analysisVersion";
import { submitStaleAnalysisBatch, applyAnalysisBatchResults } from "../routes/deals";

// ONE-TIME AUTOMATIC RE-ANALYSIS for the v4 rules (Eric, 10/17/26: "re-run analysis on all
// deals with the new rules. Batch mode is fine."). Normally a version bump only lights the
// "outdated" badge and a person chooses to spend the tokens; Eric asked for this one to just
// happen. So it is pinned to ONE version: a later bump does NOT auto-spend unless someone
// deliberately moves AUTO_REFRESH_FOR_VERSION too.
//
// State lives on the deals themselves (no new table): `analysisBatchPending` = the batch a
// deal was sent in; `analysisAutoTries` = { v, n } attempts at this version. A deal is sent
// at most MAX_TRIES times, so one that keeps failing can never loop the token spend.
export const AUTO_REFRESH_FOR_VERSION = 4;
const MAX_TRIES = 2;
const EVERY_MS = 15 * 60_000;

// Autoscale hosting only gives the server CPU while it is answering a request, so a
// background timer barely runs and a long apply gets cut off (10/17/26: the batch was
// submitted live but nothing was ever applied). The work is therefore done in
// REQUEST-SIZED SLICES: the open app calls POST /analysis-refresh/tick every couple of
// minutes while there is work, each slice applies as many finished results as fit in its
// time budget, and each applied deal drops its marker so the next slice resumes there.
export interface RefreshTick { at: string; action: string; batchId?: string; status?: string; applied?: number; failed?: number; remaining?: number; error?: string }
let lastTick: RefreshTick | null = null;

async function tick(log: Logger, budgetMs = 45_000): Promise<RefreshTick> {
  const at = new Date().toISOString();
  if (ANALYSIS_VERSION !== AUTO_REFRESH_FOR_VERSION) return { at, action: "off (version not pinned for auto-refresh)" };
  if (!process.env.ANTHROPIC_API_KEY) return { at, action: "off (no ANTHROPIC_API_KEY)" };
  // 1) A batch in flight → apply what fits in this slice once it has ended.
  const pending = await db.execute(sql`SELECT DISTINCT data->>'analysisBatchPending' AS b FROM deals WHERE data ? 'analysisBatchPending'`);
  const ids = (pending.rows as Array<{ b: string | null }>).map(r => r.b).filter((b): b is string => !!b);
  if (ids.length) {
    const b = ids[0];
    let r: Awaited<ReturnType<typeof applyAnalysisBatchResults>>;
    try { r = await applyAnalysisBatchResults(b, log, { budgetMs, skipDone: true }); }
    catch (err) {
      // A batch whose results can no longer be fetched (expired after 29 days, or gone) must
      // not hold its deals "pending" forever and block every later batch.
      const msg = err instanceof Error ? err.message : String(err);
      if (/\(404\)|not[_ ]found|expired/i.test(msg)) {
        await db.execute(sql`UPDATE deals SET data = (data - 'analysisBatchPending') || jsonb_build_object('analysisAutoError', COALESCE(data->'analysisAutoError', '{}'::jsonb) || jsonb_build_object('reason', ${`batch results no longer available: ${msg.slice(0, 120)}`}::text, 'parser', ${JSON_REPAIR_VERSION}::int)) WHERE data->>'analysisBatchPending' = ${b}`);
        return { at, action: "released deals from an unavailable batch", batchId: b, error: msg.slice(0, 200) };
      }
      throw err;
    }
    if (r.status === "ended" && !r.remaining) {
      // Everything this batch returned is applied; release any deal it didn't return.
      await db.execute(sql`UPDATE deals SET data = data - 'analysisBatchPending' WHERE data->>'analysisBatchPending' = ${b}`);
      log.info({ batchId: b }, "Auto re-analysis batch fully applied");
    }
    return { at, action: r.status === "ended" ? "applying" : "waiting for batch", batchId: b, status: r.status, applied: r.applied, failed: r.failed, remaining: r.remaining };
  }
  // 1b) Replies that could NOT BE READ under an older parser: put each back on the batch it
  //     came from (its results stay downloadable for 29 days) so the improved parser re-reads
  //     the reply already paid for — no new tokens. Once per parser version, never a loop.
  const requeued = await db.execute(sql`UPDATE deals SET data = data
      || jsonb_build_object('analysisBatchPending', data->'analysisAutoError'->>'batchId')
      || jsonb_build_object('analysisAutoError', (data->'analysisAutoError') || jsonb_build_object('reparsedWith', ${JSON_REPAIR_VERSION}::int))
    WHERE data->'analysisAutoError'->>'reason' LIKE 'could not read the AI reply%'
      AND COALESCE((data->'analysisAutoError'->>'parser')::int, 1) < ${JSON_REPAIR_VERSION}
      AND COALESCE((data->'analysisAutoError'->>'reparsedWith')::int, 0) < ${JSON_REPAIR_VERSION}
      AND data->'analysisAutoError'->>'batchId' IS NOT NULL
      AND COALESCE((data->>'analysisVersion')::int, 0) < ${ANALYSIS_VERSION}
      AND NOT (data ? 'trashedAt')
    RETURNING id`);
  if ((requeued.rows as unknown[]).length) {
    log.info({ count: (requeued.rows as unknown[]).length }, "Re-reading unreadable analysis replies with the improved parser");
    return { at, action: "re-reading unreadable replies", remaining: (requeued.rows as unknown[]).length };
  }
  // 2) Nothing in flight → send every still-stale deal that hasn't used its tries.
  const tries = (d: Record<string, unknown>) => { const t = d.analysisAutoTries as { v?: number; n?: number } | undefined; return t?.v === ANALYSIS_VERSION ? (t.n ?? 0) : 0; };
  // OWNED deals are never re-analysed in the background (Eric, 10/18/26: the asset brief
  // regenerates only on demand) — their write-up refreshes from the deal page's button.
  const sent = await submitStaleAnalysisBatch(log, (_id, d) => tries(d) < MAX_TRIES && d.status !== "Owned");
  if (!sent.batchId || !sent.ids.length) return { at, action: "done (nothing left to refresh)" };
  for (const id of sent.ids) {
    await db.execute(sql`UPDATE deals SET data = data || jsonb_build_object('analysisBatchPending', ${sent.batchId}::text,
      'analysisAutoTries', jsonb_build_object('v', ${ANALYSIS_VERSION}::int, 'n', COALESCE(CASE WHEN (data->'analysisAutoTries'->>'v')::int = ${ANALYSIS_VERSION} THEN (data->'analysisAutoTries'->>'n')::int END, 0) + 1))
      WHERE id = ${id}`);
  }
  log.info({ batchId: sent.batchId, count: sent.ids.length }, "Auto re-analysis batch submitted");
  return { at, action: "submitted", batchId: sent.batchId, remaining: sent.ids.length };
}

let sliceRunning = false;
/** One bounded slice (single-flight per instance). Records the outcome for the status read. */
export async function runAnalysisRefreshSlice(log: Logger = logger, budgetMs = 45_000): Promise<RefreshTick> {
  if (sliceRunning) return { at: new Date().toISOString(), action: "busy (a slice is already running)" };
  // Never compete with the one-time startup jobs for database connections (10/17/26).
  if (!startupComplete()) return { at: new Date().toISOString(), action: `waiting (server still starting: ${startupStepRunning() ?? "…"})` };
  sliceRunning = true;
  try { lastTick = await tick(log, budgetMs); }
  catch (err) { lastTick = { at: new Date().toISOString(), action: "error", error: err instanceof Error ? err.message.slice(0, 300) : String(err) }; log.error({ err }, "Auto re-analysis slice failed"); }
  finally { sliceRunning = false; }
  return lastTick;
}

/** Live progress, DB-only (no model call): how many deals are on the current version.
 *  Everything here is read from the DATABASE, so it is the same whichever server instance
 *  answers (autoscale runs several; the old in-memory "last tick" differed per instance). */
export async function analysisRefreshStatus(): Promise<{ version: number; build: string; current: number; outdated: number; inBatch: number; appliedByAutoRefresh: number; lastAppliedAt: string | null; notApplied: Array<{ id: string; name: string | null; tries: number; willRetry: boolean; reason: string }>; batchId: string | null; workPending: boolean; lastTick: RefreshTick | null }> {
  const r = await db.execute(sql`SELECT
      count(*) FILTER (WHERE COALESCE((data->>'analysisVersion')::int, 0) >= ${ANALYSIS_VERSION})::int AS current,
      count(*) FILTER (WHERE COALESCE((data->>'analysisVersion')::int, 0) < ${ANALYSIS_VERSION} AND data ? 'dealScore' AND COALESCE(data->>'status', '') <> 'Owned')::int AS outdated,
      count(*) FILTER (WHERE data ? 'analysisBatchPending')::int AS inbatch,
      count(*) FILTER (WHERE COALESCE((data->>'analysisVersion')::int, 0) >= ${ANALYSIS_VERSION} AND (data->'analysisAutoTries'->>'v')::int = ${ANALYSIS_VERSION})::int AS applied,
      max(data->>'lastScoredAt') FILTER (WHERE COALESCE((data->>'analysisVersion')::int, 0) >= ${ANALYSIS_VERSION} AND (data->'analysisAutoTries'->>'v')::int = ${ANALYSIS_VERSION}) AS last_applied,
      max(data->>'analysisBatchPending') AS batch
    FROM deals WHERE data->>'trashedAt' IS NULL AND COALESCE((data->>'_processing')::boolean, false) = false`);
  const row = (r.rows[0] ?? {}) as { current?: number; outdated?: number; inbatch?: number; applied?: number; last_applied?: string | null; batch?: string | null };
  // Sent at least once, not applied, not in a batch now → it goes again with the next batch
  // (up to MAX_TRIES). The reason is recorded for failures from 10/17/26 on.
  const w = await db.execute(sql`SELECT id, data->>'propertyName' AS name, (data->'analysisAutoTries'->>'n')::int AS tries, data->'analysisAutoError'->>'reason' AS reason
    FROM deals WHERE data->>'trashedAt' IS NULL AND NOT (data ? 'analysisBatchPending')
      AND (data->'analysisAutoTries'->>'v')::int = ${ANALYSIS_VERSION} AND COALESCE((data->>'analysisVersion')::int, 0) < ${ANALYSIS_VERSION}
    ORDER BY 2 LIMIT 50`);
  const notApplied = (w.rows as Array<{ id: string; name: string | null; tries: number | null; reason: string | null }>)
    .map(x => ({ id: x.id, name: x.name, tries: x.tries ?? 0, willRetry: (x.tries ?? 0) < MAX_TRIES, reason: x.reason ?? "not recorded (before 10/17/26)" }));
  const inBatch = row.inbatch ?? 0;
  return { version: ANALYSIS_VERSION, build: BUILD_COMMIT, current: row.current ?? 0, outdated: row.outdated ?? 0, inBatch,
    appliedByAutoRefresh: row.applied ?? 0, lastAppliedAt: row.last_applied ?? null, notApplied, batchId: row.batch ?? null,
    workPending: ANALYSIS_VERSION === AUTO_REFRESH_FOR_VERSION && !!process.env.ANTHROPIC_API_KEY && (inBatch > 0 || (row.outdated ?? 0) > 0) && !(lastTick?.action?.startsWith("done")),
    lastTick };
}

export function startAnalysisAutoRefresh(): void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    runAnalysisRefreshSlice(logger).finally(() => { running = false; });
  };
  setTimeout(run, 30_000); // started only after the startup sequence has finished
  setInterval(run, EVERY_MS).unref?.();
}

/** Token-free, immediate: apply the deterministic write-up guardrails to every stored
 *  analysis (above-market "upside" → red flag; quoted % vs stored fields → review
 *  question), so the worst of it is fixed before the batch comes back. Idempotent. */
export async function sweepAnalysisGuardrails(): Promise<number> {
  const { applyAnalysisGuardrails } = await import("./analysisGuardrails");
  const rows = await db.select().from(dealsTable);
  let n = 0;
  for (const r of rows) {
    const d = r.data as Record<string, unknown>;
    if (d.trashedAt || d._processing || d._processingError) continue;
    const changed = (x: Record<string, unknown>) => {
      const next = applyAnalysisGuardrails(x, { ...x });
      return JSON.stringify([next.upsideItems, next.redFlags, next.reviewQuestions]) === JSON.stringify([x.upsideItems, x.redFlags, x.reviewQuestions])
        ? null : { upsideItems: next.upsideItems ?? null, redFlags: next.redFlags ?? null, reviewQuestions: next.reviewQuestions ?? null };
    };
    if (!changed(d)) continue;
    // Recompute from the CURRENT row: a batch apply may have landed since the bulk read.
    if (await updateDealSafely(r.id, changed)) n++;
  }
  return n;
}
