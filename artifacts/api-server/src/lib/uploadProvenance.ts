// Upload provenance (Eric, 10/19/26): "Uploaded by Eric Fink" on a deal made him think HE
// had uploaded files Jacob loaded that day. The deal page now shows the ORIGINAL creator
// and the LAST uploader separately, plus a per-deal Upload history, and admins get a
// site-wide Upload log. All of it is derived from the existing upload_log rows — no new
// table, no new column: the outcome lives in the `status` text column.
// Pure; tests: __tests__/uploadProvenance.test.ts.

export type UploadResult = "created" | "attached" | "skipped" | "rejected" | "failed";
export const UPLOAD_RESULTS: readonly UploadResult[] = ["created", "attached", "skipped", "rejected", "failed"];

/** What a client may record. Legacy clients send success / failed. */
export function normalizeStatusIn(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if ((UPLOAD_RESULTS as readonly string[]).includes(s)) return s;
  return s === "failed" ? "failed" : "success";
}

export interface LogRow {
  id: string; fileName: string | null; docType: string | null; status: string; detail: string | null;
  dealId: string | null; userId: string | null; userEmail: string | null; userName: string | null; createdAt: Date | string;
}
const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : NaN);
/** Rows logged before outcomes were recorded say only "success": the first one for a deal,
 *  within a day and a half of the deal's own creation, is what created it; later ones added to it. */
const LEGACY_CREATE_WINDOW_MS = 36 * 3600 * 1000;

export function resultOf(row: LogRow, firstSuccessIdForDeal: string | null, dealCreatedAt?: Date | string | null): UploadResult {
  const s = (row.status || "").toLowerCase();
  if ((UPLOAD_RESULTS as readonly string[]).includes(s)) return s as UploadResult;
  if (s === "failed") return "failed";
  const created = ms(dealCreatedAt);
  if (row.id === firstSuccessIdForDeal && (!Number.isFinite(created) || Math.abs(ms(row.createdAt) - created) <= LEGACY_CREATE_WINDOW_MS)) return "created";
  return "attached";
}

export interface Person { userName: string | null; userEmail: string | null; at: string | null }
export interface HistoryEntry { id: string; fileName: string | null; docType: string | null; result: UploadResult; detail: string | null; userName: string | null; userEmail: string | null; at: string }
export interface DealProvenance {
  /** Who created the deal — null when that predates upload tracking (or it came from a JSON import). */
  createdBy: Person | null;
  /** The most recent upload that created or added to the deal. */
  lastUpload: Person | null;
  /** Every logged upload against the deal, newest first. */
  history: HistoryEntry[];
}

const iso = (d: Date | string) => new Date(d).toISOString();
const person = (r: LogRow, nameFor?: (r: LogRow) => string | null): Person =>
  ({ userName: (nameFor?.(r) ?? null) || r.userName || null, userEmail: r.userEmail || null, at: iso(r.createdAt) });

export function dealProvenance(rows: LogRow[], dealCreatedAt?: Date | string | null, nameFor?: (r: LogRow) => string | null): DealProvenance {
  const asc = [...rows].sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const firstSuccess = asc.find(r => (r.status || "").toLowerCase() === "success")?.id ?? null;
  const withResult = asc.map(r => ({ r, result: resultOf(r, firstSuccess, dealCreatedAt) }));
  const createdRow = withResult.find(x => x.result === "created")?.r ?? null;
  const lastRow = [...withResult].reverse().find(x => x.result === "created" || x.result === "attached")?.r ?? null;
  return {
    createdBy: createdRow ? person(createdRow, nameFor) : null,
    lastUpload: lastRow ? person(lastRow, nameFor) : null,
    history: withResult.reverse().map(({ r, result }) => ({
      id: r.id, fileName: r.fileName, docType: r.docType, result, detail: r.detail,
      userName: (nameFor?.(r) ?? null) || r.userName, userEmail: r.userEmail, at: iso(r.createdAt),
    })),
  };
}

export interface LogFilter { user?: string | null; from?: string | null; to?: string | null; result?: string | null }
/** Site-wide log filter: user matches name or email (case-insensitive substring); from / to are
 *  ISO dates, `to` inclusive of that whole day. */
export function filterLog<T extends { userName: string | null; userEmail: string | null; createdAt: Date | string; result: string }>(rows: T[], f: LogFilter): T[] {
  const u = (f.user || "").trim().toLowerCase();
  const from = f.from && /^\d{4}-\d{2}-\d{2}/.test(f.from) ? ms(f.from.slice(0, 10) + "T00:00:00Z") : NaN;
  const to = f.to && /^\d{4}-\d{2}-\d{2}/.test(f.to) ? ms(f.to.slice(0, 10) + "T23:59:59.999Z") : NaN;
  return rows.filter(r => {
    if (u && !`${r.userName || ""} ${r.userEmail || ""}`.toLowerCase().includes(u)) return false;
    const t = ms(r.createdAt);
    if (Number.isFinite(from) && t < from) return false;
    if (Number.isFinite(to) && t > to) return false;
    if (f.result && r.result !== f.result) return false;
    return true;
  });
}
