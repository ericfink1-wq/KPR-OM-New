import { describe, it, expect } from "vitest";
import { clickSort, chainComparator, sortMarker, removeSortLevel, promoteSortLevel, MAX_SORT_LEVELS, type SortLevel } from "../multiSort";

const DEFAULT: SortLevel[] = [{ key: "status", dir: "asc" }, { key: "lastUploadAt", dir: "desc" }];

describe("clickSort", () => {
  it("clicking the primary column flips it and keeps the tiebreakers", () => {
    expect(clickSort(DEFAULT, "status", false)).toEqual([{ key: "status", dir: "desc" }, { key: "lastUploadAt", dir: "desc" }]);
  });
  it("clicking another column sorts by it alone", () => {
    expect(clickSort(DEFAULT, "totalSF", false)).toEqual([{ key: "totalSF", dir: "desc" }]);
  });
  it("adding appends a tiebreaker; adding an existing level flips just that level", () => {
    expect(clickSort(DEFAULT, "totalSF", true)).toEqual([...DEFAULT, { key: "totalSF", dir: "desc" }]);
    expect(clickSort(DEFAULT, "lastUploadAt", true)).toEqual([DEFAULT[0], { key: "lastUploadAt", dir: "asc" }]);
  });
  it(`stops at ${MAX_SORT_LEVELS} levels`, () => {
    let l = DEFAULT;
    for (const k of ["a", "b", "c", "d"]) l = clickSort(l, k, true);
    expect(l).toHaveLength(MAX_SORT_LEVELS);
  });
});

describe("chainComparator", () => {
  const rows = [
    { name: "C", status: 1, up: 1 },
    { name: "A", status: 0, up: 1 },
    { name: "B", status: 1, up: 5 },
    { name: "D", status: 1, up: 5 },
  ];
  const asc = (k: string) => k === "status" ? (a: typeof rows[0], b: typeof rows[0]) => a.status - b.status
    : k === "up" ? (a: typeof rows[0], b: typeof rows[0]) => a.up - b.up : null;
  it("sorts by the first level, breaks ties with the next, then the final tiebreak", () => {
    const sorted = rows.slice().sort(chainComparator([{ key: "status", dir: "asc" }, { key: "up", dir: "desc" }], asc, (a, b) => a.name.localeCompare(b.name)));
    expect(sorted.map(r => r.name)).toEqual(["A", "B", "D", "C"]);
  });
  it("skips unknown keys instead of breaking", () => {
    const sorted = rows.slice().sort(chainComparator([{ key: "nope", dir: "asc" }, { key: "status", dir: "desc" }], asc, (a, b) => a.name.localeCompare(b.name)));
    expect(sorted.map(r => r.name)).toEqual(["B", "C", "D", "A"]);
  });
});

describe("markers and editing", () => {
  it("shows a bare arrow for one level and ranked arrows for a chain", () => {
    expect(sortMarker([{ key: "sf", dir: "desc" }], "sf")).toBe(" ▼");
    expect(sortMarker(DEFAULT, "status")).toBe(" ▲1");
    expect(sortMarker(DEFAULT, "lastUploadAt")).toBe(" ▼2");
    expect(sortMarker(DEFAULT, "city")).toBe("");
  });
  it("removes and promotes levels", () => {
    expect(removeSortLevel(DEFAULT, "status")).toEqual([DEFAULT[1]]);
    expect(promoteSortLevel(DEFAULT, "lastUploadAt")).toEqual([DEFAULT[1], DEFAULT[0]]);
    expect(promoteSortLevel(DEFAULT, "status")).toEqual(DEFAULT);
  });
});
