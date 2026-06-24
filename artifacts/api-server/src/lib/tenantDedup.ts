// Suite-aware dedup for the OM extraction continuation / gap-fill passes. Kept in its
// own (dependency-free) module so it is unit-testable without pulling in extract.ts's
// DB / SDK imports.
//
// Tenant NAMES are not a reliable dedup key: when an OM's rent-roll name column is set in
// a custom-encoded font, the text layer yields garbage, so the model GUESSES the names
// and varies them round to round. Deduping on name alone then lets the SAME suite be
// re-added under a different spelling — producing duplicate rows, a roster whose SF
// exceeds the building GLA, and a continuation loop that wheel-spins on near-duplicates
// until the time budget trips (the Dawson Marketplace failure). Treat a candidate as
// already-captured when EITHER its suite OR its name matches one already held; suites
// extract reliably, so they win.
export function filterNewTenants<T extends { name?: unknown; suite?: unknown }>(
  existing: Array<{ name?: unknown; suite?: unknown }>,
  candidates: T[],
): T[] {
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const seenSuite = new Set(existing.map((t) => norm(t.suite)).filter(Boolean));
  const seenName = new Set(existing.map((t) => norm(t.name)).filter(Boolean));
  const out: T[] = [];
  for (const t of candidates) {
    if (!t?.name) continue;
    const su = norm(t.suite), nm = norm(t.name);
    if (su && seenSuite.has(su)) continue;   // same suite already captured (under any name)
    if (nm && seenName.has(nm)) continue;     // same name already captured
    out.push(t);
    if (su) seenSuite.add(su);                // also guard against in-batch duplicates
    if (nm) seenName.add(nm);
  }
  return out;
}
