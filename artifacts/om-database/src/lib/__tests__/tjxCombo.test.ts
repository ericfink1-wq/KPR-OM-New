import { describe, it, expect } from "vitest";
import { detectTjxCombo, tjxComboRead, isTjxCombo } from "../tjxCombo";

describe("detectTjxCombo (explicit two-banner names)", () => {
  it("recognizes Marshalls / HomeGoods as a combo", () => {
    const r = detectTjxCombo("Marshalls / HomeGoods");
    expect(r.isCombo).toBe(true);
    expect(r.banners.sort()).toEqual(["HomeGoods", "Marshalls"]);
    expect(r.label).toContain("Marshalls");
    expect(r.label).toContain("HomeGoods");
  });

  it("recognizes various separators and spellings", () => {
    expect(detectTjxCombo("Marshalls HomeGoods").isCombo).toBe(true);
    expect(detectTjxCombo("Marshalls & Home Goods").isCombo).toBe(true);
    expect(detectTjxCombo("T.J. Maxx / HomeGoods").isCombo).toBe(true);
    expect(detectTjxCombo("TJ Maxx HomeGoods").isCombo).toBe(true);
  });

  it("does NOT call a single banner a combo", () => {
    expect(detectTjxCombo("Marshalls").isCombo).toBe(false);
    expect(detectTjxCombo("Marshalls of MA, Inc.").isCombo).toBe(false);
    expect(detectTjxCombo("HomeGoods").isCombo).toBe(false);
  });

  it("does not treat a bare 'Sierra' as TJX (ambiguous alone)", () => {
    const r = detectTjxCombo("Sierra");
    expect(r.isCombo).toBe(false);
    expect(r.isTjx).toBe(false);
  });

  it("counts Sierra only inside a combo", () => {
    expect(detectTjxCombo("HomeGoods / Sierra").isCombo).toBe(true);
  });

  it("ignores unrelated tenants", () => {
    expect(detectTjxCombo("Dick's Sporting Goods").isCombo).toBe(false);
    expect(detectTjxCombo("Best Buy").isTjx).toBe(false);
  });
});

describe("tjxComboRead (by-size likely combo)", () => {
  it("flags a single-banner name on a combo-sized box as a likely combo", () => {
    const r = tjxComboRead("Marshalls of MA, Inc.", 55000);
    expect(r.isCombo).toBe(false);
    expect(r.likely).toBe(true);
    expect(r.isTjx).toBe(true);
    expect(r.note).toMatch(/combo/i);
  });

  it("does NOT flag a standalone-sized single banner", () => {
    const r = tjxComboRead("Marshalls", 30000);
    expect(r.likely).toBe(false);
    expect(r.isCombo).toBe(false);
  });

  it("returns the explicit combo even when sized (no double-processing)", () => {
    const r = tjxComboRead("Marshalls / HomeGoods", 60000);
    expect(r.isCombo).toBe(true);
    expect(r.likely).toBe(false);
  });

  it("does not size-flag a non-TJX big box", () => {
    expect(tjxComboRead("Best Buy", 55000).likely).toBe(false);
    expect(tjxComboRead("Dick's Sporting Goods", 55000).likely).toBe(false);
  });

  it("needs the SF to fire the by-size path", () => {
    expect(tjxComboRead("Marshalls").likely).toBe(false);
  });
});

describe("isTjxCombo", () => {
  it("true for explicit and likely combos, false otherwise", () => {
    expect(isTjxCombo("Marshalls / HomeGoods")).toBe(true);
    expect(isTjxCombo("Marshalls of MA, Inc.", 55000)).toBe(true);
    expect(isTjxCombo("Marshalls", 30000)).toBe(false);
    expect(isTjxCombo("Panera Bread", 5000)).toBe(false);
  });
});
