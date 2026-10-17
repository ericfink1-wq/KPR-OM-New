import type { RatesPayload } from "./api";

// Loan sizing for the Today's Rates panel (Eric, 10/17/26). All-in rate = a chosen base
// rate + lender spread + bank swap/credit premium + a stress cushion, each kept separate so
// the breakdown is visible. The loan is the LOWEST of the DSCR, debt-yield and LTV loans,
// and the one that binds is named.

export interface BaseRate { id: string; label: string; value: number | null; asOf: string | null; group: "Floating" | "SOFR swap" | "Treasury" }

/** Every base rate the panel can price off, with null where the source has nothing today. */
export function baseRateOptions(d: RatesPayload): BaseRate[] {
  const out: BaseRate[] = [];
  const sofr = (re: RegExp) => d.sofr.rows.find(r => re.test(r.label)) ?? null;
  const on = d.sofrOvernight ?? null;
  out.push({ id: "sofr-on", label: "SOFR (overnight)", value: on?.rate ?? sofr(/overnight/i)?.value ?? null, asOf: on?.date ?? null, group: "Floating" });
  const term = sofr(/term.*1\s*month/i);
  out.push({ id: "term-1m", label: "1M Term SOFR", value: term?.value ?? null, asOf: term?.asOf ?? null, group: "Floating" });
  for (const t of [1, 2, 3, 5, 7, 10]) {
    const p = d.swapCurve?.points.find(x => x.tenor === t) ?? null;
    const row = !p ? d.swaps.rows.find(r => new RegExp(`\\b${t}\\s*Year\\b`, "i").test(r.label) && !/est\./i.test(r.label)) : null;
    out.push({ id: `swap-${t}`, label: `${t}Y SOFR swap`, value: p?.rate ?? row?.value ?? null, asOf: d.swapCurve?.asOf ?? row?.asOf ?? null, group: "SOFR swap" });
  }
  for (const t of [2, 5, 7, 10]) {
    const r = d.treasuries.rows.find(x => x.label === `${t}-Yr`) ?? null;
    out.push({ id: `ust-${t}`, label: `${t}Y Treasury`, value: r?.value ?? null, asOf: r?.asOf ?? d.treasuries.asOf, group: "Treasury" });
  }
  return out;
}

/** Annual debt constant (payment ÷ loan) at `ratePct`; 0 or IO years = interest only. */
export function mortgageConstant(ratePct: number, amortYears: number | null): number {
  const rate = ratePct / 100;
  if (!amortYears || amortYears <= 0) return rate;
  const r = rate / 12, n = amortYears * 12;
  return ((r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)) * 12;
}

export type Constraint = "DSCR" | "Debt yield" | "LTV";
export interface Sizing {
  allIn: number; constant: number;
  loans: Array<{ by: Constraint; amount: number }>;
  max: number | null; binding: Constraint | null;
}

export function sizeLoan(p: { basePct: number; spreadBps: number; premiumBps: number; cushionBps: number; noi: number | null; price: number | null;
  dscr: number; debtYieldPct: number; ltvPct: number; amortYears: number | null }): Sizing {
  const allIn = p.basePct + (p.spreadBps + p.premiumBps + p.cushionBps) / 100;
  const constant = mortgageConstant(allIn, p.amortYears);
  const loans: Sizing["loans"] = [];
  if (p.noi && p.noi > 0 && p.dscr > 0 && constant > 0) loans.push({ by: "DSCR", amount: p.noi / p.dscr / constant });
  if (p.noi && p.noi > 0 && p.debtYieldPct > 0) loans.push({ by: "Debt yield", amount: p.noi / (p.debtYieldPct / 100) });
  if (p.price && p.price > 0 && p.ltvPct > 0) loans.push({ by: "LTV", amount: p.price * (p.ltvPct / 100) });
  const best = loans.length ? loans.reduce((a, b) => (b.amount < a.amount ? b : a)) : null;
  return { allIn, constant, loans, max: best?.amount ?? null, binding: best?.by ?? null };
}
