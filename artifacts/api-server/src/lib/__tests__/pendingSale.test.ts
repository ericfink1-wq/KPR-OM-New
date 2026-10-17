import { describe, it, expect } from "vitest";
import { stripPendingSaleData } from "../pendingSale";

describe("no pending-sale data", () => {
  it("drops the sale-stage keys and an Owned deal's buyer / price / date", () => {
    const d: Record<string, unknown> = { status: "Owned", saleStage: "Under Contract", saleExpectedClosing: "2027-01-15", txnBuyer: "Wharton", txnSalePrice: 39e6, txnSeller: "Kimco", txnPurchasePrice: 30e6 };
    expect(stripPendingSaleData(d).sort()).toEqual(["saleExpectedClosing", "saleStage", "txnBuyer", "txnSalePrice"]);
    expect(d).toEqual({ status: "Owned", txnSeller: "Kimco", txnPurchasePrice: 30e6 }); // acquisition fields kept
  });
  it("keeps a CLOSED sale's buyer, price and closing date", () => {
    const d: Record<string, unknown> = { status: "Sold", txnBuyer: "Kimco", txnSalePrice: 5e7, txnSaleDate: "2026-07-28", saleStage: "Under Contract" };
    expect(stripPendingSaleData(d)).toEqual(["saleStage"]);
    expect(d).toEqual({ status: "Sold", txnBuyer: "Kimco", txnSalePrice: 5e7, txnSaleDate: "2026-07-28" });
  });
  it("is a no-op on a clean deal", () => {
    expect(stripPendingSaleData({ status: "Prospect", noi: 1 })).toEqual([]);
  });
});
