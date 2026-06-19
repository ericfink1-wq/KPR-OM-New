import { describe, it, expect } from "vitest";
import { applyImportFixes } from "../importFixes";

describe("applyImportFixes (auto-clean at import)", () => {
  it("normalizes a fraction occupancy cost to a percent", () => {
    const r = applyImportFixes({ tenants: [{ name: "Pet Supplies Plus", sf: 6400, occupancyCost: 0.225, annualRent: 132032 }] });
    expect((r.deal.tenants as any)[0].occupancyCost).toBe(22.5);
    expect(r.occCostFixed).toBe(1);
  });
  it("dedupes a duplicate tenant row, keeping the later lease expiry", () => {
    const r = applyImportFixes({ totalSF: 100000, tenants: [
      { name: "Planet Fitness", suite: "015", sf: 20000, leaseExpiry: "2026-02-28", annualRent: 300000 },
      { name: "Planet Fitness", suite: "015", sf: 20000, leaseExpiry: "2036-02-28", annualRent: 300000 },
    ] });
    expect((r.deal.tenants as any).length).toBe(1);
    expect((r.deal.tenants as any)[0].leaseExpiry).toBe("2036-02-28");
    expect(r.dupeFixed).toBe(1);
  });
  it("does NOT merge two different spaces of one chain (SF too different)", () => {
    const r = applyImportFixes({ tenants: [
      { name: "White House Interiors", sf: 1000, leaseExpiry: "2029-09-30", annualRent: 30000 },
      { name: "White House Interiors", sf: 18000, leaseExpiry: "2029-09-30", annualRent: 200000 },
    ] });
    expect((r.deal.tenants as any).length).toBe(2);
  });
  it("recomputes occupancy from the roster", () => {
    const r = applyImportFixes({ totalSF: 100000, occupancy: 0, tenants: [{ name: "Anchor", sf: 92000, annualRent: 500000, leaseExpiry: "2032-01-01" }] });
    expect(r.deal.occupancy).toBe(92);
  });
  it("leaves a clean deal untouched", () => {
    const r = applyImportFixes({ totalSF: 100000, occupancy: 92, tenants: [{ name: "Anchor", sf: 92000, rentPerSF: 5.43, annualRent: 500000, leaseExpiry: "2031-09-13" }] });
    expect(r.occCostFixed).toBe(0);
    expect(r.dupeFixed).toBe(0);
    expect((r.deal.tenants as any).length).toBe(1);
  });
});
