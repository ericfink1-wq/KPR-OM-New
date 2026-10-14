import { describe, it, expect } from "vitest";
import { CHANGELOG, entriesSince, visibleChangelog } from "../changelog";

const NOW = new Date("2026-10-20T12:00:00Z");
const adminIds = CHANGELOG.filter(e => e.adminOnly).map(e => e.id);

describe("What's new hides admin-only features from non-admins", () => {
  it("there is at least one admin-only entry to test against", () => {
    expect(adminIds).toContain("2026-10-14-rename-members");
  });
  it("a non-admin never sees an admin-only entry, in the archive or the unread list", () => {
    const ids = [...visibleChangelog(NOW), ...entriesSince("2026-01-01T00:00:00Z", NOW)].map(e => e.id);
    for (const id of adminIds) expect(ids).not.toContain(id);
  });
  it("an admin sees everything", () => {
    const ids = visibleChangelog(NOW, true).map(e => e.id);
    for (const id of adminIds) expect(ids).toContain(id);
    expect(entriesSince("2026-10-13T00:00:00Z", NOW, true).map(e => e.id)).toContain("2026-10-14-rename-members");
  });
  it("the unread count a non-admin gets excludes admin-only entries", () => {
    const all = entriesSince("2026-10-13T00:00:00Z", NOW, true).length;
    const member = entriesSince("2026-10-13T00:00:00Z", NOW, false).length;
    expect(all - member).toBe(1);
  });
});
