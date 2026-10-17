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

describe("OM date — labelled dates past the cover (Eric, 10/17/26)", () => {
  const filler = "TOWNSHIP PLAZA  Coconut Creek, FL  Exclusively offered ".padEnd(1600, " ");
  it("reads the rent roll's 'as of' date", () => {
    expect(findOmDate({ sourceText: filler + " RENT ROLL as of October 1, 2026  Suite 101 Lease expires March 2031", uploadedAt: "2026-10-15T16:11:25Z" }, now))
      .toEqual({ omDate: "2026-10-01", omDateSource: "pdf" });
  });
  it("reads a footer 'dated' / 'as of 9/30/2026'", () => {
    expect(findOmDate({ sourceText: filler + " Information as of 9/30/2026. Lease to 12/31/2032.", uploadedAt: "2026-10-15" }, now)?.omDate).toBe("2026-09-30");
  });
  it("never takes the forward-dated assumed closing ('as of January 1, 2027')", () => {
    expect(findOmDate({ sourceText: filler + " In-Place NOI as of January 1, 2027", uploadedAt: "2026-10-15" }, now)?.omDateSource).toBe("upload-date");
  });
  it("prefers the best-supported date when several are labelled", () => {
    const t = filler + " Rent Roll as of August 1, 2026 … as of August 1, 2026 … as of June 30, 2026";
    expect(findOmDate({ sourceText: t, uploadedAt: "2026-09-01" }, now)?.omDate).toBe("2026-08-01");
  });
  it("still ignores an unlabelled date deep in the text", () => {
    expect(findOmDate({ sourceText: filler + " Kohl's lease commenced March 2019", uploadedAt: "2026-09-01" }, now)?.omDateSource).toBe("upload-date");
  });
});
