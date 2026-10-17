import { describe, it, expect } from "vitest";
import { buildPeerIndex, isGroundOrPad, sizeBand } from "../mtmPeers";
import type { Deal } from "../idb";

const deal = (id: string, state: string, tenants: Deal["tenants"]): Deal => ({ id, state, tenants, fileName: id, uploadedAt: "2025-01-01" } as Deal);
const T = (name: string, sf: number, rentPerSF: number, extra: Record<string, unknown> = {}) => ({ name, sf, rentPerSF, leaseStart: "2022-01-01", ...extra });

describe("like-for-like mark-to-market peers", () => {
  const lib = [
    deal("a", "PA", [T("Office Depot", 20000, 5)]),
    deal("b", "PA", [T("Office Depot", 22000, 7)]),
    deal("c", "NJ", [T("Office Depot", 21000, 8)]),
    deal("d", "CA", [T("Office Depot", 5000, 30)]),         // small format — different band
    deal("e", "PA", [T("Office Depot", 20000, 40, { leaseType: "Ground Lease" })]),  // ground lease — excluded
    deal("f", "TX", [T("Office Depot", 23000, 6)]),
  ];
  const idx = buildPeerIndex(lib, 2026);
  it("compares within size band + region, leaving out other formats and ground leases", () => {
    const p = idx.get(lib[0].tenants![0], lib[0], 0)!;
    expect(p.band).toBe("10–25k");
    expect(p.basis).toBe("national");        // only 2 other Northeast stores in the band → national
    expect(p.median).toBeLessThan(10);         // never the $30 small store or the $40 ground lease
  });
  it("ground leases and tiny pads are not compared", () => {
    expect(isGroundOrPad({ name: "Stop & Shop (GL)" } as never)).toBe(true);
    expect(isGroundOrPad({ name: "Wells Fargo ATM", sf: 60 } as never)).toBe(true);
    expect(idx.get(lib[4].tenants![0], lib[4], 0)).toBeNull();
  });
  it("percentile for thin sets", () => {
    const p = idx.get(lib[0].tenants![0], lib[0], 0)!;
    expect(p.n).toBeLessThan(5);
    expect(p.percentile).toBe(0);   // $5 is the cheapest of its peers
  });
  it("uses the region once it has 3+ peers", () => {
    const more = [...lib, deal("g", "NY", [T("Office Depot", 24000, 9)])];
    const p = buildPeerIndex(more, 2026).get(more[0].tenants![0], more[0], 0)!;
    expect(p.basis).toBe("region");
    expect(p.region).toBe("Northeast");
    expect(p.n).toBe(3);
  });
  it("bands", () => { expect(sizeBand(9999)).toBe("<10k"); expect(sizeBand(25000)).toBe("25–50k"); expect(sizeBand(60000)).toBe("50k+"); });
});
