import { describe, it, expect } from "vitest";
import { claimsAboveMarket, reclassifyAboveMarketUpside, checkQuotedFigures, analysisTexts } from "../analysisGuardrails";

// Verbatim from the live Township Plaza analysis (Eric's 10/16/26 review).
const IWG_UPSIDE = {
  item: "Mark-to-Market Rent Upside — IWG/Regus at Rollover (2032)",
  detail: "IWG occupies 10,942 SF at $41.13/SF through Dec 2032, which is well above the OM's assumed office market rent of $24.00/SF — however, on renewal the space would re-price to market. The near-term upside is the 3% annual escalations through 2032 (reaching ~$44.94/SF), which are contractual and within a 5–7 year hold.",
  priority: "high",
};
const BELOW = {
  item: "Below-Market In-Place Rents on Near-Term Rollovers",
  detail: "Several tenants expiring within 2–3 years show rents meaningfully below the $28/SF retail market assumption: 17TH Manor Fitness ($13.27/SF, Oct 2026), Township Eye Association ($16.84/SF, May 2031).",
  priority: "medium",
};
const TAILWIND = {
  item: "Submarket Tailwind from Mainstreet Coconut Creek Development",
  detail: "As this project delivers new rooftops, Township Plaza's medical and services tenants stand to benefit, which should support above-market rent growth at renewal and compress vacancy periods.",
  priority: "medium",
};
const LEASEUP = { item: "Lease-Up of Two Vacant Suites (6,024 SF, ~10% of GLA)", detail: "At the market retail rate of $28.00/SF NNN, full lease-up would generate approximately $168,672/yr.", priority: "high" };

describe("above-market rent is never upside", () => {
  it("catches the IWG item", () => expect(claimsAboveMarket(`${IWG_UPSIDE.item} ${IWG_UPSIDE.detail}`)).toBe(true));
  it("leaves real upside alone", () => {
    for (const u of [BELOW, TAILWIND, LEASEUP]) expect(claimsAboveMarket(`${u.item} ${u.detail}`)).toBe(false);
  });
  it("catches the vs-pattern", () => expect(claimsAboveMarket("Tenant pays $41.13/SF vs a $24 market rent")).toBe(true));
  it("moves it to red flags, keeps the rest", () => {
    const r = reclassifyAboveMarketUpside([IWG_UPSIDE, LEASEUP, BELOW, TAILWIND], [{ severity: "low", description: "x" }]);
    expect(r.moved).toBe(1);
    expect(r.upsideItems.map(u => u.item)).toEqual([LEASEUP.item, BELOW.item, TAILWIND.item]);
    expect(r.redFlags).toHaveLength(2);
    expect(r.redFlags[1].description).toMatch(/roll-down risk/);
  });
});

describe("quoted figures must match the stored deal", () => {
  const deal = {
    occupancy: 90.1, grossPotentialRent: 1521486, __today: "2026-10-17",
    tenants: [
      { name: "IWG", annualRent: 450000, leaseExpiry: "2032-12-11" },
      { name: "17TH Manor Fitness", annualRent: 56662, leaseExpiry: "2026-10-31" },
      { name: "Hair Expressions Salon & Blow Dry Bar", annualRent: 19938, leaseExpiry: "2026-10-14" },
    ],
  };
  const analysis = {
    notes: "In-place NOI is $1,155,720 at **88.93% occupancy**, with IWG generating $450,000/yr — roughly 39% of in-place gross potential rent. Rollover includes 17TH Manor Fitness (4,270 SF, Oct 2026, potentially already in holdover).",
    dealScore: { rationale: "Township Plaza remains a **88.93%-occupied neighborhood/medical-office hybrid**", risks: ["IWG/Regus (17.96% of GLA, ~39% of base rent) is a flex-office sublease operator"], strengths: [] },
    redFlags: [{ description: "Occupancy could fall below 85% if the rollover isn't re-leased." }],
  };
  const ms = checkQuotedFigures(deal, analysisTexts(analysis));
  it("flags 88.93% vs the stored 90.1%", () => expect(ms.find(m => m.field === "occupancy")?.quoted).toBe(88.93));
  it("ignores a hypothetical threshold", () => expect(ms.some(m => m.quoted === 85)).toBe(false));
  it("flags IWG at 39% when GPR gives 29.6%", () => {
    const m = ms.find(x => x.field === "IWG share of base rent");
    expect(m?.quoted).toBe(39);
    expect(m?.stored).toBe(29.6);
  });
  it("flags 'already in holdover' on a lease that runs past today", () => expect(ms.some(m => m.field === "17TH Manor Fitness lease status")).toBe(true));
  it("does not flag a lease that really has expired", () => {
    const r = checkQuotedFigures(deal, ["Hair Expressions Salon lease expired in Oct 2026 and is in holdover."]);
    expect(r.some(m => m.field.startsWith("Hair Expressions"))).toBe(false);
  });
});

describe("occupancy tie-out only reads labelled occupancy (10/19/26)", () => {
  it("ignores occupancy cost, tenant shares and 'leased to'", async () => {
    const { checkQuotedFigures } = await import("../analysisGuardrails");
    const deal = { occupancy: 100, tenants: [] };
    for (const t of ["Ross runs a healthy 8.5% occupancy cost.", "Walmart's occupancy cost of 1.7% is low.", "The box is 100% leased to Walmart and 1.7% leased by inline.", "Submarket occupancy of 94% is tight.", "Occupancy 99.5% occupied."])
      expect(checkQuotedFigures(deal, [t]).filter(m => m.field === "occupancy")).toEqual([]);
    expect(checkQuotedFigures(deal, ["The center is 88.9% occupied."]).map(m => m.quoted)).toEqual([88.9]);
    expect(checkQuotedFigures(deal, ["Occupancy of 92% reflects the Big Lots box."]).map(m => m.quoted)).toEqual([92]);
  });
  it("a question no longer raised is resolved, not deleted, and not re-opened", async () => {
    const { applyAnalysisGuardrails } = await import("../analysisGuardrails");
    const deal: Record<string, unknown> = { occupancy: 100, tenants: [], notes: "Occupancy cost of 1.7% is low.",
      reviewQuestions: [{ id: "ai-figure-occupancy-0", field: "occupancy", question: "The AI write-up says 1.7% …" }, { id: "x", question: "keep" }] };
    const out = applyAnalysisGuardrails(deal, { ...deal });
    const qs = out.reviewQuestions as Array<Record<string, unknown>>;
    expect(qs.find(q => q.id === "x")).toBeTruthy();
    const r = qs.find(q => q.id === "ai-figure-occupancy-0")!;
    expect(r.resolvedBy).toBe("auto-triage");
    const again = applyAnalysisGuardrails({ ...deal, reviewQuestions: qs }, { ...deal, reviewQuestions: qs });
    expect(again.reviewQuestions ?? qs).toEqual(qs);
  });
});
