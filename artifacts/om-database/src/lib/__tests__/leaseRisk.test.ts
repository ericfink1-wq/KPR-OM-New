import { describe, it, expect } from "vitest";
import type { Deal, LeaseAbstract, CoTenancyClause, TriggerNode } from "../idb";
import {
  resolveTenantRisk, computeExposure, clauseTierForAnchor, evaluateTrigger,
  buildAnchorDependencyGraph, seedAnchorStatus, computeCombinedExposure,
} from "../leaseRisk";
import {
  checkUnverifiedCotenancy, checkScheduledIncreaseToLowerAmount,
  checkAbstractVsExecutedConflict, findDecreasingSteps, parseRentStepsFromString,
} from "../leaseValidators";

// ── Worked examples from the brief (the regression bar) ──────────────────────────
// Carter's = Target-conjunctive: AND[ Target dark, OR[Ulta, PetSmart, Dick's] ].
const cartersTrigger: TriggerNode = {
  operator: "AND",
  conditions: [
    { type: "named_anchor_dark", anchor: "Target" },
    { operator: "OR", conditions: [
      { type: "named_anchor_dark", anchor: "Ulta" },
      { type: "named_anchor_dark", anchor: "PetSmart" },
      { type: "named_anchor_dark", anchor: "Dick's Sporting Goods" },
    ] },
  ],
};
const cartersClause: CoTenancyClause = {
  type: "operating",
  triggerLogic: cartersTrigger,
  remedy: { mechanism: "alternate_rent_pct_sales", value: 5, cap: "minimum_annual_rent", additionalRentTreatment: "tenant_continues" },
  reliefPeriodMonthsBeforeTermination: 12,
  terminationNoticeDays: 90,
  sectionRef: "§24.33",
  verifiedAgainstExecutedDoc: true,
};

// Ulta (amended) = OR[ Target dark, inline occupancy < 75% ]. Dick's was DELETED.
const ultaClause: CoTenancyClause = {
  type: "operating",
  triggerLogic: {
    operator: "OR",
    conditions: [
      { type: "named_anchor_dark", anchor: "Target" },
      { type: "occupancy_threshold", scope: "inline <15000 SF", direction: "below", pct: 75 },
    ],
  },
  remedy: { mechanism: "percent_rent_reduction", value: 50, additionalRentTreatment: "tenant_continues" },
  verifiedAgainstExecutedDoc: true,
};

function rockawayDeal(): Deal {
  return {
    id: "rockaway",
    propertyName: "Rockaway",
    tenants: [
      { name: "Carter's / Osh Kosh", annualRent: 156410, sf: 5000 },
      { name: "Ulta", annualRent: 280000, sf: 10000 },
      { name: "Target", annualRent: 0, isAnchor: true, isNAP: true },
      { name: "Dick's Sporting Goods", isAnchor: true },
    ],
    leaseRisk: {
      coTenancyDisclosed: true,
      tenants: [
        { tenant: "Carter's / Osh Kosh", baseRentAnnual: 156410, coTenancy: [cartersClause] },
        { tenant: "Ulta", baseRentAnnual: 280000, coTenancy: [ultaClause] },
      ],
    },
  };
}

describe("trigger evaluation", () => {
  it("evaluates AND/OR trees", () => {
    expect(evaluateTrigger(cartersTrigger, (c) => c.anchor === "Target")).toBe(false); // OR branch unmet
    expect(evaluateTrigger(cartersTrigger, (c) => c.anchor === "Target" || c.anchor === "Ulta")).toBe(true);
  });
});

describe("Rockaway — Dick's departing (regression bar)", () => {
  const exposure = computeExposure(resolveTenantRisk(rockawayDeal()), "Dick's Sporting Goods");

  it("Tier-1 exposure is ~$0 (Carter's needs Target; Ulta unlinked)", () => {
    expect(exposure.tier1Rent).toBe(0);
  });
  it("Ulta is NOT linked to Dick's (amendment deleted it)", () => {
    expect(exposure.clauses.find((c) => c.tenant.startsWith("Ulta"))).toBeUndefined();
    expect(clauseTierForAnchor(ultaClause, "Dick's Sporting Goods")).toBe(0);
  });
  it("Carter's is Tier 2 — trips only if Target ALSO goes dark", () => {
    const carters = exposure.clauses.find((c) => c.tenant.startsWith("Carter"));
    expect(carters?.tier).toBe(2);
    expect(exposure.tier2Rent).toBe(156410);
  });
  it("any-linkage (Tier 3) total is Carter's base rent only", () => {
    expect(exposure.tier3Rent).toBe(156410);
  });
});

describe("Rockaway — Target departing", () => {
  const exposure = computeExposure(resolveTenantRisk(rockawayDeal()), "Target");
  it("Ulta trips on Target ALONE (Tier 1)", () => {
    const ulta = exposure.clauses.find((c) => c.tenant.startsWith("Ulta"));
    expect(ulta?.tier).toBe(1);
    expect(exposure.tier1Rent).toBe(280000);
  });
  it("Carter's needs a second OR-member, so it is Tier 2", () => {
    expect(exposure.clauses.find((c) => c.tenant.startsWith("Carter"))?.tier).toBe(2);
  });
});

describe("anchor dependency graph + seeding", () => {
  it("maps each anchor to dependent clauses", () => {
    const graph = buildAnchorDependencyGraph(resolveTenantRisk(rockawayDeal()));
    const dicks = graph.find((g) => /dick/i.test(g.anchor));
    expect(dicks?.dependents.map((d) => d.tenant).some((t) => t.startsWith("Carter"))).toBe(true);
    const target = graph.find((g) => /target/i.test(g.anchor));
    expect(target?.dependents.length).toBe(2); // both Carter's and Ulta name Target
  });
  it("seeds an anchor-status table including referenced + roster anchors", () => {
    const seeded = seedAnchorStatus(rockawayDeal());
    const names = seeded.map((s) => s.anchor.toLowerCase());
    expect(names.some((n) => n.includes("target"))).toBe(true);
    expect(names.some((n) => n.includes("dick"))).toBe(true);
  });
});

describe("resolver — abstract overrides OM and flips verified", () => {
  it("OM-only co-tenancy is unverified; an executed abstract overrides it", () => {
    const omOnly: Deal = {
      id: "d", tenants: [{ name: "Carter's / Osh Kosh", annualRent: 156410 }],
      leaseRisk: { coTenancyDisclosed: true, tenants: [{ tenant: "Carter's / Osh Kosh", coTenancy: [{ ...cartersClause, verifiedAgainstExecutedDoc: false, sourceDocument: undefined }] }] },
    };
    const before = resolveTenantRisk(omOnly);
    expect(before[0].hasUnverified).toBe(true);
    expect(before[0].source).toBe("OM");

    const abstract: LeaseAbstract = { tenantName: "Carter's / Osh Kosh", coTenancy: [cartersClause] };
    const after = resolveTenantRisk(omOnly, [abstract]);
    expect(after[0].hasUnverified).toBe(false);
    expect(after[0].source).toBe("abstract");
    expect(after[0].coTenancy[0].verifiedAgainstExecutedDoc).toBe(true);
  });
});

describe("validators", () => {
  it("unverified_cotenancy flags OM-sourced clauses, not verified abstracts", () => {
    const deal = rockawayDeal();
    expect(checkUnverifiedCotenancy(deal).length).toBe(0); // fixture clauses are verified
    const omDeal: Deal = { ...deal, leaseRisk: { coTenancyDisclosed: true, tenants: [{ tenant: "Carter's / Osh Kosh", coTenancy: [{ ...cartersClause, verifiedAgainstExecutedDoc: false }] }] } };
    expect(checkUnverifiedCotenancy(omDeal).some((w) => w.code === "unverified_cotenancy")).toBe(true);
  });

  it("scheduled_increase_to_lower_amount catches the PetSmart $36→$26 error", () => {
    const steps = parseRentStepsFromString("2024-01-01: $36.00 PSF ($360,000/yr); 2029-01-01: $26.00 PSF ($260,000/yr)");
    expect(findDecreasingSteps(steps).length).toBe(1);

    const deal: Deal = { id: "d", tenants: [{ name: "PetSmart", rentSchedule: "2024-01-01: $36.00 PSF; 2029-01-01: $26.00 PSF" }] };
    const w = checkScheduledIncreaseToLowerAmount(deal);
    expect(w.some((x) => x.code === "scheduled_increase_to_lower_amount" && /PetSmart/.test(x.tenant || ""))).toBe(true);
  });

  it("does not flag a normal increasing schedule", () => {
    const steps = parseRentStepsFromString("2024-01-01: $26.00 PSF; 2029-01-01: $30.00 PSF");
    expect(findDecreasingSteps(steps).length).toBe(0);
  });

  it("abstract_vs_executed_conflict flags OM co-tenancy that the lease lacks", () => {
    const deal: Deal = {
      id: "d", tenants: [{ name: "Big Lots", annualRent: 100000 }],
      leaseRisk: { coTenancyDisclosed: true, tenants: [{ tenant: "Big Lots", coTenancy: [{ ...cartersClause, verifiedAgainstExecutedDoc: false }] }] },
    };
    const abstract: LeaseAbstract = { tenantName: "Big Lots", coTenancy: [] }; // executed lease: no co-tenancy
    expect(checkAbstractVsExecutedConflict(deal, [abstract]).some((w) => w.code === "abstract_vs_executed_conflict")).toBe(true);
  });
});

describe("X-of-N anchor-count co-tenancy (Paddock-style '7 of 10 Key Stores')", () => {
  const tenList = ["Total Wine", "Ulta", "Barnes & Noble", "Talbots", "Chico's", "Athleta", "Soft Surroundings", "Victoria's Secret", "LOFT", "Gap"];
  const gapClause: CoTenancyClause = {
    type: "operating",
    triggerLogic: { operator: "OR", conditions: [
      { type: "occupancy_threshold", direction: "below", pct: 75, scope: "GLA" },
      { type: "anchor_count_below", anchors: tenList, openRequired: 7, totalNamed: 10 },
    ] },
    remedy: { mechanism: "percent_rent_reduction", value: 50 },
    verifiedAgainstExecutedDoc: false,
  };
  const dealX = (): Deal => ({
    id: "x", tenants: [{ name: "Apparel Co", annualRent: 300000 }],
    leaseRisk: { coTenancyDisclosed: true, tenants: [{ tenant: "Apparel Co", baseRentAnnual: 300000, coTenancy: [gapClause] }] },
  });

  it("a single named store is LINKED but Tier 3 — does NOT trip alone (needs 4 of 10 dark)", () => {
    expect(clauseTierForAnchor(gapClause, "Barnes & Noble")).toBe(3);
    expect(clauseTierForAnchor(gapClause, "Ulta")).toBe(3);
  });
  it("a store NOT in the list is unlinked", () => {
    expect(clauseTierForAnchor(gapClause, "Target")).toBe(0);
  });
  it("single-anchor exposure is $0 (no overstatement) but any-linkage sees it", () => {
    const exp = computeExposure(resolveTenantRisk(dealX()), "Barnes & Noble");
    expect(exp.tier1Rent).toBe(0);
    expect(exp.tier3Rent).toBe(300000); // linked at Tier 3
  });
  it("combined: 3 of 10 dark does NOT trip; 4 of 10 DOES", () => {
    const r = resolveTenantRisk(dealX());
    expect(computeCombinedExposure(r, ["Total Wine", "Ulta", "Barnes & Noble"]).clauses.length).toBe(0);
    expect(computeCombinedExposure(r, ["Total Wine", "Ulta", "Barnes & Noble", "Talbots"]).totalRent).toBe(300000);
  });
});

describe("Overland — McDonald's ROFR", () => {
  it("captures a ROFR/ROFO under otherRiskClauses.rofrRofo", () => {
    const deal: Deal = { id: "overland", tenants: [{ name: "McDonald's", annualRent: 90000 }] };
    const abstract: LeaseAbstract = {
      tenantName: "McDonald's",
      otherRiskClauses: { rofrRofo: { present: true, summary: "Tenant ROFR on sale of the pad", verifiedAgainstExecutedDoc: true, sourceDocument: "McDonald's Ground Lease" } },
    };
    const resolved = resolveTenantRisk(deal, [abstract]);
    const mcd = resolved.find((r) => /mcdonald/i.test(r.tenant));
    expect(mcd?.otherRiskClauses?.rofrRofo?.present).toBe(true);
  });
});
