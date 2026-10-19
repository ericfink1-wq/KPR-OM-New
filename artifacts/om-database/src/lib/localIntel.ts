// Local Intel on the deal page (pure helpers; the scan runs server-side). Tests:
// __tests__/localIntelUi.test.ts.
import type { IntelFinding, IntelCategory } from "./api";

export const INTEL_CATEGORY_LABEL: Record<IntelCategory, string> = {
  competing_supply: "Competing supply", tenant_health: "Tenant health", demand: "Demand drivers",
  access: "Access & infrastructure", municipal: "Municipal", property: "Property-specific",
};

export const INTEL_CATEGORY_ORDER: IntelCategory[] = ["competing_supply", "tenant_health", "demand", "access", "municipal", "property"];
const SEV_RANK = { high: 0, medium: 1, low: 2 } as const;
/** Every finding grouped by category (fixed order), each group by severity then newest first. Empty groups omitted. */
export function groupByCategory(fs: IntelFinding[]): Array<[IntelCategory, IntelFinding[]]> {
  return INTEL_CATEGORY_ORDER
    .map(c => [c, fs.filter(f => f.category === c).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || (b.date ?? "").localeCompare(a.date ?? ""))] as [IntelCategory, IntelFinding[]])
    .filter(([, items]) => items.length > 0);
}

/** "Jun 2026" / "Jun 12, 2026" from YYYY-MM or YYYY-MM-DD. */
export function fmtIntelDate(d: string | null): string | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(d);
  if (!m) return d;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1));
  return dt.toLocaleDateString("en-US", m[3] ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" } : { month: "short", year: "numeric", timeZone: "UTC" });
}
export function fmtDistance(f: Pick<IntelFinding, "distanceMiles" | "distanceBasis">): string | null {
  if (f.distanceMiles == null) return null;
  const n = f.distanceMiles < 10 ? f.distanceMiles.toFixed(1).replace(/\.0$/, "") : String(Math.round(f.distanceMiles));
  return `${f.distanceBasis === "geocoded" ? "" : "~"}${n} mi`;
}
/** "~1 mi · Jun 2026 · upcoming" */
export function intelMeta(f: IntelFinding): string {
  return [fmtDistance(f), fmtIntelDate(f.date), f.forwardLooking ? "upcoming" : null].filter(Boolean).join(" · ");
}

const live = (fs: IntelFinding[]) => fs.filter(f => !f.dismissed);

/** High-severity negatives → the deal's red-flag list (live, not stored on the deal). */
export function intelRedFlags(fs: IntelFinding[]): Array<{ severity: "high"; description: string }> {
  return live(fs).filter(f => f.impact === "negative" && f.severity === "high").map(f => ({
    severity: "high",
    description: `**Local Intel — ${f.headline}.** ${f.whyItMatters}${intelMeta(f) ? ` (${intelMeta(f)}; per ${f.sources[0]?.title ?? "local news"})` : ""}`,
  }));
}
/** Positives (medium/high) → the upside list. */
export function intelUpside(fs: IntelFinding[]): Array<{ priority: string; item: string; detail: string }> {
  return live(fs).filter(f => f.impact === "positive" && f.severity !== "low").map(f => ({
    priority: f.severity, item: `Local Intel — ${f.headline}`,
    detail: `${f.whyItMatters}${intelMeta(f) ? ` (${intelMeta(f)}; per ${f.sources[0]?.title ?? "local news"})` : ""}`,
  }));
}
/** Audit view of a scan's searches: what actually ran, and planned searches the model skipped. */
export function searchAudit(rec: { queries: string[]; queriesRun?: string[] }): { ran: string[]; skipped: string[]; known: boolean } {
  const ran = rec.queriesRun ?? [];
  if (!rec.queriesRun) return { ran: [], skipped: [], known: false };     // scans before 10/19/26 didn't log them
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const ranSet = ran.map(norm);
  // A planned search counts as run when a run query shares most of its words (the model may reword).
  const covered = (p: string) => { const w = norm(p).split(" ").filter(t => t.length > 2); return ranSet.some(r => w.filter(t => r.includes(t)).length >= Math.ceil(w.length * 0.7)); };
  return { ran, skipped: rec.queries.filter(p => !covered(p)), known: true };
}

/** Only http(s) links are ever rendered. */
export const safeHref = (u: string): string | null => /^https?:\/\//i.test(u) ? u : null;
