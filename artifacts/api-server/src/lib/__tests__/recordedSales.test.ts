import { describe, it, expect } from "vitest";
import { salePatch, RECORDED_SALES } from "../recordedSales";

const pompano = RECORDED_SALES.find(s => s.name === "Pompano Marketplace")!;
const crossroads = RECORDED_SALES.find(s => s.name === "Shops at Crossroads")!;

describe("recorded sale closings", () => {
  it("fills a Sold deal's missing closing date and buyer", () => {
    expect(salePatch({ status: "Sold" }, pompano)).toEqual({ txnSaleDate: "2026-07-28", txnBuyer: "Kimco", txnSalePrice: 53000000 });
  });
  it("never overwrites what someone already entered", () => {
    expect(salePatch({ status: "Sold", txnSaleDate: "2026-07-30", txnBuyer: "Kimco Realty", txnSalePrice: 52000000 }, pompano)).toBeNull();
  });
  it("does not invent a buyer when none was given", () => {
    expect(salePatch({ status: "Sold" }, crossroads)).toEqual({ txnSaleDate: "2026-06-29", txnSalePrice: 38750000 });
  });
  it("leaves a deal that isn't marked Sold alone", () => {
    expect(salePatch({ status: "Owned" }, pompano)).toBeNull();
  });
});

describe("Bolton + Pompano fills (10/17/26)", () => {
  const bolton = RECORDED_SALES.find(s => s.name === "Bolton Plaza")!;
  it("fills Bolton's closing date and KPR's original purchase, keeping the stored price", () => {
    expect(salePatch({ status: "Sold", txnSalePrice: 22875000 }, bolton)).toEqual({ txnSaleDate: "2026-04-21", txnCloseDate: "2019-08-01", txnPurchasePrice: 18050000 });
  });
  it("fills Pompano's sale price", () => {
    expect(salePatch({ status: "Sold", txnSaleDate: "2026-07-28", txnBuyer: "Kimco" }, pompano)).toEqual({ txnSalePrice: 53000000 });
  });
});

describe("Somerset Square closing (10/20/26)", () => {
  const somerset = RECORDED_SALES.find(s => s.name === "Somerset Square")!;
  it("flips the owned record to Sold with the closing date, buyer and price", () => {
    expect(salePatch({ status: "Owned", txnCloseDate: "2016-10-20", txnPurchasePrice: 26600000 }, somerset))
      .toEqual({ status: "Sold", txnSaleDate: "2026-10-20", txnBuyer: "Asana Partners", txnSalePrice: 29000000, dispExitCap: 6.85 });
  });
  it("is a no-op once recorded, and never flips a non-Owned status", () => {
    expect(salePatch({ status: "Sold", txnSaleDate: "2026-10-20", txnBuyer: "Asana Partners", txnSalePrice: 29000000, dispExitCap: 6.85 }, somerset)).toBeNull();
    expect(salePatch({ status: "Sold", txnSaleDate: "2026-10-20", txnBuyer: "Asana Partners", txnSalePrice: 29000000 }, somerset)).toEqual({ dispExitCap: 6.85 });
    expect(salePatch({ status: "Passed" }, somerset)).toBeNull();
  });
  it("only a sale flagged markSold flips status", () => {
    expect(salePatch({ status: "Owned" }, pompano)).toBeNull();
  });
});
