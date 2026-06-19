import { describe, it, expect } from "vitest";
import { scoreDealConfidence } from "../dealConfidence";
import type { Deal } from "../idb";

const base = (over: Partial<Deal>): Deal => ({ id: "d", propertyName: "Test", ...over } as Deal);

describe("scoreDealConfidence", () => {
  it("scores a complete, consistent, fresh deal as High", () => {
    const d = base({
      address: "1 Main St", state: "OH", totalSF: 100000, occupancy: 95, noi: 2_000_000,
      walt: 7, weightedAvgRentPSF: 18, grossPotentialRent: 3_000_000,
      omDate: "2026-01-01", tenantsAsOf: "2026-01-01", analysisVersion: 3, notes: "Solid center.",
      marketDemographics: { pop3mi: 80000 } as any, comparableSales: [{ salePrice: 1 }] as any,
      tenants: [
        { name: "Kroger", sf: 60000, annualRent: 600000, leaseExpiry: "2034-01-01" } as any,
        { name: "TJ Maxx", sf: 30000, rentPerSF: 12, leaseExpiry: "2031-01-01" } as any,
        { name: "Vacant", sf: 10000 } as any,
      ],
    });
    const r = scoreDealConfidence(d);
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.label).toBe("High");
    expect(r.gaps.length).toBe(0);
  });

  it("flags a thin deal as Low and lists the gaps", () => {
    const d = base({ totalSF: 100000, tenants: [] });
    const r = scoreDealConfidence(d);
    expect(r.score).toBeLessThan(50);
    expect(r.label).toBe("Low");
    expect(r.gaps.some((g) => /No tenant roster/.test(g))).toBe(true);
    expect(r.gaps.some((g) => /No OM date/.test(g))).toBe(true);
  });

  it("docks consistency points for open arithmetic flags", () => {
    const withFlag = base({
      address: "1 Main St", state: "OH", totalSF: 100000, occupancy: 95, noi: 2_000_000,
      walt: 7, weightedAvgRentPSF: 18, grossPotentialRent: 3_000_000, omDate: "2026-01-01",
      tenants: [{ name: "Kroger", sf: 60000, annualRent: 600000, leaseExpiry: "2034-01-01" } as any],
      reviewQuestions: [{ id: "audit-noi-cap-price", source: "check", question: "NOI ÷ cap doesn't match price." }] as any,
    });
    const clean = base({ ...withFlag, reviewQuestions: [] as any });
    expect(scoreDealConfidence(withFlag).score).toBeLessThan(scoreDealConfidence(clean).score);
    expect(scoreDealConfidence(withFlag).gaps.some((g) => /don't tie out/.test(g))).toBe(true);
  });
});
