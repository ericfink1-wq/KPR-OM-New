import { describe, it, expect } from "vitest";
import { analyzeLeaseVintage, deriveLeaseVintageFlag } from "../leaseVintage";
import type { Deal, Tenant } from "../idb";

const mkDeal = (tenants: Tenant[], over: Partial<Deal> = {}): Deal =>
  ({ id: "d1", propertyName: "Test Center", tenants, tenantsAsOf: "2026-06-01", ...over } as unknown as Deal);

describe("analyzeLeaseVintage", () => {
  it("null when no tenants or no lease-start coverage", () => {
    expect(analyzeLeaseVintage(mkDeal([]))).toBeNull();
    expect(analyzeLeaseVintage(mkDeal([{ name: "T", annualRent: 100_000 }]))).toBeNull();
  });

  it("buckets rent by signing era", () => {
    const v = analyzeLeaseVintage(mkDeal([
      { name: "Old Anchor", annualRent: 400_000, leaseStart: "2010-01-01" },   // legacy
      { name: "Covid Deal", annualRent: 100_000, leaseStart: "2020-09-01" },   // covid
      { name: "New Shop", annualRent: 100_000, leaseStart: "2025-03-01" },     // recent
      { name: "Mid", annualRent: 100_000, leaseStart: "2022-01-01" },          // pre-covid bucket (mid-vintage)
    ]))!;
    expect(v.coveragePct).toBe(100);
    const byKey = Object.fromEntries(v.buckets.map(b => [b.key, b]));
    expect(byKey.legacy.rent).toBe(400_000);
    expect(byKey.covid.rent).toBe(100_000);
    expect(byKey.recent.rent).toBe(100_000);
    expect(Math.round(v.staleSharePct!)).toBe(57);   // 400k / 700k
    expect(Math.round(v.covidSharePct!)).toBe(14);
  });

  it("excludes vacant and NAP rows", () => {
    const v = analyzeLeaseVintage(mkDeal([
      { name: "Tenant", annualRent: 100_000, leaseStart: "2015-01-01" },
      { name: "Vacant", annualRent: 0 },
      { name: "Shadow", annualRent: 50_000, leaseStart: "2015-01-01", isNAP: true },
    ]))!;
    expect(v.totalRent).toBe(100_000);
  });

  it("computes the recent leasing spread on inline tenants only", () => {
    const v = analyzeLeaseVintage(mkDeal([
      // Old inline paper at ~$20
      { name: "Old A", annualRent: 40_000, sf: 2000, rentPerSF: 20, leaseStart: "2015-01-01" },
      { name: "Old B", annualRent: 44_000, sf: 2000, rentPerSF: 22, leaseStart: "2016-01-01" },
      // New inline signings at ~$30
      { name: "New A", annualRent: 60_000, sf: 2000, rentPerSF: 30, leaseStart: "2025-01-01" },
      { name: "New B", annualRent: 64_000, sf: 2000, rentPerSF: 32, leaseStart: "2024-09-01" },
      // Anchor excluded from the spread
      { name: "Anchor", annualRent: 400_000, sf: 50_000, rentPerSF: 8, leaseStart: "2024-06-01", isAnchor: true },
    ]))!;
    expect(v.recentSpread).not.toBeNull();
    expect(v.recentSpread!.newMedianPSF).toBe(31);
    expect(v.recentSpread!.oldMedianPSF).toBe(21);
    expect(Math.round(v.recentSpread!.spreadPct)).toBe(48);
  });
});

describe("deriveLeaseVintageFlag", () => {
  it("flags a legacy-dominated roster", () => {
    const flag = deriveLeaseVintageFlag(mkDeal([
      { name: "Old A", annualRent: 300_000, leaseStart: "2009-01-01" },
      { name: "Old B", annualRent: 200_000, leaseStart: "2012-01-01" },
      { name: "New", annualRent: 100_000, leaseStart: "2025-01-01" },
    ]));
    expect(flag).not.toBeNull();
    expect(flag!.severity).toBe("medium");
    expect(flag!.description).toMatch(/8\+ years ago/);
  });

  it("flags a COVID-heavy roster", () => {
    const flag = deriveLeaseVintageFlag(mkDeal([
      { name: "A", annualRent: 200_000, leaseStart: "2020-06-01" },
      { name: "B", annualRent: 200_000, leaseStart: "2021-03-01" },
      { name: "C", annualRent: 200_000, leaseStart: "2024-01-01" },
    ]));
    expect(flag).not.toBeNull();
    expect(flag!.description).toMatch(/2020–2021/);
  });

  it("no flag when coverage is thin or vintages are fresh", () => {
    // Fresh roster
    expect(deriveLeaseVintageFlag(mkDeal([
      { name: "A", annualRent: 200_000, leaseStart: "2024-06-01" },
      { name: "B", annualRent: 200_000, leaseStart: "2023-03-01" },
    ]))).toBeNull();
    // Thin coverage: stale lease is only 1 of 3 rents with a date missing on the rest
    expect(deriveLeaseVintageFlag(mkDeal([
      { name: "A", annualRent: 100_000, leaseStart: "2010-06-01" },
      { name: "B", annualRent: 200_000 },
      { name: "C", annualRent: 200_000 },
    ]))).toBeNull();
  });
});
