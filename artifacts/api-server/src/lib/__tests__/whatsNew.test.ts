import { describe, it, expect } from "vitest";
import { whatsNewCutoff } from "../whatsNew";

const NOW = new Date("2026-09-17T12:00:00Z");

describe("whatsNewCutoff", () => {
  it("prefers a recorded read over the previous sign-in", () => {
    const r = whatsNewCutoff({
      seenAt: "2026-09-15T09:00:00Z",
      previousLoginAt: "2026-09-01T09:00:00Z",
      now: NOW,
    });
    expect(r.basis).toBe("seen");
    expect(r.cutoff).toBe("2026-09-15T09:00:00.000Z");
  });

  it("uses the recorded read even when it is OLDER than the last sign-in", () => {
    // Being in the app is not the same as having read the notes — signing in
    // repeatedly must never quietly mark changes as seen.
    const r = whatsNewCutoff({
      seenAt: "2026-08-01T09:00:00Z",
      previousLoginAt: "2026-09-16T09:00:00Z",
      now: NOW,
    });
    expect(r.basis).toBe("seen");
    expect(r.cutoff).toBe("2026-08-01T09:00:00.000Z");
  });

  it("falls back to the previous sign-in the first time, before anything is recorded", () => {
    const r = whatsNewCutoff({ seenAt: null, previousLoginAt: "2026-09-01T09:00:00Z", now: NOW });
    expect(r.basis).toBe("previous-login");
    expect(r.cutoff).toBe("2026-09-01T09:00:00.000Z");
  });

  it("returns nothing for a brand-new account with no prior session", () => {
    // Showing the full history as 'new since you were away' would be untrue.
    const r = whatsNewCutoff({ seenAt: null, previousLoginAt: null, now: NOW });
    expect(r).toEqual({ cutoff: null, basis: "none" });
  });

  it("clamps a future timestamp to now instead of hiding every entry forever", () => {
    const r = whatsNewCutoff({ seenAt: "2030-01-01T00:00:00Z", now: NOW });
    expect(r.cutoff).toBe(NOW.toISOString());
  });

  it("ignores an unparseable timestamp rather than propagating Invalid Date", () => {
    const r = whatsNewCutoff({ seenAt: "garbage", previousLoginAt: "2026-09-01T09:00:00Z", now: NOW });
    expect(r.basis).toBe("previous-login");
    expect(r.cutoff).toBe("2026-09-01T09:00:00.000Z");
  });

  it("accepts Date objects as the driver hands them back from the database", () => {
    const r = whatsNewCutoff({ seenAt: new Date("2026-09-15T09:00:00Z"), now: NOW });
    expect(r.cutoff).toBe("2026-09-15T09:00:00.000Z");
  });
});
