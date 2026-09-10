import { describe, it, expect } from "vitest";
import { brandMatcher, brandBaseName, isoDateOrNull, isVacantName } from "../mcpTools";

// Found by stress-testing against the real 301-deal corpus: a plain substring match on
// tenant names is catastrophic. "Ross" matched "American Red CROSS", "CROSS Country
// Package", "Lacrosse Unlimited" and — worst — the rent notations "(Modified GROSS)" and
// "(GROSS)" that appear inside dozens of unrelated tenant names, contaminating the median
// for a completely reasonable question.

describe("brand matching", () => {
  const ross = brandMatcher("Ross");
  it("matches the brand as a whole word", () => {
    expect(ross("Ross Dress for Less")).toBe(true);
    expect(ross("Ross Dress For Less, Inc")).toBe(true);
    expect(ross("ROSS")).toBe(true);
  });
  it("does NOT match the brand buried inside another word", () => {
    for (const n of ["American Red Cross", "Cross Country Package Inc.", "Lacrosse Unlimited",
                     "H&R Block (Modified Gross)", "Evereve (Gross)", "Jewel-Osco (Modified Gross)"]) {
      expect(ross(n), `${n} must not match "Ross"`).toBe(false);
    }
  });
  it("still folds together the ways one brand gets written", () => {
    const sbux = brandMatcher("Starbucks");
    for (const n of ["Starbucks", "STARBUCKS", "Starbucks Coffee", "Starbucks Corporation", "Starbucks - NAP"]) {
      expect(sbux(n), n).toBe(true);
    }
  });
  it("handles multi-word brands and regex metacharacters safely", () => {
    expect(brandMatcher("Five Below")("Five Below #1234")).toBe(true);
    expect(brandMatcher("H&R Block")("H&R Block")).toBe(true);
    // A query full of metacharacters must not throw or match everything.
    expect(() => brandMatcher("a.*(b")("anything")).not.toThrow();
    expect(brandMatcher("a.*(b")("anything")).toBe(false);
  });
  it("returns no match for an empty query rather than matching everything", () => {
    expect(brandMatcher("")("Starbucks")).toBe(false);
    expect(brandMatcher("   ")("Starbucks")).toBe(false);
  });
});

describe("brand base name", () => {
  it("collapses the decorations a roster puts around a brand", () => {
    for (const n of ["Dollar Tree", "Dollar Tree #3654", "Dollar Tree (LOI)", "Dollar Tree Stores", "DOLLAR TREE, Inc"]) {
      expect(brandBaseName(n), n).toBe("dollar tree");
    }
  });
  it("keeps genuinely different tenants apart", () => {
    expect(brandBaseName("Dollar General")).not.toBe(brandBaseName("Dollar Tree"));
    expect(brandBaseName("Family Dollar")).not.toBe(brandBaseName("Dollar Tree"));
  });
});

describe("ISO date validation", () => {
  // A filter that silently stops filtering returns a confident answer to a question you
  // did not ask — on the real corpus a garbage date quietly became "has any expiry at all"
  // and returned 6,543 matches.
  it("accepts a real ISO date", () => {
    expect(isoDateOrNull("2027-06-30")).toBe("2027-06-30");
  });
  it("rejects everything that isn't one", () => {
    for (const v of ["garbage", "2027-13-45", "06/30/2027", "2027", "2027-6-3", "", null, undefined, 20270630]) {
      expect(isoDateOrNull(v as unknown), String(v)).toBeNull();
    }
  });
  it("rejects a date that looks valid but isn't a real day", () => {
    expect(isoDateOrNull("2027-02-30")).toBeNull();
    expect(isoDateOrNull("2027-04-31")).toBeNull();
  });
});

describe("vacancy is not a brand", () => {
  it("recognises the labels the corpus uses for empty space", () => {
    expect(isVacantName("Vacant")).toBe(true);
    expect(isVacantName("Available (Adjacent to Anthropologie)")).toBe(true);
  });
});

// ── per-user key cap ────────────────────────────────────────────────────────
import { MAX_ACTIVE_KEYS_PER_USER } from "../mcpKeys";

describe("key cap", () => {
  // A person has a laptop, a desktop, maybe a phone. The cap stops both the accidental
  // case — re-minting instead of reusing, leaving live credentials nobody tracks — and an
  // authenticated user filling the table. Verified live: minting stops at exactly the cap
  // with an actionable message, revoking frees a slot, and other accounts are unaffected.
  it("is generous enough for real use and low enough to stay accountable", () => {
    expect(MAX_ACTIVE_KEYS_PER_USER).toBeGreaterThanOrEqual(5);
    expect(MAX_ACTIVE_KEYS_PER_USER).toBeLessThanOrEqual(50);
  });
});
