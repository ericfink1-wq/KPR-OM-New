import { describe, it, expect } from "vitest";
import { buildBrandSizeIndex, flagTenantSize } from "../tenantSizeBenchmark";
import type { Deal } from "../idb";

const mk = (id: string, tenants: { name: string; sf: number | null }[]): Deal =>
  ({ id, tenants: tenants.map((t) => ({ name: t.name, sf: t.sf, annualRent: (t.sf ?? 1) * 15, leaseExpiry: "2030-01-01" })) } as unknown as Deal);

describe("tenantSizeBenchmark", () => {
  // Five Below at ~9k across 4 other centers; subject is a 25k outlier (likely a SF error)
  const deals = [
    mk("d1", [{ name: "Five Below", sf: 9000 }, { name: "TJ Maxx", sf: 24000 }]),
    mk("d2", [{ name: "Five Below", sf: 9200 }]),
    mk("d3", [{ name: "Five Below", sf: 8800 }]),
    mk("d4", [{ name: "Five Below", sf: 9100 }]),
    mk("subject", [{ name: "Five Below", sf: 25000 }, { name: "TJ Maxx", sf: 25000 }, { name: "Lonely Brand", sf: 5000 }]),
  ];
  const idx = buildBrandSizeIndex(deals);

  it("flags a tenant whose SF is way above the brand prototype", () => {
    const f = flagTenantSize({ name: "Five Below", sf: 25000, annualRent: 375000, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).not.toBeNull();
    expect(f!.direction).toBe("above");
    expect(f!.tip).toMatch(/median across 4 other Five Below/i);
  });

  it("does NOT flag a tenant in range of its prototype", () => {
    const f = flagTenantSize({ name: "Five Below", sf: 9300, annualRent: 139500, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).toBeNull();
  });

  it("does NOT flag when there are too few other locations (no prototype)", () => {
    // TJ Maxx has only 1 other location (d1) → below MIN_OTHER_LOCATIONS
    const f = flagTenantSize({ name: "TJ Maxx", sf: 25000, annualRent: 300000, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).toBeNull();
  });

  it("excludes the subject's own deal from the prototype (no self-bias)", () => {
    // 'Lonely Brand' only appears in subject → no others → null
    const f = flagTenantSize({ name: "Lonely Brand", sf: 5000, annualRent: 75000, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).toBeNull();
  });

  it("flags way-below outliers too", () => {
    const f = flagTenantSize({ name: "Five Below", sf: 3500, annualRent: 52500, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).not.toBeNull();
    expect(f!.direction).toBe("below");
  });
});

import { deriveSizeOutlierFlag } from "../tenantSizeBenchmark";
describe("deriveSizeOutlierFlag (deal red flag)", () => {
  const deals = [
    mk("d1", [{ name: "Five Below", sf: 9000 }]),
    mk("d2", [{ name: "Five Below", sf: 9200 }]),
    mk("d3", [{ name: "Five Below", sf: 8800 }]),
    mk("d4", [{ name: "Five Below", sf: 9100 }]),
  ];
  const idx = buildBrandSizeIndex(deals);
  it("returns a flag listing the off-prototype tenant", () => {
    const subject = mk("subject", [{ name: "Five Below", sf: 25000 }, { name: "Solo Brand", sf: 4000 }]);
    const f = deriveSizeOutlierFlag(subject, idx);
    expect(f).not.toBeNull();
    expect(f!.description).toMatch(/Five Below/);
    expect(f!.description).not.toMatch(/Solo Brand/); // no benchmark → not listed
  });
  it("returns null when nothing is off-prototype", () => {
    const subject = mk("subject", [{ name: "Five Below", sf: 9000 }]);
    expect(deriveSizeOutlierFlag(subject, idx)).toBeNull();
  });
});

describe("TJX combo boxes", () => {
  const idx = buildBrandSizeIndex([]); // no prototype needed — combo path is size-based
  it("returns a combo read (not an SF anomaly) for an oversized single-banner box", () => {
    const f = flagTenantSize({ name: "Marshalls of MA, Inc.", sf: 55000, annualRent: 632500, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).not.toBeNull();
    expect(f!.combo).toBe(true);
    expect(f!.label).toMatch(/combo/i);
    expect(f!.tip).toMatch(/two banners/i);
  });
  it("suppresses the flag entirely for an explicit two-banner combo name", () => {
    const f = flagTenantSize({ name: "Marshalls / HomeGoods", sf: 55000, annualRent: 632500, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).toBeNull();
  });
  it("keeps combos out of the deal-level SF-error red flag", () => {
    const subject = mk("subject", [{ name: "Marshalls of MA, Inc.", sf: 55000 }]);
    expect(deriveSizeOutlierFlag(subject, idx)).toBeNull();
  });
});

describe("3-location brand (the DSW case)", () => {
  // DSW across exactly 3 properties: Belden 31,859 (subject) vs Battlefield 20,000 + Paddock 14,673
  const deals = [
    mk("belden", [{ name: "DSW", sf: 31859 }]),
    mk("battlefield", [{ name: "DSW", sf: 20000 }]),
    mk("paddock", [{ name: "DSW", sf: 14673 }]),
  ];
  const idx = buildBrandSizeIndex(deals);
  it("flags Belden's oversized DSW with only 2 other locations", () => {
    const f = flagTenantSize({ name: "DSW", sf: 31859, annualRent: 414167, leaseExpiry: "2029-01-01" } as any, "belden", idx);
    expect(f).not.toBeNull();
    expect(f!.direction).toBe("above");
    expect(f!.tip).toMatch(/2 other DSW locations/i);
  });
});
