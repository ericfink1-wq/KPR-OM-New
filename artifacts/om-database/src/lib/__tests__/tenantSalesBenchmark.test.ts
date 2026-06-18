import { describe, it, expect } from "vitest";
import { buildBrandSalesIndex, flagTenantSales, deriveSalesOutlierFlag } from "../tenantSalesBenchmark";
import type { Deal } from "../idb";

const mk = (id: string, tenants: { name: string; salesPSF: number | null }[]): Deal =>
  ({ id, tenants: tenants.map((t) => ({ name: t.name, sf: 5000, salesPSF: t.salesPSF, annualRent: 75000, leaseExpiry: "2030-01-01" })) } as unknown as Deal);

describe("tenantSalesBenchmark", () => {
  // Chipotle doing ~$700/SF across 4 other centers; subject is a $250/SF underperformer.
  const deals = [
    mk("d1", [{ name: "Chipotle", salesPSF: 700 }, { name: "Panera", salesPSF: 500 }]),
    mk("d2", [{ name: "Chipotle", salesPSF: 720 }]),
    mk("d3", [{ name: "Chipotle", salesPSF: 680 }]),
    mk("d4", [{ name: "Chipotle", salesPSF: 710 }]),
    mk("subject", [{ name: "Chipotle", salesPSF: 250 }, { name: "Panera", salesPSF: 1200 }, { name: "Lonely Brand", salesPSF: 300 }]),
  ];
  const idx = buildBrandSalesIndex(deals);

  it("flags a tenant whose sales PSF is way below the brand prototype", () => {
    const f = flagTenantSales({ name: "Chipotle", salesPSF: 250, sf: 5000, annualRent: 75000, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).not.toBeNull();
    expect(f!.direction).toBe("below");
    expect(f!.tip).toMatch(/median across 4 other Chipotle/i);
  });

  it("flags a tenant whose sales PSF is way above the brand prototype", () => {
    const f = flagTenantSales({ name: "Chipotle", salesPSF: 1500, sf: 5000, annualRent: 75000, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).not.toBeNull();
    expect(f!.direction).toBe("above");
  });

  it("does NOT flag a tenant in range of its prototype", () => {
    const f = flagTenantSales({ name: "Chipotle", salesPSF: 705, sf: 5000, annualRent: 75000, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).toBeNull();
  });

  it("does NOT flag when there are too few other locations (no prototype)", () => {
    // Panera has only 1 other location (d1) → below MIN_OTHER_LOCATIONS
    const f = flagTenantSales({ name: "Panera", salesPSF: 1200, sf: 5000, annualRent: 75000, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).toBeNull();
  });

  it("excludes the subject's own deal from the prototype (no self-bias)", () => {
    const f = flagTenantSales({ name: "Lonely Brand", salesPSF: 300, sf: 5000, annualRent: 75000, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).toBeNull();
  });
});

describe("deriveSalesOutlierFlag (deal red flag)", () => {
  const deals = [
    mk("d1", [{ name: "Chipotle", salesPSF: 700 }]),
    mk("d2", [{ name: "Chipotle", salesPSF: 720 }]),
    mk("d3", [{ name: "Chipotle", salesPSF: 680 }]),
    mk("d4", [{ name: "Chipotle", salesPSF: 710 }]),
  ];
  const idx = buildBrandSalesIndex(deals);
  it("returns a medium flag for an underperforming store", () => {
    const subject = mk("subject", [{ name: "Chipotle", salesPSF: 250 }, { name: "Solo Brand", salesPSF: 400 }]);
    const f = deriveSalesOutlierFlag(subject, idx);
    expect(f).not.toBeNull();
    expect(f!.severity).toBe("medium");
    expect(f!.description).toMatch(/Chipotle/);
    expect(f!.description).not.toMatch(/Solo Brand/); // no benchmark → not listed
  });
  it("returns null when nothing is off-prototype", () => {
    const subject = mk("subject", [{ name: "Chipotle", salesPSF: 700 }]);
    expect(deriveSalesOutlierFlag(subject, idx)).toBeNull();
  });
});
