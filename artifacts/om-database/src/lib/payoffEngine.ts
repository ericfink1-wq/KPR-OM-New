// LOAN PAYOFF ENGINE (Eric, 11/6/26: "It's really helpful to see cost/profit on each of our own
// loans if we prepay any"). One deterministic calculator for every owned loan, as of any date:
//   • defeasance — the cost of a Treasury portfolio that pays every remaining scheduled payment to
//     the open date (else maturity) plus the balance then, each cash flow priced off the Treasury
//     curve at its own date. Can be BELOW par when Treasuries yield more than the note (a gain).
//   • yield maintenance — PV of the note-vs-Treasury interest gap to the open date (never < 0),
//     with any minimum % ("greater of 1% and YM").
//   • step-down / flat premium / spread maintenance / exit fee / open at par / lockout.
//   • linked swaps — the unwind value at the payoff date (+ = KPR receives).
// Terms come from fields an admin entered, else are READ from the loan's own prepayment wording
// (`parsePrepayText`), else from the deal record — and every result says which. A figure the inputs
// can't support is null with the missing input named; nothing is guessed. Estimates, not the
// servicer's or consultant's quote — labelled as such wherever shown.
import type { RatesPayload } from "./api";
import type { DebtRow } from "./assetMgmt";
import type { Deal } from "./idb";
import { calcSwapBreakage } from "./prepay";
import { marketSwapRate } from "./assetMgmt";

export type PrepayKind = "defeasance" | "yield_maintenance" | "stepdown" | "flat_premium" | "spread_maintenance" | "open" | "unknown";
export const PREPAY_KIND_LABEL: Record<PrepayKind, string> = {
  defeasance: "Defeasance", yield_maintenance: "Yield maintenance", stepdown: "Step-down", flat_premium: "Flat premium",
  spread_maintenance: "Spread maintenance", open: "Open at par", unknown: "Terms not on file",
};
/** Typical all-in third-party cost of a defeasance (consultant, successor borrower, servicer,
 *  rating agency, legal, accountant) when no quote is entered — shown as an assumption. */
export const DEFAULT_DEFEASANCE_FEES = 150_000;

export interface PrepayTermsResolved {
  kind: PrepayKind;
  /** Defeasance offered as an alternative to YM ("defeasance or yield maintenance") → both priced, the lower used. */
  altKind: PrepayKind | null;
  lockoutEnd: string | null;
  lockoutNote: string | null;
  openDate: string | null;
  ymSpreadBps: number;
  floorPct: number | null;
  stepdown: number[] | null;
  premiumPct: number | null;
  spreadMaintenanceEnd: string | null;
  exitFeePct: number | null;
  source: string;
  text: string | null;
}
export interface PayoffSwap { label: string; notional: number; fixedRatePct: number; maturity: string; index: string | null; payFixed: boolean }
export interface LoanInput {
  name: string;
  balance: number | null; balanceAsOf: string | null; originalBalance: number | null;
  /** Coupon for scheduled interest — the note rate (fixed) or today's all-in (floating, an estimate). */
  ratePct: number | null; rateIsFixed: boolean;
  originationDate: string | null; maturityDate: string | null;
  ioUntil: string | null; amortYears: number | null; ioFullTerm: boolean;
  paymentDay: number | null;
  spreadBps: number | null;
  /** Fees from the person's quote; null → DEFAULT_DEFEASANCE_FEES for a defeasance (labelled). */
  fees: number | null;
  terms: PrepayTermsResolved;
  swaps: PayoffSwap[];
}

// ── dates ─────────────────────────────────────────────────────────────────────
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v: unknown): string | null => { const t = String(v ?? "").trim().slice(0, 10); return ISO.test(t) && Number.isFinite(Date.parse(t)) ? t : null; };
const dim = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const mk = (y: number, m: number, d: number) => { const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12; return `${yy}-${String(mm + 1).padStart(2, "0")}-${String(Math.min(d, dim(yy, mm))).padStart(2, "0")}`; };
export function addMonths(date: string, k: number, day?: number): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)) - 1, d = day ?? Number(date.slice(8, 10));
  return mk(y, m + k, d);
}
const yearsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 86_400_000);
/** Monthly payment dates strictly after `from`, up to and including `to`, on `day` (clamped to month
 *  end). `endsOnTo`: when `to` itself isn't a payment date, add it as the final (payoff) date. */
export function paymentDates(from: string, to: string, day: number, endsOnTo = false): string[] {
  const out: string[] = [];
  let d = mk(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, day);
  if (d <= from) d = addMonths(d, 1, day);
  for (let i = 0; i < 1200 && d <= to; i++) { out.push(d); d = addMonths(d, 1, day); }
  if (endsOnTo && to > from && (!out.length || out[out.length - 1] < to)) out.push(to);
  return out;
}

// ── reading the loan's own prepayment wording ─────────────────────────────────
const WORD_N: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  eighteen: 18, twenty: 20, "twenty-four": 24, thirty: 30, "thirty-six": 36, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const numTok = (t: string): number | null => { const x = t.toLowerCase().replace(/(st|nd|rd|th)$/, ""); return /^\d+$/.test(x) ? Number(x) : WORD_N[t.toLowerCase()] ?? WORD_N[x] ?? null; };
const NUM = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty|twenty-four|thirty|thirty-six)";
const ORD = "(\\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)";
const DATE_RX = "(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.? \\d{1,2},? \\d{4})";
function textDate(raw: string): string | null {
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(raw);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  const t = Date.parse(raw.replace(/\./g, ""));
  return Number.isFinite(t) ? new Date(t + 12 * 3600_000).toISOString().slice(0, 10) : null;
}
/** First scheduled payment date after closing, on the payment day. */
const firstPayment = (orig: string, day: number) => paymentDates(orig, addMonths(orig, 2, day), day)[0];

export interface ParseCtx { originationDate: string | null; maturityDate: string | null; paymentDay: number | null; securitizationDate: string | null }
/** Pure. The prepayment terms a loan's own wording states. Null fields = the text doesn't say. */
export function parsePrepayText(text: string | null | undefined, ctx: ParseCtx): Omit<PrepayTermsResolved, "source" | "text" | "ymSpreadBps"> & { ymSpreadBps: number | null } {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const lo = t.toLowerCase();
  const out: Omit<PrepayTermsResolved, "source" | "text" | "ymSpreadBps"> & { ymSpreadBps: number | null } = {
    kind: "unknown", altKind: null, lockoutEnd: null, lockoutNote: null, openDate: null, ymSpreadBps: null, floorPct: null, stepdown: null,
    premiumPct: null, spreadMaintenanceEnd: null, exitFeePct: null,
  };
  if (!t) return out;
  const hasDef = /defeas/.test(lo), hasYm = /yield[\s-]*maint/.test(lo), hasSm = /spread[\s-]*maint/.test(lo);
  // Step-down: 3+ non-increasing percentages written as 5/4/3/2/1, 5%-4%-3%, "5%, 4%, 3%".
  const sd = /(?:^|[^\d.])(\d{1,2}(?:\.\d+)?)\s*%?\s*([\/,-])\s*(\d{1,2}(?:\.\d+)?)\s*%?\s*\2\s*(\d{1,2}(?:\.\d+)?)\s*%?((?:\s*\2\s*\d{1,2}(?:\.\d+)?\s*%?)*)/.exec(t);
  let steps: number[] | null = null;
  if (sd && !/\d\s*\/\s*\d{1,2}\s*\/\s*\d{2,4}/.test(sd[0])) {
    const nums = sd[0].match(/\d{1,2}(?:\.\d+)?/g)!.map(Number);
    if (nums.length >= 3 && nums.every((v, i) => v <= 10 && (i === 0 || v <= nums[i - 1])) && /step|prepay|premium|penalt|declin|%/i.test(t)) steps = nums;
  }
  if (hasDef) { out.kind = "defeasance"; if (hasYm) out.altKind = "yield_maintenance"; }
  else if (hasYm) out.kind = "yield_maintenance";
  else if (steps) { out.kind = "stepdown"; out.stepdown = steps; }
  else if (hasSm) out.kind = "spread_maintenance";
  else if (/\b(?:freely prepayable|no prepayment (?:premium|penalty|fee)|without (?:any )?(?:prepayment )?(?:premium|penalty|fee)|prepayable at par|open (?:to prepayment )?at par|open at any time|prepay(?:able|ment)? (?:in whole or in part )?at any time without)\b/.test(lo)) out.kind = "open";
  else { const fp = /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:prepayment\s*)?(?:premium|fee|penalty)/i.exec(t); if (fp && !/exit/i.test(t.slice(Math.max(0, fp.index - 12), fp.index + fp[0].length + 2))) { out.kind = "flat_premium"; out.premiumPct = Number(fp[1]); } }
  if (steps && out.kind !== "stepdown") out.stepdown = steps;
  // Minimum penalty: "greater of 1% and yield maintenance", "1% minimum".
  const fl = /greater of\s*(?:\(?[a-z]\)?\s*)?(?:\(?i\)?\s*)?(\d{1,2}(?:\.\d+)?)\s*%/i.exec(t) ?? /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:minimum|floor)/i.exec(t) ?? /(?:minimum|floor) (?:of )?(\d{1,2}(?:\.\d+)?)\s*%/i.exec(t);
  if (fl && (out.kind === "yield_maintenance" || out.altKind === "yield_maintenance")) out.floorPct = Number(fl[1]);
  // YM discount spread: "Treasury + 50 bps" / "Treasury Rate plus 0.50%"; "Treasury flat" = 0.
  const sp = /treasur[a-z ]{0,30}?(?:\+|plus)\s*(\d+(?:\.\d+)?)\s*(bps?|basis points?|%)/i.exec(t);
  if (sp) out.ymSpreadBps = /%/.test(sp[2]) ? Math.round(Number(sp[1]) * 100) : Number(sp[1]);
  const ex = /exit fee (?:of )?(\d(?:\.\d+)?)\s*%|(\d(?:\.\d+)?)\s*%\s*exit fee/i.exec(t);
  if (ex) out.exitFeePct = Number(ex[1] ?? ex[2]);

  const orig = ctx.originationDate, mat = ctx.maturityDate, day = ctx.paymentDay ?? (mat ? Number(mat.slice(8, 10)) : null);
  // ── Lockout ──
  const prongs: Array<{ date: string; why: string }> = [];
  let unresolved: string | null = null;
  const lockDate = new RegExp(`lock[\\s-]?out[^.;]{0,80}?(?:until|through|thru|ends?|expires?|release date (?:is|of))\\s*:?\\s*${DATE_RX}`, "i").exec(t);
  if (lockDate) { const d = textDate(lockDate[1]); if (d) prongs.push({ date: d, why: "lockout date stated" }); }
  const lockMonths = new RegExp(`${NUM}\\s*(?:\\(\\d+\\)\\s*)?[- ]?(month|year)s?[- ](?:prepayment )?lock[\\s-]?out|lock(?:ed)?[\\s-]?out (?:period )?(?:for|of) (?:the first )?${NUM}\\s*(?:\\(\\d+\\)\\s*)?(month|year)`, "i").exec(t);
  if (lockMonths && orig) {
    const k = numTok(lockMonths[1] ?? lockMonths[3]), unit = (lockMonths[2] ?? lockMonths[4]).toLowerCase();
    if (k) prongs.push({ date: addMonths(orig, unit === "year" ? k * 12 : k), why: `${k}-${unit} lockout from closing` });
  }
  const anniv = new RegExp(`${ORD}\\s*(?:\\(\\d+(?:st|nd|rd|th)?\\)\\s*)?anniversary of the (first |initial )?(monthly )?(payment date|closing date|origination|funding)([^.;]{0,40}?following the closing)?`, "i").exec(t);
  if (anniv && orig) {
    const k = numTok(anniv[1]);
    const fromPayment = /payment/i.test(anniv[4]);
    if (k && (!fromPayment || day)) {
      const base = fromPayment ? firstPayment(orig, day!) : orig;
      prongs.push({ date: addMonths(base, 12 * k), why: `${k}${k === 1 ? "st" : k === 2 ? "nd" : k === 3 ? "rd" : "th"} anniversary of the ${fromPayment ? "first payment date" : "closing"}` });
    }
  }
  const remic = new RegExp(`${NUM}\\s*(?:\\(\\d+\\)\\s*)?years? (?:from|after) (?:the )?[^.;]{0,20}?startup day`, "i").exec(t) ?? new RegExp(`${NUM}\\s*(?:\\(\\d+\\)\\s*)?years? (?:from|after) (?:the )?(?:date of )?(?:the )?(?:last |final )?securiti[sz]ation`, "i").exec(t);
  if (remic) {
    const k = numTok(remic[1]);
    if (k && ctx.securitizationDate) prongs.push({ date: addMonths(ctx.securitizationDate, 12 * k), why: `${k} years after the securitization` });
    else if (k) unresolved = `${k} years after the loan was securitized (REMIC startup day) — enter the securitization date`;
  }
  if (prongs.length) {
    const later = /later (?:to occur )?of/.test(lo) && !/earlier (?:to occur )?of/.test(lo);
    const pick = prongs.reduce((a, b) => (later ? b.date > a.date : b.date < a.date) ? b : a);
    out.lockoutEnd = pick.date;
    if (unresolved && !later) out.lockoutNote = `${pick.why}; could be EARLIER: ${unresolved}`;
    else out.lockoutNote = prongs.length > 1 ? `${later ? "later" : "earlier"} of: ${prongs.map(p => `${p.why} (${p.date})`).join("; ")}` : pick.why;
  } else if (unresolved) out.lockoutNote = `Lockout ends ${unresolved}`;
  else if (/lock[\s-]?out/.test(lo) && out.kind !== "open") out.lockoutNote = "the terms mention a lockout but not when it ends — enter the lockout end date";

  // ── Open (par) window before maturity ──
  if (mat) {
    const om = new RegExp(`(?:last|final)\\s*${NUM}\\s*(?:\\(\\d+\\)\\s*)?(month|payment date|payment)s?|${NUM}\\s*(?:\\(\\d+\\)\\s*)?(month|payment date|payment)s? (?:prior to|before|preceding)(?: the)?(?: scheduled| stated)? maturity|within ${NUM}\\s*(?:\\(\\d+\\)\\s*)?(month)s? of(?: the)? maturity`, "i").exec(t);
    if (om && /par|open|without|no (?:premium|penalty)|prepa|defeas/i.test(t)) {
      const k = numTok(om[1] ?? om[3] ?? om[5]);
      if (k && k < 60) out.openDate = addMonths(mat, -k, day ?? undefined);
    }
  }
  const openOn = new RegExp(`(?:at par|open|without (?:premium|penalty))[^.;]{0,40}?(?:on or after|from|after|beginning)\\s*${DATE_RX}`, "i").exec(t);
  if (openOn && !out.openDate) out.openDate = textDate(openOn[1]);
  // Spread maintenance end.
  if (out.kind === "spread_maintenance") {
    const se = new RegExp(`spread[\\s-]*maint[^.;]{0,60}?(?:until|through|thru|ending)\\s*${DATE_RX}`, "i").exec(t);
    const sm = new RegExp(`spread[\\s-]*maint[^.;]{0,60}?(?:first|initial)\\s*${NUM}\\s*(?:\\(\\d+\\)\\s*)?months?|${NUM}\\s*(?:\\(\\d+\\)\\s*)?(?:months?)\\s*(?:of )?spread[\\s-]*maint`, "i").exec(t);
    if (se) out.spreadMaintenanceEnd = textDate(se[1]);
    else if (sm && orig) { const k = numTok(sm[1] ?? sm[2]); if (k) out.spreadMaintenanceEnd = addMonths(orig, k); }
  }
  return out;
}

const KIND_FROM_FIELD = (v: unknown): PrepayKind | null => {
  const x = String(v ?? "").toLowerCase();
  if (!x.trim()) return null;
  if (/defeas/.test(x)) return "defeasance";
  if (/yield|\bym\b/.test(x)) return "yield_maintenance";
  if (/step/.test(x)) return "stepdown";
  if (/spread/.test(x)) return "spread_maintenance";
  if (/open|par|none|no pen/.test(x)) return "open";
  if (/flat|premium|%/.test(x)) return "flat_premium";
  return null;
};
const numOrNull = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const strOrNull = (v: unknown): string | null => (v == null || String(v).trim() === "" ? null : String(v).trim());

/** Entered fields win field by field; the loan's wording fills the rest. */
export function resolvePrepayTerms(data: Record<string, unknown>, text: string | null, ctx: ParseCtx, textSource: string, floating: boolean, enteredSource = "entered terms"): PrepayTermsResolved {
  const p = parsePrepayText(text, ctx);
  const entered = KIND_FROM_FIELD(data.prepayType);
  const steps = strOrNull(data.prepayStepdown)?.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? null;
  let kind = entered ?? p.kind, source = entered ? enteredSource : p.kind !== "unknown" ? textSource : "";
  if (kind === "unknown" && floating) { kind = "open"; source = "assumed — floating-rate loans are usually prepayable at par; confirm in the loan agreement"; }
  const anyEntered = ["prepayLockoutEnd", "prepayOpenDate", "prepayYmSpreadBps", "prepayFloorPct", "prepayStepdown", "prepayPremiumPct", "spreadMaintenanceEnd", "exitFeePct"].some(k => strOrNull(data[k]));
  if (anyEntered && !entered && source === textSource) source = `${textSource} + entered terms`;
  return {
    kind, altKind: entered ? null : p.altKind,
    lockoutEnd: iso(data.prepayLockoutEnd) ?? p.lockoutEnd,
    lockoutNote: iso(data.prepayLockoutEnd) ? "lockout end entered" : p.lockoutNote,
    openDate: iso(data.prepayOpenDate) ?? p.openDate,
    ymSpreadBps: numOrNull(data.prepayYmSpreadBps) ?? p.ymSpreadBps ?? 0,
    floorPct: numOrNull(data.prepayFloorPct) ?? p.floorPct,
    stepdown: steps && steps.length ? steps : p.stepdown,
    premiumPct: numOrNull(data.prepayPremiumPct) ?? p.premiumPct,
    spreadMaintenanceEnd: iso(data.spreadMaintenanceEnd) ?? p.spreadMaintenanceEnd,
    exitFeePct: numOrNull(data.exitFeePct) ?? p.exitFeePct,
    source: source || "no prepayment terms on file", text,
  };
}

// ── curves ────────────────────────────────────────────────────────────────────
export type Curve = Array<[number, number]>;
/** Treasury constant-maturity curve from Today's Rates ("1-Mo" … "30-Yr"), in years. */
export function treasuryCurve(r: RatesPayload | null): Curve {
  const pts: Curve = [];
  for (const row of r?.treasuries?.rows ?? []) {
    const m = /(\d+(?:\.\d+)?)\s*-?\s*(mo|month|yr|year|wk|week)/i.exec(row.label || "");
    if (!m || row.value == null) continue;
    const u = m[2].toLowerCase(), k = Number(m[1]);
    pts.push([u.startsWith("mo") ? k / 12 : u.startsWith("w") ? k / 52 : k, row.value]);
  }
  return pts.sort((a, b) => a[0] - b[0]);
}
export function curveAt(c: Curve, t: number): number | null {
  if (!c.length) return null;
  if (t <= c[0][0]) return c[0][1];
  if (t >= c[c.length - 1][0]) return c[c.length - 1][1];
  for (let i = 1; i < c.length; i++) { const [x0, y0] = c[i - 1], [x1, y1] = c[i]; if (t <= x1) return y0 + (y1 - y0) * ((t - x0) / (x1 - x0)); }
  return null;
}

// ── schedule ──────────────────────────────────────────────────────────────────
interface Sched { balanceAtPayoff: number; flows: Array<{ date: string; interest: number; principal: number }>; amortizing: boolean; payment: number | null }
function annuity(bal: number, r: number, n: number) { return r <= 0 ? bal / n : (bal * r) / (1 - Math.pow(1 + r, -n)); }
/** Balance at the payoff date and each scheduled payment after it, through `end` (balance repaid on `end`). */
export function schedule(L: LoanInput, payoff: string, end: string): Sched | null {
  const day = L.paymentDay ?? (L.maturityDate ? Number(L.maturityDate.slice(8, 10)) : 1);
  const rate = (L.ratePct ?? 0) / 100 / 12;
  const amortizing = !L.ioFullTerm && L.amortYears != null && L.amortYears > 0;
  const startBal = L.balance ?? L.originalBalance;
  if (startBal == null || startBal <= 0) return null;
  const startDate = L.balance != null ? (L.balanceAsOf ?? null) : L.originationDate;
  let payment: number | null = null;
  if (amortizing) {
    const base = L.originalBalance ?? startBal;
    payment = annuity(base, rate, Math.round(L.amortYears! * 12));
  }
  const amortOn = (d: string) => amortizing && (!L.ioUntil || d > L.ioUntil);
  const step = (bal: number, d: string) => { const i = bal * rate; const p = amortOn(d) && payment != null ? Math.min(bal, Math.max(0, payment - i)) : 0; return { i, p }; };
  // Roll the known balance forward to the payoff date (amortizing loans only; IO stays flat).
  let bal = startBal;
  if (amortizing && startDate && startDate < payoff) for (const d of paymentDates(startDate, payoff, day)) { if (d > payoff) break; bal -= step(bal, d).p; }
  const flows: Sched["flows"] = [];
  let b = bal;
  for (const d of paymentDates(payoff, end, day, true)) {
    const { i, p } = step(b, d);
    b -= p;
    flows.push({ date: d, interest: i, principal: p });
  }
  if (flows.length) flows[flows.length - 1].principal += b;
  return { balanceAtPayoff: bal, flows, amortizing, payment };
}

// ── the calculation ───────────────────────────────────────────────────────────
export interface PayoffLine { label: string; amount: number | null; note?: string }
export interface PayoffResult {
  payoffDate: string;
  status: "ok" | "locked" | "needs" | "matured" | "open";
  method: string;
  balance: number | null;
  /** Premium / penalty over the balance (a defeasance below par is NEGATIVE = a saving). */
  premium: number | null;
  fees: number;
  /** Swap unwind value to KPR (+ receives, − pays). */
  swap: number;
  /** Cost of prepaying vs simply owing the balance: premium + fees − swap. Negative = a gain. */
  net: number | null;
  cashToRetire: number | null;
  /** Locked → the first date it can be prepaid / defeased; `atEarliest` is the estimate on that date. */
  earliestDate: string | null;
  atEarliest: PayoffResult | null;
  runsTo: string | null;
  lines: PayoffLine[];
  sensitivity: { up25: number | null; down25: number | null } | null;
  termsSource: string;
  assumptions: string[];
  needs: string[];
}

function premiumFor(L: LoanInput, kind: PrepayKind, payoff: string, tCurve: Curve, shiftBp: number, A: string[], needs: string[]): { premium: number | null; balance: number | null; runsTo: string | null; method: string } {
  const T = L.terms, mat = L.maturityDate;
  const runsTo = T.openDate && T.openDate > payoff && (!mat || T.openDate < mat) ? T.openDate : mat;
  const sch = runsTo ? schedule(L, payoff, runsTo) : null;
  const bal = sch?.balanceAtPayoff ?? L.balance ?? L.originalBalance;
  const label = PREPAY_KIND_LABEL[kind];
  if (kind === "open") return { premium: 0, balance: bal, runsTo: null, method: label };
  if (kind === "flat_premium") {
    if (T.premiumPct == null) { needs.push("the prepayment premium %"); return { premium: null, balance: bal, runsTo: null, method: label }; }
    return { premium: bal != null ? bal * T.premiumPct / 100 : null, balance: bal, runsTo: null, method: `${label} ${T.premiumPct}%` };
  }
  if (kind === "stepdown") {
    if (!T.stepdown?.length) { needs.push("the step-down schedule (e.g. 5,4,3,2,1)"); return { premium: null, balance: bal, runsTo: null, method: label }; }
    if (!L.originationDate) { needs.push("the origination date (sets the loan year)"); return { premium: null, balance: bal, runsTo: null, method: label }; }
    const yr = Math.floor(Math.max(0, yearsBetween(L.originationDate, payoff)));
    const pct = yr < T.stepdown.length ? T.stepdown[yr] : T.floorPct ?? 0;
    return { premium: bal != null ? bal * pct / 100 : null, balance: bal, runsTo: null, method: `${label} — ${pct}% in loan year ${yr + 1}` };
  }
  if (kind === "spread_maintenance") {
    const end = T.spreadMaintenanceEnd;
    if (!end) { needs.push("when spread maintenance ends"); return { premium: null, balance: bal, runsTo: null, method: label }; }
    if (payoff >= end) return { premium: 0, balance: bal, runsTo: null, method: `${label} — ended ${end}` };
    if (L.spreadBps == null) { needs.push("the loan spread"); return { premium: null, balance: bal, runsTo: null, method: label }; }
    const months = Math.max(0, yearsBetween(payoff, end) * 12);
    A.push(`Spread maintenance = balance × ${L.spreadBps} bps × ${months.toFixed(1)} months remaining ÷ 12 (undiscounted).`);
    return { premium: bal != null ? bal * (L.spreadBps / 10000) * months / 12 : null, balance: bal, runsTo: end, method: `${label} to ${end}` };
  }
  // Defeasance / yield maintenance — need the coupon, a maturity and the Treasury curve.
  if (L.ratePct == null) needs.push("the note rate");
  if (!mat) needs.push("the maturity date");
  if (!tCurve.length) needs.push("today's Treasury curve (Today's Rates)");
  if (!sch || L.ratePct == null || !tCurve.length || !runsTo) { if (!sch && L.balance == null && L.originalBalance == null) needs.push("the loan balance"); return { premium: null, balance: bal, runsTo, method: label }; }
  if (!L.rateIsFixed) A.push("Floating-rate loan: scheduled interest uses today's all-in rate — the figure is an estimate.");
  if (kind === "defeasance") {
    let cost = 0;
    for (const f of sch.flows) {
      const t = Math.max(1 / 365, yearsBetween(payoff, f.date));
      const y = (curveAt(tCurve, t)! + shiftBp / 100) / 100;
      cost += (f.interest + f.principal) / Math.pow(1 + y / 2, 2 * t);
    }
    return { premium: cost - sch.balanceAtPayoff, balance: sch.balanceAtPayoff, runsTo, method: `${label} to ${runsTo}` };
  }
  // Yield maintenance: PV of the monthly interest gap, discounted at the matched Treasury + spread; never below zero.
  const yrs = Math.max(1 / 12, yearsBetween(payoff, runsTo));
  const y = (curveAt(tCurve, yrs)! + shiftBp / 100 + T.ymSpreadBps / 100);
  let pv = 0, k = 0, b = sch.balanceAtPayoff;
  for (const f of sch.flows) { k++; pv += (b * Math.max(0, L.ratePct - y) / 100 / 12) / Math.pow(1 + y / 100 / 12, k); b -= f.principal; }
  let prem = pv;
  if (T.floorPct != null && sch.balanceAtPayoff * T.floorPct / 100 > prem) { prem = sch.balanceAtPayoff * T.floorPct / 100; A.push(`Minimum of ${T.floorPct}% applies (yield maintenance alone is lower).`); }
  return { premium: prem, balance: sch.balanceAtPayoff, runsTo, method: `${label} to ${runsTo} at Treasury ${y.toFixed(2)}%${T.ymSpreadBps ? ` (incl. +${T.ymSpreadBps} bps)` : ""}` };
}

function swapValue(L: LoanInput, payoff: string, rates: RatesPayload | null, shiftBp: number, A: string[], needs: string[]): { total: number; lines: PayoffLine[] } {
  const lines: PayoffLine[] = [];
  let total = 0;
  for (const w of L.swaps) {
    if (w.maturity <= payoff) continue;
    const yrs = yearsBetween(payoff, w.maturity);
    const mkt = rates ? marketSwapRate(rates, yrs, w.index) : { rate: null, curve: null };
    if (mkt.rate == null) { needs.push(`today's swap curve (for the ${w.label} swap)`); continue; }
    const b = calcSwapBreakage({ notional: w.notional, fixedRatePct: w.fixedRatePct, terminationDate: w.maturity, payFixed: w.payFixed } as never, { valuationDate: payoff, marketSwapRatePct: mkt.rate + shiftBp / 100 });
    if (b.value == null) continue;
    total += b.value;
    lines.push({ label: `Swap unwind — ${w.label}`, amount: -b.value, note: `${w.fixedRatePct}% fixed vs ${(mkt.rate + shiftBp / 100).toFixed(2)}% market (${mkt.curve}) — ${b.value >= 0 ? "KPR receives" : "KPR pays"}` });
  }
  if (lines.length) A.push("Swap values are indicative marks on today's curve; the bank's unwind quote governs.");
  return { total, lines };
}

export function computePayoff(L: LoanInput, rates: RatesPayload | null, payoffDate: string, opts: { shiftBp?: number; noSensitivity?: boolean; noLockout?: boolean } = {}): PayoffResult {
  const shift = opts.shiftBp ?? 0;
  const A: string[] = [], needs: string[] = [];
  const T = L.terms;
  const base = (over: Partial<PayoffResult>): PayoffResult => ({
    payoffDate, status: "ok", method: PREPAY_KIND_LABEL[T.kind], balance: null, premium: null, fees: 0, swap: 0, net: null, cashToRetire: null,
    earliestDate: null, atEarliest: null, runsTo: null, lines: [], sensitivity: null, termsSource: T.source, assumptions: A, needs, ...over,
  });
  if (L.maturityDate && payoffDate >= L.maturityDate) return base({ status: "matured", method: "At or after maturity — repaid at par", premium: 0, net: 0 });
  if (!opts.noLockout && T.lockoutEnd && payoffDate < T.lockoutEnd && T.kind !== "open") {
    const at = computePayoff(L, rates, T.lockoutEnd, { ...opts, noLockout: true });
    return base({ status: "locked", method: `Locked out until ${T.lockoutEnd}`, earliestDate: T.lockoutEnd, atEarliest: at, balance: at.balance });
  }
  const tCurve = treasuryCurve(rates);
  const open = T.openDate && payoffDate >= T.openDate;
  let kind: PrepayKind = open ? "open" : T.kind;
  if (kind === "unknown") { needs.push("the prepayment terms (set them on the loan)"); return base({ status: "needs" }); }
  let p = premiumFor(L, kind, payoffDate, tCurve, shift, A, needs);
  if (!open && T.altKind) {
    const q = premiumFor(L, T.altKind, payoffDate, tCurve, shift, [], []);
    if (q.premium != null && (p.premium == null || q.premium < p.premium)) { A.push(`${PREPAY_KIND_LABEL[T.altKind]} is also allowed and costs less here than ${PREPAY_KIND_LABEL[kind].toLowerCase()}.`); p = q; kind = T.altKind; }
  }
  if (open) A.push(`Open at par from ${T.openDate}.`);
  if (kind === "defeasance" && !T.openDate) A.push("No open date on file — defeased to maturity. Most CMBS loans open at par 3–6 months early; entering it lowers the cost.");
  if (kind === "defeasance" || kind === "yield_maintenance") A.push(L.amortYears && !L.ioFullTerm ? `Amortizing (${L.amortYears}-yr schedule${L.ioUntil ? `, IO until ${L.ioUntil}` : ""}); interest 30/360.` : "Interest-only to the end (no amortization on file); interest 30/360.");
  const fees: PayoffLine[] = [];
  let feeTotal = 0;
  if (kind === "defeasance") {
    const f = L.fees ?? DEFAULT_DEFEASANCE_FEES;
    feeTotal += f;
    fees.push({ label: "Defeasance fees", amount: f, note: L.fees != null ? "your quote" : "typical $100–200k (consultant, successor borrower, servicer, legal, accountant) — enter your quote" });
  } else if (L.fees != null && kind !== "open") { feeTotal += L.fees; fees.push({ label: "Payoff fees", amount: L.fees, note: "entered" }); }
  if (T.exitFeePct != null && p.balance != null && T.kind !== "open") { const x = p.balance * T.exitFeePct / 100; feeTotal += x; fees.push({ label: `Exit fee ${T.exitFeePct}%`, amount: x }); }
  const sw = swapValue(L, payoffDate, rates, shift, A, needs);
  const premium = p.premium != null ? Math.round(p.premium) : null;
  const net = premium != null ? Math.round(premium + feeTotal - sw.total) : null;
  const lines: PayoffLine[] = [
    { label: "Loan balance at payoff", amount: p.balance != null ? Math.round(p.balance) : null },
    { label: kind === "defeasance" ? (premium != null && premium < 0 ? "Defeasance discount (bonds cost less than the balance)" : "Defeasance premium (bonds cost above the balance)") : kind === "open" ? "Prepayment premium" : `${PREPAY_KIND_LABEL[kind]} premium`, amount: premium },
    ...fees.map(f => ({ ...f, amount: f.amount != null ? Math.round(f.amount) : null })),
    ...sw.lines.map(l => ({ ...l, amount: l.amount != null ? Math.round(l.amount) : null })),
  ];
  let sens: PayoffResult["sensitivity"] = null;
  if (!opts.noSensitivity && net != null && (kind === "defeasance" || kind === "yield_maintenance" || L.swaps.length)) {
    sens = { up25: computePayoff(L, rates, payoffDate, { shiftBp: shift + 25, noSensitivity: true, noLockout: opts.noLockout }).net,
      down25: computePayoff(L, rates, payoffDate, { shiftBp: shift - 25, noSensitivity: true, noLockout: opts.noLockout }).net };
  }
  return base({
    status: open ? "open" : needs.length && premium == null ? "needs" : "ok", method: open ? "Open at par" : p.method, balance: p.balance != null ? Math.round(p.balance) : null,
    premium, fees: Math.round(feeTotal), swap: Math.round(sw.total), net, cashToRetire: p.balance != null && net != null ? Math.round(p.balance + net) : null,
    runsTo: p.runsTo, lines, sensitivity: sens,
  });
}

// ── building the input ───────────────────────────────────────────────────────
const prepayTextOf = (d: Record<string, unknown>) => strOrNull(d.prepayment) ?? strOrNull(d.prepaymentTerms) ?? strOrNull(d.prepay);
/** From an Asset Mgmt loan row. Falls back to the deal's own Financing fields for terms the record
 *  doesn't carry, but only when the record has no prepayment wording of its own. */
export function loanInputFromRow(r: DebtRow, deal?: Deal | null): LoanInput {
  const d = r.record.data;
  const orig = iso(d.originationDate) ?? (deal && sameLoan(r, deal) ? iso(deal.debtOriginationDate) : null);
  const mat = r.maturity ? iso(r.maturity) : null;
  const day = numOrNull(d.paymentDay) ?? (mat ? Number(mat.slice(8, 10)) : null);
  const ctx: ParseCtx = { originationDate: orig, maturityDate: mat, paymentDay: day, securitizationDate: iso(d.securitizationDate) };
  let text = prepayTextOf(d), src = "read from the loan's prepayment terms", data: Record<string, unknown> = d, enteredSrc = "entered on the loan";
  if (!text && !strOrNull(d.prepayType) && deal && sameLoan(r, deal)) {
    const dt = deal.prepayTerms;
    text = [strOrNull(deal.debtPrepay), strOrNull(dt?.notes)].filter(Boolean).join(" ") || null;
    src = "read from the deal's Financing tab"; enteredSrc = "set on the deal's Financing tab";
    if (dt?.type && dt.type !== "other") data = { ...d, prepayType: dt.type === "lockout_open" ? null : dt.type, prepayLockoutEnd: d.prepayLockoutEnd ?? dt.lockoutEnd, prepayOpenDate: d.prepayOpenDate ?? dt.openDate,
      prepayFloorPct: d.prepayFloorPct ?? dt.floorPenaltyPct, prepayYmSpreadBps: d.prepayYmSpreadBps ?? dt.reinvestmentSpreadBps, prepayPremiumPct: d.prepayPremiumPct ?? dt.prepayPremiumPct,
      prepayStepdown: d.prepayStepdown ?? (dt.stepdown?.length ? dt.stepdown.join(",") : null) };
  }
  const fixed = r.rateClass === "fixed" || r.rateClass === "swapped";
  // Floating loans — swapped ones too, the hedge sits on a floating note — are usually open at par.
  const terms = resolvePrepayTerms(data, text, ctx, src, r.rateClass === "floating" || r.rateClass === "capped" || r.rateClass === "swapped", enteredSrc);
  const coupon = r.rateClass === "fixed" ? numOrNull(d.fixedRatePct) ?? r.allInPct : r.allInPct;
  const amortKind = String(d.amortization ?? "").toLowerCase();
  return {
    name: `${r.property}${r.loanLabel ? ` · ${r.loanLabel}` : ""}`,
    balance: numOrNull(d.currentBalance), balanceAsOf: iso(d.balanceAsOf), originalBalance: numOrNull(d.originalBalance) ?? (r.balance ?? null),
    ratePct: coupon, rateIsFixed: fixed,
    originationDate: orig, maturityDate: mat,
    ioUntil: iso(d.ioUntil) ?? iso(d.ioEndDate), amortYears: numOrNull(d.amortYears),
    ioFullTerm: amortKind === "io" || r.ioAmort === "IO full term",
    paymentDay: day, spreadBps: r.spreadBps,
    fees: numOrNull(d.defeasanceFees) ?? numOrNull(d.payoffFees),
    terms,
    swaps: r.swaps.filter(w => !w.termsPending && w.notional != null && w.fixedSwapRatePct != null && w.maturity).map(w => ({
      label: w.counterparty ?? "swap", notional: w.notional!, fixedRatePct: w.fixedSwapRatePct!, maturity: w.maturity!, index: s0(w.record.data.index), payFixed: w.record.data.payFixed !== false,
    })),
  };
}
const s0 = (v: unknown) => strOrNull(v);
/** The deal's Financing fields describe this loan (same balance within 2%, or it's the only loan). */
function sameLoan(r: DebtRow, deal: Deal): boolean {
  if (deal.id !== r.dealId) return false;
  const a = deal.debtLoanAmount, b = numOrNull(r.record.data.originalBalance) ?? r.balance;
  return a == null || b == null || Math.abs(a - b) <= 0.02 * Math.max(a, b);
}
/** From a deal's own Financing fields (deals without an Asset Mgmt loan record). */
export function loanInputFromDeal(deal: Deal, balanceAtToday?: number | null): LoanInput {
  const mat = iso(deal.debtMaturityDate), orig = iso(deal.debtOriginationDate);
  const day = mat ? Number(mat.slice(8, 10)) : null;
  const dt = deal.prepayTerms;
  const data: Record<string, unknown> = dt ? { prepayType: dt.type === "lockout_open" || dt.type === "other" ? null : dt.type, prepayLockoutEnd: dt.lockoutEnd, prepayOpenDate: dt.openDate,
    prepayFloorPct: dt.floorPenaltyPct, prepayYmSpreadBps: dt.reinvestmentSpreadBps, prepayPremiumPct: dt.prepayPremiumPct, prepayStepdown: dt.stepdown?.length ? dt.stepdown.join(",") : null } : {};
  const text = [strOrNull(deal.debtPrepay), strOrNull(dt?.notes)].filter(Boolean).join(" ") || null;
  const floating = /float|sofr|variable/i.test(`${deal.debtRateType ?? ""} ${deal.debtIndex ?? ""}`) && !deal.interestRateSwap;
  const sw = deal.interestRateSwap;
  return {
    name: deal.propertyName || "Loan",
    balance: balanceAtToday ?? null, balanceAsOf: balanceAtToday != null ? new Date().toISOString().slice(0, 10) : null, originalBalance: deal.debtLoanAmount ?? null,
    ratePct: deal.debtRate ?? sw?.fixedRatePct ?? null, rateIsFixed: !floating,
    originationDate: orig, maturityDate: mat, ioUntil: orig && deal.debtIOPeriod ? addMonths(orig, Math.round(deal.debtIOPeriod)) : null,   // debtIOPeriod = IO months
    amortYears: deal.debtAmortYears ?? null, ioFullTerm: !deal.debtAmortYears, paymentDay: day, spreadBps: deal.debtSpread ?? null, fees: null,
    terms: resolvePrepayTerms(data, text, { originationDate: orig, maturityDate: mat, paymentDay: day, securitizationDate: null }, "read from the loan's prepayment terms", floating, "set in the prepayment calculator"),
    swaps: sw && sw.notional != null && sw.fixedRatePct != null && sw.terminationDate ? [{ label: "swap", notional: sw.notional, fixedRatePct: sw.fixedRatePct, maturity: sw.terminationDate, index: sw.floatingIndex ?? null, payFixed: sw.payFixed !== false }] : [],
  };
}
