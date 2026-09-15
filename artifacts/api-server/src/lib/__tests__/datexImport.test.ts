import { describe, it, expect, beforeEach } from "vitest";
import {
  planDatexImport, buildLiveBlock, applyLiveBlock, datexDivergence,
  DATEX_BLOCK_KEY, __setDatexMap, type DatexMap, type DatexPayload,
} from "../datexImport";

// The payload is produced by a Claude session reading live Datex, because Datex's auth
// server has no machine-to-machine grant and this server cannot pull for itself. So the
// file is UNTRUSTED input, and the acquisition-era figures it sits next to are the whole
// point of the library — frozen evidence of what was marketed. Most of these tests pin what
// the importer REFUSES, because a plausible-looking wrong number written over a real one is
// the failure that actually costs something.

const MAP: DatexMap = {
  mappings: [
    { dealId: "d-cooks", propertyName: "Cooks Corner", bldgIds: ["brunswic"] },
    { dealId: "d-rock", propertyName: "Rockaway Centers", bldgIds: ["rockcom", "rockcrt", "rockplz"] },
    // Mapped but NOT owned — so the status check is what fires, not the map check.
    { dealId: "d-passed", propertyName: "Some Deal We Passed", bldgIds: ["passed1"] },
  ],
  unmapped: [{ dealId: "d-prov", propertyName: "Providence Town Center", reason: "not in Datex yet" }],
};

const deals = () => [
  { id: "d-cooks", data: { propertyName: "Cooks Corner Shopping Center", status: "Owned", totalSF: 300386, occupancy: 67.6 } },
  { id: "d-rock", data: { propertyName: "Rockaway Centers", status: "Owned", totalSF: 500000, occupancy: 95 } },
  { id: "d-prov", data: { propertyName: "Providence Town Center", status: "Owned" } },
  { id: "d-passed", data: { propertyName: "Some Deal We Passed", status: "Passed" } },
];

const payload = (over: Partial<DatexPayload> = {}, deal: Record<string, unknown> = {}): DatexPayload => ({
  source: "datex", asOf: "2026-09-15",
  deals: [{ dealId: "d-cooks", bldgIds: ["brunswic"], totalGLA: 300386, occupiedGLA: 201934, occupancyPct: 67.2, ...deal }],
  ...over,
});

beforeEach(() => __setDatexMap(MAP));

describe("the acquisition snapshot is never touched", () => {
  it("writes ONLY the live block, leaving every original field byte-identical", () => {
    const original = { propertyName: "Cooks Corner", status: "Owned", totalSF: 300386, occupancy: 67.6, noi: 1234567, notes: "the narrative" };
    const updated = applyLiveBlock(original, { occupancyPct: 67.2, totalGLA: 300386 });
    for (const k of Object.keys(original)) {
      expect(updated[k], `${k} must not change`).toEqual(original[k as keyof typeof original]);
    }
    expect(updated[DATEX_BLOCK_KEY]).toBeTruthy();
  });

  it("does not mutate the deal it was handed", () => {
    const original = { occupancy: 67.6 };
    applyLiveBlock(original, { occupancyPct: 1 });
    expect(original).toEqual({ occupancy: 67.6 });
  });

  it("planning is pure — it reports what would change and writes nothing", () => {
    const rows = deals();
    planDatexImport(payload(), rows);
    expect(rows[0].data[DATEX_BLOCK_KEY]).toBeUndefined();
  });
});

describe("what it refuses", () => {
  it("rejects a deal that is not in the map — never guess a building by name", () => {
    const out = planDatexImport(payload({}, { dealId: "d-unknown" }), deals());
    expect(out.applied).toHaveLength(0);
    expect(out.rejected[0].problem).toMatch(/not in the Datex map/);
  });

  it("rejects a deal that is not Owned", () => {
    const p = payload({ deals: [{ dealId: "d-passed", bldgIds: ["passed1"], occupancyPct: 50 }] });
    expect(planDatexImport(p, deals()).rejected[0].problem).toMatch(/not Owned/);
  });

  it("rejects a payload whose buildings disagree with the map", () => {
    // The dangerous case: a file generated against the WRONG building looks entirely
    // plausible in the output, because every figure in it is internally consistent.
    const out = planDatexImport(payload({}, { bldgIds: ["redlion"] }), deals());
    expect(out.applied).toHaveLength(0);
    expect(out.rejected[0].problem).toMatch(/do not match the map/);
  });

  it("requires ALL of a multi-building deal's ids, not a subset", () => {
    const partial = planDatexImport(payload({ deals: [{ dealId: "d-rock", bldgIds: ["rockcom"], occupancyPct: 90 }] }), deals());
    expect(partial.rejected[0].problem).toMatch(/do not match the map/);
    const full = planDatexImport(payload({ deals: [{ dealId: "d-rock", bldgIds: ["rockplz", "rockcom", "rockcrt"], occupancyPct: 90 }] }), deals());
    expect(full.applied).toHaveLength(1);   // order must not matter
  });

  it("rejects impossible figures rather than storing them", () => {
    const over = planDatexImport(payload({}, { totalGLA: 100000, occupiedGLA: 250000 }), deals());
    expect(over.rejected[0].problem).toMatch(/exceeds total GLA/);
  });

  it("rejects a missing, malformed or future asOf", () => {
    for (const asOf of ["", "not a date", "15/09/2026"]) {
      expect(planDatexImport(payload({ asOf }), deals()).rejected[0].problem).toMatch(/ISO date/);
    }
    const future = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);
    expect(planDatexImport(payload({ asOf: future }), deals()).rejected[0].problem).toMatch(/in the future/);
  });

  it("skips the unmapped deal cleanly instead of erroring", () => {
    const out = planDatexImport(payload({ deals: [{ dealId: "d-prov", bldgIds: [] }] }), deals());
    expect(out.rejected).toHaveLength(0);
    expect(out.skipped[0].reason).toMatch(/not set up in Datex/);
  });
});

describe("null means unknown, never zero", () => {
  it("omits absent figures rather than writing them as 0", () => {
    const out = planDatexImport(payload({}, { totalGLA: 300386, occupiedGLA: null, occupancyPct: null, totalUnits: null }), deals());
    const b = out.applied[0].block;
    expect(b.totalGLA).toBe(300386);
    expect("occupiedGLA" in b).toBe(false);
    expect("totalUnits" in b).toBe(false);
    expect(b.occupancyPct).toBeUndefined();
  });

  it("refuses an out-of-range occupancy instead of clamping it", () => {
    const out = planDatexImport(payload({}, { occupancyPct: 140, totalGLA: null, occupiedGLA: null }), deals());
    expect(out.applied[0].block.occupancyPct).toBeUndefined();
  });

  it("derives occupancy only when both sides are real", () => {
    const out = planDatexImport(payload({}, { occupancyPct: null, totalGLA: 300386, occupiedGLA: 201934 }), deals());
    expect(out.applied[0].block.occupancyPct).toBe(67.2);
  });
});

describe("the Datex row traps, verified against live data on 2026-09-15", () => {
  it("drops superseded lease generations — ANY dot in TenantId, not one literal suffix", () => {
    // Real ids at Cooks Corner: t0000062.1.30, t0000069.2.6, t0000070.2.70. The original
    // spec named '.0.00011', which matches none of them and would have doubled GLA.
    const out = planDatexImport(payload({}, {
      tenants: [
        { tenantId: "t0000062", name: "Advance Auto Parts", sf: 8000, annualRent: 96000 },
        { tenantId: "t0000062.1.30", name: "Advance Auto Parts", sf: 8000, annualRent: 0 },
        { tenantId: "t0000069.2.6", name: "Camden National Bank", sf: 3000, annualRent: 0 },
        { tenantId: "t0000070.2.70", name: "Dollar Tree", sf: 12000, annualRent: 0 },
      ],
    }), deals());
    const t = out.applied[0].block.tenants as Array<Record<string, unknown>>;
    expect(t).toHaveLength(1);
    expect(t[0].name).toBe("Advance Auto Parts");
  });

  it("KEEPS a genuine zero-rent tenant — a dark anchor still occupies its box", () => {
    // Big Lots: 40,000 SF at $0 rent, no dot suffix. Filtering on rent would delete a real
    // anchor and understate the centre by 40,000 SF.
    const out = planDatexImport(payload({}, {
      tenants: [{ tenantId: "t0000067", name: "Big Lots #01694", sf: 40000, annualRent: 0 }],
    }), deals());
    const t = out.applied[0].block.tenants as Array<Record<string, unknown>>;
    expect(t).toHaveLength(1);
    expect(t[0].sf).toBe(40000);
    expect(t[0].annualRent).toBe(0);
  });

  it("drops unnamed rows but keeps zero-SF income leases (ATMs, pads, ground leases)", () => {
    const out = planDatexImport(payload({}, {
      tenants: [
        { tenantId: "t1", name: "  ", sf: 100 },
        { tenantId: "t2", name: "Bath Savings Institution (ATM)", sf: 0, annualRent: 14520 },
      ],
    }), deals());
    const t = out.applied[0].block.tenants as Array<Record<string, unknown>>;
    expect(t).toHaveLength(1);
    expect(t[0].name).toMatch(/ATM/);
    expect(t[0].sf).toBe(0);
  });
});

describe("divergence reporting — surface the gap, never reconcile it", () => {
  it("reports live against the frozen acquisition figure", () => {
    const data = applyLiveBlock({ totalSF: 300386, occupancy: 67.6 }, { occupancyPct: 67.2, totalGLA: 300386 });
    const rows = datexDivergence(data);
    const occ = rows.find(r => r.field === "occupancy")!;
    expect(occ.acquisition).toBe(67.6);
    expect(occ.live).toBe(67.2);
    expect(occ.deltaPct).toBe(-0.6);
  });

  it("surfaces a fully-dark segment that a headline occupancy hides", () => {
    // Cooks Corner's real finding: MajorGLA 29,000 with MajorOccupiedGLA 0. The centre still
    // reads 67% occupied, so the empty box is invisible in the headline.
    const data = applyLiveBlock({ totalSF: 300386, occupancy: 67.6 }, {
      occupancyPct: 67.2, totalGLA: 300386,
      segments: { major: { gla: 29000, occupiedGLA: 0 }, shop: { gla: 271386, occupiedGLA: 146934 } },
    });
    const dark = datexDivergence(data).find(r => r.field.startsWith("major"));
    expect(dark).toBeTruthy();
    expect(dark!.note).toMatch(/29,000 SF of major space is entirely vacant/);
  });

  it("returns nothing when there is no live block", () => {
    expect(datexDivergence({ occupancy: 67.6 })).toEqual([]);
  });
});

describe("buildLiveBlock stamps provenance", () => {
  it("records source, asOf and the map's building ids", () => {
    const r = buildLiveBlock({ dealId: "d-cooks", bldgIds: ["brunswic"], occupancyPct: 67.2 }, "2026-09-15", { bldgIds: ["brunswic"] });
    expect("problem" in r).toBe(false);
    const b = (r as { block: Record<string, unknown> }).block;
    expect(b.source).toBe("datex");
    expect(b.asOf).toBe("2026-09-15");
    expect(b.bldgIds).toEqual(["brunswic"]);
    expect(b.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// The map must come from the BUNDLE, not the filesystem. The first cut resolved a path from
// __dirname, which is src/lib/ under test and dist/ in the built server — and the JSON was
// never copied into the build output. Every unit test passed while production failed with
// ENOENT on the first real import. This pins the loaded map to the real one.
describe("the building map is bundled, not read from disk", () => {
  it("loads the real map with no filesystem access", async () => {
    __setDatexMap(null);                       // drop the test override
    const { loadDatexMap } = await import("../datexImport");
    const m = loadDatexMap();
    expect(m.mappings.length).toBe(38);
    expect(m.unmapped.length).toBe(1);
    expect(m.mappings.find(x => x.dealId === "mqiun949_0_gixfg")?.bldgIds).toEqual(["brunswic"]);
    expect(m.mappings.find(x => x.propertyName === "Rockaway Centers")?.bldgIds).toHaveLength(3);
    __setDatexMap(MAP);                        // restore for any later test
  });
});
