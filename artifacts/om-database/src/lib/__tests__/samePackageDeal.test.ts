import { describe, it, expect } from "vitest";
import { samePackageDeal, nameFromFileName } from "../docClassify";
import { detectPackageRole, PACKAGE_WINDOW_DAYS } from "../packageMerge";
import { nameFromFileName as serverNameFromFileName } from "../../../../api-server/src/lib/fileNameProperty";
import type { Deal } from "../idb";

// The live case (10/20/26): "NMRK - The Waterfront - OM" was saved as "The Waterfront" with a
// package started 2026-10-20T20:48:38.787Z; two reads of "NMRK - The Waterfront - Financial
// Narrative" then forked into their own "Waterfront" records instead of attaching.
const waterfront = {
  id: "1792528912560-8mbe0d3", propertyName: "The Waterfront", state: "PA",
  fileName: "NMRK - The Waterfront - OM",
  packageSources: { roster: "om", property: "om", financials: "om", startedAt: "2026-10-20T20:48:38.787Z" },
} as unknown as Deal;
const NARRATIVE = "NMRK - The Waterfront - Financial Narrative.pdf";
const at = (iso: string) => Date.parse(iso);

describe("samePackageDeal — The Waterfront ×3", () => {
  it("the Financial Narrative is a non-OM piece of the package", () => {
    expect(detectPackageRole(NARRATIVE)).toBe("financials");
    expect(nameFromFileName(NARRATIVE)).toBe("The Waterfront");
  });
  it("matches the deal its OM started, minutes later", () => {
    expect(samePackageDeal(NARRATIVE, waterfront, at("2026-10-20T20:57:00Z"))).toBe(true);
    expect(samePackageDeal("NMRK - The Waterfront - Detailed Tenant Underwriting.pdf", waterfront, at("2026-10-21T09:00:00Z"))).toBe(true);
  });
  it("ignores a leading 'The' on either side", () => {
    const bare = { ...waterfront, propertyName: "Waterfront" } as Deal;
    expect(samePackageDeal(NARRATIVE, bare, at("2026-10-21T00:00:00Z"))).toBe(true);
    expect(samePackageDeal("NMRK - Waterfront - Financial Narrative.pdf", waterfront, at("2026-10-21T00:00:00Z"))).toBe(true);
  });
  it("not once the package window has passed", () => {
    const later = at("2026-10-20T20:48:38.787Z") + (PACKAGE_WINDOW_DAYS + 1) * 86_400_000;
    expect(samePackageDeal(NARRATIVE, waterfront, later)).toBe(false);
  });
  it("not for a deal with no package start (legacy / hand-added), or a trashed one", () => {
    expect(samePackageDeal(NARRATIVE, { ...waterfront, packageSources: null } as Deal, at("2026-10-21T00:00:00Z"))).toBe(false);
    expect(samePackageDeal(NARRATIVE, { ...waterfront, trashedAt: "2026-10-21T00:00:00Z" } as Deal, at("2026-10-21T00:00:00Z"))).toBe(false);
  });
  it("names must be equal, not merely overlapping", () => {
    expect(samePackageDeal("NMRK - Waterfront Town Center - Financial Narrative.pdf", waterfront, at("2026-10-21T00:00:00Z"))).toBe(false);
    expect(samePackageDeal("NMRK - Waterworks - Financial Narrative.pdf", waterfront, at("2026-10-21T00:00:00Z"))).toBe(false);
    expect(samePackageDeal("Financial Narrative.pdf", waterfront, at("2026-10-21T00:00:00Z"))).toBe(false);
  });
});

describe("nameFromFileName — the server copy (unsaved-upload sweep) reads file names the same way", () => {
  it.each([
    "NMRK - The Waterfront - Financial Narrative",
    "NMRK - The Waterfront - OM",
    "NMRK - Lake Brandon Village - Detailed Tenant Underwriting.pdf",
    "Frederick_County_Square_-_NMRK_OM.pdf",
    "Frederick_Country_Square_-_Financial_Narrative_NMRK.pdf",
    "JLL - Vestavia Hills City Center - OM (Oct-25)",
    "Pentagon Centre - Parking Proforma 7.31.26.pdf",
    "Latham Farms OM 2026",
    "Financial Narrative.pdf",
    "",
  ])("%s", (f) => {
    expect(serverNameFromFileName(f)).toBe(nameFromFileName(f));
  });
});
