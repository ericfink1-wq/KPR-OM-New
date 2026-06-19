// PORTFOLIO ISSUES SUMMARY — the engine behind the centralized feedback console.
// Scans every active deal's open issues (the fresh deterministic audit + the stored AI
// low-confidence captures + arithmetic/missing checks) and GROUPS them by issue type, so
// a recurring extraction problem shows up as a trend ("occupancy captured as a fraction —
// 7 deals") instead of being fixed one deal at a time. Pure + deterministic (no DB, no
// model) so it's testable and free; the route just feeds it the rows.

import { auditExtraction, auditCheckKey, AUDIT_CHECK_LABELS } from "./extractionAudit";

type Sev = "high" | "medium" | "low";
const RANK: Record<Sev, number> = { high: 0, medium: 1, low: 2 };
const asSev = (v: unknown): Sev => (v === "high" || v === "medium" || v === "low") ? v : "medium";

export interface IssueGroup {
  key: string;
  label: string;
  severity: Sev;                 // highest severity seen in the group
  kind: "audit" | "ai" | "arithmetic" | "other";
  count: number;                 // total open occurrences
  dealCount: number;             // distinct deals affected
  deals: { id: string; name: string }[];
  sample: string;                // one example question, for context
}
export interface PortfolioIssues {
  groups: IssueGroup[];
  totalOpen: number;
  dealsWithIssues: number;
  scanned: number;
}

// Map one review question to a stable GROUP key + human label + kind. audit-* collapse to
// their check key (so per-tenant/per-suite ids cluster); AI captures cluster by field.
function classify(q: Record<string, unknown>): { key: string; label: string; kind: IssueGroup["kind"] } {
  const id = String(q.id || "");
  if (id.startsWith("audit-")) { const k = auditCheckKey(id); return { key: k, label: AUDIT_CHECK_LABELS[k] || k, kind: "audit" }; }
  if (id.startsWith("src-")) return { key: "src-scanned-pdf", label: "Scanned / unreadable OM", kind: "audit" };
  if (id.startsWith("calc-")) return { key: id, label: String(q.field || "Arithmetic check"), kind: "arithmetic" };
  if (id.startsWith("tax-")) return { key: "tax-capture", label: "Property-tax capture", kind: "arithmetic" };
  if (id === "missing-core") return { key: "missing-core", label: "Missing core fields", kind: "other" };
  const field = String(q.field || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return field
    ? { key: `ai:${field}`, label: `AI capture — ${q.field}`, kind: "ai" }
    : { key: "ai-low-confidence", label: "AI low-confidence captures", kind: "ai" };
}

export function summarizePortfolioIssues(rows: { id: string; data: Record<string, unknown> }[]): PortfolioIssues {
  const groups = new Map<string, IssueGroup>();
  const dealsHit = new Set<string>();
  let totalOpen = 0, scanned = 0;

  for (const r of rows) {
    const data = r.data;
    if (!data || data.trashedAt || data._processing || data._processingError) continue;
    scanned++;
    const name = String(data.propertyName || data.fileName || "Untitled");
    const stored = Array.isArray(data.reviewQuestions) ? (data.reviewQuestions as Array<Record<string, unknown>>) : [];
    const resolvedIds = new Set(stored.filter((q) => q?.resolvedAt).map((q) => String(q?.id || "")));

    const issues: Array<Record<string, unknown>> = [];
    // Fresh deterministic audit (always current), minus anything already resolved.
    for (const q of auditExtraction(data)) if (!resolvedIds.has(q.id)) issues.push(q as unknown as Record<string, unknown>);
    // Stored OPEN non-audit questions (AI captures, calc/tax/missing). audit-* are handled
    // fresh above; anomaly-* are computed client-side, so they aren't aggregated here.
    for (const q of stored) {
      if (q?.resolvedAt || !q?.question) continue;
      const id = String(q?.id || "");
      if (id.startsWith("audit-") || id.startsWith("src-") || id.startsWith("anomaly-")) continue;
      issues.push(q);
    }

    if (issues.length) dealsHit.add(r.id);
    for (const q of issues) {
      totalOpen++;
      const { key, label, kind } = classify(q);
      const sev = asSev(q.severity);
      let g = groups.get(key);
      if (!g) { g = { key, label, severity: sev, kind, count: 0, dealCount: 0, deals: [], sample: String(q.question || "") }; groups.set(key, g); }
      g.count++;
      if (RANK[sev] < RANK[g.severity]) g.severity = sev;
      if (!g.deals.some((d) => d.id === r.id)) g.deals.push({ id: r.id, name });
      if (!g.sample && q.question) g.sample = String(q.question);
    }
  }

  for (const g of groups.values()) g.dealCount = g.deals.length;
  const out = [...groups.values()].sort((a, b) =>
    RANK[a.severity] - RANK[b.severity] || b.count - a.count || a.label.localeCompare(b.label));
  return { groups: out, totalOpen, dealsWithIssues: dealsHit.size, scanned };
}
