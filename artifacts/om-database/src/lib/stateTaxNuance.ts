// Live, token-free REMINDER for state-specific tax nuances that are easy to forget
// when underwriting and that hit ENTITY-level (after-tax) returns — not the property
// tax bill. Keyed by deal.state; extend the map as more come up. Phrased as a "don't
// forget" prompt with the tax NAMED (names are stable); rates change, so confirm the
// current rate rather than hard-coding it here.
import type { Deal } from "./idb";
import type { DerivedFlag } from "./expenseRisk";

const STATE_TAX_NUANCES: Record<string, string> = {
  NH: "New Hampshire has no general sales tax and no tax on wage income, BUT it levies the Business Profits Tax (BPT) and the Business Enterprise Tax (BET) on business income/enterprise value, and its effective property taxes are among the highest in the country. Don't forget BPT/BET in the entity's after-tax returns.",
  TN: "Tennessee has no personal income tax, BUT the entity owes Franchise & Excise (F&E) tax — an excise on net earnings plus a franchise tax on the greater of net worth or real/tangible property — and a local business (gross-receipts) tax. Don't forget F&E in the after-tax returns.",
  WA: "Washington has no corporate income tax, BUT the Business & Occupation (B&O) tax applies to gross receipts (not net income), and the Real Estate Excise Tax (REET) on the sale is graduated and significant. Confirm B&O and REET treatment.",
  OH: "Ohio has no corporate income tax, BUT the Commercial Activity Tax (CAT) applies to gross receipts. Don't forget CAT in entity returns.",
  TX: "Texas has no personal/corporate income tax, BUT the Franchise (margin) tax applies to entities above the no-tax-due threshold, and property taxes are high with no sale-price disclosure (non-disclosure state). Confirm margin-tax and the protest/assessment dynamic.",
};

export function deriveStateTaxNuanceFlag(deal: Deal): DerivedFlag | null {
  const st = (deal.state || "").trim().toUpperCase();
  const note = STATE_TAX_NUANCES[st];
  if (!note) return null;
  return { severity: "low", description: `State tax reminder — ${note}` };
}
