import { describe, it, expect } from "vitest";
import { findOmOmissions, deriveOmOmissionFlags } from "../omOmissions";
import type { Deal, LeaseAbstract, Tenant } from "../idb";

const mkDeal = (tenants: Tenant[], over: Partial<Deal> = {}): Deal =>
  ({ id: "d1", propertyName: "Test Center", tenants, ...over } as unknown as Deal);

const mkAbstract = (over: Partial<LeaseAbstract>): LeaseAbstract =>
  ({ id: "la_1", dealId: "d1", tenantName: "Ross", ...over } as LeaseAbstract);

describe("findOmOmissions", () => {
  it("flags a kickout in the lease that the OM never disclosed", () => {
    const deal = mkDeal([{ name: "Ross", annualRent: 300_000, sf: 25_000, salesPSF: 200 }]);
    const abs = mkAbstract({ salesKickout: [{ salesThresholdPSF: 150 }] });
    const out = findOmOmissions(deal, [abs]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("sales-kickout");
    expect(out[0].urgent).toBe(false); // sales $200 comfortably above $150 trigger
  });

  it("marks the kickout urgent when current sales sit at/near the trigger", () => {
    const deal = mkDeal([{ name: "Ross", annualRent: 300_000, sf: 25_000, salesPSF: 155 }]);
    const abs = mkAbstract({ salesKickout: [{ salesThresholdPSF: 150 }] });
    const out = findOmOmissions(deal, [abs]);
    expect(out[0].urgent).toBe(true);
  });

  it("does NOT flag when the OM disclosed the same clause group", () => {
    const deal = mkDeal(
      [{ name: "Ross", annualRent: 300_000 }],
      { leaseRisk: { tenants: [{ tenant: "Ross", salesKickout: [{ salesThresholdPSF: 150 }] }] } },
    );
    const abs = mkAbstract({ salesKickout: [{ salesThresholdPSF: 150 }] });
    expect(findOmOmissions(deal, [abs])).toHaveLength(0);
  });

  it("flags undisclosed co-tenancy and marks currently-in-effect as urgent", () => {
    const deal = mkDeal([{ name: "Ross", annualRent: 300_000 }]);
    const abs = mkAbstract({ coTenancy: [{ type: "operating", currentlyInEffect: true }] });
    const out = findOmOmissions(deal, [abs]);
    expect(out[0].kind).toBe("co-tenancy");
    expect(out[0].urgent).toBe(true);
  });

  it("flags undisclosed early-termination / go-dark / ROFR from otherRiskClauses", () => {
    const deal = mkDeal([{ name: "Ross", annualRent: 300_000 }]);
    const abs = mkAbstract({
      otherRiskClauses: {
        earlyTerminationOption: { present: true, summary: "One-time right to terminate effective 2028 with 12 months notice" },
        rofrRofo: { present: true, summary: "ROFR on any sale of the pad" },
        goDarkRight: { present: false },
      },
    });
    const kinds = findOmOmissions(deal, [abs]).map(o => o.kind).sort();
    expect(kinds).toEqual(["early-termination", "rofr-rofo"]);
  });

  it("nothing to flag when the abstract has no structured risk clauses", () => {
    const deal = mkDeal([{ name: "Ross", annualRent: 300_000 }]);
    expect(findOmOmissions(deal, [mkAbstract({})])).toHaveLength(0);
  });
});

describe("deriveOmOmissionFlags", () => {
  it("clusters a tenant's omissions into one flag and says NOT IN THE OM", () => {
    const deal = mkDeal([{ name: "Ross", annualRent: 300_000, sf: 25_000 }]);
    const abs = mkAbstract({
      salesKickout: [{ salesThresholdPSF: 150 }],
      otherRiskClauses: { earlyTerminationOption: { present: true, summary: "Termination right in 2028" } },
    });
    const flags = deriveOmOmissionFlags(deal, [abs]);
    expect(flags).toHaveLength(1);
    expect(flags[0].description).toMatch(/NOT IN THE OM/);
    expect(flags[0].description).toMatch(/kickout/);
    expect(flags[0].description).toMatch(/termination/i);
  });

  it("anchor or large-rent tenants with a rent lever are high severity", () => {
    const deal = mkDeal([
      { name: "Ross", annualRent: 300_000, isAnchor: true },
      { name: "Other", annualRent: 700_000 },
    ]);
    const abs = mkAbstract({ salesKickout: [{ salesThresholdPSF: 150 }] });
    expect(deriveOmOmissionFlags(deal, [abs])[0].severity).toBe("high");
  });

  it("an exclusive alone is low severity", () => {
    const deal = mkDeal([{ name: "Ross", annualRent: 30_000 }, { name: "Big", annualRent: 900_000 }]);
    const abs = mkAbstract({ exclusives: [{ description: "No other off-price apparel" }] as never });
    const flags = deriveOmOmissionFlags(deal, [abs]);
    expect(flags[0].severity).toBe("low");
  });
});
