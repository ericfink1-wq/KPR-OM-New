import { describe, it, expect } from "vitest";
import { CHANGELOG, entriesSince, visibleChangelog, forViewer, type ChangeEntry } from "../changelog";

const NOW = new Date("2026-10-20T12:00:00Z");
const adminIds = CHANGELOG.filter(e => e.adminOnly).map(e => e.id);
const roundup = (isAdmin: boolean) => visibleChangelog(NOW, isAdmin).find(e => e.id === "2026-10-19-weekend-roundup")!;

describe("What's new hides admin-only features from non-admins", () => {
  it("a non-admin never sees an admin-only entry, in the archive or the unread list", () => {
    const ids = [...visibleChangelog(NOW), ...entriesSince("2026-01-01T00:00:00Z", NOW)].map(e => e.id);
    for (const id of adminIds) expect(ids).not.toContain(id);
  });
  it("admin-only LINES inside the weekend roundup: hidden from members, shown (untagged) to admins", () => {
    const member = roundup(false).detail, admin = roundup(true).detail;
    expect(member).not.toMatch(/\[admin\]|For admins|Chatham mark|building map/);
    expect(admin).toMatch(/## For admins/);
    expect(admin).toMatch(/Paste a Chatham mark/);
    expect(admin).not.toContain("[admin]");
    expect(entriesSince("2026-10-13T00:00:00Z", NOW, false).some(e => e.detail.includes("[admin]"))).toBe(false);
  });
  it("forViewer drops a heading left with no bullets, and leaves ordinary entries untouched", () => {
    const e: ChangeEntry = { id: "x", date: "2026-10-19", category: "new", title: "t", detail: "## A\n- a\n## Admin\n- [admin] secret" };
    expect(forViewer(e, false).detail).toBe("## A\n- a");
    expect(forViewer(e, true).detail).toBe("## A\n- a\n## Admin\n- secret");
    const plain: ChangeEntry = { ...e, detail: "Just a sentence." };
    expect(forViewer(plain, false)).toBe(plain);
  });
});

describe("Oct 17–19 is ONE entry", () => {
  it("exactly one entry dated in the weekend, ≤ ~3 bullets per heading", () => {
    const wk = CHANGELOG.filter(e => e.date >= "2026-10-17" && e.date <= "2026-10-19");
    expect(wk.map(e => e.id)).toEqual(["2026-10-19-weekend-roundup"]);
    const sections = wk[0].detail.split("\n## ");
    for (const s of sections) expect(s.split("\n").filter(l => l.startsWith("- ")).length).toBeLessThanOrEqual(3);
  });
});
