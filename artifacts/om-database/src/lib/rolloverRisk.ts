// Live, token-free red flag for near-term lease ROLLOVER / short WALT — a wall of
// expirations or a short weighted-average lease term is one of the largest retail
// risks (renewal/re-leasing exposure, downtime, TI/LC). Computed from the roster's
// own expiry dates + base rent (NAP/vacant excluded); no model call.
import type { Deal } from "./idb";
import type { DerivedFlag } from "./expenseRisk";
import { parseLeaseDate, isVacant, isNAPTenant } from "./utils";

const num = (v: unknown): number | null => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
const NEAR_PCT = 25;   // >= this % of rent expiring within 24 months = flag
const HIGH_PCT = 40;   // >= this = high severity
const SHORT_WALT = 3;  // WALT (yrs) below this = flag
const VSHORT_WALT = 2; // below this = high severity

export function deriveRolloverFlag(deal: Deal): DerivedFlag | null {
  const tenants = (deal.tenants || []).filter(t => !isVacant(t.name) && !isNAPTenant(t));
  if (tenants.length === 0) return null;
  const totalRent = tenants.reduce((s, t) => s + (num(t.annualRent) || 0), 0);
  const horizon = Date.now() + Math.round(24 * 30.4375 * 86_400_000); // ~24 months

  let nearRent = 0;
  for (const t of tenants) {
    const rent = num(t.annualRent) || 0;
    const exp = parseLeaseDate(t.leaseExpiry);
    if (exp && exp.getTime() <= horizon) nearRent += rent;
  }
  const nearPct = totalRent > 0 ? (nearRent / totalRent) * 100 : null;
  const walt = num(deal.walt);

  const heavyRollover = nearPct != null && nearPct >= NEAR_PCT;
  const shortWalt = walt != null && walt > 0 && walt < SHORT_WALT;
  if (!heavyRollover && !shortWalt) return null;

  const severity: DerivedFlag["severity"] =
    (nearPct != null && nearPct >= HIGH_PCT) || (walt != null && walt > 0 && walt < VSHORT_WALT) ? "high" : "medium";
  const parts: string[] = [];
  if (heavyRollover) parts.push(`~${Math.round(nearPct!)}% of base rent expires within ~24 months`);
  if (shortWalt) parts.push(`WALT is short (~${walt!.toFixed(1)} yrs)`);
  return {
    severity,
    description: `Near-term lease rollover — ${parts.join("; ")}. Concentrated expirations drive renewal/re-leasing risk, downtime and TI/LC — confirm renewal probability and the mark-to-market on the rolling space.`,
  };
}
