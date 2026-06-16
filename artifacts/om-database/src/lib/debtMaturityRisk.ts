// Live, token-free red flag for a DEBT-MATURITY / refinance wall. When the in-place or
// assumable loan matures within (or near) the planned hold, the deal carries refinance
// risk — re-leveraging at today's higher CRE rates pressures DSCR and proceeds, and a
// low in-place coupon that looks attractive today is exactly what steps UP at refi.
// Computed from the loan/maturity fields already on the deal; no model call.
import type { Deal } from "./idb";
import type { DerivedFlag } from "./expenseRisk";

const num = (v: unknown): number | null => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);

// Years from today until a date or bare-year string; null if unparseable.
function yearsUntil(s: string | null | undefined): number | null {
  if (!s) return null;
  const str = String(s).trim();
  if (/^\d{4}$/.test(str)) return Number(str) - new Date().getFullYear();
  const t = Date.parse(str);
  if (!isNaN(t)) return (t - Date.now()) / (365.25 * 86_400_000);
  const m = str.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) - new Date().getFullYear() : null;
}

export function deriveDebtMaturityFlag(deal: Deal): DerivedFlag | null {
  const hasLoan = !!(deal.debtMaturityDate || deal.loanMaturity || deal.debtLoanAmount || deal.loanBalance || deal.assumableDebt);
  if (!hasLoan) return null;
  const yrs = yearsUntil(deal.debtMaturityDate ?? deal.loanMaturity ?? null);
  if (yrs == null) return null;

  const hold = num(deal.acqHoldPeriod);
  const withinHold = hold != null && hold > 0 ? yrs <= hold : null;
  // Flag if the loan matures within the hold, or within ~3 yrs when no hold is set.
  if (!(withinHold === true || (withinHold == null && yrs <= 3))) return null;

  const rate = num(deal.debtRate) ?? num(deal.loanRate);
  const lowCoupon = rate != null && rate > 0 && rate < 6; // likely below current CRE market
  const assumable = deal.assumableDebt === true || /assum/i.test(String(deal.debtAssumable ?? ""));

  const severity: DerivedFlag["severity"] = yrs <= 2 ? "high" : yrs <= 4 ? "medium" : "low";
  const whenTxt = yrs <= 0 ? "is at or PAST maturity" : `matures in ~${yrs < 1 ? "under a year" : `${Math.round(yrs)} yr${Math.round(yrs) === 1 ? "" : "s"}`}`;
  const holdTxt = withinHold === true && hold != null ? ` — within the ${Math.round(hold)}-yr hold` : "";

  const parts = [`The loan ${whenTxt}${holdTxt}`];
  if (assumable) parts.push(lowCoupon
    ? `the assumable ${rate}% coupon is a value lever, but the near maturity caps how long you keep it — model the take-out refi`
    : `assumable, but the near maturity limits the benefit — model the take-out refi`);
  else parts.push(lowCoupon
    ? `re-leveraging the ${rate}% in-place rate at today's higher CRE rates is a real step-up — stress DSCR and refi proceeds`
    : `refinancing at maturity pressures DSCR and proceeds — stress the take-out at current rates`);

  return {
    severity,
    description: `Debt-maturity / refinance wall — ${parts.join("; ")}. Confirm extension options, prepay/defeasance, and the refinanced constant before crediting in-place leverage.`,
  };
}
