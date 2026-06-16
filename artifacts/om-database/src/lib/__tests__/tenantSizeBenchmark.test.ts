import { describe, it, expect } from "vitest";
import { buildBrandSizeIndex, flagTenantSize } from "../tenantSizeBenchmark";
import type { Deal } from "../idb";

const mk = (id: string, tenants: { name: string; sf: number | null }[]): Deal =>
  ({ id, tenants: tenants.map((t) => ({ name: t.name, sf: t.sf, annualRent: (t.sf ?? 1) * 15, leaseExpiry: "2030-01-01" })) } as unknown as Deal);

describe("tenantSizeBenchmark", () => {
  // Five Below at ~9k across 4 other centers; subject is a 25k outlier (likely a SF error)
  const deals = [
    mk("d1", [{ name: "Five Below", sf: 9000 }, { name: "TJ Maxx", sf: 24000 }]),
    mk("d2", [{ name: "Five Below", sf: 9200 }]),
    mk("d3", [{ name: "Five Below", sf: 8800 }]),
    mk("d4", [{ name: "Five Below", sf: 9100 }]),
    mk("subject", [{ name: "Five Below", sf: 25000 }, { name: "TJ Maxx", sf: 25000 }, { name: "Lonely Brand", sf: 5000 }]),
  ];
  const idx = buildBrandSizeIndex(deals);

  it("flags a tenant whose SF is way above the brand prototype", () => {
    const f = flagTenantSize({ name: "Five Below", sf: 25000, annualRent: 375000, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).not.toBeNull();
    expect(f!.direction).toBe("above");
    expect(f!.tip).toMatch(/median across 4 other Five Below/i);
  });

  it("does NOT flag a tenant in range of its prototype", () => {
    const f = flagTenantSize({ name: "Five Below", sf: 9300, annualRent: 139500, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).toBeNull();
  });

  it("does NOT flag when there are too few other locations (no prototype)", () => {
    // TJ Maxx has only 1 other location (d1) → below MIN_OTHER_LOCATIONS
    const f = flagTenantSize({ name: "TJ Maxx", sf: 25000, annualRent: 300000, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).toBeNull();
  });

  it("excludes the subject's own deal from the prototype (no self-bias)", () => {
    // 'Lonely Brand' only appears in subject → no others → null
    const f = flagTenantSize({ name: "Lonely Brand", sf: 5000, annualRent: 75000, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).toBeNull();
  });

  it("flags way-below outliers too", () => {
    const f = flagTenantSize({ name: "Five Below", sf: 3500, annualRent: 52500, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).not.toBeNull();
    expect(f!.direction).toBe("below");
  });
});
