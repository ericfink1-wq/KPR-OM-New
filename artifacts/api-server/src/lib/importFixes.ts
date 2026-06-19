// Deterministic, SAFE data-quality fixes applied automatically the moment a deal is
// imported, so data lands CLEAN instead of being corrected later. Only UNAMBIGUOUS
// fixes that cannot be "wrong":
//   • occupancyCost stored as a 0.NN fraction → ×100 (a value in (0,1) is
//     mathematically a fraction; retail occupancy cost is never below ~1%).
//   • duplicate tenant rows that double-count SF → keep the LATER lease. Same tenant +
//     same suite, OR suite-less with the same expiry AND similar SF — the SF guard
//     means two genuinely different spaces of one chain are NEVER merged.
//   • recompute roster-derived metrics (occupancy / WALT / weighted-avg rent), honoring
//     `verified` locks — these are DERIVED values, always safe to recompute.
// It deliberately does NOT touch rent values or deal-level figures (cap rate, price,
// GLA) — those can be genuinely ambiguous and stay FLAGGED for human review. Pure.

const nA = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[$,%\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const isVacA = (name: unknown): boolean => {
  const s = String(name ?? "").trim().toLowerCase();
  return !s || s === "-" || /^(vacant|available|avail|spec(ulative)?|white\s*box|tbd|to\s+be\s+leased)\b/.test(s);
};
const isNAPA = (t: Record<string, unknown>): boolean => {
  if (t.isNAP === true) return true;
  if (isVacA(t.name)) return false;
  const hasLease = !!((typeof t.leaseStart === "string" && t.leaseStart.trim()) || (typeof t.leaseExpiry === "string" && t.leaseExpiry.trim()) || (typeof t.rentSchedule === "string" && t.rentSchedule.trim()));
  if (hasLease) return false;
  const sf = nA(t.sf), r = nA(t.annualRent), rp = nA(t.rentPerSF);
  return sf != null && sf > 0 && (r == null || r === 0) && (rp == null || rp === 0);
};
const parseD = (s: unknown): Date | null => {
  const str = String(s ?? "").trim(); if (!str) return null;
  const d = new Date(str + (/^\d{4}-\d{2}-\d{2}$/.test(str) ? "T12:00:00" : ""));
  return isNaN(d.getTime()) ? null : d;
};
// Faithful port of recomputeRosterMetrics (om-database/src/lib/utils.ts) — keep in sync.
function recompute(tenants: Record<string, unknown>[], asOf: unknown, deal: Record<string, unknown>) {
  const ver = (deal.verified || {}) as Record<string, unknown>;
  const out: { occupancy?: number; walt?: number; weightedAvgRentPSF?: number } = {};
  const ref = parseD(asOf) ?? new Date();
  const occ = tenants.filter((t) => !isVacA(t.name) && !isNAPA(t));
  const totalSF = nA(deal.totalSF);
  if (!ver.occupancy && totalSF && totalSF > 0) {
    const o = Math.round(occ.reduce((s, t) => s + (nA(t.sf) ?? 0), 0) / totalSF * 1000) / 10;
    if (o > 0 && o <= 100) out.occupancy = o;
  }
  if (!ver.walt) {
    let sf = 0, w = 0;
    for (const t of occ) { const s = nA(t.sf); if (!s) continue; const e = parseD(t.leaseExpiry); const yr = e ? Math.max(0, (e.getTime() - ref.getTime()) / (365.25 * 86_400_000)) : nA(t.remainingTermYears); if (yr == null) continue; sf += s; w += s * yr; }
    if (w > 0 && sf > 0) out.walt = Math.round(w / sf * 10) / 10;
  }
  if (!ver.weightedAvgRentPSF) {
    let sf = 0, w = 0;
    for (const t of occ) { const s = nA(t.sf), r = nA(t.rentPerSF); if (s && s > 0 && r && r > 0) { sf += s; w += s * r; } }
    if (sf > 0) out.weightedAvgRentPSF = Math.round(w / sf * 100) / 100;
  }
  return out;
}

export interface ImportFixResult {
  deal: Record<string, unknown>;
  changed: boolean;
  occCostFixed: number;
  dupeFixed: number;
  metricFixes: number;
}

export function applyImportFixes(input: Record<string, unknown>): ImportFixResult {
  let changed = false, occCostFixed = 0, dupeFixed = 0, metricFixes = 0;
  const raw = Array.isArray(input.tenants) ? (input.tenants as Record<string, unknown>[]) : [];

  // 1. occupancyCost fraction → ×100
  const fixed = raw.map((src) => {
    const t = { ...src };
    const oc = nA(t.occupancyCost);
    if (oc != null && oc > 0 && oc < 1) { t.occupancyCost = Math.round(oc * 100 * 100) / 100; occCostFixed++; changed = true; }
    return t;
  });

  // 2. dedupe true duplicate rows (keep later expiry; SF guard for the suite-less case)
  const dedup: Record<string, unknown>[] = [];
  const seen = new Map<string, number>();
  for (const t of fixed) {
    if (isVacA(t.name)) { dedup.push(t); continue; }
    const name = String(t.name ?? "").trim().toLowerCase();
    const suite = String(t.suite ?? "").trim().toLowerCase();
    const exp = String(t.leaseExpiry ?? "").trim();
    const key = suite ? `${name}|s:${suite}` : (exp ? `${name}|e:${exp}` : null);
    const at = key != null ? seen.get(key) : undefined;
    if (key != null && at != null) {
      const prev = dedup[at];
      const sfPrev = nA(prev.sf), sfCur = nA(t.sf);
      const sfOk = !!suite || sfPrev == null || sfCur == null || sfPrev === 0 ||
        Math.abs(sfPrev - sfCur) / Math.max(sfPrev, sfCur) <= 0.25;
      if (sfOk) {
        const prevExp = parseD(prev.leaseExpiry), curExp = parseD(t.leaseExpiry);
        if (curExp && (!prevExp || curExp > prevExp)) dedup[at] = t;
        dupeFixed++; changed = true;
        continue;
      }
    }
    if (key != null) seen.set(key, dedup.length);
    dedup.push(t);
  }

  const deal: Record<string, unknown> = { ...input, tenants: dedup };

  // 3. recompute roster-derived metrics (honors verified locks)
  const m = recompute(dedup, deal.tenantsAsOf, deal);
  for (const k of ["occupancy", "walt", "weightedAvgRentPSF"] as const) {
    if (m[k] != null && nA(deal[k]) !== m[k]) { deal[k] = m[k]; metricFixes++; changed = true; }
  }

  return { deal, changed, occCostFixed, dupeFixed, metricFixes };
}
