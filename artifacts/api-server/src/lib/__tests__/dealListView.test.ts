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
