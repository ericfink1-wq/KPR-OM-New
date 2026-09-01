import { describe, it, expect } from "vitest";
import {
  runLeaseRiskPass, normalizeLeaseRisk, coerceTriggerNode,
  enforceRosterCotenancyRule, validateLeaseRiskAtExtraction, summarizeLeaseRisk,
  type DealLeaseRisk,
} from "../leaseRiskExtract";
import { robustParseJSON } from "../jsonRepair";

// A canned "model" response — deliberately dirty: it claims verified:true and a
// non-OM sourceDocument (the normalizer must override both), mixes a stringified
// trigger (must coerce to null but keep the quote), and includes an empty clause.
const cannedModelJSON = JSON.stringify({
  coTenancyDisclosed: true,
  tenants: [
    {
      tenant: "Carter's / Osh Kosh", suite: "T09", baseRentAnnual: 156410,
      coTenancy: [{
        type: "operating",
        triggerLogic: { operator: "OR", conditions: [
          { type: "named_anchor_dark", anchor: "Ulta" },
          { type: "named_anchor_dark", anchor: "PetSmart" },
          { type: "named_anchor_dark", anchor: "Dick's Sporting Goods" },
        ] },
        remedy: { mechanism: "alternate_rent_pct_sales", value: 5, additionalRentTreatment: "tenant_continues" },
        reliefPeriodMonthsBeforeTermination: 12,
        verbatimQuote: "one of the following (i) Ulta; (ii) Petsmart; or (iii) DICK'S ... 5% Alternate Rent",
        // model wrongly claims these — normalizer MUST force OM/false:
        sourceDocument: "Carter's Lease (executed)", verifiedAgainstExecutedDoc: true, provenance: "extracted",
      }],
    },
    {
      tenant: "Ulta", suite: "T07C", baseRentAnnual: 357993,
      coTenancy: [{
        type: "operating",
        triggerLogic: { operator: "OR", conditions: [
          { type: "named_anchor_dark", anchor: "Target" },
          { type: "named_anchor_dark", anchor: "Dick's Sporting Goods" },
        ] },
        remedy: { mechanism: "percent_rent_reduction", value: 50 },
        verbatimQuote: "either Target or Dick's ... one half (1/2) of the Minimum Rent",
      }],
    },
    // noise: a tenant with an empty co-tenancy and a present:false note → dropped entirely
    { tenant: "Crumble Cookies", coTenancy: [{}], otherRiskClauses: { goDarkRight: { present: false } } },
  ],
});

describe("runLeaseRiskPass (mocked model)", () => {
  it("parses + normalizes the model output to source:OM / unverified", async () => {
    let sawRosterInPrompt = false;
    const callExtract = async (content: unknown) => {
      const blocks = content as Array<{ text?: string }>;
      sawRosterInPrompt = blocks.some((b) => /Carter's \/ Osh Kosh/.test(b.text || ""));
      return { raw: cannedModelJSON, stopReason: "end_turn" };
    };
    const lr = await runLeaseRiskPass({
      callExtract, cachedBlocks: [{ type: "text", text: "OM..." }],
      tenantNames: ["Carter's / Osh Kosh", "Ulta", "Crumble Cookies"], parse: robustParseJSON,
    });
    expect(sawRosterInPrompt).toBe(true);
    expect(lr).not.toBeNull();
    expect(lr!.source).toBe("OM");
    expect(lr!.coTenancyDisclosed).toBe(true);
    // Crumble dropped (no real clause); Carter's + Ulta kept
    expect(lr!.tenants.map((t) => t.tenant).sort()).toEqual(["Carter's / Osh Kosh", "Ulta"].sort());
    // verification + source are FORCED regardless of what the model claimed
    const carters = lr!.tenants.find((t) => t.tenant.startsWith("Carter"))!;
    expect(carters.coTenancy![0].verifiedAgainstExecutedDoc).toBe(false);
    expect(carters.coTenancy![0].sourceDocument).toBe("OM");
    expect(carters.baseRentAnnual).toBe(156410);
  });

  it("returns null on a model/parse failure (never breaks the upload)", async () => {
    const callExtract = async () => { throw new Error("model down"); };
    const lr = await runLeaseRiskPass({ callExtract, cachedBlocks: [], tenantNames: [], parse: robustParseJSON });
    expect(lr).toBeNull();
  });
});

describe("normalizeLeaseRisk", () => {
  it("coerces a stringified trigger to null but keeps the clause via its quote", () => {
    const lr = normalizeLeaseRisk({ coTenancyDisclosed: true, tenants: [
      { tenant: "X", coTenancy: [{ triggerLogic: "Target goes dark", verbatimQuote: "Target ... dark" }] },
    ] });
    expect(lr.tenants[0].coTenancy![0].triggerLogic).toBeNull();
    expect(lr.tenants[0].coTenancy![0].verbatimQuote).toContain("Target");
    expect(lr.tenants[0].coTenancy![0].verifiedAgainstExecutedDoc).toBe(false);
  });

  it("accepts {leaseRisk:{...}} wrappers and drops clause-less tenants", () => {
    const lr = normalizeLeaseRisk({ leaseRisk: { tenants: [{ tenant: "Empty" }] } });
    expect(lr.tenants.length).toBe(0);
    expect(lr.coTenancyDisclosed).toBe(false);
  });
});

describe("coerceTriggerNode", () => {
  it("preserves nested OR-of-AND-pairs (the 'fewer than 2 of 3' shape)", () => {
    const node = coerceTriggerNode({ operator: "OR", conditions: [
      { operator: "AND", conditions: [ { type: "named_anchor_dark", anchor: "Target" }, { type: "named_anchor_dark", anchor: "Dick's" } ] },
      { type: "occupancy_threshold", scope: "Center GLA", direction: "below", pct: 80 },
      { junk: true },  // dropped
    ] });
    expect(node).not.toBeNull();
    expect("operator" in node! && node!.operator).toBe("OR");
    expect("conditions" in node! && node!.conditions.length).toBe(2); // junk leaf removed
  });
});

describe("enforceRosterCotenancyRule (roster backstop)", () => {
  const lr: DealLeaseRisk = normalizeLeaseRisk({ tenants: [
    { tenant: "Carter's", coTenancy: [{ triggerLogic: { operator: "OR", conditions: [
      { type: "named_anchor_dark", anchor: "PetSmart" }, { type: "named_anchor_dark", anchor: "Dick's Sporting Goods" },
    ] }, verbatimQuote: "x" }] },
  ] });

  it("drops a bare leaked anchor name but keeps real occupants and flagged shadow anchors", () => {
    const roster = [
      { name: "PetSmart" },                                   // leaked: no SF/rent/suite → DROP
      { name: "Dick's Sporting Goods", suite: "LL01", isNAP: true }, // shadow anchor → KEEP
      { name: "Ulta", sf: 10757, annualRent: 357993 },        // real occupant → KEEP
      { name: "Carter's", sf: 4501, annualRent: 156410 },     // real occupant → KEEP
    ];
    const { tenants, dropped } = enforceRosterCotenancyRule(roster, lr);
    expect(dropped).toEqual(["PetSmart"]);
    expect(tenants.map((t) => t.name).sort()).toEqual(["Carter's", "Dick's Sporting Goods", "Ulta"].sort());
  });
});

describe("validateLeaseRiskAtExtraction", () => {
  it("flags unverified OM co-tenancy and a decreasing 'increase' rent step", () => {
    const deal: Record<string, unknown> = {
      leaseRisk: normalizeLeaseRisk({ tenants: [
        { tenant: "Carter's", coTenancy: [{ triggerLogic: { operator: "OR", conditions: [{ type: "named_anchor_dark", anchor: "Dick's" }] }, verbatimQuote: "x" }] },
      ] }),
      tenants: [
        { name: "PetSmart", rentSchedule: "2024-01-01: $36.00 PSF; 2029-01-01: $26.00 PSF" }, // decrease → flag
        { name: "Five Below", rentSchedule: "2024-01-01: $20.00 PSF; 2029-01-01: $23.00 PSF" }, // clean → no flag
      ],
    };
    const qs = validateLeaseRiskAtExtraction(deal);
    expect(qs.some((q) => q.id === "check-lease-risk-unverified")).toBe(true);
    expect(qs.some((q) => q.id.startsWith("check-rent-decrease-") && /PetSmart/.test(q.field))).toBe(true);
    expect(qs.some((q) => /Five Below/.test(q.field))).toBe(false);
  });

  it("emits nothing when there is no lease risk and rents only increase", () => {
    const deal: Record<string, unknown> = { tenants: [{ name: "A", rentSchedule: "2024-01-01: $20 PSF; 2026-01-01: $22 PSF" }] };
    expect(validateLeaseRiskAtExtraction(deal).length).toBe(0);
  });
});

describe("summarizeLeaseRisk (narrative input)", () => {
  const deal: Record<string, unknown> = {
    tenants: [{ name: "Carter's / Osh Kosh", annualRent: 156410 }, { name: "Ulta", annualRent: 357993 }],
    leaseRisk: normalizeLeaseRisk({
      coTenancyDisclosed: true,
      tenants: [
        { tenant: "Carter's / Osh Kosh", baseRentAnnual: 156410, coTenancy: [{ type: "operating", triggerLogic: { operator: "OR", conditions: [
          { type: "named_anchor_dark", anchor: "Ulta" }, { type: "named_anchor_dark", anchor: "PetSmart" }, { type: "named_anchor_dark", anchor: "Dick's Sporting Goods" },
        ] }, verbatimQuote: "x" }] },
        { tenant: "Ulta", baseRentAnnual: 357993, coTenancy: [{ type: "operating", triggerLogic: { operator: "OR", conditions: [
          { type: "named_anchor_dark", anchor: "Target" }, { type: "named_anchor_dark", anchor: "Dick's Sporting Goods" },
        ] }, verbatimQuote: "x" }] },
      ],
    }),
  };

  it("summarizes Dick's Tier-1 exposure (Ulta + Carter's, $514,403) for the model to narrate", () => {
    const s = summarizeLeaseRisk(deal, []);
    expect(s).toContain("Dick's Sporting Goods");
    expect(s).toContain("$514,403");
    expect(s).toMatch(/Carter's/);
    expect(s).toMatch(/Still OM-only \(unverified/);
  });

  it("reflects the executed-lease mitigation when an Ulta abstract removes Dick's", () => {
    const ultaAbs = { tenantName: "Ulta", coTenancy: [{ type: "operating", triggerLogic: { operator: "OR", conditions: [
      { type: "named_anchor_dark", anchor: "Target" }, { type: "occupancy_threshold", scope: "inline", direction: "below", pct: 75 },
    ] }, verbatimQuote: "amended" }] };
    const s = summarizeLeaseRisk(deal, [ultaAbs]);
    expect(s).toContain("$156,410");                 // Tier-1 now just Carter's
    expect(s).toContain("reduced Tier-1 from $514,403");
    expect(s).toMatch(/Verified against executed leases:.*Ulta/);
  });

  it("returns empty when the deal has no lease risk", () => {
    expect(summarizeLeaseRisk({ tenants: [] }, [])).toBe("");
  });
});

// REGRESSION (Town N' Country, BCA): an "X of N" co-tenancy ("2 of the following
// must be open and operating") was being flattened into an OR of per-anchor
// triggers because coerceTriggerNode silently dropped anchors/openRequired/
// totalNamed. That turned a clause needing TWO dark anchors into one that trips on
// a single anchor, and overstated Belk's Tier-1 exposure at Town N' Country by
// ~15x ($1,015,131 across 6 tenants vs the true $68,875 on 1 tenant).
describe("coerceTriggerNode — X-of-N co-tenancy", () => {
  it("preserves anchors / openRequired / totalNamed on an anchor_count_below leaf", () => {
    const node = coerceTriggerNode({
      type: "anchor_count_below",
      anchors: ["Belk", "Hobby Lobby", "HomeGoods", "Ross"],
      openRequired: 3,
      totalNamed: 4,
    }) as Record<string, unknown>;
    expect(node).toBeTruthy();
    expect(node.type).toBe("anchor_count_below");
    expect(node.anchors).toEqual(["Belk", "Hobby Lobby", "HomeGoods", "Ross"]);
    expect(node.openRequired).toBe(3);
    expect(node.totalNamed).toBe(4);
  });

  it("defaults totalNamed to the named-list length when the model omits it", () => {
    const node = coerceTriggerNode({
      type: "anchor_count_below",
      anchors: ["HomeGoods", "Hobby Lobby", "Belk"],
      openRequired: 2,
    }) as Record<string, unknown>;
    expect(node.totalNamed).toBe(3);
  });

  it("keeps an X-of-N leaf intact when OR'd with a standalone occupancy prong", () => {
    const node = coerceTriggerNode({
      operator: "OR",
      conditions: [
        { type: "anchor_count_below", anchors: ["HomeGoods", "Hobby Lobby", "Belk"], openRequired: 2, totalNamed: 3 },
        { type: "occupancy_threshold", scope: "Center GLA", direction: "below", pct: 65 },
      ],
    }) as { operator: string; conditions: Array<Record<string, unknown>> };
    expect(node.operator).toBe("OR");
    expect(node.conditions).toHaveLength(2);
    expect(node.conditions[0].anchors).toEqual(["HomeGoods", "Hobby Lobby", "Belk"]);
    expect(node.conditions[0].openRequired).toBe(2);
    expect(node.conditions[1].pct).toBe(65);
  });

  it("leaves a genuine single-anchor trigger untouched", () => {
    const node = coerceTriggerNode({ type: "named_anchor_dark", anchor: "Belk" }) as Record<string, unknown>;
    expect(node.anchor).toBe("Belk");
    expect(node.anchors).toBeUndefined();
    expect(node.openRequired).toBeUndefined();
  });
});
