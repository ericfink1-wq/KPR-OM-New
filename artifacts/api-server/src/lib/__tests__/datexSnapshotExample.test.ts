import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { planDatexImport, buildLiveBlock, type DatexPayload } from "../datexImport";

// The example served at /api/admin/docs/datex-snapshot-example IS the contract. If the
// importer changes, this test makes the example change with it.
const example = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../docs/datex-snapshot-example.json"), "utf8")) as DatexPayload;

describe("served Datex snapshot example", () => {
  const d = example.deals[0];
  const map = { mappings: [{ dealId: d.dealId, propertyName: "Overland Plaza", bldgIds: d.bldgIds }], unmapped: [] };
  it("imports cleanly with every v2 block landing", () => {
    const plan = planDatexImport({ ...example, asOf: "2026-10-15" }, [{ id: d.dealId, data: { status: "Owned", propertyName: "Overland Plaza" } }], map);
    expect(plan.rejected).toEqual([]);
    const b = plan.applied[0].block as Record<string, any>;
    expect(b.assetManager).toBe("Jon Smith");
    expect(b.financials).toMatchObject({ period: "202609", noiYtdActual: 1_731_500, noiTtmActual: 2_310_400 });
    expect(b.arAging.byTenant[0]).toMatchObject({ name: "Nail Spa", over60: 6400 });
    expect(b.leasing[0]).toMatchObject({ tenant: "Crumbl Cookies", gla: 1600, rentCommencement: "2027-02-01" });
    expect(b.tenants[0]).toMatchObject({ tenantId: "t0001604", sf: 61000, rentPerSF: 11, annualNNN: 262300, leaseExpiry: "2029-09-30", nationalTenant: "Schnucks", sales12: { sales12: 5_945_000, months: 3, partial: true } });
    expect(b.tenants[1].salesNeverReported).toBe(true);
    expect(b.vacantSuites).toHaveLength(2);
    expect(b.segments.major.gla).toBe(128000);
  });
  it("common alternative spellings for the core tenant fields are accepted", () => {
    const r = buildLiveBlock({ dealId: "x", bldgIds: ["a"], tenants: [{ tenantId: "t1", name: "Ulta", gla: 10000, rentPSF: 22, expiration: "2031-01-31", commencement: "2021-02-01" } as never] }, "2026-10-15", { bldgIds: ["a"] });
    expect("block" in r && (r.block.tenants as any[])[0]).toMatchObject({ sf: 10000, rentPerSF: 22, leaseExpiry: "2031-01-31", leaseStart: "2021-02-01" });
  });
});
