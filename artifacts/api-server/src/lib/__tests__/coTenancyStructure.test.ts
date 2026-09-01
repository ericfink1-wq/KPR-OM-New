import { describe, it, expect } from "vitest";
import { parseXofN, checkCoTenancyStructure, repairCoTenancyTrigger, isPerAnchorTrigger } from "../coTenancyStructure";

// The six real clauses off the Town N' Country (BCA, Easley SC) rent roll.
const Q = {
  homeGoods: "Co-Tenancy Requirement: 2 of the following must be open and operating  i) Hobby Lobby  ii) Belk  iii) Either Ross or Ulta",
  ross: "Co-Tenancy Requirement: 2 of the following must be open and operating  i) HomeGoods  ii) Hobby Lobby  iii) Belk. Shopping Center Occupancy Requirement: > 65%",
  ulta: "Co-Tenancy Requirement: 3 of the following must be open and operating  i) Belk  ii) Hobby Lobby  iii) HomeGoods  iv) Ross",
  fiveBelow: "Co-Tenancy Requirement: 3 of the following must be open and operating  i) Belk  ii) Hobby Lobby  iii) Ross  iv) HomeGoods  v) Ulta",
  americasBest: "Co-Tenancy Requirement: 3 of the following must be open and operating  i) Ross, Hobby Lobby, Ulta, Staples, Belk, and HomeGoods",
  rackRoom: "Co-Tenancy Requirement: The following must be open and operating  i) Belk. Occupancy Requirement: LL must maintain 75% occupancy on non-anchor floor area",
};
const orOf = (...names: string[]) => ({ operator: "OR" as const, conditions: names.map(a => ({ type: "named_anchor_dark", anchor: a })) });

describe("parseXofN", () => {
  it("reads the count and the enumerated list", () => {
    expect(parseXofN(Q.ulta)).toMatchObject({ openRequired: 3, named: ["Belk", "Hobby Lobby", "HomeGoods", "Ross"] });
    expect(parseXofN(Q.fiveBelow)!.openRequired).toBe(3);
    expect(parseXofN(Q.fiveBelow)!.named).toEqual(["Belk", "Hobby Lobby", "Ross", "HomeGoods", "Ulta"]);
  });
  it("handles a comma series crammed behind one marker", () => {
    expect(parseXofN(Q.americasBest)).toMatchObject({
      openRequired: 3, named: ["Ross", "Hobby Lobby", "Ulta", "Staples", "Belk", "HomeGoods"],
    });
  });
  it("stops at a trailing occupancy prong", () => {
    expect(parseXofN(Q.ross)!.named).toEqual(["HomeGoods", "Hobby Lobby", "Belk"]);
  });
  it("reads 'at least X of these N' and word numbers", () => {
    expect(parseXofN("at least 7 of these 10 Key Stores must remain open")).toMatchObject({ openRequired: 7, totalNamed: 10 });
    expect(parseXofN("two of the following must be open and operating i) Target ii) Kohl's iii) Ross")!.openRequired).toBe(2);
  });
  it("returns null when there is no count phrase (a true single-anchor clause)", () => {
    expect(parseXofN(Q.rackRoom)).toBeNull();
  });
  it("returns null on unrelated text", () => {
    expect(parseXofN("Tenant has a go dark clause")).toBeNull();
    expect(parseXofN(null)).toBeNull();
  });
});

describe("checkCoTenancyStructure + repair", () => {
  it("repairs an X-of-N flattened into a per-anchor OR", () => {
    const clause = { verbatimQuote: Q.ulta, triggerLogic: orOf("Belk", "Hobby Lobby", "HomeGoods", "Ross") };
    expect(isPerAnchorTrigger(clause.triggerLogic)).toBe(true);
    const v = checkCoTenancyStructure(clause);
    expect(v.kind).toBe("repairable");
    const { clause: fixed, repaired } = repairCoTenancyTrigger(clause);
    expect(repaired).toBe(true);
    expect(fixed.triggerLogic).toMatchObject({
      type: "anchor_count_below", openRequired: 3, totalNamed: 4,
      anchors: ["Belk", "Hobby Lobby", "HomeGoods", "Ross"],
    });
  });

  it("PRESERVES a standalone occupancy prong as a separate OR branch", () => {
    const clause = {
      verbatimQuote: Q.ross,
      triggerLogic: { operator: "OR" as const, conditions: [
        { type: "named_anchor_dark", anchor: "HomeGoods" },
        { type: "named_anchor_dark", anchor: "Hobby Lobby" },
        { type: "named_anchor_dark", anchor: "Belk" },
        { type: "occupancy_threshold", scope: "Center GLA", direction: "below", pct: 65 },
      ] },
    };
    const { clause: fixed, repaired } = repairCoTenancyTrigger(clause);
    expect(repaired).toBe(true);
    const t = fixed.triggerLogic as { operator: string; conditions: Array<Record<string, unknown>> };
    expect(t.operator).toBe("OR");
    expect(t.conditions).toHaveLength(2);
    expect(t.conditions[0]).toMatchObject({ type: "anchor_count_below", openRequired: 2, totalNamed: 3 });
    expect(t.conditions[1]).toMatchObject({ type: "occupancy_threshold", pct: 65 });
  });

  it("leaves a GENUINE single-anchor clause alone", () => {
    const clause = { verbatimQuote: Q.rackRoom, triggerLogic: { type: "named_anchor_dark", anchor: "Belk" } };
    expect(checkCoTenancyStructure(clause).kind).toBe("ok");
    expect(repairCoTenancyTrigger(clause).repaired).toBe(false);
  });

  it("leaves an already-correct anchor_count_below alone", () => {
    const clause = { verbatimQuote: Q.ulta, triggerLogic: { type: "anchor_count_below", anchors: ["Belk", "Hobby Lobby", "HomeGoods", "Ross"], openRequired: 3 } };
    expect(checkCoTenancyStructure(clause).kind).toBe("ok");
  });

  it("FLAGS rather than repairs when the quote's list disagrees with the trigger", () => {
    const clause = { verbatimQuote: Q.ulta, triggerLogic: orOf("Belk", "Target", "Kohl's") };
    const v = checkCoTenancyStructure(clause);
    expect(v.kind).toBe("mismatch");
    expect(repairCoTenancyTrigger(clause).repaired).toBe(false);
  });

  it("treats 'all N must stay open' as a correct per-anchor trigger", () => {
    const clause = { verbatimQuote: "3 of the following must be open and operating i) Belk ii) Ross iii) Ulta", triggerLogic: orOf("Belk", "Ross", "Ulta") };
    expect(checkCoTenancyStructure(clause).kind).toBe("ok");
  });
});

// ── end-to-end: the guardrail actually fires through extraction + audit ──────────
import { normalizeLeaseRisk, validateLeaseRiskAtExtraction } from "../leaseRiskExtract";
import { auditExtraction } from "../extractionAudit";

const flattenedModelOutput = {
  coTenancyDisclosed: true,
  tenants: [{
    tenant: "Ulta", suite: "13", baseRentAnnual: 207317,
    coTenancy: [{
      type: "operating",
      // what the model actually produced for Town N' Country — an X-of-N flattened
      // into four independent single-anchor triggers
      triggerLogic: { operator: "OR", conditions: [
        { type: "named_anchor_dark", anchor: "Belk" },
        { type: "named_anchor_dark", anchor: "Hobby Lobby" },
        { type: "named_anchor_dark", anchor: "HomeGoods" },
        { type: "named_anchor_dark", anchor: "Ross" },
      ] },
      verbatimQuote: Q.ulta,
    }],
  }],
};

describe("extraction pipeline self-heals a flattened X-of-N", () => {
  it("normalizeLeaseRisk rewrites it to anchor_count_below", () => {
    const lr = normalizeLeaseRisk(flattenedModelOutput);
    const trigger = lr.tenants[0].coTenancy![0].triggerLogic as Record<string, unknown>;
    expect(trigger.type).toBe("anchor_count_below");
    expect(trigger.openRequired).toBe(3);
    expect(trigger.totalNamed).toBe(4);
    expect(trigger.anchors).toEqual(["Belk", "Hobby Lobby", "HomeGoods", "Ross"]);
  });

  it("raises no structure question once it has been healed", () => {
    const lr = normalizeLeaseRisk(flattenedModelOutput);
    const qs = validateLeaseRiskAtExtraction({ leaseRisk: lr, tenants: [] });
    expect(qs.find((q) => q.id === "check-cotenancy-structure")).toBeUndefined();
  });

  it("raises a HIGH structure question when the quote and trigger disagree", () => {
    const lr = normalizeLeaseRisk({
      coTenancyDisclosed: true,
      tenants: [{
        tenant: "Ulta", baseRentAnnual: 207317,
        coTenancy: [{
          type: "operating", verbatimQuote: Q.ulta,
          triggerLogic: { operator: "OR", conditions: [
            { type: "named_anchor_dark", anchor: "Belk" },
            { type: "named_anchor_dark", anchor: "Target" },
            { type: "named_anchor_dark", anchor: "Kohl's" },
          ] },
        }],
      }],
    });
    const q = validateLeaseRiskAtExtraction({ leaseRisk: lr, tenants: [] })
      .find((x) => x.id === "check-cotenancy-structure");
    expect(q).toBeTruthy();
    expect(q!.severity).toBe("high");
  });
});

describe("audit sweep catches deals stored before the fix", () => {
  it("emits audit-cotenancy-xofn for a flattened clause already in the library", () => {
    // stored data, NOT run through the normalizer — this is what a pre-fix deal looks like
    const stored = {
      tenants: [],
      leaseRisk: { source: "OM", coTenancyDisclosed: true, tenants: [{
        tenant: "Five Below", baseRentAnnual: 164241,
        coTenancy: [{ verbatimQuote: Q.fiveBelow, triggerLogic: { operator: "OR", conditions:
          ["Belk", "Hobby Lobby", "Ross", "HomeGoods", "Ulta"].map(a => ({ type: "named_anchor_dark", anchor: a })) } }],
      }] },
    };
    const q = auditExtraction(stored).find((x) => x.id.startsWith("audit-cotenancy-xofn-"));
    expect(q).toBeTruthy();
    expect(q!.severity).toBe("high");
    expect(q!.question).toContain("3 of 5");
  });

  it("does NOT flag a genuine single-anchor clause", () => {
    const stored = {
      tenants: [],
      leaseRisk: { source: "OM", coTenancyDisclosed: true, tenants: [{
        tenant: "Rack Room Shoes", baseRentAnnual: 68875,
        coTenancy: [{ verbatimQuote: Q.rackRoom, triggerLogic: { type: "named_anchor_dark", anchor: "Belk" } }],
      }] },
    };
    expect(auditExtraction(stored).find((x) => x.id.startsWith("audit-cotenancy-xofn-"))).toBeUndefined();
  });
});
