import { describe, it, expect } from "vitest";
import { toListView, restoreOmittedDetail, LIST_OMIT_KEYS } from "../dealListView";

const full = { propertyName: "X", tenants: [{ name: "A" }], cashFlowProjection: [{ noi: 1 }], leaseRisk: { tenants: [] },
  fieldCitations: { noi: "p.7" }, propertyHistory: [{ id: "h" }], taxParcels: [{ parcelId: "1" }] };

describe("deal list view (10/17/26: GET /deals was 18 MB)", () => {
  it("drops only deal-page blocks and marks the copy", () => {
    const v = toListView(full);
    for (const k of LIST_OMIT_KEYS) expect(v).not.toHaveProperty(k);
    expect(v.tenants).toEqual(full.tenants);                 // library-wide views need the roster
    expect(v.cashFlowProjection).toEqual(full.cashFlowProjection);
    expect(v.leaseRisk).toEqual(full.leaseRisk);             // co-tenancy cascade reads it
    expect(v._summary).toBe(true);
  });
  it("a deal with nothing to drop is not marked", () => {
    expect(toListView({ propertyName: "Y" })._summary).toBeUndefined();
  });
  it("saving a list copy never wipes the dropped blocks", () => {
    const inc: Record<string, unknown> = { ...toListView(full), notes: "edited" };
    const restored = restoreOmittedDetail(full, inc);
    expect(inc.fieldCitations).toEqual(full.fieldCitations);
    expect(inc.propertyHistory).toEqual(full.propertyHistory);
    expect(inc.notes).toBe("edited");
    expect(inc._summary).toBeUndefined();
    expect(restored.sort()).toEqual(["fieldCitations", "propertyHistory", "taxParcels"]);
  });
  it("a full-record save is left alone (a deliberate removal sticks)", () => {
    const inc: Record<string, unknown> = { propertyName: "X" };
    expect(restoreOmittedDetail(full, inc)).toEqual([]);
    expect(inc).not.toHaveProperty("fieldCitations");
  });
  it("a value the list copy DID carry wins over the stored one", () => {
    const inc: Record<string, unknown> = { _summary: true, taxParcels: [{ parcelId: "2" }] };
    restoreOmittedDetail(full, inc);
    expect(inc.taxParcels).toEqual([{ parcelId: "2" }]);
  });
});

describe("list view — tenant rows without null fields", () => {
  // Shape of a real J.A.N.A.F. row (10/17/26): ~20 of 44 fields null.
  const row = { name: "Goodwill", sf: 16211, rentPerSF: 12.25, annualRent: 198585, isAnchor: false, percentageRent: 0,
    salesPSF: null, camCapPct: null, otherRent: null, salesNotes: null, creditRating: null, occupancyCost: null,
    parentCompany: null, priorSalesPSF: null, percentageRentRate: null, remainingTermYears: null, screens: null,
    assumptionNote: "Ground lease section of center.", rentSchedule: "2030-04-01: $13.48 PSF" };

  it("drops only nulls — zeros, false and text survive", () => {
    const out = toListView({ tenants: [row] }).tenants as Array<Record<string, unknown>>;
    expect(out[0]).toEqual({ name: "Goodwill", sf: 16211, rentPerSF: 12.25, annualRent: 198585, isAnchor: false, percentageRent: 0,
      assumptionNote: "Ground lease section of center.", rentSchedule: "2030-04-01: $13.48 PSF" });
    for (const [k, v] of Object.entries(row)) if (v !== null) expect(out[0][k]).toEqual(v);
  });

  it("never changes the stored record it was built from", () => {
    const stored = { tenants: [{ ...row }] };
    toListView(stored);
    expect(stored.tenants[0]).toEqual(row);
  });

  it("cuts the row size materially", () => {
    const before = JSON.stringify(row).length;
    const after = JSON.stringify((toListView({ tenants: [row] }).tenants as unknown[])[0]).length;
    expect(after).toBeLessThan(before * 0.75);
  });
});
