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

// ── the REAL document, not a tidied fixture ─────────────────────────────────────
// A rent-roll table extracts COLUMN-INTERLEAVED: recovery-method and option-rent
// text gets glued into each enumerated co-tenancy slot. The first cut of this
// guardrail passed on hand-cleaned quotes and would have repaired NOTHING on the
// Town N' Country OM that motivated it. These are verbatim from that PDF's text.
const RAW = {
  homeGoods: "Co-Tenancy Requirement: 2 of the following must be open and operating + 15% Admin on CAM & Mgmt Option 2 $11.50 i) Hobby Lobby 3% Non-Cumulative CAM Cap Option 3 $12.00 ii) Belk on Controllables Option 4 $12.50 iii) Either Ross or Ulta (Excludes utilities and snow) Reimburses Tax off 211,985 SF",
  ross: "Co-Tenancy Requirement: 2 of the following must be open and operating over PY Option 2 $12.45 i) HomeGoods PRS INS/Tax Option 3 $12.95 ii) Hobby Lobby Reimburses Tax off 211,985 SF Option 4 $13.45 iii) Belk Shopping Center Occupancy Requirement: > 65%",
  ulta: "Co-Tenancy Requirement: 3 of the following must be open and operating Controllables) Option 2 $25.09 i) Belk 3% Non-Cumulative CAM Cap Option 3 $27.60 ii) Hobby Lobby on Controllables iii) HomeGoods Reimburses Tax off 211,985 SF iv) Ross",
  americasBest: "Co-Tenancy Requirement: 3 of the following must be open and operating 5% Non-Cumulative CAM Cap i) Ross, Hobby Lobby, Ulta, Staples, Belk, and HomeGoods on Cont. Termination Right: If sales are not over $1.1MM by (exc. snow, utilities, and insurance) Year 6 tenant has the one-time right to terminate.",
  rackRoom: "Co-Tenancy Requirement: The following must be open and operating (excl. Electricity) i) Belk 3% Non-Cumulative CAM Cap Occupancy Requirement: LL must maintain 75% Reimburses Tax off 211,985 SF occupancy on non-anchor floor area",
};

describe("interleaved rent-roll text (the real document)", () => {
  it("recovers the count and repairs a 3-of-4 despite column noise in every slot", () => {
    const t = repairCoTenancyTrigger({ verbatimQuote: RAW.ulta, triggerLogic: orOf("Belk", "Hobby Lobby", "HomeGoods", "Ross") });
    expect(t.repaired).toBe(true);
    expect(t.clause.triggerLogic).toMatchObject({
      type: "anchor_count_below", openRequired: 3, totalNamed: 4,
      anchors: ["Belk", "Hobby Lobby", "HomeGoods", "Ross"],
    });
  });

  it("repairs a 2-of-3 and keeps the >65% occupancy prong separate", () => {
    const t = repairCoTenancyTrigger({
      verbatimQuote: RAW.ross,
      triggerLogic: { operator: "OR" as const, conditions: [
        { type: "named_anchor_dark", anchor: "HomeGoods" },
        { type: "named_anchor_dark", anchor: "Hobby Lobby" },
        { type: "named_anchor_dark", anchor: "Belk" },
        { type: "occupancy_threshold", scope: "Center GLA", direction: "below", pct: 65 },
      ] },
    });
    const n = t.clause.triggerLogic as { conditions: Array<Record<string, unknown>> };
    expect(n.conditions[0]).toMatchObject({ type: "anchor_count_below", openRequired: 2, totalNamed: 3 });
    expect(n.conditions[1]).toMatchObject({ type: "occupancy_threshold", pct: 65 });
  });

  it("recovers a comma series glued to trailing column text (3 of 6)", () => {
    const t = repairCoTenancyTrigger({
      verbatimQuote: RAW.americasBest,
      triggerLogic: orOf("Ross", "Hobby Lobby", "Ulta", "Staples", "Belk", "HomeGoods"),
    });
    expect(t.clause.triggerLogic).toMatchObject({ type: "anchor_count_below", openRequired: 3, totalNamed: 6 });
  });

  it("expands a compound 'Either Ross or Ulta' slot into explicit AND-branches", () => {
    const t = repairCoTenancyTrigger({ verbatimQuote: RAW.homeGoods, triggerLogic: orOf("Hobby Lobby", "Belk", "Ross", "Ulta") });
    expect(t.repaired).toBe(true);
    const n = t.clause.triggerLogic as { operator: string; conditions: Array<{ conditions?: Array<{ anchor: string }> }> };
    expect(n.operator).toBe("OR");
    // 2 of 3 slots must fail => C(3,2) = 3 combinations
    expect(n.conditions).toHaveLength(3);
    const combos = n.conditions.map(x => (x.conditions ?? []).map(l => l.anchor).sort().join("+")).sort();
    expect(combos).toEqual(["Belk+Hobby Lobby", "Belk+Ross+Ulta", "Hobby Lobby+Ross+Ulta"]);
  });

  it("still leaves the genuine single-anchor clause alone", () => {
    expect(checkCoTenancyStructure({ verbatimQuote: RAW.rackRoom, triggerLogic: { type: "named_anchor_dark", anchor: "Belk" } }).kind).toBe("ok");
  });

  it("does NOT match an anchor inside a longer word (Ross vs Crossing)", () => {
    const v = checkCoTenancyStructure({
      verbatimQuote: "2 of the following must be open and operating i) Wake Forest Crossing ii) Belk iii) Kohl's",
      triggerLogic: orOf("Ross", "Belk", "Kohl's"),
    });
    expect(v.kind).toBe("mismatch");   // Ross is genuinely absent; never a false 'found'
  });

  it("flags rather than guesses when a shared slot is joined by AND, not OR", () => {
    const v = checkCoTenancyStructure({
      verbatimQuote: "2 of the following must be open and operating i) Hobby Lobby ii) Belk iii) Ross plus Ulta",
      triggerLogic: orOf("Hobby Lobby", "Belk", "Ross", "Ulta"),
    });
    expect(v.kind).toBe("mismatch");
    if (v.kind === "mismatch") expect(v.compoundSlot).toBe(true);
  });
});
