import { describe, it, expect } from "vitest";
import { buildLatestSales, tenantKey } from "../utils";
import type { Deal } from "../idb";

const mk = (over: Partial<Deal>): Deal => ({ id: "d1", tenants: [], ...over } as Deal);

describe("buildLatestSales — anecdotal flag", () => {
  it("carries a record-level anecdotal figure through to the resolved sale", () => {
    const deal = mk({
      tenants: [{ name: "Best Buy", sf: 45000 } as any],
      tenantSalesHistory: [{ year: 2025, source: "manual", tenants: [
        { name: "Best Buy", salesPSF: 300, sf: 45000, anecdotal: true, provenance: "Tenant-reported, entered 6/24/26" } as any,
      ] }],
    } as Partial<Deal>);
    const ls = buildLatestSales(deal).get(tenantKey("Best Buy"));
    expect(ls?.salesPSF).toBe(300);
    expect(ls?.anecdotal).toBe(true);
    expect(ls?.provenance).toMatch(/Tenant-reported/);
  });

  it("treats a whole anecdotal-source snapshot as anecdotal", () => {
    const deal = mk({
      tenants: [{ name: "Whole Foods", sf: 40000 } as any],
      tenantSalesHistory: [{ year: 2024, source: "anecdotal", tenants: [
        { name: "Whole Foods", salesPSF: 900, sf: 40000 } as any,
      ] }],
    } as Partial<Deal>);
    expect(buildLatestSales(deal).get(tenantKey("Whole Foods"))?.anecdotal).toBe(true);
  });

  it("does NOT mark a hard uploaded sales figure anecdotal", () => {
    const deal = mk({
      tenants: [{ name: "Target", sf: 120000 } as any],
      tenantSalesHistory: [{ year: 2025, source: "upload", tenants: [
        { name: "Target", salesPSF: 350, sf: 120000 } as any,
      ] }],
    } as Partial<Deal>);
    expect(buildLatestSales(deal).get(tenantKey("Target"))?.anecdotal).toBeFalsy();
  });
});
