import { describe, it, expect } from "vitest";
import { classifyTenant, analyzeCenterMix } from "../retailCategory";
import type { Deal, Tenant } from "../idb";

const t = (name: string, sf: number, annualRent: number): Tenant => ({ name, sf, annualRent } as Tenant);

describe("classifyTenant", () => {
  it("classifies major brands from the dictionary", () => {
    expect(classifyTenant("Kroger #422").category).toBe("Grocery & Necessity");
    expect(classifyTenant("TJ Maxx").category).toBe("Off-Price & Discount");
    expect(classifyTenant("Planet Fitness").category).toBe("Fitness");
    expect(classifyTenant("AT&T Store").category).toBe("Financial & Telecom");
    expect(classifyTenant("Chipotle Mexican Grill").category).toBe("Restaurant & Food");
  });

  it("longest brand match wins (Panda Express is food, not 'Express' apparel)", () => {
    expect(classifyTenant("Panda Express").category).toBe("Restaurant & Food");
    expect(classifyTenant("Dollar Tree").category).toBe("Off-Price & Discount");
  });

  it("word-boundary matching avoids false hits (Crossroads is not 'Ross')", () => {
    expect(classifyTenant("Crossroads Trading").category).not.toBe("Off-Price & Discount");
  });

  it("falls back to keyword heuristics for the long tail", () => {
    expect(classifyTenant("Bright Smile Dental").category).toBe("Health & Medical");
    expect(classifyTenant("Tony's Pizza & Pasta").category).toBe("Restaurant & Food");
    expect(classifyTenant("Lucky Nails & Spa").category).toBe("Personal Services");
    expect(classifyTenant("Main Street Wireless").category).toBe("Financial & Telecom");
  });

  it("returns Other for an unrecognizable name", () => {
    expect(classifyTenant("Zyxquon Holdings").category).toBe("Other");
  });
});

describe("analyzeCenterMix", () => {
  it("rolls up the roster and scores resilience (grocery + service = defensive)", () => {
    const deal = { tenants: [
      t("Kroger", 55000, 550000),       // grocery, resistance 95
      t("Great Clips", 1200, 42000),    // personal services, 95
      t("Aspen Dental", 3500, 105000),  // health, 98
      t("Starbucks", 1800, 90000),      // restaurant, 90
    ] } as Pick<Deal, "tenants">;
    const m = analyzeCenterMix(deal)!;
    expect(m).not.toBeNull();
    expect(m.resilienceScore).toBeGreaterThanOrEqual(90);
    expect(m.necessityRentPct).toBeGreaterThan(95);
    expect(m.slices[0].category).toBe("Grocery & Necessity"); // biggest rent share
    expect(/defensive/i.test(m.characterization)).toBe(true);
  });

  it("a soft-goods-heavy center scores lower and warns on e-commerce", () => {
    const deal = { tenants: [
      t("Old Navy", 15000, 300000),
      t("Foot Locker", 4000, 160000),
      t("Express", 6000, 180000),
      t("Great Clips", 1200, 42000),
    ] } as Pick<Deal, "tenants">;
    const m = analyzeCenterMix(deal)!;
    expect(m.resilienceScore).toBeLessThan(60);
    expect(/e-commerce|discretionary/i.test(m.characterization)).toBe(true);
  });

  it("excludes vacant and NAP rows", () => {
    const deal = { tenants: [
      t("Kroger", 55000, 550000),
      { name: "Vacant", sf: 4000 } as Tenant,
      { name: "Pad — Not Owned", sf: 3000, isNAP: true } as Tenant,
    ] } as Pick<Deal, "tenants">;
    const m = analyzeCenterMix(deal)!;
    expect(m.tenantCount).toBe(1);
  });

  it("returns null when there are no occupied tenants", () => {
    expect(analyzeCenterMix({ tenants: [{ name: "Vacant", sf: 4000 } as Tenant] })).toBeNull();
    expect(analyzeCenterMix({ tenants: [] })).toBeNull();
  });
});
