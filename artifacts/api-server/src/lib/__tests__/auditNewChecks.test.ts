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

describe("audit — theater screen count implausibly high", () => {
  it("flags a theater screen count over 30 (likely a seat/store number)", () => {
    const deal = { tenants: [{ name: "Regal Cinemas", sf: 55000, annualRent: 400000, rentPerSF: 7.27, screens: 250 }] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-screens-implausible"))).toBe(true);
  });
  it("does NOT flag a normal screen count", () => {
    const deal = { tenants: [{ name: "Regal Cinemas", sf: 55000, annualRent: 400000, rentPerSF: 7.27, screens: 14 }] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-screens-implausible"))).toBe(false);
  });
});

describe("audit — sales PSF implausibly high (units error)", () => {
  it("flags a wildly high sales PSF (e.g. a total captured as PSF)", () => {
    const deal = { tenants: [{ name: "Regal Cinemas", sf: 63260, annualRent: 575000, rentPerSF: 9.09, salesPSF: 165836 }] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-sales-psf-implausible"))).toBe(true);
  });
  it("does NOT flag a normal (even high-productivity) sales PSF", () => {
    const deal = { tenants: [{ name: "Chipotle", sf: 2400, annualRent: 120000, rentPerSF: 50, salesPSF: 1100 }] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-sales-psf-implausible"))).toBe(false);
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

describe("audit — duplicated suite row (phase-aware)", () => {
  it("does NOT flag two DIFFERENT tenants sharing a suite # (multi-phase center)", () => {
    const deal = { tenants: [
      { name: "Ross Dress for Less", suite: "1", sf: 25000, annualRent: 250000 },   // Phase I, Suite 1
      { name: "Five Below", suite: "1", sf: 9000, annualRent: 180000 },             // Phase II, Suite 1
      { name: "PetSmart", suite: "2", sf: 20000, annualRent: 200000 },
      { name: "Ulta", suite: "2", sf: 10000, annualRent: 300000 },
    ] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-dupe-suite"))).toBe(false);
  });
  it("DOES flag the SAME tenant listed twice at one suite (a duplicated row)", () => {
    const deal = { tenants: [
      { name: "Kohl's", suite: "1", sf: 55000, annualRent: 190000 },
      { name: "Kohl's", suite: "1", sf: 55000, annualRent: 190000 },
    ] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-dupe-suite"))).toBe(true);
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

describe("audit — truncated annual rent vs rentPerSF × SF", () => {
  it("flags a catastrophically truncated annual rent ($98 vs $98,728)", () => {
    // Chicken Salad Chick at Dawson: rentPerSF 32.18 × 3,068 SF = ~$98,728, annualRent "98".
    const deal = { tenants: [{ name: "Chicken Salad Chick", suite: "A-380", sf: 3068, rentPerSF: 32.18, annualRent: 98 }] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-rent-tie"))).toBe(true);
  });
  it("does NOT flag a tenant whose rent reconciles", () => {
    const deal = { tenants: [{ name: "Chicken Salad Chick", suite: "A-380", sf: 3068, rentPerSF: 35.0, annualRent: 107380 }] };
    expect(auditExtraction(deal).some((q) => q.id.startsWith("audit-rent-tie"))).toBe(false);
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
