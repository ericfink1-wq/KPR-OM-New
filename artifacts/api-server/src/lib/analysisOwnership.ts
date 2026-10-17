// The AI write-up is SERVER-OWNED once the server has produced a newer one.
//
// A browser keeps every deal from the moment the app loaded, and a save sends that whole
// copy back (PUT /deals/:id replaces the record). While the background re-analysis is
// applying new write-ups, any save from a tab opened before that — a status change, a
// note, a resolved question — silently put the OLD write-up and its rules version back
// (10/17/26: deals kept being re-analysed but the "on current rules" count never moved).
//
// So on a save: the batch bookkeeping always stays as the server has it, and when the
// stored write-up is NEWER than the one in the incoming copy, the stored one is kept.
// A new document (re-upload) is a fresh start and is never overridden.

const BOOKKEEPING = ["analysisBatchPending", "analysisAutoTries"] as const;
const WRITE_UP = ["notes", "dealScore", "redFlags", "upsideItems", "analysisVersion", "lastScoredAt", "lastScoredDealCount"] as const;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** True when `prev` (stored) carries a newer write-up than `incoming` (the client's copy). */
export function storedWriteUpIsNewer(prev: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
  if (num(prev.analysisVersion) > num(incoming.analysisVersion)) return true;
  const a = prev.lastScoredAt, b = incoming.lastScoredAt;
  return typeof a === "string" && typeof b === "string" && a > b;
}

/** Mutates `incoming` so a stale client copy can't roll back the server's write-up. */
export function keepServerOwnedAnalysis(prev: Record<string, unknown> | undefined, incoming: Record<string, unknown>, isNewDoc = false): string[] {
  if (!prev) return [];
  for (const k of BOOKKEEPING) { if (k in prev) incoming[k] = prev[k]; else delete incoming[k]; }
  if (isNewDoc || !storedWriteUpIsNewer(prev, incoming)) return [];
  const kept: string[] = [];
  for (const k of WRITE_UP) {
    if (k in prev) { if (JSON.stringify(incoming[k]) !== JSON.stringify(prev[k])) kept.push(k); incoming[k] = prev[k]; }
  }
  // A save that deliberately marks the analysis stale (a roster change) still wins.
  if (incoming.analysisStale !== true && "analysisStale" in prev) incoming.analysisStale = prev.analysisStale;
  return kept;
}
