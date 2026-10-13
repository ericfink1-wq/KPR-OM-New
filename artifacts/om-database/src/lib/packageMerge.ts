// Broker packages arrive as several files that each carry ONE part of the deal
// best. Newmark, for example, ships an OM (property story, demographics, rounded
// headline numbers), a Detailed Tenant Underwriting (the full roster with options
// and recoveries) and a Financial Narrative (the exact Argus cash flow and
// operating history). Whichever finishes extracting first used to become the base
// deal and the rest could only fill blanks — so the order files happened to finish
// in decided which roster and which NOI survived.
//
// This module makes the merge order-independent: each file is given a ROLE, each
// deal field belongs to a GROUP, and for every group the most authoritative role
// wins regardless of arrival order. Lower-authority disagreements are settled
// quietly (they are the same package, not a new vintage), so the person dropping
// the files never has to adjudicate "$1.4M vs $1,429,647".

import type { Deal } from "./idb";

export type PackageRole = "om" | "tenant-detail" | "financials" | "other";
export type FieldGroup = "property" | "roster" | "financials";

export interface PackageSources {
  property?: PackageRole | null;
  roster?: PackageRole | null;
  financials?: PackageRole | null;
  /** When the first file of the package landed — bounds the package window. */
  startedAt?: string | null;
}

/** Files of one package arriving further apart than this are treated as a NEW
 *  vintage (e.g. next year's OM) and get the conservative keep-and-flag merge. */
export const PACKAGE_WINDOW_DAYS = 30;

// Higher = more authoritative for that group.
const RANK: Record<FieldGroup, Record<PackageRole, number>> = {
  property:   { om: 3, financials: 2, "tenant-detail": 1, other: 0 },
  roster:     { "tenant-detail": 3, om: 2, financials: 1, other: 0 },
  financials: { financials: 3, om: 2, "tenant-detail": 1, other: 0 },
};

const ROSTER_FIELDS = new Set([
  "tenants", "tenantsAsOf", "tenantsSource", "occupancy", "walt", "weightedAvgRentPSF",
]);
const FINANCIAL_FIELDS = new Set([
  "noi", "grossPotentialRent", "effectiveGrossIncome", "operatingExpenses", "nnnRecoveries",
  "expenseRatio", "cashFlowProjection", "incomeBreakdown", "expenseBreakdown", "otherIncome",
  "underwritingAssumptions", "keyAssumptions",
]);

export function groupOf(field: string): FieldGroup {
  if (ROSTER_FIELDS.has(field)) return "roster";
  if (FINANCIAL_FIELDS.has(field)) return "financials";
  return "property";
}

/** What job does this file do in its package? File name first (brokers label them
 *  reliably), then the opening text. Anything unrecognised is treated as an OM —
 *  it came down the OM path, and an equal-rank OM keeps today's merge behaviour. */
export function detectPackageRole(fileName: string, text = ""): PackageRole {
  const f = (fileName || "").toLowerCase().replace(/[_]+/g, " ");
  if (/tenant\s+underwriting|rent\s*roll|lease\s+schedule|tenant\s+schedule|\bdtu\b/.test(f)) return "tenant-detail";
  if (/financial\s+narrative|cash\s*flow|\bargus\b|\bfinancials\b|operating\s+statement|historicals?\b|\bt-?12\b|pro\s*-?\s*forma/.test(f)) return "financials";
  if (/offering\s+memo|\bom\b/.test(f)) return "om";
  if (/additional\s+info|supplement|addendum/.test(f)) return "other";
  const head = (text || "").slice(0, 3000).toLowerCase();
  if (/detailed\s+tenant\s+underwriting/.test(head)) return "tenant-detail";
  if (/financial\s+narrative|fiscal\s+year\s+analysis/.test(head)) return "financials";
  return "om";
}

/** Sources stamp for a deal created from a single file of a package. */
export function initialPackageSources(role: PackageRole, now = new Date()): PackageSources {
  return { property: role, roster: role, financials: role, startedAt: now.toISOString() };
}

export interface PackagePlan {
  /** Groups where the incoming file outranks what the deal holds — its values win. */
  overwrite: Set<FieldGroup>;
  /** Groups where the deal already holds a better source — keep it, no conflict flag. */
  quiet: Set<FieldGroup>;
  /** Updated provenance to store on the merged deal. */
  next: PackageSources;
}

/** Decide, group by group, how an incoming package file merges into an existing
 *  deal. Returns null when the deal is NOT part of a live package (legacy deals,
 *  or files arriving outside the window) — callers then use the conservative merge. */
export function planPackageMerge(
  existing: Deal & { packageSources?: PackageSources | null },
  incoming: PackageRole,
  incomingHasRoster: boolean,
  now = new Date(),
): PackagePlan | null {
  const src = existing.packageSources;
  if (!src || !src.startedAt) return null;
  const started = Date.parse(src.startedAt);
  if (!Number.isFinite(started) || now.getTime() - started > PACKAGE_WINDOW_DAYS * 86_400_000) return null;

  const overwrite = new Set<FieldGroup>();
  const quiet = new Set<FieldGroup>();
  const next: PackageSources = { ...src };
  for (const g of ["property", "roster", "financials"] as FieldGroup[]) {
    const have = src[g];
    const haveRank = have ? RANK[g][have] : -1;
    const inRank = RANK[g][incoming];
    if (inRank > haveRank) {
      // A hand-pasted or rent-roll roster is curated data — never replace it.
      if (g === "roster" && (existing.tenantsManual || existing.tenantsSource === "rent-roll" || !incomingHasRoster)) {
        quiet.add(g);
        continue;
      }
      overwrite.add(g);
      next[g] = incoming;
    } else if (inRank < haveRank) {
      quiet.add(g);
    }
    // equal rank → neither: the conservative keep-and-flag behaviour applies
  }
  return { overwrite, quiet, next };
}
