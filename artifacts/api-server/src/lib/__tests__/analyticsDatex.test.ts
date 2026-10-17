import { describe, it, expect } from "vitest";
import { datexRowsFor } from "../../routes/analytics";

describe("Owned analytics: Datex tenants replace the OM roster", () => {
  const om = [{ dealId: "a", rawName: "Kroger", canonicalName: "Kroger", isAnchor: true, creditRating: "BBB", annualRent: 500000, leaseExpiryDate: "2025-01-31" }] as never;
  const rows = datexRowsFor("a", [
    { name: "Kroger #4516", sf: 60000, annualRent: 540000, leaseExpiry: "2031-01-31" },
    { name: "Dollar Tree #22", sf: 9000, annualRent: 99000, leaseExpiry: "2027-06-30" },
    { name: "Vacant", sf: 1200, annualRent: 0 },
  ], om);
  it("uses Datex rent and expiry, keeps the OM's anchor and credit", () => {
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ rawName: "Kroger", annualRent: 540000, leaseExpiryDate: "2031-01-31", isAnchor: true, creditRating: "BBB" });
  });
  it("strips Datex store numbers; a small box isn't an anchor", () => expect(rows[1]).toMatchObject({ rawName: "Dollar Tree", isAnchor: false }));
});
