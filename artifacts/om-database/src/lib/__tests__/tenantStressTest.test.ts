import { describe, it, expect } from "vitest";
import { runTenantStressTest } from "../tenantStressTest";
import type { Deal, Tenant } from "../idb";

const mkDeal = (id: string, tenants: Tenant[], over: Partial<Deal> = {}): Deal =>
  ({ id, propertyName: `Center ${id}`, tenants, ...over } as unknown as Deal);

// A deal where Inline Co's co-tenancy trips if Joann alone goes dark.
const dealWithCoTenancy = mkDeal("d1", [
  { name: "Joann", annualRent: 250_000, sf: 20_000, isAnchor: true },
  { name: "Inline Co", annualRent: 90_000, sf: 3_000 },
], {
  leaseRisk: {
    tenants: [{
      tenant: "Inline Co",
      baseRentAnnual: 90_000,
      coTenancy: [{ type: "operating", triggerLogic: { type: "named_anchor_dark", anchor: "Joann" } }],
    }],
  },
});

const dealDirectOnly = mkDeal("d2", [
  { name: "Joann", annualRent: 180_000, sf: 18_000 },
  { name: "Other", annualRent: 100_000 },
]);

const dealUnrelated = mkDeal("d3", [{ name: "Kroger", annualRent: 500_000 }]);

describe("runTenantStressTest", () => {
  it("sums direct rent + tier-1 co-tenancy knock-on across deals", () => {
    const r = runTenantStressTest("Joann", ["Joann"], [dealWithCoTenancy, dealDirectOnly, dealUnrelated]);
    expect(r.rows).toHaveLength(2); // d3 untouched
    expect(r.totalDirectRent).toBe(430_000);
    expect(r.totalTier1Rent).toBe(90_000);
    expect(r.totalAtRisk).toBe(520_000);
    const d1 = r.rows.find(x => x.dealId === "d1")!;
    expect(d1.dependents).toEqual(["Inline Co"]);
    expect(d1.totalAtRisk).toBe(340_000);
  });

  it("rows sort by total at risk, worst first", () => {
    const r = runTenantStressTest("Joann", ["Joann"], [dealDirectOnly, dealWithCoTenancy]);
    expect(r.rows[0].dealId).toBe("d1"); // 340k > 180k
  });

  it("parent mode: multiple banners fail together without double-counting a clause", () => {
    // One clause names BOTH banners (an X-of-N list) — must count Inline Co once.
    const deal = mkDeal("d4", [
      { name: "Marshalls", annualRent: 200_000, isAnchor: true },
      { name: "HomeGoods", annualRent: 150_000, isAnchor: true },
      { name: "Inline Co", annualRent: 80_000 },
    ], {
      leaseRisk: {
        tenants: [{
          tenant: "Inline Co",
          baseRentAnnual: 80_000,
          coTenancy: [{ type: "operating", triggerLogic: { operator: "OR", conditions: [
            { type: "named_anchor_dark", anchor: "Marshalls" },
            { type: "named_anchor_dark", anchor: "HomeGoods" },
          ] } }],
        }],
      },
    });
    const r = runTenantStressTest("TJX Companies", ["Marshalls", "HomeGoods"], [deal]);
    expect(r.totalDirectRent).toBe(350_000);
    expect(r.totalTier1Rent).toBe(80_000); // once, not twice
  });

  it("skips trashed deals and NAP presences contribute no direct rent", () => {
    const trashed = mkDeal("d5", [{ name: "Joann", annualRent: 99_000 }], { trashedAt: "2026-01-01" } as Partial<Deal>);
    const nap = mkDeal("d6", [{ name: "Joann", annualRent: 0, sf: 20_000, isNAP: true }]);
    const r = runTenantStressTest("Joann", ["Joann"], [trashed, nap]);
    expect(r.rows.find(x => x.dealId === "d5")).toBeUndefined();
    const d6 = r.rows.find(x => x.dealId === "d6");
    expect(d6?.directRent ?? 0).toBe(0);
  });
});
