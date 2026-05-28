// Derives a live "expense recovery risk" red flag from a deal's tenant lease
// structures. Works on all existing deals with no re-extraction — reads only
// the leaseType and reimbursementMethod fields already present on each tenant.
//
// Returns a flag object matching the stored RedFlag shape, or null if the deal
// is clean enough that no flag is warranted.

import type { Deal, Tenant } from "./idb";

export interface DerivedFlag {
  severity: "high" | "medium" | "low";
  description: string;
}

type LeaseCategory = "nnn" | "nn" | "gross" | "fixed_cam" | "capped_cam" | "unknown";

const GROSS_PATTERNS = [
  /\bfull[- ]service\b/i,
  /\bmodified\s+gross\b/i,
  /\bgross\b/i,
];

const FIXED_CAM_PATTERNS = [
  /\bfixed[- ]?cam\b/i,
  /\bfixed\s+expense\b/i,
  /\bflat[- ]?cam\b/i,
];

const CAPPED_CAM_PATTERNS = [
  /\bcapped[- ]?cam\b/i,
  /\bcam\s+cap\b/i,
  /\bcontrollable[- ]?cam\b/i,
  /\bcap(?:ped)?\s+expense\b/i,
];

const NNN_PATTERNS = [
  /\babsolute\s+nnn\b/i,
  /\btriple[- ]?net\b/i,
  /\bnnn\b/,
  /\bnet[- ]?net[- ]?net\b/i,
];

const NN_PATTERNS = [
  /\bdouble[- ]?net\b/i,
  /\bnn\b/,
  /\bnet[- ]?net\b/i,
];

function classifyTenant(t: Tenant): LeaseCategory {
  const combined = [t.leaseType, t.reimbursementMethod]
    .filter(Boolean)
    .join(" ");
  if (!combined.trim()) return "unknown";

  // Fixed-CAM and Capped-CAM before generic gross checks
  if (FIXED_CAM_PATTERNS.some((p) => p.test(combined))) return "fixed_cam";
  if (CAPPED_CAM_PATTERNS.some((p) => p.test(combined))) return "capped_cam";
  if (GROSS_PATTERNS.some((p) => p.test(combined))) return "gross";
  if (NNN_PATTERNS.some((p) => p.test(combined))) return "nnn";
  if (NN_PATTERNS.some((p) => p.test(combined))) return "nn";
  return "unknown";
}

export function deriveExpenseRiskFlag(deal: Deal): DerivedFlag | null {
  const tenants = deal.tenants;
  if (!tenants || tenants.length === 0) return null;

  // Tally SF per category. Fall back to equal weight (1) when SF is missing.
  const totals: Record<LeaseCategory, number> = {
    nnn: 0, nn: 0, gross: 0, fixed_cam: 0, capped_cam: 0, unknown: 0,
  };
  let totalSF = 0;
  let unknownCount = 0;

  for (const t of tenants) {
    const cat = classifyTenant(t);
    const sf = Number(t.sf) || 1;
    totals[cat] += sf;
    totalSF += sf;
    if (cat === "unknown") unknownCount++;
  }

  // If we have no meaningful lease structure data, skip.
  const classifiedSF = totalSF - totals.unknown;
  if (classifiedSF < totalSF * 0.25) return null;

  const exposedSF = totals.gross + totals.fixed_cam;
  const cappedSF = totals.capped_cam;
  const exposedPct = exposedSF / totalSF;
  const cappedPct = cappedSF / totalSF;

  if (exposedPct >= 0.4) {
    const grossPct = Math.round((totals.gross / totalSF) * 100);
    const fixedPct = Math.round((totals.fixed_cam / totalSF) * 100);
    const parts: string[] = [];
    if (totals.gross > 0) parts.push(`${grossPct}% gross`);
    if (totals.fixed_cam > 0) parts.push(`${fixedPct}% fixed-CAM`);
    return {
      severity: "high",
      description:
        `High expense recovery risk: ${parts.join(" + ")} of GLA leaves landlord directly exposed to operating expense inflation. Verify expense caps, re-tenanting risk, and underwrite with conservative expense growth.`,
    };
  }

  if (cappedPct >= 0.4) {
    const pct = Math.round(cappedPct * 100);
    return {
      severity: "medium",
      description:
        `Moderate expense recovery risk: ~${pct}% of GLA on capped-CAM structures. Landlord bears above-cap expense inflation. Review cap levels and historical CAM reconciliation before assuming full recovery.`,
    };
  }

  // Minor exposure — not worth flagging unless it's noteworthy
  if (exposedPct >= 0.2 || cappedPct >= 0.25) {
    const pct = Math.round((exposedPct + cappedPct) * 100);
    return {
      severity: "low",
      description:
        `Minor expense recovery risk: ~${pct}% of GLA on gross or capped-CAM leases. Generally manageable but confirm reimbursement schedules during due diligence.`,
    };
  }

  return null;
}
