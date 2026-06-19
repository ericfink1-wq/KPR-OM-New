import { describe, it, expect } from "vitest";
import { autoMaintainDealData, mergeAuditQuestions } from "../dealMaintenance";

describe("autoMaintainDealData — self-clean + self-audit on every write", () => {
  it("applies the safe occupancy-cost fix", () => {
    const r = autoMaintainDealData({ tenants: [{ name: "Pet Supplies Plus", sf: 6400, occupancyCost: 0.225, annualRent: 132032 }] });
    expect((r.data.tenants as any)[0].occupancyCost).toBe(22.5);
    expect(r.occCostFixed).toBe(1);
    expect(r.changed).toBe(true);
  });

  it("adds a fresh audit question for a NOI/cap/price contradiction", () => {
    const r = autoMaintainDealData({ noi: 1_000_000, capRate: 5, askingPrice: 10_000_000 });
    const qs = (r.data.reviewQuestions as Array<Record<string, unknown>>) || [];
    expect(qs.some((q) => q.id === "audit-noi-cap-price")).toBe(true);
    expect(r.auditAdded).toBeGreaterThan(0);
  });

  it("self-heals: an unresolved audit question that now passes is dropped", () => {
    // Deal whose numbers now tie out, but carries a stale audit-noi-cap-price question.
    const r = autoMaintainDealData({
      noi: 1_000_000, capRate: 10, askingPrice: 10_000_000,
      reviewQuestions: [{ id: "audit-noi-cap-price", source: "check", severity: "high", question: "stale", resolvedAt: null }],
    });
    const qs = (r.data.reviewQuestions as Array<Record<string, unknown>>) || [];
    expect(qs.some((q) => q.id === "audit-noi-cap-price")).toBe(false);
    expect(r.auditCleared).toBe(1);
  });

  it("does NOT re-nag a RESOLVED audit question", () => {
    const data = { noi: 1_000_000, capRate: 10, askingPrice: 10_000_000,
      reviewQuestions: [{ id: "audit-noi-cap-price", source: "check", resolvedAt: "2026-06-19T00:00:00Z", resolution: "fixed" }] };
    const { questions, cleared } = mergeAuditQuestions(data, []);
    expect(questions.some((q) => q.id === "audit-noi-cap-price" && q.resolvedAt)).toBe(true);
    expect(cleared).toBe(0);
  });

  it("never mutates the input object", () => {
    const input = { tenants: [{ name: "X", sf: 6400, occupancyCost: 0.225, annualRent: 132032 }] };
    autoMaintainDealData(input);
    expect((input.tenants as any)[0].occupancyCost).toBe(0.225);
  });

  it("preserves AI / lease-risk questions (only audit-* are managed)", () => {
    const r = autoMaintainDealData({ noi: 1_000_000, capRate: 10, askingPrice: 10_000_000,
      reviewQuestions: [{ id: "ai-noi", source: "ai", question: "verify NOI" }] });
    const qs = (r.data.reviewQuestions as Array<Record<string, unknown>>) || [];
    expect(qs.some((q) => q.id === "ai-noi")).toBe(true);
  });
});
