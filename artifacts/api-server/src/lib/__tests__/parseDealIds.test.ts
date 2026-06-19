import { describe, it, expect } from "vitest";
import { parseDealIds } from "../queryParams";

// Regression: the qs query parser turns >20 repeated dealId= params into an OBJECT
// { "0": id, ... }. Before the fix parseDealIds returned null → the Owned filter fell
// back to ALL deals (identical numbers) for portfolios with >20 owned deals.

describe("parseDealIds", () => {
  it("handles an array (≤20 params)", () => expect(parseDealIds(["a", "b", "c"])).toEqual(["a", "b", "c"]));
  it("handles a single string", () => expect(parseDealIds("a")).toEqual(["a"]));
  it("returns null when absent", () => { expect(parseDealIds(undefined)).toBeNull(); expect(parseDealIds("")).toBeNull(); });
  it("handles the qs OBJECT form from >20 params (the Owned bug)", () => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < 24; i++) obj[String(i)] = `deal-${i}`;
    const parsed = parseDealIds(obj);
    expect(parsed).not.toBeNull();
    expect(parsed!.length).toBe(24);
    expect(parsed).toContain("deal-0");
    expect(parsed).toContain("deal-23");
  });
});
