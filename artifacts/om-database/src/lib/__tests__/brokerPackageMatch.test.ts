import { describe, it, expect } from "vitest";
import { nameFromFileName, matchDeal, hasPossibleMatch } from "../docClassify";
import type { Deal } from "../idb";

// Newmark ships a deal as several files, and the supporting ones never print the
// property name. These are the real file names from the Lake Brandon Village and
// Frederick County Square uploads that forked into separate deals.
describe("nameFromFileName", () => {
  it.each([
    ["NMRK - Lake Brandon Village - Financial Narrative.pdf", "Lake Brandon Village"],
    ["NMRK - Lake Brandon Village - Detailed Tenant Underwriting.pdf", "Lake Brandon Village"],
    ["NMRK - Lake Brandon Village - Additional Info 1 (1).pdf", "Lake Brandon Village"],
    ["NMRK - Lake Brandon Village - OM.pdf", "Lake Brandon Village"],
    ["Frederick_County_Square_-_NMRK_OM.pdf", "Frederick County Square"],
    ["Frederick_Country_Square_-_Financial_Narrative_NMRK.pdf", "Frederick Country Square"],
    ["Frederick_County_Square_-_Detailed_Tenant_Underwriting_NMRK.pdf", "Frederick County Square"],
    ["Haymarket Village Center Rent Roll 10.12.26.xlsx", "Haymarket Village Center"],
  ])("%s → %s", (file, want) => {
    expect(nameFromFileName(file)).toBe(want);
  });

  it("keeps words that are part of a real center name", () => {
    expect(nameFromFileName("Market Square Shopping Center.pdf")).toBe("Market Square Shopping Center");
    expect(nameFromFileName("Plaza Financial Center - OM.pdf")).toBe("Plaza Financial Center");
  });

  it("returns null when only broker / document labels remain", () => {
    expect(nameFromFileName("NMRK - Financial Narrative.pdf")).toBeNull();
    expect(nameFromFileName("OM (1).pdf")).toBeNull();
    expect(nameFromFileName("")).toBeNull();
    expect(nameFromFileName(null)).toBeNull();
  });
});

const deal = (p: Partial<Deal>): Deal => ({ id: Math.random().toString(36).slice(2), ...p } as Deal);

describe("matchDeal — nameless pieces of a broker package", () => {
  const om = deal({ propertyName: "Lake Brandon Village", address: "11202 - 11381 Causeway Blvd", fileName: "NMRK - Lake Brandon Village - OM" });

  it("a nameless supporting file matches the OM by its file name", () => {
    const m = matchDeal({ propertyName: null, address: null, fileName: "NMRK - Lake Brandon Village - Financial Narrative.pdf" }, [om]);
    expect(m.deal?.id).toBe(om.id);
    expect(m.confidence).not.toBe("none");
  });

  it("the OM finds a nameless supporting file that landed first", () => {
    const stub = deal({ propertyName: undefined, fileName: "NMRK - Lake Brandon Village - Detailed Tenant Underwriting" });
    const m = matchDeal({ propertyName: "Lake Brandon Village", address: "11202 - 11381 Causeway Blvd", fileName: "NMRK - Lake Brandon Village - OM.pdf" }, [stub]);
    expect(m.deal?.id).toBe(stub.id);
  });

  it("does not match a different property", () => {
    const other = deal({ propertyName: "Lake Wales Village", fileName: "Lake Wales Village OM" });
    const m = matchDeal({ propertyName: null, fileName: "NMRK - Lake Brandon Village - Financial Narrative.pdf" }, [other]);
    expect(m.deal).toBeNull();
    // ...but it is a near-miss worth asking about, never a silent new deal
    expect(hasPossibleMatch({ propertyName: null, fileName: "NMRK - Lake Brandon Village - Financial Narrative.pdf" }, [other])).toBe(true);
  });

  it("a document's own stated name still wins over its file name", () => {
    const a = deal({ propertyName: "Cross County Plaza" });
    const m = matchDeal({ propertyName: "Cross County Plaza", fileName: "NMRK - Lake Brandon Village - Financial Narrative.pdf" }, [om, a]);
    expect(m.deal?.id).toBe(a.id);
  });
});
