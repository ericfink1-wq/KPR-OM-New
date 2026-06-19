// CONTINUOUS SELF-IMPROVEMENT loop (server-side, token-free, non-destructive).
//
// Runs automatically on a schedule and does three things, all without the model:
//   1) RE-AUDIT every deal and self-heal its Import-Review flags (drop audit checks
//      that now pass, add new ones) — same rules as POST /deals/reaudit.
//   2) RECORD a daily metrics snapshot (deals-with-issues, total issues, per-check
//      breakdown) into audit_history — so we can SEE whether the reading is getting
//      better over time, not just feel it.
//   3) AUTO-TEACH: when the SAME kind of mistake recurs across many deals, mint one
//      standing extraction lesson that prevents the whole class on every future read.
//
// Deliberately NON-DESTRUCTIVE: it only heals review flags, never mutates a deal's
// financial/roster data. The snapshot-protected auto-fix that DOES change data stays
// a deliberate, human-triggered action (Portfolio Analytics → "auto-fix safe issues").
// Idempotent via the audit_history day key, so it runs at most once per day even
// across restarts.

import { db, dealsTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { auditExtraction, AUDIT_ID_PREFIX, auditCheckKey, AUDIT_CHECK_LABELS } from "./extractionAudit";
import { ensureExtractionLessonsTable } from "./extractionLessons";
import { logger } from "./logger";

let historyReady: Promise<void> | null = null;
export function ensureAuditHistoryTable(): Promise<void> {
  if (!historyReady) {
    historyReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS audit_history (
          day date PRIMARY KEY,
          deals_with_issues integer NOT NULL DEFAULT 0,
          total_issues integer NOT NULL DEFAULT 0,
          deals_scanned integer NOT NULL DEFAULT 0,
          breakdown jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    })().catch((err) => { historyReady = null; throw err; });
  }
  return historyReady;
}

// One tight, operator-style rule per recurring deterministic check — minted as a
// standing extraction lesson when the check fires across enough deals. Kept short so
// the prompt doesn't bloat; only the genuinely teachable classes are here.
const AUTO_LESSON_BY_CHECK: Record<string, string> = {
  "audit-occcost-fraction": "Occupancy cost is a PERCENT (e.g. 22.5 for 22.5%), never a 0.NN fraction — if the source shows 0.225, write 22.5.",
  "audit-occupancy-fraction": "Occupancy is a PERCENT 0–100 (e.g. 92.8), never a 0–1 fraction.",
  "audit-caprate-range": "Cap rate is a percent ~3–12 (e.g. 6.50), never basis points (650) or a fraction (0.065).",
  "audit-rent-tie": "On a rent roll, rentPerSF × sf must equal annual BASE rent; if they don't tie, the annual base rent is usually the reliable figure — recompute the PSF from it (a per-SF figure that doesn't tie is often a gross/option-period rate).",
  "audit-sf-gla-short": "Reconcile the roster to the building GLA: occupied + vacant suite SF must sum to totalSF and match the stated occupancy. If short, you missed occupied tenants OR vacant suites — capture every vacant/available suite from the rent roll.",
  "audit-lease-dates": "A lease's expiry must be AFTER its commencement — never read start/expiry from swapped columns; all dates ISO YYYY-MM-DD.",
  "audit-sales-below-rent": "A tenant's salesPSF must exceed its rentPerSF; sales below rent is a units slip (sales captured in $000s, or a total/monthly figure read as an annual PSF).",
  "audit-noi-cap-price": "NOI ÷ cap rate must equal price; if the headline cap is on pro-forma NOI, capture in-place NOI separately so the three tie out.",
  "audit-dupe-tenant": "Never list the same tenant twice — a duplicate row double-counts its SF and rent.",
  "audit-anchor-missing": "A grocery-anchored center must include its grocery anchor row; if the anchor box appears on the site plan but its economics didn't come through, still capture the row.",
};
const AUTO_LESSON_MIN_DEALS = 5; // mint a class-level rule only once a mistake is clearly systematic

export interface SelfCleanResult {
  scanned: number; flagged: number; cleared: number; added: number; changedDeals: number;
  totalIssues: number; lessonsMinted: string[];
}

export async function runDailySelfClean(reason = "scheduled"): Promise<SelfCleanResult> {
  await ensureAuditHistoryTable();
  await ensureExtractionLessonsTable();
  const rows = await db.select().from(dealsTable);
  let scanned = 0, flagged = 0, cleared = 0, added = 0, changedDeals = 0, totalIssues = 0;
  const checkCounts = new Map<string, number>();      // distinct deals firing each check
  const checkLabels = new Map<string, string>();

  for (const r of rows) {
    const data = r.data as Record<string, unknown>;
    if (data.trashedAt || data._processing || data._processingError) continue;
    scanned++;
    const fresh = auditExtraction(data);
    const freshIds = new Set(fresh.map(q => q.id));
    const existing = Array.isArray(data.reviewQuestions) ? (data.reviewQuestions as Array<Record<string, unknown>>) : [];
    const kept = existing.filter(q => {
      const id = String(q?.id || "");
      if (!id.startsWith(AUDIT_ID_PREFIX)) return true;   // AI / lease-risk — never touch
      if (q?.resolvedAt) return true;                      // already resolved — no re-nag
      return freshIds.has(id);                             // unresolved audit q: keep only if still failing
    });
    const keptIds = new Set(kept.map(q => String(q?.id || "")));
    const newOnes = fresh.filter(q => !keptIds.has(q.id));
    const next = [...kept, ...newOnes];
    const clearedHere = existing.length - kept.length;
    if (newOnes.length || clearedHere) {
      added += newOnes.length; cleared += clearedHere; changedDeals++;
      await db.update(dealsTable).set({ data: { ...data, reviewQuestions: next }, updatedAt: new Date() }).where(eq(dealsTable.id, r.id));
    }
    // Tally OPEN audit issues for metrics + recurring-pattern detection.
    const openAudit = next.filter(q => { const x = q as Record<string, unknown>; const id = String(x?.id || ""); return id.startsWith(AUDIT_ID_PREFIX) && !x?.resolvedAt; });
    if (openAudit.length) flagged++;
    const seenKeysThisDeal = new Set<string>();
    for (const q of openAudit) {
      totalIssues++;
      const key = auditCheckKey(String((q as Record<string, unknown>).id || ""));
      if (!seenKeysThisDeal.has(key)) { seenKeysThisDeal.add(key); checkCounts.set(key, (checkCounts.get(key) || 0) + 1); }
      checkLabels.set(key, AUDIT_CHECK_LABELS[key] || key);
    }
  }

  // 2) Record the daily metrics snapshot (one row per day; latest wins).
  const breakdown = [...checkCounts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, label: checkLabels.get(key) || key, count }));
  const today = new Date().toISOString().slice(0, 10);
  await db.execute(sql`
    INSERT INTO audit_history (day, deals_with_issues, total_issues, deals_scanned, breakdown)
    VALUES (${today}, ${flagged}, ${totalIssues}, ${scanned}, ${JSON.stringify(breakdown)}::jsonb)
    ON CONFLICT (day) DO UPDATE SET deals_with_issues = EXCLUDED.deals_with_issues,
      total_issues = EXCLUDED.total_issues, deals_scanned = EXCLUDED.deals_scanned,
      breakdown = EXCLUDED.breakdown, created_at = now()
  `);

  // 3) Auto-teach: a systematic mistake (same check across many deals) becomes one
  //    standing extraction lesson (idempotent — never duplicated, never overwrites).
  const lessonsMinted: string[] = [];
  for (const [key, count] of checkCounts) {
    const lesson = AUTO_LESSON_BY_CHECK[key];
    if (!lesson || count < AUTO_LESSON_MIN_DEALS) continue;
    const id = `auto-${key}`;
    const res = await db.execute(sql`
      INSERT INTO extraction_lessons (id, scope, lesson, active, created_by)
      VALUES (${id}, 'om', ${lesson}, true, 'auto-self-improve')
      ON CONFLICT (id) DO NOTHING
    `);
    if ((res.rowCount ?? 0) > 0) lessonsMinted.push(id);
  }

  const result: SelfCleanResult = { scanned, flagged, cleared, added, changedDeals, totalIssues, lessonsMinted };
  logger.info({ reason, ...result }, "Self-improvement daily self-clean complete");
  return result;
}

// Scheduler: best-effort, DB-backed (the audit_history day key makes it run at most
// once per day even across restarts). Checks shortly after boot, then every 6 hours.
let timer: ReturnType<typeof setInterval> | null = null;
export function startSelfImproveScheduler(): void {
  if (timer) return;
  const tick = async () => {
    try {
      await ensureAuditHistoryTable();
      const today = new Date().toISOString().slice(0, 10);
      const ran = await db.execute(sql`SELECT 1 FROM audit_history WHERE day = ${today} LIMIT 1`);
      if ((ran.rows?.length ?? 0) === 0) await runDailySelfClean("scheduled");
    } catch (err) {
      logger.error({ err }, "Self-improvement tick failed (non-fatal)");
    }
  };
  setTimeout(() => { void tick(); }, 60_000);                 // ~1 min after boot
  timer = setInterval(() => { void tick(); }, 6 * 60 * 60 * 1000); // every 6h
  logger.info("Self-improvement scheduler started (daily token-free self-clean)");
}
