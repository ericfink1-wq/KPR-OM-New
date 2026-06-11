import type { Deal, InterestRateSwap } from "./idb";
import { apiAiMessages, lessonGuidanceClient } from "./api";
import { robustParseJSON } from "./utils";

// Recognize a free-text floating-rate index against the common CRE benchmarks, so the
// swap editor can confirm (green check) that what was typed IS a known index, and name
// it. Returns null when blank/unrecognized; warn=true for legacy/discontinued benchmarks
// (LIBOR, BSBY) that should no longer be the operative index.
export function recognizeRateIndex(raw: string | null | undefined): { label: string; note?: string; warn?: boolean } | null {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return null;
  const tenor = (): string | null => {
    const m = t.match(/\b(1|3|6|12)\s*-?\s*(?:m|mo|month)s?\b/);
    if (m) return `${m[1]}M`;
    if (/\bdaily\s*simple\b/.test(t)) return "Daily Simple";
    if (/\bcompounded\b/.test(t)) return "Compounded";
    if (/\baverage\b/.test(t)) return "Average";
    if (/\bovernight\b/.test(t)) return "Overnight";
    return null;
  };
  if (/\bsofr\b/.test(t)) {
    const tn = tenor();
    const isTerm = (/\bterm\b/.test(t) || /\bcme\b/.test(t)) && !/daily|average|compounded/.test(t);
    return { label: `${isTerm ? "Term SOFR" : "SOFR"}${tn ? ` · ${tn}` : ""}` };
  }
  if (/\bbsby\b/.test(t)) return { label: "BSBY", note: "discontinued Nov 2024 — confirm the fallback index", warn: true };
  if (/\blibor\b/.test(t)) return { label: "USD LIBOR", note: "ceased — legacy; confirm SOFR fallback", warn: true };
  if (/\bameribor\b/.test(t)) return { label: "AMERIBOR" };
  if (/\b(?:effr|obfr)\b/.test(t) || /\b(?:fed|federal)\s*funds\b/.test(t)) return { label: "Fed Funds (EFFR)" };
  if (/\bprime\b/.test(t)) return { label: "WSJ Prime Rate" };
  if (/\b(?:cmt|constant\s*maturity|treasury|ust|t-?bill)\b/.test(t)) return { label: "Treasury / CMT" };
  return null;
}

// Build the deal patch from an imported swap: store the terms, set the loan's
// all-in rate to the swap's fixed rate (the confirmation's floating leg already
// carries the credit spread, so the fixed IS the all-in), default the loan to
// Senior, and gap-fill notional/index/spread/lender/maturity. Shared by the
// per-deal "Import swap confirmation" button and the bulk uploader.
export function buildSwapPatch(deal: Deal, swap: InterestRateSwap): Partial<Deal> {
  const patch: Partial<Deal> = { interestRateSwap: swap };
  const blank = (v: unknown) => v == null || v === "";
  if (swap.fixedRatePct != null) { patch.debtRate = swap.fixedRatePct; patch.debtRateType = "Fixed (swapped)"; }
  if (blank(deal.debtLoanAmount) && swap.notional != null) patch.debtLoanAmount = swap.notional;
  if (blank(deal.debtIndex) && swap.floatingIndex) patch.debtIndex = swap.floatingIndex;
  if (blank(deal.debtSpread) && swap.floatingSpreadBps != null) patch.debtSpread = Math.round(swap.floatingSpreadBps); // debtSpread is in bps
  if (blank(deal.debtLender) && swap.counterparty) patch.debtLender = swap.counterparty;
  if (blank(deal.debtMaturityDate) && swap.terminationDate) patch.debtMaturityDate = swap.terminationDate;
  if (blank(deal.debtType)) patch.debtType = "Senior / Acquisition";
  return patch;
}

// Extract the economic terms of an interest-rate swap confirmation (e.g. an ISDA
// dealer confirmation). Feeds the swap-breakage estimate in the prepay calculator.
export async function extractSwap(text: string): Promise<InterestRateSwap> {
  const prompt = `Extract the economic terms of this interest-rate SWAP confirmation (e.g. an ISDA dealer confirmation). Return ONLY JSON (no markdown):
{"counterparty":string|null,"notional":number|null,"fixedRatePct":number|null,"payFixed":true|false|null,"floatingIndex":string|null,"floatingSpreadBps":number|null,"tradeDate":string|null,"effectiveDate":string|null,"terminationDate":string|null,"dayCount":string|null,"confirmationRef":string|null}

Rules:
- notional: the "Notional Amount" as a plain number.
- fixedRatePct: the "Fixed Rate" as a percent number (e.g. 5.10000% → 5.1).
- payFixed: who pays the fixed rate. The dealer bank (e.g. BankUnited, a bank) is one side; the borrower/CLIENT ("Counterparty") is the other. Set payFixed = true when the CLIENT/Counterparty is the "Fixed Rate Payer" (pays fixed, receives floating — the usual loan hedge). Set false only if the client receives fixed. If unclear, use true.
- floatingIndex: the floating rate option + tenor, e.g. "USD-SOFR CME Term 1M".
- floatingSpreadBps: the "Spread" over the floating index in BASIS POINTS (e.g. 1.65000% → 165).
- tradeDate / effectiveDate / terminationDate: ISO YYYY-MM-DD.
- dayCount: e.g. "30/360".
- confirmationRef: the dealer confirmation number (e.g. "BKU2025102802").
- counterparty: the dealer bank's name.
Numbers plain (no $, %, commas). null when absent.

${await lessonGuidanceClient("swap")}
SWAP CONFIRMATION TEXT:
${text.slice(0, 30000)}`;

  const res = await apiAiMessages({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = res.content?.[0]?.text ?? "";
  let p: Record<string, unknown>;
  try { p = robustParseJSON(raw) as Record<string, unknown>; }
  catch { throw new Error("Couldn't read the swap confirmation. Try a clearer file."); }

  const s = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
  const n = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const swap: InterestRateSwap = {
    counterparty: s(p.counterparty),
    notional: n(p.notional),
    fixedRatePct: n(p.fixedRatePct),
    payFixed: p.payFixed === false ? false : p.payFixed === true ? true : null,
    floatingIndex: s(p.floatingIndex),
    floatingSpreadBps: n(p.floatingSpreadBps),
    tradeDate: s(p.tradeDate),
    effectiveDate: s(p.effectiveDate),
    terminationDate: s(p.terminationDate),
    dayCount: s(p.dayCount),
    confirmationRef: s(p.confirmationRef),
    notes: null,
  };
  if (swap.notional == null && swap.fixedRatePct == null) throw new Error("This doesn't look like a swap confirmation — no notional or fixed rate found.");
  return swap;
}
