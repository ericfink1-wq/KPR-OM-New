// DETERMINISTIC CO-TENANCY TRIGGER-STRUCTURE CHECK.
//
// The single most damaging co-tenancy extraction error is collapsing an "X of N"
// requirement into a per-anchor trigger. A clause reading
//
//   "2 of the following must be open and operating: i) Hobby Lobby ii) Belk iii) Ross"
//
// modeled as OR(Hobby Lobby dark, Belk dark, Ross dark) says ONE anchor going dark
// trips it. The clause actually needs TWO dark. That single mis-read turned Town N'
// Country's Belk Tier-1 exposure into $1,015,131 across 6 tenants when the true
// figure is $68,875 across 1 — a ~15x overstatement of the headline risk number.
//
// A prompt rule alone can't be trusted with something this consequential, so this
// module re-derives the structure from the clause's OWN verbatim quote and compares:
//   • detectXofNMismatch  — the quote states a count but the trigger is per-anchor.
//   • repairCoTenancyTrigger — rebuild as an anchor_count_below leaf, but ONLY when
//     the quote's named list matches the anchors the model already put in the
//     trigger. The anchor SET is never changed; only the count semantics the quote
//     states verbatim are applied. When the sets disagree we flag and change nothing.
//
// Pure + DB-free so both the extraction pass and the re-audit sweep can use it.
// FAITHFUL PORT of api-server/src/lib/coTenancyStructure.ts — keep the two in sync.
// Used here for the LIVE, token-free warning on the Lease Risk panel: the exposure
// figures render straight off the trigger tree, so a clause that disagrees with its
// own quote has to say so right where the number is shown, not only after a re-audit.

export interface TriggerLeafLike {
  type?: string;
  anchor?: string | null;
  anchors?: string[] | null;
  openRequired?: number | null;
  totalNamed?: number | null;
  scope?: string | null;
  direction?: string | null;
  pct?: number | null;
  note?: string | null;
}
export type TriggerNodeLike =
  | { operator: "AND" | "OR"; conditions: TriggerNodeLike[] }
  | TriggerLeafLike;

export interface CoTenancyLike {
  triggerLogic?: TriggerNodeLike | null;
  verbatimQuote?: string | null;
}

const isBranch = (n: TriggerNodeLike | null | undefined): n is { operator: "AND" | "OR"; conditions: TriggerNodeLike[] } =>
  !!n && typeof n === "object" && "operator" in n && Array.isArray((n as { conditions?: unknown }).conditions);

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Normalise an anchor/store name for set comparison (mirrors the leaseRisk engine). */
export function anchorKey(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/['’.,]/g, "")
    .replace(/\b(inc|llc|lp|corp|co|the|sporting goods|stores?|salon|dress for less)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every named-anchor leaf in a trigger tree, in order. */
export function collectAnchorLeaves(node: TriggerNodeLike | null | undefined): TriggerLeafLike[] {
  if (!node) return [];
  if (isBranch(node)) return node.conditions.flatMap(collectAnchorLeaves);
  return node.anchor ? [node] : [];
}

/** True when the tree already carries an "X of N" (anchor_count_below) leaf. */
export function hasCountLeaf(node: TriggerNodeLike | null | undefined): boolean {
  if (!node) return false;
  if (isBranch(node)) return node.conditions.some(hasCountLeaf);
  return /count/i.test(String(node.type ?? "")) && Array.isArray(node.anchors) && node.anchors.length > 0;
}

/**
 * True when the named anchors sit at the TOP level of an OR (or the trigger is a
 * single bare anchor leaf) — i.e. each one trips the clause on its own. This is the
 * shape an "X of N" clause must never have. Anchors nested inside an AND branch are
 * already a multi-event structure and are left alone.
 */
export function isPerAnchorTrigger(node: TriggerNodeLike | null | undefined): boolean {
  if (!node) return false;
  if (!isBranch(node)) return !!node.anchor;
  if (node.operator !== "OR") return false;
  const direct = node.conditions.filter((c) => !isBranch(c) && (c as TriggerLeafLike).anchor);
  return direct.length > 0;
}

export interface ParsedXofN {
  openRequired: number;
  totalNamed: number | null;
  named: string[];
}

/**
 * Recover an "X of N must be open and operating" requirement from a clause quote.
 * Handles the shapes brokers actually print:
 *   "2 of the following must be open and operating i) Hobby Lobby ii) Belk iii) Ross"
 *   "3 of the following must be open and operating i) Ross, Hobby Lobby, Ulta, Belk"
 *   "at least 7 of these 10 Key Stores must remain open"
 *   "two of the following must be open"
 * Returns null when there is no count phrase (a bare "the following must be open and
 * operating: i) Belk" is a genuine single-anchor clause, not an X-of-N).
 */
export function parseXofN(quote: string | null | undefined): ParsedXofN | null {
  const q = String(quote ?? "").replace(/\s+/g, " ").trim();
  if (!q) return null;
  if (!/open\s+and\s+operat|remain\s+open|stay\s+open|continuously\s+operat|be\s+open/i.test(q)) return null;

  const numTok = `(\\d{1,2}|${Object.keys(WORD_NUMBERS).join("|")})`;
  // "<X> of [the] [following|these|those] [<N>]" — covers "2 of the following",
  // "at least 7 of these 10", "5 of 10 Named Tenants" and "3 of the following 10".
  const m = new RegExp(
    `(?:at\\s+least\\s+)?${numTok}\\s+of\\s+(?:the\\s+)?(following|these|those)?\\s*(\\d{1,2})?`, "i",
  ).exec(q);
  if (!m || (!m[2] && !m[3])) return null;

  const rawX = m[1].toLowerCase();
  const openRequired = /^\d+$/.test(rawX) ? Number(rawX) : WORD_NUMBERS[rawX];
  if (!openRequired || openRequired < 1) return null;
  const totalFromPhrase = m[3] ? Number(m[3]) : null;

  const named = parseNamedList(q.slice(m.index + m[0].length));
  return {
    openRequired,
    totalNamed: totalFromPhrase ?? (named.length || null),
    named,
  };
}

/**
 * Pull the enumerated store list out of the text after the count phrase. Brokers
 * enumerate with roman numerals, digits or letters, and sometimes cram the whole
 * list behind a single "i)" as a comma series — handle both.
 */
export function parseNamedList(tail: string): string[] {
  const text = String(tail ?? "")
    // stop at the next requirement sentence so a trailing occupancy prong or the
    // next footnote doesn't get swallowed into the named list
    .split(/(?:shopping\s+center\s+)?occupancy\s+requirement|termination\s+right|recovery\s+method|go[-\s]?dark/i)[0]
    .replace(/^[\s:;,.–—-]*(?:must\s+be\s+open\s+and\s+operating|must\s+remain\s+open|must\s+stay\s+open|be\s+open\s+and\s+operating|are\s+open\s+and\s+operating)?/i, "")
    .trim();
  if (!text) return [];

  // roman numerals longest-first so "viii" doesn't truncate to "vi"
  const ROMAN = "viii|vii|xii|xi|ix|iv|vi|iii|ii|x|v|i";
  const marker = new RegExp(`(?:^|\\s)\\(?(?:${ROMAN}|\\d{1,2}|[a-h])(?:\\)|\\.(?=\\s))`, "gi");
  const parts: string[] = [];
  let last: number | null = null;
  let mm: RegExpExecArray | null;
  while ((mm = marker.exec(text)) != null) {
    if (last != null) parts.push(text.slice(last, mm.index));
    last = mm.index + mm[0].length;
  }
  if (last != null) parts.push(text.slice(last));

  const items = parts.length ? parts : [text];
  const out: string[] = [];
  for (const p of items) {
    // a single marker may hold a comma series ("i) Ross, Hobby Lobby, Ulta and Belk")
    for (const piece of p.split(/,|\band\b|\/|;/i)) {
      const name = piece
        .replace(/^(?:either|both|or)\b/i, "")
        .replace(/[^A-Za-z0-9&'’ .-]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^[\s.\-]+|[\s.\-]+$/g, "")
        .trim();
      if (name.length >= 2 && /[A-Za-z]/.test(name) && !/^(the|following|these|those|of|open|operating|and|or|either)$/i.test(name)) {
        out.push(name);
      }
    }
  }
  return out;
}

export type StructureVerdict =
  | { kind: "ok" }
  | { kind: "repairable"; parsed: ParsedXofN; anchors: string[]; darkNeeded: number }
  | { kind: "mismatch"; parsed: ParsedXofN; anchors: string[]; reason: string };

/**
 * Compare a clause's modeled trigger against its own quote.
 *  • "ok"         — no count phrase, or the trigger already models the count.
 *  • "repairable" — the quote states X-of-N and the parsed store list matches the
 *                   anchors already in the trigger, so the count can be applied
 *                   without inventing or dropping a single store name.
 *  • "mismatch"   — the quote states X-of-N but the lists disagree; flag for a human.
 */
export function checkCoTenancyStructure(clause: CoTenancyLike): StructureVerdict {
  const trigger = clause?.triggerLogic;
  if (!trigger || hasCountLeaf(trigger) || !isPerAnchorTrigger(trigger)) return { kind: "ok" };

  const parsed = parseXofN(clause?.verbatimQuote);
  if (!parsed) return { kind: "ok" };

  const anchors = collectAnchorLeaves(trigger).map((l) => String(l.anchor)).filter(Boolean);
  if (anchors.length < 2) return { kind: "ok" };

  const quoteSet = new Set(parsed.named.map(anchorKey).filter(Boolean));
  const trigSet = new Set(anchors.map(anchorKey).filter(Boolean));
  const sameSet = quoteSet.size === trigSet.size && [...trigSet].every((k) => quoteSet.has(k));

  // A list that disagrees with the quote is flagged whatever the count says — the
  // set check must come FIRST, or a disagreeing list hides behind the count
  // short-circuit below and reads as "ok".
  if (!sameSet) {
    return {
      kind: "mismatch", parsed, anchors,
      reason: `the clause names ${parsed.named.length ? parsed.named.join(", ") : "a list that could not be parsed"} but the trigger was built from ${anchors.join(", ")}`,
    };
  }
  // openRequired >= N means "all of them must stay open", which genuinely IS a
  // per-anchor trigger — the model's shape is already right.
  if (parsed.openRequired >= anchors.length) return { kind: "ok" };
  return { kind: "repairable", parsed, anchors, darkNeeded: anchors.length - parsed.openRequired + 1 };
}

export interface RepairResult {
  clause: CoTenancyLike;
  repaired: boolean;
  verdict: StructureVerdict;
}

/**
 * Apply the high-confidence repair: replace the top-level per-anchor OR leaves with
 * a single anchor_count_below leaf carrying the quote's count. Any non-anchor
 * sibling (an occupancy-threshold prong) is preserved as a separate OR branch — those
 * are independent triggers and must never be folded into the count.
 */
export function repairCoTenancyTrigger<T extends CoTenancyLike>(clause: T): RepairResult & { clause: T } {
  const verdict = checkCoTenancyStructure(clause);
  if (verdict.kind !== "repairable") return { clause, repaired: false, verdict };

  const { parsed, anchors, darkNeeded } = verdict;
  const note =
    `${parsed.openRequired}-of-${anchors.length} co-tenancy: ${darkNeeded === 1 ? "one" : darkNeeded} of the named stores must go dark before it trips` +
    (darkNeeded > 1 ? " — a SINGLE anchor going dark does NOT trip this clause." : ".");
  const countLeaf: TriggerLeafLike = {
    type: "anchor_count_below",
    anchors,
    openRequired: parsed.openRequired,
    totalNamed: anchors.length,
    note,
  };

  const trigger = clause.triggerLogic!;
  let next: TriggerNodeLike;
  if (!isBranch(trigger)) {
    next = countLeaf;
  } else {
    // keep every non-anchor branch/leaf (occupancy prongs, nested ANDs) untouched
    const others = trigger.conditions.filter((c) => isBranch(c) || !(c as TriggerLeafLike).anchor);
    next = others.length ? { operator: "OR", conditions: [countLeaf, ...others] } : countLeaf;
  }
  return { clause: { ...clause, triggerLogic: next }, repaired: true, verdict };
}
