import { describe, it, expect } from "vitest";
import { buildIntelPatch, type IntelProposal } from "../intelExtract";
import type { Deal } from "../idb";

// buildIntelPatch is the APPLY half of the Add-Intel feature — it writes typed sales /
// lease intel into the structured deal. It touches money, so these lock the behavior:
// concrete sales chart it, anecdotal stays badged, lease changes are "reported", and
// nothing clobbers an existing uploaded sales snapshot.

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: "d1",
  propertyName: "Test Center",
  totalSF: 50000,
  tenants: [
    { name: "Whole Foods", sf: 40000, annualRent: 600000, rentPerSF: 15, leaseExpiry: "2030-01-01" },
    { name: "Best Buy", sf: 20000, annualRent: 240000, rentPerSF: 12, leaseExpiry: "2029-06-30" },
  ],
  ...over,
} as unknown as Deal);

const emptyProposal = (over: Partial<IntelProposal>): IntelProposal =>
  ({ sales: [], leases: [], notes: [], rawText: "note", summary: "s", ...over });

describe("buildIntelPatch — sales", () => {
  it("charts a concrete sales figure and derives PSF from roster SF", () => {
    const p = emptyProposal({
      sales: [{ id: "s1", tenantName: "Whole Foods", rosterMatch: "Whole Foods", year: 2024, annualSales: 40_000_000, salesPSF: null, sf: null, anecdotal: false, note: null, include: true }],
    });
    const patch = buildIntelPatch(deal(), p);
    const snap = patch.tenantSalesHistory?.find(h => h.year === 2024);
    expect(snap?.source).toBe("manual");
    const rec = snap?.tenants[0];
    expect(rec?.annualSales).toBe(40_000_000);
    expect(rec?.salesPSF).toBe(1000); // 40M / 40,000 SF
    expect(rec?.anecdotal).toBeFalsy();
    expect(rec?.provenance).toMatch(/Manually entered/);
  });

  it("flags an anecdotal figure and tags the snapshot anecdotal", () => {
    const p = emptyProposal({
      sales: [{ id: "s1", tenantName: "Best Buy", rosterMatch: "Best Buy", year: 2024, annualSales: 6_000_000, salesPSF: null, sf: null, anecdotal: true, note: "owner said roughly", include: true }],
    });
    const snap = buildIntelPatch(deal(), p).tenantSalesHistory?.find(h => h.year === 2024);
    expect(snap?.source).toBe("anecdotal");
    expect(snap?.tenants[0]?.anecdotal).toBe(true);
    expect(snap?.tenants[0]?.provenance).toMatch(/anecdotal/i);
  });

  it("does NOT clobber an existing uploaded sales snapshot for the same year", () => {
    const existing = deal({ tenantSalesHistory: [
      { year: 2024, uploadedAt: "2025-01-01T00:00:00Z", source: "upload", tenants: [{ name: "Panera", salesPSF: 700, annualSales: 2_800_000, sf: 4000 }] },
    ] });
    const p = emptyProposal({
      sales: [{ id: "s1", tenantName: "Whole Foods", rosterMatch: "Whole Foods", year: 2024, annualSales: 40_000_000, salesPSF: null, sf: null, anecdotal: false, note: null, include: true }],
    });
    const hist = buildIntelPatch(existing, p).tenantSalesHistory!;
    expect(hist.find(h => h.source === "upload")?.tenants[0]?.name).toBe("Panera"); // untouched
    expect(hist.find(h => h.source === "manual")?.tenants[0]?.name).toBe("Whole Foods");
  });

  it("merges a second manual entry for the same year without losing the first", () => {
    const first = buildIntelPatch(deal(), emptyProposal({
      sales: [{ id: "s1", tenantName: "Whole Foods", rosterMatch: "Whole Foods", year: 2024, annualSales: 40_000_000, salesPSF: null, sf: null, anecdotal: false, note: null, include: true }],
    }));
    const second = buildIntelPatch(deal({ tenantSalesHistory: first.tenantSalesHistory }), emptyProposal({
      sales: [{ id: "s2", tenantName: "Best Buy", rosterMatch: "Best Buy", year: 2024, annualSales: 8_000_000, salesPSF: null, sf: null, anecdotal: false, note: null, include: true }],
    }));
    const snap = second.tenantSalesHistory?.find(h => h.year === 2024);
    expect(snap?.tenants.map(t => t.name).sort()).toEqual(["Best Buy", "Whole Foods"]);
  });

  it("skips items the user unchecked", () => {
    const p = emptyProposal({
      sales: [{ id: "s1", tenantName: "Whole Foods", rosterMatch: "Whole Foods", year: 2024, annualSales: 40_000_000, salesPSF: null, sf: null, anecdotal: false, note: null, include: false }],
    });
    expect(buildIntelPatch(deal(), p).tenantSalesHistory).toBeUndefined();
  });
});

describe("buildIntelPatch — lease changes", () => {
  it("applies a reported expiry extension and flags it on the tenant", () => {
    const p = emptyProposal({
      leases: [{ id: "l1", tenantName: "Best Buy", rosterMatch: "Best Buy", change: "Extend 5 years early", field: "leaseExpiry", newValue: "2034-06-30", reported: true, note: null, include: true }],
    });
    const patch = buildIntelPatch(deal(), p);
    const bb = patch.tenants?.find(t => t.name === "Best Buy");
    expect(bb?.leaseExpiry).toBe("2034-06-30");
    expect(bb?.assumptionNote).toMatch(/reported — not yet executed/);
    expect(patch.analysisStale).toBe(true);
  });

  it("ignores a lease change with no roster match", () => {
    const p = emptyProposal({
      leases: [{ id: "l1", tenantName: "Mystery Tenant", rosterMatch: null, change: "x", field: "leaseExpiry", newValue: "2034-01-01", reported: true, note: null, include: true }],
    });
    expect(buildIntelPatch(deal(), p).tenants).toBeUndefined();
  });
});

describe("buildIntelPatch — intel log", () => {
  it("always records the raw note with an applied summary", () => {
    const p = emptyProposal({
      rawText: "Whole Foods doing $40M",
      sales: [{ id: "s1", tenantName: "Whole Foods", rosterMatch: "Whole Foods", year: 2024, annualSales: 40_000_000, salesPSF: null, sf: null, anecdotal: false, note: null, include: true }],
      notes: [{ id: "n1", text: "Whole Foods doing $40M", category: "sales", include: true }],
    });
    const intel = buildIntelPatch(deal(), p).dealIntel!;
    expect(intel).toHaveLength(1);
    expect(intel[0].text).toBe("Whole Foods doing $40M");
    expect(intel[0].applied).toMatch(/Whole Foods 2024/);
  });
});
