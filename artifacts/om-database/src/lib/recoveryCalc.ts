// Per-tenant expense recoveries CALCULATED from the lease's recovery terms × the
// OM's expense budget, bucket by bucket (Eric, 10/16/26):
//
//   "can you not estimate modified or anything not exactly NNN when we know the
//    expenses for each category its referring to? … calc it and see how that comes
//    back compared to if it were fully NNN"
//
// So instead of spreading one center-wide recovery total by SF (which only works
// for plain NNN and silently gives up on everything else), each tenant's
// reimbursementMethod is read into three buckets — CAM, real-estate tax, insurance
// — each one PRO-RATA (its share of that pool), FIXED (a stated $/SF or $/yr), NONE
// (gross / does not reimburse) or UNKNOWN. A tenant is only calculated when EVERY
// bucket resolves; one unknown bucket and it returns null with the reason, never a
// guess. Alongside the answer it always returns the FULLY-NNN reference (its share
// of all three pools) so the two can be eyeballed against each other.
//
// Parsing is deliberately conservative — real OM phrasing (from the live library)
// is the test fixture. When a phrase can be read two ways, it is UNKNOWN.

export type Bucket = "cam" | "tax" | "ins";
export const BUCKETS: Bucket[] = ["cam", "tax", "ins"];
export const BUCKET_LABEL: Record<Bucket, string> = { cam: "CAM", tax: "RE tax", ins: "Insurance" };

export type BucketTerm =
  | { kind: "prorata" }
  | { kind: "fixedPsf"; psf: number }
  | { kind: "fixedAnnual"; amount: number }
  | { kind: "none" }
  | { kind: "unknown"; why: string };

export interface RecoveryTerms {
  cam: BucketTerm;
  tax: BucketTerm;
  ins: BucketTerm;
  /** % added on top of the CAM share (admin fee), e.g. 15. */
  adminFeePct: number | null;
  /** true = mgmt fee recovered inside CAM, false = not recovered, null = not stated. */
  mgmtInCam: boolean | null;
  /** Explicit pro-rata share % stated on the roll (overrides SF ÷ GLA). */
  proRataPct: number | null;
  /** A hard ceiling on total recoveries in $/SF ("shall not exceed $7.50psf"). */
  capPsf: number | null;
  /** A reason the WHOLE structure can't be calculated (e.g. pool net of anchors). */
  blocker: string | null;
  structure: "nnn" | "gross" | "modified" | "fixed" | "partial" | "unknown";
}

type TenantLike = {
  reimbursementMethod?: string | null;
  leaseType?: string | null;
  adminFeePct?: number | null;
  mgmtFeeInCam?: boolean | null;
};

const num = (s: string) => {
  const v = parseFloat(s.replace(/,/g, ""));
  return isFinite(v) ? v : null;
};

const CAM_RX = /\b(cam|ticam|common area(?: maintenance| expenses?)?)\b/;
const TAX_RX = /\b(ret|re taxes?|real estate taxes?|r\.?e\.? tax(?:es)?|property taxes?|tax(?:es)?)\b/;
const INS_RX = /\b(ins|insurance)\b/;

function bucketsIn(seg: string): Bucket[] {
  if (/\bticam\b/.test(seg)) return ["cam", "tax", "ins"];
  const out: Bucket[] = [];
  if (CAM_RX.test(seg)) out.push("cam");
  if (TAX_RX.test(seg)) out.push("tax");
  if (INS_RX.test(seg)) out.push("ins");
  return out;
}

/** "$6.01psf", "$2.55 PSF", "$4.45/sf" → psf; "$41,500/yr", "$2,121.80/yr", "$5,184/yr" → annual. */
function readAmount(seg: string): { psf: number } | { annual: number } | null {
  const psf = seg.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(?:psf|\/\s*sf|per\s*sf|per\s*square\s*foot)\b/);
  if (psf) { const v = num(psf[1]); if (v != null) return { psf: v }; }
  const yr = seg.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(?:\/\s*(?:yr|year)|per\s*year|annually|a\s*year)\b/);
  if (yr) { const v = num(yr[1]); if (v != null) return { annual: v }; }
  return null;
}

const PRORATA_RX = /\b(nnn|n\.n\.n\.|triple net|pro[- ]?rata|prs|net)\b|reimburses?\b/;
const NONE_RX = /\b(does not reimburse|not reimbursed|no reimburse\w*|excluded|none|n\/a|gross|landlord pays|ll pays)\b/;

/** Read one roster row's recovery structure into per-bucket terms. */
export function parseRecoveryTerms(t: TenantLike): RecoveryTerms {
  const raw = `${t.reimbursementMethod || ""}`.trim();
  const lt = `${t.leaseType || ""}`.trim();
  const text = raw.toLowerCase().replace(/\s+/g, " ");
  const ltl = lt.toLowerCase().replace(/\s+/g, " ");
  const s = `${text} ; ${ltl}`;
  const terms: RecoveryTerms = {
    cam: { kind: "unknown", why: "not stated" },
    tax: { kind: "unknown", why: "not stated" },
    ins: { kind: "unknown", why: "not stated" },
    adminFeePct: t.adminFeePct ?? null,
    mgmtInCam: t.mgmtFeeInCam ?? null,
    proRataPct: null,
    capPsf: null,
    blocker: null,
    structure: "unknown",
  };
  if (!raw && !lt) return terms;

  // A bucket the TEXT has spoken about is LOCKED — a generic "NNN" (especially the
  // bare lease-type column) must never paper over "Fixed CAM (no amount)", "pays
  // taxes directly" or "Tax Only".
  const locked = new Set<Bucket>();
  const lock = (b: Bucket, term: BucketTerm) => { terms[b] = term; locked.add(b); };
  const unknownLock = (b: Bucket, why: string) => lock(b, { kind: "unknown", why });

  // ── Whole-structure blockers ──
  if (/base year|expense stop|over base|above base/.test(s)) terms.blocker = "recoveries are over a base year / expense stop — the base amount isn't captured";
  if (/reimbursements? after anchors|net of anchor|less majors|after (?:anchor|major) contributions/.test(s)) terms.blocker = "the shop pool is figured after the majors' share — a share of total GLA would be wrong";
  if (/proprietary/.test(s)) terms.blocker = "the OM calls the recovery structure proprietary";

  // ── Pure gross (never "modified gross") ──
  const modified = /modif|mod\.? gross|\bmg\b|semi[- ]gross/.test(s);
  const sNoSales = s.replace(/\bgross (?:sales|receipts|revenue)\b/g, "sales");
  const sNoNeg = sNoSales.replace(/no (?:nnn )?(?:recoveries|reimbursements)[^;|]*/g, " ");
  const noRecoveries = /\b(?:recoveries|reimbursements) (?:are )?(?:excluded|not billed|none)\b|\bno (?:recoveries|reimbursements)\b/.test(sNoSales);
  const grossOnly = !modified && (/\bgross\b/.test(sNoSales) || noRecoveries) && !/\bnnn\b|triple net|pro[- ]?rata|\bprs\b|fixed|\bnet\b/.test(sNoNeg);
  if (grossOnly) {
    for (const b of BUCKETS) lock(b, { kind: "none" });
    terms.structure = "gross";
    return terms;
  }

  // ── Admin fee / mgmt fee / stated share / caps ──
  const af = s.match(/(\d+(?:\.\d+)?)\s*%\s*(?:admin(?:istrative)?(?: fee)?|adm|af)\b/)
    || s.match(/admin(?:istrative)? fee\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*%/)
    || s.match(/(?:nnn|mf)\s*\+\s*(\d+(?:\.\d+)?)\s*%/);
  if (af && terms.adminFeePct == null) terms.adminFeePct = num(af[1]);
  if (/admin fee\s*(?:of\s*)?\$|\$[\d,]+\s*\/\s*yr admin/.test(s)) terms.blocker = terms.blocker ?? "a flat-dollar admin fee isn't modelled";
  if (terms.mgmtInCam == null) {
    if (/mgmt fee:\s*does not|mgmt fee\s*(?:is\s*)?excluded|no mgt|no mgmt|no mf\b|mgmt fee not|no admin fee or management fee/.test(s)) terms.mgmtInCam = false;
    else if (/\+\s*mf\b|nnn\+mf|mgmt fee in cam|cam incl\.? mgmt|including mgmt|incl\.? management|\(ret, ins, cam, mgt\)|\+ mgmt\b/.test(s)) terms.mgmtInCam = true;
  }
  const share = s.match(/pro[- ]?rata share\s*(?:of\s*)?\(?(\d+(?:\.\d+)?)\s*%/) || s.match(/@\s*(\d+(?:\.\d+)?)\s*%/);
  if (share) terms.proRataPct = num(share[1]);
  const cap = s.match(/(?:shall not exceed|not to exceed|capped at)\s*\$\s?([\d.]+)\s*psf/);
  if (cap) terms.capPsf = num(cap[1]);

  // ── Things the tenant pays OUTSIDE landlord recoveries (cost exists, amount unknown) ──
  if (/pays (?:its own |re |real estate )?taxes directly|pays taxes on its (?:individual|own) parcel|pays re taxes directly|tax bill direct/.test(s)) unknownLock("tax", "pays its taxes direct — amount not captured");
  if (/self[- ]?insur|self-maintains (?:&|and) insures|insures (?:itself|its own)|self \(ins/.test(s)) unknownLock("ins", "carries its own insurance — amount not captured");
  if (/self \((?:ins, )?cam|self-maintains(?! their roof)/.test(s) && !/self-maintains their roof/.test(s)) unknownLock("cam", "self-maintains — its CAM cost isn't captured");
  if (/(?:reimburses|pays) taxes off (?:a )?[\d,]+ ?sf/.test(s)) unknownLock("tax", "taxes are figured off a different SF base");
  // "RE Tax PRS not less than 80%" / "of occupied premises not less than 85%": the
  // share is figured off occupied GLA with a floor — a share of total GLA understates it.
  for (const seg of text.split(/;/)) if (/not less than \d+\s*%/.test(seg)) for (const b of bucketsIn(seg)) if (!locked.has(b)) unknownLock(b, `${BUCKET_LABEL[b]} share is off occupied GLA with a floor — not captured`);
  if (/\btax(?:es)? only\b/.test(s)) { lock("cam", { kind: "none" }); lock("ins", { kind: "none" }); if (!locked.has("tax") || terms.tax.kind === "unknown") lock("tax", { kind: "prorata" }); }
  // "PRS TICAM" = pro-rata Taxes, Insurance and CAM.
  if (/\b(?:prs|pro[- ]?rata(?: share)?(?: of)?|nnn|net)\s+ticam\b/.test(s)) for (const b of BUCKETS) if (!locked.has(b)) lock(b, { kind: "prorata" });
  if (/\bcam (?:contribution )?only\b/.test(s)) { lock("tax", { kind: "none" }); lock("ins", { kind: "none" }); }
  if (/\bground lease\b/.test(s)) {
    if (!locked.has("tax")) unknownLock("tax", "ground lease — taxes usually paid direct");
    if (!locked.has("ins")) unknownLock("ins", "ground lease — insurance usually carried direct");
  }

  // ── Segment-level reads (the reimbursementMethod TEXT only) ──
  const segs = text.split(/;|\|/).map(x => x.trim()).filter(Boolean);
  for (const seg0 of segs) {
    // Drop cap / admin / escalation phrases so "CAP on CAM" or "admin fee excluding
    // insurance" isn't mistaken for a statement about which buckets are paid.
    const seg = seg0
      .replace(/(?:\d+(?:\.\d+)?\s*%\s*)?(?:non[- ]?cum(?:ulative)?\s*)?(?:cpi\s*)?(?:cam\s*)?cap(?:ped)?\b[^,;)]*/g, " ")
      .replace(/admin(?:istrative)? fee[^,;)]*/g, " ")
      .replace(/\b\d+(?:\.\d+)?\s*%\s*(?:annual\s*)?(?:escalations?|increases?)[^,;)]*/g, " ");

    const lab = seg.match(/^(cam|ins|insurance|ret|re tax(?:es)?|real estate taxes?|taxes)\s*:\s*(.+)$/);
    if (lab) {
      const b = bucketsIn(lab[1])[0];
      const v = lab[2];
      if (b && !locked.has(b)) {
        if (/fixed/.test(v)) {
          const a = readAmount(seg0);
          if (a) lock(b, "psf" in a ? { kind: "fixedPsf", psf: a.psf } : { kind: "fixedAnnual", amount: a.annual });
          else unknownLock(b, `fixed ${BUCKET_LABEL[b]} amount not stated`);
        } else if (/does not|not reimburse|excluded|\bnone\b|\bno\b|n\/a|gross/.test(v)) lock(b, { kind: "none" });
        else if (PRORATA_RX.test(v)) lock(b, { kind: "prorata" });
      }
      continue;
    }
    if (/^(mgmt fee|management fee|capital reserves?)\b/.test(seg)) continue;

    const fx = seg0.match(/fixed\s*_?\s*((?:cam|common area|re tax(?:es)?|real estate tax(?:es)?|ret|ins(?:urance)?)(?:\s*(?:\/|&|and)\s*(?:cam|ins(?:urance)?|ret|re tax(?:es)?))*)/);
    if (fx) {
      const covered = bucketsIn(fx[1]).filter(b => !locked.has(b));
      const a = readAmount(seg0);
      if (!a) for (const b of covered) unknownLock(b, `fixed ${BUCKET_LABEL[b]} amount not stated`);
      else if (covered.length === 1 || "annual" in a) {
        covered.forEach((b, i) => lock(b, i === 0
          ? ("psf" in a ? { kind: "fixedPsf", psf: a.psf } : { kind: "fixedAnnual", amount: a.annual })
          : { kind: "none" }));
      } else for (const b of covered) unknownLock(b, "one fixed $/SF covers several buckets");
      // anything else named in this clause ("Fixed CAM + Insurance + RET") is unresolved
      for (const b of bucketsIn(seg0.replace(fx[0], " "))) if (!locked.has(b)) {
        if (PRORATA_RX.test(seg0.replace(fx[0], " "))) lock(b, { kind: "prorata" });
        else unknownLock(b, "mentioned alongside a fixed charge — basis unclear");
      }
      continue;
    }
    // "$0.40psf base" style — a per-bucket stop/base, not a recovery we can price.
    for (const b of bucketsIn(seg)) {
      if (locked.has(b)) continue;
      const after = seg.slice(seg.search(b === "cam" ? CAM_RX : b === "tax" ? TAX_RX : INS_RX));
      if (/^\S+\s*\$\s?[\d.]+\s*psf\s*base/.test(after)) unknownLock(b, `${BUCKET_LABEL[b]} is over a base — base not captured`);
    }

    const named = bucketsIn(seg).filter(b => !locked.has(b));
    if (named.length && PRORATA_RX.test(seg)) { for (const b of named) lock(b, { kind: "prorata" }); continue; }
    if (named.length && /\b(excluded|does not reimburse|not reimbursed|landlord pays)\b/.test(seg)) for (const b of named) lock(b, { kind: "none" });
  }

  // ── Generic NNN fills the buckets NOTHING above spoke to ──
  // From the text itself ("NNN", "Pro-Rata Share NNN", "Net", "PRS (RET, INS, CAM)"),
  // or — only when the text names no bucket at all — from the lease-type column.
  const generic = /\bnnn\b|n\.n\.n\.|triple net|pro[- ]?rata share(?: nnn)?\b(?! of)|pro[- ]?rata nnn|^\s*net\b|; ?net\b|\(net\b/;
  const textClean = text.replace(/(?:\d+(?:\.\d+)?\s*%\s*)?(?:non[- ]?cum(?:ulative)?\s*)?(?:cam\s*)?cap(?:ped)?\b[^;)]*/g, " ").replace(/admin(?:istrative)? fee[^;)]*/g, " ");
  const textNamesBuckets = bucketsIn(textClean).length > 0;
  // "NNN RE Taxes", "Net CAM & Ins", "Pro-Rata Share of RET" speak for THOSE buckets
  // only — strip them before asking whether the lease is generically NNN.
  const textGeneric = text.replace(/\b(?:nnn|net|pro[- ]?rata(?: share)?(?: of)?|prs(?: of)?)\s+(?:cam|ins\w*|ret|re tax\w*|real estate tax\w*|taxes)(?:\s*(?:&|and|,|\/)\s*(?:cam|ins\w*|ret|re tax\w*|real estate tax\w*|taxes))*/g, " ");
  const fromText = generic.test(textGeneric) && !/\bno nnn\b/.test(text);
  const fromType = !textNamesBuckets && /\bnnn\b|triple net|\bnet\b/.test(ltl) && !modified;
  if ((fromText && !modified) || fromType) for (const b of BUCKETS) if (!locked.has(b)) terms[b] = { kind: "prorata" };

  if (modified) {
    for (const b of BUCKETS) if (!locked.has(b) && terms[b].kind === "unknown") {
      terms[b] = { kind: "unknown", why: "modified gross — whether it pays this isn't stated" };
    }
  }

  const kinds = BUCKETS.map(b => terms[b].kind);
  terms.structure = modified ? "modified"
    : kinds.every(k => k === "prorata") ? "nnn"
    : kinds.every(k => k === "none") ? "gross"
    : kinds.some(k => k === "fixedPsf" || k === "fixedAnnual") ? "fixed"
    : kinds.every(k => k === "prorata" || k === "none") ? "partial"
    : "unknown";
  return terms;
}

export interface ExpensePools {
  cam: number | null;
  tax: number | null;
  ins: number | null;
  mgmt: number | null;
  gla: number | null;
}

/** The OM's own expense budget, by bucket. Keys vary by OM, so match loosely. */
export function expensePoolsFromDeal(deal: {
  expenseBreakdown?: Record<string, number | null> | null;
  currentAnnualTaxes?: number | null;
  totalSF?: number | null;
}): ExpensePools {
  const eb = deal.expenseBreakdown || {};
  const pick = (rx: RegExp, not?: RegExp): number | null => {
    for (const [k, v] of Object.entries(eb)) {
      const key = k.toLowerCase();
      if (/total|below the line|reserve|ti\b|lc\b|capital|non[- ]?reimb/.test(key)) continue;
      if (not && not.test(key)) continue;
      if (rx.test(key) && typeof v === "number" && isFinite(v) && v > 0) return v;
    }
    return null;
  };
  const tax = pick(/real ?estate ?tax|re ?tax|realestatetax|property ?tax|^taxes$/) ?? (typeof deal.currentAnnualTaxes === "number" && deal.currentAnnualTaxes > 0 ? deal.currentAnnualTaxes : null);
  return {
    cam: pick(/\bcam\b|common ?area/),
    tax,
    ins: pick(/insur/),
    mgmt: pick(/manage|mgmt/),
    gla: typeof deal.totalSF === "number" && deal.totalSF > 0 ? deal.totalSF : null,
  };
}

export interface RecoveryLine { bucket: Bucket; how: string; amount: number }

export interface TenantRecoveryCalc {
  /** Calculated annual recoveries, or null when any bucket can't be resolved. */
  value: number | null;
  /** What the tenant would pay as a plain pro-rata NNN tenant — the eyeball check. */
  fullNnn: number | null;
  lines: RecoveryLine[];
  structure: RecoveryTerms["structure"];
  /** Why value is null. */
  why: string | null;
}

const r0 = (v: number) => Math.round(v);

/** Calculate one tenant's year-1 recoveries from its terms and the OM's expense pools. */
export function calcTenantRecoveries(
  t: TenantLike & { sf?: number | null; recoverySF?: number | null },
  pools: ExpensePools,
  terms: RecoveryTerms = parseRecoveryTerms(t),
): TenantRecoveryCalc {
  const sf = (typeof t.recoverySF === "number" && t.recoverySF > 0 ? t.recoverySF : null)
    ?? (typeof t.sf === "number" && t.sf > 0 ? t.sf : null);
  const share = terms.proRataPct != null ? terms.proRataPct / 100
    : sf != null && pools.gla != null ? sf / pools.gla : null;
  const poolOf = (b: Bucket) => pools[b];
  const fullNnn = share != null && pools.cam != null && pools.tax != null && pools.ins != null
    ? r0(share * (pools.cam + pools.tax + pools.ins)) : null;
  const out: TenantRecoveryCalc = { value: null, fullNnn, lines: [], structure: terms.structure, why: null };

  if (terms.blocker) { out.why = terms.blocker; return out; }
  if (terms.structure === "gross") { out.value = 0; return out; }

  const admin = (terms.adminFeePct ?? 0) / 100;
  let total = 0;
  for (const b of BUCKETS) {
    const term = terms[b];
    if (term.kind === "unknown") { out.why = `${BUCKET_LABEL[b]}: ${term.why}`; return out; }
    if (term.kind === "none") { out.lines.push({ bucket: b, how: "not recovered", amount: 0 }); continue; }
    if (term.kind === "fixedAnnual") { out.lines.push({ bucket: b, how: "fixed, as stated", amount: r0(term.amount) }); total += term.amount; continue; }
    if (term.kind === "fixedPsf") {
      if (sf == null) { out.why = `${BUCKET_LABEL[b]}: fixed $/SF but the suite's SF is missing`; return out; }
      const a = term.psf * sf;
      out.lines.push({ bucket: b, how: `fixed $${term.psf.toFixed(2)}/SF, as stated`, amount: r0(a) }); total += a; continue;
    }
    // pro-rata
    const pool = poolOf(b);
    if (share == null) { out.why = "pro-rata share can't be worked out (SF or GLA missing)"; return out; }
    if (pool == null) { out.why = `${BUCKET_LABEL[b]}: the OM doesn't break out this expense`; return out; }
    let a = share * pool;
    let how = `${(share * 100).toFixed(2)}% pro-rata of $${r0(pool).toLocaleString()}`;
    if (b === "cam") {
      if (terms.mgmtInCam === true && pools.mgmt != null) { a += share * pools.mgmt; how += ` + mgmt fee`; }
      if (admin > 0) { a *= 1 + admin; how += ` + ${terms.adminFeePct}% admin`; }
    }
    out.lines.push({ bucket: b, how, amount: r0(a) }); total += a;
  }
  if (terms.capPsf != null && sf != null && total > terms.capPsf * sf) total = terms.capPsf * sf;
  out.value = r0(total);
  return out;
}

export interface RecoveryReconciliation {
  /** Σ recoveries we could put a number on (disclosed + calculated). */
  accounted: number;
  /** The OM's own total recovery income, when stated. */
  omTotal: number | null;
  /** Share of leased SF that has a number (0–1). */
  coverage: number;
  /** accounted ÷ omTotal. */
  ratio: number | null;
  /** "high" = we account for MORE than the OM says the center collects (our numbers
   *  are too high — caps / fixed CAM / carve-outs we can't see); "low" = near-full
   *  coverage but far below it (we're missing a charge). null = ties / can't tell. */
  verdict: "high" | "low" | null;
}

/**
 * Center-level eyeball check (the "does $5 vs $7 make sense" test, at the property
 * level): the tenants we can put a number on can never collect MORE than the OM
 * says the whole center collects, because the ones we can't calculate pay too.
 */
export function reconcileRecoveries(
  rows: Array<{ sf: number; value: number | null; gross?: boolean }>,
  omTotal: number | null,
): RecoveryReconciliation {
  // Coverage is measured over the tenants that PAY recoveries: a gross lease's $0 is
  // a fact, and counting it as "covered" would make a missing charge look like a
  // shortfall in the whole center.
  let accounted = 0, coveredSF = 0, payingSF = 0;
  for (const r of rows) {
    if (r.value != null) accounted += r.value;
    if (r.gross) continue;
    payingSF += r.sf;
    if (r.value != null) coveredSF += r.sf;
  }
  const coverage = payingSF > 0 ? coveredSF / payingSF : 0;
  const ratio = omTotal != null && omTotal > 0 ? accounted / omTotal : null;
  const verdict = ratio == null ? null
    : ratio > 1.2 ? "high"
    : coverage >= 0.9 && ratio < 0.6 ? "low"
    : null;
  return { accounted: r0(accounted), omTotal, coverage, ratio, verdict };
}

/**
 * Percentage rent for the occupancy-cost numerator. Disclosed $ first; else the
 * lease's own formula (sales over the breakpoint × rate, or sales × rate when it's
 * paid in lieu of base rent); else — when the tenant HAS a percentage-rent clause we
 * can't price — undefined, so the caller withholds occupancy cost instead of
 * understating it. 0 when there's no sign of percentage rent at all.
 */
export function resolvePercentRent(
  t: { percentageRent?: unknown; percentageRentRate?: unknown; percentageRentBreakpoint?: unknown; percentageRentClause?: unknown; leaseType?: unknown; reimbursementMethod?: unknown },
  grossSales: number | null,
): { amount: number; how: "disclosed" | "formula" | "none" } | undefined {
  const n = (v: unknown) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const disclosed = n(t.percentageRent);
  if (disclosed != null) return { amount: disclosed, how: "disclosed" };
  const rate = n(t.percentageRentRate), bp = n(t.percentageRentBreakpoint);
  const clause = String(t.percentageRentClause ?? "");
  const inLieu = /in lieu/i.test(`${clause} ${t.leaseType ?? ""} ${t.reimbursementMethod ?? ""}`);
  if (grossSales != null && rate != null && rate > 0) {
    if (inLieu && (bp == null || bp <= 0)) return { amount: r0(grossSales * rate / 100), how: "formula" };
    if (bp != null && bp > 0) return { amount: r0(Math.max(0, grossSales - bp) * rate / 100), how: "formula" };
  }
  const hasClause = (rate != null && rate > 0) || (bp != null && bp > 0) || (clause.trim() !== "" && !/^(none|n\/a|no)\b/i.test(clause.trim()));
  return hasClause || inLieu ? undefined : { amount: 0, how: "none" };
}
