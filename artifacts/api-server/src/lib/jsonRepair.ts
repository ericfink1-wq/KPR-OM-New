// Dependency-free JSON extraction/repair for LLM output. Moved out of extract.ts
// so it can be shared (e.g. by the lease-risk extraction pass) and unit-tested
// without pulling in the DB layer.

/** Bump when the repair learns a new failure class: replies that failed under an older
 *  version are re-read once from their (still stored) batch — see analysisAutoRefresh. */
export const JSON_REPAIR_VERSION = 2;

export function robustParseJSON(raw: string): unknown {
  if (!raw?.trim()) throw new Error("Empty response");
  const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  try { return JSON.parse(s.replace(/,(\s*[}\]])/g, "$1")); } catch { /* fall through */ }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch { /* fall through */ }
  }
  // A COMPLETE reply can still be invalid JSON: an unescaped " inside a narrative string
  // (inch marks — 12" — or a quoted clause like "go dark") or a raw line break inside one.
  // 10/17/26: Freshwater - Stateline Plaza and Palizzi Marketplace both failed twice with
  // stop_reason=end_turn (not truncation). Repair those, then retry the earlier steps.
  if (first !== -1) {
    const fixed = escapeStrayQuotesAndControls(last > first ? s.slice(first, last + 1) : s.slice(first));
    try { return JSON.parse(fixed); } catch { /* fall through */ }
    try { return JSON.parse(fixed.replace(/,(\s*[}\]])/g, "$1")); } catch { /* fall through */ }
    try { return repairTruncatedJSON(fixed); } catch { /* fall through */ }
    try { return repairTruncatedJSON(s.slice(first)); } catch { /* fall through */ }
  }
  throw new Error("The AI's response couldn't be read as structured data — it came back incomplete or not in the expected format.");
}

/** Inside a JSON string, a `"` only ENDS the string when the next non-space character is one
 *  that can follow a string (`,` `}` `]` `:`) or the text ends; otherwise it's a stray quote in
 *  the prose and gets escaped. Raw newlines/tabs/CRs inside strings are escaped too. Never
 *  touches text outside strings. */
export function escapeStrayQuotesAndControls(s: string): string {
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!inStr) { out += c; if (c === '"') inStr = true; continue; }
    if (esc) { out += c; esc = false; continue; }
    if (c === "\\") { out += c; esc = true; continue; }
    if (c === "\n") { out += "\\n"; continue; }
    if (c === "\r") { out += "\\r"; continue; }
    if (c === "\t") { out += "\\t"; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      let ends = j >= s.length || "}]:".includes(s[j]);
      if (!ends && s[j] === ",") {
        // `"go dark", which…` is prose; `"x", "y"` / `"x", 3` / `"x", {` is JSON.
        let k = j + 1;
        while (k < s.length && /\s/.test(s[k])) k++;
        ends = k >= s.length || /["{[\d-]/.test(s[k]) || /^(true|false|null)\b/.test(s.slice(k, k + 6));
      }
      if (ends) { out += c; inStr = false; }
      else out += '\\"';
      continue;
    }
    out += c;
  }
  return out;
}

export function repairTruncatedJSON(s: string): unknown {
  let inStr = false, esc = false;
  const stack: string[] = [];
  let safeLen = -1, safeClosers = "";
  const closersFor = () => stack.map((b) => (b === "{" ? "}" : "]")).reverse().join("");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; }
    else if (c === "{" || c === "[") { stack.push(c); }
    else if (c === "}" || c === "]") { stack.pop(); safeLen = i + 1; safeClosers = closersFor(); }
    else if (c === ",") { safeLen = i; safeClosers = closersFor(); }
  }
  if (safeLen <= 0) throw new Error("Could not repair truncated JSON");
  const repaired = s.slice(0, safeLen).replace(/,\s*$/, "") + safeClosers;
  return JSON.parse(repaired);
}
