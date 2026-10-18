import { describe, it, expect } from "vitest";
import { datexGlaTieOut, splitArAging } from "../assetMgmt";

describe("Datex GLA tie-out (recomputed)", () => {
  it("counts a twice-listed suite once, drops a vacant suite that is leased, adds a pre-leased box", () => {
    const dx = { totalGLA: 100_000, tenants: [
      { name: "Kroger", suite: "A", sf: 60_000, occStatus: "C" },
      { name: "Kroger", suite: "A", sf: 60_000, occStatus: "C" },     // lease generation
      { name: "Nail Spa", suite: "B", sf: 5_000, occStatus: "C" },
      { name: "Ulta", suite: "C", sf: 10_000, occStatus: "N", futureLease: true },  // pre-leased vacancy
    ], vacantSuites: [{ suite: "B", sf: 5_000 }, { suite: "D", sf: 25_000 }] };
    const r = datexGlaTieOut(dx)!;
    expect(r.rosterGLA).toBe(100_000);
    expect(r.level).toBe("ties");
    expect(r.adjustments).toHaveLength(3);
  });
  it("2–5% is a note, above 5% a warning", () => {
    expect(datexGlaTieOut({ totalGLA: 100_000, tenants: [{ name: "A", suite: "1", sf: 96_200 }] })!.level).toBe("note");
    expect(datexGlaTieOut({ totalGLA: 100_000, tenants: [{ name: "A", suite: "1", sf: 94_000 }] })!.level).toBe("warn");
  });
});

describe("A/R split: current vs former tenants", () => {
  const tenants = [{ name: "Kroger", tenantId: "t1" }, { name: "Nail Spa", tenantId: "t2" }];
  it("a vacated tenant (not on the roll, or flagged I) is labelled former", () => {
    const r = splitArAging({ tenants, arAging: { over60: 500_000, over90: 454_000, byTenant: [
      { tenantId: "t9", name: "Big Lots #4512", over60: 420_000, over90: 410_000 },
      { tenantId: "t2", name: "Nail Spa", over60: 6_400, over90: 3_200 },
    ] } })!;
    expect(r.former.map(x => x.name)).toEqual(["Big Lots #4512"]);
    expect(r.current90).toBe(44_000);
    expect(r.former90).toBe(410_000);
  });
  it("explicit occStatus wins; no roll → nothing guessed as former", () => {
    expect(splitArAging({ tenants, arAging: { over90: 10, byTenant: [{ name: "Kroger", occStatus: "I", over90: 10 }] } })!.former).toHaveLength(1);
    expect(splitArAging({ arAging: { over90: 10, byTenant: [{ name: "Big Lots", over90: 10 }] } })!.former).toHaveLength(0);
  });
});
