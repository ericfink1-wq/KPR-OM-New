import { describe, it, expect } from "vitest";
import { ensurePropertyName, propertyNameFromFile } from "../dealMaintenance";

describe("never save a nameless deal (Eric, 10/16/26)", () => {
  it("recovers the property from a broker file name", () => {
    expect(propertyNameFromFile("NMRK - Lake Brandon Village - Financial Narrative.pdf")).toBe("Lake Brandon Village");
    expect(propertyNameFromFile("Blue Bell Site Plan OM- Revised.pdf")).toBe("Blue Bell");
  });
  it("fills a blank name, leaves a real one alone", () => {
    const blank: Record<string, unknown> = { propertyName: "  ", fileName: "NMRK - Lake Brandon Village - Additional Info 2.pdf" };
    expect(ensurePropertyName(blank)).toBe(true);
    expect(blank.propertyName).toBe("Lake Brandon Village");
    const named: Record<string, unknown> = { propertyName: "Academy Plaza", fileName: "z.pdf" };
    expect(ensurePropertyName(named)).toBe(false);
    expect(named.propertyName).toBe("Academy Plaza");
  });
  it("falls back to the bare file name, then a placeholder", () => {
    const a: Record<string, unknown> = { fileName: "OM.pdf" };
    ensurePropertyName(a);
    expect(a.propertyName).toBe("OM");
    const b: Record<string, unknown> = {};
    ensurePropertyName(b);
    expect(b.propertyName).toBe("Untitled property");
  });
});
