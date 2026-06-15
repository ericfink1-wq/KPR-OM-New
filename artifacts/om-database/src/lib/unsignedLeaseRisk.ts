// Derives a live "unexecuted lease" red flag from a deal's tenant roster. An OM
// often models LOI / proposed / signed-not-open tenants as if they were in place,
// which overstates NOI until the leases are signed and the stores open. This reads
// only the leaseStatus + annualRent fields already on each tenant — no
// re-extraction needed — and flags how much in-place base rent depends on them.

import type { Deal, Tenant } from "./idb";
import { isVacant, isNAPTenant } from "./utils";

export interface DerivedFlag {
  severity: "high" | "medium" | "low";
  description: string;
}

const num = (v: unknown): number | null =>
  v == null || v === "" || isNaN(Number(v)) ? null : Number(v);

// Tenants whose lease is NOT yet binding income (LOI / proposed) vs. signed but
// not-yet-open (executed, but rent hasn't started). Both are watch items, but an
// unexecuted lease is the sharper risk because it can still fall through.
function statusOf(t: Tenant): "loi" | "signed-not-open" | null {
  if (isVacant(t.name) || isNAPTenant(t)) return null;
  if (t.leaseStatus === "loi" || t.leaseStatus === "proposed") return "loi";
  if (t.leaseStatus === "signed-not-open") return "signed-not-open";
  return null;
}

export function deriveUnsignedLeaseFlag(deal: Deal): DerivedFlag | null {
  const tenants = deal.tenants;
  if (!tenants || tenants.length === 0) return null;

  const unexecuted: Tenant[] = [];
  const notOpen: Tenant[] = [];
  let unexecutedRent = 0;
  let notOpenRent = 0;
  for (const t of tenants) {
    const s = statusOf(t);
    if (s === "loi") { unexecuted.push(t); unexecutedRent += num(t.annualRent) ?? 0; }
    else if (s === "signed-not-open") { notOpen.push(t); notOpenRent += num(t.annualRent) ?? 0; }
  }
  if (unexecuted.length === 0 && notOpen.length === 0) return null;

  // Denominator: stated gross potential rent if we have it, else the summed roster
  // base rent. Used only to size the exposure (pct), so a rough basis is fine.
  const rosterRent = tenants.reduce((s, t) => s + (num(t.annualRent) ?? 0), 0);
  const basis = num(deal.grossPotentialRent) ?? (rosterRent > 0 ? rosterRent : null);
  const fmt$ = (v: number) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${Math.round(v).toLocaleString()}`;
  const names = (list: Tenant[]) => list.map((t) => t.name).filter(Boolean).slice(0, 6).join(", ");

  if (unexecuted.length > 0) {
    const pct = basis && basis > 0 ? (unexecutedRent / basis) * 100 : null;
    const severity: DerivedFlag["severity"] =
      pct != null ? (pct >= 10 ? "high" : pct >= 3 ? "medium" : "low") : (unexecuted.length >= 2 ? "high" : "medium");
    const share = pct != null ? `~${pct.toFixed(0)}% of base rent (${fmt$(unexecutedRent)})` : `${fmt$(unexecutedRent)} of base rent`;
    let desc =
      `Unexecuted leases in the underwriting: ${unexecuted.length} tenant${unexecuted.length > 1 ? "s" : ""} ` +
      `(${names(unexecuted)}) ${unexecuted.length > 1 ? "are" : "is"} only at LOI / proposed stage but modeled in place — ` +
      `${share} is not yet contractually committed. Confirm execution; in-place NOI is overstated until these are signed.`;
    if (notOpen.length > 0) {
      desc += ` Separately, ${notOpen.length} signed-but-not-open tenant${notOpen.length > 1 ? "s" : ""} ` +
        `(${names(notOpen)}, ${fmt$(notOpenRent)}) have leases executed but rent not yet commenced.`;
    }
    return { severity, description: desc };
  }

  // Only signed-not-open tenants — a lighter watch item (lease is binding; the risk
  // is timing / opening, not execution).
  const pct = basis && basis > 0 ? (notOpenRent / basis) * 100 : null;
  const severity: DerivedFlag["severity"] = pct != null && pct >= 8 ? "medium" : "low";
  const share = pct != null ? `~${pct.toFixed(0)}% of base rent (${fmt$(notOpenRent)})` : `${fmt$(notOpenRent)} of base rent`;
  return {
    severity,
    description:
      `Signed-but-not-open tenants: ${notOpen.length} tenant${notOpen.length > 1 ? "s" : ""} (${names(notOpen)}) ` +
      `have executed leases but have not opened / rent has not commenced — ${share}. Confirm rent-commencement dates and any seller credit for downtime.`,
  };
}
