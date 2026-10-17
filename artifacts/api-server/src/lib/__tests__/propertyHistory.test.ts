import { describe, it, expect } from "vitest";
import { diffSnapshots, recordHistory, brandKey, isNewDocument } from "../propertyHistory";

// Shaped on the real New Garden Crossing pair (2021 OM vs 2026 OM).
const old = {
  fileName: "BCA - New Garden Crossing OM", omDate: "2021-02-01", noi: 2091749, occupancy: 100, totalSF: 168950,
  tenants: [
    { name: "Lowes Foods", suite: "14", sf: 49673, rentPerSF: 10.7, leaseExpiry: "2026-05-08", isAnchor: true },
    { name: "Office Depot (GL)", suite: "1", sf: 20000, rentPerSF: 13.75, leaseExpiry: "2027-06-30", isAnchor: true },
    { name: "Tinsley's Cleaners", suite: "2", sf: 2050, rentPerSF: 16.48, leaseExpiry: "2025-10-31" },
    { name: "Wagner Financial Services", suite: "7", sf: 1400, leaseExpiry: "2023-12-31" },
    { name: "Lily & Co. Beauty Lounge", suite: "3", sf: 1600 },
  ],
};
const neu = {
  fileName: "BCA - New Garden Crossing OM", uploadedAt: "2026-09-02T16:18:12.803Z", noi: 2356972, occupancy: 100, totalSF: 168950,
  tenants: [
    { name: "Lowes Foods", suite: "12", sf: 49673, rentPerSF: 11.2, leaseExpiry: "2031-05-08", isAnchor: true },
    { name: "Office Depot", suite: "1", sf: 20000, rentPerSF: 15, leaseExpiry: "2027-06-30", isAnchor: true },
    { name: "Degree of Wellness", suite: "2", sf: 2050, leaseStart: "2026-04-01" },
    { name: "Lily & Company Beauty Lounge", suite: "3", sf: 1600 },
    { name: "Green Zone Recycling" },
  ],
};

describe("property history", () => {
  it("folds name variants together", () => {
    expect(brandKey("Office Depot (GL)")).toBe(brandKey("Office Depot"));
    expect(brandKey("Lily & Co. Beauty Lounge")).toBe(brandKey("Lily & Company Beauty Lounge"));
  });
  it("records backfills, departures, arrivals, renewals, anchor rent and NOI moves", () => {
    const t = diffSnapshots(old, neu).map(e => `${e.kind}: ${e.text}`);
    expect(t).toContain("backfill: Tinsley's Cleaners (2,050 SF) replaced by Degree of Wellness (2,050 SF)");
    expect(t.some(x => x.startsWith("left: Wagner Financial Services"))).toBe(true);
    expect(t).toContain("arrived: Green Zone Recycling added");
    expect(t).toContain("renewed: Lowes Foods extended: lease to 2026-05-08 → 2031-05-08");
    expect(t).toContain("rent: Lowes Foods base rent $10.70 → $11.20/SF");
    expect(t).toContain("rent: Office Depot base rent $13.75 → $15.00/SF");
    expect(t.some(x => x.startsWith("metric: NOI $2.09M → $2.36M"))).toBe(true);
    expect(t.some(x => x.includes("Lily"))).toBe(false); // same tenant, nothing changed
  });
  it("appends once, dated by each document, and never duplicates", () => {
    const n: Record<string, unknown> = { ...neu };
    expect(recordHistory(old, n, "2026-10-17T00:00:00Z")).toBe(true);
    const h = n.propertyHistory as Array<{ fromAsOf: string; toAsOf: string }>;
    expect(h[0].fromAsOf).toBe("2021-02-01"); expect(h[0].toAsOf).toBe("2026-09-02");
    expect(recordHistory(old, n)).toBe(false);
  });
  it("keeps the earlier history when a later document arrives", () => {
    const n: Record<string, unknown> = { ...neu };
    recordHistory(old, n);
    const later = { ...neu, tenantsAsOf: "2027-03-01", noi: 2500000, propertyHistory: n.propertyHistory };
    recordHistory(n, later);
    expect((later.propertyHistory as unknown[]).length).toBe(2);
  });
  it("only treats a new upload as a new document, not ordinary edits", () => {
    expect(isNewDocument({ tenants: [{}], lastUploadAt: "a" }, { lastUploadAt: "b" })).toBe(true);
    expect(isNewDocument({ tenants: [{}], lastUploadAt: "a" }, { lastUploadAt: "a", userNotes: "x" })).toBe(false);
    expect(isNewDocument({ tenants: [] }, { lastUploadAt: "b" })).toBe(false);
  });
});

describe("history entry identity", () => {
  it("doesn't re-record the same pair when a document's OM date is corrected later", () => {
    const a = { lastUploadAt: "2021-03-01T00:00:00Z", noi: 100, tenants: [{ name: "A" }] };
    const b: Record<string, unknown> = { lastUploadAt: "2026-09-02T00:00:00Z", noi: 200, tenants: [{ name: "B" }] };
    expect(recordHistory(a, b)).toBe(true);
    expect(recordHistory({ ...a, omDate: "2021-02-01" }, { ...b, omDate: "2026-08-01" } as Record<string, unknown> & { propertyHistory?: unknown }) || (b.propertyHistory as unknown[]).length).toBe(1);
  });
});
