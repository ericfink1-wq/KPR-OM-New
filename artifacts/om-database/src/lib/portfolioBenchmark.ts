// Benchmark a deal against COMPARABLE deals in your own portfolio — "use the database
// to get smarter." For each of three metrics (going-in cap rate, expense ratio, and
// in-place rent PSF) we compute the peer median + p25/p75 across same-center-type deals
// (falling back to the whole book when there aren't enough peers), then read where this
// deal sits. Deterministic, no model. Informational — it changes no stored numbers.
import type { Deal } from "./idb";

export type Metric = "capRate" | "expenseRatio" | "rentPSF";

export interface MetricBenchmark {
  metric: Metric;
  label: string;
  subject: number;
  median: number;
  p25: number;
  p75: number;
  n: number;
  peerGroup: string;           // "strip centers" / "your portfolio"
  geoCaveat?: boolean;         // true for rent PSF (varies by market — directional)
  read: string;                // one-line interpretation
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ── Per-deal metric extractors (with validity bands to drop junk) ──────────────
export function dealCapRatePct(d: Deal): number | null {
  const v = num(d.capRate) ?? num(d.acqCapRate);
  if (v == null) return null;
  const pct = v <= 1 ? v * 100 : v; // tolerate 0.0725 or 7.25
  return pct >= 1 && pct <= 14 ? Math.round(pct * 100) / 100 : null;
}
export function dealExpenseRatioPct(d: Deal): number | null {
  const opex = num(d.operatingExpenses);
  const egi = num(d.effectiveGrossIncome) ?? num(d.grossPotentialRent);
  if (opex == null || egi == null || egi <= 0) return null;
  const pct = (opex / egi) * 100;
  return pct >= 5 && pct <= 75 ? Math.round(pct * 10) / 10 : null;
}
export function dealRentPSF(d: Deal): number | null {
  const v = num(d.weightedAvgRentPSF);
  return v != null && v >= 2 && v <= 250 ? Math.round(v * 100) / 100 : null;
}

const quantile = (sorted: number[], q: number): number => {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
};

// Collapse the free-text centerType into a controlled bucket so peer-grouping isn't
// fragmented by wording — the library has ~19 spellings of ~7 real formats (e.g.
// "Community Center (Kohl's ground-lease anchored; dark Winn-Dixie)", "Multi-Anchor
// Power Center", "Grocery-Anchored Neighborhood Center"). Grocery-anchoring is the
// dominant retail distinction (necessity vs discretionary), so any grocery mention
// buckets there; otherwise the primary format keyword wins. This is for GROUPING
// only — the stored centerType and what the deal page displays are untouched.
export function canonicalCenterType(s: string | null | undefined): string | null {
  const t = (s || "").toLowerCase();
  if (!t.trim()) return null;
  if (t.includes("grocery")) return "Grocery-Anchored";
  if (t.includes("outlet")) return "Outlet Center";
  if (t.includes("lifestyle")) return "Lifestyle Center";
  if (t.includes("mall")) return "Regional Mall";
  if (t.includes("power")) return "Power Center";
  if (t.includes("community")) return "Community Center";
  if (t.includes("neighborhood") || t.includes("neighbourhood")) return "Neighborhood Center";
  if (t.includes("strip") || t.includes("unanchored")) return "Strip Center";
  if (t.includes("single") && t.includes("tenant")) return "Single-Tenant / Net Lease";
  return null;   // unrecognized → no bucket; benchmarks fall back to the whole book
}
const normType = (s: string | null | undefined): string => {
  const c = canonicalCenterType(s);
  return c ? c.toLowerCase().replace(/[^a-z]/g, "") : "";
};

interface MetricSpec { metric: Metric; label: string; fn: (d: Deal) => number | null; minPeers: number; geoCaveat?: boolean; }
const SPECS: MetricSpec[] = [
  { metric: "capRate",       label: "Going-in cap rate",  fn: dealCapRatePct,       minPeers: 3 },
  { metric: "expenseRatio",  label: "Expense ratio",      fn: dealExpenseRatioPct,  minPeers: 3 },
  { metric: "rentPSF",       label: "In-place rent PSF",  fn: dealRentPSF,          minPeers: 4, geoCaveat: true },
];

const fmtPct = (n: number) => `${n.toFixed(n >= 10 ? 1 : 2)}%`;
const fmtPSF = (n: number) => `$${n.toFixed(2)}`;

function readVerdict(spec: MetricSpec, subject: number, p25: number, p75: number, peerGroup: string, n: number): string {
  const peers = `${n} comparable ${peerGroup}`;
  if (spec.metric === "capRate") {
    if (subject > p75) return `Cheaper going-in yield than most of your book (above the ${fmtPct(p75)} p75 of ${peers}) — confirm the higher cap isn't compensating for real risk.`;
    if (subject < p25) return `Richer (lower yield) than most of your book (below the ${fmtPct(p25)} p25 of ${peers}) — make sure the quality/growth justifies paying up.`;
    return `In the normal band for your portfolio (${peers}).`;
  }
  if (spec.metric === "expenseRatio") {
    if (subject > p75) return `Opex load heavier than your portfolio (above the ${fmtPct(p75)} p75 of ${peers}) — check recovery leakage / a high-cost or gross-leased center; thin NNN recovery erodes NOI.`;
    if (subject < p25) return `Leaner than your book (below the ${fmtPct(p25)} p25 of ${peers}) — well-recovered / efficient, or expenses may be understated; sanity-check.`;
    return `Typical expense load for your portfolio (${peers}).`;
  }
  // rentPSF
  if (subject < p25) return `In-place rents sit below your comparable centers (under the ${fmtPSF(p25)} p25 of ${peers}) — potential mark-to-market UPSIDE; confirm against the local market (rents vary by metro).`;
  if (subject > p75) return `In-place rents above your comparable centers (over the ${fmtPSF(p75)} p75 of ${peers}) — limited mark-to-market and some rolldown risk on renewal; confirm rents are sustainable.`;
  return `In line with your portfolio's rents (${peers}) — directional, since rents vary by market.`;
}

export function buildPortfolioBenchmarks(deal: Deal, allDeals: Deal[]): MetricBenchmark[] {
  const subjType = normType(deal.centerType);
  const pool = (allDeals || []).filter(d => d.id !== deal.id && !d.trashedAt);
  const out: MetricBenchmark[] = [];

  for (const spec of SPECS) {
    const subject = spec.fn(deal);
    if (subject == null) continue;

    // Prefer same-center-type peers; fall back to the whole book if too few.
    let peerGroup = "your portfolio";
    let peerDeals = pool;
    if (subjType) {
      const sameType = pool.filter(d => normType(d.centerType) === subjType);
      const sameVals = sameType.map(spec.fn).filter((v): v is number => v != null);
      if (sameVals.length >= spec.minPeers) {
        peerDeals = sameType;
        peerGroup = `${(canonicalCenterType(deal.centerType) || deal.centerType!).toLowerCase()} deals`;
      }
    }
    const vals = peerDeals.map(spec.fn).filter((v): v is number => v != null).sort((a, b) => a - b);
    if (vals.length < spec.minPeers) continue;

    const median = quantile(vals, 0.5);
    const p25 = quantile(vals, 0.25);
    const p75 = quantile(vals, 0.75);
    out.push({
      metric: spec.metric, label: spec.label, subject,
      median: Math.round(median * 100) / 100, p25: Math.round(p25 * 100) / 100, p75: Math.round(p75 * 100) / 100,
      n: vals.length, peerGroup, geoCaveat: spec.geoCaveat,
      read: readVerdict(spec, subject, p25, p75, peerGroup, vals.length),
    });
  }
  return out;
}

export const fmtMetric = (m: Metric, v: number): string => m === "rentPSF" ? fmtPSF(v) : fmtPct(v);
