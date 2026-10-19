import { describe, it, expect } from "vitest";
import { dealIdFromPath, tombstoneId, GONE_BODY } from "../dealTombstone";

// Deal 1792431501111-hp3bsxm came back 20 min after DELETE (PUT is an upsert). Every write
// under /deals/<id> is now checked against a tombstone; this pins which id a path names.
describe("deleted deals stay deleted", () => {
  it("finds the deal id in every per-deal write route", () => {
    expect(dealIdFromPath("/deals/1792431501111-hp3bsxm")).toBe("1792431501111-hp3bsxm");
    expect(dealIdFromPath("/deals/1792431501111-hp3bsxm/images")).toBe("1792431501111-hp3bsxm");
    expect(dealIdFromPath("/deals/abc/image-raw/cover")).toBe("abc");
    expect(dealIdFromPath("/deals/abc/lease-abstracts/bulk")).toBe("abc");
    expect(dealIdFromPath("/deals/a%20b/source")).toBe("a b");
  });
  it("non-deal paths are not checked", () => {
    expect(dealIdFromPath("/deals")).toBeNull();
    expect(dealIdFromPath("/am/records")).toBeNull();
    expect(dealIdFromPath("/upload-log")).toBeNull();
  });
  it("tombstones live in am_records under their own kind, and the refusal says why", () => {
    expect(tombstoneId("x1")).toBe("deal_tombstone:x1");
    expect(GONE_BODY).toMatchObject({ code: "deal_deleted", deleted: true });
  });
});
