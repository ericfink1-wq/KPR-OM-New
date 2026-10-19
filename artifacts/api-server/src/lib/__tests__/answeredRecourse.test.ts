import { describe, it, expect, vi } from "vitest";
vi.mock("@workspace/db", () => ({ db: {}, dealsTable: {} }));
import { resolveRecourseQuestions } from "../recordedSales";

describe("answered recourse questions", () => {
  it("resolves only open recourse questions, keeps the rest, fills a blank debtRecourse", () => {
    const d = { reviewQuestions: [{ id: "a", field: "Recourse", question: "?" }, { id: "b", field: "Tenant guaranty", question: "?" }, { id: "c", field: "debtRecourse", resolvedAt: "x" }] };
    const out = resolveRecourseQuestions(d, "carve-out guaranty", "2026-10-19")!;
    const qs = out.reviewQuestions as Array<Record<string, unknown>>;
    expect(qs[0]).toMatchObject({ resolvedAt: "2026-10-19", resolution: "carve-out guaranty" });
    expect(qs[1].resolvedAt).toBeUndefined();
    expect(qs[2].resolvedAt).toBe("x");
    expect(out.debtRecourse).toBe("carve-out guaranty");
    expect(resolveRecourseQuestions({ ...out }, "carve-out guaranty")).toBeNull();
  });
});
