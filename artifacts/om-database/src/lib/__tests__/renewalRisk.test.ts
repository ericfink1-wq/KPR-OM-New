import { describe, it, expect } from "vitest";
import { assessRenewalRisk, buildRenewalRiskIndex, computeRentAtRisk } from "../renewalRisk";
import type { Deal, Tenant } from "../idb";

const mkDeal = (tenants: Tenant[], over: Partial<Deal> = {}): Deal =>
  ({ id: "d1", propertyName: "Test Center", tenants, tenantsAsOf: "2026-06-01", ...over } as unknown as Deal);

describe("assessRenewalRisk", () => {
  it("cheap occupancy cost = secure with high-ish score", () => {
    const r = assessRenewalRisk({ name: "Grocer", occupancyCost: 2.5 });
    expect(r.band).toBe("secure");
    expect(r.probability).toBeGreaterThanOrEqual(75);
    expect(r.drivers.join(" ")).toMatch(/occupancy cost/);
  });

  it("unsustainable occupancy cost = at risk", () => {
    const r = assessRenewalRisk({ name: "Struggling Tenant", occupancyCost: 22 });
    expect(r.band).toBe("at-risk");
  });

  it("normalizes fraction occupancy cost (0.14 → 14%)", () => {
    const r = assessRenewalRisk({ name: "T", occupancyCost: 0.14 });
    expect(r.drivers.join(" ")).toMatch(/14\.0%/);
  });

  it("bankruptcy watchlist status dominates", () => {
    const r = assessRenewalRisk({ name: "Chain" }, { watchStatus: "bankruptcy" });
    expect(r.band).toBe("at-risk");
    expect(r.drivers[0]).toMatch(/bankruptcy/);
  });

  it("dark store is at risk even with no other data", () => {
    const r = assessRenewalRisk({ name: "Dark Box", isDark: true });
    expect(r.band).toBe("at-risk");
  });

  it("declining sales hurt the score", () => {
    const base = assessRenewalRisk({ name: "T" });
    const declining = assessRenewalRisk({ name: "T", salesPSF: 300, priorSalesPSF: 400 });
    expect(declining.probability).toBeLessThan(base.probability);
  });

  it("below-market rent raises renewal probability", () => {
    const cheap = assessRenewalRisk({ name: "T", rentPerSF: 8 }, { marketMedianRentPSF: 14 });
    const base = assessRenewalRisk({ name: "T", rentPerSF: 14 }, { marketMedianRentPSF: 14 });
    expect(cheap.probability).toBeGreaterThan(base.probability);
  });

  it("no signals = base rate, low confidence", () => {
    const r = assessRenewalRisk({ name: "Totally Unknown Shop LLC" });
    expect(r.confidence).toBe("low");
    expect(r.band === "likely" || r.band === "secure").toBe(true);
  });

  it("occupancy cost present = at least medium confidence", () => {
    const r = assessRenewalRisk({ name: "T", occupancyCost: 9 });
    expect(["medium", "high"]).toContain(r.confidence);
  });
});

describe("buildRenewalRiskIndex + computeRentAtRisk", () => {
  it("scores every occupied tenant and skips vacant/NAP", () => {
    const tenants: Tenant[] = [
      { name: "Grocer", annualRent: 500_000, leaseExpiry: "2027-01-31", occupancyCost: 2.5 },
      { name: "Vacant", annualRent: 0 },
      { name: "Shadow Anchor", annualRent: 0, isNAP: true },
    ];
    const idx = buildRenewalRiskIndex(mkDeal(tenants));
    expect(idx.size).toBe(1);
    expect(idx.get(tenants[0])).toBeTruthy();
  });

  it("rent at risk counts only leases expiring in the window, weighted by probability", () => {
    const tenants: Tenant[] = [
      // Expiring inside 36 months, healthy → small at-risk contribution
      { name: "Healthy", annualRent: 100_000, leaseExpiry: "2027-06-01", occupancyCost: 6 },
      // Expiring inside 36 months, stressed → large contribution
      { name: "Stressed", annualRent: 100_000, leaseExpiry: "2027-06-01", occupancyCost: 22 },
      // Expiring far out → excluded from window
      { name: "LongLease", annualRent: 100_000, leaseExpiry: "2035-01-01" },
    ];
    const deal = mkDeal(tenants);
    const idx = buildRenewalRiskIndex(deal);
    const rar = computeRentAtRisk(deal, idx, 36);
    expect(rar.tenantsInWindow).toBe(2);
    expect(rar.expiring).toBe(200_000);
    expect(rar.totalRent).toBe(300_000);
    // Stressed tenant contributes far more than the healthy one
    const healthy = idx.get(tenants[0])!, stressed = idx.get(tenants[1])!;
    expect(stressed.probability).toBeLessThan(healthy.probability);
    expect(rar.atRisk).toBeGreaterThan(100_000 * (1 - healthy.probability / 100));
    expect(rar.atRisk).toBeLessThan(200_000);
  });

  it("already-expired (holdover) leases count as in-window", () => {
    const tenants: Tenant[] = [{ name: "Holdover", annualRent: 50_000, leaseExpiry: "2025-01-01" }];
    const deal = mkDeal(tenants);
    const rar = computeRentAtRisk(deal, buildRenewalRiskIndex(deal), 36);
    expect(rar.tenantsInWindow).toBe(1);
  });
});
