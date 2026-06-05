import type { Deal, LeaseAbstract, Tenant, TenantLeaseRisk, AbstractRentStep } from "./idb";
import { tenantKey, isVacant } from "./utils";
import { pnum, currentAnnualRent } from "./abstractChecks";
import { resolveTenantRisk } from "./leaseRisk";

// Deterministic lease-risk VALIDATORS — run on every deal, surfaced as warnings.
// They never make a go/no-go call; they flag and quantify for human review.

export type LeaseRiskWarningCode =
  | "unverified_cotenancy"
  | "abstract_vs_executed_conflict"
  | "scheduled_increase_to_lower_amount"
  | "cross_source_numeric_mismatch";

export interface LeaseRiskWarning {
  code: LeaseRiskWarningCode;
  severity: "high" | "medium" | "low";
  tenant?: string | null;
  message: string;
  detail?: string | null;
}

// ── 1. unverified_cotenancy ──────────────────────────────────────────────────────
// Any co-tenancy / kickout clause whose only source is an OM/abstract summary
// (not an executed lease). The system never auto-clears these — flag for counsel.
export function checkUnverifiedCotenancy(deal: Deal, abstracts: LeaseAbstract[] = []): LeaseRiskWarning[] {
  const out: LeaseRiskWarning[] = [];
  for (const r of resolveTenantRisk(deal, abstracts)) {
    const unverifiedCo = r.coTenancy.filter((c) => c.verifiedAgainstExecutedDoc !== true);
    const unverifiedKick = r.salesKickout.filter((c) => c.verifiedAgainstExecutedDoc !== true);
    if (!unverifiedCo.length && !unverifiedKick.length) continue;
    const kinds = [unverifiedCo.length ? "co-tenancy" : null, unverifiedKick.length ? "sales kickout" : null].filter(Boolean).join(" + ");
    out.push({
      code: "unverified_cotenancy",
      severity: "high",
      tenant: r.tenant,
      message: `${r.tenant}: ${kinds} sourced only from a summary (${r.coTenancy[0]?.sourceDocument || r.salesKickout[0]?.sourceDocument || "OM"}) — not verified against the executed lease.`,
      detail: "Pull and reconcile the executed lease + amendments before relying on this clause. The system will not auto-clear an unverified co-tenancy/kickout risk.",
    });
  }
  return out;
}

// ── 2. abstract_vs_executed_conflict ───────────────────────────────────────────────
// The same field differs between the weak source (OM summary) and the executed
// lease abstract for a tenant that has BOTH.
export function checkAbstractVsExecutedConflict(deal: Deal, abstracts: LeaseAbstract[] = []): LeaseRiskWarning[] {
  const out: LeaseRiskWarning[] = [];
  const omByKey = new Map<string, TenantLeaseRisk>();
  for (const t of deal.leaseRisk?.tenants ?? []) if (t?.tenant) omByKey.set(tenantKey(t.tenant), t);

  for (const a of abstracts) {
    if (!a?.tenantName) continue;
    const om = omByKey.get(tenantKey(a.tenantName));
    if (!om) continue;
    const conflicts: string[] = [];

    const omCo = (om.coTenancy ?? []).length;
    const abCo = (a.coTenancy ?? []).length;
    if (!!omCo !== !!abCo) {
      conflicts.push(`co-tenancy ${omCo ? "disclosed in OM" : "absent in OM"} but ${abCo ? "present" : "absent"} in the executed lease`);
    }
    const omKickAmt = pnum(om.salesKickout?.[0]?.salesThresholdAmount ?? om.salesKickout?.[0]?.salesThresholdPSF);
    const abKickAmt = pnum(a.salesKickout?.[0]?.salesThresholdAmount ?? a.salesKickout?.[0]?.salesThresholdPSF);
    if (omKickAmt && abKickAmt && Math.abs(omKickAmt - abKickAmt) / abKickAmt > 0.02) {
      conflicts.push(`sales-kickout threshold — OM ${omKickAmt.toLocaleString()} vs lease ${abKickAmt.toLocaleString()}`);
    }
    if (conflicts.length) {
      out.push({
        code: "abstract_vs_executed_conflict",
        severity: "high",
        tenant: a.tenantName,
        message: `${a.tenantName}: OM summary conflicts with the executed lease — ${conflicts.join("; ")}.`,
        detail: "The executed lease controls. Confirm and correct the OM-derived value.",
      });
    }
  }
  return out;
}

// ── 3. scheduled_increase_to_lower_amount ──────────────────────────────────────────
// A rent step that follows the prior step but is LOWER — i.e. an "increase"
// schedule that actually decreases (the PetSmart $36→$26 error). Steps come from
// the roster's rentSchedule string and/or a lease abstract's rentSchedule table.
export interface RentStep { date: string | null; psf: number | null; annual: number | null; raw?: string }

export function parseRentStepsFromString(s: unknown): RentStep[] {
  if (!s || typeof s !== "string") return [];
  const out: RentStep[] = [];
  for (const chunk of s.split(/;|\n/)) {
    const dm = chunk.match(/\d{4}-\d{2}-\d{2}/);
    const pm = chunk.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:psf|\/\s*sf|per\s*sf)/i);
    const am = chunk.match(/\$\s*([\d,]+(?:\.\d+)?)\s*\/?\s*(?:yr|year|annually|\/yr)/i);
    const psf = pm ? Number(pm[1].replace(/,/g, "")) : null;
    const annual = am ? Number(am[1].replace(/,/g, "")) : null;
    if (dm || psf != null || annual != null) out.push({ date: dm ? dm[0] : null, psf, annual, raw: chunk.trim() });
  }
  return out;
}

export function stepsFromAbstract(rs: AbstractRentStep[] | null | undefined): RentStep[] {
  return (rs ?? []).map((r) => ({
    date: r.periodStart ? String(r.periodStart).slice(0, 10) : null,
    psf: pnum(r.amountPerSF ?? r.psf),
    annual: pnum(r.annualRent),
    raw: r.note ?? undefined,
  }));
}

/** Flag any step whose rent is below the immediately preceding step's (a labeled
 *  increase that decreases). Compares $/SF, falling back to annual. */
export function findDecreasingSteps(steps: RentStep[]): { from: RentStep; to: RentStep }[] {
  const ordered = steps
    .filter((s) => s.psf != null || s.annual != null)
    .slice()
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const hits: { from: RentStep; to: RentStep }[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1], cur = ordered[i];
    const a = prev.psf ?? prev.annual, b = cur.psf ?? cur.annual;
    if (a != null && b != null && b < a * 0.995) hits.push({ from: prev, to: cur });
  }
  return hits;
}

export function checkScheduledIncreaseToLowerAmount(deal: Deal, abstracts: LeaseAbstract[] = []): LeaseRiskWarning[] {
  const out: LeaseRiskWarning[] = [];
  const emit = (tenant: string, hit: { from: RentStep; to: RentStep }) => {
    const f = hit.from.psf ?? hit.from.annual!, t = hit.to.psf ?? hit.to.annual!;
    const unit = hit.to.psf != null ? "/SF" : "/yr";
    out.push({
      code: "scheduled_increase_to_lower_amount",
      severity: "medium",
      tenant,
      message: `${tenant}: rent step labeled an increase goes DOWN — $${f}${unit} → $${t}${unit}${hit.to.date ? ` at ${hit.to.date}` : ""}.`,
      detail: "A scheduled increase whose value is below the current rent is almost always a transcription error (e.g. $36 read as $26). Verify against the lease.",
    });
  };
  for (const t of deal.tenants || []) {
    if (!t.name || isVacant(t.name)) continue;
    for (const hit of findDecreasingSteps(parseRentStepsFromString(t.rentSchedule))) emit(t.canonicalName || t.name, hit);
  }
  for (const a of abstracts) {
    if (!a?.tenantName) continue;
    for (const hit of findDecreasingSteps(stepsFromAbstract(a.rentSchedule))) emit(a.tenantName, hit);
  }
  return out;
}

// ── 4. cross_source_numeric_mismatch ────────────────────────────────────────────────
// Same tenant's rent / SF differs across sources (rent roll vs lease abstract,
// and SF vs uploaded sales history) beyond tolerance.
const SF_TOL = 0.015, RENT_TOL = 0.02;

export function checkCrossSourceNumericMismatch(deal: Deal, abstracts: LeaseAbstract[] = []): LeaseRiskWarning[] {
  const out: LeaseRiskWarning[] = [];
  const rosterByKey = new Map<string, Tenant>();
  for (const t of deal.tenants || []) if (t.name && !isVacant(t.name)) rosterByKey.set(tenantKey(t.canonicalName || t.name), t);

  for (const a of abstracts) {
    if (!a?.tenantName) continue;
    const t = rosterByKey.get(tenantKey(a.tenantName));
    if (!t) continue;
    const aSF = pnum(a.premisesGLA ?? a.currentSF), rSF = pnum(t.sf);
    if (aSF && rSF && Math.abs(aSF - rSF) / rSF > SF_TOL) {
      out.push({ code: "cross_source_numeric_mismatch", severity: "medium", tenant: a.tenantName,
        message: `${a.tenantName}: SF differs — rent roll ${rSF.toLocaleString()} vs lease ${aSF.toLocaleString()}.`,
        detail: "Reconcile the rent roll against the lease (and site plan) before underwriting." });
    }
    const aRent = currentAnnualRent(a), rRent = pnum(t.annualRent);
    if (aRent && rRent && Math.abs(aRent - rRent) / rRent > RENT_TOL) {
      out.push({ code: "cross_source_numeric_mismatch", severity: "medium", tenant: a.tenantName,
        message: `${a.tenantName}: current annual rent differs — rent roll $${Math.round(rRent).toLocaleString()} vs lease $${Math.round(aRent).toLocaleString()}.`,
        detail: "The executed lease controls; verify the rent roll." });
    }
  }
  return out;
}

/** Run all four validators. */
export function runLeaseRiskValidators(deal: Deal, abstracts: LeaseAbstract[] = []): LeaseRiskWarning[] {
  return [
    ...checkUnverifiedCotenancy(deal, abstracts),
    ...checkAbstractVsExecutedConflict(deal, abstracts),
    ...checkScheduledIncreaseToLowerAmount(deal, abstracts),
    ...checkCrossSourceNumericMismatch(deal, abstracts),
  ];
}
