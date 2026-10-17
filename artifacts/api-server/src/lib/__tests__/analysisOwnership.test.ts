import { describe, it, expect } from "vitest";
import { keepServerOwnedAnalysis, storedWriteUpIsNewer } from "../analysisOwnership";

// 10/17/26: a tab opened before the background re-analysis saved its old copy and put the
// old write-up (and rules version) back, so the "on current rules" count never moved.
const stored = { notes: "NEW", dealScore: { grade: "B" }, redFlags: [{ d: "new" }], analysisVersion: 4, lastScoredAt: "2026-10-17T19:35:00Z", analysisAutoTries: { v: 4, n: 1 }, status: "Prospect" };
const staleTab = () => ({ notes: "OLD", dealScore: { grade: "B+" }, redFlags: [{ d: "old" }], analysisVersion: 3, lastScoredAt: "2026-09-01T00:00:00Z", analysisBatchPending: "msgbatch_x", status: "Passed" });

describe("server-owned write-up on save", () => {
  it("keeps the newer stored write-up but takes the user's real edit", () => {
    const inc: Record<string, unknown> = staleTab();
    const kept = keepServerOwnedAnalysis(stored, inc);
    expect(inc.notes).toBe("NEW"); expect(inc.analysisVersion).toBe(4); expect(inc.redFlags).toEqual([{ d: "new" }]);
    expect(inc.status).toBe("Passed");                       // the edit the save was for
    expect(inc.analysisBatchPending).toBeUndefined();        // bookkeeping stays as the server has it
    expect(inc.analysisAutoTries).toEqual({ v: 4, n: 1 });
    expect(kept).toContain("notes");
  });
  it("does nothing when the incoming copy is current", () => {
    const inc: Record<string, unknown> = { ...stored, notes: "edited by hand" };
    expect(keepServerOwnedAnalysis(stored, inc)).toEqual([]);
    expect(inc.notes).toBe("edited by hand");
  });
  it("a new document (re-upload) is never overridden", () => {
    const inc: Record<string, unknown> = staleTab();
    expect(keepServerOwnedAnalysis(stored, inc, true)).toEqual([]);
    expect(inc.notes).toBe("OLD");
  });
  it("a save that marks the analysis stale keeps that flag", () => {
    const inc: Record<string, unknown> = { ...staleTab(), analysisStale: true };
    keepServerOwnedAnalysis({ ...stored, analysisStale: false }, inc);
    expect(inc.analysisStale).toBe(true);
  });
  it("a missing lastScoredAt on the incoming copy is not 'older'", () => {
    expect(storedWriteUpIsNewer({ analysisVersion: 4, lastScoredAt: "2026-10-17" }, { analysisVersion: 4 })).toBe(false);
  });
});
