// SELF-MAINTAINING DATA INTEGRITY. One deterministic, token-free pass that runs on
// EVERY deal write (import, edit, roster paste, create) so the database keeps itself
// clean as it grows — the operator shouldn't have to remember to press "auto-fix" or
// "re-audit". Two stages, both pure (no model, no network):
//   1. applyImportFixes — the SAFE, unambiguous corrections (occupancy-cost fractions,
//      duplicate tenant rows, recomputed roster metrics honoring `verified` locks). It
//      deliberately never touches rent or deal-level figures — those stay FLAGGED.
//   2. refresh the deterministic audit questions — re-run the arithmetic integrity audit
//      and self-heal: drop audit-* questions that now pass, keep resolved ones (no
//      re-nag), never touch AI / lease-risk questions, add new contradictions.
// The result is that the audit a deal page shows is always CURRENT, with zero operator
// action, and the same logic powers the one-click "scrub everything" sweep over legacy
// deals.

import { applyImportFixes } from "./importFixes";
import { auditExtraction, AUDIT_ID_PREFIX } from "./extractionAudit";

export interface MaintainResult {
  data: Record<string, unknown>;
  changed: boolean;
  occCostFixed: number;
  dupeFixed: number;
  metricFixes: number;
  dateFixed: number;
  rentFilled: number;
  auditAdded: number;
  auditCleared: number;
}

// Self-healing merge of a freshly-computed audit into a deal's reviewQuestions.
// Mirrors the bulk /deals/reaudit logic so a per-write refresh and a portfolio sweep
// behave identically.
export function mergeAuditQuestions(
  data: Record<string, unknown>,
  fresh: { id: string }[],
): { questions: Array<Record<string, unknown>>; added: number; cleared: number } {
  const freshIds = new Set(fresh.map((q) => q.id));
  const existing = Array.isArray(data.reviewQuestions) ? (data.reviewQuestions as Array<Record<string, unknown>>) : [];
  const kept = existing.filter((q) => {
    const id = String(q?.id || "");
    if (!id.startsWith(AUDIT_ID_PREFIX)) return true;   // AI / lease-risk / other — keep
    if (q?.resolvedAt) return true;                      // already resolved — keep, don't re-nag
    return freshIds.has(id);                             // unresolved audit q: keep only if still failing
  });
  const keptIds = new Set(kept.map((q) => String(q?.id || "")));
  const newOnes = (fresh as Array<Record<string, unknown>>).filter((q) => !keptIds.has(String(q.id)));
  return { questions: [...kept, ...newOnes], added: newOnes.length, cleared: existing.length - kept.length };
}

// Run the full maintenance pass on one deal's data. Returns a NEW data object (never
// mutates the input) plus a breakdown of what changed, so callers can log/aggregate.
// A deal must never be saved without a property name (Eric, 10/16/26 — three records
// showed up as raw file names / blanks: "Blue Bell Site Plan OM- Revised" and two NMRK
// Lake Brandon add-on files). Fall back to the name recovered from the file name,
// the way the upload screen does, and finally to the bare file name.
const FILE_NOISE: RegExp[] = [
  /\b(nmrk|newmark|cbre|jll|eastdil|colliers|berkadia|northmarq|ngkf|hff|srs|matthews|cushman\s*(&|and)\s*wakefield|marcus\s*(&|and)\s*millichap|avison\s+young)\b/gi,
  /\bdetailed\s+tenant\s+underwriting\b/gi, /\btenant\s+underwriting\b/gi, /\bfinancial\s+narrative\b/gi,
  /\boffering\s+memo(randum)?\b/gi, /\badditional\s+info(rmation)?(\s*\d+)?\b/gi, /\brent\s*roll\b/gi,
  /\bsite\s+plan\b/gi, /\b(executive|investment)\s+summary\b/gi, /\bcash\s*flow\b/gi,
  /\b(financials|om|dtu|teaser|flyer|brochure|final|draft|copy|revised|v\d+)\b/gi,
  /\(\s*\d+\s*\)/g, /\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b/g, /\b(19|20)\d{2}\b/g,
];
export function propertyNameFromFile(fileName: unknown): string | null {
  if (typeof fileName !== "string" || !fileName.trim()) return null;
  let s = fileName.replace(/\.(pdf|xlsx?|xlsm|xlsb|csv|json)$/i, "").replace(/_/g, " ");
  for (const re of FILE_NOISE) s = s.replace(re, " ");
  s = s.split(/\s*[-–—|]+\s*/).map(x => x.trim()).filter(x => x.replace(/[^a-z0-9]/gi, "").length >= 3).join(" - ").trim();
  return s.replace(/[^a-z0-9]/gi, "").length >= 4 ? s : null;
}
export function ensurePropertyName(data: Record<string, unknown>): boolean {
  if (typeof data.propertyName === "string" && data.propertyName.trim()) return false;
  const bare = typeof data.fileName === "string" ? data.fileName.replace(/\.(pdf|xlsx?|xlsm|xlsb|csv|json)$/i, "").trim() : "";
  data.propertyName = propertyNameFromFile(data.fileName) || bare || "Untitled property";
  return true;
}

export function autoMaintainDealData(input: Record<string, unknown>): MaintainResult {
  ensurePropertyName(input);
  const fix = applyImportFixes(input);
  const data = fix.deal;
  const fresh = auditExtraction(data);
  const { questions, added, cleared } = mergeAuditQuestions(data, fresh);
  const auditChanged = added > 0 || cleared > 0;
  if (auditChanged) data.reviewQuestions = questions;
  return {
    data,
    changed: fix.changed || auditChanged,
    occCostFixed: fix.occCostFixed,
    dupeFixed: fix.dupeFixed,
    metricFixes: fix.metricFixes,
    dateFixed: fix.dateFixed,
    rentFilled: fix.rentFilled,
    auditAdded: added,
    auditCleared: cleared,
  };
}
