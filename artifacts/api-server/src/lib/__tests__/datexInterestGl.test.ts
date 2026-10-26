import { describe, it, expect } from "vitest";
import { mergeDatexDeal, mergeInterestGl, dealState } from "../datexIngest";

// Rate detail panel (10/26/26): the Datex interest ledger rides the auto-refresh as its own block.
const MAP = { bldgIds: ["brunswic"] };
const PREV = { source: "datex", asOf: "2026-10-01", bldgIds: ["brunswic"], period: "202609", totalGLA: 300_000, occupiedGLA: 270_000 };
const may = { entityId: "brunswic", period: "202605", mortgageInterest: 366153.9, swapCredits: 2853.39 };

describe("interest ledger block", () => {
  it("merges by entity + month, keeps other blocks, and a re-sent month REPLACES (restatement)", () => {
    const a = mergeDatexDeal(PREV, [], { dealId: "d", bldgIds: ["brunswic"], interestGl: [may, { entityId: "BRUNSWIC ", period: "202604", mortgageInterest: 55397.36, swapCredits: 2905.16 }], interestCheckedThrough: "202609" }, "2026-10-26", MAP);
    if ("problem" in a) throw new Error(a.problem);
    expect(a.sent).toEqual(["interest"]);
    expect(a.block.totalGLA).toBe(300_000);
    expect((a.block.interestGl as unknown[]).length).toBe(2);
    expect(a.block.interestCheckedThrough).toBe("202609");
    const b = mergeDatexDeal(a.block, [], { dealId: "d", bldgIds: ["brunswic"], interestGl: [{ ...may, mortgageInterest: 366000 }] }, "2026-10-26", MAP);
    if ("problem" in b) throw new Error(b.problem);
    expect((b.block.interestGl as Array<{ period: string; mortgageInterest: number }>).find(r => r.period === "202605")!.mortgageInterest).toBe(366000);
    expect(b.changed.join()).toMatch(/1 restated/);
    expect(dealState("d", "Cooks", ["brunswic"], b.block, [])).toMatchObject({ interest: { months: 2, maxPeriod: "202605", checkedThrough: "202609" } });
  });
  it("drops another entity's rows, bad periods and empty rows; keeps 36 months", () => {
    const r = mergeInterestGl([], [{ entityId: "academy", period: "202605", mortgageInterest: 1 }, { entityId: "brunswic", period: "2026-05", mortgageInterest: 1 }, { entityId: "brunswic", period: "202605" }, may], ["brunswic"]);
    expect(r.rows).toEqual([may]);
    expect(r.dropped).toBe(3);
    const many = Array.from({ length: 40 }, (_, i) => ({ entityId: "brunswic", period: `${2023 + Math.floor(i / 12)}${String((i % 12) + 1).padStart(2, "0")}`, mortgageInterest: 1 }));
    expect(mergeInterestGl([], many, ["brunswic"]).rows.length).toBe(36);
  });
});
