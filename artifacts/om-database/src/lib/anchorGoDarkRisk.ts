// Live, token-free red flag for ANCHOR go-dark / near-term anchor rollover. A dark
// anchor (closed but still paying) silently bleeds inline sales and can trip co-tenancy
// even while rent flows; an anchor expiring soon is the single biggest re-leasing /
// co-tenancy event in a center. This complements the interactive co-tenancy exposure
// panel by surfacing the binary high-signal events passively in the risk list.
import type { Deal } from "./idb";
import type { DerivedFlag } from "./expenseRisk";
import { parseLeaseDate, isVacant, isNAPTenant } from "./utils";

const MONTHS_24 = 24 * 30.4375 * 86_400_000;

export function deriveAnchorGoDarkFlag(deal: Deal): DerivedFlag | null {
  const anchors = (deal.tenants || []).filter(t => t.isAnchor && !isVacant(t.name) && !isNAPTenant(t));
  if (anchors.length === 0) return null;

  const dark = anchors.filter(t => t.isDark);
  const horizon = Date.now() + MONTHS_24;
  const expiring = anchors.filter(t => {
    if (t.isDark) return false; // already captured as dark
    const exp = parseLeaseDate(t.leaseExpiry);
    return exp != null && exp.getTime() <= horizon && exp.getTime() >= Date.now() - 86_400_000;
  });

  if (dark.length === 0 && expiring.length === 0) return null;

  const parts: string[] = [];
  if (dark.length > 0) {
    const names = dark.map(t => t.name).filter(Boolean).join(", ");
    parts.push(`${dark.length === 1 ? "Anchor" : "Anchors"} ${names} ${dark.length === 1 ? "is" : "are"} DARK (closed but still paying) — a dark anchor depresses inline traffic/sales and can trip co-tenancy/go-dark recapture even while rent continues; confirm the kickout/recapture/co-tenancy triggers and re-tenanting plan`);
  }
  if (expiring.length > 0) {
    const labels = expiring.map(t => `${t.name}${t.leaseExpiry ? ` (${t.leaseExpiry})` : ""}`).filter(Boolean).join(", ");
    parts.push(`anchor lease${expiring.length === 1 ? "" : "s"} expiring within ~24 months — ${labels} — renewal/loss drives co-tenancy and inline health; confirm renewal probability, options, and mark-to-market`);
  }

  const severity: DerivedFlag["severity"] = dark.length > 0 ? "high" : "medium";
  return { severity, description: `Anchor risk — ${parts.join("; ")}.` };
}
