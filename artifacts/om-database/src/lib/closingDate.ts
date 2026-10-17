// A property is Sold only once the sale has officially CLOSED (Eric, 10/16/26). Until then
// it is plain Owned — the site records nothing about a pending or contemplated sale
// (Eric, 10/17/26), so the only sale data is the closing date / price / buyer of a sale
// that actually closed.

/** A real calendar closing date (mirrors the server's rule). */
export function isClosingDate(v: unknown): boolean {
  if (typeof v !== "string" || !v.trim()) return false;
  return Number.isFinite(Date.parse(v.trim())) && /\d{4}/.test(v);
}
