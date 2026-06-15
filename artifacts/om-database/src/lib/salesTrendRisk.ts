// Derives a live "declining sales" red flag from a deal's tenant roster. When an
// OM prints two years of tenant sales, a year-over-year DROP is a leading
// indicator that a tenant is in trouble (renewal risk, co-tenancy/kickout exposure,
// future vacancy). Reads only priorSalesPSF/salesPSF already on each tenant — no
// re-extraction — and flags the material decliners.

import type { Deal, Tenant } from "./idb";
import { isVacant, isNAPTenant } from "./utils";

export interface DerivedFlag {
  severity: "high" | "medium" | "low";
  description: string;
}

const num = (v: unknown): number | null =>
  v == null || v === "" || isNaN(Number(v)) ? null : Number(v);

// A material decline: at least this % drop year-over-year. Small wiggle (< ~3%)
// is noise; we only flag a real downtrend.
const MIN_DROP_PCT = 5;

interface Decliner {
  name: string;
  dropPct: number;
  prior: number;
  latest: number;
  anchor: boolean;
}

export function deriveSalesTrendFlag(deal: Deal): DerivedFlag | null {
  const tenants = deal.tenants;
  if (!tenants || tenants.length === 0) return null;

  const decliners: Decliner[] = [];
  for (const t of tenants as Tenant[]) {
    if (isVacant(t.name) || isNAPTenant(t)) continue;
    const latest = num(t.salesPSF);
    const prior = num(t.priorSalesPSF);
    if (latest == null || prior == null || prior <= 0) continue;
    const dropPct = ((prior - latest) / prior) * 100;
    if (dropPct >= MIN_DROP_PCT) {
      decliners.push({ name: t.name || "Tenant", dropPct, prior, latest, anchor: !!t.isAnchor });
    }
  }
  if (decliners.length === 0) return null;

  decliners.sort((a, b) => b.dropPct - a.dropPct);
  const anyAnchor = decliners.some((d) => d.anchor);
  const worst = decliners[0];
  // Anchor decline, or a steep (>15%) drop on any tenant, is the sharper signal.
  const severity: DerivedFlag["severity"] =
    anyAnchor || worst.dropPct >= 15 ? "high" : worst.dropPct >= 10 ? "medium" : "low";

  const list = decliners
    .slice(0, 6)
    .map((d) => `${d.name} ${d.dropPct >= 0 ? "−" : "+"}${Math.abs(Math.round(d.dropPct))}%${d.anchor ? " (anchor)" : ""}`)
    .join(", ");
  const more = decliners.length > 6 ? ` +${decliners.length - 6} more` : "";

  return {
    severity,
    description:
      `Declining tenant sales: ${decliners.length} tenant${decliners.length > 1 ? "s" : ""} posted lower sales year-over-year — ${list}${more}. ` +
      `Falling sales precede renewal risk, kickout/co-tenancy exposure and vacancy; verify the trend and watch occupancy cost on these tenants.`,
  };
}
