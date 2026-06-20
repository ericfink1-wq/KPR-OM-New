import { describe, it, expect } from "vitest";
import { computePortfolioCalibration, isOwnedClosedDeal } from "../calibration";

// Ground-truth calibration (#1): learn the OM-vs-realized bias from owned deals.

describe("isOwnedClosedDeal", () => {
  it("detects owned deals and excludes trashed ones", () => {
    expect(isOwnedClosedDeal({ isOwnTransaction: true })).toBe(true);
    expect(isOwnedClosedDeal({ acqNOIAtClose: 900000 })).toBe(true);
    expect(isOwnedClosedDeal({ status: "Owned", trashedAt: "2026-01-01" })).toBe(false);
    expect(isOwnedClosedDeal({ propertyName: "OM only" })).toBe(false);
  });
});

describe("computePortfolioCalibration", () => {
  it("learns that OM NOI runs optimistic when realized NOI is consistently lower", () => {
    // 5 owned deals where OM NOI is ~10% above realized close NOI.
    const owned = Array.from({ length: 5 }, (_, i) => ({
      isOwnTransaction: true, propertyName: `Owned ${i}`,
      noi: 1100000, acqNOIAtClose: 1000000,
    }));
    const cal = computePortfolioCalibration(owned);
    const noi = cal.biases.find((b) => b.metric === "noi");
    expect(noi).toBeDefined();
    expect(noi!.direction).toBe("optimistic");
    expect(noi!.medianBiasPct).toBeCloseTo(10, 0);
    expect(cal.guidance).toContain("NOI");
  });

  it("flags OM cap rates as optimistic when realized going-in cap is wider (higher)", () => {
    const owned = Array.from({ length: 4 }, (_, i) => ({
      isOwnTransaction: true, propertyName: `C${i}`,
      capRate: 6.0, acqCapRate: 6.6, // OM tighter than realized → optimistic
    }));
    const cal = computePortfolioCalibration(owned);
    const cap = cal.biases.find((b) => b.metric === "capRate");
    expect(cap?.direction).toBe("optimistic");
  });

  it("stays silent (no guidance) below the minimum owned-deal sample", () => {
    const owned = [
      { isOwnTransaction: true, noi: 1100000, acqNOIAtClose: 1000000 },
      { isOwnTransaction: true, noi: 1200000, acqNOIAtClose: 1000000 },
    ];
    const cal = computePortfolioCalibration(owned);
    expect(cal.biases.length).toBe(0);
    expect(cal.guidance).toBe("");
  });

  it("ignores unit-slip pairs that differ by more than 3x", () => {
    const owned = Array.from({ length: 4 }, (_, i) => ({
      isOwnTransaction: true, noi: 1050000, acqNOIAtClose: 1000000,
    }));
    owned.push({ isOwnTransaction: true, noi: 5000000, acqNOIAtClose: 1000 } as never); // junk
    const cal = computePortfolioCalibration(owned);
    const noi = cal.biases.find((b) => b.metric === "noi");
    expect(noi!.n).toBe(4); // the 5000x outlier dropped
    expect(noi!.medianBiasPct).toBeCloseTo(5, 0);
  });
});
