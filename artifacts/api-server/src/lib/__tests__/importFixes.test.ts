import { describe, it, expect } from "vitest";
import { applyImportFixes, deriveRents } from "../importFixes";

describe("applyImportFixes (auto-clean at import)", () => {
  it("normalizes a fraction occupancy cost to a percent", () => {
    const r = applyImportFixes({ tenants: [{ name: "Pet Supplies Plus", sf: 6400, occupancyCost: 0.225, annualRent: 132032 }] });
    expect((r.deal.tenants as any)[0].occupancyCost).toBe(22.5);
    expect(r.occCostFixed).toBe(1);
  });
  it("dedupes a duplicate tenant row, keeping the later lease expiry", () => {
    const r = applyImportFixes({ totalSF: 100000, tenants: [
      { name: "Planet Fitness", suite: "015", sf: 20000, leaseExpiry: "2026-02-28", annualRent: 300000 },
      { name: "Planet Fitness", suite: "015", sf: 20000, leaseExpiry: "2036-02-28", annualRent: 300000 },
    ] });
    expect((r.deal.tenants as any).length).toBe(1);
    expect((r.deal.tenants as any)[0].leaseExpiry).toBe("2036-02-28");
    expect(r.dupeFixed).toBe(1);
  });
  it("does NOT merge two different spaces of one chain (SF too different)", () => {
    const r = applyImportFixes({ tenants: [
      { name: "White House Interiors", sf: 1000, leaseExpiry: "2029-09-30", annualRent: 30000 },
      { name: "White House Interiors", sf: 18000, leaseExpiry: "2029-09-30", annualRent: 200000 },
    ] });
    expect((r.deal.tenants as any).length).toBe(2);
  });
  it("recomputes occupancy from the roster", () => {
    const r = applyImportFixes({ totalSF: 100000, occupancy: 0, tenants: [{ name: "Anchor", sf: 92000, annualRent: 500000, leaseExpiry: "2032-01-01" }] });
    expect(r.deal.occupancy).toBe(92);
  });
  it("leaves a clean deal untouched", () => {
    const r = applyImportFixes({ totalSF: 100000, occupancy: 92, tenants: [{ name: "Anchor", sf: 92000, rentPerSF: 5.43, annualRent: 500000, leaseExpiry: "2031-09-13" }] });
    expect(r.occCostFixed).toBe(0);
    expect(r.dupeFixed).toBe(0);
    expect((r.deal.tenants as any).length).toBe(1);
  });
});

describe("deriveRents — gated blank base-rent fill (never assumes on shaky data)", () => {
  // A deal whose rates reconcile exactly: PSF is confirmed BASE, so blank annual rents
  // are safely derived from PSF × SF (and a blank PSF from annual ÷ SF).
  const confirmedBase = [
    { name: "A", sf: 10000, rentPerSF: 20, annualRent: 200000 },
    { name: "B", sf: 5000, rentPerSF: 30, annualRent: 150000 },
    { name: "C", sf: 8000, rentPerSF: 25, annualRent: 200000 },
    { name: "Ulta", sf: 10002, rentPerSF: 25 },            // blank annualRent → derive
    { name: "Eyebrow Bar", sf: 1200, annualRent: 36000 },  // blank rentPerSF → derive
  ];
  it("fills the blank annual rent and PSF when the deal's rates are confirmed base", () => {
    const { tenants, filled } = deriveRents(confirmedBase as any);
    expect(filled).toBe(2);
    expect((tenants[3] as any).annualRent).toBe(250050);   // 25 × 10,002
    expect((tenants[4] as any).rentPerSF).toBe(30);        // 36,000 ÷ 1,200
  });
  it("REFUSES to fill when the rates don't reconcile (PSF may be a gross/CAM rate)", () => {
    // Every tenant's PSF is inflated vs its annual (gross-rate roll) — not base.
    const grossRoll = [
      { name: "A", sf: 10000, rentPerSF: 32, annualRent: 200000 }, // 32×10k=320k ≠ 200k
      { name: "B", sf: 5000, rentPerSF: 48, annualRent: 150000 },
      { name: "C", sf: 8000, rentPerSF: 40, annualRent: 200000 },
      { name: "Mystery", sf: 4000, rentPerSF: 45 },                // blank annual — must STAY blank
    ];
    const { tenants, filled } = deriveRents(grossRoll as any);
    expect(filled).toBe(0);
    expect((tenants[3] as any).annualRent).toBeUndefined();
  });
  it("REFUSES to fill with too small a sample to confirm the rate basis", () => {
    const tiny = [
      { name: "A", sf: 10000, rentPerSF: 20, annualRent: 200000 },
      { name: "Blank", sf: 3000, rentPerSF: 25 },   // only 1 reconciling sample → no fill
    ];
    const { filled } = deriveRents(tiny as any);
    expect(filled).toBe(0);
  });
});
