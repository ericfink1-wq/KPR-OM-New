// PROPERTY NAME FROM A FILE NAME — server copy of `nameFromFileName` in om-database
// lib/docClassify.ts (the unsaved-upload sweep needs the same read the upload queue uses).
// Pure, no imports. A web test runs both on the same file names and fails if they drift —
// change both or neither.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Broker tags and document-type labels that brokers wrap around the property name
// in a file name ("NMRK - Lake Brandon Village - Financial Narrative",
// "Frederick_County_Square_-_NMRK_OM"). Stripping them leaves the property name.
const FILE_NAME_NOISE: RegExp[] = [
  // brokers
  /\b(nmrk|newmark|cbre|jll|eastdil|colliers|berkadia|northmarq|ngkf|hff|srs|matthews|cushman\s*(&|and)\s*wakefield|c\s*&\s*w|marcus\s*(&|and)\s*millichap|avison\s+young|walker\s*(&|and)\s*dunlop|b\s*\+\s*e)\b/gi,
  // document types (multi-word first)
  /\bdetailed\s+tenant\s+underwriting\b/gi, /\btenant\s+underwriting\b/gi,
  /\bfinancial\s+narrative\b/gi, /\boffering\s+memo(randum)?\b/gi,
  /\badditional\s+info(rmation)?(\s*\d+)?\b/gi, /\brent\s*roll\b/gi,
  /\bargus(\s+cash\s*flow)?\b/gi, /\bcash\s*flow\b/gi, /\b(executive|investment)\s+summary\b/gi,
  /\boperating\s+statement\b/gi, /\bsite\s+plan\b/gi, /\bsales\s+report\b/gi,
  /\b(financials|historicals?|t-?12|om|dtu|teaser|flyer|brochure|final|draft|copy|v\d+)\b/gi,
  // copy counters and dates: "(1)", "2026", "10.12.26", "10-12-2026"
  /\(\s*\d+\s*\)/g, /\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b/g, /\b(19|20)\d{2}\b/g,
];

/**
 * Best-effort property name recovered from an upload's FILE name, for documents
 * that never print the name themselves (Newmark's Financial Narrative and Detailed
 * Tenant Underwriting ship as separate files and carry no property name). Without
 * this such a file extracts with a blank propertyName and can't be matched to the
 * OM it belongs to, so each piece of the package forks into its own deal.
 * Returns null when nothing name-like is left.
 */
export function nameFromFileName(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  let s = fileName.replace(/\.(pdf|xlsx?|xlsm|xlsb|csv)$/i, "").replace(/_/g, " ");
  for (const re of FILE_NAME_NOISE) s = s.replace(re, " ");
  const kept = s.split(/\s+[-–—|]\s+|\s*[-–—|]{2,}\s*/)
    .map(seg => seg.replace(/^[\s\-–—|,.]+|[\s\-–—|,.]+$/g, "").replace(/\s+/g, " ").trim())
    .filter(seg => norm(seg).length >= 4);
  const out = kept.join(" - ").trim();
  return norm(out).length >= 4 ? out : null;
}
