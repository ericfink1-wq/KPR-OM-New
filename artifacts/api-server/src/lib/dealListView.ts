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
export const LIST_OMIT_KEYS = [
  "fieldCitations", "extraFields", "roofData", "underwritingAssumptions", "otherIncome",
  "packageSources", "propertyHistory", "taxParcels", "customAmortSchedule", "prefSchedule",
] as const;

export function toListView(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...d };
  let dropped = false;
  for (const k of LIST_OMIT_KEYS) if (k in out) { delete out[k]; dropped = true; }
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
