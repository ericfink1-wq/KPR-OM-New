// PORTFOLIO TENANT STRESS TEST — "this chain just filed": if a given tenant goes
// dark, what happens across EVERY deal in the library? Two components per deal:
//   direct rent — the tenant's own base rent (gone or contested in a bankruptcy);
//   knock-on   — OTHER tenants' rent that converts to alternate/reduced rent (or
//                gains a termination right) via co-tenancy clauses naming this
//                tenant, from the same resolved-clause engine the per-deal Lease
//                Risk panel uses (abstracts override OM capture).
// Deterministic, token-free. Uses whatever clause data exists — deals with no
// co-tenancy capture contribute direct rent only.
import type { Deal, LeaseAbstract } from "./idb";
import { isVacant, isNAPTenant, tenantKey } from "./utils";
import { computeExposure, resolveTenantRisk } from "./leaseRisk";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface DealStressRow {
  dealId: string;
  dealName: string;
  status: string | null;
  owned: boolean;
  directRent: number;      // the target brand(s)' own base rent in this deal
  directSF: number;
  tier1Rent: number;       // co-tenancy rent that trips on this tenant ALONE
  tier1Count: number;
  tier2Rent: number;       // needs a second event
  totalAtRisk: number;     // directRent + tier1Rent
  dependents: string[];    // tier-1 dependent tenant names
  dealTotalRent: number;   // occupied base rent, for share-of-deal context
}

export interface StressTestResult {
  target: string;
  rows: DealStressRow[];               // sorted by totalAtRisk desc
  totalDirectRent: number;
  totalTier1Rent: number;
  totalTier2Rent: number;
  totalAtRisk: number;
  dealsWithPresence: number;
  dealsWithKnockOn: number;
}

// brands: the exact brand names to treat as "gone" — usually just [tenantName],
// or a parent company's full brand list. Deals in the trash are skipped.
export function runTenantStressTest(
  target: string,
  brands: string[],
  deals: Deal[],
  abstractsByDeal?: Map<string, LeaseAbstract[]> | null,
): StressTestResult {
  const brandKeys = new Set(brands.map((b) => tenantKey(b)).filter(Boolean));
  const rows: DealStressRow[] = [];

  for (const d of deals || []) {
    if (!d || d.trashedAt) continue;
    const occupied = (d.tenants || []).filter((t) => t && !isVacant(t.name));
    const dealTotalRent = occupied.filter((t) => !isNAPTenant(t)).reduce((s, t) => s + (num(t.annualRent) || 0), 0);

    let directRent = 0, directSF = 0, present = false;
    for (const t of occupied) {
      if (!brandKeys.has(tenantKey(t.canonicalName || t.name || ""))) continue;
      present = true;
      if (!isNAPTenant(t)) {
        directRent += num(t.annualRent) || 0;
        directSF += num(t.sf) || 0;
      }
    }

    // Knock-on via co-tenancy clauses naming any of the target brands. Clauses are
    // de-duped by (dependent tenant + trigger) so a parent's two banners named in
    // the same clause don't double-count the dependent's rent.
    const resolved = resolveTenantRisk(d, abstractsByDeal?.get(d.id) ?? []);
    let tier1Rent = 0, tier2Rent = 0, tier1Count = 0;
    const dependents: string[] = [];
    if (resolved.length > 0) {
      // Same clause can score different tiers against different banners of one
      // parent — keep the WORST (lowest) tier per clause.
      const worst = new Map<string, { tenant: string; rent: number; tier: number }>();
      for (const brand of brands) {
        const exp = computeExposure(resolved, brand);
        for (const c of exp.clauses) {
          const id = `${c.tenant}::${c.triggerSummary}`;
          const prev = worst.get(id);
          if (!prev || c.tier < prev.tier) worst.set(id, { tenant: c.tenant, rent: c.baseRentAnnual ?? 0, tier: c.tier });
        }
      }
      for (const { tenant, rent, tier } of worst.values()) {
        if (tier === 1) {
          tier1Rent += rent;
          tier1Count++;
          if (!dependents.includes(tenant)) dependents.push(tenant);
        } else if (tier === 2) {
          tier2Rent += rent;
        }
      }
    }

    if (!present && tier1Rent === 0 && tier2Rent === 0) continue;
    rows.push({
      dealId: d.id,
      dealName: d.propertyName || d.address || "Untitled deal",
      status: (d.status as string) || null,
      owned: d.status === "Owned",
      directRent, directSF,
      tier1Rent, tier1Count, tier2Rent,
      totalAtRisk: directRent + tier1Rent,
      dependents,
      dealTotalRent,
    });
  }

  rows.sort((a, b) => b.totalAtRisk - a.totalAtRisk);
  return {
    target,
    rows,
    totalDirectRent: rows.reduce((s, r) => s + r.directRent, 0),
    totalTier1Rent: rows.reduce((s, r) => s + r.tier1Rent, 0),
    totalTier2Rent: rows.reduce((s, r) => s + r.tier2Rent, 0),
    totalAtRisk: rows.reduce((s, r) => s + r.totalAtRisk, 0),
    dealsWithPresence: rows.filter((r) => r.directRent > 0 || r.directSF > 0).length,
    dealsWithKnockOn: rows.filter((r) => r.tier1Rent > 0 || r.tier2Rent > 0).length,
  };
}
