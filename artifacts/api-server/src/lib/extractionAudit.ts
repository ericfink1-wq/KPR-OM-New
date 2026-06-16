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

interface TenantLike { name?: unknown; sf?: unknown; suite?: unknown; rentPerSF?: unknown; annualRent?: unknown; isNAP?: unknown; isAnchor?: unknown }

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
    if (gap > 0 && pct > 0.03 && gap > 3000) {
      out.push({
        id: "check-sf-gla-short", source: "check", severity: "high",
        field: "Tenant roster completeness",
        question: `The roster's suites sum to ${sf(rosterSF)} but the property GLA is ${sf(totalSF)} — about ${sf(gap)} (${Math.round(pct * 100)}%) is unaccounted for. Are suites missing from the roster?`,
        detail: `Occupied ${sf(occupiedSF)} + vacant ${sf(vacantSF)} = ${sf(rosterSF)}, which is short of the ${sf(totalSF)} GLA. A dropped tenant, an un-captured vacancy, or merged vacant suites would cause this — check against the rent roll / stacking plan.`,
        suggestedValue: null, target: null,
      });
    } else if (gap < 0 && pct > 0.03 && -gap > 3000) {
      out.push({
        id: "check-sf-gla-over", source: "check", severity: "medium",
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
        id: "check-occupancy-tieout", source: "check", severity: "medium",
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
        id: "check-noi-cap-price", source: "check", severity: "high",
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
    if (Math.abs(computed - statedPSF) / statedPSF > 0.12) {
      out.push({
        id: "check-avg-rent-psf", source: "check", severity: "medium",
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
      const pct = Math.abs(psf * tsf - ann) / ann;
      if (pct > 0.10) mism.push({ t, pct, psf, tsf, ann });
    }
  }
  mism.sort((a, b) => b.pct - a.pct);
  for (const m of mism.slice(0, 2)) {
    const nm = String(m.t.name ?? "tenant");
    out.push({
      id: `check-rent-tie-${nm}`.slice(0, 80), source: "check", severity: "medium",
      field: `${nm} — rent vs SF`,
      question: `${nm}: $${m.psf.toFixed(2)} PSF × ${sf(m.tsf)} = ${usd(m.psf * m.tsf)}, but the annual rent is ${usd(m.ann)} (${Math.round(m.pct * 100)}% off). One of these is wrong.`,
      detail: `Rent PSF, SF, and annual base rent must multiply out. A gap this size is usually an OCR slip or a column read from the wrong row.`,
      suggestedValue: usd(m.ann), target: { kind: "tenant", fieldKey: "annualRent", tenantName: nm, valueType: "number" },
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
        id: `check-dupe-suite-${s}`.slice(0, 80), source: "check", severity: "medium",
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
      id: "check-occupancy-fraction", source: "check", severity: "medium",
      field: "Occupancy",
      question: `Occupancy is ${occ} — that looks like a fraction. Should it be ${(occ * 100).toFixed(1)}%?`,
      detail: `Occupancy is stored as a percentage (e.g. 92.8), not a 0–1 fraction.`,
      suggestedValue: (occ * 100).toFixed(1), target: { kind: "deal", fieldKey: "occupancy", valueType: "number" },
    });
  }
  if (cap != null && (cap > 20 || (cap > 0 && cap < 1))) {
    out.push({
      id: "check-caprate-range", source: "check", severity: "medium",
      field: "Cap rate",
      question: cap > 20
        ? `Cap rate is ${cap}% — that's implausibly high. Was it entered in basis points (e.g. 650 → 6.50%)?`
        : `Cap rate is ${cap}% — that looks like a fraction. Should it be ${(cap * 100).toFixed(2)}%?`,
      detail: `Commercial cap rates are typically ~4–12%. Confirm the units.`,
      suggestedValue: cap > 20 ? (cap / 100).toFixed(2) : (cap * 100).toFixed(2),
      target: { kind: "deal", fieldKey: "capRate", valueType: "number" },
    });
  }

  return out;
}
