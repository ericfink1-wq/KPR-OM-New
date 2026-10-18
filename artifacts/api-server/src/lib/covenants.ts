import { sanitizeCovenant, recordId, type AmRecord } from "./assetMgmt";

// COVENANT DETECTION (Eric, 10/18/26). Two deterministic sources, no AI:
//  1. KPR's own list of the covenants that matter (COVENANT_SEED, from Eric's deal-page brief);
//  2. a parser over the `covenants` text already on each loan row (from the loan-summary seed).
// Nothing is written here: the route returns PROPOSALS, an admin previews and saves them, and
// every saved row stays editable. A proposal only links to a loan when exactly one loan at the
// property matches the lender — never a guess between two.

export interface CovenantProposal { dealId: string; loanId: string | null; data: Record<string, unknown>; sourceNote: string; id: string; from: "seed" | "parsed" }

interface SeedRow { dealId: string; property: string; lender: RegExp; rows: Array<Record<string, unknown>> }
const SRC = "KPR covenant brief (Eric, 10/18/26)";
export const COVENANT_SEED: SeedRow[] = [
  { dealId: "1780329443422-lhiainq", property: "Overland Plaza", lender: /old national|\bonb\b/i, rows: [
    { type: "DSCR", threshold: 1.25, testFrequency: "quarterly", firstTestDate: "2027-03-31" },
    { type: "cash-sweep", linkedTenant: "Schnucks", triggerDate: "2029-09-29", trigger: "Cash sweep if the Schnucks lease is not extended through loan maturity by 9/29/29; also on a Schnucks go-dark or termination." },
  ] },
  { dealId: "1780523109338-edgib3o", property: "Markland Mall", lender: /old national|\bonb\b/i, rows: [
    { type: "DSCR", threshold: 1.30, testFrequency: "quarterly" },
    { type: "cash-sweep", linkedTenant: "Target", triggerDate: "2027-07-31", trigger: "Cash sweep if Target has not extended by 7/31/2027." },
  ] },
  { dealId: "1781025338669-1roz0kp", property: "Schaumburg Corners", lender: /webster/i, rows: [
    { type: "DSCR", threshold: 1.25, amortYears: 25, testFrequency: "annual", testMonthDay: "12-31", sweepBelow: 1.20, trigger: "DSCR on a 25-year amortization tested each 12/31; cash sweep below 1.20x." },
  ] },
  { dealId: "1780613740288-v9q8cbh", property: "Mattatuck Commons", lender: /webster/i, rows: [
    { type: "DSCR", threshold: 1.25, amortYears: 30, testFrequency: "annual", testMonthDay: "12-31", sweepBelow: 1.20, trigger: "DSCR on a 30-year amortization tested each 12/31; cash sweep below 1.20x." },
  ] },
  { dealId: "1781014639066-8oxnpup", property: "Oakleaf Town Center", lender: /old national|\bonb\b/i, rows: [
    { type: "DSCR", threshold: 1.25, testFrequency: "quarterly", firstTestDate: "2026-06-30" },
    { type: "LTV", threshold: 65, trigger: "Loan right-sizes to 65% LTV at month 37.", monthOfLoan: 37 },
  ] },
  { dealId: "1780517122455-qyot8u6", property: "Pointe Plaza", lender: /bankunited/i, rows: [{ type: "DSCR", threshold: 1.15, testFrequency: "annual" }] },
  { dealId: "1780613799450-k9l8pn8", property: "Concordia Shopping Center", lender: /bankunited/i, rows: [{ type: "DSCR", threshold: 1.15 }] },
  { dealId: "1780525175960-xqsgjrd", property: "Eagle Plaza", lender: /bankunited/i, rows: [{ type: "DSCR", threshold: 1.15 }] },
  { dealId: "1780537569216-pg31r16", property: "Lakeland Park Center", lender: /wells/i, rows: [
    { type: "cash-trap", threshold: 1.25, linkedTenant: "Dick's Sporting Goods; Floor & Decor", trigger: "Cash trap below 1.25x DSCR, or on a Dick's Sporting Goods / Floor & Decor event." },
  ] },
];

const DATE = /(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/;
const iso = (m: RegExpExecArray | null): string | undefined => m ? `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : undefined;

/** Pull structured covenants out of free text like "DSCR >= 1.25x tested quarterly beginning 3/31/27;
 *  cash sweep < 1.20x; debt yield 9%". Only what the text states; anything unclear is left out. */
export function parseCovenantText(textIn: string): Array<Record<string, unknown>> {
  const t = (textIn || "").replace(/\s+/g, " ");
  const out: Array<Record<string, unknown>> = [];
  const freqOf = (x: string) => /quarter/i.test(x) ? "quarterly" : /semi-?annual/i.test(x) ? "semi-annual" : /month/i.test(x) ? "monthly" : /annual|each 12\/31|year-?end|yearly/i.test(x) ? "annual" : undefined;
  for (const clause of t.split(/[;\n]|(?<=\.)\s(?=[A-Z])/)) {
    const c = clause.trim(); if (!c) continue;
    const dscr = /(?:DSCR|debt service coverage)[^0-9]{0,40}?(\d\.\d{1,2})\s*x?/i.exec(c);
    const sweep = /(?:sweep|trap|cash management)[^0-9]{0,40}?(\d\.\d{1,2})\s*x/i.exec(c);
    const dy = /debt yield[^0-9]{0,30}?(\d{1,2}(?:\.\d+)?)\s*%/i.exec(c);
    const ltv = /\bLTV\b[^0-9]{0,30}?(\d{2}(?:\.\d+)?)\s*%/i.exec(c);
    const amort = /(\d{2})[- ]?(?:yr|year)s?\s+amort/i.exec(c);
    const first = /(?:from|beginning|commencing|starting|first test(?:ed)?(?: on)?)\s+(\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})(?!\d))/i.exec(c);
    const f = freqOf(c), md = /each (\d{1,2})\/(\d{1,2})\b/.exec(c);
    if (dscr && !/(?:sweep|trap)[^0-9]{0,40}?\d\.\d/i.test(c.slice(0, dscr.index + 1))) {
      out.push(sanitizeCovenant({ type: "DSCR", threshold: dscr[1], amortYears: amort?.[1], testFrequency: f, firstTestDate: first ? iso(DATE.exec(first[1])) : undefined,
        testMonthDay: md ? `${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}` : undefined, sweepBelow: sweep?.[1], trigger: c.slice(0, 600), confidence: "parsed from loan text" }));
    } else if (sweep) {
      out.push(sanitizeCovenant({ type: /trap|management/i.test(c) ? "cash-trap" : "cash-sweep", threshold: sweep[1], trigger: c.slice(0, 600), confidence: "parsed from loan text" }));
    } else if (/cash (?:sweep|trap)/i.test(c)) {
      const d = DATE.exec(c);
      out.push(sanitizeCovenant({ type: /trap/i.test(c) ? "cash-trap" : "cash-sweep", triggerDate: iso(d), trigger: c.slice(0, 600), confidence: "parsed from loan text" }));
    }
    if (dy) out.push(sanitizeCovenant({ type: "DY", threshold: dy[1], testFrequency: f, trigger: c.slice(0, 600), confidence: "parsed from loan text" }));
    if (ltv) out.push(sanitizeCovenant({ type: "LTV", threshold: ltv[1], trigger: c.slice(0, 600), confidence: "parsed from loan text" }));
  }
  return out;
}

const addMonths = (isoD: string, m: number): string => { const d = new Date(isoD + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };

/** Proposals for every owned deal: the seed first, then anything the loan text adds that the
 *  seed doesn't already cover (same loan + same type). Existing covenant rows are left alone. */
export function proposeCovenants(records: AmRecord[], ownedIds: Set<string>): { proposals: CovenantProposal[]; notes: string[] } {
  const loans = records.filter(r => r.kind === "loan" && r.dealId && ownedIds.has(r.dealId) && !r.id.startsWith("datex-loan:"));
  const existing = records.filter(r => r.kind === "covenant");
  const proposals: CovenantProposal[] = [], notes: string[] = [];
  // Same property + same type is a duplicate unless both name DIFFERENT loans (a covenant
  // saved without a loan link covers every loan at the property).
  const sameLoan = (a: unknown, b: string | null) => !a || !b || a === b;
  const has = (dealId: string, loanId: string | null, type: unknown) =>
    existing.some(e => e.dealId === dealId && e.data.type === type && sameLoan(e.data.loanId, loanId)) ||
    proposals.some(p => p.dealId === dealId && p.data.type === type && sameLoan(p.loanId, loanId));
  for (const seed of COVENANT_SEED) {
    if (!ownedIds.has(seed.dealId)) { notes.push(`${seed.property}: not an owned deal here — seed skipped`); continue; }
    const mine = loans.filter(l => l.dealId === seed.dealId);
    const hit = mine.filter(l => seed.lender.test(String(l.data.lender ?? "")));
    const loan = hit.length === 1 ? hit[0] : mine.length === 1 ? mine[0] : null;
    if (!loan) notes.push(`${seed.property}: ${hit.length > 1 ? "several loans match the lender" : "no matching loan on file"} — covenant saved to the property, link it to a loan by hand`);
    for (const row of seed.rows) {
      const raw: Record<string, unknown> = { ...row, loanId: loan?.id, loanLabel: loan?.data.loanLabel, confidence: "KPR brief" };
      if (row.monthOfLoan && loan?.data.originationDate) raw.triggerDate = addMonths(String(loan.data.originationDate), Number(row.monthOfLoan) - 1);
      const data = sanitizeCovenant(raw);
      if (has(seed.dealId, loan?.id ?? null, data.type)) continue;
      proposals.push({ dealId: seed.dealId, loanId: loan?.id ?? null, data, sourceNote: SRC, id: recordId("covenant", seed.dealId, data), from: "seed" });
    }
  }
  for (const l of loans) {
    const txt = [l.data.covenants, l.data.notes].filter(Boolean).map(String).join("; ");
    if (!txt) continue;
    for (const c of parseCovenantText(txt)) {
      const data: Record<string, unknown> = { ...c, loanId: l.id, ...(l.data.loanLabel ? { loanLabel: l.data.loanLabel } : {}) };
      if (has(l.dealId!, l.id, data.type)) continue;
      proposals.push({ dealId: l.dealId!, loanId: l.id, data, sourceNote: `Parsed from the loan's covenant text${l.sourceNote ? ` (${l.sourceNote})` : ""}`, id: recordId("covenant", l.dealId!, data), from: "parsed" });
    }
  }
  return { proposals, notes };
}
