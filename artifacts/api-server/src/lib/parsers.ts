// Shared input parsers used across routes and index builders.
// toFloat -> a finite number or null; toStr -> a trimmed non-empty string or null.

export function toFloat(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

export function toStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
