import { describe, it, expect } from "vitest";
import { salePatch, RECORDED_SALES } from "../recordedSales";

const pompano = RECORDED_SALES.find(s => s.name === "Pompano Marketplace")!;
const crossroads = RECORDED_SALES.find(s => s.name === "Shops at Crossroads")!;

describe("recorded sale closings", () => {
  it("fills a Sold deal's missing closing date and buyer", () => {
    expect(salePatch({ status: "Sold" }, pompano)).toEqual({ txnSaleDate: "2026-07-28", txnBuyer: "Kimco" });
  });
  it("never overwrites what someone already entered", () => {
    expect(salePatch({ status: "Sold", txnSaleDate: "2026-07-30", txnBuyer: "Kimco Realty" }, pompano)).toBeNull();
  });
  it("does not invent a buyer when none was given", () => {
    expect(salePatch({ status: "Sold" }, crossroads)).toEqual({ txnSaleDate: "2026-06-29" });
  });
  it("leaves a deal that isn't marked Sold alone", () => {
    expect(salePatch({ status: "Owned" }, pompano)).toBeNull();
  });
});
