// Comp-row hygiene — the ONE place a comps_index row is cleaned before it is
// stored, and the rule set the one-time cleanup sweep applies to rows already
// stored (Eric's 10/16/26 live review, items 5–9). Pure, no DB, no model.
//
// What it fixes, and why each is safe to do without a person:
//   • occupancy stored as a fraction (1, 0.97) → percent. A shopping-center comp is
//     never "1% occupied"; ≤ 1 can only be a fraction.
//   • price/SF is DERIVED: sale price ÷ SF whenever both exist. A typed-in PSF that
//     disagrees (Irmo $912 vs ~$193) is a slip; the two inputs are the facts.
//   • a value in the wrong column: a number in City ("376,462"), a non-state in
//     State, an investment strategy ("Value-Add", "Opportunistic") in Anchor, an
//     anchor name glued onto the Type ("Grocery Anchored Kings…").
//   • known typos (and any tripled letter, "Potttstown").
// What it only CLASSIFIES (never deletes):
//   • a row with neither a sale price nor a sale date is not a sale — it is the OM's
//     competitive set. It stays stored but is kept out of comp statistics.
//   • a portfolio trade / allocated price (The Point 16.6% cap inside the Cedar
//     portfolio) is flagged so it can be left out of averages.

export interface CompFields {
  name?: string | null;
  address?: string | null;
  market?: string | null;
  state?: string | null;
  saleDate?: string | null;
  salePrice?: number | null;
  capRate?: number | null;
  pricePerSf?: number | null;
  sf?: number | null;
  occupancy?: number | null;
  anchor?: string | null;
  propertyType?: string | null;
  sourceNotes?: string | null;
}

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD",
  "TN","TX","UT","VT","VA","WA","WV","WI","WY","PR",
]);

// Exact strings seen in the live comps table. Extend with real strings only.
const TYPO_FIXES: Array<[RegExp, string]> = [
  [/\bDick'?s Sporting Good sRoss\b/gi, "Dick's Sporting Goods, Ross"],
  [/\bSporting Good s\b/gi, "Sporting Goods"],
  [/\bLongviw\b/g, "Longview"],
  [/\bShopRIte\b/g, "ShopRite"],
];

// "Core" alone is left out: it is also part of real names ("CorePower Yoga", "Core Fitness").
const STRATEGY_RE = /\b(value[\s-]*add|opportunistic|core[\s-]*plus)\b/gi;
const TYPE_WORDS = /\b(lifestyle|center|centre|power|community|neighborhood|neighbourhood|strip|mixed|regional|mall|outlet|single|nnn|shadow)\b/i;

export const PORTFOLIO_NOTE = "portfolio allocation";

const clean = (s: unknown): string | null => {
  if (s == null) return null;
  const t = String(s).replace(/\s+/g, " ").trim();
  return t && t !== "—" && t !== "-" ? t : null;
};

function fixTypos(s: string | null): string | null {
  if (!s) return s;
  let out = s;
  for (const [re, to] of TYPO_FIXES) out = out.replace(re, to);
  // Any letter tripled is a keyboard slip in a place/brand name ("Potttstown").
  out = out.replace(/([A-Za-z])\1\1+/g, "$1$1");
  return out;
}

export interface NormalizeResult<T> { row: T; changes: string[] }

export function normalizeComp<T extends CompFields>(input: T): NormalizeResult<T> {
  const row = { ...input };
  const changes: string[] = [];
  const set = <K extends keyof CompFields>(k: K, v: CompFields[K], why: string) => {
    if (JSON.stringify(row[k] ?? null) === JSON.stringify(v ?? null)) return;
    (row as CompFields)[k] = v;
    changes.push(why);
  };

  // Text fields: trim, typos.
  for (const k of ["name", "address", "market", "anchor", "propertyType"] as const) {
    const v = fixTypos(clean(row[k]));
    if ((row[k] ?? null) !== v) set(k, v, `${k}: cleaned "${row[k] ?? ""}" → "${v ?? ""}"`);
  }

  // Occupancy fraction → percent.
  const occ = typeof row.occupancy === "number" ? row.occupancy : null;
  if (occ != null && occ > 0 && occ <= 1) set("occupancy", Math.round(occ * 1000) / 10, `occupancy ${occ} → ${Math.round(occ * 1000) / 10}%`);

  // Price/SF always derived from the facts it is made of.
  const price = typeof row.salePrice === "number" && row.salePrice > 0 ? row.salePrice : null;
  const sf = typeof row.sf === "number" && row.sf > 0 ? row.sf : null;
  if (price && sf) {
    const psf = Math.round((price / sf) * 100) / 100;
    const cur = typeof row.pricePerSf === "number" ? row.pricePerSf : null;
    if (cur == null || Math.abs(cur - psf) > 0.5) set("pricePerSf", psf, `price/SF ${cur ?? "blank"} → ${psf} (price ÷ SF)`);
  }

  // A number in the City column is not a city ("376,462" on ShopRite Portfolio).
  const mkt = row.market ?? null;
  if (mkt && /^[\d,.\s$]+$/.test(mkt)) set("market", null, `city "${mkt}" is a number, not a place — cleared`);

  // State must be a real two-letter code; else recover it from "City, ST" or clear it.
  const st = clean(row.state)?.toUpperCase() ?? null;
  if (st && !US_STATES.has(st)) {
    const fromMkt = /,\s*([A-Z]{2})\s*$/.exec(row.market || "")?.[1] ?? null;
    set("state", fromMkt && US_STATES.has(fromMkt) ? fromMkt : null, `state "${row.state}" is not a state`);
  } else if (st && st !== row.state) set("state", st, `state "${row.state}" → ${st}`);
  else if (!st) {
    const fromMkt = /,\s*([A-Z]{2})\s*$/.exec(row.market || "")?.[1] ?? null;
    if (fromMkt && US_STATES.has(fromMkt)) set("state", fromMkt, `state filled from "${row.market}"`);
  }

  // Investment strategy in the Anchor column → notes.
  if (row.anchor && STRATEGY_RE.test(row.anchor)) {
    STRATEGY_RE.lastIndex = 0;
    const strategy = (row.anchor.match(STRATEGY_RE) || []).join(", ");
    const rest = clean(row.anchor.replace(STRATEGY_RE, " ").replace(/^[\s,;/-]+|[\s,;/-]+$/g, ""));
    set("anchor", rest, `anchor "${row.anchor}" held a strategy ("${strategy}") — moved to notes`);
    const note = `Strategy: ${strategy}`;
    if (!(row.sourceNotes || "").includes(note)) set("sourceNotes", [row.sourceNotes, note].filter(Boolean).join(" · "), "strategy noted");
  }
  STRATEGY_RE.lastIndex = 0;
  if (row.propertyType && STRATEGY_RE.test(row.propertyType) && !TYPE_WORDS.test(row.propertyType)) {
    STRATEGY_RE.lastIndex = 0;
    const note = `Strategy: ${row.propertyType}`;
    if (!(row.sourceNotes || "").includes(note)) set("sourceNotes", [row.sourceNotes, note].filter(Boolean).join(" · "), "strategy noted");
    set("propertyType", null, `type "${row.propertyType}" is a strategy, not a center type`);
  }
  STRATEGY_RE.lastIndex = 0;

  // An anchor name glued onto the Type: "Grocery Anchored Kings Food Markets".
  const gm = /^(grocery[\s-]*anchored)\s+(.+)$/i.exec(row.propertyType || "");
  if (gm && !TYPE_WORDS.test(gm[2])) {
    const anchor = clean(gm[2]);
    set("propertyType", "Grocery Anchored", `type "${row.propertyType}" held an anchor name`);
    if (anchor && !row.anchor) set("anchor", anchor, `anchor filled from type ("${anchor}")`);
  }

  return { row, changes };
}

/** Is this row an actual SALE? No price AND no date = the OM's competitive set. */
export function isSaleComp(r: Pick<CompFields, "salePrice" | "saleDate">): boolean {
  return (typeof r.salePrice === "number" && r.salePrice > 0) || !!r.saleDate;
}

/** A portfolio trade or a price allocated out of one — not a single-asset sale. */
export function isPortfolioAllocation(r: Pick<CompFields, "name" | "sourceNotes">): boolean {
  const notes = r.sourceNotes || "";
  return new RegExp(PORTFOLIO_NOTE, "i").test(notes) || /\ballocat/i.test(notes) || /\bportfolio\b/i.test(r.name || "");
}
