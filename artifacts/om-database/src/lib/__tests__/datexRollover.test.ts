import { describe, it, expect } from "vitest";
import { datexRollover } from "../../components/DatexLiveCard";
import type { Deal } from "../idb";

describe("Datex rollover buckets", () => {
  const deal = { id: "x", fileName: "x", uploadedAt: "", datexLive: { tenants: [
    { name: "A", sf: 1000, annualRent: 20000, leaseExpiry: "2027-03-31" },
    { name: "B", sf: 2000, annualRent: 30000, leaseExpiry: "2028-06-30" },
    { name: "C", sf: 5000, annualRent: 90000, leaseExpiry: "2031-01-31" },
    { name: "Old", sf: 900, annualRent: 9000, leaseExpiry: "2025-01-31" },
  ] } } as unknown as Deal;
  const r = datexRollover(deal, new Date("2026-10-17T00:00:00Z"));
  it("next 12 months", () => expect(r.y1).toEqual({ count: 1, sf: 1000, rent: 20000 }));
  it("13–24 months", () => expect(r.y2).toEqual({ count: 1, sf: 2000, rent: 30000 }));
  it("already-expired rows are not 'upcoming'", () => expect(r.next.map(n => n.name)).toEqual(["A", "B", "C"]));
});
