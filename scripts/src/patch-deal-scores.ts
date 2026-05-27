/**
 * patch-deal-scores.ts
 *
 * Reads a JSON file mapping dealId → { dealScore, notes } and patches only
 * those two fields inside each deal's stored data, leaving every other field
 * untouched.  Writes a timestamped backup before making any changes.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run patch-deal-scores -- --file /path/to/summaries.json
 *
 * The --file argument is required.
 */

import { db } from "@workspace/db";
import { dealsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface SummaryEntry {
  dealScore?: unknown;
  notes?: unknown;
}

type SummaryMap = Record<string, SummaryEntry>;

async function main() {
  // ── Resolve input file ────────────────────────────────────────────────────
  const fileArgIdx = process.argv.indexOf("--file");
  if (fileArgIdx === -1 || !process.argv[fileArgIdx + 1]) {
    console.error("Usage: pnpm --filter @workspace/scripts run patch-deal-scores -- --file <path>");
    process.exit(1);
  }
  const filePath = resolve(process.argv[fileArgIdx + 1]!);
  console.log(`Reading summaries from: ${filePath}\n`);

  let summaries: SummaryMap;
  try {
    summaries = JSON.parse(readFileSync(filePath, "utf8")) as SummaryMap;
  } catch {
    console.error(`Could not read or parse file at ${filePath}`);
    process.exit(1);
  }

  const inputIds = Object.keys(summaries);
  if (inputIds.length === 0) {
    console.log("Input file is empty — nothing to do.");
    process.exit(0);
  }
  console.log(`Input contains ${inputIds.length} deal ID(s).\n`);

  // ── Load all deals ────────────────────────────────────────────────────────
  const dealRows = await db.select().from(dealsTable);
  console.log(`Loaded ${dealRows.length} deal(s) from database.\n`);

  // ── Backup ────────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = join(process.cwd(), `deal-scores-backup-${stamp}.json`);
  const backupPayload = {
    app: "KPR Deal Intelligence",
    backupType: "pre-patch-deal-scores",
    createdAt: new Date().toISOString(),
    dealCount: dealRows.length,
    deals: dealRows.map((r) => ({ id: r.id, data: r.data })),
  };
  writeFileSync(backupPath, JSON.stringify(backupPayload, null, 2));
  console.log(`✓ Backup written to: ${backupPath}\n`);

  // ── Patch ─────────────────────────────────────────────────────────────────
  const dealById = new Map(dealRows.map((r) => [r.id, r]));
  let updated = 0;
  let skipped = 0;

  for (const dealId of inputIds) {
    const entry = summaries[dealId]!;
    const row = dealById.get(dealId);

    if (!row) {
      console.warn(`  ⚠  Deal ${dealId} not found in DB — skipping`);
      skipped++;
      continue;
    }

    const data = row.data as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    if ("dealScore" in entry) patch.dealScore = entry.dealScore;
    if ("notes" in entry) patch.notes = entry.notes;
    patch.analysisStale = false;

    if (Object.keys(patch).length === 0) {
      console.warn(`  ⚠  Entry for ${dealId} has neither dealScore nor notes — skipping`);
      skipped++;
      continue;
    }

    await db
      .update(dealsTable)
      .set({ data: { ...data, ...patch }, updatedAt: new Date() })
      .where(eq(dealsTable.id, dealId));

    const name = (data.propertyName as string | undefined) || (data.fileName as string | undefined) || dealId;
    console.log(`  ✓  ${name}`);
    updated++;
  }

  console.log(`\n─────────────────────────────────────`);
  console.log(`Updated : ${updated} deal(s)`);
  if (skipped > 0) console.log(`Skipped : ${skipped} (not found or no fields)`);
  console.log(`Backup  : ${backupPath}`);
  console.log(`\nDone. Restart the API server to serve the updated data.`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
