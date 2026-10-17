import { describe, it, expect } from "vitest";
import { matchDeal, locationConflict } from "../docClassify";
import { detectPackageRole } from "../packageMerge";
import { replaceWithUpload } from "../../components/UploadQueue";
import type { Deal } from "../idb";

const deal = (p: Partial<Deal>): Deal => ({ id: Math.random().toString(36).slice(2), fileName: "x.pdf", uploadedAt: "2026-01-01", ...p } as Deal);

describe("matchDeal — zip / state guard (Eric, 10/16/26)", () => {
  const ga = deal({ propertyName: "Crossroads Plaza", address: "100 Main St, Atlanta, GA 30301", state: "GA" });
  it("same name, different state → not the same property", () => {
    expect(matchDeal({ propertyName: "Crossroads Plaza", state: "NC" }, [ga]).deal).toBeNull();
  });
  it("same name, different zip → not the same property", () => {
    expect(matchDeal({ propertyName: "Crossroads Plaza", address: "9 Elm Rd, Atlanta, GA 30309" }, [ga]).deal).toBeNull();
  });
  it("same name and a missing state/zip still matches", () => {
    expect(matchDeal({ propertyName: "Crossroads Plaza" }, [ga]).deal?.id).toBe(ga.id);
  });
  it("a street number is never read as a zip", () => {
    expect(locationConflict({ address: "12345 Main St" }, { address: "100 Main St, Atlanta, GA 30301", state: "GA", zip: null } as Deal)).toBe(false);
  });
  it("matching zips don't conflict", () => {
    expect(locationConflict({ address: "1 A St, Atlanta, GA 30301-1234" }, { address: null, state: null, zip: "30301" } as unknown as Deal)).toBe(false);
  });
});

describe("site plans are supporting files, not OMs", () => {
  it("Blue Bell Site Plan OM- Revised → other", () => expect(detectPackageRole("Blue Bell Site Plan OM- Revised.pdf")).toBe("other"));
  it("a plain OM stays an OM", () => expect(detectPackageRole("Blue Bell Plaza - OM.pdf")).toBe("om"));
});

describe("replaceWithUpload", () => {
  const existing = deal({
    propertyName: "Pentagon Centre", status: "Owned", txnPurchasePrice: 50_000_000, userNotes: "keep me",
    noi: 1_000_000, capRate: 6, tenants: [{ name: "Ross", sf: 30000 } as Deal["tenants"][number]],
  });
  it("file values win, KPR's own fields and missing pieces are kept", () => {
    const out = replaceWithUpload(existing, { id: "temp", propertyName: "Pentagon Centre", noi: 1_200_000, capRate: null, status: "Prospect", tenants: [] });
    expect(out.id).toBe(existing.id);
    expect(out.noi).toBe(1_200_000);
    expect(out.capRate).toBe(6);                    // the file didn't carry one
    expect(out.status).toBe("Owned");
    expect(out.txnPurchasePrice).toBe(50_000_000);
    expect(out.userNotes).toBe("keep me");
    expect(out.tenants).toHaveLength(1);           // an empty roster never wipes the roster
  });
  it("a hand-pasted roster survives a replace", () => {
    const manual = { ...existing, tenantsManual: true } as Deal;
    const out = replaceWithUpload(manual, { tenants: [{ name: "Other", sf: 1 }] });
    expect(out.tenants?.[0]?.name).toBe("Ross");
  });
});
