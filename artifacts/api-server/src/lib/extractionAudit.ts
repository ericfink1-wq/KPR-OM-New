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
// Parse an ISO-ish date (YYYY-MM-DD…) to epoch ms; null when it isn't a real date.
const parseISO = (v: unknown): number | null => {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const t = Date.parse(s.slice(0, 10));
  return Number.isFinite(t) ? t : null;
};

interface TenantLike { name?: unknown; sf?: unknown; suite?: unknown; rentPerSF?: unknown; annualRent?: unknown; expenseReimbursements?: unknown; isNAP?: unknown; isAnchor?: unknown; occupancyCost?: unknown; salesPSF?: unknown; percentageRent?: unknown; otherRent?: unknown; leaseStart?: unknown; leaseExpiry?: unknown }

// Namespaces these arithmetic checks so a re-audit can self-heal only its own flags
// (drop ones that now pass, add new ones) without touching AI questions or lease-risk
// validators. Every id auditExtraction emits starts with this.
export const AUDIT_ID_PREFIX = "audit-";

// Collapse per-tenant / per-suite ids to a stable CHECK key, for the firing breakdown.
export function auditCheckKey(id: string): string {
  if (id.startsWith("audit-rent-tie-")) return "audit-rent-tie";
  if (id.startsWith("audit-rent-impossible-")) return "audit-rent-impossible";
  if (id.startsWith("audit-anchor-rent-")) return "audit-anchor-rent";
  if (id.startsWith("audit-occ-stated-vs-computed-")) return "audit-occ-stated-vs-computed";
  if (id.startsWith("audit-occcost-fraction-")) return "audit-occcost-fraction";
  if (id.startsWith("audit-dupe-suite-")) return "audit-dupe-suite";
  if (id.startsWith("audit-lease-dates-")) return "audit-lease-dates";
  if (id.startsWith("audit-sales-below-rent-")) return "audit-sales-below-rent";
  if (id.startsWith("audit-dupe-tenant-")) return "audit-dupe-tenant";
  return id;
}
export const AUDIT_CHECK_LABELS: Record<string, string> = {
  "audit-sf-gla-short": "Roster SF short of GLA",
  "audit-sf-gla-over": "Roster SF over GLA",
  "audit-occupancy-tieout": "Occupancy vs roster",
  "audit-noi-cap-price": "NOI ÷ cap vs price",
  "audit-avg-rent-psf": "Avg rent vs roll-up",
  "audit-rent-tie": "Tenant rent × SF",
  "audit-rent-impossible": "Impossible retail rent",
  "audit-anchor-rent": "Anchor rent — verify",
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
  "audit-lease-dates": "Lease expiry before start",
  "audit-occupancy-over-100": "Occupancy over 100%",
  "audit-sales-below-rent": "Sales PSF below rent PSF",
  "audit-reno-before-built": "Renovated before built",
  "audit-anchor-missing": "Grocery anchor missing",
  "audit-walt-recompute": "WALT vs roster expiries",
  "audit-dupe-tenant": "Duplicate tenant row",
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

  // ── E1b. REAL-WORLD rent plausibility — does it make sense for an actual center? ──
  // In a live shopping center, ANCHORS (large-SF grocers/big boxes) pay LOW base rent
  // (~$3–$15/SF; junior anchors up to ~$25), so a 20,000+ SF tenant above ~$30/SF
  // almost always means CAM/recoveries were folded into the per-SF rent or a column was
  // misread — surface it to verify. And NO normal-sized retail space (>2,000 SF) pays
  // $175+/SF base; that's physically impossible in the real world, i.e. an extraction
  // error (a sales-PSF, a gross/total rate, or a decimal slip). Tiny ATM/kiosk pads
  // legitimately show huge per-SF rents and are excluded by the SF floors.
  for (const t of occupied) {
    const psf = num(t.rentPerSF), tsf = num(t.sf), nm = String(t.name ?? "tenant");
    if (psf == null || psf <= 0 || tsf == null || tsf <= 0) continue;
    if (tsf >= 2000 && psf > 175) {
      out.push({
        id: `audit-rent-impossible-${nm}`.slice(0, 80), source: "check", severity: "high",
        field: `${nm} — rent PSF`,
        question: `${nm}: $${psf.toFixed(2)}/SF on ${sf(tsf)} = ${usd(psf * tsf)}/yr. No real retail space that size pays $175+/SF base — almost certainly a misread (a sales-PSF, a gross/total rate, or a decimal slip). Verify the base rent.`,
        detail: `Real-world rents on a normal retail unit top out well under $100/SF; $175+ on a 2,000+ SF space is not physically plausible.`,
        suggestedValue: null, target: { kind: "tenant", fieldKey: "rentPerSF", tenantName: nm, valueType: "number" },
      });
    } else if (tsf >= 20000 && psf > 30) {
      out.push({
        id: `audit-anchor-rent-${nm}`.slice(0, 80), source: "check", severity: "low",
        field: `${nm} — anchor rent`,
        question: `${nm} is a ${sf(tsf)} anchor at $${psf.toFixed(2)}/SF — high for an anchor (grocers/big boxes pay ~$3–$15, junior anchors up to ~$25). Confirm this is BASE rent, not a gross/CAM-inclusive rate or a misread.`,
        detail: `Anchors hold a center on cheap rent; a high per-SF anchor rent usually means recoveries were folded into rentPerSF.`,
        suggestedValue: null, target: { kind: "tenant", fieldKey: "rentPerSF", tenantName: nm, valueType: "number" },
      });
    }
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

  // ── O. Per-tenant lease-date chronology: expiry must be AFTER commencement ─────
  // Swapped start/expiry columns or a mis-keyed year reads as an expiry on or before
  // the commencement — impossible, and it silently corrupts WALT and rollover.
  let dateFlags = 0;
  for (const t of occupied) {
    if (dateFlags >= 4) break;
    const start = parseISO(t.leaseStart), end = parseISO(t.leaseExpiry);
    if (start == null || end == null || end > start) continue;
    const nm = String(t.name ?? "tenant");
    dateFlags++;
    out.push({
      id: `audit-lease-dates-${nm}`.slice(0, 80), source: "check", severity: "medium",
      field: `${nm} — lease dates`,
      question: `${nm}: the lease expiry (${String(t.leaseExpiry).slice(0, 10)}) is on or before the commencement (${String(t.leaseStart).slice(0, 10)}). The dates are likely swapped or a year is mis-read.`,
      detail: `A lease must expire after it commences. Usually the start and expiry were read from the wrong columns, or one year is off — check the rent roll.`,
      suggestedValue: null, target: { kind: "tenant", fieldKey: "leaseExpiry", tenantName: nm, valueType: "text" },
    });
  }

  // ── P. Occupancy over 100% (impossible) ───────────────────────────────────────
  if (occ != null && occ > 100) {
    out.push({
      id: "audit-occupancy-over-100", source: "check", severity: "medium", field: "Occupancy",
      question: `Occupancy is ${occ}% — over 100% isn't possible. Re-check the occupied SF or the GLA.`,
      detail: `Occupancy can't exceed 100%; usually the occupied SF is overstated or the GLA is understated.`,
      suggestedValue: null, target: { kind: "deal", fieldKey: "occupancy", valueType: "number" },
    });
  }

  // ── Q. Per-tenant sales PSF below rent PSF (occupancy cost > 100%, implausible) ─
  let salesRentFlags = 0;
  for (const t of occupied) {
    if (salesRentFlags >= 3) break;
    const spsf = num(t.salesPSF), rpsf = num(t.rentPerSF);
    if (spsf == null || spsf <= 0 || rpsf == null || rpsf <= 0 || spsf >= rpsf) continue;
    const nm = String(t.name ?? "tenant");
    salesRentFlags++;
    out.push({
      id: `audit-sales-below-rent-${nm}`.slice(0, 80), source: "check", severity: "medium",
      field: `${nm} — sales vs rent`,
      question: `${nm}: reported sales of $${spsf.toFixed(0)} PSF are LOWER than the rent of $${rpsf.toFixed(2)} PSF — that implies an occupancy cost over 100%, which is implausible. One figure is mis-read.`,
      detail: `Sales PSF should comfortably exceed rent PSF (occupancy cost is typically 2–15%). Sales below rent usually means a units slip — e.g. sales captured in $000s, or a monthly/total figure read as an annual PSF.`,
      suggestedValue: null, target: { kind: "tenant", fieldKey: "salesPSF", tenantName: nm, valueType: "number" },
    });
  }

  // ── R. Renovation year before year built (impossible) ─────────────────────────
  const built = num(deal.yearBuilt), reno = num(deal.renovationYear);
  if (built != null && reno != null && built > 1800 && reno > 1800 && reno < built) {
    out.push({
      id: "audit-reno-before-built", source: "check", severity: "low", field: "Year renovated",
      question: `Renovation year (${reno}) is before the year built (${built}). One of the dates is wrong.`,
      detail: `A property can't be renovated before it was built — check which year was mis-captured.`,
      suggestedValue: null, target: { kind: "deal", fieldKey: "renovationYear", valueType: "number" },
    });
  }

  // ── S. Grocery-anchored center with NO anchor in the roster (dropped-anchor catch) ─
  // The grocer is the defining tenant; if it's missing AND there's no anchor-sized box
  // at all, the anchor row likely didn't extract (large boxes are often printed as an
  // image). Gated by "no big box present" so a regional grocer we don't name can't
  // false-fire.
  const centerType = String(deal.centerType ?? "").toLowerCase();
  const assetType = String(deal.assetType ?? "").toLowerCase();
  if ((/grocery/.test(centerType) || /grocery/.test(assetType)) && occupied.length >= 3) {
    const GROCER = /\b(kroger|safeway|albertsons|publix|cub foods|cub|jewel|giant eagle|giant|stop\s*&?\s*shop|shoprite|wegmans|whole foods|trader joe|aldi|food lion|harris teeter|ralphs|vons|sprouts|h-?e-?b|heb|winn-?dixie|hy-?vee|king soopers|fred meyer|smith'?s|meijer|food 4 less|grocery outlet|save\s*-?\s*a\s*-?\s*lot|piggly wiggly|ingles|weis|acme|tops|price chopper|market basket|raley'?s|stater bros|fareway|schnucks|dierbergs|brookshire|shaw'?s|star market|lidl|wic|sprouts farmers)\b/i;
    const hasGrocer = occupied.some(t => GROCER.test(String(t.name ?? "")));
    const hasAnchor = owned.some(t => t.isAnchor === true);
    const hasBigBox = owned.some(t => (num(t.sf) ?? 0) >= 25000);
    if (!hasGrocer && !hasAnchor && !hasBigBox) {
      out.push({
        id: "audit-anchor-missing", source: "check", severity: "medium", field: "Grocery anchor",
        question: `This is a grocery-anchored center, but no grocery anchor appears in the roster — no tenant is flagged as an anchor, none matches a known grocer, and there's no anchor-sized box (≥25,000 SF). Did the anchor drop out of the rent roll?`,
        detail: `A grocery-anchored center's defining tenant is the grocer. If it's missing, the anchor row likely didn't extract (a large box printed as an image) — add it from the rent roll / site plan, or correct the center type.`,
        suggestedValue: null, target: null,
      });
    }
  }

  // ── T. WALT recomputed from roster expiries vs the stated WALT ─────────────────
  // SF-weighted remaining term as of the roll/OM date. Generous thresholds + low
  // severity: a by-rent WALT or options counted into the stated figure can differ.
  const statedWalt = num(deal.walt);
  if (statedWalt != null && statedWalt > 0 && occupied.length >= 5) {
    const refRaw = (typeof deal.tenantsAsOf === "string" && deal.tenantsAsOf) || (typeof deal.omDate === "string" && deal.omDate) || null;
    const refMs = parseISO(refRaw) ?? Date.now();
    const withExp = occupied.filter(t => parseISO(t.leaseExpiry) != null && (num(t.sf) ?? 0) > 0);
    const expSF = sumSF(withExp);
    if (withExp.length >= Math.ceil(occupied.length * 0.7) && expSF > 0) {
      const yrMs = 365.25 * 24 * 3600 * 1000;
      const wsum = withExp.reduce((s, t) => s + (num(t.sf) ?? 0) * Math.max(0, (parseISO(t.leaseExpiry)! - refMs) / yrMs), 0);
      const computedWalt = wsum / expSF;
      if (computedWalt > 0 && Math.abs(computedWalt - statedWalt) > 1.5 && Math.abs(computedWalt - statedWalt) / statedWalt > 0.25) {
        out.push({
          id: "audit-walt-recompute", source: "check", severity: "low", field: "WALT",
          question: `Stated WALT is ${statedWalt.toFixed(1)} yrs, but the roster's lease expiries (SF-weighted) roll up to ${computedWalt.toFixed(1)} yrs. Reconcile.`,
          detail: `WALT recomputed from each occupied tenant's lease expiry, SF-weighted, as of ${refRaw || "the roll date"}. A gap may mean a wrong expiry, renewal options folded into the stated WALT, or a different basis (by rent vs by SF).`,
          suggestedValue: computedWalt.toFixed(1), target: { kind: "deal", fieldKey: "walt", valueType: "number" },
        });
      }
    }
  }

  // ── U. Same tenant NAME on more than one occupied row (possible duplicate row) ─
  const byName = new Map<string, number>();
  for (const t of occupied) {
    const nm = String(t.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (nm) byName.set(nm, (byName.get(nm) ?? 0) + 1);
  }
  let dupNameFlags = 0;
  for (const [nm, count] of byName) {
    if (dupNameFlags >= 3) break;
    if (count < 2) continue;
    dupNameFlags++;
    const disp = nm.replace(/\b\w/g, c => c.toUpperCase());
    out.push({
      id: `audit-dupe-tenant-${nm}`.slice(0, 80), source: "check", severity: "low", field: `${disp} — appears ${count}×`,
      question: `"${disp}" appears ${count} times in the roster. Confirm these are separate suites/locations, not a duplicated row.`,
      detail: `The same tenant on multiple occupied rows is sometimes legit (a tenant with two suites), but is often a duplicated line that double-counts its SF and rent.`,
      suggestedValue: null, target: null,
    });
  }

  return out;
}
