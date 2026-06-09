// Deterministic comp-benchmark SUMMARY for the AI analyst.
//
// Cardinal comp rule (CLAUDE.md): the APP computes comp stats in CODE; Claude only
// NARRATES the structured output. So we compute medians/percentiles HERE and hand
// the analyst a finished summary — never raw rows for it to average. Mirrors the
// server benchmark's validity gate (salePrice>0, no future sale date, cap 3–12%,
// price/SF 0–2000) and its MIN_N so thin samples don't produce verdicts. Medians
// (never means); owned > broker/manual > OM-sourced tiers are surfaced as a mix.

const MIN_N = 4;

export interface CompInput {
  capRate?: number | null;
  pricePerSf?: number | null;
  salePrice?: number | null;
  saleDate?: string | null;
  sf?: number | null;
  state?: string | null;
  market?: string | null;
  isManual?: boolean | null;
  isOwnTransaction?: boolean | null;
}

interface Triple { median: number; p25: number; p75: number; }
interface Bucket { n: number; capRate: Triple | null; pricePerSf: Triple | null; }
export interface CompsSummary {
  n: number;                 // valid comps after the gate
  excludedInvalid: number;
  insufficient: boolean;     // n < MIN_N — suppress verdicts, the analyst should say so
  dateRange: { from: string; to: string } | null;
  sourceMix: { owned: number; brokerManual: number; omSourced: number };
  capRate: Triple | null;
  pricePerSf: Triple | null;
  last12mo: Bucket;
  byState: Array<{ state: string; n: number; capRateMedian: number | null; pricePerSfMedian: number | null }>;
}

const _n = (v: unknown): number | null =>
  (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);

function pctile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function triple(values: number[]): Triple | null {
  const v = values.filter(x => x != null && !isNaN(x)).sort((a, b) => a - b);
  if (v.length < MIN_N) return null;
  return {
    median: Math.round(pctile(v, 0.5) * 100) / 100,
    p25: Math.round(pctile(v, 0.25) * 100) / 100,
    p75: Math.round(pctile(v, 0.75) * 100) / 100,
  };
}

/** Build a finished, narration-ready comp benchmark summary, or null if no comps. */
export function buildCompsSummary(rows: CompInput[]): CompsSummary | null {
  if (!rows || !rows.length) return null;
  const now = new Date();
  let excludedInvalid = 0;

  const valid = rows.filter(r => {
    const price = _n(r.salePrice);
    if (price == null || price <= 0) { excludedInvalid++; return false; }
    if (!r.saleDate) { excludedInvalid++; return false; }
    const sd = new Date(String(r.saleDate));
    if (isNaN(sd.getTime()) || sd > now) { excludedInvalid++; return false; }
    const cap = _n(r.capRate);
    if (cap != null && (cap < 3 || cap > 12)) { excludedInvalid++; return false; }
    const psf = _n(r.pricePerSf);
    if (psf != null && (psf <= 0 || psf > 2000)) { excludedInvalid++; return false; }
    return true;
  });

  if (!valid.length) {
    return { n: 0, excludedInvalid, insufficient: true, dateRange: null,
      sourceMix: { owned: 0, brokerManual: 0, omSourced: 0 },
      capRate: null, pricePerSf: null,
      last12mo: { n: 0, capRate: null, pricePerSf: null }, byState: [] };
  }

  const dates = valid.map(r => String(r.saleDate)).sort();
  const sourceMix = {
    owned: valid.filter(r => r.isOwnTransaction).length,
    brokerManual: valid.filter(r => !r.isOwnTransaction && r.isManual).length,
    omSourced: valid.filter(r => !r.isOwnTransaction && !r.isManual).length,
  };

  const caps = valid.map(r => _n(r.capRate)).filter((x): x is number => x != null);
  const psfs = valid.map(r => _n(r.pricePerSf)).filter((x): x is number => x != null);

  const cut12 = new Date(now.getTime() - 365 * 86400000);
  const recent = valid.filter(r => new Date(String(r.saleDate)) >= cut12);
  const last12mo: Bucket = {
    n: recent.length,
    capRate: triple(recent.map(r => _n(r.capRate)).filter((x): x is number => x != null)),
    pricePerSf: triple(recent.map(r => _n(r.pricePerSf)).filter((x): x is number => x != null)),
  };

  // Per-state medians for states with a real sample (so "cap rates in <state>" is answerable).
  const byStateMap = new Map<string, CompInput[]>();
  for (const r of valid) {
    const st = (r.state || "").trim().toUpperCase();
    if (!st) continue;
    (byStateMap.get(st) || byStateMap.set(st, []).get(st)!).push(r);
  }
  const byState = Array.from(byStateMap.entries())
    .map(([state, rs]) => ({
      state, n: rs.length,
      capRateMedian: triple(rs.map(r => _n(r.capRate)).filter((x): x is number => x != null))?.median ?? null,
      pricePerSfMedian: triple(rs.map(r => _n(r.pricePerSf)).filter((x): x is number => x != null))?.median ?? null,
    }))
    .filter(s => s.n >= MIN_N)
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);

  return {
    n: valid.length,
    excludedInvalid,
    insufficient: valid.length < MIN_N,
    dateRange: { from: dates[0], to: dates[dates.length - 1] },
    sourceMix,
    capRate: triple(caps),
    pricePerSf: triple(psfs),
    last12mo,
    byState,
  };
}
