import { db, dealsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { rebuildTenantIndex } from "./tenantIndex";
import { nameFromFileName } from "./fileNameProperty";

// FINISHED-BUT-UNSAVED UPLOADS (Eric, 10/21/26 — The Waterfront showed ×3). An OM upload
// first lands as a temp row stamped `_ingestBy` (the uploader); the uploading tab then
// FILES it — merges it into the matching deal or saves it as a new one, and either save
// drops the marker. When the tab closes in between (Newmark's Financial Narrative, twice),
// the finished read stays in the library as a stray deal. So:
//   • GET /deals hides an unsaved upload for 30 min after it finishes (its tab is still
//     filing it), and ALWAYS while a saved deal matches it;
//   • the sweep (startup + the analysis-refresh tick, at most every 5 min), past 30 min:
//     matched → Trash with the reason; no match → claimed (marker dropped, it's a deal).
// "Unsaved upload" = `_ingestBy` set, finished reading, not trashed.

export const UNSAVED_GRACE_MS = 30 * 60_000;
export const SWEEP_EVERY_MS = 5 * 60_000;

type Data = Record<string, unknown>;
export type UploadRow = { id: string; data: Data; updatedAt: Date | null };
export type UnsavedAction =
  | { kind: "trash"; id: string; matchId: string; matchName: string; reason: string }
  | { kind: "claim"; id: string };

export const isUnsavedUpload = (d: Data): boolean =>
  !!d._ingestBy && !d._processing && !d._processingError && !d.trashedAt;
const isSavedDeal = (d: Data): boolean =>
  !d._ingestBy && !d._processing && !d._processingError && !d.trashedAt;

/** When the read finished: extraction stamps `uploadedAt` as it completes; else the row time. */
export function finishedAt(r: UploadRow): number {
  const t = typeof r.data.uploadedAt === "string" ? Date.parse(r.data.uploadedAt) : NaN;
  if (Number.isFinite(t)) return t;
  return r.updatedAt ? r.updatedAt.getTime() : 0;
}

/** "The Waterfront" = "Waterfront" = "WATERFRONT": a leading "The" and punctuation ignored. */
export const propKey = (s: unknown): string =>
  String(s ?? "").trim().toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");

/** Every name a record answers to: its name, its aliases, and the property in its file name. */
export function namesOf(d: Data): string[] {
  const raw = [d.propertyName, ...(Array.isArray(d.aka) ? d.aka : []), nameFromFileName(typeof d.fileName === "string" ? d.fileName : null)];
  return [...new Set(raw.map(propKey).filter(k => k.length >= 4))];
}

const stateOf = (v: unknown): string | null => {
  const t = String(v ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? t : null;
};

/** The saved deal an unsaved upload duplicates — by name, alias or file-name property —
 *  never across two different stated states. */
export function savedMatchFor(upload: UploadRow, rows: UploadRow[]): UploadRow | null {
  const mine = new Set(namesOf(upload.data));
  if (!mine.size) return null;
  const st = stateOf(upload.data.state);
  for (const r of rows) {
    if (r.id === upload.id || !isSavedDeal(r.data)) continue;
    const ds = stateOf(r.data.state);
    if (st && ds && st !== ds) continue;
    if (namesOf(r.data).some(k => mine.has(k))) return r;
  }
  return null;
}

/** Ids GET /deals leaves out: unsaved uploads still inside the grace window, or matched. */
export function hiddenUnsavedIds(rows: UploadRow[], now = Date.now()): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (!isUnsavedUpload(r.data)) continue;
    if (now - finishedAt(r) < UNSAVED_GRACE_MS || savedMatchFor(r, rows)) out.add(r.id);
  }
  return out;
}

/** Pure: what the sweep does to each unsaved upload past the grace window. */
export function planUnsavedUploads(rows: UploadRow[], now = Date.now()): UnsavedAction[] {
  const out: UnsavedAction[] = [];
  for (const r of rows) {
    if (!isUnsavedUpload(r.data) || now - finishedAt(r) < UNSAVED_GRACE_MS) continue;
    const m = savedMatchFor(r, rows);
    if (m) {
      const matchName = String(m.data.propertyName || m.data.fileName || m.id);
      out.push({ kind: "trash", id: r.id, matchId: m.id, matchName,
        reason: `unsaved upload (its tab closed before filing it) — duplicate of “${matchName}” (${m.id})` });
    } else out.push({ kind: "claim", id: r.id });
  }
  return out;
}

let lastSweep = 0;
let running: Promise<UnsavedAction[]> | null = null;

/** Startup step + analysis-refresh tick. Throttled to every 5 min unless `force`. */
export function sweepUnsavedUploads(force = false): Promise<UnsavedAction[]> {
  if (running) return running;
  if (!force && Date.now() - lastSweep < SWEEP_EVERY_MS) return Promise.resolve([]);
  lastSweep = Date.now();
  running = (async () => {
    const rows = (await db.select({ id: dealsTable.id, data: dealsTable.data, updatedAt: dealsTable.updatedAt }).from(dealsTable)
      .where(sql`${dealsTable.data}->>'trashedAt' IS NULL`)) as UploadRow[];
    const plan = planUnsavedUploads(rows);
    const now = new Date().toISOString();
    for (const a of plan) {
      // `? '_ingestBy'` in the WHERE: a tab that saved it meanwhile already claimed it — skip.
      const patch = a.kind === "trash" ? { trashedAt: now, trashedReason: a.reason } : {};
      const [row] = await db.update(dealsTable)
        .set({ data: sql`(${dealsTable.data} - '_ingestBy') || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
        .where(sql`${eq(dealsTable.id, a.id)} AND ${dealsTable.data} ? '_ingestBy'`)
        .returning({ data: dealsTable.data });
      if (!row) continue;
      await rebuildTenantIndex(a.id, row.data as Data);
      logger.info({ action: a }, a.kind === "trash" ? "Unsaved upload moved to Trash (duplicate)" : "Unsaved upload claimed as a deal");
    }
    return plan;
  })().finally(() => { running = null; });
  return running;
}
