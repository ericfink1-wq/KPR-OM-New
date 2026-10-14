import { describe, it, expect } from "vitest";
import { stampStatusChange } from "../statusSince";

const NOW = new Date("2026-10-14T12:00:00Z");

describe("stampStatusChange", () => {
  it("stamps when the status actually changes", () => {
    const next: Record<string, unknown> = { status: "Under Contract" };
    stampStatusChange({ status: "Prospect" }, next, NOW);
    expect(next.statusSince).toBe(NOW.toISOString());
  });
  it("leaves the stamp alone on an ordinary save", () => {
    const next: Record<string, unknown> = { status: "Prospect", statusSince: "2026-01-01T00:00:00.000Z" };
    stampStatusChange({ status: "Prospect" }, next, NOW);
    expect(next.statusSince).toBe("2026-01-01T00:00:00.000Z");
  });
  it("moving an auto-passed deal back to Prospect clears the auto-pass marker", () => {
    const next: Record<string, unknown> = { status: "Prospect", autoPassed: true, autoPassedAt: "2026-09-01" };
    stampStatusChange({ status: "Passed", autoPassed: true }, next, NOW);
    expect(next.autoPassed).toBe(false);
    expect(next.autoPassedAt).toBeUndefined();
    expect(next.statusSince).toBe(NOW.toISOString());
  });
  it("the auto-pass itself is stamped but keeps its marker", () => {
    const next: Record<string, unknown> = { status: "Passed", autoPassed: true };
    stampStatusChange({ status: "Prospect" }, next, NOW);
    expect(next.autoPassed).toBe(true);
  });
});
