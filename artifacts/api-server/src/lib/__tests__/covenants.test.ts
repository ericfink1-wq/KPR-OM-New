import { describe, it, expect } from "vitest";
import { parseCovenantText, proposeCovenants } from "../covenants";
import { planImport, extractDocs, sanitizeAcquisition, sanitizeLoan, type AmRecord } from "../assetMgmt";

describe("covenant text parser", () => {
  it("reads DSCR threshold, frequency, first test, amortization basis and sweep level", () => {
    const [c] = parseCovenantText("Min DSCR 1.25x on a 25-yr amortization, tested each 12/31; cash sweep below 1.20x");
    expect(c).toMatchObject({ type: "DSCR", threshold: 1.25, amortYears: 25, testFrequency: "annual", testMonthDay: "12-31" });
    const q = parseCovenantText("DSCR >= 1.25x tested quarterly beginning 3/31/27")[0];
    expect(q).toMatchObject({ type: "DSCR", threshold: 1.25, testFrequency: "quarterly", firstTestDate: "2027-03-31" });
  });
  it("debt yield, LTV and an undated sweep become their own rows; nothing invented", () => {
    const rows = parseCovenantText("Debt yield of 9.0% tested annually; LTV right-size to 65%; cash sweep if Target does not extend by 7/31/2027");
    expect(rows.map(r => [r.type, r.threshold ?? r.triggerDate])).toEqual([["DY", 9], ["LTV", 65], ["cash-sweep", "2027-07-31"]]);
    expect(parseCovenantText("Standard reporting covenants.")).toEqual([]);
  });
});

describe("covenant proposals", () => {
  const rec = (id: string, kind: AmRecord["kind"], dealId: string, data: Record<string, unknown>): AmRecord => ({ id, kind, dealId, data, sourceNote: null, updatedBy: null, updatedAt: "" });
  it("seed links to the one loan whose lender matches; loan text adds what the seed lacks; existing rows are left alone", () => {
    const overland = "1780329443422-lhiainq";
    const records = [
      rec("loan:o", "loan", overland, { lender: "Old National Bank", covenants: "Debt yield 8.5% tested annually" }),
      rec("covenant:x", "covenant", overland, { loanId: "loan:o", type: "cash-sweep" }),
    ];
    const { proposals } = proposeCovenants(records, new Set([overland]));
    expect(proposals.map(p => [p.from, p.data.type, p.loanId])).toEqual([["seed", "DSCR", "loan:o"], ["parsed", "DY", "loan:o"]]);
    expect(proposals[0].data).toMatchObject({ threshold: 1.25, testFrequency: "quarterly", firstTestDate: "2027-03-31" });
  });
  it("month-37 right-size gets a date only from a real origination date", () => {
    const oak = "1781014639066-8oxnpup";
    const p = proposeCovenants([rec("loan:k", "loan", oak, { lender: "ONB", originationDate: "2025-03-15" })], new Set([oak])).proposals;
    expect(p.find(x => x.data.type === "LTV")!.data.triggerDate).toBe("2028-03-15");
    const q = proposeCovenants([rec("loan:k", "loan", oak, { lender: "ONB" })], new Set([oak])).proposals;
    expect(q.find(x => x.data.type === "LTV")!.data.triggerDate).toBeUndefined();
  });
});

describe("imports keep what they don't model", () => {
  const OWNED = [{ id: "d", name: "Overland Plaza", bldgIds: ["overland"] }];
  it("unknown columns survive and Drive file ids become links", () => {
    const p = planImport(JSON.stringify({ loans: [{ dealId: "d", lender: "ONB", originalBalance: 1e7, maturityDate: "2030-01-15", lenderContact: "J. Smith", driveFileIds: ["1AbCdEfGhIjKlMnOpQrStUvWxYz0123"], loanAgreementUrl: "https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa98765/view" }] }), OWNED, new Set());
    expect(p.rows[0].data).toMatchObject({ lenderContact: "J. Smith" });
    expect((p.rows[0].data.sourceDocs as Array<{ id: string }>).map(x => x.id)).toEqual(["1AbCdEfGhIjKlMnOpQrStUvWxYz0123", "1ZyXwVuTsRqPoNmLkJiHgFeDcBa98765"]);
    expect(extractDocs({ docs: [{ name: "Loan agreement", fileId: "1QqQqQqQqQqQqQqQqQqQqQqQqQqQ" }] })).toEqual([{ id: "1QqQqQqQqQqQqQqQqQqQqQqQqQqQ", name: "Loan agreement" }]);
  });
  it("acquisition: one per property, budget year read from the column name", () => {
    expect(sanitizeAcquisition({ purchasePrice: "28,700,000", closeDate: "1/15/2025", kpPct: 0.1, budgetNoi2026: 2_400_000 })).toMatchObject({ purchasePrice: 28_700_000, closeDate: "2025-01-15", kpPct: 10, budgetNoi: 2_400_000, budgetYear: 2026 });
    const a = planImport(JSON.stringify({ acquisitions: [{ property: "Overland Plaza", purchasePrice: 28.7e6 }, { dealId: "d", purchasePrice: 28.8e6, seller: "X" }] }), OWNED, new Set());
    expect(a.rows[0].id).toBe(a.rows[1].id);
  });
});

describe("IO period read from the amortization text", () => {
  it("Overland: IO to 1/15/2030 then 30-yr amortization", () => {
    expect(sanitizeLoan({ amortization: "IO to 1/15/2030, then 30-yr amortization" })).toMatchObject({ amortization: "IO", ioUntil: "2030-01-15", amortYears: 30 });
    expect(sanitizeLoan({ amortization: "25-year amortization" })).toMatchObject({ amortization: "amortizing", amortYears: 25 });
  });
});
