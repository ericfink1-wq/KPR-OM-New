// Pure query-param helpers (no DB / route imports) so they're unit-testable in isolation.

/** Parse a dealId / dealId[] query param into a string array, or null if absent.
 *  The "extended" (qs) query parser converts MORE THAN 20 repeated params (its
 *  arrayLimit) from an array into an object { "0": id, "1": id, … }. Without the
 *  object branch, a portfolio with >20 owned deals parsed to null and the Owned
 *  filter silently fell back to ALL deals. */
export function parseDealIds(raw: unknown): string[] | null {
  if (Array.isArray(raw)) return (raw as string[]).filter(Boolean);
  if (typeof raw === "string" && raw) return [raw];
  if (raw && typeof raw === "object") {
    const vals = Object.values(raw as Record<string, unknown>).filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    return vals.length > 0 ? vals : null;
  }
  return null;
}
