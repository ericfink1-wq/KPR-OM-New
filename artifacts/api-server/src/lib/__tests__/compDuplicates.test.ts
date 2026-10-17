import { describe, it, expect } from "vitest";
import { planCompMerges, sameTrade, isResale, fillFrom, type CompLike } from "../compDuplicates";

const c = (o: Partial<CompLike> & { id: number }): CompLike => ({ name: null, address: null, state: null, saleDate: null, salePrice: null, sf: null, capRate: null, isManual: true, isOwnTransaction: false, ...o });

describe("sale-comp duplicates (10/17/26)", () => {
  it("merges the same trade entered twice (Nashville West, 14 days apart, same price)", () => {
    const a = c({ id: 1, name: "Nashville West", state: "TN", saleDate: "2026-02-15", salePrice: 88_000_000, sf: 324000, capRate: 5.9 });
    const b = c({ id: 2, name: "Nashville West", state: "TN", saleDate: "2026-02-01", salePrice: 88_000_000, sf: 324000, capRate: 6 });
    const plan = planCompMerges([a, b]);
    expect(plan).toHaveLength(1);
    expect(plan[0].keep.id).toBe(1); expect(plan[0].remove.map(r => r.id)).toEqual([2]);
  });
  it("keeps a resale (same property, different sale dates) as its own comp", () => {
    const a = c({ id: 1, name: "Bolton Plaza", state: "FL", saleDate: "2019-08-01", salePrice: 18_050_000 });
    const b = c({ id: 2, name: "Bolton Plaza", state: "FL", saleDate: "2026-04-21", salePrice: 22_875_000 });
    expect(isResale(a, b)).toBe(true);
    expect(planCompMerges([a, b])).toEqual([]);
  });
  it("never merges two of KPR's own trades", () => {
    const a = c({ id: 1, name: "X", saleDate: "2026-01-01", salePrice: 1e7, isManual: false, isOwnTransaction: true });
    const b = c({ id: 2, name: "X", saleDate: "2026-01-02", salePrice: 1e7, isManual: false, isOwnTransaction: true });
    expect(sameTrade(a, b)).toBe(false);
  });
  it("different portfolios with one name, different state/price, stay apart (AmCap)", () => {
    const a = c({ id: 1, name: "The AmCap Grocery Portfolio", state: "CT", saleDate: "2025-08-27", salePrice: 54_250_000 });
    const b = c({ id: 2, name: "The AmCap Grocery Portfolio", state: "IL", saleDate: "2025-05-15", salePrice: 61_850_000 });
    expect(planCompMerges([a, b])).toEqual([]);
  });
  it("same date but a materially different price is left for a person", () => {
    expect(sameTrade(c({ id: 1, name: "Y", saleDate: "2025-01-01", salePrice: 1e7 }), c({ id: 2, name: "Y", saleDate: "2025-01-05", salePrice: 1.2e7 }))).toBe(false);
  });
  it("undated copies need the price to agree", () => {
    expect(sameTrade(c({ id: 1, name: "Z", salePrice: 1e7 }), c({ id: 2, name: "Z", salePrice: 1.004e7 }))).toBe(true);
    expect(sameTrade(c({ id: 1, name: "Z" }), c({ id: 2, name: "Z" }))).toBe(false);
  });
  it("keeps KPR's own trade over a broker copy, and the broker copy is removed", () => {
    const own = c({ id: 5, name: "Pompano Marketplace", state: "FL", saleDate: "2026-07-28", salePrice: 53e6, isManual: false, isOwnTransaction: true });
    const brk = c({ id: 9, name: "Pompano Marketplace", state: "FL", saleDate: "2026-07-28", salePrice: 53e6, capRate: 5.6 });
    const plan = planCompMerges([brk, own]);
    expect(plan[0].keep.id).toBe(5); expect(plan[0].remove.map(r => r.id)).toEqual([9]);
  });
  it("a chain of near-matches can't pull in a different trade", () => {
    const a = c({ id: 1, name: "Q", saleDate: "2025-01-01", salePrice: 1e7, address: "1 Main" });
    const b = c({ id: 2, name: "Q", saleDate: "2025-01-20", salePrice: 1e7 });
    const d = c({ id: 3, name: "Q", saleDate: "2025-02-15", salePrice: 1e7 });   // 45 days from a, 26 from b
    const plan = planCompMerges([a, b, d]);
    const keep = plan[0].keep;
    for (const r of plan[0].remove) expect(sameTrade(keep, r)).toBe(true);
  });
  it("fills the keeper's blanks from the copies", () => {
    expect(fillFrom(c({ id: 1, name: "N", capRate: null }), [c({ id: 2, name: "N", capRate: 6.1, address: "9 Elm" })])).toEqual({ capRate: 6.1, address: "9 Elm" });
  });
});
