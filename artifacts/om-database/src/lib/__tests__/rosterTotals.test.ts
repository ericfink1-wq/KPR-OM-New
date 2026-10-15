import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { rosterTotals } from "../rosterTotals";
import type { Tenant } from "../idb";

// The real Frederick County Square roster (Newmark package), whose own totals are
// known: 240,307 SF leased of 242,282 SF, $4,357,629 base rent, $18.13 avg rent/SF.
const fred = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../../samples/deals/frederick-county-square-md.json"), "utf8")).deals[0];
const tenants: Tenant[] = fred.tenants;

describe("roster totals row", () => {
  const t = rosterTotals(tenants, undefined, Date.parse("2027-01-01T00:00:00Z"));
  it("ties to the broker's own SF and rent totals", () => {
    expect(t.totalSF).toBe(242282);
    expect(t.occupiedSF).toBe(240307);
    expect(t.annualRent).toBe(4357629);
    expect(t.rentPSF!.toFixed(2)).toBe("18.13");
    expect(t.pctLeased!.toFixed(1)).toBe("99.2");
  });
  it("counts tenants and vacancy separately (the 0-SF antenna is a tenant, the suite is vacant)", () => {
    expect(t.tenantCount).toBe(23);
    expect(t.vacantCount).toBe(1);
  });
  it("WALT is SF-weighted", () => {
    expect(t.walt).toBeGreaterThan(5);
    expect(t.walt).toBeLessThan(7.5);
  });
  it("totals only what's shown when filtered (e.g. anchors)", () => {
    const anchors = rosterTotals(tenants.filter(x => x.isAnchor));
    expect(anchors.occupiedSF).toBe(27643 + 15990 + 35000 + 17094 + 31088 + 51818);
    expect(anchors.vacantCount).toBe(0);
  });
  it("NAP parcels are excluded; a tenant with no rent doesn't drag the average down", () => {
    const r = rosterTotals([
      { name: "A", sf: 1000, annualRent: 20000 },
      { name: "B", sf: 1000, annualRent: null, leaseExpiry: "2030-01-31" },
      { name: "Outparcel", sf: 5000, annualRent: 0, isNAP: true },
    ] as Tenant[]);
    expect(r.totalSF).toBe(2000);
    expect(r.rentPSF).toBe(20);
    expect(r.annualRent).toBe(20000);
  });
  it("sales are weighted by SF across reporting tenants only", () => {
    const r = rosterTotals([
      { name: "Big", sf: 30000, annualRent: 300000, salesPSF: 300 },
      { name: "Small", sf: 2000, annualRent: 60000, salesPSF: 600 },
      { name: "Silent", sf: 5000, annualRent: 100000 },
    ] as Tenant[]);
    expect(r.salesReporting).toBe(2);
    expect(Math.round(r.salesPSF!)).toBe(Math.round((300 * 30000 + 600 * 2000) / 32000));
  });
});
