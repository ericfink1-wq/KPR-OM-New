// RETRIEVAL (#2): find the most-similar PAST deals in the library for a given deal,
// so the analysis can reason from KPR's ACTUAL portfolio instead of in a vacuum. The
// site "learns from your data" by grounding each new grade/narrative in the handful of
// closest precedents you already underwrote.
//
// Deterministic and token-free: similarity is scored in code (center type, geography,
// shared anchors, size band, cap-rate band). The model only NARRATES the comparables we
// hand it — it never picks them. Kept unit-testable (pure functions, no DB/model here).

type Deal = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[$,%\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// Normalize a tenant/brand name so "Kroger #423" and "KROGER" match. Drops store
// numbers, suite noise, and punctuation; lowercases.
function normBrand(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/#?\s*\d[\d\-]*/g, " ")           // store / suite numbers
    .replace(/\b(inc|llc|corp|co|the|store|supermarket|markets?)\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const isVacantName = (name: unknown): boolean => {
  const s = String(name ?? "").trim().toLowerCase();
  return !s || s === "-" || /^(vacant|available|avail|spec(ulative)?|white\s*box|tbd|to\s+be\s+leased)\b/.test(s);
};

// The set of anchor brands for a deal: tenants flagged isAnchor, or the largest
// occupied boxes (>= ~15k SF is an anchor in retail). Normalized for matching.
export function anchorBrands(deal: Deal): Set<string> {
  const tenants = Array.isArray(deal.tenants) ? (deal.tenants as Deal[]) : [];
  const out = new Set<string>();
  for (const t of tenants) {
    if (isVacantName(t.name)) continue;
    const sf = num(t.sf);
    if (t.isAnchor === true || (sf != null && sf >= 15000)) {
      const b = normBrand(t.name);
      if (b) out.add(b);
    }
  }
  return out;
}

// Coarse center-type family so "Grocery-Anchored Neighborhood Center" and "Grocery
// Anchored" land in the same bucket. Used for the strongest single similarity signal.
function centerFamily(deal: Deal): string {
  const s = `${str(deal.centerType)} ${str(deal.assetType)}`.toLowerCase();
  if (/grocer|supermarket/.test(s)) return "grocery";
  if (/power|big.?box|category/.test(s)) return "power";
  if (/lifestyle|town\s*center|mixed/.test(s)) return "lifestyle";
  if (/mall|regional/.test(s)) return "mall";
  if (/strip|convenience|unanchored|neighborhood|community/.test(s)) return "strip";
  if (/outlet/.test(s)) return "outlet";
  if (/single.?tenant|net.?lease|stnl/.test(s)) return "stnl";
  return s.trim() ? "other" : "";
}

export interface ComparableSummary {
  propertyName: string;
  location: string;
  centerType: string;
  totalSF: number | null;
  occupancy: number | null;
  walt: number | null;
  capRate: number | null;
  noi: number | null;
  weightedAvgRentPSF: number | null;
  grade: string | null;
  isOwned: boolean;
  sharedAnchors: string[];
  kprTake: string;
  similarity: number;
}

// Score how comparable `cand` is to `target` (0–100). Pure + deterministic.
export function similarityScore(target: Deal, cand: Deal): number {
  let score = 0;
  // Center type family — the dominant signal.
  const tf = centerFamily(target), cf = centerFamily(cand);
  if (tf && cf && tf === cf) score += 35;

  // Shared anchor brands — same anchors ≈ same economics/co-tenancy story.
  const ta = anchorBrands(target), ca = anchorBrands(cand);
  let shared = 0;
  for (const a of ta) if (ca.has(a)) shared++;
  score += Math.min(shared, 3) * 12; // up to 36

  // Geography — same state is a real market signal; same metro/city stronger.
  if (str(target.state) && str(target.state).toUpperCase() === str(cand.state).toUpperCase()) {
    score += 10;
    if (str(target.city) && str(target.city).toLowerCase() === str(cand.city).toLowerCase()) score += 6;
  }

  // Size band — within ~2x is comparable scale.
  const ts = num(target.totalSF), cs = num(cand.totalSF);
  if (ts && cs && ts > 0 && cs > 0) {
    const ratio = Math.max(ts, cs) / Math.min(ts, cs);
    if (ratio <= 1.5) score += 8;
    else if (ratio <= 2.5) score += 4;
  }

  // Cap-rate band — similar pricing tier.
  const tc = num(target.capRate), cc = num(cand.capRate);
  if (tc && cc && tc > 0 && cc > 0 && Math.abs(tc - cc) <= 0.75) score += 5;

  return score;
}

const isExcluded = (d: Deal): boolean =>
  !!(d.trashedAt || d._processing || d._processingError);

// Is this an OWNED deal (KPR actually bought it)? Owned precedents are the most
// authoritative comps — weight and label them.
export function isOwnedDeal(d: Deal): boolean {
  if (d.isOwnTransaction === true) return true;
  const status = str(d.status).toLowerCase();
  if (/own|closed|acquired|portfolio/.test(status)) return true;
  return num(d.txnPurchasePrice) != null || num(d.acqNOIAtClose) != null || str(d.txnCloseDate) !== "";
}

function toSummary(d: Deal, similarity: number, sharedAnchors: string[]): ComparableSummary {
  const grade = (() => {
    const ds = d.dealScore as Record<string, unknown> | undefined;
    const g = ds && typeof ds === "object" ? str(ds.grade) : "";
    return g || null;
  })();
  const review = str(d.dealReview);
  const thesis = str(d.dealThesis);
  const take = (review || thesis).replace(/\s+/g, " ").slice(0, 280);
  const city = str(d.city), state = str(d.state);
  return {
    propertyName: str(d.propertyName) || "(unnamed)",
    location: [city, state].filter(Boolean).join(", "),
    centerType: str(d.centerType) || str(d.assetType),
    totalSF: num(d.totalSF),
    occupancy: num(d.occupancy),
    walt: num(d.walt),
    capRate: num(d.capRate),
    noi: num(d.noi),
    weightedAvgRentPSF: num(d.weightedAvgRentPSF),
    grade,
    isOwned: isOwnedDeal(d),
    sharedAnchors,
    kprTake: take,
    similarity,
  };
}

// Find the top-N most-similar past deals to `target` from `allDeals`. Excludes the
// target itself (by id/propertyName), trashed/processing deals, and anything below a
// minimum similarity so we never inject irrelevant "comps". Owned deals get a small
// tie-break boost (a realized KPR trade is a better precedent than another OM).
export function findComparableDeals(target: Deal, allDeals: Deal[], n = 3): ComparableSummary[] {
  const targetId = str(target.id);
  const targetName = str(target.propertyName).toLowerCase();
  const targetAnchors = anchorBrands(target);
  const MIN_SCORE = 20; // require at least the center-family match or a couple shared anchors

  const scored: ComparableSummary[] = [];
  for (const cand of allDeals) {
    if (isExcluded(cand)) continue;
    if (targetId && str(cand.id) === targetId) continue;
    if (!targetId && targetName && str(cand.propertyName).toLowerCase() === targetName) continue;
    let score = similarityScore(target, cand);
    if (score < MIN_SCORE) continue;
    if (isOwnedDeal(cand)) score += 3; // tie-break toward realized precedents
    const ca = anchorBrands(cand);
    const shared = [...targetAnchors].filter((a) => ca.has(a));
    scored.push(toSummary(cand, score, shared));
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, n);
}
