import { describe, it, expect } from "vitest";
import { auditExtraction } from "../extractionAudit";

// Regression tests for the deterministic checks added in the 2026-06-19 extraction-
// quality push, so they keep firing on real errors and stay quiet on clean data.

describe("audit — lease-date chronology", () => {
  it("flags an expiry on/before the commencement (swapped columns)", () => {
    const deal = { tenants: [{ name: "Five Guys", sf: 3000, leaseStart: "2030-01-01", leaseExpiry: "2025-01-01" }] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-lease-dates"))).toBe(true);
  });
  it("does NOT flag a normal start→expiry order", () => {
    const deal = { tenants: [{ name: "Five Guys", sf: 3000, leaseStart: "2020-01-01", leaseExpiry: "2030-01-01" }] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-lease-dates"))).toBe(false);
  });
});

describe("audit — occupancy over 100%", () => {
  it("flags occupancy > 100", () => {
    expect(auditExtraction({ occupancy: 105 }).some((q) => q.id === "audit-occupancy-over-100")).toBe(true);
  });
  it("does NOT flag a valid occupancy", () => {
    expect(auditExtraction({ occupancy: 94.5 }).some((q) => q.id === "audit-occupancy-over-100")).toBe(false);
  });
});

describe("audit — sales PSF below rent PSF (units slip)", () => {
  it("flags sales below rent (occupancy cost > 100%)", () => {
    const deal = { tenants: [{ name: "Panera", sf: 4000, rentPerSF: 42, salesPSF: 20 }] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-sales-below-rent"))).toBe(true);
  });
  it("does NOT flag healthy sales above rent", () => {
    const deal = { tenants: [{ name: "Panera", sf: 4000, rentPerSF: 42, salesPSF: 700 }] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-sales-below-rent"))).toBe(false);
  });
});

describe("audit — renovation before built", () => {
  it("flags a renovation year before the year built", () => {
    expect(auditExtraction({ yearBuilt: 2004, renovationYear: 1990 }).some((q) => q.id === "audit-reno-before-built")).toBe(true);
  });
  it("does NOT flag reno after built", () => {
    expect(auditExtraction({ yearBuilt: 1990, renovationYear: 2004 }).some((q) => q.id === "audit-reno-before-built")).toBe(false);
  });
});

describe("audit — grocery-anchored center missing its anchor", () => {
  it("flags when no grocer, no anchor flag, and no anchor-sized box is present", () => {
    const deal = { centerType: "Grocery-Anchored Neighborhood Center", tenants: [
      { name: "Nail Salon", sf: 1500 }, { name: "Subway", sf: 1800 }, { name: "Mailbox Etc", sf: 1200 },
    ] };
    expect(auditExtraction(deal).some((q) => q.id === "audit-anchor-missing")).toBe(true);
  });
  it("does NOT flag when the grocer (and a big box) is present", () => {
    const deal = { centerType: "Grocery-Anchored Neighborhood Center", tenants: [
      { name: "Kroger", sf: 45000, isAnchor: true }, { name: "Subway", sf: 1800 }, { name: "Nail Salon", sf: 1500 },
    ] };
    expect(auditExtraction(deal).some((q) => q.id === "audit-anchor-missing")).toBe(false);
  });
});

describe("audit — duplicate tenant row", () => {
  it("flags the same tenant on two occupied rows", () => {
    const deal = { tenants: [
      { name: "Planet Fitness", suite: "A", sf: 20000, annualRent: 200000 },
      { name: "Planet Fitness", suite: "B", sf: 20000, annualRent: 200000 },
    ] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-dupe-tenant"))).toBe(true);
  });
});

describe("audit — WALT recompute vs stated", () => {
  it("flags a stated WALT that is far from the roster's SF-weighted expiries", () => {
    const tenants = Array.from({ length: 5 }, (_, i) => ({ name: `T${i}`, sf: 10000, leaseExpiry: "2031-01-01" }));
    // refDate = tenantsAsOf 2026-01-01, expiries +5yr → computed WALT ~5, stated 15 → fires.
    const deal = { walt: 15, tenantsAsOf: "2026-01-01", tenants };
    expect(auditExtraction(deal).some((q) => q.id === "audit-walt-recompute")).toBe(true);
  });
  it("does NOT flag a stated WALT that matches the roster", () => {
    const tenants = Array.from({ length: 5 }, (_, i) => ({ name: `T${i}`, sf: 10000, leaseExpiry: "2031-01-01" }));
    const deal = { walt: 5, tenantsAsOf: "2026-01-01", tenants };
    expect(auditExtraction(deal).some((q) => q.id === "audit-walt-recompute")).toBe(false);
  });
});

describe("audit — occupied tenant with zero base rent", () => {
  it("flags a leased tenant with $0 base rent and no percentage/other rent", () => {
    const deal = { tenants: [
      { name: "Mystery Shop", suite: "12", sf: 4500, annualRent: 0, rentPerSF: 0 },
    ] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-zero-rent"))).toBe(true);
  });
  it("does NOT flag a percentage-in-lieu tenant ($0 base but pays % of sales)", () => {
    const deal = { tenants: [
      { name: "Express Outlet", suite: "110", sf: 7640, annualRent: 0, rentPerSF: 0, percentageRent: 174737 },
    ] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-zero-rent"))).toBe(false);
  });
  it("does NOT flag a $0-base tenant whose leaseType is flagged percentage-in-lieu (amount unknown)", () => {
    const deal = { tenants: [
      { name: "Victoria's Secret", suite: "B01", sf: 5772, annualRent: 0, rentPerSF: 0, leaseType: "Percentage-in-lieu" },
    ] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-zero-rent"))).toBe(false);
  });
  it("does NOT flag a vacant suite or a tenant that pays base rent", () => {
    const deal = { tenants: [
      { name: "Vacant", suite: "08", sf: 1800, annualRent: 0, rentPerSF: 0, leaseType: "Vacant" },
      { name: "Chase Bank", suite: "13", sf: 4860, annualRent: 346060, rentPerSF: 71.21 },
    ] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-zero-rent"))).toBe(false);
  });
});
