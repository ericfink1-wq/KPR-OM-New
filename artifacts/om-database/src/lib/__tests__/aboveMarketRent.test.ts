import { describe, it, expect } from "vitest";
import { deriveAboveMarketRolldownFlag } from "../aboveMarketRent";
import { buildBrandRentIndex } from "../renewalOptionOverhang";
import type { Deal, Tenant } from "../idb";

const mkDeal = (id: string, tenants: Tenant[], over: Partial<Deal> = {}): Deal =>
  ({ id, propertyName: id, tenantsAsOf: "2026-01-01", tenants, ...over } as unknown as Deal);

// Brand median for "Ross" ~ $10.50 across 3 other library locations.
const rossComps = [
  mkDeal("c1", [{ name: "Ross", rentPerSF: 10, sf: 25000, annualRent: 250000 }]),
  mkDeal("c2", [{ name: "Ross", rentPerSF: 11, sf: 25000, annualRent: 275000 }]),
  mkDeal("c3", [{ name: "Ross", rentPerSF: 10.5, sf: 25000, annualRent: 262500 }]),
];

describe("deriveAboveMarketRolldownFlag", () => {
  it("flags a big above-market premium as downside, never 'upside'", () => {
    const subject = mkDeal("d1", [
      { name: "Ross", rentPerSF: 16.1, sf: 25000, annualRent: 402500, isAnchor: true, leaseExpiry: "2030-02-01" },
    ]);
    const flag = deriveAboveMarketRolldownFlag(subject, buildBrandRentIndex([subject, ...rossComps]));
    expect(flag).not.toBeNull();
    expect(flag!.description).toMatch(/DOWNSIDE/);
    expect(flag!.description).toMatch(/Ross/);
    // Must never frame an above-market rent AS upside.
    expect(flag!.description).not.toMatch(/mark-to-market upside|creates .*upside|in-hold .*upside/i);
  });

  it("does NOT flag when low occupancy cost shows the premium is earned", () => {
    const subject = mkDeal("d1", [
      { name: "Ross", rentPerSF: 16.1, sf: 25000, annualRent: 402500, isAnchor: true, leaseExpiry: "2030-02-01", occupancyCost: 6 },
    ]);
    expect(deriveAboveMarketRolldownFlag(subject, buildBrandRentIndex([subject, ...rossComps]))).toBeNull();
  });

  it("high severity when a stressed anchor premium resets inside the hold", () => {
    const subject = mkDeal("d1", [
      { name: "Ross", rentPerSF: 16.1, sf: 25000, annualRent: 402500, isAnchor: true, leaseExpiry: "2029-06-01", occupancyCost: 18 },
    ]);
    const flag = deriveAboveMarketRolldownFlag(subject, buildBrandRentIndex([subject, ...rossComps]));
    expect(flag!.severity).toBe("high");
    expect(flag!.description).toMatch(/occupancy cost/);
  });

  it("no-sales case produces a measured 'verify' flag when the reset is near-term", () => {
    const subject = mkDeal("d1", [
      { name: "Ross", rentPerSF: 16.1, sf: 25000, annualRent: 402500, isAnchor: true, leaseExpiry: "2030-02-01" },
    ]);
    const flag = deriveAboveMarketRolldownFlag(subject, buildBrandRentIndex([subject, ...rossComps]))!;
    expect(flag.description).toMatch(/confirm the tenant's sales support the premium/);
  });

  it("ignores premiums under threshold, trivial $ amounts, and single-location brands", () => {
    // Only 10% above → under the 25% bar
    const small = mkDeal("d1", [{ name: "Ross", rentPerSF: 11.6, sf: 25000, annualRent: 290000 }]);
    expect(deriveAboveMarketRolldownFlag(small, buildBrandRentIndex([small, ...rossComps]))).toBeNull();

    // Above market but tiny SF → premium under $25k
    const tiny = mkDeal("d1", [{ name: "Ross", rentPerSF: 16, sf: 900, annualRent: 14400 }]);
    expect(deriveAboveMarketRolldownFlag(tiny, buildBrandRentIndex([tiny, ...rossComps]))).toBeNull();

    // Only one other location → no reliable benchmark
    const subject = mkDeal("d1", [{ name: "Rare", rentPerSF: 30, sf: 10000, annualRent: 300000, isAnchor: true, leaseExpiry: "2030-01-01" }]);
    const oneOther = mkDeal("d2", [{ name: "Rare", rentPerSF: 15, sf: 10000, annualRent: 150000 }]);
    expect(deriveAboveMarketRolldownFlag(subject, buildBrandRentIndex([subject, oneOther]))).toBeNull();
  });
});
