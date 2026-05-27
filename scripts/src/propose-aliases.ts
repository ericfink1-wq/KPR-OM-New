/**
 * propose-aliases.ts
 *
 * Scans all deals, collects distinct raw tenant names, sends them to Claude in
 * one call, and writes aliases-proposal.json for you to review and edit.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run propose-aliases
 *
 * After reviewing / editing aliases-proposal.json:
 *   pnpm --filter @workspace/scripts run apply-aliases
 */

import { db } from "@workspace/db";
import { dealsTable, tenantAliasesTable } from "@workspace/db";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

async function callClaude(system: string, user: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in the environment");

  const resp = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8096,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Claude API error ${resp.status}: ${body}`);
  }

  const data = (await resp.json()) as { content: Array<{ type: string; text: string }> };
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function parseJSON(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  return JSON.parse(cleaned);
}

async function main() {
  console.log("Loading deals from database...\n");

  const [dealRows, existingAliases] = await Promise.all([
    db.select().from(dealsTable),
    db.select().from(tenantAliasesTable),
  ]);

  const alreadyMapped = new Set(existingAliases.map((r) => r.rawName));

  const rawNamesSet = new Set<string>();
  for (const row of dealRows) {
    const data = row.data as Record<string, unknown>;
    const tenants = data.tenants;
    if (!Array.isArray(tenants)) continue;
    for (const t of tenants) {
      const name = (t as Record<string, unknown>).name;
      if (typeof name === "string" && name.trim() && !/^vacant/i.test(name.trim())) {
        rawNamesSet.add(name.trim());
      }
    }
  }

  const allRawNames = [...rawNamesSet].sort();
  const unmapped = allRawNames.filter((n) => !alreadyMapped.has(n));

  console.log(`Deals loaded:           ${dealRows.length}`);
  console.log(`Distinct raw names:     ${allRawNames.length}`);
  console.log(`Already in alias table: ${alreadyMapped.size}`);
  console.log(`Sending to Claude:      ${unmapped.length}\n`);

  if (unmapped.length === 0) {
    console.log("All tenant names already have aliases. Nothing to propose.");
    process.exit(0);
  }

  console.log("Calling Claude...");

  const system = `You are a commercial real estate data analyst specializing in tenant name normalization for REIT and private equity deal analysis.`;

  const userMsg = `Below are ${unmapped.length} distinct tenant name strings extracted from commercial real estate offering memoranda. Many represent the same retail brand but with minor spelling, punctuation, or casing differences (e.g. "T Mobile", "T-Mobile", "TMobile" → "T-Mobile").

Your task:
1. Group names that clearly refer to the same brand into canonical groupings.
2. Use the most common / official spelling as canonicalName.
3. Only group names you are highly confident are the same brand — err on the side of leaving ambiguous names as singletons.
4. Every name in the input list must appear exactly once across all groups.

Return ONLY a JSON array — no markdown fences, no explanation — in this exact shape:
[
  { "canonicalName": "T-Mobile", "rawNames": ["T Mobile", "T-Mobile", "TMobile"] },
  { "canonicalName": "Starbucks", "rawNames": ["Starbucks"] }
]

Tenant name list:
${unmapped.map((n) => `- ${n}`).join("\n")}`;

  const raw = await callClaude(system, userMsg);

  let groupings: Array<{ canonicalName: string; rawNames: string[] }>;
  try {
    groupings = parseJSON(raw) as typeof groupings;
  } catch {
    console.error("Failed to parse Claude response:\n", raw);
    throw new Error("Claude returned unparseable JSON — see above");
  }

  const coveredNames = new Set<string>();
  for (const g of groupings) {
    for (const n of g.rawNames) coveredNames.add(n);
  }
  const missing = unmapped.filter((n) => !coveredNames.has(n));
  if (missing.length > 0) {
    console.warn(`\n⚠  ${missing.length} names omitted by Claude — adding as singletons:`, missing);
    for (const n of missing) groupings.push({ canonicalName: n, rawNames: [n] });
  }

  const merges = groupings.filter((g) => g.rawNames.length > 1);
  const singletons = groupings.filter((g) => g.rawNames.length === 1).map((g) => g.canonicalName);

  const outputPath = join(process.cwd(), "aliases-proposal.json");
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        _instructions:
          "Review the 'merges' array. Each entry maps all rawNames → canonicalName. Edit as needed, then run: pnpm --filter @workspace/scripts run apply-aliases",
        _stats: {
          totalRawNames: allRawNames.length,
          alreadyMapped: alreadyMapped.size,
          proposedMergeGroups: merges.length,
          singletons: singletons.length,
        },
        merges,
        singletons,
      },
      null,
      2
    )
  );

  console.log(`\n✓ Wrote ${outputPath}\n`);

  if (merges.length === 0) {
    console.log("No merge groups found — all names appear to be unique.");
  } else {
    console.log(`${merges.length} proposed merge group(s):`);
    for (const g of merges) {
      console.log(`  "${g.canonicalName}"  ←  ${g.rawNames.filter((n) => n !== g.canonicalName).join(", ")}`);
    }
  }

  console.log(`\n${singletons.length} singleton(s) (no normalization needed).`);
  console.log("\nNext steps:");
  console.log("  1. Open aliases-proposal.json and review / edit the merges array.");
  console.log("  2. Run: pnpm --filter @workspace/scripts run apply-aliases");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
