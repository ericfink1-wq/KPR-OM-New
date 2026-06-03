import type { Deal, AmortRow } from "./idb";

export interface AmortResult {
  rows: AmortRow[];                 // one row per scheduled payment
  payment: number | null;          // level amortizing payment (post-IO)
  currentBalance: number | null;   // balance as of `asOf`
  currentRow: AmortRow | null;
  paidOffMonth: number | null;     // months until fully amortized (from origination)
  basis: "generated" | "uploaded";
  source: string;
  assumptions: string[];
  error: string | null;
}

const addMonths = (d: Date, n: number) => {
  const x = new Date(d.getTime());
  x.setMonth(x.getMonth() + n);
  return x;
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Generate a monthly amortization schedule from a deal's debt fields.
 *  - Level-payment amortization over `amortYears`, with an optional interest-only
 *    period (`ioMonths`) up front (interest only, balance flat), after which the
 *    standard amortizing payment applies.
 *  - amortYears = 0 → fully interest-only (balance holds at the loan amount).
 * Deterministic — no AI. Indicative: assumes a fixed rate and level amortization.
 */
export function buildAmortSchedule(opts: {
  loanAmount: number | null;
  annualRatePct: number | null;
  amortYears: number | null;
  ioMonths?: number | null;
  originationDate?: string | null;
  asOf?: string | null;
}): AmortResult {
  const assumptions: string[] = [];
  const base: AmortResult = {
    rows: [], payment: null, currentBalance: null, currentRow: null, paidOffMonth: null,
    basis: "generated", source: "Generated from the loan terms", assumptions, error: null,
  };

  const P = Number(opts.loanAmount);
  const ratePct = Number(opts.annualRatePct);
  if (!P || P <= 0 || isNaN(P)) return { ...base, error: "Enter the original loan amount." };
  if (isNaN(ratePct)) return { ...base, error: "Enter the interest rate." };

  const i = ratePct / 100 / 12;                 // monthly rate
  const amortYears = Number(opts.amortYears) || 0;
  const N = Math.round(amortYears * 12);        // amortizing months (0 = interest-only loan)
  const io = Math.max(0, Math.round(Number(opts.ioMonths) || 0));

  // Level amortizing payment (post-IO). 0-amort = interest-only loan.
  const pmt = N > 0
    ? (i > 0 ? P * i / (1 - Math.pow(1 + i, -N)) : P / N)
    : P * i;
  if (N === 0) assumptions.push("Interest-only loan (no amortization) — principal is due at maturity.");
  if (io > 0) assumptions.push(`${io}-month interest-only period before amortization begins.`);

  const start = opts.originationDate ? new Date(opts.originationDate) : null;
  const totalMonths = io + (N > 0 ? N : 0);
  const rows: AmortRow[] = [];
  let bal = P;
  const cap = N > 0 ? totalMonths : Math.max(io, 1); // IO-only: emit at least the IO/term rows
  const emitMonths = N > 0 ? totalMonths : Math.max(io || 12, 12);
  let paidOff: number | null = null;

  for (let m = 1; m <= emitMonths && bal > 0.005; m++) {
    const interest = bal * i;
    let principal = 0;
    let pay = 0;
    if (m <= io || N === 0) {            // interest-only month
      pay = interest;
      principal = 0;
    } else {
      pay = pmt;
      principal = Math.min(pay - interest, bal);
      pay = interest + principal;        // last payment trims to remaining balance
    }
    bal = Math.round((bal - principal) * 100) / 100;
    rows.push({
      date: start ? iso(addMonths(start, m)) : `M${m}`,
      payment: Math.round(pay * 100) / 100,
      interest: Math.round(interest * 100) / 100,
      principal: Math.round(principal * 100) / 100,
      balance: bal,
    });
    if (bal <= 0.005 && paidOff == null) paidOff = m;
    if (m >= cap && N === 0) break;
  }

  // Current balance: walk the schedule to the months elapsed since origination.
  let currentBalance: number | null = null;
  let currentRow: AmortRow | null = null;
  if (start) {
    const asOf = opts.asOf ? new Date(opts.asOf) : new Date();
    const monthsElapsed = Math.floor((asOf.getTime() - start.getTime()) / (365.25 / 12 * 864e5));
    if (monthsElapsed <= 0) { currentBalance = P; }
    else if (monthsElapsed >= rows.length) { currentBalance = rows.length ? rows[rows.length - 1].balance : P; currentRow = rows[rows.length - 1] ?? null; }
    else { currentRow = rows[monthsElapsed - 1]; currentBalance = currentRow.balance; }
  } else {
    assumptions.push("Add an origination date to compute today's balance.");
  }

  return {
    ...base,
    rows, payment: Math.round(pmt * 100) / 100,
    currentBalance, currentRow, paidOffMonth: paidOff, assumptions,
  };
}

// Read the current balance from an UPLOADED custom schedule: the balance of the
// last row dated on/before `asOf`.
export function currentBalanceFromRows(rows: AmortRow[], asOf?: string | null): { balance: number | null; row: AmortRow | null } {
  if (!rows || rows.length === 0) return { balance: null, row: null };
  const cut = asOf ? new Date(asOf) : new Date();
  let best: AmortRow | null = null;
  for (const r of rows) {
    const d = new Date(r.date);
    if (isNaN(d.getTime())) continue;
    if (d.getTime() <= cut.getTime()) best = r; else break;
  }
  if (!best) return { balance: rows[0]?.balance ?? null, row: rows[0] ?? null };
  return { balance: best.balance, row: best };
}

// Pick the live schedule for a deal: an uploaded custom schedule wins; otherwise
// generate from the debt fields.
export function amortForDeal(deal: Deal, asOf?: string | null): AmortResult {
  const custom = deal.customAmortSchedule;
  if (custom && custom.length > 0) {
    const { balance, row } = currentBalanceFromRows(custom, asOf);
    return {
      rows: custom, payment: null, currentBalance: balance, currentRow: row, paidOffMonth: null,
      basis: "uploaded", source: "Uploaded amortization schedule", assumptions: [], error: null,
    };
  }
  return buildAmortSchedule({
    loanAmount: deal.debtLoanAmount ?? null,
    annualRatePct: deal.debtRate ?? null,
    amortYears: deal.debtAmortYears ?? null,
    ioMonths: deal.debtIOPeriod ?? null,
    originationDate: deal.debtOriginationDate ?? null,
    asOf: asOf ?? null,
  });
}
