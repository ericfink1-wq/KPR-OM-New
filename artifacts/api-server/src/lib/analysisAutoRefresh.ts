import { db, dealsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import { logger } from "./logger";
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

async function tick(log: Logger): Promise<void> {
  if (ANALYSIS_VERSION !== AUTO_REFRESH_FOR_VERSION || !process.env.ANTHROPIC_API_KEY) return;
  // 1) A batch in flight → apply it once it has ended, then release its deals.
  const pending = await db.execute(sql`SELECT DISTINCT data->>'analysisBatchPending' AS b FROM deals WHERE data ? 'analysisBatchPending'`);
  const ids = (pending.rows as Array<{ b: string | null }>).map(r => r.b).filter((b): b is string => !!b);
  if (ids.length) {
    for (const b of ids) {
      const r = await applyAnalysisBatchResults(b, log);
      if (r.status !== "ended") continue;
      await db.execute(sql`UPDATE deals SET data = data - 'analysisBatchPending' WHERE data->>'analysisBatchPending' = ${b}`);
      log.info({ batchId: b, ...r }, "Auto re-analysis batch applied");
    }
    return;
  }
  // 2) Nothing in flight → send every still-stale deal that hasn't used its tries.
  const tries = (d: Record<string, unknown>) => { const t = d.analysisAutoTries as { v?: number; n?: number } | undefined; return t?.v === ANALYSIS_VERSION ? (t.n ?? 0) : 0; };
  const sent = await submitStaleAnalysisBatch(log, (_id, d) => tries(d) < MAX_TRIES);
  if (!sent.batchId || !sent.ids.length) return;
  for (const id of sent.ids) {
    await db.execute(sql`UPDATE deals SET data = data || jsonb_build_object('analysisBatchPending', ${sent.batchId}::text,
      'analysisAutoTries', jsonb_build_object('v', ${ANALYSIS_VERSION}::int, 'n', COALESCE(CASE WHEN (data->'analysisAutoTries'->>'v')::int = ${ANALYSIS_VERSION} THEN (data->'analysisAutoTries'->>'n')::int END, 0) + 1))
      WHERE id = ${id}`);
  }
  log.info({ batchId: sent.batchId, count: sent.ids.length }, "Auto re-analysis batch submitted");
}

export function startAnalysisAutoRefresh(): void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    tick(logger).catch(err => logger.error({ err }, "Auto re-analysis tick failed")).finally(() => { running = false; });
  };
  setTimeout(run, 90_000); // let startup sweeps (cleanup, guardrails) land first
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
    const before = JSON.stringify([d.upsideItems, d.redFlags, d.reviewQuestions]);
    const next = applyAnalysisGuardrails(d, { ...d });
    if (JSON.stringify([next.upsideItems, next.redFlags, next.reviewQuestions]) === before) continue;
    await db.execute(sql`UPDATE deals SET data = data || ${JSON.stringify({ upsideItems: next.upsideItems ?? null, redFlags: next.redFlags ?? null, reviewQuestions: next.reviewQuestions ?? null })}::jsonb WHERE id = ${r.id}`);
    n++;
  }
  return n;
}
