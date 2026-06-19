import { describe, it, expect } from "vitest";
import { auditExtraction } from "../extractionAudit";

// Regression tests for the data-integrity bugs fixed during the 2026-06-18 audit
// session, so they can't silently come back.

describe("audit — occupancy cost stored as a fraction (×100 slip)", () => {
  it("flags a sub-1 occupancy cost with the ×100 value as the suggested fix", () => {
    const deal = { tenants: [{ name: "Pet Supplies Plus", sf: 6400, occupancyCost: 0.225, annualRent: 132032 }] };
    const f = auditExtraction(deal).find((q) => q.id.startsWith("audit-occcost-fraction"));
    expect(f).toBeDefined();
    expect(f!.suggestedValue).toBe("22.5");
  });
  it("does NOT flag a normal percent occupancy cost", () => {
    const deal = { tenants: [{ name: "TJ Maxx", sf: 30000, occupancyCost: 6.5, annualRent: 270000 }] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-occcost-fraction"))).toBe(false);
  });
});

describe("audit — cash-flow NOI sign bug (OpEx stored negative)", () => {
  it("does NOT false-flag when NOI = EGR − |OpEx| and OpEx is negative", () => {
    // 2,160,000 − 473,289 = 1,686,711 = NOI → correct, must not fire.
    const deal = { noi: 1686711, cashFlowProjection: [{ egr: 2160000, operatingExpenses: -473289, noi: 1686711 }] };
    expect(auditExtraction(deal).some((q) => q.id === "audit-cf-noi-row")).toBe(false);
  });
  it("still flags a genuinely wrong cash-flow NOI row", () => {
    const deal = { noi: 1686711, cashFlowProjection: [{ egr: 2160000, operatingExpenses: -473289, noi: 1000000 }] };
    expect(auditExtraction(deal).some((q) => q.id === "audit-cf-noi-row")).toBe(true);
  });
});

describe("audit — SF short of GLA: unlisted vacancy vs dropped suite", () => {
  it("is LOW/cosmetic when the shortfall matches the stated occupancy (un-itemized vacancy)", () => {
    // 92,000 occupied / 100,000 GLA = 92% = stated occupancy → the 8k gap is just vacancy.
    const deal = { totalSF: 100000, occupancy: 92, tenants: [{ name: "Anchor", sf: 92000, annualRent: 500000 }] };
    const f = auditExtraction(deal).find((q) => q.id === "audit-sf-gla-short");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("low");
  });
  it("is HIGH when occupied SF falls well below what the stated occupancy implies (dropped tenant)", () => {
    // stated 96% implies 96k occupied, but only 80k is on the roster → a real dropped suite.
    const deal = { totalSF: 100000, occupancy: 96, tenants: [{ name: "Anchor", sf: 80000, annualRent: 400000 }] };
    const f = auditExtraction(deal).find((q) => q.id === "audit-sf-gla-short");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("high");
  });
});

describe("audit — real-world rent plausibility", () => {
  it("flags an anchor (large SF) with an implausibly high per-SF rent as 'verify' (low)", () => {
    const deal = { tenants: [{ name: "Kroger", sf: 50000, rentPerSF: 32, annualRent: 1600000 }] };
    const f = auditExtraction(deal).find((q) => q.id.startsWith("audit-anchor-rent"));
    expect(f).toBeDefined();
    expect(f!.severity).toBe("low");
  });
  it("does NOT flag a normal anchor rent", () => {
    const deal = { tenants: [{ name: "Kroger", sf: 50000, rentPerSF: 9, annualRent: 450000 }] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-anchor-rent"))).toBe(false);
  });
  it("flags a physically impossible retail rent (>$175/SF on a 2,000+ SF space) as high", () => {
    const deal = { tenants: [{ name: "Misread Inline", sf: 3000, rentPerSF: 250, annualRent: 750000 }] };
    const f = auditExtraction(deal).find((q) => q.id.startsWith("audit-rent-impossible"));
    expect(f).toBeDefined();
    expect(f!.severity).toBe("high");
  });
  it("does NOT flag a tiny ATM/kiosk with a high per-SF rent (legitimate)", () => {
    const deal = { tenants: [{ name: "Bank of America ATM", sf: 60, rentPerSF: 550, annualRent: 33000 }] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-rent-impossible") || q.id.startsWith("audit-anchor-rent"))).toBe(false);
  });
});

describe("audit — remaining term vs lease expiry (mis-keyed date/term skews WALT)", () => {
  it("flags a remaining term that contradicts the lease-expiry date", () => {
    // Roll date 2026-01-01; expiry 2031-01-01 = 5.0 yrs out, but term says 1.0 → mis-key.
    const deal = { tenantsAsOf: "2026-01-01", tenants: [{ name: "Five Below", sf: 9000, remainingTermYears: 1, leaseExpiry: "2031-01-01" }] };
    const f = auditExtraction(deal).find((q) => q.id.startsWith("audit-remterm-expiry"));
    expect(f).toBeDefined();
    expect(f!.suggestedValue).toBe("5.0");
  });
  it("does NOT flag when remaining term agrees with the expiry date", () => {
    const deal = { tenantsAsOf: "2026-01-01", tenants: [{ name: "Five Below", sf: 9000, remainingTermYears: 5, leaseExpiry: "2031-01-01" }] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-remterm-expiry"))).toBe(false);
  });
});
