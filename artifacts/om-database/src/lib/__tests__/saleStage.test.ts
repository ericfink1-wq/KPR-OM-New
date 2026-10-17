import { describe, it, expect } from "vitest";
import { saleStageLabel, isClosingDate } from "../saleStage";

describe("sale stage — Owned until the sale closes", () => {
  it("formats the pill the way Eric described it", () => {
    expect(saleStageLabel({ status: "Owned", saleStage: "Under Contract", txnBuyer: "Wharton", txnSalePrice: 39000000, saleExpectedClosing: "2027-01-15" }))
      .toBe("Under contract · Wharton · $39M · closing Jan '27");
    expect(saleStageLabel({ status: "Owned", saleStage: "Under Contract", txnBuyer: "RCG", txnSalePrice: 19500000, saleExpectedClosing: null }))
      .toBe("Under contract · RCG · $19.5M");
  });
  it("only shows on Owned deals with a stage", () => {
    expect(saleStageLabel({ status: "Owned", saleStage: null, txnBuyer: null, txnSalePrice: null, saleExpectedClosing: null })).toBeNull();
    expect(saleStageLabel({ status: "Sold", saleStage: "Under Contract", txnBuyer: null, txnSalePrice: null, saleExpectedClosing: null })).toBeNull();
  });
  it("Sold needs a real closing date", () => {
    expect(isClosingDate("2026-04-15")).toBe(true);
    for (const v of ["", "TBD", null, undefined, "Q1"]) expect(isClosingDate(v)).toBe(false);
  });
});
