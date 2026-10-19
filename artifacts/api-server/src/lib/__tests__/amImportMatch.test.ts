import { describe, it, expect } from "vitest";
import { planImport, type AmRecord } from "../assetMgmt";

// Eric, 10/19/26: a corrected maturity / lender / amount created a NEW loan (Chili, Amberly,
// Cooks, the Overland swap). Identity is property + label (covenants: property + type).
const OWNED = [{ id: "chili", name: "Chili Plaza", bldgIds: [] }, { id: "over", name: "Overland Plaza", bldgIds: [] }];
const rec = (id: string, kind: AmRecord["kind"], dealId: string, data: Record<string, unknown>): AmRecord => ({ id, kind, dealId, data, sourceNote: "orig", updatedBy: null, updatedAt: "2026-10-18T00:00:00Z" });
const plan = (body: object, existing: AmRecord[]) => planImport(JSON.stringify(body), OWNED, new Set(existing.map(e => e.id)), existing);

describe("asset-mgmt import matching", () => {
  const loan = rec("loan:old", "loan", "chili", { lender: "M&T", loanLabel: "Senior Loan", originalBalance: 20_000_000, maturityDate: "2027-06-01", notes: "keep me" });

  it("a loan with a corrected maturity, lender and amount UPDATES the saved loan (same label)", () => {
    const p = plan({ loans: [{ dealId: "chili", loanLabel: "Senior Loan", lender: "M&T Bank", originalAmount: 20_500_000, maturityDate: "2028-06-01" }] }, [loan]);
    expect(p.rejected).toEqual([]);
    expect(p.rows).toHaveLength(1);
    const r = p.rows[0];
    expect([r.action, r.id]).toEqual(["update", "loan:old"]);
    expect(r.data.notes).toBe("keep me");                     // fields the import doesn't carry are kept
    expect(r.data.maturityDate).toBe("2028-06-01");
    expect(r.changes!.map(c => [c.label, c.from, c.to])).toEqual([
      ["lender", "M&T", "M&T Bank"], ["original amount", 20_000_000, 20_500_000], ["maturity", "2027-06-01", "2028-06-01"], ["loan label", "Senior Loan", "Senior Loan"],
    ].filter(([, a, b]) => a !== b));
    expect(r.sourceNote).toBe("orig");
  });
  it("label matching ignores case and punctuation; a different label creates a new loan", () => {
    expect(plan({ loans: [{ dealId: "chili", loanLabel: "senior-loan", originalBalance: 1, maturityDate: "2029-01-01" }] }, [loan]).rows[0].action).toBe("update");
    expect(plan({ loans: [{ dealId: "chili", loanLabel: "Mezz", originalBalance: 1, maturityDate: "2029-01-01" }] }, [loan]).rows[0].action).toBe("create");
    expect(plan({ loans: [{ dealId: "over", loanLabel: "Senior Loan", originalBalance: 1, maturityDate: "2029-01-01" }] }, [loan]).rows[0].action).toBe("create");  // other property
  });
  it("a swap with a new notional / maturity UPDATES the swap on that loan label", () => {
    const sw = rec("swap:old", "swap", "over", { counterparty: "ONB", notional: 15_000_000, maturityDate: "2029-01-15", loanLabel: "ONB Loan" });
    const p = plan({ swaps: [{ dealId: "over", loanLabel: "ONB Loan", counterparty: "Old National", notional: 14_800_000, maturityDate: "2029-02-15" }] }, [sw]);
    expect([p.rows[0].action, p.rows[0].id]).toEqual(["update", "swap:old"]);
    expect(p.rows[0].changes!.map(c => c.label)).toEqual(expect.arrayContaining(["counterparty", "notional", "maturity"]));
  });
  it("a swap label wins over the loan label (two swaps on one loan stay separate)", () => {
    const a = rec("swap:a", "swap", "over", { notional: 1e7, loanLabel: "L1", swapLabel: "Swap A" }), b = rec("swap:b", "swap", "over", { notional: 5e6, loanLabel: "L1", swapLabel: "Swap B" });
    const p = plan({ swaps: [{ dealId: "over", loanLabel: "L1", swapLabel: "Swap B", notional: 5.5e6 }] }, [a, b]);
    expect(p.rows[0].id).toBe("swap:b");
  });
  it("a covenant with a corrected value REPLACES the one of that type", () => {
    const cov = rec("covenant:old", "covenant", "chili", { type: "LTV", threshold: 70, loanLabel: "Senior Loan" });
    const p = plan({ covenants: [{ dealId: "chili", type: "LTV", threshold: 72, loanLabel: "Senior Loan" }] }, [cov]);
    expect([p.rows[0].action, p.rows[0].id]).toEqual(["update", "covenant:old"]);
    expect(p.rows[0].changes).toEqual([{ field: "threshold", label: "threshold", from: 70, to: 72 }]);
    // A different type is a different covenant.
    expect(plan({ covenants: [{ dealId: "chili", type: "DSCR", threshold: 1.25 }] }, [cov]).rows[0].action).toBe("create");
  });
  it("already-duplicated rows: never guesses — the row is held back with the reason", () => {
    const dup = [loan, rec("loan:dup", "loan", "chili", { lender: "M&T", loanLabel: "Senior Loan", originalBalance: 1, maturityDate: "2030-01-01" })];
    const p = plan({ loans: [{ dealId: "chili", loanLabel: "Senior Loan", originalBalance: 2, maturityDate: "2031-01-01" }] }, dup);
    expect(p.rows).toEqual([]);
    expect(p.rejected[0].problem).toMatch(/2 saved loans already share this label/);
  });
  it("two rows in one import never land on the same saved loan", () => {
    const p = plan({ loans: [{ dealId: "chili", loanLabel: "Senior Loan", originalBalance: 1, maturityDate: "2028-01-01" }, { dealId: "chili", loanLabel: "Senior Loan", originalBalance: 2, maturityDate: "2029-01-01" }] }, [loan]);
    expect(p.rows.map(r => r.action)).toEqual(["update", "create"]);
    expect(new Set(p.rows.map(r => r.id)).size).toBe(2);
  });
});
