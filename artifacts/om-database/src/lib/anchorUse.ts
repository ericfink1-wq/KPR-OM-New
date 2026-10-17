// What counts as an ANCHOR (Eric, 10/16/26): grocery, big-box, junior-box and
// entertainment uses. An office / coworking user (IWG/Regus on Township Plaza), a
// medical practice, a bank or a service tenant is NOT an anchor even when it is the
// biggest tenant or the data marks it isAnchor — call it the "largest tenant" and
// never compare it to anchor/chain benchmarks.
import { classifyTenant } from "./retailCategory";

const OFFICE_RE = /\b(iwg|regus|spaces|wework|industrious|regus\/|hq global|executive suites?|coworking|co-working|office(?! ?(?:depot|max))|offices|corporate (?:hq|headquarters)|realty|insurance|law (?:firm|office)|attorneys?|cpa|accounting)\b/i;
const NOT_ANCHOR_CATEGORIES = new Set(["Health & Medical", "Financial & Telecom", "Personal Services"]);

export function isNonAnchorUse(name: string | null | undefined): boolean {
  const n = String(name || "");
  if (!n.trim()) return false;
  if (OFFICE_RE.test(n)) return true;
  return NOT_ANCHOR_CATEGORIES.has(classifyTenant(n).category);
}

/** A tenant that should be treated as an anchor: flagged (or a 20k+ SF box) AND an anchor-type use. */
export function isAnchorUse(t: { name?: string | null; isAnchor?: boolean | null; sf?: number | string | null }, minBoxSF = 20000): boolean {
  if (isNonAnchorUse(t.name)) return false;
  const sf = Number(t.sf) || 0;
  return t.isAnchor === true || sf >= minBoxSF;
}
