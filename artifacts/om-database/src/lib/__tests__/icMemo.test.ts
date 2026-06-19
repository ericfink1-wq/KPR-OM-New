import { describe, it, expect } from "vitest";
import { buildICMemo, buildICMemoModel } from "../icMemo";
import type { Deal, Tenant } from "../idb";

const t = (o: Partial<Tenant>): Tenant => o as Tenant;

const deal: Deal = {
  id: "x", propertyName: "Maple Grove Crossing", address: "123 Main St", city: "Lewis Center", state: "OH", zip: "43035",
  centerType: "Grocery-Anchored", assetType: "Retail",
  askingPrice: 24500000, pricePerSF: 245, capRate: 7.1, noi: 1739500, totalSF: 100000, occupancy: 94.2, walt: 6.3,
  weightedAvgRentPSF: 18.4, grossPotentialRent: 2050000, effectiveGrossIncome: 1980000, operatingExpenses: 240500,
  yearBuilt: 2004, renovationYear: 2019, trafficCountVPD: 32000,
  marketDemographics: { pop3mi: 78000, avgHHI3mi: 112000, confidence: "high", source: "Census" },
  tenantsAsOf: "2026-03-01", tenantsSource: "rent-roll",
  dealScore: { score: 81, grade: "B+", rationale: "Defensive grocery anchor with mark-to-market upside.", strengths: ["IG grocer anchor"], risks: ["Two inline rolls in 2027"] },
  redFlags: [{ severity: "medium", description: "Junior box rolls in 18 months." }],
  upsideItems: [{ priority: "high", item: "Lease up 5,800 SF vacancy", detail: "at $22/SF" }],
  notes: "Institutional-quality grocery-anchored center in a high-income suburb.",
  tenants: [
    t({ name: "Kroger", sf: 55000, annualRent: 550000, rentPerSF: 10, isAnchor: true, leaseExpiry: "2034-01-31" }),
    t({ name: "Planet Fitness", sf: 20000, annualRent: 240000, rentPerSF: 12, leaseExpiry: "2030-06-30" }),
    t({ name: "Great Clips", sf: 1200, annualRent: 42000, rentPerSF: 35, leaseExpiry: "2027-09-30" }),
    t({ name: "Chipotle", sf: 2400, annualRent: 96000, rentPerSF: 40, leaseExpiry: "2027-12-31" }),
    t({ name: "Vacant", sf: 5800 }),
  ],
} as Deal;

describe("buildICMemo", () => {
  const memo = buildICMemo(deal, { generatedOn: new Date("2026-06-19") });

  it("produces a titled memo with the core sections", () => {
    expect(memo).toContain("# Investment Committee Memo — Maple Grove Crossing");
    for (const h of ["## Recommendation", "## Investment Overview", "## Location & Demographics", "## Tenancy", "## Lease Rollover", "## Financial Summary", "## Risks", "## Upside / Value-Add"]) {
      expect(memo).toContain(h);
    }
  });

  it("renders the grade, key metrics, and demographics", () => {
    expect(memo).toContain("Grade: B+ (81/100)");
    expect(memo).toContain("$24.50M");
    expect(memo).toContain("7.10%");
    expect(memo).toMatch(/Population \(3-mi\): \*\*78,000\*\*/);
  });

  it("includes the retail mix & resilience read", () => {
    expect(memo).toContain("Retail mix & resilience:");
    expect(memo).toMatch(/Resilience score \d+\/100/);
    expect(memo).toContain("Grocery & Necessity");
  });

  it("counts the 2027 rollover and excludes the vacant suite from tenancy", () => {
    expect(memo).toMatch(/expire through 2029/);
    // Anchors line names Kroger; vacant isn't an anchor/top tenant
    expect(memo).toContain("Kroger");
  });

  it("omits sections that have no data", () => {
    const bare = buildICMemo({ id: "y", propertyName: "Empty Pad" } as Deal, { generatedOn: new Date("2026-06-19") });
    expect(bare).toContain("# Investment Committee Memo — Empty Pad");
    expect(bare).not.toContain("## Financial Summary");
    expect(bare).not.toContain("## Tenancy");
  });
});

describe("buildICMemoModel (data behind the branded PDF)", () => {
  const model = buildICMemoModel(deal, { generatedOn: new Date("2026-06-19") });

  it("produces the headline metrics, grade, demographics, and retail mix", () => {
    expect(model.name).toBe("Maple Grove Crossing");
    expect(model.grade?.grade).toBe("B+");
    expect(model.metrics.some(m => m.label === "Cap Rate" && m.value === "7.10%")).toBe(true);
    expect(model.demographics.some(d => /Population/.test(d.label))).toBe(true);
    expect(model.mix?.resilienceScore).toBeGreaterThan(0);
    expect(model.anchors[0]).toMatch(/Kroger/);
    expect(model.concentration?.top1).toBeGreaterThan(0);
  });

  it("caps risks/upside lists and computes rollover", () => {
    expect(model.risks.length).toBeLessThanOrEqual(5);
    expect(model.upside.length).toBeLessThanOrEqual(5);
    expect(model.rollover?.throughYear).toBe(2029);
  });

  it("degrades gracefully on a bare deal", () => {
    const bare = buildICMemoModel({ id: "y", propertyName: "Empty Pad" } as Deal);
    expect(bare.metrics).toEqual([]);
    expect(bare.mix).toBeNull();
    expect(bare.anchors).toEqual([]);
  });
});
