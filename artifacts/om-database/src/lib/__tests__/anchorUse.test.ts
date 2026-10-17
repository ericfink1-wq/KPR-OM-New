import { describe, it, expect } from "vitest";
import { isAnchorUse, isNonAnchorUse } from "../anchorUse";

describe("anchors are grocery / big-box / junior-box / entertainment uses only", () => {
  it.each(["IWG", "Regus", "WeWork", "Chase", "Bank of America", "Aspen Dental", "Garbizo Animal Clinic", "State Farm Insurance"])("%s is not an anchor", n => {
    expect(isNonAnchorUse(n)).toBe(true);
    expect(isAnchorUse({ name: n, isAnchor: true, sf: 30000 })).toBe(false);
  });
  it.each(["Kroger", "Publix", "Ross Dress For Less", "Office Depot", "OfficeMax", "Regal Cinemas", "Planet Fitness", "Home Depot"])("%s can be an anchor", n => {
    expect(isAnchorUse({ name: n, isAnchor: true })).toBe(true);
  });
  it("a 20k+ SF retail box counts even if unflagged", () => expect(isAnchorUse({ name: "Burlington", sf: 45000 })).toBe(true));
});
