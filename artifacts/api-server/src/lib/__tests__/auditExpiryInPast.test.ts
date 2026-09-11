import { describe, it, expect } from "vitest";
import { auditExtraction } from "../extractionAudit";

// audit-expiry-in-past: a roster row whose lease expiry precedes the roll's OWN
// as-of date. The roll contradicts itself, and the cost is silent: WALT floors a
// past expiry at zero years while still counting the tenant's full SF, so one stale
// anchor drags the centre's WALT down — and the WALT-recompute check can't catch it,
// because the recompute applies the same floor and therefore agrees.

const fire = (deal: Record<string, unknown>) =>
  auditExtraction(deal).filter((q) => q.id === "audit-expiry-in-past");

/** A clean centre: five occupied tenants, all leases running well past the roll date. */
const base = (over: Record<string, unknown> = {}, tenantsOver: Array<Record<string, unknown>> = []) => ({
  propertyName: "Test Center",
  totalSF: 200_000,
  tenantsAsOf: "2026-05-26",
  tenants: [
    { name: "Anchor Grocer", sf: 60_000, leaseExpiry: "2031-06-30", isAnchor: true },
    { name: "Inline A", sf: 5_000, leaseExpiry: "2029-01-31" },
    { name: "Inline B", sf: 4_000, leaseExpiry: "2030-03-31" },
    { name: "Inline C", sf: 3_000, leaseExpiry: "2028-12-31" },
    { name: "Inline D", sf: 3_000, leaseExpiry: "2032-05-31" },
    ...tenantsOver,
  ],
  ...over,
});

describe("audit-expiry-in-past — fires on a roll that contradicts itself", () => {
  it("stays silent when every lease runs past the roll date", () => {
    expect(fire(base())).toHaveLength(0);
  });

  it("fires when a lease expired before the roll's own as-of date", () => {
    const q = fire(base({}, [{ name: "Stale Inline", sf: 2_000, leaseExpiry: "2026-02-28" }]));
    expect(q).toHaveLength(1);
    expect(q[0].question).toContain("2026-05-26");
    expect(q[0].detail).toContain("Stale Inline");
  });

  it("escalates to high severity when an ANCHOR reads expired", () => {
    const deal = base();
    (deal.tenants as Array<Record<string, unknown>>)[0].leaseExpiry = "2026-02-28";
    const q = fire(deal);
    expect(q).toHaveLength(1);
    expect(q[0].severity).toBe("high");
    expect(q[0].question).toContain("the anchor");
  });

  it("a small single inline is medium, not high", () => {
    const q = fire(base({}, [{ name: "Stale Inline", sf: 1_200, leaseExpiry: "2026-01-31" }]));
    expect(q[0].severity).toBe("medium");
  });

  it("sizes the exposure by SF and share of GLA", () => {
    const q = fire(base({}, [{ name: "Big Box", sf: 40_000, leaseExpiry: "2026-03-31" }]));
    expect(q[0].question).toContain("40,000 SF");
    expect(q[0].question).toContain("20.0% of GLA");   // 40,000 of 200,000
  });

  it("names several and counts the remainder rather than listing everything", () => {
    const stale = [1, 2, 3, 4, 5, 6].map((i) => ({ name: `Stale ${i}`, sf: 1_000, leaseExpiry: "2026-01-31" }));
    const q = fire(base({}, stale));
    expect(q[0].question).toContain("6 leases");
    expect(q[0].detail).toContain("and 2 more");
  });

  it("reads as English for one lease and for many — Eric reads these verbatim", () => {
    // Caught in live output: "One lease ... show an expiry". Small, but it is the first
    // thing a person sees on the deal page, and sloppiness there reads as sloppiness in
    // the analysis behind it.
    const one = fire(base({}, [{ name: "Stale Inline", sf: 2_000, leaseExpiry: "2026-02-28" }]));
    expect(one[0].question).toContain("One lease");
    expect(one[0].question).toMatch(/One lease \([^)]*\) shows an expiry/);
    expect(one[0].question).not.toMatch(/One lease[^.]*\bshow an expiry/);

    const many = fire(base({}, [
      { name: "Stale A", sf: 2_000, leaseExpiry: "2026-02-28" },
      { name: "Stale B", sf: 1_000, leaseExpiry: "2026-01-31" },
    ]));
    expect(many[0].question).toMatch(/2 leases \([^)]*\) show an expiry/);
  });

  it("targets the tenant field when exactly one row is wrong, so it is one-click fixable", () => {
    const q = fire(base({}, [{ name: "Stale Inline", sf: 2_000, leaseExpiry: "2026-02-28" }]));
    expect(q[0].target).toEqual({ kind: "tenant", fieldKey: "leaseExpiry", tenantName: "Stale Inline", valueType: "text" });
  });
});

describe("audit-expiry-in-past — the cases it must NOT flag", () => {
  it("does NOT flag a lease that merely rolled AFTER capture (staleness, not an error)", () => {
    // Captured 2024; the lease ran to 2025. Correct when recorded — this library is
    // static by design, so ageing must never manufacture flags across hundreds of deals.
    expect(fire(base({ tenantsAsOf: "2024-06-01" }, [{ name: "Rolled Since", sf: 2_000, leaseExpiry: "2025-03-31" }]))).toHaveLength(0);
  });

  it("does NOT flag month-to-month or holdover tenants — sitting past expiry IS the arrangement", () => {
    for (const leaseType of ["MTM", "Month-to-Month", "Holdover", "At-Will"]) {
      expect(fire(base({}, [{ name: "Rolling Tenant", sf: 2_000, leaseExpiry: "2026-01-31", leaseType }]))).toHaveLength(0);
    }
  });

  it("does NOT flag vacant suites or NAP parcels", () => {
    expect(fire(base({}, [
      { name: "Vacant", sf: 5_000, leaseExpiry: "2026-01-31" },
      { name: "Available", sf: 3_000, leaseExpiry: "2026-01-31" },
      { name: "Pad Owner", sf: 9_000, leaseExpiry: "2026-01-31", isNAP: true },
    ]))).toHaveLength(0);
  });

  it("does NOT fire without a real as-of date — there is nothing to contradict", () => {
    expect(fire(base({ tenantsAsOf: null }, [{ name: "Stale", sf: 2_000, leaseExpiry: "2026-02-28" }]))).toHaveLength(0);
    expect(fire(base({ tenantsAsOf: "not a date" }, [{ name: "Stale", sf: 2_000, leaseExpiry: "2026-02-28" }]))).toHaveLength(0);
  });

  it("does NOT measure against a FORWARD-DATED roll — that is the OM's assumed closing", () => {
    // Most OMs start financials at an assumed close (e.g. 2027-01-01). Measuring
    // against it would invent expiries that hadn't happened when the roll was printed.
    const q = fire(base({ tenantsAsOf: "2027-01-01" }, [{ name: "Expires Later This Year", sf: 2_000, leaseExpiry: "2026-11-30" }]));
    expect(q).toHaveLength(0);
  });

  it("still catches a genuinely-past expiry on a forward-dated roll, measured against today", () => {
    const q = fire(base({ tenantsAsOf: "2027-01-01" }, [{ name: "Long Expired", sf: 2_000, leaseExpiry: "2019-06-30" }]));
    expect(q).toHaveLength(1);
  });

  it("ignores unparseable expiry text instead of guessing", () => {
    for (const leaseExpiry of ["Various", "TBD", "N/A", "", null]) {
      expect(fire(base({}, [{ name: "Odd Row", sf: 2_000, leaseExpiry }]))).toHaveLength(0);
    }
  });
});
