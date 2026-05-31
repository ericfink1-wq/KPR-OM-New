import type { Deal } from "./idb";
import { apiAiMessages } from "./api";
import { robustParseJSON } from "./utils";

export type DocType = "om" | "rent-roll" | "sales" | "unknown";

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

Return ONLY JSON: {"type":"om|rent-roll|sales|unknown","propertyName":string|null,"address":string|null,"confidence":"high|medium|low"}

Definitions:
- "om" = an Offering Memorandum / marketing package / investment sale brochure for a property (has sections like investment highlights, financials, demographics, lease abstracts).
- "rent-roll" = a tenant rent roll / lease schedule: a table of tenants with SF, rent, lease dates. NOT a marketing narrative.
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
    const type = (["om", "rent-roll", "sales", "unknown"] as const).includes(parsed.type as DocType)
      ? (parsed.type as DocType) : "unknown";
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

  // 1) Exact file-name match (strong).
  const cleanFile = (hint.fileName || "").replace(/\.(pdf|xlsx?|xlsm|xlsb|csv)$/i, "").toLowerCase().trim();
  if (cleanFile) {
    const byFile = active.find(d => (d.fileName || "").toLowerCase() === cleanFile);
    if (byFile) return { deal: byFile, confidence: "high" };
  }

  // 2) Property-name match.
  const np = norm(hint.propertyName || "");
  if (np.length > 4) {
    const exact = active.find(d => { const p = norm(d.propertyName || ""); return p.length > 4 && p === np; });
    if (exact) return { deal: exact, confidence: "high" };
    // Containment (e.g. "Maple Plaza" vs "Maple Plaza Shopping Center")
    const partial = active.find(d => { const p = norm(d.propertyName || ""); return p.length > 6 && (p.includes(np) || np.includes(p)); });
    if (partial) return { deal: partial, confidence: "medium" };
  }

  // 3) Address match.
  const na = norm(hint.address || "");
  if (na.length > 8) {
    const exact = active.find(d => { const a = norm(d.address || ""); return a.length > 8 && a === na; });
    if (exact) return { deal: exact, confidence: "high" };
    const partial = active.find(d => { const a = norm(d.address || ""); return a.length > 10 && (a.includes(na) || na.includes(a)); });
    if (partial) return { deal: partial, confidence: "medium" };
  }

  return { deal: null, confidence: "none" };
}
