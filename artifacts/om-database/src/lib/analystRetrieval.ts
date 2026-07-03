// ANALYST RETRIEVAL — keeps the Analyst chat accurate AND affordable as the library
// grows to thousands of OMs. The system prompt serializes the whole library, but
// once it exceeds the context budget it progressively TRIMS every deal (rosters →
// anchors-only, heavy fields dropped, pipeline deals → stubs). That trimming is the
// data-integrity cost of scale. This module closes the gap: for each QUESTION, find
// the deals it is actually about (by property name/alias, city, or tenant brand)
// and attach their FULL, UNTRIMMED detail to that question — so the model answers
// specific questions from complete data while the (cached, byte-stable) system
// prompt carries the breadth for cross-portfolio questions.
//
// Deliberately deterministic (no extra AI call, no latency, no cost): pure string
// matching against names the user would naturally type. Only used when the system
// prompt reports it was trimmed (LIBRARY_TRIMMED_MARKER) — with a small library the
// analyst already sees everything and this stays out of the way.
import type { Deal } from "./idb";
import { tenantKey } from "./utils";

const MAX_FOCUS_DEALS = 8;         // full-detail deals per question
const MAX_BLOCK_CHARS = 90_000;    // ~35-40K tokens ceiling for the whole focus block
const norm = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Filler words that appear in most shopping-center names — matching must key on the
// DISTINCTIVE tokens ("trussville", "haymarket"), not on "center"/"plaza"/"the".
const FILLER = new Set([
  "the", "at", "of", "and", "on", "a", "an", "in",
  "center", "centre", "shopping", "village", "plaza", "square", "mall", "marketplace",
  "market", "commons", "common", "crossing", "crossings", "station", "shoppes", "shops",
  "shoppe", "corner", "corners", "place", "park", "retail", "outlets", "outlet", "gateway",
  "town", "towne", "pavilion", "promenade", "galleria", "court", "junction",
]);
const distinctiveTokens = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !FILLER.has(t));

// Fields that are storage/UI plumbing, not analysis — everything else (full roster,
// cash flow, lease risk, sales history, notes, score) is kept. This list must stay
// SMALLER than the system prompt's own omit list: the whole point is completeness.
const PLUMBING = new Set([
  "fileName", "imageMeta", "verified", "reviewQuestions", "analysisStale", "analysisVersion",
  "autoPassed", "autoPassedAt", "propertyGroupId", "updatedAt", "refreshedAt", "uploadedAt",
  "demoChecked", "marketSaleChecked", "trashedAt", "tenantsManual", "pdfPages", "editHistory",
]);

export interface FocusMatch {
  deal: Deal;
  via: "name" | "city" | "tenant";
}

// Find the deals a question is about. Match strength ordering: property name/alias
// (strongest) → city/market → tenant brand (weakest — one brand can be in dozens of
// deals, so those fill remaining slots owned-first). Returns at most MAX_FOCUS_DEALS.
export function findFocusDeals(query: string, deals: Deal[], max = MAX_FOCUS_DEALS): FocusMatch[] {
  const q = String(query || "").toLowerCase();
  const nq = norm(q);
  if (nq.length < 4) return [];
  const qTokens = new Set(q.split(/[^a-z0-9]+/).filter(t => t.length >= 4));
  const active = deals.filter(d => d && !d.trashedAt);

  const byName: Deal[] = [];
  const byCity: Deal[] = [];
  const byTenant: Deal[] = [];
  for (const d of active) {
    const names = [d.propertyName, ...(Array.isArray(d.aka) ? d.aka : [])].filter(Boolean) as string[];
    // Name/alias: the normalized name appears in the question, OR every distinctive
    // token of the name does ("trussville promenade" matches "how is trussville doing").
    const nameHit = names.some(n => {
      const nn = norm(n);
      if (nn.length >= 5 && nq.includes(nn)) return true;
      const toks = distinctiveTokens(n);
      return toks.length > 0 && toks.every(t => qTokens.has(t));
    });
    if (nameHit) { byName.push(d); continue; }
    // City/market: the normalized city appears in the question ("deals in Blue Bell"
    // → "bluebell" is a substring of the normalized question).
    const city = norm(d.city);
    if (city.length >= 4 && nq.includes(city)) {
      byCity.push(d);
      continue;
    }
    // Tenant brand: any roster brand (≥4 chars normalized) appears in the question.
    const tHit = (d.tenants || []).some(t => {
      const k = tenantKey(t.canonicalName || t.name || "");
      return k.length >= 4 && nq.includes(norm(k));
    });
    if (tHit) byTenant.push(d);
  }

  // Owned/transacted deals first within each tier — they're the ones a question
  // most often needs complete data on.
  const rank = (d: Deal) => (d.status === "Owned" ? 0 : d.status === "Under Contract" ? 1 : d.status === "Sold" ? 2 : 3);
  const sortTier = (arr: Deal[]) => [...arr].sort((a, b) => rank(a) - rank(b));

  const out: FocusMatch[] = [];
  for (const d of sortTier(byName)) { if (out.length >= max) break; out.push({ deal: d, via: "name" }); }
  for (const d of sortTier(byCity)) { if (out.length >= max) break; out.push({ deal: d, via: "city" }); }
  for (const d of sortTier(byTenant)) { if (out.length >= max) break; out.push({ deal: d, via: "tenant" }); }
  return out;
}

function serializeDeal(d: Deal): string {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (PLUMBING.has(k)) continue;
    if (v == null || v === "") continue;
    o[k] = v;
  }
  return JSON.stringify(o);
}

// Build the per-question full-detail block. Returns "" when the question matches no
// deals (cross-portfolio questions answer from the system prompt's breadth). Bounded:
// at most MAX_FOCUS_DEALS deals and MAX_BLOCK_CHARS characters, with an honest note
// when either bound dropped something — never silently pretend completeness.
export function buildFocusContext(query: string, deals: Deal[]): string {
  const matches = findFocusDeals(query, deals);
  if (matches.length === 0) return "";

  const parts: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const m of matches) {
    const json = serializeDeal(m.deal);
    if (used + json.length > MAX_BLOCK_CHARS) { dropped++; continue; }
    used += json.length;
    parts.push(json);
  }
  if (parts.length === 0) return "";

  const note = dropped > 0
    ? ` (${dropped} more matched deal${dropped === 1 ? "" : "s"} omitted for size — their trimmed entries are in the library context)`
    : "";
  return (
    `FULL DETAIL FOR THIS QUESTION — complete, untrimmed data for the ${parts.length} deal${parts.length === 1 ? "" : "s"} this question matches${note}. ` +
    `This supersedes the trimmed versions of these deals in the library context; answer from THIS data for these deals:\n` +
    parts.join("\n") +
    `\n— end of full detail —`
  );
}
