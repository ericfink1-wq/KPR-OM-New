import { describe, it, expect } from "vitest";
import { CLOSING_COSTS_BY_STATE } from "../closingCosts";
import { estimateClosingCosts } from "../closingCostEngine";
import { FL_LOCAL } from "../transferTaxLocal/fl";

const FL = { ...CLOSING_COSTS_BY_STATE.FL, local: FL_LOCAL };
const P = 10_000_000;
const transferSeller = (r: ReturnType<typeof estimateClosingCosts>, which: "min" | "max") =>
  r.lines.filter(l => l.scope === "state" || l.scope === "local")
    .filter(l => !l.inactive && l.base === "price")
    .reduce((s, l) => s + l.seller + (l.range ? (which === "min" ? l.range.sellerMin : l.range.sellerMax) : 0), 0);

describe("Florida deed tax (Eric, 10/16/26): Miami-Dade REPLACES the 0.70%, never adds to it", () => {
  it("no address yet → 0.70% to 1.05% total, not up to 1.75%", () => {
    const r = estimateClosingCosts(FL, P, 0, null);
    expect(transferSeller(r, "min")).toBeCloseTo(P * 0.007, 0);
    expect(transferSeller(r, "max")).toBeCloseTo(P * 0.0105, 0);
  });
  it("Miami-Dade → 1.05% total", () => {
    const r = estimateClosingCosts(FL, P, 0, { matched: true, state: "FL", county: "Miami-Dade County" });
    expect(transferSeller(r, "max")).toBeCloseTo(P * 0.0105, 0);
    expect(transferSeller(r, "min")).toBeCloseTo(P * 0.0105, 0);
  });
  it("any other county → flat 0.70%", () => {
    const r = estimateClosingCosts(FL, P, 0, { matched: true, state: "FL", county: "Orange County" });
    expect(transferSeller(r, "max")).toBeCloseTo(P * 0.007, 0);
  });
});

describe("Florida owner's title payer follows county custom", () => {
  const title = (county: string | null) => estimateClosingCosts(FL, P, 0, county ? { matched: true, state: "FL", county } : null).lines.find(l => l.scope === "title")!;
  it("seller statewide", () => { const t = title("Orange County"); expect(t.seller).toBeGreaterThan(0); expect(t.buyer).toBe(0); });
  it.each(["Miami-Dade County", "Broward County", "Sarasota County", "Collier County"])("buyer in %s", (c) => {
    const t = title(c); expect(t.buyer).toBeGreaterThan(0); expect(t.seller).toBe(0);
  });
  it("unknown county says the exception", () => expect(title(null).notes).toMatch(/Miami-Dade, Broward, Sarasota, Collier/));
});
