import { describe, it, expect } from "vitest";
import { auditExtraction } from "../extractionAudit";

const ids = (d: Record<string, unknown>) => auditExtraction(d).map(q => q.id).filter(id => id.startsWith("audit-sold"));

describe("Sold record completeness", () => {
  it("flags a Sold deal missing its sale price (Sunshine / Crossroads)", () => {
    expect(ids({ status: "Sold", txnSaleDate: "2026-07-28" })).toEqual(["audit-sold-no-price"]);
  });
  it("flags both when nothing is recorded", () => {
    expect(ids({ status: "Sold" })).toEqual(["audit-sold-no-date", "audit-sold-no-price"]);
  });
  it("is clean once filled, and never applies to Owned deals", () => {
    expect(ids({ status: "Sold", txnSaleDate: "2026-07-28", txnSalePrice: 53000000 })).toEqual([]);
    expect(ids({ status: "Owned" })).toEqual([]);
  });
});
