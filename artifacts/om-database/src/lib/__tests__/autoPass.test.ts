import { describe, it, expect } from "vitest";
import { shouldAutoPass, PROSPECT_STALE_DAYS } from "../constants";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe("auto-pass a stale Prospect after 6 weeks of no activity", () => {
  it("is 6 weeks", () => expect(PROSPECT_STALE_DAYS).toBe(42));
  it("passes a Prospect first uploaded 6+ weeks ago with nothing since", () => {
    expect(shouldAutoPass({ status: "Prospect", uploadedAt: daysAgo(43) }, NOW)).toBe(true);
    expect(shouldAutoPass({ status: "Prospect", uploadedAt: daysAgo(41) }, NOW)).toBe(false);
  });
  it("a recent re-upload restarts the clock", () => {
    expect(shouldAutoPass({ status: "Prospect", uploadedAt: daysAgo(200), lastUploadAt: daysAgo(3) }, NOW)).toBe(false);
  });
  it("moving a deal back to Prospect restarts the clock (the bug that re-passed it on next load)", () => {
    expect(shouldAutoPass({ status: "Prospect", uploadedAt: daysAgo(200), statusSince: daysAgo(1) }, NOW)).toBe(false);
  });
  it("only ever touches Prospects, never trashed deals, never without a date", () => {
    expect(shouldAutoPass({ status: "Under Contract", uploadedAt: daysAgo(400) }, NOW)).toBe(false);
    expect(shouldAutoPass({ status: "Prospect", uploadedAt: daysAgo(400), trashedAt: daysAgo(1) }, NOW)).toBe(false);
    expect(shouldAutoPass({ status: "Prospect" }, NOW)).toBe(false);
  });
});
