import { describe, it, expect } from "vitest";
import { mineCorrectionPatterns } from "../correctionPatterns";
import type { Deal, ReviewQuestion } from "../idb";

const q = (over: Partial<ReviewQuestion>): ReviewQuestion => ({
  id: "x", source: "check", severity: "high", question: "Q?", resolvedAt: "2026-01-01T00:00:00Z", ...over,
} as ReviewQuestion);
const deal = (id: string, state: string, rqs: ReviewQuestion[]): Deal =>
  ({ id, propertyName: id, state, reviewQuestions: rqs } as Deal);

describe("mineCorrectionPatterns", () => {
  const fix = (fieldKey: string) => q({ id: `tax-market-as-assessed`, resolution: "fixed", target: { kind: "deal", fieldKey, valueType: "number" } as any });

  it("surfaces a recurring correction (≥2 fixes) with a seeded lesson + affected deals", () => {
    const deals = [
      deal("Belden", "OH", [fix("currentAssessedValue")]),
      deal("Eastgate", "OH", [fix("currentAssessedValue")]),
    ];
    const p = mineCorrectionPatterns(deals);
    const ca = p.find((x) => x.key === "field:currentAssessedValue")!;
    expect(ca).toBeTruthy();
    expect(ca.fixed).toBe(2);
    expect(ca.deals.map((d) => d.dealName).sort()).toEqual(["Belden", "Eastgate"]);
    expect(ca.suggestedLesson).toMatch(/assessed/i);
    expect(ca.scope).toBe("om");
  });

  it("does NOT surface a one-off correction", () => {
    const p = mineCorrectionPatterns([deal("One", "TX", [fix("noi")])]);
    expect(p.some((x) => x.key === "field:noi")).toBe(false);
  });

  it("flags an over-firing check (dismissed ≥3)", () => {
    const dismissed = () => q({ id: "audit-sf-gla-over", resolution: "dismissed" });
    const deals = [deal("A","TX",[dismissed()]), deal("B","TX",[dismissed()]), deal("C","TX",[dismissed()])];
    const p = mineCorrectionPatterns(deals);
    expect(p.some((x) => x.dismissed >= 3 && x.fixed === 0)).toBe(true);
  });
});
