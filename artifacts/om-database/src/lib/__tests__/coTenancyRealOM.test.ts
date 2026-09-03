import { describe, it, expect } from "vitest";
import { repairCoTenancyTrigger } from "../coTenancyStructure";
import { resolveTenantRisk, computeDealExposure, computeCombinedExposure } from "../leaseRisk";
import type { Deal } from "../idb";

// END-TO-END REGRESSION, Town N' Country (BCA, Easley SC).
//
// These quotes are VERBATIM from the OM's extracted PDF text — deliberately NOT
// cleaned up. A rent-roll table extracts COLUMN-INTERLEAVED, so recovery-method and
// option-rent text is glued into each enumerated co-tenancy slot. The first version
// of this guardrail passed on hand-tidied fixtures and would have done NOTHING on
// this document, which is the only one that actually mattered. Everything below runs
// on the real thing.
const RENT_ROLL = {
  homeGoods: "Co-Tenancy Requirement: 2 of the following must be open and operating + 15% Admin on CAM & Mgmt Option 2 $11.50 i) Hobby Lobby 3% Non-Cumulative CAM Cap Option 3 $12.00 ii) Belk on Controllables Option 4 $12.50 iii) Either Ross or Ulta (Excludes utilities and snow) Reimburses Tax off 211,985 SF",
  ross: "Co-Tenancy Requirement: 2 of the following must be open and operating over PY Option 2 $12.45 i) HomeGoods PRS INS/Tax Option 3 $12.95 ii) Hobby Lobby Reimburses Tax off 211,985 SF Option 4 $13.45 iii) Belk Shopping Center Occupancy Requirement: > 65%",
  ulta: "Co-Tenancy Requirement: 3 of the following must be open and operating Controllables) Option 2 $25.09 i) Belk 3% Non-Cumulative CAM Cap Option 3 $27.60 ii) Hobby Lobby on Controllables iii) HomeGoods Reimburses Tax off 211,985 SF iv) Ross",
  fiveBelow: "Co-Tenancy Requirement: 3 of the following must be open and operating 3% Non-Cumulative CAM Cap Option 2 $23.29 i) Belk Reimburses Tax off 211,985 SF Option 3 $25.62 ii) Hobby Lobby iii) Ross iv) HomeGoods v) Ulta",
  americasBest: "Co-Tenancy Requirement: 3 of the following must be open and operating 5% Non-Cumulative CAM Cap i) Ross, Hobby Lobby, Ulta, Staples, Belk, and HomeGoods on Cont. Termination Right: If sales are not over $1.1MM by (exc. snow, utilities, and insurance) Year 6 tenant has the one-time right to terminate.",
  rackRoom: "Co-Tenancy Requirement: The following must be open and operating (excl. Electricity) i) Belk 3% Non-Cumulative CAM Cap Occupancy Requirement: LL must maintain 75% Reimburses Tax off 211,985 SF occupancy on non-anchor floor area",
};

// The flattened per-anchor OR the extraction produced before the fix.
const flat = (...anchors: string[]) =>
  ({ operator: "OR" as const, conditions: anchors.map(a => ({ type: "named_anchor_dark", anchor: a })) });

const TENANTS = [
  { tenant: "HomeGoods", rent: 233195, quote: RENT_ROLL.homeGoods, anchors: ["Hobby Lobby", "Belk", "Ross", "Ulta"] },
  { tenant: "Ross Dress for Less", rent: 251728, quote: RENT_ROLL.ross, anchors: ["HomeGoods", "Hobby Lobby", "Belk"] },
  { tenant: "Ulta", rent: 207317, quote: RENT_ROLL.ulta, anchors: ["Belk", "Hobby Lobby", "HomeGoods", "Ross"] },
  { tenant: "Five Below", rent: 164241, quote: RENT_ROLL.fiveBelow, anchors: ["Belk", "Hobby Lobby", "Ross", "HomeGoods", "Ulta"] },
  { tenant: "America's Best Contacts & Eyeglasses", rent: 89775, quote: RENT_ROLL.americasBest, anchors: ["Ross", "Hobby Lobby", "Ulta", "Staples", "Belk", "HomeGoods"] },
  { tenant: "Rack Room Shoes", rent: 68875, quote: RENT_ROLL.rackRoom, anchors: ["Belk"] },
];

const buildDeal = (repair: boolean): Deal => ({
  id: "tnc", propertyName: "Town N' Country",
  tenants: TENANTS.map(t => ({ name: t.tenant, sf: 10000, annualRent: t.rent, isAnchor: true })),
  leaseRisk: {
    source: "OM", coTenancyDisclosed: true,
    tenants: TENANTS.map(t => {
      const raw = { verbatimQuote: t.quote, triggerLogic: flat(...t.anchors) };
      return {
        tenant: t.tenant, baseRentAnnual: t.rent,
        coTenancy: [repair ? repairCoTenancyTrigger(raw).clause : raw],
      };
    }),
  },
} as unknown as Deal);

describe("Town N' Country — raw OM text through the exposure engine", () => {
  it("reproduces the BUG without the repair: Belk alone appears to trip 6 tenants", () => {
    const e = computeDealExposure(buildDeal(false), [], "Belk");
    expect(e.tier1Rent).toBe(1_015_131);
    expect(e.tier1Count).toBe(6);
  });

  it("FIXES it from the raw interleaved text: Belk alone trips only Rack Room Shoes", () => {
    const e = computeDealExposure(buildDeal(true), [], "Belk");
    expect(e.tier1Rent).toBe(68_875);
    expect(e.tier1Count).toBe(1);
    // the rest don't vanish — they move to "needs a second event"
    expect(e.tier3Rent).toBe(1_015_131);
  });

  it("every other anchor also stops falsely tripping anything on its own", () => {
    const deal = buildDeal(true);
    for (const a of ["Hobby Lobby", "HomeGoods", "Ross", "Ulta", "Staples"]) {
      expect(computeDealExposure(deal, [], a).tier1Rent).toBe(0);
    }
  });

  it("models the compound 'Either Ross or Ulta' slot correctly", () => {
    const deal = buildDeal(true);
    const trips = (...dark: string[]) =>
      new Set(computeCombinedExposure(resolveTenantRisk(deal, []), dark).clauses.map(c => c.tenant));
    // HomeGoods needs 2 of 3 slots to fail. Belk + Ross is only ONE-and-a-half:
    // slot 3 survives while Ulta is open.
    expect(trips("Belk", "Ross").has("HomeGoods")).toBe(false);
    // Belk + BOTH of Ross and Ulta fails slot 2 and slot 3 -> tripped.
    expect(trips("Belk", "Ross", "Ulta").has("HomeGoods")).toBe(true);
    // Hobby Lobby + Belk fails slots 1 and 2 -> tripped, no Ross/Ulta needed.
    expect(trips("Hobby Lobby", "Belk").has("HomeGoods")).toBe(true);
  });

  it("leaves the genuine single-anchor clause (Rack Room / Belk) untouched", () => {
    const raw = { verbatimQuote: RENT_ROLL.rackRoom, triggerLogic: flat("Belk") };
    expect(repairCoTenancyTrigger(raw).repaired).toBe(false);
  });

  it("matches the hand-built deal JSON's tiering exactly", () => {
    const deal = buildDeal(true);
    const e = computeDealExposure(deal, [], "Belk");
    expect({ t1: e.tier1Rent, t2: e.tier2Rent, t3: e.tier3Rent })
      .toEqual({ t1: 68_875, t2: 692_240, t3: 1_015_131 });
  });
});
