import { describe, it, expect } from "vitest";
import { anchorLabel } from "../leaseRisk";

const deal = { tenants: [{ name: "Macy's" }, { name: "Dick's Sporting Goods" }, { name: "Vacant" }] } as never;

describe("co-tenancy anchor label", () => {
  it("shows the roster tenant, not the clause text", () => {
    expect(anchorLabel(deal, "Macy's (Anchor Premises)")).toBe("Macy's");
    expect(anchorLabel(deal, "DICK'S SPORTING GOODS - 50,000 SF")).toBe("Dick's Sporting Goods");
  });
  it("turns lease language that names no tenant into a plain label", () => {
    expect(anchorLabel(deal, "Anchor Premises (Other Required Lessees per BLP Para 8")).toBe("a required anchor");
  });
  it("keeps a real brand that just isn't on this roster", () => {
    expect(anchorLabel(deal, "Target")).toBe("Target");
  });
});
