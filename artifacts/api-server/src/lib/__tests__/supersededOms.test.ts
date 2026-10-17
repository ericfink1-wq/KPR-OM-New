import { describe, it, expect } from "vitest";
import { carryOver } from "../supersededOms";

describe("superseded OM carry-over", () => {
  it("carries human-entered fields the newer record lacks", () => {
    expect(carryOver({ noi: 2356972 }, { dealReview: "Passed on price", acqTargetIRR: 12, txnSeller: "X" }))
      .toEqual({ dealReview: "Passed on price", acqTargetIRR: 12, txnSeller: "X" });
  });
  it("never carries the old OM's own figures — newer info wins", () => {
    expect(carryOver({}, { noi: 2091749, tenants: [{ name: "Old" }], loanBalance: 18192420, walt: 0.2, occupancy: 100, notes: "2021 narrative" })).toEqual({});
  });
  it("never overwrites what the newer record already has", () => {
    expect(carryOver({ dealReview: "2026 take" }, { dealReview: "2021 take" })).toEqual({});
  });
});
