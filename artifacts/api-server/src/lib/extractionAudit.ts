// Deterministic post-extraction INTEGRITY AUDIT. Runs on the extracted deal (no model,
// no network) and folds review questions into Import Review when the numbers don't tie
// out — the same arithmetic discipline a careful underwriter applies to an OM by hand:
//   • Roster SF vs building GLA (catches dropped/merged suites — the vacancy bug).
//   • Stated occupancy vs the roster-implied occupancy.
//   • NOI ÷ cap rate vs price (the classic three-way tie-out).
//   • Weighted-avg rent PSF vs the roster roll-up.
//   • Per-tenant: rent PSF × SF vs annual rent (OCR / column errors).
//   • Duplicate suite numbers across two different tenants.
//   • Unit-of-measure sanity (occupancy as a fraction, cap rate as basis points).
// Only fires on genuine CONTRADICTIONS — never on values that are simply absent.

export interface AuditQuestion {
  id: string;
  source: "check";
  severity: "high" | "medium" | "low";
  field: string;
  question: string;
  detail: string | null;
  suggestedValue: string | null;
  target: { kind: "deal" | "tenant"; fieldKey: string; tenantName?: string | null; valueType?: "number" | "text" } | null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[$,%\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const isVacantName = (name: unknown): boolean => {
  const s = String(name ?? "").trim().toLowerCase();
  return !s || s === "-" || /^(vacant|available|avail|spec(ulative)?|white\s*box|tbd|to\s+be\s+leased)\b/.test(s);
};
const usd = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n).toLocaleString()}`;
const sf = (n: number) => `${Math.round(n).toLocaleString()} SF`;

interface TenantLike { name?: unknown; sf?: unknown; suite?: unknown; rentPerSF?: unknown; annualRent?: unknown; expenseReimbursements?: unknown; isNAP?: unknown; isAnchor?: unknown; occupancyCost?: unknown; salesPSF?: unknown; percentageRent?: unknown; otherRent?: unknown }

// Namespaces these arithmetic checks so a re-audit can self-heal only its own flags
// (drop ones that now pass, add new ones) without touching AI questions or lease-risk
// validators. Every id auditExtraction emits starts with this.
export const AUDIT_ID_PREFIX = "audit-";

// Collapse per-tenant / per-suite ids to a stable CHECK key, for the firing breakdown.
export function auditCheckKey(id: string): string {
  if (id.startsWith("audit-rent-tie-")) return "audit-rent-tie";
  if (id.startsWith("audit-occ-stated-vs-computed-")) return "audit-occ-stated-vs-computed";
  if (id.startsWith("audit-occcost-fraction-")) return "audit-occcost-fraction";
  if (id.startsWith("audit-dupe-suite-")) return "audit-dupe-suite";
  return id;
}
export const AUDIT_CHECK_LABELS: Record<string, string> = {
  "audit-sf-gla-short": "Roster SF short of GLA",
  "audit-sf-gla-over": "Roster SF over GLA",
  "audit-occupancy-tieout": "Occupancy vs roster",
  "audit-noi-cap-price": "NOI ÷ cap vs price",
  "audit-avg-rent-psf": "Avg rent vs roll-up",
  "audit-rent-tie": "Tenant rent × SF",
  "audit-occ-stated-vs-computed": "Occ cost: stated vs computed",
  "audit-occcost-fraction": "Occ cost stored as fraction",
  "audit-dupe-suite": "Duplicate suite #",
  "audit-occupancy-fraction": "Occupancy as a fraction",
  "audit-caprate-range": "Cap-rate units",
  "audit-price-psf": "Price PSF vs price ÷ GLA",
  "audit-noi-gt-egi": "NOI > gross income",
  "audit-noi-egi-opex": "NOI ≠ EGI − OpEx",
  "audit-noi-vs-cf": "NOI vs cash-flow Yr 1",
  "audit-cf-noi-row": "Cash-flow subtotal",
  "audit-recoveries-rollup": "Recoveries roll-up",
  "audit-gpr-vs-rent": "GPR vs in-place rent",
  "audit-rentroll-incomplete": "Rent roll didn't extract",
};

// SOURCE-LEVEL signal (runs on the raw PDF text BEFORE/alongside the LLM, not the
// extracted deal): when an OM yields almost no extractable text per page, it is a
// SCANNED / image-based document — the model (and especially the rent roll and
// financial tables) will read poorly, producing a sparse, misleadingly-empty deal.
// Surfaced as a high-severity review question so the user is told up front that the
// text wasn't readable and can re-save the OM as a text PDF or upload a structured
// rent roll / financials. Deliberately NOT in the audit-* namespace: a token-free
// re-audit has no source text, so it must not be able to auto-drop this warning.
export function auditSourceText(text: string, pageCount: number): AuditQuestion[] {
  const out: AuditQuestion[] = [];
  const len = (text ?? "").trim().length;
  // Need a few pages to judge; a 1–2 page teaser isn't a "scanned OM".
  if (pageCount >= 3) {
    const perPage = len / pageCount;
    // Text-based OMs run thousands of chars/page (even with image pages mixed in).
    // Under ~250 chars/page across the whole document means the text layer is
    // essentially empty — a scan or a flattened-image export.
    if (perPage < 250) {
      out.push({
        id: "src-scanned-pdf", source: "check", severity: "high",
        field: "OM is scanned / text not readable",
        question: `This OM looks scanned or image-based — only about ${Math.round(perPage)} characters of text per page were readable across ${pageCount} pages, so much of it (often the rent roll and financials) likely didn't extract. Re-upload a text-based PDF, or upload a structured rent roll / financials.`,
        detail: `A text-based OM yields thousands of readable characters per page; a near-empty text layer means the document is a scan or flattened image, so the AI is reading very little of it. Captured fields will be sparse — treat the blanks as "couldn't read," not "no data."`,
        suggestedValue: null, target: null,
      });
    }
  }
  return out;
}

export function auditExtraction(deal: Record<string, unknown>): AuditQuestion[] {
  const out: AuditQuestion[] = [];
  const tenants: TenantLike[] = Array.isArray(deal.tenants) ? (deal.tenants as TenantLike[]) : [];
  // NAP / unowned parcels are excluded from owned-GLA math entirely.
  const owned = tenants.filter(t => !t.isNAP);
  const occupied = owned.filter(t => !isVacantName(t.name));
  const vacant = owned.filter(t => isVacantName(t.name));

  const sumSF = (rows: TenantLike[]) => rows.reduce((s, t) => s + (num(t.sf) ?? 0), 0);
  const occupiedSF = sumSF(occupied);
  const vacantSF = sumSF(vacant);
  const rosterSF = occupiedSF + vacantSF;
  const totalSF = num(deal.totalSF);

  // ── A. Roster SF vs building GLA — the dropped/merged-suite catch ──────────────
  if (totalSF != null && totalSF > 0 && rosterSF > 0) {
    const gap = totalSF - rosterSF;
    const pct = Math.abs(gap) / totalSF;
    if (gap > 0 && pct > 0.04 && gap > 5000) {
      // Is the shortfall just UNLISTED VACANCY rather than a dropped OCCUPIED suite?
      // If the roster carries no vacant rows but its occupied SF already matches the
      // GLA × stated-occupancy, the missing space is the (un-itemized) vacant portion —
      // the figures tie out; the roster is only missing explicit vacant suites. The
      // high-severity "suites missing" case is when occupied SF falls materially BELOW
      // what the stated occupancy implies (a real occupied tenant was dropped).
      const statedOcc = num(deal.occupancy);
      const impliedOccSF = statedOcc != null && statedOcc > 0 && statedOcc <= 100 ? totalSF * (statedOcc / 100) : null;
      const gapIsUnlistedVacancy = vacantSF === 0 && impliedOccSF != null && occupiedSF >= impliedOccSF * 0.97;
      if (gapIsUnlistedVacancy) {
        out.push({
          id: "audit-sf-gla-short", source: "check", severity: "low",
          field: "Tenant roster completeness",
          question: `The roster has no vacant suites, so ~${sf(gap)} (${Math.round(pct * 100)}%) of GLA isn't itemized — but that matches the vacancy implied by the stated ${statedOcc}% occupancy, so the figures tie out. Add the vacant suites for a complete roster when convenient.`,
          detail: `Occupied ${sf(occupiedSF)} ≈ the ${sf(impliedOccSF!)} implied by ${statedOcc}% occupancy, so the shortfall is un-itemized vacant space — not a dropped occupied tenant. No financial impact; this is roster completeness only.`,
          suggestedValue: null, target: null,
        });
      } else {
        out.push({
          id: "audit-sf-gla-short", source: "check", severity: "high",
          field: "Tenant roster completeness",
          question: `The roster's suites sum to ${sf(rosterSF)} but the property GLA is ${sf(totalSF)} — about ${sf(gap)} (${Math.round(pct * 100)}%) is unaccounted for, and that's MORE than the stated occupancy explains. Are occupied suites missing from the roster?`,
          detail: `Occupied ${sf(occupiedSF)} + vacant ${sf(vacantSF)} = ${sf(rosterSF)}, short of the ${sf(totalSF)} GLA${impliedOccSF != null ? ` and below the ${sf(impliedOccSF)} implied by ${num(deal.occupancy)}% occupancy` : ""}. A dropped occupied tenant or merged vacant suites would cause this — check against the rent roll / stacking plan.`,
          suggestedValue: null, target: null,
        });
      }
    } else if (gap < 0 && pct > 0.04 && -gap > 5000) {
      out.push({
        id: "audit-sf-gla-over", source: "check", severity: "medium",
        field: "Tenant roster vs GLA",
        question: `The roster's suites sum to ${sf(rosterSF)}, which EXCEEDS the property GLA of ${sf(totalSF)} by ${sf(-gap)}. Is a suite double-counted, or is the GLA wrong?`,
        detail: `A merged tenant with summed SF, a duplicated row, or an understated GLA would cause the roster to over-run the building.`,
        suggestedValue: String(Math.round(totalSF)), target: { kind: "deal", fieldKey: "totalSF", valueType: "number" },
      });
    }
  }

  // ── B. Stated occupancy vs roster-implied occupancy ───────────────────────────
  const occ = num(deal.occupancy);
  const denomSF = totalSF ?? (rosterSF > 0 ? rosterSF : null);
  if (occ != null && denomSF != null && denomSF > 0 && occupiedSF > 0) {
    const implied = (occupiedSF / denomSF) * 100;
    if (Math.abs(occ - implied) > 3) {
      out.push({
        id: "audit-occupancy-tieout", source: "check", severity: "medium",
        field: "Occupancy",
        question: `Stated occupancy is ${occ.toFixed(1)}%, but the roster implies ${implied.toFixed(1)}% (occupied ${sf(occupiedSF)} ÷ ${sf(denomSF)}). Which is right?`,
        detail: `A missing tenant, a vacancy captured as occupied (or vice-versa), or a wrong GLA will move this. Reconcile before trusting the occupancy figure.`,
        suggestedValue: occ.toFixed(1), target: { kind: "deal", fieldKey: "occupancy", valueType: "number" },
      });
    }
  }

  // ── C. NOI ÷ cap rate vs price — the three-way tie-out ────────────────────────
  const noi = num(deal.noi);
  const cap = num(deal.capRate);
  const price = num(deal.askingPrice) ?? num(deal.txnPurchasePrice);
  if (noi != null && noi > 0 && cap != null && cap > 0 && cap < 25 && price != null && price > 0) {
    const implied = noi / (cap / 100);
    const pct = Math.abs(implied - price) / price;
    if (pct > 0.06) {
      out.push({
        id: "audit-noi-cap-price", source: "check", severity: "high",
        field: "NOI / cap rate / price",
        question: `These don't tie out: NOI ${usd(noi)} ÷ cap ${cap}% = ${usd(implied)}, but the price is ${usd(price)} (a ${Math.round(pct * 100)}% gap). Which figure is off?`,
        detail: `In-place NOI, cap rate, and price are mathematically linked (price = NOI ÷ cap). A ${Math.round(pct * 100)}% gap means one was mis-captured or they're quoted on different bases (e.g. a pro-forma cap on in-place NOI).`,
        suggestedValue: null, target: null,
      });
    }
  }

  // ── D. Weighted-avg rent PSF vs the roster roll-up ────────────────────────────
  const sumRent = occupied.reduce((s, t) => s + (num(t.annualRent) ?? 0), 0);
  const statedPSF = num(deal.weightedAvgRentPSF);
  if (statedPSF != null && statedPSF > 0 && sumRent > 0 && occupiedSF > 0) {
    const computed = sumRent / occupiedSF;
    if (Math.abs(computed - statedPSF) / statedPSF > 0.15) {
      out.push({
        id: "audit-avg-rent-psf", source: "check", severity: "medium",
        field: "Weighted-avg rent PSF",
        question: `The stated weighted-avg rent is $${statedPSF.toFixed(2)} PSF, but the roster rolls up to $${computed.toFixed(2)} PSF (${usd(sumRent)} base rent ÷ ${sf(occupiedSF)}). Reconcile.`,
        detail: `A tenant's rent or SF may be mis-captured, or the stated average uses a different basis (e.g. includes recoveries). Recompute from the roster.`,
        suggestedValue: statedPSF.toFixed(2), target: { kind: "deal", fieldKey: "weightedAvgRentPSF", valueType: "number" },
      });
    }
  }

  // ── E. Per-tenant: rent PSF × SF vs annual rent (worst 2) ─────────────────────
  const mism: { t: TenantLike; pct: number; psf: number; tsf: number; ann: number }[] = [];
  for (const t of occupied) {
    const psf = num(t.rentPerSF); const tsf = num(t.sf); const ann = num(t.annualRent);
    if (psf != null && psf > 0 && tsf != null && tsf > 0 && ann != null && ann > 1000) {
      const absGap = Math.abs(psf * tsf - ann);
      const pct = absGap / ann;
      // Need BOTH a material % AND a material $ gap — rounding and small inline tenants
      // shouldn't fire; real OCR / wrong-column slips show up as large dollar gaps.
      if (pct > 0.15 && absGap > 10000) mism.push({ t, pct, psf, tsf, ann });
    }
  }
  mism.sort((a, b) => b.pct - a.pct);
  for (const m of mism.slice(0, 2)) {
    const nm = String(m.t.name ?? "tenant");
    out.push({
      id: `audit-rent-tie-${nm}`.slice(0, 80), source: "check", severity: "medium",
      field: `${nm} — rent vs SF`,
      question: `${nm}: $${m.psf.toFixed(2)} PSF × ${sf(m.tsf)} = ${usd(m.psf * m.tsf)}, but the annual rent is ${usd(m.ann)} (${Math.round(m.pct * 100)}% off). One of these is wrong.`,
      detail: `Rent PSF, SF, and annual base rent must multiply out. A gap this size is usually an OCR slip or a column read from the wrong row.`,
      suggestedValue: usd(m.ann), target: { kind: "tenant", fieldKey: "annualRent", tenantName: nm, valueType: "number" },
    });
  }

  // ── E2. Per-tenant: OM-STATED occupancy cost vs the COMPUTED one (rent ÷ sales) ─
  // A material gap means the OM figure was mis-read, OR the OM's sales are on a
  // different basis than the reported sales (e.g. a pharmacy's 3rd-party-plan Rx,
  // excluded from reported sales but used in the OM's health ratio). Either way,
  // surface it. Health ratio = (base + recoveries + % rent + other) ÷ gross sales.
  const occMism: { nm: string; stated: number; computed: number; base: number; reimb: number; sales: number }[] = [];
  for (const t of occupied) {
    const stated = num(t.occupancyCost);
    if (stated == null || stated <= 0) continue;
    const base = num(t.annualRent);
    const reimb = num(t.expenseReimbursements);
    if (base == null || reimb == null) continue;
    const pctRent = num(t.percentageRent) ?? 0;
    const other = num(t.otherRent) ?? 0;
    const psf = num(t.salesPSF); const tsf = num(t.sf);
    const sales = (psf != null && psf > 0 && tsf != null && tsf > 0) ? psf * tsf : null;
    if (sales == null || sales <= 0) continue;
    const computed = ((base + reimb + pctRent + other) / sales) * 100;
    if (!(computed > 0)) continue;
    const relGap = Math.abs(stated - computed) / computed;
    const absGap = Math.abs(stated - computed);
    // Need a big relative AND absolute gap so occupancy-cost rounding never fires.
    if (relGap > 0.30 && absGap > 2) occMism.push({ nm: String(t.name ?? "tenant"), stated, computed, base, reimb, sales });
  }
  occMism.sort((a, b) => Math.abs(b.stated - b.computed) - Math.abs(a.stated - a.computed));
  for (const m of occMism.slice(0, 3)) {
    out.push({
      id: `audit-occ-stated-vs-computed-${m.nm}`.slice(0, 80), source: "check", severity: "medium",
      field: `${m.nm} — occupancy cost`,
      question: `${m.nm}: the OM-stated occupancy cost (${m.stated.toFixed(1)}%) differs materially from the computed ${m.computed.toFixed(1)}% (rent + recoveries ÷ sales). Which is right?`,
      detail: `Stated ${m.stated.toFixed(1)}% vs computed ${m.computed.toFixed(1)}% (base ${usd(m.base)} + recoveries ${usd(m.reimb)} ÷ sales ${usd(m.sales)}). A gap this large usually means the OM figure was mis-read, OR the OM's sales are on a different basis than the reported sales (e.g. a pharmacy's 3rd-party-plan Rx, excluded from reported sales but used in the OM's health ratio). Confirm the occupancy cost and the sales basis.`,
      suggestedValue: m.stated.toFixed(1), target: { kind: "tenant", fieldKey: "occupancyCost", tenantName: m.nm, valueType: "number" },
    });
  }

  // ── E3. occupancyCost stored as a FRACTION instead of a percent (unit slip) ────
  // The field is a PERCENT (e.g. 11.8 = 11.8%). A value below 1 is almost certainly a
  // 0.NN fraction that lost its ×100 on import (e.g. 0.225 → 22.5%), which then renders
  // as "0.2%". Retail occupancy cost under ~1% is effectively impossible, so flag it
  // with the ×100 value as the suggested fix. (Surfaced across the portfolio by the
  // validation harness — a clean 100× slip where the corrected value matches the
  // computed health ratio.)
  let occUnitFlags = 0;
  for (const t of occupied) {
    if (occUnitFlags >= 6) break;
    const oc = num(t.occupancyCost);
    if (oc == null || oc <= 0 || oc >= 1) continue;
    const nm = String(t.name ?? "tenant");
    const fixed = oc * 100;
    occUnitFlags++;
    out.push({
      id: `audit-occcost-fraction-${nm}`.slice(0, 80), source: "check", severity: "medium",
      field: `${nm} — occupancy cost units`,
      question: `${nm}: occupancy cost is stored as ${oc}, which displays as ${oc}% but is almost certainly ${fixed.toFixed(1)}% stored as a 0.NN fraction. Should it be ${fixed.toFixed(1)}%?`,
      detail: `Occupancy cost is a PERCENT field (11.8 = 11.8%). A value below 1 means the ×100 was dropped on import, so it renders as "${oc}%" instead of "${fixed.toFixed(1)}%". Retail occupancy cost under 1% is effectively impossible — the corrected value typically matches the computed (rent + recoveries ÷ sales) health ratio.`,
      suggestedValue: fixed.toFixed(1), target: { kind: "tenant", fieldKey: "occupancyCost", tenantName: nm, valueType: "number" },
    });
  }

  // ── F. Duplicate suite numbers across two DIFFERENT tenants ───────────────────
  const bySuite = new Map<string, Set<string>>();
  for (const t of occupied) {
    const s = String(t.suite ?? "").trim().toLowerCase().replace(/^0+/, "");
    if (!s) continue;
    const nm = String(t.name ?? "").trim().toLowerCase();
    if (!bySuite.has(s)) bySuite.set(s, new Set());
    bySuite.get(s)!.add(nm);
  }
  for (const [s, names] of bySuite) {
    if (names.size > 1) {
      out.push({
        id: `audit-dupe-suite-${s}`.slice(0, 80), source: "check", severity: "medium",
        field: `Suite ${s}`,
        question: `Suite ${s} is assigned to ${names.size} different tenants (${[...names].join(", ")}). Likely a mis-keyed suite or a duplicate row.`,
        detail: `Each occupied suite should map to one tenant. Confirm the suite numbers against the rent roll.`,
        suggestedValue: null, target: null,
      });
    }
  }

  // ── G. Unit-of-measure sanity (cheap, catches order-of-magnitude slips) ───────
  if (occ != null && occ > 0 && occ <= 1.5) {
    out.push({
      id: "audit-occupancy-fraction", source: "check", severity: "medium",
      field: "Occupancy",
      question: `Occupancy is ${occ} — that looks like a fraction. Should it be ${(occ * 100).toFixed(1)}%?`,
      detail: `Occupancy is stored as a percentage (e.g. 92.8), not a 0–1 fraction.`,
      suggestedValue: (occ * 100).toFixed(1), target: { kind: "deal", fieldKey: "occupancy", valueType: "number" },
    });
  }
  if (cap != null && (cap > 20 || (cap > 0 && cap < 1))) {
    out.push({
      id: "audit-caprate-range", source: "check", severity: "medium",
      field: "Cap rate",
      question: cap > 20
        ? `Cap rate is ${cap}% — that's implausibly high. Was it entered in basis points (e.g. 650 → 6.50%)?`
        : `Cap rate is ${cap}% — that looks like a fraction. Should it be ${(cap * 100).toFixed(2)}%?`,
      detail: `Commercial cap rates are typically ~4–12%. Confirm the units.`,
      suggestedValue: cap > 20 ? (cap / 100).toFixed(2) : (cap * 100).toFixed(2),
      target: { kind: "deal", fieldKey: "capRate", valueType: "number" },
    });
  }

  // ── H. Price PSF vs price ÷ GLA ───────────────────────────────────────────────
  const pPSF = num(deal.pricePerSF);
  if (pPSF != null && pPSF > 0 && price != null && price > 0 && totalSF != null && totalSF > 0) {
    const computed = price / totalSF;
    if (Math.abs(computed - pPSF) / pPSF > 0.05) {
      out.push({
        id: "audit-price-psf", source: "check", severity: "medium", field: "Price PSF",
        question: `Price PSF is $${pPSF.toFixed(0)}, but price ÷ GLA = $${computed.toFixed(0)} (${usd(price)} ÷ ${sf(totalSF)}). One is off.`,
        detail: `Price per SF must equal the purchase price divided by GLA.`,
        suggestedValue: computed.toFixed(0), target: { kind: "deal", fieldKey: "pricePerSF", valueType: "number" },
      });
    }
  }

  // ── I. Income-statement tie-outs: NOI vs EGI, and NOI = EGI − OpEx ─────────────
  const egi = num(deal.effectiveGrossIncome);
  const opex = num(deal.operatingExpenses);
  if (noi != null && noi > 0 && egi != null && egi > 0 && noi > egi * 1.02) {
    out.push({
      id: "audit-noi-gt-egi", source: "check", severity: "high", field: "NOI vs gross income",
      question: `NOI (${usd(noi)}) is higher than effective gross income (${usd(egi)}) — not possible, since NOI = income − expenses. One figure is wrong.`,
      detail: `NOI cannot exceed the income it's derived from. Check whether EGI or NOI was mis-captured.`,
      suggestedValue: null, target: null,
    });
  } else if (noi != null && noi > 0 && egi != null && egi > 0 && opex != null && opex >= 0) {
    const impliedNoi = egi - opex;
    if (impliedNoi > 0 && Math.abs(impliedNoi - noi) / Math.max(noi, impliedNoi) > 0.05) {
      out.push({
        id: "audit-noi-egi-opex", source: "check", severity: "medium", field: "NOI / EGI / OpEx",
        question: `EGI ${usd(egi)} − OpEx ${usd(opex)} = ${usd(impliedNoi)}, but NOI is ${usd(noi)} (${Math.round(Math.abs(impliedNoi - noi) / Math.max(noi, impliedNoi) * 100)}% off). Reconcile.`,
        detail: `NOI should equal effective gross income minus operating expenses.`,
        suggestedValue: null, target: null,
      });
    }
  }

  // ── J/K. Cash-flow page: Yr-1 NOI vs headline NOI, and per-row NOI = EGR − OpEx ─
  const cf = Array.isArray(deal.cashFlowProjection) ? (deal.cashFlowProjection as Record<string, unknown>[]) : [];
  if (cf.length && noi != null && noi > 0) {
    const y1 = num(cf[0]?.noi);
    if (y1 != null && y1 > 0 && Math.abs(y1 - noi) / noi > 0.07) {
      out.push({
        id: "audit-noi-vs-cf", source: "check", severity: "medium", field: "NOI vs cash-flow Yr 1",
        question: `Headline NOI is ${usd(noi)}, but the cash-flow's first year shows ${usd(y1)} (${Math.round(Math.abs(y1 - noi) / noi * 100)}% off). Which is the in-place NOI?`,
        detail: `The stated NOI should match the cash-flow's in-place (year-1) NOI unless one is explicitly pro-forma.`,
        suggestedValue: null, target: null,
      });
    }
    let worst: { k: number; egr: number; ox: number; rn: number; imp: number; d: number } | null = null;
    for (let k = 0; k < cf.length; k++) {
      const egr = num(cf[k]?.egr), oxRaw = num(cf[k]?.operatingExpenses), rn = num(cf[k]?.noi);
      if (egr != null && egr > 0 && oxRaw != null && rn != null) {
        // OpEx in a cash-flow row is often stored NEGATIVE (expense sign convention),
        // so NOI = EGR − |OpEx| — using the raw value double-negated and false-flagged.
        const ox = Math.abs(oxRaw);
        const imp = egr - ox;
        const gapd = Math.abs(imp - rn);
        const d = gapd / Math.max(Math.abs(rn), Math.abs(imp), 1);
        // A CF's NOI can legitimately differ from EGR−OpEx by small amounts (reserves,
        // line-item mapping) — only flag a material gap in BOTH % and $.
        if (d > 0.08 && gapd > 25000 && (!worst || d > worst.d)) worst = { k, egr, ox, rn, imp, d };
      }
    }
    if (worst) {
      out.push({
        id: "audit-cf-noi-row", source: "check", severity: "medium", field: `Cash-flow NOI (yr ${worst.k + 1})`,
        question: `Cash-flow year ${worst.k + 1}: EGR ${usd(worst.egr)} − OpEx ${usd(worst.ox)} = ${usd(worst.imp)}, but the NOI row shows ${usd(worst.rn)}. The subtotal doesn't add up.`,
        detail: `Each cash-flow year's NOI must equal effective gross revenue minus operating expenses — a gap signals a sign error or a mis-keyed line.`,
        suggestedValue: null, target: null,
      });
    }
  }

  // ── L. Recoveries roll-up vs the stated NNN recovery line ─────────────────────
  // Only when MOST occupied tenants carry a captured reimbursement $ (else the sum is
  // partial and would falsely read low).
  const withReimb = occupied.filter(t => num(t.expenseReimbursements) != null);
  const nnn = num(deal.nnnRecoveries);
  if (nnn != null && nnn > 0 && occupied.length >= 5 && withReimb.length >= Math.max(4, Math.ceil(occupied.length * 0.8))) {
    const sumReimb = withReimb.reduce((s, t) => s + (num(t.expenseReimbursements) ?? 0), 0);
    // Recoveries rarely roll up cleanly (vacancy, gross-up, CAM caps, admin fees), so
    // only a LARGE divergence is worth flagging.
    if (sumReimb > 0 && Math.abs(sumReimb - nnn) / nnn > 0.30) {
      out.push({
        id: "audit-recoveries-rollup", source: "check", severity: "low", field: "Recoveries roll-up",
        question: `The stated NNN recovery line is ${usd(nnn)}, but the tenants' reimbursements roll up to ${usd(sumReimb)} (${Math.round(Math.abs(sumReimb - nnn) / nnn * 100)}% off). Reconcile.`,
        detail: `When tenant-level recoveries are captured for most of the roster, their sum should approximate the center's stated recovery income (some vacancy/leakage is normal).`,
        suggestedValue: null, target: null,
      });
    }
  }

  // ── N. Incomplete rent-roll capture (the image/scanned rent-roll catch) ───────
  // Many OMs print the detailed rent roll as a SCANNED IMAGE (or a flattened vector
  // table) that yields no extractable text, while the tenant NAMES still come through
  // from the text site-plan / stacking diagram. The result is a believable roster
  // with almost no base rents or lease dates — a silently thin extraction. If most
  // OCCUPIED tenants are missing BOTH a base rent and a lease expiry, flag it so the
  // user knows to supply a structured rent roll rather than trust the gap as "no data".
  if (occupied.length >= 8) {
    const hasRent = (t: TenantLike) => num(t.rentPerSF) != null || num(t.annualRent) != null;
    const hasExpiry = (t: TenantLike) => {
      const v = (t as { leaseExpiry?: unknown }).leaseExpiry;
      return v != null && String(v).trim() !== "";
    };
    const withRent = occupied.filter(hasRent).length;
    const withTerms = occupied.filter(t => hasRent(t) || hasExpiry(t)).length;
    const rentPct = withRent / occupied.length;
    const termsPct = withTerms / occupied.length;
    // Fire only when the roster is clearly present but the economics are mostly absent.
    if (termsPct < 0.5) {
      out.push({
        id: "audit-rentroll-incomplete", source: "check", severity: "high",
        field: "Rent roll completeness",
        question: `The roster lists ${occupied.length} occupied tenants, but only ${withRent} (${Math.round(rentPct * 100)}%) have a base rent and ${withTerms} (${Math.round(termsPct * 100)}%) have any rent or lease-expiry captured. Did the detailed rent roll extract?`,
        detail: `OM rent rolls are frequently printed as scanned IMAGES or flattened tables that yield no extractable text, even though tenant names still come through from the site plan — producing a roster with the economics missing. Re-run extraction on the rent-roll pages, or upload a structured rent roll (Excel/CSV) or the Argus file so per-tenant base rents, dates, and recoveries are captured. Don't treat the blanks as "no rent."`,
        suggestedValue: null, target: null,
      });
    }
  }

  // ── M. Gross potential rent vs in-place base rent ─────────────────────────────
  const gpr = num(deal.grossPotentialRent);
  if (gpr != null && gpr > 0 && sumRent > 0 && gpr < sumRent * 0.95) {
    out.push({
      id: "audit-gpr-vs-rent", source: "check", severity: "low", field: "Gross potential rent",
      question: `Gross potential rent (${usd(gpr)}) is below the in-place base rent roll-up (${usd(sumRent)}). GPR should include vacant space at market, so it shouldn't be lower.`,
      detail: `GPR = all space at market (incl. vacant). If it's below in-place contractual rent, GPR or a tenant rent is mis-captured.`,
      suggestedValue: null, target: null,
    });
  }

  return out;
}
