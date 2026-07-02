import { describe, it, expect } from "vitest";
import {
  isCinema, parseScreensFromName, resolveScreens, salesPerScreen,
  tenantAnnualSales, cinemaSalesRead, fmtPerScreen,
} from "../theaterMetrics";
import type { Tenant } from "../idb";

describe("isCinema", () => {
  it("matches known chains and generic cinema words", () => {
    for (const n of ["Regal Cinemas", "AMC CLASSIC 12", "Cinemark 18", "Marcus Theatres", "Alamo Drafthouse", "Riverdale Cinema", "The Grand 14 Theatre"]) {
      expect(isCinema(n), n).toBe(true);
    }
  });
  it("does not match non-theater entertainment or ordinary retail", () => {
    for (const n of ["Main Event Bowling", "Dave & Buster's", "Ross Dress for Less", "Planet Fitness", ""]) {
      expect(isCinema(n), n).toBe(false);
    }
  });
});

describe("parseScreensFromName", () => {
  it("reads an explicit screen/plex count", () => {
    expect(parseScreensFromName("Downtown 16-plex")).toBe(16);
    expect(parseScreensFromName("The Grand 14 Theatre")).toBe(14);
    expect(parseScreensFromName("Megaplex 12 screens")).toBe(12);
  });
  it("reads a trailing count on a recognized cinema name", () => {
    expect(parseScreensFromName("Regal Trussville 14")).toBe(14);
    expect(parseScreensFromName("Cinemark 18")).toBe(18);
    expect(parseScreensFromName("AMC CLASSIC Bel Air 10")).toBe(10);
  });
  it("does not mistake a store number / year / non-cinema number for screens", () => {
    expect(parseScreensFromName("Regal built 2003")).toBeNull(); // 2003 out of range
    expect(parseScreensFromName("Store #3421")).toBeNull();
    expect(parseScreensFromName("Ross Dress for Less 5")).toBeNull(); // not a cinema
  });
});

describe("resolveScreens", () => {
  it("prefers the stated field over the name", () => {
    expect(resolveScreens({ name: "Cinemark 18", screens: 20 } as Tenant)).toEqual({ screens: 20, source: "stated", suspect: false });
  });
  it("falls back to the name when the field is absent", () => {
    expect(resolveScreens({ name: "Cinemark 18" } as Tenant)).toEqual({ screens: 18, source: "name", suspect: false });
  });
  it("returns null when unknown", () => {
    expect(resolveScreens({ name: "Some Cinema" } as Tenant)).toEqual({ screens: null, source: null, suspect: false });
  });
  it("flags an implausible stated count (>30) as suspect", () => {
    expect(resolveScreens({ name: "Regal 14", screens: 250 } as Tenant)).toEqual({ screens: 250, source: "stated", suspect: true });
    expect(resolveScreens({ name: "Regal 14", screens: 1 } as Tenant)).toEqual({ screens: 1, source: "stated", suspect: true });
  });
});

describe("salesPerScreen + cinemaSalesRead", () => {
  it("computes sales per screen from salesPSF × SF ÷ screens", () => {
    // 55,000 SF box, $130/SF → $7.15M sales; 14 screens → ~$510k/screen
    expect(salesPerScreen(tenantAnnualSales(130, 55000), 14)).toBeCloseTo(7_150_000 / 14, 0);
  });

  it("cinemaSalesRead: full read for a theater with a screen count", () => {
    const t: Tenant = { name: "Regal Trussville 14", sf: 55000, salesPSF: 130 };
    const r = cinemaSalesRead(t, 130);
    expect(r.isCinema).toBe(true);
    expect(r.screens).toBe(14);
    expect(r.screenSource).toBe("name");
    expect(r.perScreen).toBeCloseTo(7_150_000 / 14, 0);
  });

  it("cinemaSalesRead: theater with sales but no screens → perScreen null", () => {
    const r = cinemaSalesRead({ name: "Downtown Cinema", sf: 40000, salesPSF: 100 } as Tenant, 100);
    expect(r.isCinema).toBe(true);
    expect(r.screens).toBeNull();
    expect(r.perScreen).toBeNull();
  });

  it("cinemaSalesRead: non-theater → not a cinema, no per-screen", () => {
    const r = cinemaSalesRead({ name: "Ross", sf: 25000, salesPSF: 200 } as Tenant, 200);
    expect(r.isCinema).toBe(false);
    expect(r.perScreen).toBeNull();
  });

  it("cinemaSalesRead: an implausible screen count (>30) is SUSPECT and yields no per-screen", () => {
    const r = cinemaSalesRead({ name: "Regal Cinemas", sf: 55000, salesPSF: 130, screens: 250 } as Tenant, 130);
    expect(r.isCinema).toBe(true);
    expect(r.suspect).toBe(true);
    expect(r.perScreen).toBeNull();       // never computed from a bad count
    expect(r.needsScreens).toBe(true);    // prompts confirmation
  });

  it("cinemaSalesRead: a units-error sales figure yields no per-screen (guards against garbage)", () => {
    // Regal at $165,836/SF × 63,260 SF ÷ 14 screens ≈ $749M/screen — impossible.
    const r = cinemaSalesRead({ name: "Regal Cinemas 14", sf: 63260, salesPSF: 165836 } as Tenant, 165836);
    expect(r.perScreen).toBeNull();
    expect(r.suspect).toBe(true);
  });

  it("cinemaSalesRead: theater with sales but no screens → needsScreens", () => {
    const r = cinemaSalesRead({ name: "Downtown Cinema", sf: 40000, salesPSF: 100 } as Tenant, 100);
    expect(r.needsScreens).toBe(true);
    expect(r.suspect).toBe(false);
  });

  it("formats per-screen", () => {
    expect(fmtPerScreen(510000)).toBe("$510k/screen");
    expect(fmtPerScreen(1_250_000)).toBe("$1.25M/screen");
    expect(fmtPerScreen(null)).toBe("—");
  });
});
