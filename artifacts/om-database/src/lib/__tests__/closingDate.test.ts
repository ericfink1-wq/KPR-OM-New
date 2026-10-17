import { describe, it, expect } from "vitest";
import { isClosingDate } from "../closingDate";

describe("Sold = the sale has closed", () => {
  it("Sold needs a real closing date", () => {
    expect(isClosingDate("2026-04-15")).toBe(true);
    for (const v of ["", "TBD", null, undefined, "Q1"]) expect(isClosingDate(v)).toBe(false);
  });
});
