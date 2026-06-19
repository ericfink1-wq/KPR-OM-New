import { describe, it, expect } from "vitest";
import { summarizePortfolioIssues } from "../portfolioIssues";

describe("summarizePortfolioIssues — the feedback-console trend engine", () => {
  it("groups the SAME audit contradiction across deals into one trend", () => {
    // Two deals, each with the same NOI/cap/price contradiction → one group, count 2.
    const rows = [
      { id: "a", data: { propertyName: "Center A", noi: 1_000_000, capRate: 5, askingPrice: 10_000_000 } },
      { id: "b", data: { propertyName: "Center B", noi: 2_000_000, capRate: 5, askingPrice: 20_000_000_0 } },
    ];
    const s = summarizePortfolioIssues(rows);
    const g = s.groups.find((x) => x.key === "audit-noi-cap-price");
    expect(g).toBeDefined();
    expect(g!.count).toBe(2);
    expect(g!.dealCount).toBe(2);
    expect(g!.deals.map((d) => d.id).sort()).toEqual(["a", "b"]);
  });

  it("clusters AI low-confidence captures by field", () => {
    const rows = [
      { id: "a", data: { propertyName: "A", reviewQuestions: [{ id: "ai-1", source: "ai", field: "Total SF", question: "confirm SF?", severity: "medium" }] } },
      { id: "b", data: { propertyName: "B", reviewQuestions: [{ id: "ai-2", source: "ai", field: "Total SF", question: "confirm SF too?", severity: "medium" }] } },
    ];
    const s = summarizePortfolioIssues(rows);
    const g = s.groups.find((x) => x.kind === "ai" && /total sf/i.test(x.label));
    expect(g?.count).toBe(2);
  });

  it("excludes resolved questions and trashed deals", () => {
    const rows = [
      { id: "a", data: { propertyName: "A", noi: 1_000_000, capRate: 5, askingPrice: 10_000_000,
        reviewQuestions: [{ id: "audit-noi-cap-price", resolvedAt: "2026-06-19T00:00:00Z", resolution: "fixed" }] } },
      { id: "b", data: { trashedAt: "2026-01-01", noi: 1_000_000, capRate: 5, askingPrice: 10_000_000 } },
    ];
    const s = summarizePortfolioIssues(rows);
    expect(s.groups.find((x) => x.key === "audit-noi-cap-price")).toBeUndefined();
    expect(s.scanned).toBe(1);
    expect(s.dealsWithIssues).toBe(0);
  });

  it("sorts high-severity groups first", () => {
    const rows = [
      { id: "a", data: { propertyName: "A", noi: 1_000_000, capRate: 5, askingPrice: 10_000_000, // high: noi/cap/price
        tenants: [{ name: "Misread", sf: 3000, rentPerSF: 250, annualRent: 750000 }] } }, // high: impossible rent
    ];
    const s = summarizePortfolioIssues(rows);
    expect(s.groups.length).toBeGreaterThan(0);
    expect(s.groups[0].severity).toBe("high");
  });
});
