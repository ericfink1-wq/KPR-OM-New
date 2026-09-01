import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseXofN, checkCoTenancyStructure, repairCoTenancyTrigger } from "../coTenancyStructure";
import { resolveTenantRisk, computeDealExposure } from "../leaseRisk";
import type { Deal } from "../idb";

const Q_ULTA = "Co-Tenancy Requirement: 3 of the following must be open and operating  i) Belk  ii) Hobby Lobby  iii) HomeGoods  iv) Ross";
const Q_RACK = "Co-Tenancy Requirement: The following must be open and operating  i) Belk. Occupancy Requirement: LL must maintain 75% occupancy on non-anchor floor area";

// The two copies are a deliberate faithful port (the packages can't import each
// other). If one is edited without the other, the guardrail silently diverges
// between what extraction repairs and what the deal page warns about.
describe("client/server copies stay in sync", () => {
  it("differs only in the header comment", () => {
    const here = path.resolve(__dirname, "../coTenancyStructure.ts");
    const there = path.resolve(__dirname, "../../../../api-server/src/lib/coTenancyStructure.ts");
    const body = (f: string) => fs.readFileSync(f, "utf8").split(/^export interface TriggerLeafLike/m)[1];
    expect(body(here)).toBe(body(there));
  });
});

describe("client detector", () => {
  it("reads an X-of-N clause", () => {
    expect(parseXofN(Q_ULTA)).toMatchObject({ openRequired: 3, named: ["Belk", "Hobby Lobby", "HomeGoods", "Ross"] });
  });
  it("repairs a flattened trigger and leaves a real single-anchor clause alone", () => {
    const flat = { verbatimQuote: Q_ULTA, triggerLogic: { operator: "OR" as const, conditions:
      ["Belk", "Hobby Lobby", "HomeGoods", "Ross"].map(a => ({ type: "named_anchor_dark", anchor: a })) } };
    expect(repairCoTenancyTrigger(flat).repaired).toBe(true);
    expect(checkCoTenancyStructure({ verbatimQuote: Q_RACK, triggerLogic: { type: "named_anchor_dark", anchor: "Belk" } }).kind).toBe("ok");
  });
});

// The whole point of the fix, stated as a number: the repair has to move Tier 1.
describe("repair changes the exposure the panel renders", () => {
  const mk = (trigger: unknown): Deal => ({
    id: "d1", propertyName: "Test Center",
    tenants: [{ name: "Ulta", sf: 9996, annualRent: 207317, isAnchor: true }],
    leaseRisk: { source: "OM", coTenancyDisclosed: true, tenants: [{
      tenant: "Ulta", baseRentAnnual: 207317,
      coTenancy: [{ verbatimQuote: Q_ULTA, triggerLogic: trigger as never }],
    }] },
  } as unknown as Deal);

  it("Tier 1 drops to zero once the X-of-N is modeled correctly", () => {
    const flatTrigger = { operator: "OR", conditions: ["Belk", "Hobby Lobby", "HomeGoods", "Ross"].map(a => ({ type: "named_anchor_dark", anchor: a })) };
    const before = computeDealExposure(mk(flatTrigger), [], "Belk");
    expect(before.tier1Rent).toBe(207317);   // the bug: Belk alone "trips" it

    const fixed = repairCoTenancyTrigger({ verbatimQuote: Q_ULTA, triggerLogic: flatTrigger }).clause;
    const after = computeDealExposure(mk(fixed.triggerLogic), [], "Belk");
    expect(after.tier1Rent).toBe(0);         // correct: needs a second anchor dark
    expect(after.tier2Rent).toBe(207317);
  });

  it("the panel's live check flags the un-repaired deal", () => {
    const flatTrigger = { operator: "OR", conditions: ["Belk", "Hobby Lobby", "HomeGoods", "Ross"].map(a => ({ type: "named_anchor_dark", anchor: a })) };
    const resolved = resolveTenantRisk(mk(flatTrigger), []);
    const verdicts = resolved.flatMap(r => (r.coTenancy || []).map(c => checkCoTenancyStructure(c)));
    expect(verdicts.some(v => v.kind !== "ok")).toBe(true);
  });
});
