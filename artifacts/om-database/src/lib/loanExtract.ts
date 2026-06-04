import type { Deal, PrepayTerms } from "./idb";
import { apiAiMessages, lessonGuidanceClient } from "./api";
import { robustParseJSON } from "./utils";

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

${await lessonGuidanceClient("loan")}
LOAN DOCUMENT TEXT:
${text.slice(0, 60000)}

Return ONLY the JSON object, no prose.`;

  const res = await apiAiMessages({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
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
  return { fields, prepayTerms: pt && pt.type ? pt : null };
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
  return patch as Partial<Deal>;
}
