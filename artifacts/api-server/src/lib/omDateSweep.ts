import { db, dealsTable, dealSourcesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { findOmDate, contradictsRoster } from "./omDate";
import { repairPropertyHistory, docDate, type HistoryEntry } from "./propertyHistory";
import { updateDealSafely } from "./dealWrite";

/** The roster as the OM itself printed it — a later rent-roll paste / refresh describes a
 *  newer date and must never be used to disprove the OM's. */
const omRoster = (d: Record<string, unknown>) =>
  !d.tenantsManual && d.tenantsSource !== "rent-roll" ? d.tenants : undefined;

/** An auto-read date (from the PDF or file name) that the deal's own roster now disproves. */
const misread = (d: Record<string, unknown>) =>
  (d.omDateSource === "pdf" || d.omDateSource === "file-name") && typeof d.omDate === "string"
  && contradictsRoster(d.omDate.slice(0, 10), omRoster(d), (d.lastUploadAt ?? d.uploadedAt) as string | null);

/** Fill a missing OM date on one deal's data (mutates). Upgrades an upload-date fallback
 *  when the document's own text or file name gives the real date, and re-reads an auto-read
 *  date the roster disproves. Returns whether it changed. */
export async function fillOmDate(id: string, d: Record<string, unknown>): Promise<boolean> {
  const has = typeof d.omDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(d.omDate);
  const bad = has && misread(d);
  if (has && !bad && d.omDateSource !== "upload-date") return false;
  const [src] = await db.select({ t: dealSourcesTable.sourceText }).from(dealSourcesTable).where(eq(dealSourcesTable.id, id));
  const found = findOmDate({ sourceText: src?.t ?? null, fileName: d.fileName as string | null, uploadedAt: (d.lastUploadAt ?? d.uploadedAt) as string | null, tenants: omRoster(d) });
  if (!found && bad) { d.omDate = null; d.omDateSource = null; return true; }
  if (!found) return false;
  if (has && !bad && found.omDateSource === "upload-date") return false; // nothing better than what's there
  d.omDate = found.omDate; d.omDateSource = found.omDateSource;
  return true;
}

/** Startup sweep: every live deal without a real OM date, plus any auto-read date its roster
 *  disproves. Idempotent. */
export async function sweepOmDates(): Promise<{ pdf: number; fileName: number; upload: number }> {
  const rows = await db.select({ id: dealsTable.id, data: dealsTable.data }).from(dealsTable)
    .where(sql`${dealsTable.data}->>'trashedAt' IS NULL AND (${dealsTable.data}->>'omDate' IS NULL OR ${dealsTable.data}->>'omDate' = '' OR ${dealsTable.data}->>'omDateSource' IN ('upload-date', 'pdf', 'file-name'))`);
  const n = { pdf: 0, fileName: 0, upload: 0 };
  for (const r of rows) {
    const d = { ...(r.data as Record<string, unknown>) };
    if (d._processing || d._processingError) continue;
    if ((d.omDateSource === "pdf" || d.omDateSource === "file-name") && !misread(d)) continue; // cheap: no source read
    if (!(await fillOmDate(r.id, d))) continue;
    await db.execute(sql`UPDATE deals SET data = data || ${JSON.stringify({ omDate: d.omDate, omDateSource: d.omDateSource })}::jsonb WHERE id = ${r.id}`);
    if (d.omDateSource === "pdf") n.pdf++; else if (d.omDateSource === "file-name") n.fileName++; else n.upload++;
  }
  if (n.pdf + n.fileName + n.upload) logger.info(n, "Filled missing OM dates");
  return n;
}

/** Startup sweep: re-check property-history entries recorded under older matching rules
 *  (a renamed tenant logged as a move-out + an arrival), and re-date the newest entry now
 *  that the deal's OM date may have been read from the document. Idempotent. */
export async function sweepPropertyHistory(): Promise<number> {
  const rows = await db.select({ id: dealsTable.id, data: dealsTable.data }).from(dealsTable)
    .where(sql`${dealsTable.data} ? 'propertyHistory' AND ${dealsTable.data}->>'trashedAt' IS NULL`);
  let n = 0;
  for (const r of rows) {
    const changed = await updateDealSafely(r.id, (fresh) => {
      const h = Array.isArray(fresh.propertyHistory) ? (fresh.propertyHistory as HistoryEntry[]) : null;
      if (!h?.length) return null;
      let next = repairPropertyHistory(h) ?? h;
      const to = docDate(fresh);
      if (next.length && to && next[0].toAsOf !== to) next = [{ ...next[0], toAsOf: to }, ...next.slice(1)];
      return next === h ? null : { propertyHistory: next };
    });
    if (changed) n++;
  }
  if (n) logger.info({ n }, "Re-checked property history");
  return n;
}
