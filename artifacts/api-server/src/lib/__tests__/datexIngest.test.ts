import { describe, it, expect } from "vitest";
import { mergeDatexDeal, mergeSalesRows, mergeLeasing, rosterHash, dealState, blocksSent, pendingSaleProblem } from "../datexIngest";
import { planDatexImport } from "../datexImport";

const MAP = { bldgIds: ["cooks"] };
const PREV = {
  source: "datex", asOf: "2026-10-01", bldgIds: ["cooks"], period: "202609", totalGLA: 300_000, occupiedGLA: 270_000, occupancyPct: 90,
  tenants: [{ tenantId: "t1", name: "Kroger", sf: 60_000, annualRent: 600_000, sales12: { sales12: 30_000_000, months: 12, from: "202410", to: "202509", staleMonths: 0, partial: false } }, { tenantId: "t2", name: "Nail Spa", sf: 1_200, annualRent: 30_000 }],
  financials: { source: "FinancialGroups NOI", period: "202608", noiYtdActual: 1_000_000 },
  arAging: { over60: 50_000, over90: 20_000 },
  leasing: [{ tenant: "Ulta", suite: "12", submitted: "2026-08-01", stage: "Lease Application" }],
};

describe("Datex ingest merge", () => {
  it("keeps every block the payload does not send", () => {
    const r = mergeDatexDeal(PREV, [], { dealId: "d", bldgIds: ["cooks"], financials: { period: "202609", basis: "Cash", noiYtdActual: -1_100_000 } }, "2026-10-18", MAP);
    if ("problem" in r) throw new Error(r.problem);
    expect(r.sent).toEqual(["financials"]);
    expect(r.block.tenants).toEqual(PREV.tenants);
    expect(r.block.arAging).toEqual(PREV.arAging);
    expect(r.block.occupiedGLA).toBe(270_000);
    expect((r.block.financials as Record<string, unknown>).noiYtdActual).toBe(1_100_000);   // sign flipped
    expect((r.block.financials as Record<string, unknown>).basis).toBe("Cash");
    expect(r.block.blockAsOf).toMatchObject({ financials: "2026-10-18", tenants: "2026-10-01", occupancy: "2026-10-01" });
    expect(r.block.asOf).toBe("2026-10-18");
  });
  it("same validations as the file import: bldgIds, occupied ≤ total, over90 ≤ over60, no sale fields", () => {
    expect("problem" in mergeDatexDeal(PREV, [], { dealId: "d", bldgIds: ["other"], totalGLA: 1 }, "2026-10-18", MAP)).toBe(true);
    expect("problem" in mergeDatexDeal(PREV, [], { dealId: "d", bldgIds: ["cooks"], totalGLA: 100, occupiedGLA: 200 }, "2026-10-18", MAP)).toBe(true);
    expect("problem" in mergeDatexDeal(PREV, [], { dealId: "d", bldgIds: ["cooks"], arAging: { over60: 1, over90: 50 } }, "2026-10-18", MAP)).toBe(true);
    const sale = mergeDatexDeal(PREV, [], { dealId: "d", bldgIds: ["cooks"], totalGLA: 1, ...({ buyer: "X" } as object) }, "2026-10-18", MAP);
    expect("problem" in sale && sale.problem).toMatch(/sale fields/);
    expect(pendingSaleProblem({ saleStage: "LOI" })).toBeTruthy();
    expect(pendingSaleProblem({ dealId: "d", totalGLA: 1, salesHistory: [] })).toBeNull();
  });
  it("the file import refuses pending-sale fields too", () => {
    const out = planDatexImport({ asOf: "2026-10-01", deals: [{ dealId: "d", bldgIds: ["cooks"], ...({ pendingSaleBuyer: "X" } as object) }] },
      [{ id: "d", data: { status: "Owned", propertyName: "Cooks" } }], { mappings: [{ dealId: "d", propertyName: "Cooks", bldgIds: ["cooks"] }], unmapped: [] });
    expect(out.rejected[0]?.problem).toMatch(/sale fields/);
  });
  it("sales append by tenant+period, keep 24 months, and recompute trailing 12", () => {
    const stored = Array.from({ length: 12 }, (_, i) => ({ tenantId: "t1", period: `2025${String(i + 1).padStart(2, "0")}`, amount: 2_000_000, reportingType: "RPT" }));
    const r = mergeDatexDeal(PREV, stored, { dealId: "d", bldgIds: ["cooks"], salesHistory: [{ tenantId: "t1", period: "202601", amount: 3_000_000 }, { tenantId: "t1", period: "190001", amount: 0 }] }, "2026-10-18", MAP);
    if ("problem" in r) throw new Error(r.problem);
    expect(r.salesRows).toHaveLength(13);
    const k = (r.block.tenants as Array<Record<string, any>>).find(t => t.tenantId === "t1")!;
    expect(k.sales12.sales12).toBe(25_000_000);       // 11 × 2M + 3M, the 12 most recent reported months
    expect(r.warnings.join(" ")).toMatch(/1 sales row/);
    const old = mergeSalesRows([{ tenantId: "t1", period: "202301", amount: 1, reportingType: "RPT" }], [{ tenantId: "t1", period: "202601", amount: 1 }]);
    expect(old.rows.map(x => x.period)).toEqual(["202601"]);   // 36 months old → dropped
    const est = mergeSalesRows([{ tenantId: "t1", period: "202601", amount: 5, reportingType: "RPT" }], [{ tenantId: "t1", period: "202601", amount: 9, reportingType: "EST" }]);
    expect(est.rows[0].amount).toBe(5);                         // an estimate never replaces a reported month
  });
  it("tenants replaced only when sent; old sales summaries carried when no monthly history is stored", () => {
    const r = mergeDatexDeal(PREV, [], { dealId: "d", bldgIds: ["cooks"], tenants: [{ tenantId: "t1", name: "Kroger", sf: 60_000, annualRent: 620_000, occStatus: "C" }] }, "2026-10-18", MAP);
    if ("problem" in r) throw new Error(r.problem);
    const t = r.block.tenants as Array<Record<string, any>>;
    expect(t).toHaveLength(1);
    expect(t[0].sales12.sales12).toBe(30_000_000);
    expect(r.changed.join(" ")).toMatch(/rent roll 2 → 1/);
  });
  it("leasing upserts by tenant+suite+submitted", () => {
    const r = mergeLeasing(PREV.leasing, [{ tenant: "Ulta", suite: "12", submitted: "2026-08-01", stage: "Lease Executed" }, { tenant: "Five Below", suite: "3", submitted: "2026-10-02" }]);
    expect(r).toMatchObject({ added: 1, updated: 1 });
    expect(r.rows[0].tenant).toBe("Five Below");
  });
  it("state: roster hash is order-independent and reports what is stored", () => {
    expect(rosterHash([{ tenantId: "a", sf: 1 }, { tenantId: "b", sf: 2 }])).toBe(rosterHash([{ tenantId: "b", sf: 2 }, { tenantId: "a", sf: 1.0 }]));
    expect(rosterHash([{ tenantId: "a", sf: 1 }])).not.toBe(rosterHash([{ tenantId: "a", sf: 2 }]));
    const s = dealState("d", "Cooks", ["cooks"], PREV, []);
    expect(s).toMatchObject({ hasSnapshot: true, tenants: { count: 2 }, sales: { maxPeriod: "202509" }, leasing: { latestSubmitted: "2026-08-01" }, financials: { period: "202608" } });
    expect(blocksSent({ dealId: "d", bldgIds: [], occupiedUnits: 3 })).toEqual(["occupancy"]);
  });
  it("A/R accepts Datex's own occpstat spelling", () => {
    const r = mergeDatexDeal(PREV, [], { dealId: "d", bldgIds: ["cooks"], arAging: { over60: 10, over90: 5, byTenant: [{ name: "Big Lots", over60: 10, over90: 5, ...({ occpstat: "I" } as object) }] } }, "2026-10-18", MAP);
    if ("problem" in r) throw new Error(r.problem);
    expect((r.block.arAging as any).byTenant[0].occStatus).toBe("I");
  });
});
