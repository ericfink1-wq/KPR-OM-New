// Totals / weighted-average row for the tenant roster.
//
// Computed over the rows currently SHOWN (so filtering to "Anchors" totals just the
// anchors). Conventions, matching how the rest of the site reads a rent roll:
//  - NAP parcels are excluded entirely (not part of the owned GLA).
//  - Vacant suites count toward total SF but not occupied SF, rent or averages.
//  - Rent is BASE rent only (annualRent never includes recoveries).
//  - Weighted rent/SF = Σ base rent ÷ Σ SF over tenants that have BOTH a rent and an
//    SF — a 0-SF ATM's rent, or a tenant with no rent captured, would otherwise
//    distort the average. The total base rent still includes every tenant's rent.
//  - WALT and sales/SF are weighted by SF; sales only over tenants that reported.

import type { Tenant } from "./idb";
import { isNAPTenant, isVacant } from "./utils";

export interface RosterTotals {
  tenantCount: number;
  vacantCount: number;
  totalSF: number;
  occupiedSF: number;
  /** occupied ÷ total SF, %; null when there is no SF. */
  pctLeased: number | null;
  annualRent: number;
  /** SF-weighted base rent per SF; null when no tenant has both rent and SF. */
  rentPSF: number | null;
  /** SF-weighted remaining lease term in years; null when no expiries. */
  walt: number | null;
  /** SF-weighted sales per SF over reporting tenants, with how many reported. */
  salesPSF: number | null;
  salesReporting: number;
}

const num = (v: unknown): number | null => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));

function yearsRemaining(t: Tenant, now: number): number | null {
  const stated = num(t.remainingTermYears);
  if (stated != null) return Math.max(0, stated);
  const exp = t.leaseExpiry ? Date.parse(t.leaseExpiry) : NaN;
  if (isNaN(exp)) return null;
  return Math.max(0, (exp - now) / (365.25 * 86_400_000));
}

export function rosterTotals(
  rows: Tenant[],
  salesPSFOf: (t: Tenant) => number | null = t => num(t.salesPSF),
  now: number = Date.now(),
): RosterTotals {
  const leasable = rows.filter(t => !isNAPTenant(t));
  const occupied = leasable.filter(t => !isVacant(t.name));
  const sf = (t: Tenant) => { const v = num(t.sf); return v != null && v > 0 ? v : 0; };

  const totalSF = leasable.reduce((s, t) => s + sf(t), 0);
  const occupiedSF = occupied.reduce((s, t) => s + sf(t), 0);
  const annualRent = occupied.reduce((s, t) => s + (num(t.annualRent) ?? 0), 0);

  let rentNum = 0, rentDen = 0, waltNum = 0, waltDen = 0, salesNum = 0, salesDen = 0, salesReporting = 0;
  for (const t of occupied) {
    const s = sf(t);
    const rent = num(t.annualRent);
    if (s > 0 && rent != null && rent > 0) { rentNum += rent; rentDen += s; }
    const yrs = yearsRemaining(t, now);
    if (s > 0 && yrs != null) { waltNum += yrs * s; waltDen += s; }
    const sales = salesPSFOf(t);
    if (s > 0 && sales != null && sales > 0) { salesNum += sales * s; salesDen += s; salesReporting++; }
  }

  return {
    tenantCount: occupied.length,
    vacantCount: leasable.length - occupied.length,
    totalSF,
    occupiedSF,
    pctLeased: totalSF > 0 ? (occupiedSF / totalSF) * 100 : null,
    annualRent,
    rentPSF: rentDen > 0 ? rentNum / rentDen : null,
    walt: waltDen > 0 ? waltNum / waltDen : null,
    salesPSF: salesDen > 0 ? salesNum / salesDen : null,
    salesReporting,
  };
}
