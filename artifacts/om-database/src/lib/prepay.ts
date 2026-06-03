import type { PrepayTerms, Deal, InterestRateSwap } from "./idb";

export interface PrepayResult {
  penalty: number | null;        // estimated $ penalty (0 = par, no penalty)
  pct: number | null;            // penalty as % of balance
  basis: "exact" | "estimate" | "open" | "locked" | "unknown";
  label: string;                 // short status, e.g. "2% step-down"
  detail: string;                // one-line explanation of the math
  warnings: string[];
}

const yearsBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / (365.25 * 24 * 3600 * 1000);

/**
 * Estimate the prepayment penalty for a loan as of a payoff date.
 *  - stepdown: exact (penalty% by loan year × balance).
 *  - yield_maintenance / defeasance: ESTIMATE — present-value makewhole of the
 *    remaining interest above the matching-tenor Treasury reinvestment rate.
 *  - lockout_open: shows whether prepay is even allowed yet.
 * `reinvestmentRatePct` is the current matching-tenor Treasury (from Today's
 * Rates) used for YM/defeasance; optional.
 */
export function calcPrepay(
  terms: PrepayTerms | null | undefined,
  opts: {
    balance: number | null;            // outstanding principal
    payoffDate: string | null;         // ISO
    originationDate?: string | null;
    maturityDate?: string | null;
    noteRatePct?: number | null;       // the loan's fixed rate
    reinvestmentRatePct?: number | null;
  }
): PrepayResult {
  const warnings: string[] = [];
  const bal = opts.balance;
  const payoff = opts.payoffDate ? new Date(opts.payoffDate) : null;
  if (!terms || terms.type === "none") {
    return { penalty: 0, pct: 0, basis: "open", label: "No prepay penalty", detail: "Loan is freely prepayable at par.", warnings };
  }
  if (!payoff || isNaN(payoff.getTime())) {
    return { penalty: null, pct: null, basis: "unknown", label: "Enter a payoff date", detail: "", warnings };
  }
  if (bal == null || bal <= 0) warnings.push("No outstanding balance entered — penalty shown as % only.");

  // ── Lockout / open window ──────────────────────────────────────────────────
  if (terms.lockoutEnd && payoff < new Date(terms.lockoutEnd)) {
    return { penalty: null, pct: null, basis: "locked", label: "In lockout — prepay not permitted", detail: `Prepayment is locked out until ${terms.lockoutEnd}.`, warnings };
  }
  if (terms.openDate && payoff >= new Date(terms.openDate)) {
    return { penalty: 0, pct: 0, basis: "open", label: "Open — prepayable at par", detail: `Past the open date (${terms.openDate}); no penalty.`, warnings };
  }

  const origin = opts.originationDate ? new Date(opts.originationDate) : null;

  // ── Step-down ──────────────────────────────────────────────────────────────
  if (terms.type === "stepdown") {
    const steps = terms.stepdown || [];
    if (steps.length === 0) return { penalty: null, pct: null, basis: "unknown", label: "Step-down schedule missing", detail: "Add the declining penalty %s.", warnings };
    if (!origin) return { penalty: null, pct: null, basis: "unknown", label: "Origination date needed", detail: "The loan year sets which step applies.", warnings };
    const loanYear = Math.floor(Math.max(0, yearsBetween(origin, payoff))); // 0-indexed
    const pct = loanYear < steps.length ? steps[loanYear] : (terms.floorPenaltyPct ?? 0);
    const penalty = bal != null ? Math.round(bal * (pct / 100)) : null;
    return {
      penalty, pct,
      basis: "exact",
      label: `${pct}% step-down (loan yr ${loanYear + 1})`,
      detail: `Year ${loanYear + 1} penalty is ${pct}% of the $${bal != null ? bal.toLocaleString() : "—"} balance.`,
      warnings,
    };
  }

  // ── Flat premium ────────────────────────────────────────────────────────────
  if (terms.prepayPremiumPct != null) {
    const pct = terms.prepayPremiumPct;
    return { penalty: bal != null ? Math.round(bal * pct / 100) : null, pct, basis: "exact", label: `${pct}% prepayment premium`, detail: `Flat ${pct}% of the balance.`, warnings };
  }

  // ── Yield maintenance / defeasance (ESTIMATE) ───────────────────────────────
  if (terms.type === "yield_maintenance" || terms.type === "defeasance") {
    const note = opts.noteRatePct;
    const reinvest = opts.reinvestmentRatePct;
    const mat = opts.maturityDate ? new Date(opts.maturityDate) : null;
    if (note == null || reinvest == null || !mat || isNaN(mat.getTime())) {
      warnings.push("Needs note rate, a current Treasury reinvestment rate, and maturity date for an estimate.");
      return { penalty: null, pct: null, basis: "unknown", label: terms.type === "defeasance" ? "Defeasance — needs inputs" : "Yield maintenance — needs inputs", detail: "Provide note rate, maturity, and a reinvestment rate.", warnings };
    }
    const yrsLeft = Math.max(0, yearsBetween(payoff, mat));
    const spread = (terms.reinvestmentSpreadBps ?? 0) / 100; // bps→%
    const rateDiff = Math.max(0, (note - (reinvest + spread)) / 100); // annual fraction
    // Present-value the rate differential over the remaining term (simple PV of
    // an annuity at the reinvestment rate). Indicative, not servicer-exact.
    const r = Math.max(0.0001, (reinvest + spread) / 100);
    const pvFactor = (1 - Math.pow(1 + r, -yrsLeft)) / r;
    let penalty = bal != null ? Math.round(bal * rateDiff * pvFactor) : null;
    let pct = bal != null && penalty != null && bal > 0 ? Math.round((penalty / bal) * 1000) / 10 : null;
    // Floor penalty (e.g. "greater of YM or 1%").
    if (terms.floorPenaltyPct != null && bal != null) {
      const floor = Math.round(bal * terms.floorPenaltyPct / 100);
      if (penalty == null || floor > penalty) { penalty = floor; pct = terms.floorPenaltyPct; warnings.push(`Floor of ${terms.floorPenaltyPct}% applied.`); }
    }
    warnings.push("Estimate only — the servicer's exact figure uses specific reinvestment/day-count conventions. Confirm with your servicer.");
    return {
      penalty, pct,
      basis: "estimate",
      label: terms.type === "defeasance" ? "Defeasance (estimate)" : "Yield maintenance (estimate)",
      detail: `~${yrsLeft.toFixed(1)}y remaining; note ${note}% vs reinvest ${(reinvest + spread).toFixed(2)}%.`,
      warnings,
    };
  }

  return { penalty: null, pct: null, basis: "unknown", label: terms.notes ? "See prepay language" : "Prepay terms unclear", detail: terms.notes || "Add structured prepay terms to calculate.", warnings };
}

export interface SwapBreakageResult {
  value: number | null;          // signed $ to the CLIENT: positive = client RECEIVES (gain on unwind), negative = client PAYS (breakage cost)
  direction: "cost" | "credit" | "zero" | null;
  marketRatePct: number | null;  // the current market swap rate used
  remainingYears: number | null;
  basis: "estimate" | "unknown";
  label: string;
  detail: string;
  warnings: string[];
}

/**
 * Estimate the early-termination value (breakage) of an interest-rate swap as of
 * a payoff/valuation date. A swap's unwind value is its mark-to-market: the PV of
 * the difference between the contracted fixed rate and the CURRENT market swap
 * rate for the remaining term, on the notional.
 *
 *   MTM to the fixed-rate payer ≈ Notional × (marketRate − fixedRate) × Annuity(T)
 *
 * For a pay-fixed hedge: if market rates have RISEN above the locked fixed rate,
 * the swap is in-the-money and the client RECEIVES cash on unwind (a credit); if
 * rates have FALLEN, the client PAYS the breakage cost. Indicative only — the
 * exact figure is the dealer's mark using their discount curve and day-count.
 */
export function calcSwapBreakage(
  swap: InterestRateSwap | null | undefined,
  opts: { valuationDate: string | null; marketSwapRatePct: number | null },
): SwapBreakageResult {
  const warnings: string[] = [];
  const none = (label: string, detail: string): SwapBreakageResult =>
    ({ value: null, direction: null, marketRatePct: opts.marketSwapRatePct, remainingYears: null, basis: "unknown", label, detail, warnings });

  if (!swap || swap.notional == null || swap.fixedRatePct == null || !swap.terminationDate) {
    return none("Swap terms incomplete", "Need notional, fixed rate, and termination date to estimate breakage.");
  }
  const val = opts.valuationDate ? new Date(opts.valuationDate) : null;
  const term = new Date(swap.terminationDate);
  if (!val || isNaN(val.getTime()) || isNaN(term.getTime())) return none("Enter a payoff date", "Set the payoff/valuation date.");

  const T = Math.max(0, yearsBetween(val, term));
  if (T <= 0) {
    return { value: 0, direction: "zero", marketRatePct: opts.marketSwapRatePct, remainingYears: 0, basis: "estimate",
      label: "Swap already matured", detail: "Payoff is on/after the swap termination date — no breakage.", warnings };
  }
  const S = opts.marketSwapRatePct;
  if (S == null) {
    warnings.push("Enter the current market swap rate for the remaining term (your bank can quote it) to estimate breakage.");
    return { value: null, direction: null, marketRatePct: null, remainingYears: T, basis: "unknown",
      label: "Needs current swap rate", detail: `~${T.toFixed(1)}y left; locked fixed ${swap.fixedRatePct}%.`, warnings };
  }

  const K = swap.fixedRatePct;
  const s = Math.max(0.0001, S / 100);
  const annuity = (1 - Math.pow(1 + s, -T)) / s;        // PV of $1/yr for T years at the market rate
  const payFixed = swap.payFixed !== false;             // default to the usual pay-fixed hedge
  let mtm = swap.notional * ((S - K) / 100) * annuity;  // MTM to the fixed-rate payer
  if (!payFixed) mtm = -mtm;
  const value = Math.round(mtm);
  const direction: SwapBreakageResult["direction"] = value > 0 ? "credit" : value < 0 ? "cost" : "zero";

  warnings.push("Estimate only — the exact breakage is your swap dealer's mark-to-market (their discount curve & day-count). Confirm with the bank before payoff.");
  return {
    value, direction, marketRatePct: S, remainingYears: T, basis: "estimate",
    label: direction === "credit" ? "Swap breakage — credit to you" : direction === "cost" ? "Swap breakage — cost to you" : "Swap at par",
    detail: `${payFixed ? "Pay-fixed" : "Receive-fixed"} ${K}% vs current market ${S.toFixed(2)}% over ~${T.toFixed(1)}y on $${swap.notional.toLocaleString()} notional.`,
    warnings,
  };
}

// Build calculator inputs from a deal's debt fields.
export function prepayInputsFromDeal(deal: Deal, payoffDate: string | null, reinvestmentRatePct: number | null) {
  return {
    balance: deal.debtLoanAmount ?? null,
    payoffDate,
    originationDate: deal.debtOriginationDate ?? null,
    maturityDate: deal.debtMaturityDate ?? null,
    noteRatePct: deal.debtRate ?? null,
    reinvestmentRatePct,
  };
}
