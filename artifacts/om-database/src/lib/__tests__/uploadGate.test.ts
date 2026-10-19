import { describe, it, expect } from "vitest";
import { applyDeterministicOverrides, detectTaxBill, detectUtilityBill, detectContract, detectEstoppel, detectSalesReport, DOCUMENT_ONLY_TYPES, matchDeal } from "../docClassify";
import { looksLikeOm, uploadResultFor } from "../uploadGate";
import type { Deal } from "../idb";

// The 10/19/26 Project Evergreen drop: each of these was read as an "om" and became a
// junk deal. Text is the shape of the real first page (property names as Eric reported).
const TAX_BILL = `MORGAN COUNTY TREASURER  2025 PAY 2026 REAL ESTATE TAX STATEMENT
Parcel Number: 55-08-04-300-001.000-012   Tax Year 2025
Property Address: Village of Martinsville  Assessed Value $4,812,300
Spring Installment Due May 11 2026  Amount Due $61,204.18  Delinquent after due date`;
const UTILITY = `Duke Energy  Account Number 9100 2233 4455  Service Address 500 A Hawk Ridge Dr
Billing Period 09/01/2026 - 09/30/2026  Meter Number 3381  Usage 18,442 kWh
Current Charges $2,904.11  Previous Balance $0.00  Total Amount Due $2,904.11`;
const CONTRACT = `DocuSign Envelope ID: 4F2A-11B9
PURCHASE AND SALE AGREEMENT
THIS PURCHASE AND SALE AGREEMENT is made between Pierpont Centre LLC (“Seller”) and KPR Acquisitions LLC (“Purchaser”).
WITNESSETH: Seller agrees to sell the Property. The Deposit shall be held by Escrow Agent. Closing Date shall be thirty days after the Due Diligence Period.`;
const PORTFOLIO_SALES = `PROJECT EVERGREEN — TENANT SALES REPORT (TTM 6/2026)
Wheeler Plaza  Kroger  $41,200,000  $512 PSF
Pierpont Centre  TJ Maxx  $8,900,000  $296 PSF`;
const ESTOPPEL = `TENANT ESTOPPEL CERTIFICATE  The undersigned Tenant certifies to Purchaser that the Lease is in full force.`;
const OM = `PIERPONT CENTRE  Offering Memorandum  Investment Highlights  NOI $3.1M  Cap Rate 7.25%  Offering Summary`;

describe("supporting paperwork is never read as an OM (Project Evergreen, 10/19/26)", () => {
  it("each junk-deal file now classifies as what it is, even when the model said om", () => {
    expect(applyDeterministicOverrides("om", TAX_BILL, "2025 RE Tax Bill.pdf", 1)).toBe("tax-bill");
    expect(applyDeterministicOverrides("om", UTILITY, "Scan_0042.pdf", 2)).toBe("utility-bill");
    expect(applyDeterministicOverrides("om", CONTRACT, "Pierpont - Signed.pdf", 38)).toBe("contract");
    expect(applyDeterministicOverrides("om", PORTFOLIO_SALES, "Evergreen Sales Report.pdf", 3)).toBe("sales");
    expect(applyDeterministicOverrides("unknown", ESTOPPEL, "Kroger.pdf", 3)).toBe("estoppel");
    for (const t of ["tax-bill", "utility-bill", "contract", "estoppel", "lease"] as const) expect(DOCUMENT_ONLY_TYPES.has(t)).toBe(true);
  });
  it("a real OM stays an OM — none of the detectors take it", () => {
    expect(applyDeterministicOverrides("om", OM, "Pierpont Centre - OM.pdf", 42)).toBe("om");
    expect(detectTaxBill(OM + " real estate taxes assessed value", "Pierpont Centre - OM.pdf", 42)).toBe(false);
    expect(detectSalesReport(OM + " tenant sales report", "Pierpont tenant sales.pdf")).toBe(false);
    expect(detectContract("Offering Memorandum. The Purchase and Sale Agreement will be provided. Seller. Closing Date.", "x.pdf")).toBe(false);
    expect(detectUtilityBill(OM, "x.pdf", 42)).toBe(false);
    expect(detectEstoppel(OM, "Pierpont OM.pdf")).toBe(false);
  });
  it("a long OM whose expense page mentions taxes is not a tax bill", () => {
    const longOm = OM + " Real estate taxes: tax year 2025, assessed value, millage, amount due by installment, Treasurer";
    expect(detectTaxBill(longOm, "Deal Book.pdf", 40)).toBe(false);
  });
  it("the leasing-flyer OM safeguards still hold", () => {
    expect(applyDeterministicOverrides("flyer", OM, "Pierpont Centre - OM.pdf", 3)).toBe("om");
  });
});

describe("a tax bill files under the deal it names (name, address or also-known-as)", () => {
  const deals = [
    { id: "d1", propertyName: "Martinsville Shopping Center", address: "1 Main St, Martinsville, IN 46151", state: "IN", alsoKnownAs: ["Village of Martinsville"] },
    { id: "d2", propertyName: "Hawk Ridge Commons", address: "500 A Hawk Ridge Dr, Lake St Louis, MO 63367", state: "MO" },
  ] as unknown as Deal[];
  it("matches on an also-known-as alias", () => {
    expect(matchDeal({ propertyName: "Village of Martinsville", address: null, fileName: "tax.pdf" }, deals).deal?.id).toBe("d1");
  });
  it("matches on the service address", () => {
    expect(matchDeal({ propertyName: null, address: "500 A Hawk Ridge Dr, Lake St Louis, MO 63367", fileName: "bill.pdf" }, deals).deal?.id).toBe("d2");
  });
  it("nothing matches → no deal", () => {
    expect(matchDeal({ propertyName: "Wheeler", address: null, fileName: "sales.pdf" }, deals).deal).toBeNull();
  });
});

describe("the last gate before a new deal", () => {
  it("sale signals, or a real roster with some length, read as an OM; a 1-page notice does not", () => {
    expect(looksLikeOm(OM, 1, null)).toBe(true);
    expect(looksLikeOm("Tenant list", 12, { tenants: [1, 2, 3, 4] })).toBe(true);
    expect(looksLikeOm("Tenant list", 1, { tenants: [1, 2, 3] })).toBe(false);
    expect(looksLikeOm(UTILITY, 2, { tenants: [] })).toBe(false);
  });
  it("upload-log outcome for each final queue state", () => {
    expect(uploadResultFor({ status: "not_added" })).toBe("rejected");
    expect(uploadResultFor({ status: "error" })).toBe("failed");
    expect(uploadResultFor({ status: "done", createdNew: true, appliedDealId: "x" })).toBe("created");
    expect(uploadResultFor({ status: "done", appliedDealId: "x" })).toBe("attached");
    expect(uploadResultFor({ status: "done", msg: "Skipped — “X” is already in the library" })).toBe("skipped");
    expect(uploadResultFor({ status: "done", msg: "Discarded — nothing was saved" })).toBe("skipped");
    expect(uploadResultFor({ status: "done", result: "attached", deal: { id: "d" } })).toBe("attached");
  });
});
