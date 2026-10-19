import { describe, it, expect } from "vitest";
import { dealProvenance, normalizeStatusIn, filterLog, resultOf, type LogRow } from "../uploadProvenance";

const row = (id: string, at: string, status: string, who: string, extra: Partial<LogRow> = {}): LogRow => ({
  id, fileName: `${id}.pdf`, docType: "om", status, detail: null, dealId: "d1",
  userId: null, userEmail: `${who}@kprcenters.com`, userName: who, createdAt: at, ...extra,
});

describe("upload provenance (Eric, 10/19/26: creator and last uploader shown separately)", () => {
  it("Eric created it, Jacob added files today → two different people, history newest first", () => {
    const p = dealProvenance([
      row("a", "2026-07-01T10:00:00Z", "created", "Eric"),
      row("b", "2026-10-19T16:00:00Z", "attached", "Jacob", { docType: "tax-bill" }),
      row("c", "2026-10-19T16:05:00Z", "rejected", "Jacob"),
    ]);
    expect(p.createdBy?.userName).toBe("Eric");
    expect(p.lastUpload?.userName).toBe("Jacob");
    expect(p.history.map(h => h.id)).toEqual(["c", "b", "a"]);
    expect(p.history[1]).toMatchObject({ docType: "tax-bill", result: "attached" });
  });
  it("a rejected / skipped / failed upload never counts as the last uploader", () => {
    const p = dealProvenance([row("a", "2026-07-01T10:00:00Z", "created", "Eric"), row("b", "2026-10-19T16:00:00Z", "skipped", "Jacob")]);
    expect(p.lastUpload?.userName).toBe("Eric");
  });
  it("legacy 'success' rows: the first, near the deal's creation, created it; later ones added to it", () => {
    const rows = [row("a", "2026-06-01T10:00:00Z", "success", "Eric"), row("b", "2026-10-19T16:00:00Z", "success", "Jacob")];
    const p = dealProvenance(rows, "2026-06-01T09:59:00Z");
    expect(p.createdBy?.userName).toBe("Eric");
    expect(p.history.map(h => h.result)).toEqual(["attached", "created"]);
  });
  it("a deal created long before its first logged upload has NO known creator (never guessed from a later upload)", () => {
    const p = dealProvenance([row("b", "2026-10-19T16:00:00Z", "success", "Jacob")], "2025-01-05T00:00:00Z");
    expect(p.createdBy).toBeNull();
    expect(p.lastUpload?.userName).toBe("Jacob");
  });
  it("the current name wins over the name stored at upload time", () => {
    const p = dealProvenance([row("a", "2026-07-01T10:00:00Z", "created", "KPR Admin")], null, () => "Eric Fink");
    expect(p.createdBy?.userName).toBe("Eric Fink");
  });
  it("status in: new outcomes pass, legacy success/failed kept, junk → success", () => {
    expect(["created", "attached", "skipped", "rejected", "failed", "success", "ok", undefined].map(normalizeStatusIn))
      .toEqual(["created", "attached", "skipped", "rejected", "failed", "success", "success", "success"]);
    expect(resultOf(row("x", "2026-01-01T00:00:00Z", "failed", "E"), null)).toBe("failed");
  });
  it("site-wide filter: user by name or email, inclusive date range, result", () => {
    const rows = [
      { userName: "Jacob Wallberg", userEmail: "jwallberg@kprcenters.com", createdAt: "2026-10-19T15:43:00Z", result: "rejected" },
      { userName: "Eric Fink", userEmail: "efink@kprcenters.com", createdAt: "2026-10-18T12:00:00Z", result: "created" },
    ];
    expect(filterLog(rows, { user: "jwall" })).toHaveLength(1);
    expect(filterLog(rows, { user: "eric" })[0].userName).toBe("Eric Fink");
    expect(filterLog(rows, { from: "2026-10-19", to: "2026-10-19" })).toHaveLength(1);
    expect(filterLog(rows, { to: "2026-10-18" })).toHaveLength(1);
    expect(filterLog(rows, { result: "created" })).toHaveLength(1);
    expect(filterLog(rows, {})).toHaveLength(2);
  });
});
