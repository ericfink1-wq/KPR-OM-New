/**
 * apply-aliases.ts
 *
 * Reads aliases-proposal.json (or a custom file path passed via --file),
 * upserts the approved aliases into the tenant_aliases table, then backfills
 * canonicalName onto every stored deal's tenant list.
 *
 * Original tenant.name is NEVER overwritten.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run apply-aliases
 *   pnpm --filter @workspace/scripts run apply-aliases -- --file /path/to/aliases.json
 */

import { db } from "@workspace/db";
import { dealsTable, tenantAliasesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Proposal {
  merges?: Array<{ canonicalName: string; rawNames: string[] }>;
  singletons?: string[];
}

async function main() {
  const fileArgIdx = process.argv.indexOf("--file");
  const filePath =
    fileArgIdx !== -1 && process.argv[fileArgIdx + 1]
      ? process.argv[fileArgIdx + 1]!
      : join(process.cwd(), "aliases-proposal.json");

  console.log(`Reading proposal from: ${filePath}\n`);

  let proposal: Proposal;
  try {
    proposal = JSON.parse(readFileSync(filePath, "utf8")) as Proposal;
  } catch {
    console.error(`Could not read proposal file at ${filePath}`);
    console.error("Run 'pnpm --filter @workspace/scripts run propose-aliases' first.");
    process.exit(1);
  }

  // Flatten merges into rawName → canonicalName pairs.
  // Singletons (single rawNames) are skipped — no alias needed when canonical = raw.
  const pairs: Array<{ rawName: string; canonicalName: string }> = [];
  for (const g of proposal.merges ?? []) {
    for (const rawName of g.rawNames) {
      if (rawName !== g.canonicalName) {
        pairs.push({ rawName, canonicalName: g.canonicalName });
      }
    }
  }

  if (pairs.length === 0) {
    console.log("No non-trivial aliases to apply (no merges with variant spellings). Exiting.");
    process.exit(0);
  }

  console.log(`Upserting ${pairs.length} alias(es) into tenant_aliases table...`);

  for (const { rawName, canonicalName } of pairs) {
    await db
      .insert(tenantAliasesTable)
      .values({ rawName, canonicalName })
      .onConflictDoUpdate({
        target: tenantAliasesTable.rawName,
        set: { canonicalName, updatedAt: new Date() },
      });
  }

  console.log(`✓ Upserted ${pairs.length} aliases.\n`);

  const aliasMap = new Map(pairs.map(({ rawName, canonicalName }) => [rawName, canonicalName]));

  console.log("Backfilling canonicalName onto existing deal tenants...");

  const dealRows = await db.select().from(dealsTable);

  let dealsPatched = 0;
  let tenantsPatched = 0;

  for (const row of dealRows) {
    const data = row.data as Record<string, unknown>;
    const tenants = data.tenants;
    if (!Array.isArray(tenants)) continue;

    let changed = false;
    const patchedTenants = (tenants as Array<Record<string, unknown>>).map((t) => {
      const rawName = typeof t.name === "string" ? t.name.trim() : "";
      if (!rawName) return t;
      const canonical = aliasMap.get(rawName);
      if (!canonical) return t;
      if (t.canonicalName === canonical) return t;
      changed = true;
      tenantsPatched++;
      return { ...t, canonicalName: canonical };
    });

    if (!changed) continue;

    await db
      .update(dealsTable)
      .set({ data: { ...data, tenants: patchedTenants }, updatedAt: new Date() })
      .where(eq(dealsTable.id, row.id));

    dealsPatched++;
  }

  console.log(`✓ Backfilled ${tenantsPatched} tenant row(s) across ${dealsPatched} deal(s).`);
  console.log("\nDone. The API server will pick up the new aliases on its next request (no restart needed).");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
