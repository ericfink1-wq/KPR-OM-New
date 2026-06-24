import { describe, it, expect } from "vitest";
import { isATM, isFuelPad, tenantFormat, brandBenchmarkKey } from "../utils";
import { buildBrandSizeIndex, flagTenantSize } from "../tenantSizeBenchmark";
import type { Deal } from "../idb";

// ATMs and fuel/gas pads are a chain's pad/kiosk formats — tiny footprints that must
// NOT skew the brand's full-store size / rent / sales medians, but stay viewable on
// their own. These guard the classifiers and the format-separated benchmark key.

describe("isFuelPad", () => {
  it("flags explicit fuel / gas pad names", () => {
    expect(isFuelPad("Giant Gasoline")).toBe(true);
    expect(isFuelPad("Sam's Club Fuel Center")).toBe(true);
    expect(isFuelPad("Kroger Fuel")).toBe(true);
    expect(isFuelPad("Costco Gas Station")).toBe(true);
    expect(isFuelPad("Wawa (Gas)")).toBe(true);
  });
  it("does NOT flag full-line stores or unrelated 'gas-' words", () => {
    expect(isFuelPad("Giant Food")).toBe(false);
    expect(isFuelPad("Kroger")).toBe(false);
    expect(isFuelPad("Gaslight Cafe")).toBe(false);
  });
});

describe("tenantFormat", () => {
  it("classifies ATMs, fuel pads, and standard stores", () => {
    expect(tenantFormat("Chase ATM", 120)).toBe("atm");
    expect(tenantFormat("Giant Gasoline", 0)).toBe("fuelpad");
    expect(tenantFormat("Giant Food", 62000)).toBe("standard");
    // a bank-named kiosk footprint reads as an ATM even without the word
    expect(tenantFormat("Wells Fargo Bank", 150)).toBe("atm");
    expect(isATM("Wells Fargo Bank", 150)).toBe(true);
  });
});

describe("brandBenchmarkKey separates formats", () => {
  it("gives a brand's ATM / fuel pad / store distinct keys", () => {
    const store = brandBenchmarkKey("Giant Food", 62000);
    const fuel = brandBenchmarkKey("Giant Gasoline", 0);
    const atm = brandBenchmarkKey("Giant ATM", 100);
    expect(store).not.toBe(fuel);
    expect(store).not.toBe(atm);
    expect(fuel).not.toBe(atm);
  });
});

const mk = (id: string, tenants: { name: string; sf: number | null }[]): Deal =>
  ({ id, tenants: tenants.map((t) => ({ name: t.name, sf: t.sf, annualRent: (t.sf ?? 1) * 15, leaseExpiry: "2030-01-01" })) } as unknown as Deal);

describe("size benchmark does not pool ATMs with full branches", () => {
  // Four full Chase branches at ~4,000 SF + several 100-SF ATMs. Without format
  // separation the ATMs would crater the brand median and falsely flag the branches.
  const deals = [
    mk("d1", [{ name: "Chase Bank", sf: 4000 }, { name: "Chase Bank ATM", sf: 100 }]),
    mk("d2", [{ name: "Chase Bank", sf: 4100 }, { name: "Chase Bank ATM", sf: 110 }]),
    mk("d3", [{ name: "Chase Bank", sf: 3900 }, { name: "Chase Bank ATM", sf: 120 }]),
    mk("subject", [{ name: "Chase Bank", sf: 4050 }, { name: "Chase Bank ATM", sf: 105 }]),
  ];
  const idx = buildBrandSizeIndex(deals);
  it("does NOT flag a normal-size branch (ATMs are not in the branch pool)", () => {
    const f = flagTenantSize({ name: "Chase Bank", sf: 4050, annualRent: 60750, leaseExpiry: "2030-01-01" } as any, "subject", idx);
    expect(f).toBeNull();
  });
});
