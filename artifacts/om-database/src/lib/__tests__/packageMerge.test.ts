import { describe, it, expect } from "vitest";
import { detectPackageRole, planPackageMerge, initialPackageSources } from "../packageMerge";
import { reconcileRefresh } from "../../components/UploadQueue";
import type { Deal } from "../idb";

describe("detectPackageRole — real Newmark file names", () => {
  it.each([
    ["NMRK - Lake Brandon Village - OM.pdf", "om"],
    ["NMRK - Lake Brandon Village - Detailed Tenant Underwriting.pdf", "tenant-detail"],
    ["NMRK - Lake Brandon Village - Financial Narrative.pdf", "financials"],
    ["Frederick_Country_Square_-_Financial_Narrative_NMRK.pdf", "financials"],
    ["Frederick_County_Square_-_NMRK_OM.pdf", "om"],
    ["NMRK - Lake Brandon Village - Additional Info 1 (1).pdf", "other"],
    ["Some Center Offering Memorandum.pdf", "om"],
    ["Mystery file.pdf", "om"],
  ])("%s → %s", (f, role) => expect(detectPackageRole(f)).toBe(role));

  it("falls back to the document's own heading", () => {
    expect(detectPackageRole("scan001.pdf", "Lake Brandon Village - Detailed Tenant Underwriting  Suite Tenant")).toBe("tenant-detail");
    expect(detectPackageRole("scan002.pdf", "CASH FLOW  FISCAL YEAR ANALYSIS  Year 1")).toBe("financials");
  });
});

// The three pieces of one Newmark package, as each extracts on its own.
const OM = {
  propertyName: "Lake Brandon Village", address: "11202 - 11381 Causeway Blvd", city: "Brandon", state: "FL",
  centerType: "Grocery-Anchored", noi: 1400000, population3mi: 90000,
  tenants: [{ name: "Sprouts", sf: 30000 }, { name: "PetSmart", sf: 20000 }],
};
const DTU = {
  propertyName: "Lake Brandon Village", centerType: "Neighborhood Center", noi: 1410000,
  tenants: [{ name: "Sprouts", sf: 30000, rentPerSF: 15, renewalOptions: "4 x 5" }, { name: "PetSmart", sf: 20000, rentPerSF: 14 }, { name: "DSW", sf: 22000, rentPerSF: 13 }],
};
const NARR = {
  propertyName: "Lake Brandon Village", centerType: "Neighborhood Center", noi: 1429647, effectiveGrossIncome: 2000000,
  cashFlowProjection: [{ label: "Year 1", noi: 1429647 }, { label: "Year 2", noi: 1460000 }],
  tenants: [{ name: "Sprouts" }],
};
const FILES: Array<[string, Record<string, unknown>]> = [
  ["NMRK - Lake Brandon Village - OM.pdf", OM],
  ["NMRK - Lake Brandon Village - Detailed Tenant Underwriting.pdf", DTU],
  ["NMRK - Lake Brandon Village - Financial Narrative.pdf", NARR],
];

// Mirrors UploadQueue: first file creates the deal, each later file merges in.
function ingest(order: number[]): Deal {
  let deal: Deal | null = null;
  for (const i of order) {
    const [file, data] = FILES[i];
    const role = detectPackageRole(file);
    if (!deal) { deal = { id: "d1", ...data, packageSources: initialPackageSources(role) } as Deal; continue; }
    const pkg = planPackageMerge(deal, role, Array.isArray(data.tenants) && (data.tenants as unknown[]).length > 0);
    deal = reconcileRefresh(deal, data, pkg);
  }
  return deal!;
}

const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

describe("a Newmark package combines the same way whatever order the files finish in", () => {
  it.each(ORDERS.map(o => [o.join("→"), o]))("order %s", (_l, order) => {
    const d = ingest(order as number[]);
    expect(d.tenants).toHaveLength(3);                       // roster from the tenant-detail file
    expect(d.tenants![0].renewalOptions).toBe("4 x 5");
    expect(d.noi).toBe(1429647);                             // exact NOI from the narrative
    expect(d.cashFlowProjection).toHaveLength(2);
    expect(d.centerType).toBe("Grocery-Anchored");           // description from the OM
    expect(d.address).toBe("11202 - 11381 Causeway Blvd");
    // nothing for a person to adjudicate — every disagreement had a clear winner
    expect((d.reviewQuestions || []).filter(q => (q.id || "").startsWith("refresh-"))).toHaveLength(0);
  });
});

describe("safety rails", () => {
  const base = (over: Partial<Deal> = {}): Deal =>
    ({ id: "d1", ...NARR, packageSources: initialPackageSources("financials"), ...over } as Deal);

  it("never replaces a hand-pasted roster", () => {
    const pkg = planPackageMerge(base({ tenantsManual: true }), "tenant-detail", true)!;
    expect(pkg.overwrite.has("roster")).toBe(false);
    const d = reconcileRefresh(base({ tenantsManual: true }), DTU, pkg);
    expect(d.tenants).toHaveLength(1);
  });

  it("never replaces a rent-roll roster", () => {
    expect(planPackageMerge(base({ tenantsSource: "rent-roll" }), "tenant-detail", true)!.overwrite.has("roster")).toBe(false);
  });

  it("keeps a field the user verified", () => {
    const d = reconcileRefresh(base({ noi: 999, verified: { noi: { by: "eric" } } }), { noi: 1 },
      planPackageMerge(base(), "om", false));
    expect(d.noi).toBe(999);
  });

  it("a file outside the package window gets the old keep-and-flag merge", () => {
    const old = base({ packageSources: { ...initialPackageSources("om"), startedAt: "2025-01-01T00:00:00.000Z" } });
    expect(planPackageMerge(old, "financials", false)).toBeNull();
    const d = reconcileRefresh(old, { noi: 2000000 }, null);
    expect(d.noi).toBe(1429647);
    expect((d.reviewQuestions || []).some(q => q.field === "NOI")).toBe(true);
  });

  it("deals made before this feature (no provenance) keep the old behaviour", () => {
    expect(planPackageMerge({ id: "x", propertyName: "A" } as Deal, "om", true)).toBeNull();
  });

  it("two OMs of the same rank still flag a real disagreement", () => {
    const omDeal = { id: "d1", ...OM, packageSources: initialPackageSources("om") } as Deal;
    const d = reconcileRefresh(omDeal, { noi: 1700000 }, planPackageMerge(omDeal, "om", false));
    expect(d.noi).toBe(1400000);
    expect((d.reviewQuestions || []).some(q => q.field === "NOI")).toBe(true);
  });
});
