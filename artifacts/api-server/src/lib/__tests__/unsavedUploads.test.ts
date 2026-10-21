import { describe, it, expect } from "vitest";
import { hiddenUnsavedIds, planUnsavedUploads, savedMatchFor, propKey, type UploadRow } from "../unsavedUploads";

// The live case (10/20/26): the OM was saved as "The Waterfront" (PA); two reads of
// Newmark's Financial Narrative finished but their tab closed before filing them, so they
// sat in the library as "Waterfront" with no state and `_ingestBy` still set.
const saved: UploadRow = { id: "1792528912560-8mbe0d3", updatedAt: new Date("2026-10-20T20:50:18.519Z"), data: {
  propertyName: "The Waterfront", state: "PA", city: "Homestead", fileName: "NMRK - The Waterfront - OM",
  uploadedAt: "2026-10-20T20:48:36.942Z", packageSources: { startedAt: "2026-10-20T20:48:38.787Z" } } };
const narrative = (id: string, uploadedAt: string): UploadRow => ({ id, updatedAt: new Date(uploadedAt), data: {
  propertyName: "Waterfront", state: null, fileName: "NMRK - The Waterfront - Financial Narrative",
  uploadedAt, _ingestBy: "usr_mpwti84d_16al2p", _processing: false } });
const n1 = narrative("1792528752996-wdj1p0q", "2026-10-20T20:49:04.000Z");
const n2 = narrative("1792529345857-g71ef7y", "2026-10-20T20:57:15.703Z");
const rows = [n1, saved, n2];
const t = (iso: string) => Date.parse(iso);

describe("unsaved uploads — The Waterfront ×3", () => {
  it("'The Waterfront' and 'Waterfront' are one name", () => {
    expect(propKey("The Waterfront")).toBe(propKey("Waterfront"));
    expect(propKey("THE  WATERFRONT")).toBe("waterfront");
  });
  it("each Financial Narrative matches the saved OM deal (no state on the upload ≠ a conflict)", () => {
    expect(savedMatchFor(n1, rows)?.id).toBe(saved.id);
    expect(savedMatchFor(n2, rows)?.id).toBe(saved.id);
  });
  it("GET /deals hides both — a saved deal matches them — and never the saved deal", () => {
    const hidden = hiddenUnsavedIds(rows, t("2026-10-21T12:00:00Z"));
    expect([...hidden].sort()).toEqual([n1.id, n2.id].sort());
  });
  it("the sweep (past 30 min) moves both to Trash, naming the deal they duplicate", () => {
    const plan = planUnsavedUploads(rows, t("2026-10-21T12:00:00Z"));
    expect(plan.map(a => [a.id, a.kind])).toEqual([[n1.id, "trash"], [n2.id, "trash"]]);
    const a = plan[0];
    expect(a.kind === "trash" && a.matchId).toBe(saved.id);
    expect(a.kind === "trash" && a.reason).toMatch(/duplicate of “The Waterfront” \(1792528912560-8mbe0d3\)/);
  });
  it("inside the 30-min window: hidden even with no match, and the sweep leaves it alone", () => {
    const alone = [n2];
    const now = t("2026-10-20T21:10:00Z");                  // 13 min after it finished
    expect(hiddenUnsavedIds(alone, now).has(n2.id)).toBe(true);
    expect(planUnsavedUploads(alone, now)).toEqual([]);
  });
  it("past 30 min with no match: shown, and claimed as a deal", () => {
    const now = t("2026-10-20T21:30:00Z");
    expect(hiddenUnsavedIds([n2], now).size).toBe(0);
    expect(planUnsavedUploads([n2], now)).toEqual([{ kind: "claim", id: n2.id }]);
  });
  it("never matches across two different stated states", () => {
    const ohio: UploadRow = { ...n2, data: { ...n2.data, state: "OH" } };
    expect(savedMatchFor(ohio, [saved, ohio])).toBeNull();
    expect(planUnsavedUploads([saved, ohio], t("2026-10-21T12:00:00Z"))).toEqual([{ kind: "claim", id: n2.id }]);
  });
  it("matches by alias and by the property in the saved deal's file name", () => {
    const byAka: UploadRow = { id: "x", updatedAt: null, data: { propertyName: "Waterfront Town Center", _ingestBy: "u", uploadedAt: "2026-10-01T00:00:00Z" } };
    const akaDeal: UploadRow = { id: "d", updatedAt: null, data: { propertyName: "The Waterfront", aka: ["Waterfront Town Center"] } };
    expect(savedMatchFor(byAka, [akaDeal, byAka])?.id).toBe("d");
    const noName: UploadRow = { id: "d2", updatedAt: null, data: { propertyName: "", fileName: "NMRK - The Waterfront - OM" } };
    expect(savedMatchFor(n1, [noName, n1])?.id).toBe("d2");
  });
  it("ignores rows that aren't unsaved uploads, and never matches another unsaved upload", () => {
    const reading: UploadRow = { ...n2, id: "r", data: { ...n2.data, _processing: true } };
    const failed: UploadRow = { ...n2, id: "f", data: { ...n2.data, _processingError: "boom" } };
    const trashed: UploadRow = { ...n2, id: "tr", data: { ...n2.data, trashedAt: "2026-10-20T22:00:00Z" } };
    const now = t("2026-10-21T12:00:00Z");
    expect(hiddenUnsavedIds([reading, failed, trashed], now).size).toBe(0);
    expect(planUnsavedUploads([reading, failed, trashed], now)).toEqual([]);
    // two strays with no saved deal: neither is the other's "saved match"
    expect(planUnsavedUploads([n1, n2], now).map(a => a.kind)).toEqual(["claim", "claim"]);
  });
  it("a different property is never hidden", () => {
    const other: UploadRow = { id: "o", updatedAt: null, data: { propertyName: "Waterworks", fileName: "NMRK - Waterworks - Financial Narrative", _ingestBy: "u", uploadedAt: "2026-10-01T00:00:00Z" } };
    expect(hiddenUnsavedIds([saved, other], t("2026-10-21T12:00:00Z")).size).toBe(0);
  });
});
