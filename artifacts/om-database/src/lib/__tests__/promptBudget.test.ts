import { describe, it, expect } from "vitest";
import type { Deal, Tenant, LeaseAbstract } from "../idb";
import { buildSystemPrompt } from "../utils";

// Regression guard for the Analyst context-size budget. The whole library is
// serialized into one prompt; as the database grows that JSON must never exceed
// the model's 200K-token context (the "prompt is too long" 400). buildSystemPrompt
// trims progressively and hard-caps the final string at HARD_CHAR_CAP chars — under
// 200K tokens even at a worst-case tokenization. These tests lock that invariant in
// so a future change to the prompt can't silently reintroduce the overflow.

const HARD_CHAR_CAP = 390_000;

function heavyTenant(i: number): Tenant {
  return {
    name: `Tenant ${i} Holdings LLC`,
    sf: 1200 + (i % 50),
    rentPerSF: 18.5,
    annualRent: 22000,
    leaseStart: "2019-01-01",
    leaseExpiry: "2031-12-31",
    rentSchedule:
      "2026-01-01 $18.50 psf; 2027-01-01 $19.00 psf; 2028-01-01 $19.50 psf; option 1 2031-01-01 $21.00 psf; option 2 2036-01-01 FMV",
    renewalOptions: "Two 5-year options at FMV with 9-month notice",
    assumptionNote: "Recovery method assumed NNN per the OM rent-roll footnote. ".repeat(2),
    isAnchor: i % 15 === 0,
  };
}

function heavyDeal(i: number, status: string): Deal {
  const tenants: Tenant[] = Array.from({ length: 30 }, (_, j) => heavyTenant(i * 100 + j));
  return {
    id: `deal-${i}`,
    propertyName: `Center ${i} at Some Long Road Name Plaza`,
    status,
    city: "Townsville",
    state: "PA",
    askingPrice: 12_000_000 + i,
    capRate: 7.1,
    noi: 850_000,
    totalSF: 120_000,
    occupancy: 93,
    notes: "Institutional underwriting narrative with lots of detail. ".repeat(40),
    keyAssumptions: "Assumes market rent growth of 3% and stabilized vacancy of 6%. ".repeat(20),
    cashFlowProjection: Array.from({ length: 11 }, (_, y) => ({
      label: `Yr ${y + 1}`, totalBaseRent: 800000 + y, reimbursements: 200000,
      egr: 1000000, operatingExpenses: 300000, noi: 700000,
    })),
    incomeBreakdown: { base: 800000, cam: 120000, tax: 90000, ins: 30000 },
    expenseBreakdown: { mgmt: 40000, repairs: 60000, utilities: 30000 },
    tenants,
    tenantsAsOf: "2026-01-01",
    dealReview: i % 7 === 0 ? "KPR's honest read on pricing and risk for this center. ".repeat(15) : undefined,
  };
}

function heavyAbstract(i: number): LeaseAbstract {
  return {
    tenantName: `Tenant ${i} Holdings LLC`,
    dealId: `deal-${i % 50}`,
    center: `Center ${i % 50}`,
    narrative: "Reconciled lease abstract narrative across the full document set. ".repeat(20),
    leaseNotes: Array.from({ length: 8 }, () => ({
      code: "COTENCY", label: "Co-tenancy", value: "Long co-tenancy clause text with citations. ".repeat(30),
    })),
    flags: Array.from({ length: 4 }, () => ({
      severity: "watch" as const, issue: "Mid-term lever", detail: "Trigger/remedy detail. ".repeat(20),
    })),
  };
}

describe("buildSystemPrompt — context-size budget", () => {
  it("never exceeds the hard char cap for a very large library", () => {
    const deals: Deal[] = [];
    for (let i = 0; i < 200; i++) {
      const status = i < 50 ? "Owned" : i < 70 ? "Under Contract" : i < 140 ? "Prospect" : "Passed";
      deals.push(heavyDeal(i, status));
    }
    const abstracts: LeaseAbstract[] = Array.from({ length: 120 }, (_, i) => heavyAbstract(i));
    const prompt = buildSystemPrompt(deals, abstracts);
    expect(prompt.length).toBeLessThanOrEqual(HARD_CHAR_CAP);
  });

  it("stays under the cap and keeps guardrails even with a large OWNED book", () => {
    const deals: Deal[] = Array.from({ length: 200 }, (_, i) => heavyDeal(i, "Owned"));
    const abstracts: LeaseAbstract[] = Array.from({ length: 120 }, (_, i) => heavyAbstract(i));
    const prompt = buildSystemPrompt(deals, abstracts);
    expect(prompt.length).toBeLessThanOrEqual(HARD_CHAR_CAP);
    // The instruction scaffold (head) always survives the truncation.
    expect(prompt).toContain("KPR Centers' in-house commercial real estate analyst");
    // When truncated, the non-negotiable behavioral rules are re-appended.
    if (prompt.length >= HARD_CHAR_CAP - 1000) {
      expect(prompt).toContain("Never invent numbers");
    }
  });

  it("does NOT truncate or strip a small library (full detail retained)", () => {
    const deals: Deal[] = Array.from({ length: 4 }, (_, i) => heavyDeal(i, "Owned"));
    const prompt = buildSystemPrompt(deals, []);
    expect(prompt.length).toBeLessThan(HARD_CHAR_CAP);
    expect(prompt).not.toContain("CRITICAL RULES (still apply)");
    expect(prompt).not.toContain("summarized to a tenant index");
    expect(prompt).toContain("Center 0 at Some Long Road Name Plaza");
  });
});
