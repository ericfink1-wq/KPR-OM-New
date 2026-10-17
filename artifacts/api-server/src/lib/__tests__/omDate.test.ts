import { describe, it, expect } from "vitest";
import { findOmDate } from "../omDate";

const now = new Date("2026-10-17T00:00:00Z");
describe("OM date fill", () => {
  it("reads the cover month", () => {
    expect(findOmDate({ sourceText: "NEW GARDEN CROSSING  Greensboro, NC  OFFERING MEMORANDUM  February 2021  Berkeley Capital", uploadedAt: "2026-09-02T16:18:28Z" }, now))
      .toEqual({ omDate: "2021-02-01", omDateSource: "pdf" });
  });
  it("reads a full cover date", () => {
    expect(findOmDate({ sourceText: "OFFERING MEMORANDUM  March 3, 2026  Exclusively listed" }, now)).toEqual({ omDate: "2026-03-03", omDateSource: "pdf" });
  });
  it("falls back to the file name ('… OM (Oct-25)')", () => {
    expect(findOmDate({ sourceText: "VESTAVIA HILLS CITY CENTER  Exclusively offered by JLL", fileName: "JLL - Vestavia Hills City Center - OM (Oct-25)" }, now))
      .toEqual({ omDate: "2025-10-01", omDateSource: "file-name" });
  });
  it("falls back to the upload date, labelled as such", () => {
    expect(findOmDate({ sourceText: "TOWNSHIP PLAZA Coconut Creek", fileName: "Township-Plaza-OM", uploadedAt: "2026-10-15T16:11:25Z" }, now))
      .toEqual({ omDate: "2026-10-15", omDateSource: "upload-date" });
  });
  it("ignores a date deep in the document (lease expirations etc.)", () => {
    const text = "SUNSET PLAZA OM ".padEnd(1600, " ") + "Lease expires March 2031";
    expect(findOmDate({ sourceText: text, uploadedAt: "2026-06-01T00:00:00Z" }, now)?.omDateSource).toBe("upload-date");
  });
  it("rejects implausible dates (far future, ancient)", () => {
    expect(findOmDate({ sourceText: "Projection through December 2036", uploadedAt: "2026-01-02" }, now)?.omDateSource).toBe("upload-date");
    expect(findOmDate({ sourceText: "Built 1987", fileName: "x" }, now)).toBeNull();
  });
});

describe("hand-added records", () => {
  it("get no OM date (no document to date)", () => {
    expect(findOmDate({ uploadedAt: "2026-10-17T00:00:00Z" }, now)).toBeNull();
  });
});
