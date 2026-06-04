import type { Deal, PrepayTerms, ReviewQuestion } from "./idb";
import { apiAiMessages, lessonGuidanceClient } from "./api";
import { robustParseJSON, parseAiReviewQuestions } from "./utils";

// Financing + acquisition fields a loan agreement / credit agreement / term sheet
// / closing statement can disclose. Mirrors the deal page's TermSheetImport so the
// bulk uploader and the per-deal importer fill the same fields the same way.
const LOAN_SCHEMA: Record<string, string> = {
  txnPurchasePrice: "purchase price (number)", txnSeller: "seller / counterparty", txnCloseDate: "closing date YYYY-MM-DD",
  acqEntity: "acquiring entity / borrower", acqClosingCosts: "closing costs (number)", acqTitleCo: "title company", acqCounsel: "legal counsel",
  debtLender: "lender", debtType: "loan type (Senior, Mezzanine, Construction, Bridge…)", debtLoanAmount: "loan amount (number)",
  debtRate: "interest rate %", debtRateType: "Fixed or Floating", debtIndex: "floating index (e.g. SOFR)", debtSpread: "spread in bps (number)",
  debtOriginationDate: "origination/closing date YYYY-MM-DD", debtMaturityDate: "maturity date YYYY-MM-DD", debtTermYears: "term years",
  debtAmortYears: "amortization years", debtIOPeriod: "interest-only months", debtLTV: "LTV %", debtDSCR: "DSCR (number)",
  debtRecourse: "recourse (Recourse/Non-recourse)", debtPrepay: "prepayment terms (free text)", debtExtensions: "extension options",
  debtEscrows: "escrows / reserves", debtAssumable: "assumable", debtLoanNumber: "loan number", debtContact: "lender contact",
};
const NUMERIC = new Set([
  "txnPurchasePrice", "acqClosingCosts", "debtLoanAmount", "debtRate", "debtSpread",
  "debtTermYears", "debtAmortYears", "debtIOPeriod", "debtLTV", "debtDSCR",
]);

export interface LoanResult {
  fields: Record<string, unknown>;
  prepayTerms: PrepayTerms | null;
  reviewQuestions?: ReviewQuestion[];
}

// Extract financing terms from a loan agreement / credit agreement / promissory
// note / loan term sheet / closing statement. Uses Sonnet — these are long legal
// documents where accuracy matters.
export async function extractLoan(text: string): Promise<LoanResult> {
  const prompt = `You extract acquisition and FINANCING terms from a commercial real estate loan agreement, credit agreement, promissory note, loan term sheet, or closing statement. Output ONLY one JSON object with exactly these keys plus "prepayTerms"; use null for anything not clearly stated. Money = plain numbers (no $/commas); percentages = numbers (6.25 not "6.25%"); spread = basis points (165 not 1.65).

Keys and meanings: ${JSON.stringify(LOAN_SCHEMA)}

ALSO include a "prepayTerms" object with the structured PREPAYMENT penalty terms:
{"type":"stepdown|yield_maintenance|defeasance|lockout_open|none|other","stepdown":[declining penalty %s by loan year, e.g. [3,2,1], else null],"lockoutEnd":"YYYY-MM-DD first date prepay is allowed, else null","openDate":"YYYY-MM-DD first date prepayable at par, else null","reinvestmentSpreadBps":"bps over the matching Treasury for YM/defeasance, else null","floorPenaltyPct":"minimum penalty % (e.g. 'greater of YM or 1%'), else null","prepayPremiumPct":"a single flat premium % if that's the whole penalty, else null","notes":"the verbatim prepay language"}.
Pick the type: a declining % schedule = stepdown; make-whole vs Treasuries = yield_maintenance; defeasance = defeasance; lockout then open/par = lockout_open; freely prepayable = none. If prepayment isn't addressed, set prepayTerms to null.

ACCURACY NOTES (these documents are legal/precise — get them right):
- INTEREST RATE: for a FIXED loan, debtRate is the all-in note rate. For a FLOATING loan, set debtRateType "Floating", capture debtIndex (e.g. SOFR) and debtSpread (bps), and put the all-in rate in debtRate ONLY if a current/initial all-in rate is actually stated — otherwise leave debtRate null rather than guessing.
- AMOUNTS: capture the committed/face loan amount as debtLoanAmount (not the funded-to-date or a future earn-out tranche unless that's all there is). LTV/DSCR as the document states them.
- DATES: origination/closing vs maturity are different — don't swap them. Term years should reconcile with origination→maturity.

ALSO include a "reviewQuestions" array — FLAG DOUBT so the user can confirm/fix. Add an item ONLY when you genuinely could not capture a value with confidence, e.g.: a rate you weren't sure was the all-in vs the spread; an amount that could be the commitment vs a tranche; a date you couldn't tell was origination vs maturity; an LTV/DSCR that was hard to read; or conflicting figures in the document. Each: {"severity":"high|medium|low","field":"human label e.g. 'Interest rate'","question":"short confirm question","detail":"1 sentence on the ambiguity","suggestedValue":"what you captured, as a string","target":{"kind":"deal","fieldKey":"<one of the keys above, e.g. debtRate, debtLoanAmount, debtMaturityDate, debtLTV, txnPurchasePrice>","valueType":"number|text"}}. Do NOT flag values simply absent (those are null). Empty array if clean. Cap ~4.

${await lessonGuidanceClient("loan")}
LOAN DOCUMENT TEXT:
${text.slice(0, 60000)}

Return ONLY the JSON object, no prose.`;

  const res = await apiAiMessages({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = res.content?.find(c => c.type === "text")?.text ?? "";
  let out: Record<string, unknown>;
  try { out = robustParseJSON(raw) as Record<string, unknown>; }
  catch { throw new Error("Couldn't read the loan document. Try a clearer file."); }

  const fields: Record<string, unknown> = {};
  for (const k of Object.keys(LOAN_SCHEMA)) {
    const v = out[k];
    if (v == null || v === "") continue;
    fields[k] = NUMERIC.has(k) && !isNaN(Number(v)) ? Number(v) : v;
  }
  const pt = out.prepayTerms && typeof out.prepayTerms === "object" ? out.prepayTerms as PrepayTerms : null;
  if (Object.keys(fields).length === 0 && (!pt || !pt.type)) {
    throw new Error("No financing terms found — this may not be a loan document.");
  }
  const reviewQuestions = parseAiReviewQuestions(out.reviewQuestions, "ai-loan-");
  return { fields, prepayTerms: pt && pt.type ? pt : null, reviewQuestions };
}

// ENRICH-ONLY: fill BLANK debt/acq fields from the loan doc (never overwrite an
// existing value), plus structured prepayTerms if the deal has none. Defaults the
// loan to Senior when no type is present.
export function buildLoanPatch(deal: Deal, result: LoanResult): Partial<Deal> {
  const patch: Record<string, unknown> = {};
  const ex = deal as unknown as Record<string, unknown>;
  const blank = (v: unknown) => v == null || v === "";
  for (const k of Object.keys(LOAN_SCHEMA)) {
    if (!blank(result.fields[k]) && blank(ex[k])) patch[k] = result.fields[k];
  }
  if (result.prepayTerms && blank(deal.prepayTerms)) patch.prepayTerms = result.prepayTerms;
  if (blank(deal.debtType) && blank(patch.debtType)) patch.debtType = "Senior / Acquisition";

  // Flag doubt for one-tap review/fix. Three sources: the model's low-confidence
  // flags; a deterministic LTV tie-out; and — importantly — CONFLICTS, where the
  // loan doc disagrees with a value the deal already has (this enricher keeps the
  // old value, so without a flag the new term would be silently ignored).
  const f = result.fields;
  const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const det: ReviewQuestion[] = [];

  const conflict = (key: string, label: string, isDate: boolean) => {
    const docV = f[key], exV = ex[key];
    if (blank(docV) || blank(exV)) return;
    const differs = isDate
      ? String(docV).slice(0, 10) !== String(exV).slice(0, 10)
      : (() => { const a = num(docV), b = num(exV); return a != null && b != null && Math.abs(a - b) > Math.max(Math.abs(b) * 0.02, key === "debtRate" ? 0.1 : 1); })();
    if (!differs) return;
    det.push({
      id: `ai-loan-conflict-${key}`, source: "ai", severity: "high",
      field: label,
      question: `${label}: the loan doc says ${docV}, but the deal already has ${exV} — which is correct?`,
      detail: "The upload kept the existing value; confirm or replace it.",
      suggestedValue: String(docV),
      target: { kind: "deal", fieldKey: key, tenantName: null, valueType: isDate ? "text" : "number" },
    });
  };
  conflict("debtLoanAmount", "Loan amount", false);
  conflict("debtRate", "Interest rate", false);
  conflict("debtMaturityDate", "Maturity date", true);
  conflict("txnPurchasePrice", "Purchase price", false);

  // LTV tie-out: stated LTV vs loan ÷ price.
  const ltv = num(f.debtLTV), loan = num(f.debtLoanAmount) ?? num(ex.debtLoanAmount), price = num(f.txnPurchasePrice) ?? num(ex.txnPurchasePrice);
  if (ltv != null && loan != null && price != null && price > 0) {
    const implied = (loan / price) * 100;
    if (Math.abs(implied - ltv) > 3) {
      det.push({
        id: "ai-loan-ltv-tie", source: "ai", severity: "medium",
        field: "LTV",
        question: `Confirm the LTV — stated ${ltv}% but loan ÷ price ≈ ${implied.toFixed(0)}%.`,
        detail: `$${Math.round(loan).toLocaleString()} ÷ $${Math.round(price).toLocaleString()} ≈ ${implied.toFixed(1)}%.`,
        suggestedValue: `${ltv}%`,
        target: { kind: "deal", fieldKey: "debtLTV", tenantName: null, valueType: "number" },
      });
    }
  }

  const newLoanFlags = [...(result.reviewQuestions ?? []), ...det];
  // id ?? "" — OM-extracted reviewQuestions carry no id; a bare .startsWith throws.
  const hadLoanFlags = (deal.reviewQuestions ?? []).some(q => (q.id ?? "").startsWith("ai-loan-"));
  // Only touch reviewQuestions when there are new loan flags to add or stale ones
  // to clear — keeps an enrich-only loan upload from rewriting the array needlessly.
  if (newLoanFlags.length || hadLoanFlags) {
    const priorFlags = (deal.reviewQuestions ?? []).filter(q => !(q.id ?? "").startsWith("ai-loan-"));
    patch.reviewQuestions = [...priorFlags, ...newLoanFlags];
  }
  return patch as Partial<Deal>;
}
