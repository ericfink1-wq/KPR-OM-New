import { describe, it, expect } from "vitest";
import type { LeaseAbstract } from "../idb";
import { rockawayOmDeal } from "./fixtures/rockaway-om";
import { resolveTenantRisk, computeExposure, buildAnchorDependencyGraph, buildDiligenceList } from "../leaseRisk";

// Phase A — engine run on the REAL Rockaway OM (OM only, all clauses unverified).
const resolved = resolveTenantRisk(rockawayOmDeal);
const dicks = computeExposure(resolved, "Dick's Sporting Goods");

describe("Rockaway Phase A — OM-only capture", () => {
  it("captured 5 co-tenancy tenants, all source OM / unverified", () => {
    const withCo = resolved.filter((r) => r.coTenancy.length);
    expect(withCo.map((r) => r.tenant).sort()).toEqual(
      ["Carter's / Osh Kosh", "J Crew", "PetSmart", "Ulta", "Visionworks"].sort(),
    );
    expect(withCo.every((r) => r.coTenancy.every((c) => c.verifiedAgainstExecutedDoc === false))).toBe(true);
  });

  it("Dick's relocates/goes dark → Tier-1 = Carter's + Ulta = $514,403", () => {
    expect(dicks.tier1Rent).toBe(156410 + 357993);
    const t1 = dicks.clauses.filter((c) => c.tier === 1).map((c) => c.tenant).sort();
    expect(t1).toEqual(["Carter's / Osh Kosh", "Ulta"]);
  });

  it("J Crew is Tier-2 for Dick's (needs a 2nd of Target/Ulta)", () => {
    const jcrew = dicks.clauses.find((c) => c.tenant === "J Crew");
    expect(jcrew?.tier).toBe(2);
    expect(dicks.tier2Rent).toBe(148631);
  });

  it("PetSmart & Visionworks are NOT linked to Dick's (Target-only / generic)", () => {
    expect(dicks.clauses.find((c) => c.tenant === "PetSmart")).toBeUndefined();
    expect(dicks.clauses.find((c) => c.tenant === "Visionworks")).toBeUndefined();
  });

  it("any-linkage (Tier 3) total = $663,034", () => {
    expect(dicks.tier3Rent).toBe(156410 + 357993 + 148631);
  });

  it("diligence list flags OM-silent tenants to pull leases", () => {
    const dil = buildDiligenceList(rockawayOmDeal);
    const pull = dil.filter((d) => d.kind === "pull_leases_no_cotenancy").map((d) => d.tenant).sort();
    expect(pull).toEqual(["Crumble Cookies", "Five Guys", "Teriyaki Madness"].sort());
    // every captured co-tenancy is unverified → flagged for executed-doc verification
    expect(dil.filter((d) => d.kind === "verify_unverified").length).toBe(5);
  });
});

// Human-readable Phase A report (printed during the test run).
it("PHASE A REPORT", () => {
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const lines: string[] = [];
  lines.push("\n================ ROCKAWAY — PHASE A (OM ONLY) ================");
  lines.push("\nCo-tenancy / kickout clauses captured (all source:OM, verified:false):");
  for (const r of resolved) {
    for (const c of r.coTenancy) {
      const anchors = JSON.stringify(c.triggerLogic);
      const named = [...new Set((anchors.match(/"anchor":"[^"]+"/g) || []).map((s) => s.replace(/"anchor":"|"/g, "")))];
      lines.push(`  • ${r.tenant} (${fmt(r.baseRentAnnual || 0)} base) — references: ${named.join(", ") || "—"} | remedy: ${c.remedy?.mechanism} ${c.remedy?.value ?? ""}`);
    }
  }
  lines.push("\nScenario: DICK'S SPORTING GOODS relocates / goes dark");
  lines.push(`  Tier 1 (trips on Dick's ALONE): ${fmt(dicks.tier1Rent)}  [${dicks.clauses.filter(c=>c.tier===1).map(c=>c.tenant).join(", ")}]`);
  lines.push(`  Tier 2 (needs a 2nd event):     ${fmt(dicks.tier2Rent)}  [${dicks.clauses.filter(c=>c.tier===2).map(c=>c.tenant).join(", ")}]`);
  lines.push(`  Tier 3 (any linkage, total):    ${fmt(dicks.tier3Rent)}`);
  lines.push("\nAnchor dependency map:");
  for (const g of buildAnchorDependencyGraph(resolved)) {
    lines.push(`  ${g.anchor}: ${g.dependents.map((d) => d.tenant).join(", ")}`);
  }
  lines.push("\nDiligence to-do (auto):");
  for (const d of buildDiligenceList(rockawayOmDeal)) lines.push(`  - ${d.message}`);
  lines.push("==============================================================\n");
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
  expect(true).toBe(true);
});

// Phase B mitigation — an executed Ulta abstract (Third Amendment removed Dick's)
// overrides the OM clause, flips it verified, and de-links Ulta from the Dick's
// scenario. This is exactly what the deal page's Lease Risk panel renders.
describe("Rockaway Phase B — Ulta abstract mitigates the Dick's exposure", () => {
  const ultaAbstract: LeaseAbstract = {
    tenantName: "Ulta",
    coTenancy: [{
      type: "operating",
      // Third Amendment: Dick's DELETED — now Target dark OR inline occupancy < 75%.
      triggerLogic: { operator: "OR", conditions: [
        { type: "named_anchor_dark", anchor: "Target" },
        { type: "occupancy_threshold", scope: "inline <15000 SF", direction: "below", pct: 75 },
      ] },
      remedy: { mechanism: "percent_rent_reduction", value: 50 },
      sourceDocument: "Ulta Third Amendment (executed)", verifiedAgainstExecutedDoc: true,
    }],
  };

  it("Ulta drops out of the Dick's scenario; Tier-1 falls $514,403 → $156,410", () => {
    const before = computeExposure(resolveTenantRisk(rockawayOmDeal), "Dick's Sporting Goods");
    expect(before.tier1Rent).toBe(514403);

    const after = computeExposure(resolveTenantRisk(rockawayOmDeal, [ultaAbstract]), "Dick's Sporting Goods");
    expect(after.clauses.find((c) => c.tenant === "Ulta")).toBeUndefined(); // no longer linked to Dick's
    expect(after.tier1Rent).toBe(156410); // only Carter's remains
  });

  it("the resolved Ulta clause is now verified against the executed lease", () => {
    const ulta = resolveTenantRisk(rockawayOmDeal, [ultaAbstract]).find((r) => r.tenant === "Ulta");
    expect(ulta?.coTenancy[0].verifiedAgainstExecutedDoc).toBe(true);
    expect(ulta?.hasUnverified).toBe(false);
  });
})
