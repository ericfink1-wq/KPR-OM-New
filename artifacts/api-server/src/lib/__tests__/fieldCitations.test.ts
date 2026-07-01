import { describe, it, expect } from "vitest";

// extract.ts imports the db module, which throws at load without DATABASE_URL —
// stub one BEFORE the dynamic import (no connection is made just by importing).
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
const { EXTRACTION_PROMPT } = await import("../extract");

// Page-cited extraction: the prompt must keep asking for fieldCitations (the
// per-headline-number OM locator) and must reference the page-marker format the
// PDF extractor actually emits ("--- Page N ---" — see pdfExtract.ts). If the
// marker format ever changes in one place but not the other, citations silently
// stop resolving to real pages.
describe("EXTRACTION_PROMPT fieldCitations", () => {
  it("asks for fieldCitations with the headline keys", () => {
    expect(EXTRACTION_PROMPT).toContain('"fieldCitations"');
    for (const key of ["noi", "capRate", "askingPrice", "totalSF", "occupancy", "grossPotentialRent", "walt"]) {
      expect(EXTRACTION_PROMPT).toContain(key);
    }
  });

  it("references the exact page-marker format pdfExtract emits", () => {
    expect(EXTRACTION_PROMPT).toContain("--- Page N ---");
  });
});
