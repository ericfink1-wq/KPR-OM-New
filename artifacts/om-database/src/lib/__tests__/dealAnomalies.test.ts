import { describe, it, expect } from "vitest";
import { detectDealAnomalies, deriveAnomalyFlag } from "../dealAnomalies";
import type { Deal } from "../idb";

const mk = (id: string, over: Partial<Deal>): Deal => ({ id, propertyName: id, centerType: "Power Center", ...over } as Deal);

describe("dealAnomalies", () => {
  // Cohort of 6 power centers around a 7% cap / $18 avg rent
  const cohort = Array.from({ length: 6 }, (_, i) => mk("peer" + i, { capRate: 6.8 + i * 0.1, weightedAvgRentPSF: 17 + i * 0.5,
    tenants: [{ name: "Five Below", sf: 9000, annualRent: 162000, rentPerSF: 18, leaseExpiry: "2032-01-01" } as any] }));

  it("flags an out-of-band cap rate vs the product-type cohort", () => {
    const subject = mk("subject", { capRate: 3.2, weightedAvgRentPSF: 18 });
    const a = detectDealAnomalies(subject, [...cohort, subject]);
    expect(a.some((x) => /Cap rate/i.test(x.message))).toBe(true);
  });

  it("does NOT flag a normal cap rate", () => {
    const subject = mk("subject", { capRate: 7.0, weightedAvgRentPSF: 18 });
    expect(detectDealAnomalies(subject, [...cohort, subject]).some((x) => /Cap rate/i.test(x.message))).toBe(false);
  });

  it("flags a tenant rent PSF far off the brand norm", () => {
    const subject = mk("subject", { capRate: 7, tenants: [{ name: "Five Below", sf: 9000, annualRent: 360000, rentPerSF: 40, leaseExpiry: "2032-01-01" } as any] });
    const a = detectDealAnomalies(subject, [...cohort, subject]);
    expect(a.some((x) => /brand norm/i.test(x.message))).toBe(true);
  });

  it("returns null flag when nothing is anomalous", () => {
    const subject = mk("subject", { capRate: 7, weightedAvgRentPSF: 18 });
    expect(deriveAnomalyFlag(subject, [...cohort, subject])).toBeNull();
  });

  it("flags an EGREGIOUS tenant-SF outlier vs the brand norm (a likely SF typo)", () => {
    // cohort Five Belows are 9,000 SF; a 30,000 SF one (3.3×) is almost certainly a typo.
    const subject = mk("subject", { capRate: 7, weightedAvgRentPSF: 18,
      tenants: [{ name: "Five Below", sf: 30000, annualRent: 162000, rentPerSF: 18, leaseExpiry: "2032-01-01" } as any] });
    const a = detectDealAnomalies(subject, [...cohort, subject]);
    expect(a.some((x) => /SF off the brand norm/i.test(x.message))).toBe(true);
  });

  it("does NOT flag a tenant whose SF is merely a different format (within 3×)", () => {
    // 12,000 SF Five Below vs 9,000 norm = 1.3× — normal format variation, not a typo.
    const subject = mk("subject", { capRate: 7, weightedAvgRentPSF: 18,
      tenants: [{ name: "Five Below", sf: 12000, annualRent: 162000, rentPerSF: 18, leaseExpiry: "2032-01-01" } as any] });
    const a = detectDealAnomalies(subject, [...cohort, subject]);
    expect(a.some((x) => /SF off the brand norm/i.test(x.message))).toBe(false);
  });
});
