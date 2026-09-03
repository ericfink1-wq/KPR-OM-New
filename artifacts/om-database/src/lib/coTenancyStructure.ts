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
  | { kind: "repairable"; parsed: ParsedXofN; anchors: string[]; darkNeeded: number; slots: string[][] }
  | { kind: "mismatch"; parsed: ParsedXofN; anchors: string[]; reason: string; compoundSlot: boolean };

/** Word tokens, for boundary-safe matching ("Ross" must not match "Crossing"). */
function tokens(s: string): string[] {
  return anchorKey(s).split(" ").filter(Boolean);
}
/** Does `hay` contain `needle`'s tokens as a contiguous run? */
function containsTokens(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Is a two-anchor slot joined by a plain "or"? Looks ONLY at the tokens BETWEEN the
 * two names, so trailing interleaved column text ("… Excludes utilities and snow")
 * can't be mistaken for the conjunction.
 */
function slotIsDisjunctive(slot: string[], pair: string[]): boolean {
  const pos = pair.map((a) => {
    const at = tokens(a);
    for (let i = 0; i <= slot.length - at.length; i++) {
      if (at.every((t, j) => slot[i + j] === t)) return { start: i, end: i + at.length };
    }
    return null;
  });
  if (pos.some((p) => p == null)) return false;
  const [a, b] = (pos as { start: number; end: number }[]).sort((x, y) => x.start - y.start);
  const between = slot.slice(a.end, b.start);
  return between.length > 0 && between.every((t) => t === "or");
}

/**
 * Compare a clause's modeled trigger against its own quote.
 *  • "ok"         — no count phrase, or the trigger already models the count.
 *  • "repairable" — the quote's enumerated slots line up 1:1 with the anchors the
 *                   model already chose, so the count can be applied without
 *                   inventing or dropping a single store name.
 *  • "mismatch"   — the quote states X-of-N but the two can't be reconciled; flag.
 *
 * RECONCILIATION IS BY CONTAINMENT, NOT EQUALITY. A rent-roll table extracted from
 * a PDF comes out COLUMN-INTERLEAVED: the real Town N' Country text reads
 * "i) Hobby Lobby 3% Non-Cumulative CAM Cap Option 3 $12.00 ii) Belk on
 * Controllables Option 4 $12.50 …", with recovery-method and option-rent text
 * glued into each enumerated slot. Requiring the parsed names to EQUAL the
 * trigger's anchors fails on every such clause, so the repair never fired on the
 * document that motivated it. What survives interleaving is (a) the count, which
 * sits contiguous right after "X of the following", and (b) each anchor NAME
 * appearing somewhere inside its own slot. So: find which slot each anchor lands
 * in, and require a clean 1:1 placement.
 */
export function checkCoTenancyStructure(clause: CoTenancyLike): StructureVerdict {
  const trigger = clause?.triggerLogic;
  if (!trigger || hasCountLeaf(trigger) || !isPerAnchorTrigger(trigger)) return { kind: "ok" };

  const parsed = parseXofN(clause?.verbatimQuote);
  if (!parsed) return { kind: "ok" };

  const anchors = collectAnchorLeaves(trigger).map((l) => String(l.anchor)).filter(Boolean);
  if (anchors.length < 2) return { kind: "ok" };

  // Which enumerated slot does each anchor fall in? (token-boundary matching, so
  // "Ross" doesn't match "Wake Forest Crossing")
  const slotTokens = parsed.named.map(tokens);
  const placement = anchors.map((a) => {
    const at = tokens(a);
    return slotTokens.reduce<number[]>((acc, st, i) => (containsTokens(st, at) ? [...acc, i] : acc), []);
  });

  const missing = anchors.filter((_, i) => placement[i].length === 0);
  if (missing.length) {
    return {
      kind: "mismatch", parsed, anchors, compoundSlot: false,
      reason: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} in the trigger but ${missing.length === 1 ? "does" : "do"} not appear in the clause text`,
    };
  }

  // Group anchors by the slot they landed in. Anchors sharing a slot are a COMPOUND
  // slot ("iii) Either Ross or Ulta"): the slot stays satisfied while EITHER is
  // open, so it fails only when BOTH go dark.
  const slotOwners = new Map<number, string[]>();
  anchors.forEach((a, i) => {
    for (const s of placement[i]) slotOwners.set(s, [...(slotOwners.get(s) ?? []), a]);
  });
  const slots = [...slotOwners.entries()].sort((a, b) => a[0] - b[0]).map(([i, a]) => ({ i, anchors: a }));

  // A shared slot is only safe to act on when the clause literally says OR between
  // the two names. "X and Y" in one slot means the opposite (the slot fails when
  // EITHER goes dark), and anything else is unreadable — flag rather than guess.
  for (const sl of slots) {
    if (sl.anchors.length < 2) continue;
    if (sl.anchors.length > 2 || !slotIsDisjunctive(slotTokens[sl.i], sl.anchors)) {
      return {
        kind: "mismatch", parsed, anchors, compoundSlot: true,
        reason: `${sl.anchors.join(" / ")} share one entry in the clause and the conjunction between them is not a plain "or" — a count cannot express that slot`,
      };
    }
  }

  // openRequired >= N means "all of them must stay open", which genuinely IS a
  // per-anchor trigger — the model's shape is already right. N is the SLOT count,
  // not the anchor count (a compound slot is one slot holding two anchors).
  const n = slots.length;
  if (parsed.openRequired >= n) return { kind: "ok" };
  return {
    kind: "repairable", parsed, anchors,
    darkNeeded: n - parsed.openRequired + 1,
    slots: slots.map((s) => s.anchors),
  };
}

/** All ways to choose k items from xs (order-insensitive). */
function choose<T>(xs: T[], k: number): T[][] {
  if (k <= 0 || k > xs.length) return [];
  if (k === xs.length) return [xs.slice()];
  if (k === 1) return xs.map((x) => [x]);
  const [head, ...rest] = xs;
  return [...choose(rest, k - 1).map((c) => [head, ...c]), ...choose(rest, k)];
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

  const { parsed, darkNeeded, slots } = verdict;
  const n = slots.length;
  const note =
    `${parsed.openRequired}-of-${n} co-tenancy: ${darkNeeded === 1 ? "one" : darkNeeded} of the named slots must fail before it trips` +
    (darkNeeded > 1 ? " — a SINGLE anchor going dark does NOT trip this clause." : ".");

  let rebuilt: TriggerNodeLike;
  if (slots.every((sl) => sl.length === 1)) {
    // Plain X-of-N — the engine models this natively and it reads clearly.
    rebuilt = {
      type: "anchor_count_below",
      anchors: slots.map((sl) => sl[0]),
      openRequired: parsed.openRequired,
      totalNamed: n,
      note,
    };
  } else {
    // A compound slot can't be a flat count, so expand to the explicit set of
    // failure combinations: pick `darkNeeded` slots, AND together every anchor in
    // them. Nothing is invented — slots come from the clause's own enumeration,
    // anchors from the trigger, the count from the quote.
    const combos = choose(slots, darkNeeded);
    if (!combos.length || combos.length > 60) return { clause, repaired: false, verdict };
    rebuilt = {
      operator: "OR",
      conditions: combos.map((combo) => {
        const names = combo.flat();
        const leaves = names.map((a) => ({ type: "named_anchor_dark", anchor: a, note } as TriggerLeafLike));
        return leaves.length === 1 ? leaves[0] : { operator: "AND" as const, conditions: leaves };
      }),
    };
  }

  const trigger = clause.triggerLogic!;
  let next: TriggerNodeLike;
  if (!isBranch(trigger)) {
    next = rebuilt;
  } else {
    // keep every non-anchor branch/leaf (occupancy prongs, nested ANDs) untouched
    const others = trigger.conditions.filter((c) => isBranch(c) || !(c as TriggerLeafLike).anchor);
    next = others.length ? { operator: "OR", conditions: [rebuilt, ...others] } : rebuilt;
  }
  return { clause: { ...clause, triggerLogic: next }, repaired: true, verdict };
}
