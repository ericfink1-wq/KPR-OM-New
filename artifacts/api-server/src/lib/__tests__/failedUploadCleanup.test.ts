import { describe, it, expect } from "vitest";
import { planFailedUploadCleanup, normName } from "../failedUploadCleanup";

const old = new Date(Date.now() - 86400_000);
const row = (id: string, data: Record<string, unknown>) => ({ id, data, updatedAt: old });

describe("failed-upload leftovers", () => {
  it("normalizes a file name to a property key", () => {
    expect(normName("Pentagon Centre - Parking Proforma 7.31.26.pdf")).toBe("pentagon centre parking");
  });
  it("merges a leftover into its live twin, filling only blanks, then trashes it", () => {
    const plan = planFailedUploadCleanup([
      row("good", { propertyName: "University Hills", state: "CO", status: "Prospect", tenants: [{}], acqCapRate: 6.9 }),
      row("stub", { _processingError: "x", fileName: "University Hills OM.pdf", status: "Owned", acqCapRate: 7.1, txnPurchasePrice: 5e7 }),
    ]);
    expect(plan).toEqual([{ kind: "merge", id: "stub", into: "good", filled: ["txnPurchasePrice"], statusFrom: "Prospect", statusTo: "Owned" }]);
  });
  it("matches a related file to its property ('Pentagon Centre Parking' → Pentagon Centre)", () => {
    const plan = planFailedUploadCleanup([
      row("pc", { propertyName: "Pentagon Centre", status: "Under Contract" }),
      ...[1, 2, 3, 4].map(i => row(`p${i}`, { _processingError: "x", fileName: "Pentagon Centre Parking.pdf", status: "Prospect" })),
    ]);
    expect(plan.map(a => a.kind)).toEqual(["merge", "merge", "merge", "merge"]);
  });
  it("trashes a blank leftover with no data; keeps one holding user data with no twin", () => {
    const plan = planFailedUploadCleanup([
      row("blank", { _processingError: "x", fileName: "Unknown", status: "Prospect" }),
      row("owned", { _processingError: "x", fileName: "Mystery.pdf", status: "Owned", acqCapRate: 7 }),
    ]);
    expect(plan).toEqual([{ kind: "trash-empty", id: "blank" }, { kind: "keep", id: "owned", why: "holds user data and no matching deal" }]);
  });
  it("never matches on a single generic word, and never touches live or trashed deals", () => {
    const plan = planFailedUploadCleanup([
      row("a", { propertyName: "Plaza", status: "Owned" }),
      row("t", { propertyName: "Plaza", trashedAt: "x", _processingError: "x" }),
      row("s", { _processingError: "x", fileName: "Plaza Shops.pdf", status: "Prospect" }),
    ]);
    expect(plan).toEqual([{ kind: "trash-empty", id: "s" }]);
  });
  it("un-sticks a deal left 'processing' for hours that still has its data", () => {
    expect(planFailedUploadCleanup([row("x", { _processing: true, propertyName: "X Center", tenants: [{}] })])).toEqual([{ kind: "unstick", id: "x" }]);
  });
});
