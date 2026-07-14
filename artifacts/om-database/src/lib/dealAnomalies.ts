// Phase B of the self-improving loop: DATABASE-DISTRIBUTION ANOMALY DETECTION.
// Every figure a new OM produces is compared to the DISTRIBUTION of the same figure
// across the existing deals — cap rate by product type, weighted-avg rent by product
// type, and each tenant's rent PSF vs the same brand elsewhere. An outlier is flagged
// for a human to verify. This gets SHARPER with every deal added (tighter cohorts),
// so more data → better self-checking. Deterministic (median-based), no model.

import type { Deal, ReviewQuestion } from "./idb";
import { tenantKey, isVacant, isNAPTenant } from "./utils";

export interface DerivedFlag { severity: "high" | "medium" | "low"; description: string }

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface Anomaly { id: string; severity: "medium" | "low"; message: string }

const MIN_DEAL_PEERS = 5;     // need ≥5 comparable deals for a deal-level cohort
const MIN_BRAND_PEERS = 3;    // need ≥3 other locations for a brand cohort

export function detectDealAnomalies(deal: Deal, allDeals: Deal[]): Anomaly[] {
  const out: Anomaly[] = [];
  const others = (allDeals || []).filter((d) => d.id !== deal.id && !d.trashedAt);

  // ── Deal-level: cap rate & weighted-avg rent vs the SAME product type (centerType) ──
  const ct = deal.centerType;
  const sameType = (d: Deal) => !ct || !d.centerType || d.centerType === ct;
  const cohort = others.filter(sameType);

  const cap = num(deal.capRate);
  const caps = cohort.map((d) => num(d.capRate)).filter((v): v is number => v != null && v >= 3 && v <= 12);
  if (cap != null && caps.length >= MIN_DEAL_PEERS) {
    const med = median(caps);
    if (med > 0 && (cap < med * 0.6 || cap > med * 1.7)) {
      out.push({ id: "anomaly-caprate", severity: "medium", message: `Cap rate ${cap}% is unusual vs the ${med.toFixed(1)}% median across ${caps.length} comparable ${ct || ""} deals — verify it wasn't mis-captured.` });
    }
  }

  const war = num(deal.weightedAvgRentPSF);
  const wars = cohort.map((d) => num(d.weightedAvgRentPSF)).filter((v): v is number => v != null);
  if (war != null && wars.length >= MIN_DEAL_PEERS) {
    const med = median(wars);
    if (med > 0 && (war < med * 0.5 || war > med * 2.0)) {
      out.push({ id: "anomaly-avgrent", severity: "low", message: `Avg rent $${war.toFixed(2)}/SF is unusual vs the $${med.toFixed(2)} median across ${wars.length} comparable ${ct || ""} deals — verify.` });
    }
  }

  // ── Tenant-level: rent PSF vs the SAME brand across OTHER deals ──
  const brandRents = new Map<string, number[]>();
  for (const d of others) {
    for (const t of d.tenants || []) {
      if (isVacant(t.name) || isNAPTenant(t)) continue;
      const k = tenantKey(t.canonicalName || t.name);
      const r = num(t.rentPerSF);
      if (k && r != null) (brandRents.get(k) ?? brandRents.set(k, []).get(k)!).push(r);
    }
  }
  // A rent that is ABOVE the brand norm is worth a verify — it can be a gross/option-
  // period rate mis-captured as base, and it inflates NOI. A rent only MODERATELY
  // below the norm is NOT an error to confirm — it's a legitimate below-market /
  // anchor / ground-lease OUTLIER (Eric's Kohl's-at-$3.43 case), already surfaced by
  // the neutral "below-chain / favorable basis" rent badge and discussed in the AI
  // analysis. Only an EGREGIOUS low (>75% under the norm) is more likely a units slip
  // (a monthly rate read as annual, or a dropped digit) than real economics.
  const rentHigh: string[] = [];
  const rentLowSuspect: string[] = [];
  for (const t of deal.tenants || []) {
    if (isVacant(t.name) || isNAPTenant(t)) continue;
    const r = num(t.rentPerSF);
    const k = tenantKey(t.canonicalName || t.name);
    if (r == null || !k) continue;
    const peers = brandRents.get(k);
    if (!peers || peers.length < MIN_BRAND_PEERS) continue;
    const med = median(peers);
    if (med <= 0) continue;
    const ratio = r / med;
    const line = `${t.name} $${r.toFixed(2)} vs ~$${med.toFixed(2)} (${peers.length} other locations)`;
    if (ratio >= 1.7) rentHigh.push(line);
    else if (ratio <= 0.25) rentLowSuspect.push(line);
    // 0.25 < ratio ≤ 0.55: a real below-norm outlier, NOT flagged as a question.
  }
  if (rentHigh.length) {
    out.push({ id: "anomaly-rent-brand", severity: "low", message: `Tenant rent PSF well ABOVE the brand norm: ${rentHigh.slice(0, 6).join("; ")}${rentHigh.length > 6 ? `; +${rentHigh.length - 6} more` : ""} — verify (a possible gross/option-period rate captured as base rent, which also inflates NOI).` });
  }
  if (rentLowSuspect.length) {
    out.push({ id: "anomaly-rent-low", severity: "low", message: `Tenant rent PSF far BELOW the brand norm (>75% under): ${rentLowSuspect.slice(0, 6).join("; ")}${rentLowSuspect.length > 6 ? `; +${rentLowSuspect.length - 6} more` : ""} — verify a units slip (a monthly rate read as annual, or a dropped digit). A merely below-market anchor/ground-lease rent is expected and not flagged.` });
  }

  // ── Tenant-level: total SF vs the SAME brand across OTHER deals — an SF-typo catch.
  // SF errors are a top cause of GLA mismatches: a Five Below at 30,000 SF when every
  // other Five Below is ~8,000 is almost certainly a mis-read. One observation per
  // (deal, brand) so a chain with two suites in one center doesn't skew its own norm.
  const brandSizes = new Map<string, number[]>();
  for (const d of others) {
    const perBrand = new Map<string, number>();
    for (const t of d.tenants || []) {
      if (isVacant(t.name) || isNAPTenant(t)) continue;
      const k = tenantKey(t.canonicalName || t.name);
      const s = num(t.sf);
      if (k && s != null) perBrand.set(k, (perBrand.get(k) ?? 0) + s);
    }
    for (const [k, s] of perBrand) (brandSizes.get(k) ?? brandSizes.set(k, []).get(k)!).push(s);
  }
  const ownBrandSF = new Map<string, number>();
  for (const t of deal.tenants || []) {
    if (isVacant(t.name) || isNAPTenant(t)) continue;
    const k = tenantKey(t.canonicalName || t.name);
    const s = num(t.sf);
    if (k && s != null) ownBrandSF.set(k, (ownBrandSF.get(k) ?? 0) + s);
  }
  const sizeOutliers: string[] = [];
  for (const [k, s] of ownBrandSF) {
    const peers = brandSizes.get(k);
    if (!peers || peers.length < MIN_BRAND_PEERS) continue;
    const med = median(peers);
    if (med <= 0) continue;
    const ratio = s / med;
    // Store FORMATS vary a lot (small-format Targets, big vs small ALDIs), so this
    // needs a MUCH higher bar than the rent check (1.7×) — only an EGREGIOUS 3×/0.33×
    // deviation is likely a real SF typo rather than a different footprint.
    if (ratio >= 3 || ratio <= 0.33) {
      const nm = (deal.tenants || []).find((t) => tenantKey(t.canonicalName || t.name) === k)?.name || k;
      sizeOutliers.push(`${nm} ${Math.round(s).toLocaleString()} SF vs ~${Math.round(med).toLocaleString()} (${peers.length} other locations)`);
    }
  }
  if (sizeOutliers.length) {
    out.push({ id: "anomaly-sf-brand", severity: "low", message: `Tenant SF off the brand norm: ${sizeOutliers.slice(0, 6).join("; ")}${sizeOutliers.length > 6 ? `; +${sizeOutliers.length - 6} more` : ""} — likely an SF typo (a top cause of GLA mismatches).` });
  }

  return out;
}

// Turn the cross-portfolio anomalies into review questions so they flow into the
// "Confirm import details" overlay — where each can be confirmed, fixed, OR turned
// into a teach-the-analyst rule. This is the learning loop: the database checks every
// new import against itself, and a real outlier becomes a correction + a future rule.
// Stable ids let a confirm/dismiss stick (and a healed anomaly silently drops out).
export function anomalyReviewQuestions(deal: Deal, allDeals: Deal[]): ReviewQuestion[] {
  return detectDealAnomalies(deal, allDeals).map((a): ReviewQuestion => ({
    id: a.id,
    source: "check",
    severity: a.severity,
    field: "vs. your database",
    question: a.message,
    detail: "Compared against the distribution across your existing deals — a real outlier is usually a mis-capture. Confirm, fix it, or dismiss.",
    suggestedValue: null,
    target: null,
    resolvedAt: null,
    resolution: null,
  }));
}

// Aggregate the anomalies into a single deal red flag (shown on the deal page at upload).
export function deriveAnomalyFlag(deal: Deal, allDeals: Deal[]): DerivedFlag | null {
  const a = detectDealAnomalies(deal, allDeals);
  if (!a.length) return null;
  return {
    severity: a.some((x) => x.severity === "medium") ? "medium" : "low",
    description: `Figures that look unusual vs your database (data-quality check): ${a.map((x) => x.message).join("  ")}`,
  };
}
