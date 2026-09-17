import { describe, it, expect } from "vitest";
import { CHANGELOG, CATEGORY_LABEL, CATEGORY_STYLE, entriesSince, visibleChangelog } from "../changelog";

const NOW = new Date("2026-09-17T12:00:00Z");

describe("changelog entries", () => {
  it("has a unique, stable id on every entry", () => {
    const ids = CHANGELOG.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dates every entry as a real ISO day", () => {
    for (const e of CHANGELOG) {
      expect(e.date, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(e.date).toString(), e.id).not.toBe("Invalid Date");
    }
  });

  it("gives every entry a category the UI can render", () => {
    for (const e of CHANGELOG) {
      expect(CATEGORY_LABEL[e.category], e.id).toBeTruthy();
      expect(CATEGORY_STYLE[e.category], e.id).toBeTruthy();
    }
  });

  it("writes for a reader, not a commit log", () => {
    for (const e of CHANGELOG) {
      expect(e.title.length, e.id).toBeGreaterThan(10);
      expect(e.detail.length, e.id).toBeGreaterThan(40);
      // A file path in user-facing copy means the entry was pasted from a commit.
      expect(e.detail, e.id).not.toMatch(/\.tsx?\b|\/src\//);
    }
  });
});

describe("visibleChangelog", () => {
  it("sorts newest first", () => {
    const dates = visibleChangelog(NOW).map(e => e.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("hides a future-dated entry rather than letting it lead the list", () => {
    // A typo'd year is the realistic failure. It must not sit permanently at the top.
    const future = visibleChangelog(new Date("2020-01-01T00:00:00Z"));
    expect(future).toHaveLength(0);
  });
});

describe("entriesSince", () => {
  it("returns nothing when we don't know when the reader was last here", () => {
    // A brand-new account gets a clean start, not three months of back-notes.
    expect(entriesSince(null, NOW)).toHaveLength(0);
    expect(entriesSince(undefined, NOW)).toHaveLength(0);
  });

  it("returns nothing for a malformed cutoff instead of the whole history", () => {
    expect(entriesSince("not-a-date", NOW)).toHaveLength(0);
  });

  it("returns only entries shipped after the cutoff", () => {
    const since = entriesSince("2026-09-10T00:00:00Z", NOW);
    expect(since.length).toBeGreaterThan(0);
    for (const e of since) expect(e.date > "2026-09-10").toBe(true);
  });

  it("treats the cutoff day itself as already read, so dismissing settles today", () => {
    // Same-day entries must not re-open the modal an hour after it was dismissed.
    const sameDay = entriesSince("2026-09-16T23:00:00Z", NOW);
    expect(sameDay.every(e => e.date > "2026-09-16")).toBe(true);
  });

  it("an old cutoff yields everything, and a very recent one yields nothing", () => {
    expect(entriesSince("2000-01-01T00:00:00Z", NOW).length).toBe(visibleChangelog(NOW).length);
    expect(entriesSince(NOW.toISOString(), NOW)).toHaveLength(0);
  });
});
