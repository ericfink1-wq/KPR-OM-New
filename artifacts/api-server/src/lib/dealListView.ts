// THE DEAL LIST vs THE FULL RECORD (10/17/26: GET /deals was 18 MB on every page load —
// every deal's full detail, trashed records included).
//
// The list keeps everything the library-wide views read — the roster (tenant search,
// analytics, rollover), grade, flags, sales history — and drops the blocks only the deal
// page itself uses. The deal page fetches the full record (GET /deals/:id) when it opens.
//
// A list copy is marked `_summary: true`. The app saves a deal by sending its whole record
// back, so a save made from a list copy would otherwise WIPE the dropped blocks; PUT sees
// the marker and puts them back from the stored record (restoreOmittedDetail).

// Every key here was checked: nothing outside the deal page / import review / re-upload
// merge reads it (those load the full record). Library-wide views DO read cashFlowProjection
// (recoveries fallback), leaseRisk (co-tenancy cascade), comparableSales and incomeBreakdown
// (data confidence), so those stay. Adding a key: grep the web app for it first.
// `packageSources` (4 small fields) STAYS too: the upload queue's samePackageDeal reads its
// `startedAt` on library deals to attach a package's later files without asking (10/21/26).
export const LIST_OMIT_KEYS = [
  "fieldCitations", "extraFields", "roofData", "underwritingAssumptions", "otherIncome",
  "propertyHistory", "taxParcels", "customAmortSchedule", "prefSchedule",
] as const;

// The roster stays in the list (58 library-wide readers), but each row carries ~20 null
// fields out of ~44 (measured on J.A.N.A.F., 10/17/26). A null and an absent field read
// the same everywhere — every reader uses `== null` / `??` / optional chaining (checked
// both packages for `=== null` and key-presence tests on tenants) — so the list leaves
// the nulls out. Nothing is lost on a save from a list copy: the stored row loses keys
// that held null, which every reader already treats as "not captured".
function withoutNulls(t: unknown): unknown {
  if (!t || typeof t !== "object" || Array.isArray(t)) return t;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t as Record<string, unknown>)) if (v !== null && v !== undefined) o[k] = v;
  return o;
}

export function toListView(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...d };
  let dropped = false;
  for (const k of LIST_OMIT_KEYS) if (k in out) { delete out[k]; dropped = true; }
  if (Array.isArray(out.tenants)) out.tenants = out.tenants.map(withoutNulls);
  if (dropped) out._summary = true;
  return out;
}

/** On a save of a list copy, put back whatever the list left out (mutates `incoming`). */
export function restoreOmittedDetail(prev: Record<string, unknown> | undefined, incoming: Record<string, unknown>): string[] {
  const wasSummary = incoming._summary === true;
  delete incoming._summary;
  if (!wasSummary || !prev) return [];
  const restored: string[] = [];
  for (const k of LIST_OMIT_KEYS) {
    if (!(k in incoming) && k in prev) { incoming[k] = prev[k]; restored.push(k); }
  }
  return restored;
}
