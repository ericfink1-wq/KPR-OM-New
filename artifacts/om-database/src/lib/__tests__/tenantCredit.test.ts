import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { isInvestmentGrade, creditBucket, brandFamilyKey, brandDisplayName } from "../tenantCredit";

describe("investment grade — the names Eric's review found missing", () => {
  it("rated brands now resolve, with real roster spellings", () => {
    for (const n of ["T.J. Maxx", "TJ Maxx", "Ross", "Ross Dress For Less #1459", "Dollar Tree", "The Home Depot", "HOME DEPOT", "Home Depot (NAP-1)", "Dick's", "Dick's Sporting Goods", "Kroger", "Fred Meyer", "Stop & Shop", "Super Stop & Shop", "Giant", "Giant Food", "Giant Food Stores", "Food Lion", "Hannaford Supermarket"])
      expect(isInvestmentGrade(n), n).toBe(true);
  });
  it("look-alikes do NOT ride along", () => {
    for (const n of ["Giant Eagle", "Giant Fitness", "Crossroads Pizza", "Acme Markets", "Safeway"])
      expect(isInvestmentGrade(n), n).toBe(false);
  });
  it("credit buckets", () => {
    expect(creditBucket("Giant Food Stores")).toBe("Investment Grade");
    expect(creditBucket("Acme Markets")).toBe("Non-Investment Grade");
    expect(creditBucket("Joe's Pizza")).toBe("Unrated");
    expect(creditBucket("Some Co", "BB+")).toBe("Non-Investment Grade");
  });
});

describe("brandFamilyKey — one brand, one key", () => {
  it("merges variants of the same brand", () => {
    expect(brandFamilyKey("Giant Food Stores")).toBe(brandFamilyKey("Giant"));
    expect(brandFamilyKey("Giant Food")).toBe(brandFamilyKey("Giant"));
    expect(brandFamilyKey("HOME DEPOT")).toBe(brandFamilyKey("The Home Depot"));
    expect(brandFamilyKey("T.J. Maxx")).toBe(brandFamilyKey("TJ Maxx"));
    expect(brandFamilyKey("Acme #992")).toBe(brandFamilyKey("Acme Markets"));
    expect(brandFamilyKey("Super Stop & Shop")).toBe(brandFamilyKey("Stop & Shop"));
    expect(brandFamilyKey("ShopRite")).toBe(brandFamilyKey("Shop Rite"));
    expect(brandFamilyKey("Whole Foods Market")).toBe(brandFamilyKey("Whole Foods"));
  });
  it("never merges different companies", () => {
    expect(brandFamilyKey("Giant Eagle")).not.toBe(brandFamilyKey("Giant"));
    expect(brandFamilyKey("Food Lion")).not.toBe(brandFamilyKey("Lion"));
    expect(brandFamilyKey("Dollar General")).not.toBe(brandFamilyKey("Dollar Tree"));
  });
  it("de-shouts labels", () => {
    expect(brandDisplayName("HOME DEPOT")).toBe("Home Depot");
    expect(brandDisplayName("Stop & Shop")).toBe("Stop & Shop");
  });
});

describe("browser and server use the identical credit file", () => {
  it("api-server copy matches byte for byte", () => {
    const here = fs.readFileSync(path.resolve(__dirname, "../tenantCredit.ts"), "utf8");
    const server = fs.readFileSync(path.resolve(__dirname, "../../../../api-server/src/lib/tenantCredit.ts"), "utf8");
    expect(server).toBe(here);
  });
});
