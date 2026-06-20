// GROUND-TRUTH CALIBRATION (#1): learn how OM-stated figures systematically differ from
// what KPR actually realized on the deals it CLOSED, then feed that bias back into both
// extraction (flag optimistic OM numbers) and analysis (de-bias the grade). This is the
// other half of "the site learns from your data": every owned deal teaches the analyst
// how much to trust a broker's headline NOI / cap rate / occupancy.
//
// Deterministic + token-free: the bias is pure arithmetic over owned deals (OM-stated vs
// realized). Kept unit-testable (no DB/model here). The realized truth lives in the
// acquisition / transaction fields KPR enters by hand after closing:
//   - acqNOIAtClose   — actual in-place NOI at close   (vs OM `noi`)
//   - acqCapRate      — realized going-in cap rate      (vs OM `capRate`)
//   - txnPurchasePrice— actual price paid               (vs OM `askingPrice`)
// Occupancy uses the post-close roster occupancy vs the OM-stated occupancy when both
// are present.

type Deal = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[$,%\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// Same owned-deal test as comparables (kept local so this module is standalone).
export function isOwnedClosedDeal(d: Deal): boolean {
  if (d.trashedAt) return false;
  if (d.isOwnTransaction === true) return true;
  const status = str(d.status).toLowerCase();
  if (/own|closed|acquired|portfolio/.test(status)) return true;
  return num(d.txnPurchasePrice) != null || num(d.acqNOIAtClose) != null || str(d.txnCloseDate) !== "";
}

// One metric's learned bias: how the OM figure compares to the realized figure, as a
// median signed % difference across the owned deals that disclose both.
export interface MetricBias {
  metric: "noi" | "capRate" | "occupancy" | "price";
  n: number;                 // owned deals with both OM + realized values
  medianBiasPct: number;     // median of (om - realized) / realized * 100
  direction: "optimistic" | "conservative" | "neutral";
}

export interface PortfolioCalibration {
  ownedDeals: number;
  biases: MetricBias[];
  // A compact, prompt-ready summary the analysis injects — empty when too little data.
  guidance: string;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// At least this many owned deals must disclose a metric pair before we trust the bias —
// below it, one outlier dominates and we stay silent rather than teach a wrong rule.
const MIN_OWNED_FOR_BIAS = 4;
// Ignore sub-1% noise; only call a direction when the median bias is material.
const MATERIAL_BIAS_PCT = 1.5;

function biasFor(
  metric: MetricBias["metric"],
  owned: Deal[],
  omKey: string,
  realizedKeys: string[],
): MetricBias | null {
  const diffs: number[] = [];
  for (const d of owned) {
    const om = num(d[omKey]);
    let realized: number | null = null;
    for (const k of realizedKeys) { const v = num(d[k]); if (v != null) { realized = v; break; } }
    if (om == null || realized == null || realized === 0) continue;
    // Guard against unit slips polluting the bias (e.g. a cap stored as bps) — skip
    // pairs that differ by more than 3x, which are data errors, not real bias.
    const ratio = Math.max(Math.abs(om), Math.abs(realized)) / Math.max(1e-9, Math.min(Math.abs(om), Math.abs(realized)));
    if (ratio > 3) continue;
    diffs.push(((om - realized) / realized) * 100);
  }
  if (diffs.length < MIN_OWNED_FOR_BIAS) return null;
  const m = Math.round(median(diffs) * 10) / 10;
  // For cap rate, a LOWER OM figure (cap compressed) is the "optimistic" direction, so
  // invert the sense; for NOI/occupancy/price a HIGHER OM figure is optimistic.
  const optimisticWhenPositive = metric !== "capRate";
  let direction: MetricBias["direction"] = "neutral";
  if (Math.abs(m) >= MATERIAL_BIAS_PCT) {
    const omHigher = m > 0;
    const isOptimistic = optimisticWhenPositive ? omHigher : !omHigher;
    direction = isOptimistic ? "optimistic" : "conservative";
  }
  return { metric, n: diffs.length, medianBiasPct: m, direction };
}

const LABEL: Record<MetricBias["metric"], string> = {
  noi: "OM-stated NOI", capRate: "OM-stated cap rate",
  occupancy: "OM-stated occupancy", price: "asking price",
};

// Compute the portfolio-wide OM-vs-realized calibration from all deals.
export function computePortfolioCalibration(allDeals: Deal[]): PortfolioCalibration {
  const owned = allDeals.filter(isOwnedClosedDeal);
  const biases: MetricBias[] = [];
  const push = (b: MetricBias | null) => { if (b) biases.push(b); };
  push(biasFor("noi", owned, "noi", ["acqNOIAtClose"]));
  push(biasFor("capRate", owned, "capRate", ["acqCapRate"]));
  push(biasFor("price", owned, "askingPrice", ["txnPurchasePrice"]));
  push(biasFor("occupancy", owned, "occupancy", ["realizedOccupancy", "actualOccupancy"]));

  const lines: string[] = [];
  for (const b of biases) {
    if (b.direction === "neutral") continue;
    const mag = Math.abs(b.medianBiasPct);
    if (b.metric === "noi" || b.metric === "price") {
      lines.push(`${LABEL[b.metric]} has historically run ~${mag}% ${b.direction === "optimistic" ? "ABOVE" : "below"} what KPR realized at close (across ${b.n} owned deals) — ${b.direction === "optimistic" ? "haircut a broker's headline accordingly" : "the figures have proven conservative"}.`);
    } else if (b.metric === "capRate") {
      lines.push(`OM-marketed cap rates have run ~${mag}% ${b.direction === "optimistic" ? "TIGHTER (lower)" : "wider (higher)"} than KPR's realized going-in cap (across ${b.n} owned deals) — ${b.direction === "optimistic" ? "the true going-in yield tends to be lower than the OM implies" : "realized yield beat the OM"}.`);
    } else {
      lines.push(`${LABEL[b.metric]} has run ~${mag}% ${b.direction === "optimistic" ? "above" : "below"} the post-close roster (across ${b.n} owned deals).`);
    }
  }
  const guidance = lines.length
    ? `GROUND-TRUTH CALIBRATION (learned from KPR's ${owned.length} owned deals — OM-stated vs what KPR actually realized at close): ${lines.join(" ")} Apply this as a reality check on THIS deal's OM-stated figures; do not blindly accept an optimistic headline.`
    : "";

  return { ownedDeals: owned.length, biases, guidance };
}
