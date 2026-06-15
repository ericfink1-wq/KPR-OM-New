// Live, token-free red flag for TENANT CONCENTRATION (+ the concentrated tenant's
// credit). A single tenant carrying a large share of base rent is an outsized
// single-point-of-failure; it's worse when that tenant isn't investment-grade.
//
// Note: we deliberately do NOT flag "overall % of rent from non-IG tenants" — most
// retail centers are majority inline (non-credit) shops, so that would fire on nearly
// every deal. The meaningful credit signal is whether the CONCENTRATED tenant is
// non-investment-grade.
import type { Deal } from "./idb";
import type { DerivedFlag } from "./expenseRisk";
import { isVacant, isNAPTenant, tenantLabel } from "./utils";
import { isInvestmentGrade } from "./tenantCredit";

const num = (v: unknown): number | null => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
const CONC_PCT = 30;  // single tenant >= this % of base rent = flag
const HIGH_PCT = 40;  // >= this = high severity

export function deriveConcentrationFlag(deal: Deal): DerivedFlag | null {
  const tenants = (deal.tenants || []).filter(t => !isVacant(t.name) && !isNAPTenant(t));
  const totalRent = tenants.reduce((s, t) => s + (num(t.annualRent) || 0), 0);
  if (totalRent <= 0 || tenants.length < 2) return null;

  let top = tenants[0]; let topRent = num(top.annualRent) || 0;
  for (const t of tenants) { const r = num(t.annualRent) || 0; if (r > topRent) { top = t; topRent = r; } }
  const topPct = (topRent / totalRent) * 100;
  if (topPct < CONC_PCT) return null;

  const name = tenantLabel(top.canonicalName || top.name || "the top tenant");
  const nonIg = !isInvestmentGrade(top.name || "", top.creditRating);
  const severity: DerivedFlag["severity"] = (topPct >= HIGH_PCT || nonIg) ? "high" : "medium";
  const creditNote = nonIg
    ? ` and is not investment-grade — a non-credit tenant carries the center`
    : ` (investment-grade)`;
  return {
    severity,
    description: `Tenant concentration — ${name} is ~${Math.round(topPct)}% of base rent${creditNote}. A vacancy, go-dark or renewal failure there is an outsized hit; stress the deal without it and confirm lease term/options/credit.`,
  };
}
