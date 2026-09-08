import { describe, it, expect } from "vitest";
import { buildLatestSales, tenantKey } from "../utils";
import type { Deal } from "../idb";

// A stated occupancy cost in (0,1) is normally a fraction that lost its ×100 on import.
// But sub-1% is NOT impossible: Waterway Pharmacy (Project Evergreen) runs 2,400 SF at
// $2,816 PSF of script revenue = $6.76M of sales against $58,652 of rent + recoveries =
// 0.87%. Rescaling that would render the healthiest tenant in the center as 87%.
const mk = (over: Partial<Deal>): Deal => ({ id: "d1", tenants: [], ...over } as Deal);

describe("buildLatestSales — sub-1% occupancy cost", () => {
  const pharmacyDeal = (occ: number) => mk({
    tenants: [{ name: "Waterway Pharmacy", sf: 2400, annualRent: 48120, expenseReimbursements: 10532 } as any],
    tenantSalesHistory: [{ year: 2025, source: "upload", tenants: [
      { name: "Waterway Pharmacy", salesPSF: 2816, sf: 2400, occupancyCost: occ } as any,
    ] }],
  } as Partial<Deal>);

  it("keeps a 0.87% that the tenant's own rent and sales corroborate", () => {
    const ls = buildLatestSales(pharmacyDeal(0.87)).get(tenantKey("Waterway Pharmacy"));
    expect(ls?.occupancyCost).toBeCloseTo(0.87, 2);
  });

  it("still rescales a genuine dropped-×100 the sales contradict", () => {
    // Sales imply 0.87%, so a stored 0.0087 is a real fraction slip.
    const ls = buildLatestSales(pharmacyDeal(0.0087)).get(tenantKey("Waterway Pharmacy"));
    expect(ls?.occupancyCost).toBeCloseTo(0.87, 2);
  });

  it("still rescales a sub-1 value with no rent/sales to corroborate it", () => {
    const deal = mk({
      tenants: [{ name: "Pet Supplies Plus", sf: 6400 } as any],
      tenantSalesHistory: [{ year: 2025, source: "upload", tenants: [
        { name: "Pet Supplies Plus", sf: 6400, occupancyCost: 0.225 } as any,
      ] }],
    } as Partial<Deal>);
    expect(buildLatestSales(deal).get(tenantKey("Pet Supplies Plus"))?.occupancyCost).toBeCloseTo(22.5, 1);
  });
});
