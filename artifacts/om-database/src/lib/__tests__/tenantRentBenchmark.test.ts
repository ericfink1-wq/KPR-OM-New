import { describe, it, expect } from "vitest";
import { buildBrandRentPsfIndex, flagTenantRent, buildRentFlags } from "../tenantRentBenchmark";
import type { Deal, Tenant } from "../idb";

const mkDeal = (id: string, tenants: Tenant[]): Deal =>
  ({ id, propertyName: id, tenants } as unknown as Deal);

// Three other Ross leases → chain median $10.50/SF.
const rossComps = [
  mkDeal("c1", [{ name: "Ross", rentPerSF: 10, sf: 25000, annualRent: 250000 }]),
  mkDeal("c2", [{ name: "Ross", rentPerSF: 11, sf: 25000, annualRent: 275000 }]),
  mkDeal("c3", [{ name: "Ross", rentPerSF: 10.5, sf: 25000, annualRent: 262500 }]),
];

describe("flagTenantRent", () => {
  it("flags a materially ABOVE-chain rent as a premium (red / above)", () => {
    const subject: Tenant = { name: "Ross", rentPerSF: 16.1, sf: 25000, annualRent: 402500 };
    const idx = buildBrandRentPsfIndex([mkDeal("d1", [subject]), ...rossComps]);
    const f = flagTenantRent(subject, "d1", idx)!;
    expect(f.direction).toBe("above");
    expect(f.pct).toBe(53);
    expect(f.tip).toMatch(/PREMIUM/i);
    expect(f.tip).toMatch(/inflates in-place NOI|rollover/i);
  });

  it("flags a materially BELOW-chain rent as a favorable basis (green / below)", () => {
    const subject: Tenant = { name: "Ross", rentPerSF: 7, sf: 25000, annualRent: 175000 };
    const idx = buildBrandRentPsfIndex([mkDeal("d1", [subject]), ...rossComps]);
    const f = flagTenantRent(subject, "d1", idx)!;
    expect(f.direction).toBe("below");
    expect(f.pct).toBeLessThan(0);
    expect(f.tip).toMatch(/below-market|favorable/i);
  });

  it("does not flag an in-line rent", () => {
    const subject: Tenant = { name: "Ross", rentPerSF: 11, sf: 25000, annualRent: 275000 };
    const idx = buildBrandRentPsfIndex([mkDeal("d1", [subject]), ...rossComps]);
    expect(flagTenantRent(subject, "d1", idx)).toBeNull();
  });

  it("needs 2+ OTHER locations and excludes the subject deal", () => {
    const subject: Tenant = { name: "Rare", rentPerSF: 30, sf: 10000, annualRent: 300000 };
    const idx = buildBrandRentPsfIndex([mkDeal("d1", [subject]), mkDeal("d2", [{ name: "Rare", rentPerSF: 12, sf: 10000, annualRent: 120000 }])]);
    expect(flagTenantRent(subject, "d1", idx)).toBeNull(); // only 1 other location
  });

  it("skips vacant / NAP / no-rent rows", () => {
    const idx = buildBrandRentPsfIndex(rossComps);
    expect(flagTenantRent({ name: "Vacant", rentPerSF: 99, sf: 1000 }, "d1", idx)).toBeNull();
    expect(flagTenantRent({ name: "Ross", rentPerSF: null, sf: 25000 } as Tenant, "d1", idx)).toBeNull();
  });

  it("buildRentFlags maps flagged tenants by key", () => {
    const subject: Tenant = { name: "Ross", rentPerSF: 16.1, sf: 25000, annualRent: 402500 };
    const deal = mkDeal("d1", [subject, { name: "InlineOnly", rentPerSF: 20, sf: 2000, annualRent: 40000 }]);
    const idx = buildBrandRentPsfIndex([deal, ...rossComps]);
    const flags = buildRentFlags(deal, idx);
    expect(flags.size).toBe(1); // only Ross has a chain benchmark
    expect([...flags.values()][0].direction).toBe("above");
  });
});
