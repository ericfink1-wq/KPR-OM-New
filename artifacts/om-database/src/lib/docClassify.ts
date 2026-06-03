import type { Deal } from "./idb";
import { apiAiMessages } from "./api";
import { robustParseJSON } from "./utils";

export type DocType = "om" | "rent-roll" | "lease-options" | "sales" | "unknown";

// Deterministic detector for a lease-OPTIONS schedule (a renewal-option report,
// not a full rent roll). These list option ladders but usually lack current SF /
// rent, so they must NOT replace a roster — they only enrich existing tenants.
// Filename hint + the distinctive option-schedule column headers; we require two
// strong signals so a normal rent roll (which may say "renewal option" once)
// doesn't trip it.
export function detectLeaseOptions(text: string, fileName: string): boolean {
  const fn = fileName.toLowerCase();
  const isOm = /\b(om|offering|memorandum|teaser|flyer|brochure)\b/.test(fn);
  const t = text.slice(0, 9000).toLowerCase();
  const headers = ["option type", "option date", "term to date", "rate descriptor", "option notes", "option number"];
  const hits = headers.filter(h => t.includes(h)).length;
  if (hits >= 2) return true;                                  // unmistakable options-schedule columns
  if (!isOm && /\boption/.test(fn) && hits >= 1) return true;  // "…Options.xlsx" + a header
  return false;
}

export interface Classification {
  type: DocType;
  propertyName: string | null;
  address: string | null;
  confidence: "high" | "medium" | "low";
}

// Cheap first-pass classification: read the opening of a document and decide
// what KIND it is and which property it refers to. Uses Haiku on a truncated
// slice (classification needs the top of the doc, not the whole thing).
export async function classifyDocument(text: string, fileName: string): Promise<Classification> {
  const slice = text.slice(0, 6000);
  const prompt = `You are a commercial real estate document classifier. Given the START of a document (and its file name), identify what it is and which property it concerns.

Return ONLY JSON: {"type":"om|rent-roll|lease-options|sales|unknown","propertyName":string|null,"address":string|null,"confidence":"high|medium|low"}

Definitions:
- "om" = an Offering Memorandum / marketing package / investment sale brochure for a property (has sections like investment highlights, financials, demographics, lease abstracts).
- "rent-roll" = a tenant rent roll / lease schedule: a table of tenants with SF, rent, lease dates. NOT a marketing narrative.
- "lease-options" = a renewal-OPTIONS schedule: rows of option periods per tenant (columns like Option Type, Option Date, Term To Date, Rate, Rate Descriptor, Option Notes). It lists option ladders, usually WITHOUT current SF/rent. Distinct from a rent roll.
- "sales" = a tenant SALES report: tenant sales volumes / sales-per-SF / occupancy-cost figures, usually by year.
- "unknown" = none of the above, or can't tell.

Rules:
- propertyName / address: the subject property this document is about, if stated (clean name, no boilerplate). null if not clear.
- confidence: "high" only if the type is obvious from clear structural cues. Use the file name as a weak hint only.
- Output JSON only, no prose.

FILE NAME: ${fileName}

DOCUMENT START:
${slice}`;

  try {
    const res = await apiAiMessages({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = res.content?.[0]?.text ?? "";
    const parsed = robustParseJSON(raw) as Partial<Classification>;
    let type = (["om", "rent-roll", "lease-options", "sales", "unknown"] as const).includes(parsed.type as DocType)
      ? (parsed.type as DocType) : "unknown";
    // Deterministic override: an options schedule must never be treated as a
    // roster-replacing rent roll, so trust the column/filename signal over the LLM.
    if ((type === "rent-roll" || type === "unknown") && detectLeaseOptions(text, fileName)) type = "lease-options";
    const confidence = (["high", "medium", "low"] as const).includes(parsed.confidence as Classification["confidence"])
      ? (parsed.confidence as Classification["confidence"]) : "low";
    return {
      type,
      propertyName: typeof parsed.propertyName === "string" && parsed.propertyName.trim() ? parsed.propertyName.trim() : null,
      address: typeof parsed.address === "string" && parsed.address.trim() ? parsed.address.trim() : null,
      confidence,
    };
  } catch {
    return { type: "unknown", propertyName: null, address: null, confidence: "low" };
  }
}

// ── Deal matching ───────────────────────────────────────────────────────────

export interface DealMatch {
  deal: Deal | null;
  confidence: "high" | "medium" | "none";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Filler words common to shopping-center names that frequently differ between an
// OM and its rent roll (e.g. "Haymarket Center" vs "Haymarket Village Center", or
// "… Shopping Center" vs "… Marketplace"). Matching on the DISTINCTIVE tokens that
// remain after dropping these lets those naming variants still link.
const CENTER_FILLER = new Set([
  "the", "at", "of", "and", "on", "a", "an",
  "center", "centre", "shopping", "village", "plaza", "square", "mall", "marketplace",
  "market", "commons", "common", "crossing", "crossings", "station", "shoppes", "shops",
  "shoppe", "corner", "corners", "place", "park", "retail", "outlets", "outlet", "gateway",
  "town", "towne", "pavilion", "promenade", "galleria", "court", "junction", "village",
  "shoppingcenter", "shoppingcentre",
]);
const distinctiveTokens = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !CENTER_FILLER.has(t));

/**
 * Match a classified document to an existing deal by property name / address /
 * file name. Returns a confidence so callers can auto-commit only when sure.
 * (Generalizes UploadQueue's findDuplicate with a confidence signal.)
 */
export function matchDeal(
  hint: { propertyName?: string | null; address?: string | null; fileName?: string | null },
  existing: Deal[],
): DealMatch {
  const active = existing.filter(d => !d.trashedAt);

  // Address guard: when BOTH sides have an address, they must be compatible —
  // otherwise two different properties that share a NAME (e.g. "Crossroads Plaza"
  // in two states) would wrongly match. If either address is missing/too short we
  // can't tell, so we don't block (fall back to the name/token signals).
  const na = norm(hint.address || "");
  const addrConflict = (d: Deal) => {
    const da = norm(d.address || "");
    if (na.length < 6 || da.length < 6) return false;
    return !(na === da || na.includes(da) || da.includes(na));
  };

  // 1) Exact file-name match (strong) — but never across conflicting addresses.
  const cleanFile = (hint.fileName || "").replace(/\.(pdf|xlsx?|xlsm|xlsb|csv)$/i, "").toLowerCase().trim();
  if (cleanFile) {
    const byFile = active.find(d => (d.fileName || "").toLowerCase() === cleanFile && !addrConflict(d));
    if (byFile) return { deal: byFile, confidence: "high" };
  }

  // 2) Property-name match (rejected when the addresses clearly differ).
  const np = norm(hint.propertyName || "");
  if (np.length > 4) {
    const exact = active.find(d => { const p = norm(d.propertyName || ""); return p.length > 4 && p === np && !addrConflict(d); });
    if (exact) return { deal: exact, confidence: "high" };
    // Containment (e.g. "Maple Plaza" vs "Maple Plaza Shopping Center")
    const partial = active.find(d => { const p = norm(d.propertyName || ""); return p.length > 6 && (p.includes(np) || np.includes(p)) && !addrConflict(d); });
    if (partial) return { deal: partial, confidence: "medium" };
  }

  // 2b) Distinctive-token match — links naming variants that aren't substrings of
  // each other ("Haymarket Center" vs "Haymarket Village Center"). Require every
  // distinctive token of the shorter name to appear in the other, with at least one
  // solid (≥4-char) shared token, so generic single-word overlaps don't false-match.
  const htoks = distinctiveTokens(hint.propertyName || "");
  if (htoks.length) {
    const tokMatch = active.find(d => {
      if (addrConflict(d)) return false;
      const dtoks = distinctiveTokens(d.propertyName || "");
      if (!dtoks.length) return false;
      const [short, long] = htoks.length <= dtoks.length ? [htoks, dtoks] : [dtoks, htoks];
      const longSet = new Set(long);
      return short.every(t => longSet.has(t)) && short.some(t => t.length >= 4);
    });
    if (tokMatch) return { deal: tokMatch, confidence: "medium" };
  }

  // 3) Address match (positive signal).
  if (na.length > 8) {
    const exact = active.find(d => { const a = norm(d.address || ""); return a.length > 8 && a === na; });
    if (exact) return { deal: exact, confidence: "high" };
    const partial = active.find(d => { const a = norm(d.address || ""); return a.length > 10 && (a.includes(na) || na.includes(a)); });
    if (partial) return { deal: partial, confidence: "medium" };
  }

  return { deal: null, confidence: "none" };
}
