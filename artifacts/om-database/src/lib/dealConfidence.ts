// DATA CONFIDENCE — a single deterministic 0–100 signal for "how complete and trustworthy
// is this deal's data," so the team knows at a glance which records they can rely on and
// which still need a human pass. This is the positive counterpart to the arithmetic audit
// (which flags contradictions): it scores completeness + roster depth + internal
// consistency + market context + freshness, and lists the specific gaps. Pure / testable.

import type { Deal, Tenant } from "./idb";
import { isVacant, isNAPTenant, openAuditCount } from "./utils";
import { ANALYSIS_VERSION } from "./constants";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[$,%\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const has = (v: unknown): boolean => v != null && v !== "" && !(Array.isArray(v) && v.length === 0);

export interface ConfFactor { label: string; pts: number; max: number }
export interface DealConfidence {
  score: number;                 // 0–100
  label: "High" | "Good" | "Partial" | "Low";
  color: string;
  factors: ConfFactor[];         // breakdown by category
  gaps: string[];                // short, specific list of what's weak (for the review queue)
}

export function scoreDealConfidence(deal: Deal): DealConfidence {
  const gaps: string[] = [];
  const factors: ConfFactor[] = [];
  const d = deal as unknown as Record<string, unknown>;

  // 1. Core deal fields (30) — the headline metrics an underwriter needs.
  const core: [string, string][] = [
    ["propertyName", "name"], ["address", "address"], ["state", "state"],
    ["totalSF", "GLA"], ["occupancy", "occupancy"], ["noi", "NOI"],
    ["walt", "WALT"], ["weightedAvgRentPSF", "avg rent"], ["grossPotentialRent", "GPR"],
  ];
  const coreMissing = core.filter(([k]) => !has(d[k]));
  const corePts = Math.round((1 - coreMissing.length / core.length) * 30);
  factors.push({ label: "Core financials", pts: corePts, max: 30 });
  if (coreMissing.length) gaps.push(`Missing ${coreMissing.map(([, l]) => l).join(", ")}`);

  // 2. Roster depth (25) — a center is only as good as its rent roll.
  const tenants = (deal.tenants || []) as Tenant[];
  const occ = tenants.filter((t) => !isVacant(t.name) && !isNAPTenant(t));
  let rosterPts = 0;
  if (occ.length > 0) {
    rosterPts += 5;
    const withRent = occ.filter((t) => num(t.annualRent) || num(t.rentPerSF)).length;
    const withExp = occ.filter((t) => /^\d{4}-\d{2}-\d{2}/.test(String(t.leaseExpiry ?? ""))).length;
    rosterPts += Math.round((withRent / occ.length) * 10);
    rosterPts += Math.round((withExp / occ.length) * 10);
    if (withRent < occ.length) gaps.push(`${occ.length - withRent} tenant${occ.length - withRent === 1 ? "" : "s"} missing rent`);
    if (withExp < occ.length * 0.9) gaps.push(`${occ.length - withExp} tenant${occ.length - withExp === 1 ? "" : "s"} missing a lease-expiry date`);
  } else {
    gaps.push("No tenant roster");
  }
  factors.push({ label: "Rent roll depth", pts: rosterPts, max: 25 });

  // 3. Internal consistency (20) — every open arithmetic contradiction chips away at trust.
  const auditFlags = openAuditCount(deal);
  const consistencyPts = Math.max(0, 20 - auditFlags * 5);
  factors.push({ label: "Arithmetic consistency", pts: consistencyPts, max: 20 });
  if (auditFlags > 0) gaps.push(auditFlags === 1 ? "1 number doesn't tie out" : `${auditFlags} numbers don't tie out`);

  // 4. Market context (15) — demographics, OM date, and comps make it citable.
  let ctxPts = 0;
  if (has(deal.marketDemographics) || has(d.population3mi)) ctxPts += 6; else gaps.push("No demographics");
  if (has(deal.omDate)) ctxPts += 5; else gaps.push("No OM date");
  if (has(d.comparableSales) || has(d.incomeBreakdown)) ctxPts += 4;
  factors.push({ label: "Market context", pts: ctxPts, max: 15 });

  // 5. Freshness & verification (10).
  let freshPts = 0;
  const stale = deal.analysisStale === true || (typeof deal.analysisVersion === "number" && deal.analysisVersion < ANALYSIS_VERSION);
  if (!stale && has(deal.notes)) freshPts += 5; else if (stale) gaps.push("Analysis may be outdated");
  if (has(deal.tenantsAsOf)) freshPts += 3;
  if (has(deal.verified)) freshPts += 2;
  factors.push({ label: "Freshness", pts: freshPts, max: 10 });

  const score = Math.max(0, Math.min(100, factors.reduce((a, f) => a + f.pts, 0)));
  const label = score >= 85 ? "High" : score >= 70 ? "Good" : score >= 50 ? "Partial" : "Low";
  const color = score >= 85 ? "#0f9d63" : score >= 70 ? "#3f7a1f" : score >= 50 ? "#c97a18" : "#dc2626";
  return { score, label, color, factors, gaps };
}
