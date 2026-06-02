import { db } from "@workspace/db";
import { compsIndexTable } from "@workspace/db";

const MIN_N = 4;

function pctile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function triStats(vals: number[]): { median: number; p25: number; p75: number } | null {
  if (vals.length === 0) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  return { median: pctile(sorted, 50), p25: pctile(sorted, 25), p75: pctile(sorted, 75) };
}

function parseD(s: unknown): Date | null {
  if (s == null || s === "") return null;
  const d = new Date(String(s));
  return isNaN(d.getTime()) ? null : d;
}

const COMPAT: Record<string, string[]> = {
  "community/power center": ["power center", "community/power center"],
  "power center": ["community/power center", "power center"],
};

function typesMatch(a: string, b: string): boolean {
  const al = a.toLowerCase().trim();
  const bl = b.toLowerCase().trim();
  if (al === bl) return true;
  return (COMPAT[al] ?? []).includes(bl);
}

export interface BenchmarkRequest {
  dealId: string;
  market?: string | null;
  state?: string | null;
  propertyType?: string | null;
  sf?: number | null;
  capRate?: number | null;
  pricePerSf?: number | null;
  excludeOmComps?: boolean;
  /** Remove these comp IDs from the benchmark math (still shown dulled in UI) */
  excludeCompIds?: number[];
  /** Force-add these comp IDs into the benchmark set (bypass tier filtering) */
  includeCompIds?: number[];
  /** Starred comps — force-included AND weighted more heavily in the median/range math */
  starCompIds?: number[];
  // Extra subject signals for smart similarity matching:
  occupancy?: number | null;
  /** Subject's lead anchor tenant name(s), comma-separated */
  anchor?: string | null;
  /** True if the subject's lead anchor is investment-grade */
  anchorIG?: boolean;
}

export interface CompMatch {
  id: number;
  name: string | null;
  sourceDealName: string | null;
  market: string | null;
  saleDate: string | null;
  salePrice: number | null;
  capRate: number | null;
  pricePerSf: number | null;
  sf: number | null;
  anchor: string | null;
  source: "owned" | "broker" | "om";
  // Extra "about the center" detail for the expandable row on the deal page.
  address?: string | null;
  state?: string | null;
  occupancy?: number | null;
  propertyType?: string | null;
  buyer?: string | null;
  seller?: string | null;
  sourceNotes?: string | null;
  sourceDealId?: string | null;
  /** True when manually excluded — still returned for display but not counted in stats */
  excluded: boolean;
  /** True when the user starred this comp (force-included + weighted in stats) */
  starred?: boolean;
  /** Smart-match similarity score + plain-English reasons (when computed) */
  matchScore?: number;
  matchReasons?: string[];
}

export interface BenchmarkResult {
  insufficient: boolean;
  tierLabel: string;
  relaxed: string[];
  excludedInvalid: number;
  n: number;
  dateRange: { from: string; to: string } | null;
  sourceMix: { owned: number; broker: number; om: number };
  capRate: { median: number; p25: number; p75: number } | null;
  pricePerSf: { median: number; p25: number; p75: number } | null;
  last12: {
    n: number;
    capRate: { median: number; p25: number; p75: number } | null;
    pricePerSf: { median: number; p25: number; p75: number } | null;
  } | null;
  capDeltaBps: number | null;
  psfDeltaPct: number | null;
  comps: CompMatch[];
  /** How many comps were auto-included by smart similarity matching */
  smartMatched: number;
  /** Ranked, medium-similarity comps offered for one-tap add (not yet counted) */
  suggestions: CompMatch[];
  subject: { capRate: number | null; pricePerSf: number | null };
}

type Row = typeof compsIndexTable.$inferSelect;

function getSource(r: Row): "owned" | "broker" | "om" {
  if (r.isOwnTransaction) return "owned";
  if (r.isManual) return "broker";
  return "om";
}

export async function computeBenchmark(req: BenchmarkRequest): Promise<BenchmarkResult> {
  const now = new Date();
  const allRows = await db.select().from(compsIndexTable);

  let excludedInvalid = 0;

  const valid = allRows.filter(row => {
    if (row.sourceDealId === req.dealId) return false;
    if (!row.salePrice || row.salePrice <= 0)              { excludedInvalid++; return false; }
    if (!row.saleDate)                                      { excludedInvalid++; return false; }
    const sd = parseD(row.saleDate);
    if (!sd || sd > now)                                    { excludedInvalid++; return false; }
    if (row.capRate != null && (row.capRate < 3 || row.capRate > 12)) { excludedInvalid++; return false; }
    if (row.pricePerSf != null && (row.pricePerSf <= 0 || row.pricePerSf > 2000)) { excludedInvalid++; return false; }
    return true;
  });

  const pool = req.excludeOmComps ? valid.filter(r => r.isOwnTransaction || r.isManual) : valid;

  const mAgo = (n: number) => new Date(now.getTime() - n * 30.44 * 86400000);
  const cut24 = mAgo(24);
  const cut36 = mAgo(36);

  const inDate = (r: Row, cut: Date) => { const d = parseD(r.saleDate); return d != null && d >= cut; };

  const stateOk = (r: Row) => {
    if (!req.state) return true;
    const s = req.state.toLowerCase();
    if (r.state) return r.state.toLowerCase() === s;
    return (r.market ?? "").toLowerCase().includes(s) ||
           (r.sourceDealMarket ?? "").toLowerCase().includes(s);
  };

  const typeOk = (r: Row) =>
    !!req.propertyType && !!r.propertyType && typesMatch(req.propertyType, r.propertyType);

  const sfOk = (r: Row) => {
    if (!req.sf || !r.sf) return true;
    return r.sf >= req.sf * 0.5 && r.sf <= req.sf * 2;
  };

  // ── Smart similarity scoring ──────────────────────────────────────────────
  // Ranks each comp against the subject on anchor, region, type, size,
  // occupancy, cap and recency. Strong matches auto-join the benchmark; medium
  // matches are returned as one-tap suggestions.
  const STRONG_SCORE = 55, MEDIUM_SCORE = 25;
  const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const IG_ANCHORS = new Set(["walmart", "target", "kroger", "publix", "costco", "homedepot", "lowes", "cvs", "walgreens", "tjmaxx", "marshalls", "ross", "rossdressforless", "dollargeneral", "dollartree", "fivebelow", "bestbuy", "aldi", "wholefoods", "traderjoes", "sprouts", "samsclub", "heb", "albertsons", "safeway", "wegmans"]);
  const subjAnchorsRaw = (req.anchor || "").split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const subjAnchors = subjAnchorsRaw.map(normName).filter(a => a.length >= 3);
  const reqMarketN = normName(req.market || "");

  const scoreComp = (r: Row): { score: number; reasons: string[] } => {
    let score = 0; const reasons: string[] = [];
    const cAnchors = (r.anchor || "").split(/[,;]/).map(s => normName(s)).filter(Boolean);
    let anchorHit = -1;
    for (let i = 0; i < subjAnchors.length; i++) {
      if (cAnchors.some(ca => ca.length >= 3 && (ca.includes(subjAnchors[i]) || subjAnchors[i].includes(ca)))) { anchorHit = i; break; }
    }
    if (anchorHit >= 0) { score += 40; reasons.push(`same anchor: ${subjAnchorsRaw[anchorHit]}`); }
    if (req.state && stateOk(r)) { score += 18; reasons.push("same state"); }
    if (reqMarketN && r.market && (normName(r.market).includes(reqMarketN) || reqMarketN.includes(normName(r.market)))) { score += 12; reasons.push("same MSA"); }
    if (typeOk(r)) { score += 12; reasons.push("same type"); }
    if (req.sf && r.sf) {
      const ratio = r.sf / req.sf;
      if (ratio >= 0.8 && ratio <= 1.25) { score += 12; reasons.push("similar size"); }
      else if (ratio >= 0.55 && ratio <= 1.8) { score += 6; }
    }
    if (req.occupancy != null && r.occupancy != null) {
      const d = Math.abs(r.occupancy - req.occupancy);
      if (d <= 5) { score += 8; reasons.push("similar occupancy"); }
      else if (d <= 12) { score += 4; }
    }
    if (req.capRate != null && r.capRate != null) {
      const d = Math.abs(r.capRate - req.capRate);
      if (d <= 0.5) score += 6; else if (d <= 1) score += 3;
    }
    if (req.anchorIG && cAnchors.some(ca => IG_ANCHORS.has(ca))) { score += 6; reasons.push("IG anchor"); }
    if (inDate(r, cut24)) score += 6; else if (inDate(r, cut36)) score += 3;
    return { score, reasons };
  };

  const scoreMap = new Map<number, { score: number; reasons: string[] }>();
  for (const r of pool) scoreMap.set(r.id, scoreComp(r));

  const TIERS = [
    { label: "same state, same type, similar size, last 24 months", relaxed: [] as string[],
      fn: (r: Row) => stateOk(r) && typeOk(r) && sfOk(r) && inDate(r, cut24) },
    { label: "same state, same type, last 36 months", relaxed: ["size"],
      fn: (r: Row) => stateOk(r) && typeOk(r) && inDate(r, cut36) },
    { label: "national, same type, last 36 months", relaxed: ["size", "geography"],
      fn: (r: Row) => typeOk(r) && inDate(r, cut36) },
    { label: "same market, any type, last 36 months", relaxed: ["size", "property type"],
      fn: (r: Row) => stateOk(r) && inDate(r, cut36) },
  ];

  let chosen: Row[] = [];
  let tierLabel = "no matching comps";
  let relaxed: string[] = [];
  let insufficient = false;

  for (const t of TIERS) {
    const c = pool.filter(t.fn);
    if (c.length >= MIN_N) { chosen = c; tierLabel = t.label; relaxed = t.relaxed; break; }
  }

  if (chosen.length === 0) {
    // Show directional data if < MIN_N found — but do NOT fall back to the full unfiltered pool
    for (let i = TIERS.length - 1; i >= 0; i--) {
      const c = pool.filter(TIERS[i].fn);
      if (c.length > 0) { chosen = c; tierLabel = TIERS[i].label; relaxed = TIERS[i].relaxed; break; }
    }
    // If still empty, n=0 empty state is returned (no pool fallback)
    insufficient = true;
  } else if (chosen.length < MIN_N) {
    insufficient = true;
  }

  // Force-add specific comps from allRows (bypass tier logic). Starred comps are
  // also force-included (a star implies "definitely use this one").
  const starSet = new Set(req.starCompIds ?? []);
  const incSet = new Set([...(req.includeCompIds ?? []), ...starSet]);
  if (incSet.size > 0) {
    const alreadyIds = new Set(chosen.map(r => r.id));
    const extra = allRows.filter(r =>
      incSet.has(r.id) &&
      !alreadyIds.has(r.id) &&
      r.sourceDealId !== req.dealId
    );
    chosen = [...chosen, ...extra];
  }

  // Auto-include strongly-similar comps (smart matching) beyond the tier set.
  const preStrongIds = new Set(chosen.map(r => r.id));
  const strongMatches = pool.filter(r => !preStrongIds.has(r.id) && (scoreMap.get(r.id)?.score ?? 0) >= STRONG_SCORE);
  chosen = [...chosen, ...strongMatches];
  const smartMatched = strongMatches.length;

  // Suggestions = medium-similarity comps not already in the set (one-tap add).
  const chosenIds = new Set(chosen.map(r => r.id));
  const suggestions: CompMatch[] = pool
    .filter(r => !chosenIds.has(r.id))
    .map(r => ({ r, s: scoreMap.get(r.id)?.score ?? 0 }))
    .filter(x => x.s >= MEDIUM_SCORE && x.s < STRONG_SCORE)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map(({ r, s }) => ({
      id: r.id, name: r.name, sourceDealName: r.sourceDealName, market: r.market, saleDate: r.saleDate,
      salePrice: r.salePrice, capRate: r.capRate, pricePerSf: r.pricePerSf, sf: r.sf,
      anchor: r.anchor ?? null,
      source: getSource(r), excluded: false,
      matchScore: s, matchReasons: scoreMap.get(r.id)?.reasons ?? [],
    }));

  // Separate active vs excluded for stats — excluded comps are still returned for display
  const excSet = new Set(req.excludeCompIds ?? []);
  const activeForStats = chosen.filter(r => !excSet.has(r.id));

  // Starred comps count multiple times in the median/range math so the user can
  // tell the system "this is a really good comp." Counts (n, sourceMix, dates)
  // still reflect the true comp set — only the stats inputs are weighted.
  const STAR_WEIGHT = 3;
  const wt = (r: Row) => (starSet.has(r.id) ? STAR_WEIGHT : 1);
  const weighted = (rows: Row[], val: (r: Row) => number | null): number[] => {
    const out: number[] = [];
    for (const r of rows) { const v = val(r); if (v != null) for (let i = 0; i < wt(r); i++) out.push(v); }
    return out;
  };

  const capRates = weighted(activeForStats, r => r.capRate);
  const psfs     = weighted(activeForStats, r => r.pricePerSf);

  const capRateStats = triStats(capRates);
  const psfStats     = triStats(psfs);

  const cut12  = mAgo(12);
  const l12    = activeForStats.filter(r => inDate(r, cut12));
  const l12cap = weighted(l12, r => r.capRate);
  const l12psf = weighted(l12, r => r.pricePerSf);
  const last12 = l12.length >= 3 ? { n: l12.length, capRate: triStats(l12cap), pricePerSf: triStats(l12psf) } : null;

  const sourceMix = { owned: 0, broker: 0, om: 0 };
  for (const r of activeForStats) sourceMix[getSource(r)]++;

  const dates     = activeForStats.map(r => r.saleDate).filter((d): d is string => d != null).sort();
  const dateRange = dates.length > 0
    ? { from: dates[0], to: dates[dates.length - 1] }
    : null;

  const capDeltaBps = req.capRate != null && capRateStats != null
    ? Math.round((req.capRate - capRateStats.median) * 100) : null;
  const psfDeltaPct = req.pricePerSf != null && psfStats != null && psfStats.median > 0
    ? Math.round((req.pricePerSf - psfStats.median) / psfStats.median * 100) : null;

  // Return all comps (including excluded ones, tagged with excluded: true)
  const comps: CompMatch[] = [...chosen]
    .sort((a, b) => (b.saleDate ?? "").localeCompare(a.saleDate ?? ""))
    .map(r => ({
      id: r.id, name: r.name, sourceDealName: r.sourceDealName, market: r.market, saleDate: r.saleDate,
      salePrice: r.salePrice, capRate: r.capRate, pricePerSf: r.pricePerSf, sf: r.sf,
      anchor: r.anchor ?? null,
      address: r.address ?? null, state: r.state ?? null, occupancy: r.occupancy ?? null,
      propertyType: r.propertyType ?? null, buyer: r.buyer ?? null, seller: r.seller ?? null,
      sourceNotes: r.sourceNotes ?? null, sourceDealId: r.sourceDealId ?? null,
      source: getSource(r),
      excluded: excSet.has(r.id),
      starred: starSet.has(r.id),
      matchScore: scoreMap.get(r.id)?.score,
      matchReasons: scoreMap.get(r.id)?.reasons,
    }));

  return {
    insufficient, tierLabel, relaxed, excludedInvalid,
    n: activeForStats.length,   // n = active (non-excluded) count
    dateRange, sourceMix,
    capRate: capRateStats, pricePerSf: psfStats, last12,
    capDeltaBps, psfDeltaPct, comps, smartMatched, suggestions,
    subject: { capRate: req.capRate ?? null, pricePerSf: req.pricePerSf ?? null },
  };
}
