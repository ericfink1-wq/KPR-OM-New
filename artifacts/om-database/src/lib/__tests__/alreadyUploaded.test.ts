import { describe, it, expect } from "vitest";
import { alreadyUploadedMessage } from "../../components/UploadQueue";

const NOW = Date.parse("2026-10-14T15:00:00Z");

describe("alreadyUploadedMessage — the pre-extraction duplicate prompt", () => {
  it("names the property, how long ago, and who", () => {
    expect(alreadyUploadedMessage("Lake Brandon Village", "2026-10-10T12:00:00Z", "Eric Fink", NOW))
      .toBe("“Lake Brandon Village” was already uploaded 4 days ago by Eric Fink. Re-reading it uses AI credits — continue to update it, or skip?");
  });
  it("says today / yesterday rather than 0 or 1 days", () => {
    expect(alreadyUploadedMessage("A", "2026-10-14T09:00:00Z", null, NOW)).toContain("uploaded today.");
    expect(alreadyUploadedMessage("A", "2026-10-13T09:00:00Z", null, NOW)).toContain("uploaded yesterday.");
  });
  it("uses a date for old uploads", () => {
    expect(alreadyUploadedMessage("A", "2025-01-05T12:00:00Z", null, NOW)).toMatch(/uploaded on Jan 5, 2025\./);
  });
  it("never invents a who or a when it doesn't have", () => {
    expect(alreadyUploadedMessage("A", null, null, NOW)).toBe("“A” was already uploaded. Re-reading it uses AI credits — continue to update it, or skip?");
  });
});
