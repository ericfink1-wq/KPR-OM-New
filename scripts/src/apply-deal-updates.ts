/**
 * apply-deal-updates.ts
 *
 * Reads a JSON file mapping dealId → update object and applies those updates
 * to each deal's stored data.  Supported fields per deal:
 *   tenants, tenantsAsOf, tenantsSource, occupancy, walt,
 *   weightedAvgRentPSF, dealScore, notes, redFlags, analysisStale
 *
 * Only fields present in the file are touched; everything else is left intact.
 *
 * Special rules
 * ─────────────
 * 1. Tenants — when a new tenant list is supplied, the script matches each new
 *    tenant to the existing roster by canonicalName (or name, normalised) and
 *    carries forward creditRating, salesPSF, and salesNotes from the matched
 *    row so OM-derived credit and sales data is never lost.
 *
 * 2. redFlags — existing flags whose description mentions any of the keywords
 *    roof / environmental / debt / loan / tax / construction are preserved and
 *    appended after the file's flags (de-duplicated by description).  All other
 *    existing flags are discarded and replaced by the file's list.
 *
 * A full database backup is written before any changes are made.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run apply-deal-updates -- --file /path/to/updates.json
 */

import { db, dealsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TenantIn {
  name?: string | null;
  canonicalName?: string | null;
  [key: string]: unknown;
}

interface RedFlagIn {
  severity?: string;
  description?: string;
}

interface UpdateEntry {
  tenants?: TenantIn[];
  tenantsAsOf?: string | null;
  tenantsSource?: string | null;
  occupancy?: number | null;
  walt?: number | null;
  weightedAvgRentPSF?: number | null;
  dealScore?: unknown;
  notes?: string | null;
  redFlags?: RedFlagIn[];
  analysisStale?: boolean;
}

type UpdateMap = Record<string, UpdateEntry>;

// ── Constants ─────────────────────────────────────────────────────────────────

const PRESERVED_FLAG_KEYWORDS = [
  "roof",
  "environmental",
  "debt",
  "loan",
  "tax",
  "construction",
];

const SIMPLE_FIELDS = [
  "tenantsAsOf",
  "tenantsSource",
  "occupancy",
  "walt",
  "weightedAvgRentPSF",
  "dealScore",
  "notes",
  "analysisStale",
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function tenantKey(t: TenantIn): string {
  return normalize(t.canonicalName) || normalize(t.name);
}

function isPreservedFlag(flag: RedFlagIn): boolean {
  const desc = (flag.description ?? "").toLowerCase();
  return PRESERVED_FLAG_KEYWORDS.some((kw) => desc.includes(kw));
}

/**
 * Merge tenant lists: take all new tenants, carrying forward creditRating,
 * salesPSF, and salesNotes from the existing tenant with a matching key when
 * the new tenant row doesn't already supply those values.
 */
function mergeTenantsWithCarryForward(
  newTenants: TenantIn[],
  existingTenants: TenantIn[],
): { merged: TenantIn[]; carries: string[] } {
  const existingByKey = new Map<string, TenantIn>();
  for (const t of existingTenants) {
    const k = tenantKey(t);
    if (k) existingByKey.set(k, t);
  }

  const carries: string[] = [];

  const merged = newTenants.map((nt) => {
    const key = tenantKey(nt);
    const existing = key ? existingByKey.get(key) : undefined;
    if (!existing) return nt;

    const carryFields = ["creditRating", "salesPSF", "salesNotes"] as const;
    const carry: Partial<Record<(typeof carryFields)[number], unknown>> = {};
    let anyCarried = false;

    for (const field of carryFields) {
      const existingVal = (existing as Record<string, unknown>)[field];
      const newVal = (nt as Record<string, unknown>)[field];
      if (existingVal != null && existingVal !== "" && (newVal == null || newVal === "")) {
        carry[field] = existingVal;
        anyCarried = true;
      }
    }

    if (anyCarried) {
      const label = nt.name ?? nt.canonicalName ?? key;
      carries.push(`${label} (${Object.keys(carry).join(", ")})`);
    }

    return { ...nt, ...carry };
  });

  return { merged, carries };
}

/**
 * Merge red-flag lists:
 *  - Start with all new flags from the file.
 *  - Append any existing flag that (a) mentions a preserved keyword and
 *    (b) doesn't already appear verbatim in the new list (de-dup by normalised
 *    description).
 */
function mergeRedFlags(
  newFlags: RedFlagIn[],
  existingFlags: RedFlagIn[],
): { merged: RedFlagIn[]; preserved: RedFlagIn[] } {
  const newKeys = new Set(newFlags.map((f) => normalize(f.description)));

  const preserved = existingFlags.filter(
    (f) => isPreservedFlag(f) && !newKeys.has(normalize(f.description)),
  );

  return { merged: [...newFlags, ...preserved], preserved };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const fileArgIdx = process.argv.indexOf("--file");
  if (fileArgIdx === -1 || !process.argv[fileArgIdx + 1]) {
    console.error(
      "Usage: pnpm --filter @workspace/scripts run apply-deal-updates -- --file <path>",
    );
    process.exit(1);
  }
  const filePath = resolve(process.argv[fileArgIdx + 1]!);
  console.log(`Reading updates from: ${filePath}\n`);

  let updates: UpdateMap;
  try {
    updates = JSON.parse(readFileSync(filePath, "utf8")) as UpdateMap;
  } catch {
    console.error(`Could not read or parse file at ${filePath}`);
    process.exit(1);
  }

  const inputIds = Object.keys(updates);
  if (inputIds.length === 0) {
    console.log("Input file is empty — nothing to do.");
    process.exit(0);
  }
  console.log(`Input contains ${inputIds.length} deal ID(s).\n`);

  // ── Load all deals ─────────────────────────────────────────────────────────
  const dealRows = await db.select().from(dealsTable);
  console.log(`Loaded ${dealRows.length} deal(s) from database.\n`);

  // ── Backup ─────────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = join(process.cwd(), `deal-updates-backup-${stamp}.json`);
  writeFileSync(
    backupPath,
    JSON.stringify(
      {
        app: "KPR Deal Intelligence",
        backupType: "pre-apply-deal-updates",
        createdAt: new Date().toISOString(),
        dealCount: dealRows.length,
        deals: dealRows.map((r) => ({ id: r.id, data: r.data })),
      },
      null,
      2,
    ),
  );
  console.log(`✓ Backup written to: ${backupPath}\n`);

  // ── Apply patches ──────────────────────────────────────────────────────────
  const dealById = new Map(dealRows.map((r) => [r.id, r]));
  let updated = 0;
  let skipped = 0;

  for (const dealId of inputIds) {
    const entry = updates[dealId]!;
    const row = dealById.get(dealId);

    if (!row) {
      console.warn(`  ⚠  Deal ${dealId} not found in DB — skipping`);
      skipped++;
      continue;
    }

    const data = row.data as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const changes: string[] = [];

    // ── Simple scalar / object fields ────────────────────────────────────────
    for (const field of SIMPLE_FIELDS) {
      if (field in entry) {
        patch[field] = entry[field] ?? null;
        changes.push(field);
      }
    }

    // ── Tenants with credit/sales carry-forward ───────────────────────────
    if ("tenants" in entry && Array.isArray(entry.tenants)) {
      const existingTenants = (data.tenants as TenantIn[] | undefined) ?? [];
      const { merged, carries } = mergeTenantsWithCarryForward(
        entry.tenants,
        existingTenants,
      );
      patch.tenants = merged;
      const carryNote =
        carries.length > 0 ? `; carried: ${carries.join(", ")}` : "";
      changes.push(`tenants — ${merged.length} rows${carryNote}`);
    }

    // ── Red flags with keyword-based preservation ─────────────────────────
    if ("redFlags" in entry && Array.isArray(entry.redFlags)) {
      const existingFlags = (data.redFlags as RedFlagIn[] | undefined) ?? [];
      const { merged, preserved } = mergeRedFlags(entry.redFlags, existingFlags);
      patch.redFlags = merged;
      const preserveNote =
        preserved.length > 0
          ? `; kept ${preserved.length} existing: ${preserved
              .map((f) => `"${(f.description ?? "").slice(0, 60)}"`)
              .join(", ")}`
          : "";
      changes.push(`redFlags — ${merged.length} total${preserveNote}`);
    }

    if (Object.keys(patch).length === 0) {
      console.warn(`  ⚠  Entry for ${dealId} has no recognised fields — skipping`);
      skipped++;
      continue;
    }

    await db
      .update(dealsTable)
      .set({ data: { ...data, ...patch }, updatedAt: new Date() })
      .where(eq(dealsTable.id, dealId));

    const name =
      (data.propertyName as string | undefined) ||
      (data.fileName as string | undefined) ||
      dealId;
    console.log(`  ✓  ${name} (${dealId})`);
    for (const c of changes) console.log(`       · ${c}`);
    updated++;
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Updated : ${updated} deal(s)`);
  if (skipped > 0) console.log(`Skipped : ${skipped} (not found or no recognised fields)`);
  console.log(`Backup  : ${backupPath}`);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
