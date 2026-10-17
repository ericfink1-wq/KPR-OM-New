import { db, dealsTable, dealSourcesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { findOmDate } from "./omDate";

/** Fill a missing OM date on one deal's data (mutates). Upgrades an upload-date fallback
 *  when the document's own text or file name gives the real date. Returns whether it changed. */
export async function fillOmDate(id: string, d: Record<string, unknown>): Promise<boolean> {
  const has = typeof d.omDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(d.omDate);
  if (has && d.omDateSource !== "upload-date") return false;
  const [src] = await db.select({ t: dealSourcesTable.sourceText }).from(dealSourcesTable).where(eq(dealSourcesTable.id, id));
  const found = findOmDate({ sourceText: src?.t ?? null, fileName: d.fileName as string | null, uploadedAt: d.uploadedAt as string | null });
  if (!found) return false;
  if (has && found.omDateSource === "upload-date") return false; // nothing better than what's there
  d.omDate = found.omDate; d.omDateSource = found.omDateSource;
  return true;
}

/** Startup sweep: every live deal without a real OM date. Idempotent. */
export async function sweepOmDates(): Promise<{ pdf: number; fileName: number; upload: number }> {
  const rows = await db.select({ id: dealsTable.id, data: dealsTable.data }).from(dealsTable)
    .where(sql`${dealsTable.data}->>'trashedAt' IS NULL AND (${dealsTable.data}->>'omDate' IS NULL OR ${dealsTable.data}->>'omDate' = '' OR ${dealsTable.data}->>'omDateSource' = 'upload-date')`);
  const n = { pdf: 0, fileName: 0, upload: 0 };
  for (const r of rows) {
    const d = { ...(r.data as Record<string, unknown>) };
    if (d._processing || d._processingError) continue;
    if (!(await fillOmDate(r.id, d))) continue;
    await db.execute(sql`UPDATE deals SET data = data || ${JSON.stringify({ omDate: d.omDate, omDateSource: d.omDateSource })}::jsonb WHERE id = ${r.id}`);
    if (d.omDateSource === "pdf") n.pdf++; else if (d.omDateSource === "file-name") n.fileName++; else n.upload++;
  }
  if (n.pdf + n.fileName + n.upload) logger.info(n, "Filled missing OM dates");
  return n;
}
