import { db } from "@workspace/db";
import { extractionLessonsTable } from "@workspace/db";
import { sql, eq, desc } from "drizzle-orm";

export type LessonScope = "all" | "om" | "rent-roll" | "lease-options" | "sales" | "flyer" | "swap" | "loan";

// Runtime-provision the table (idempotent), mirroring ensureUsersTable so Replit
// never proposes a destructive migration for a runtime-created table.
let tableReady: Promise<void> | null = null;
export function ensureExtractionLessonsTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS extraction_lessons (
          id text PRIMARY KEY,
          scope text NOT NULL DEFAULT 'all',
          lesson text NOT NULL,
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          created_by text
        )
      `);
    })().catch((err) => { tableReady = null; throw err; });
  }
  return tableReady;
}

// Active lessons for a document type (its own scope + the catch-all "all").
export async function getActiveLessons(scope: LessonScope): Promise<Array<{ id: string; scope: string; lesson: string; createdAt: Date; createdBy: string | null }>> {
  await ensureExtractionLessonsTable();
  const rows = await db.select().from(extractionLessonsTable)
    .where(scope === "all"
      ? eq(extractionLessonsTable.active, true)
      : sql`${extractionLessonsTable.active} = true and (${extractionLessonsTable.scope} = ${scope} or ${extractionLessonsTable.scope} = 'all')`)
    .orderBy(desc(extractionLessonsTable.createdAt));
  return rows.map(r => ({ id: r.id, scope: r.scope, lesson: r.lesson, createdAt: r.createdAt, createdBy: r.createdBy }));
}

// Format active lessons as a prompt block to append to an extraction prompt.
// Returns "" when there are none, so callers can concatenate unconditionally.
export async function lessonGuidance(scope: LessonScope): Promise<string> {
  let rows: Array<{ lesson: string }> = [];
  try { rows = await getActiveLessons(scope); }
  catch { return ""; } // never block extraction if the lessons table is unavailable
  if (rows.length === 0) return "";
  const list = rows.map((r, i) => `${i + 1}. ${r.lesson.trim()}`).join("\n");
  return `\n\nOPERATOR-TAUGHT RULES — HIGHEST PRIORITY. These come from real corrections the operator made after catching mistakes. Follow them exactly, even over the general instructions above if they conflict:\n${list}\n`;
}
