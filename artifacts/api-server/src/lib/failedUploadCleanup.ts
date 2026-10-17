import { db, dealsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { createSnapshot } from "../routes/snapshots";

// FAILED-UPLOAD LEFTOVERS (Eric, 10/17/26: "15 duplicate groups … and 3 records with a
// blank propertyName — run the merge"). The live library had ONE copy of each property;
// the extras were records left behind by uploads / re-analyses that failed. Those carry
// `_processingError` (so the connector and every roll-up skip them) but the Deal Library
// still lists them — by file name when the name is blank. A failed RE-analysis used to
// strip a deal down to its user fields, so some of these hold real user data (status,
// acquisition / debt terms, notes) that the surviving twin lacks.
//
// The sweep (startup, idempotent — trashed records are skipped next time):
//   • leftover WITH a live twin (same file, or same property name) → copy any user field
//     the twin is missing (fill-blanks only), then move the leftover to Trash;
//   • leftover with NO twin and no user data → move to Trash ("failed upload, no data");
//   • leftover with no twin but real user data → LEFT ALONE and logged (a person decides);
//   • a deal stuck "processing" > 6h that still holds its data → un-stuck (restored).
// Trash is a soft delete (trashedAt) — every move is recoverable, and a snapshot is
// taken first.

type Row = { id: string; data: Record<string, unknown>; updatedAt: Date };
export type CleanupAction =
  | { kind: "merge"; id: string; into: string; filled: string[]; statusFrom?: string; statusTo?: string }
  | { kind: "trash-empty"; id: string }
  | { kind: "keep"; id: string; why: string }
  | { kind: "unstick"; id: string };

const USER_KEY = /^(acq|debt|pref|txn|disp)/;
const USER_KEYS_EXTRA = ["userNotes", "dealThesis", "dealReview", "ownershipStructure", "tenantSalesHistory", "marketDemographics", "verified"];
const STATUS_RANK: Record<string, number> = { Sold: 3, Owned: 3, "Under Contract": 2, Prospect: 1, Passed: 1 };
const has = (v: unknown) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0) && !(typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** "Pentagon Centre - Parking Proforma 7.31.26.pdf" → "pentagon centre parking". */
export function normName(v: unknown): string {
  return String(v ?? "").toLowerCase()
    .replace(/\.(pdf|xlsx?|csv|docx?)$/i, "")
    .replace(/\b(offering memorandum|om|rent roll|pro ?forma|flyer|final|draft|copy|v\d+)\b/g, " ")
    .replace(/\d+/g, " ").replace(/[^a-z]+/g, " ").replace(/\s+/g, " ").trim();
}
const isLeftover = (d: Record<string, unknown>) => !d.trashedAt && !!d._processingError;
const isLive = (d: Record<string, unknown>) => !d.trashedAt && !d._processing && !d._processingError;
const userData = (d: Record<string, unknown>) => Object.keys(d).filter(k => (USER_KEY.test(k) || USER_KEYS_EXTRA.includes(k)) && has(d[k]));

function twinFor(stub: Row, live: Row[]): Row | null | "ambiguous" {
  const f = String(stub.data.fileName ?? "").trim().toLowerCase();
  const byFile = f && f !== "unknown" ? live.filter(r => String(r.data.fileName ?? "").trim().toLowerCase() === f) : [];
  if (byFile.length === 1) return byFile[0];
  const key = normName(stub.data.propertyName) || normName(stub.data.fileName);
  if (key.length < 6) return byFile.length > 1 ? "ambiguous" : null;
  // Same name, or the leftover's name STARTS with the twin's full name
  // ("pentagon centre parking" → "Pentagon Centre"). Two-word minimum so a bare
  // "plaza" never matches.
  const hits = live.filter(r => {
    const n = normName(r.data.propertyName);
    if (n.split(" ").length < 2) return false;
    return n === key || key.startsWith(n + " ");
  });
  if (!hits.length) return byFile.length > 1 ? "ambiguous" : null;
  const best = Math.max(...hits.map(r => normName(r.data.propertyName).length));
  const top = hits.filter(r => normName(r.data.propertyName).length === best);
  if (top.length > 1) {
    const st = String(stub.data.state ?? "").toLowerCase();
    const same = st ? top.filter(r => String(r.data.state ?? "").toLowerCase() === st) : [];
    return same.length === 1 ? same[0] : "ambiguous";
  }
  return top[0];
}

/** Pure: what the sweep would do. */
export function planFailedUploadCleanup(rows: Row[], now = Date.now()): CleanupAction[] {
  const live = rows.filter(r => isLive(r.data));
  const out: CleanupAction[] = [];
  for (const r of rows) {
    const d = r.data;
    if (!d.trashedAt && d._processing && now - r.updatedAt.getTime() > 6 * 3600_000) {
      if (has(d.propertyName) && (has(d.tenants) || has(d.noi))) out.push({ kind: "unstick", id: r.id });
      continue;
    }
    if (!isLeftover(d)) continue;
    const twin = twinFor(r, live);
    const mine = userData(d);
    if (twin && twin !== "ambiguous") {
      const filled = mine.filter(k => !has(twin.data[k]));
      const sFrom = String(twin.data.status ?? ""), sTo = String(d.status ?? "");
      const upgrade = (STATUS_RANK[sTo] ?? 0) > (STATUS_RANK[sFrom] ?? 0);
      out.push({ kind: "merge", id: r.id, into: twin.id, filled, ...(upgrade ? { statusFrom: sFrom || "—", statusTo: sTo } : {}) });
    } else if (!mine.length && !((STATUS_RANK[String(d.status)] ?? 0) >= 2)) {
      out.push({ kind: "trash-empty", id: r.id });
    } else {
      out.push({ kind: "keep", id: r.id, why: twin === "ambiguous" ? "more than one possible match" : "holds user data and no matching deal" });
    }
  }
  return out;
}

export async function runFailedUploadCleanup(): Promise<CleanupAction[]> {
  const rows = (await db.select().from(dealsTable)) as Row[];
  const plan = planFailedUploadCleanup(rows);
  const acting = plan.filter(a => a.kind !== "keep");
  for (const a of plan.filter(a => a.kind === "keep")) logger.warn({ action: a }, "Failed-upload leftover kept for review");
  if (!acting.length) return plan;
  try { await createSnapshot("before-failed-upload-cleanup"); } catch (err) { logger.error({ err }, "Snapshot before cleanup failed — skipping cleanup"); return []; }
  const byId = new Map(rows.map(r => [r.id, r]));
  const now = new Date().toISOString();
  for (const a of acting) {
    const r = byId.get(a.id)!;
    if (a.kind === "unstick") {
      await db.update(dealsTable).set({ data: { ...r.data, _processing: false }, updatedAt: new Date() }).where(eq(dealsTable.id, a.id));
    } else if (a.kind === "merge") {
      const twin = byId.get(a.into)!;
      const patch: Record<string, unknown> = {};
      for (const k of a.filled) patch[k] = r.data[k];
      if (a.statusTo) patch.status = a.statusTo;
      if (Object.keys(patch).length) {
        twin.data = { ...twin.data, ...patch };
        await db.update(dealsTable).set({ data: twin.data, updatedAt: new Date() }).where(eq(dealsTable.id, a.into));
      }
      await db.update(dealsTable).set({ data: { ...r.data, trashedAt: now, trashedReason: `failed-upload leftover, merged into ${a.into}` }, updatedAt: new Date() }).where(eq(dealsTable.id, a.id));
    } else {
      await db.update(dealsTable).set({ data: { ...r.data, trashedAt: now, trashedReason: "failed upload, no data" }, updatedAt: new Date() }).where(eq(dealsTable.id, a.id));
    }
    logger.info({ action: a }, "Failed-upload cleanup");
  }
  return plan;
}
