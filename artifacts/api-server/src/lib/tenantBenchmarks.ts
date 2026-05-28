// Portfolio tenant benchmark query + scoring augmentation.
//
// Flow (called AFTER main extraction returns):
//   1. Resolve raw tenant names → canonical names (via alias map)
//   2. Query tenant_index for avg rent/SF, avg SF, location count — excluding this deal
//   3. If any matches: call Claude with existing dealScore + redFlags + benchmark deltas
//   4. Merge updated dealScore + redFlags back; return amended extracted object
//
// Non-fatal — if anything throws, the original extracted data is returned unchanged.

import { db } from "@workspace/db";
import { tenantIndexTable, tenantAliasesTable } from "@workspace/db";
import { and, ne, inArray, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import { callAnthropicOnce, robustParseJSON } from "./extract";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TenantBenchmark {
  canonicalName: string;
  locationCount: number;
  avgRentPerSf: number | null;
  avgSf: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadAliasMap(): Promise<Record<string, string>> {
  const rows = await db.select().from(tenantAliasesTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.rawName] = r.canonicalName;
  return map;
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : null;
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function pctStr(pct: number): string {
  return `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

// ─── DB query ─────────────────────────────────────────────────────────────────

async function queryBenchmarks(
  canonicalNames: string[],
  excludeDealId: string,
): Promise<Map<string, TenantBenchmark>> {
  if (canonicalNames.length === 0) return new Map();

  const rows = await db
    .select({
      canonicalName: tenantIndexTable.canonicalName,
      locationCount: sql<number>`cast(count(*) as int)`,
      avgRentPerSf: sql<number | null>`avg(${tenantIndexTable.rentPerSf})`,
      avgSf: sql<number | null>`avg(${tenantIndexTable.sf})`,
    })
    .from(tenantIndexTable)
    .where(
      and(
        ne(tenantIndexTable.dealId, excludeDealId),
        inArray(tenantIndexTable.canonicalName, canonicalNames),
        isNotNull(tenantIndexTable.canonicalName),
      ),
    )
    .groupBy(tenantIndexTable.canonicalName);

  const result = new Map<string, TenantBenchmark>();
  for (const row of rows) {
    if (row.canonicalName) {
      result.set(row.canonicalName, {
        canonicalName: row.canonicalName,
        locationCount: row.locationCount,
        avgRentPerSf: row.avgRentPerSf != null ? Number(row.avgRentPerSf) : null,
        avgSf: row.avgSf != null ? Number(row.avgSf) : null,
      });
    }
  }
  return result;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildAugmentPrompt(
  extracted: Record<string, unknown>,
  tenantLines: string[],
  existingFlagsJson: string,
): string {
  const name = extracted.propertyName ?? "Unknown";
  const addr = [extracted.address, extracted.city, extracted.state].filter(Boolean).join(", ") || "Unknown";
  const score = extracted.dealScore as Record<string, unknown> | undefined;
  const grade = score?.grade ?? "—";
  const rationale = score?.rationale ?? "—";
  const strengths = Array.isArray(score?.strengths) ? (score.strengths as string[]).join("; ") : "—";
  const risks = Array.isArray(score?.risks) ? (score.risks as string[]).join("; ") : "—";

  return `You are a CRE analyst reviewing a deal. The existing score and flags were produced without portfolio benchmark data. You now have portfolio-wide rent/SF averages for tenants at this property — use them to augment the score and flags.

DEAL: ${name}, ${addr}

EXISTING SCORE:
Grade: ${grade}
Rationale: ${rationale}
Strengths: ${strengths}
Risks: ${risks}

EXISTING RED FLAGS (JSON — preserve all of these):
${existingFlagsJson}

TENANT RENT BENCHMARK ANALYSIS (for tenants where portfolio data exists):
${tenantLines.join("\n")}

RULES:
1. For any tenant paying >20% BELOW their portfolio average: add a red flag.
   - 20–34% below → severity "medium"
   - ≥35% below → severity "high"
   - Description must include: tenant name, this deal's rent/SF, portfolio avg, location count, and % gap. Example: "Gap is paying $11.00/SF — portfolio avg is $18.50/SF across 3 locations (41% below benchmark). May indicate weak lease or market softness at this center."
2. For any tenant paying >20% ABOVE their portfolio average: add a bullet to dealScore.strengths noting the premium.
3. Keep ALL existing red flags — append benchmark flags after them.
4. Update dealScore.grade / rationale ONLY if the benchmarks materially change the investment thesis (e.g. multiple anchor tenants are deeply below-market vs. portfolio). Otherwise leave grade unchanged.
5. DO NOT invent benchmark data. Only flag tenants listed in the analysis above.
6. Vacant tenants: skip entirely.

Return ONLY valid JSON with no markdown or explanation:
{"dealScore": {"grade": "A+|A|B+|B|C+|C|D", "rationale": "string", "strengths": ["string"], "risks": ["string"]}, "redFlags": [{"severity": "high|medium|low", "description": "string"}]}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function augmentScoringWithBenchmarks(
  dealId: string,
  extracted: Record<string, unknown>,
  log: Logger,
): Promise<Record<string, unknown>> {
  try {
    const tenants = extracted.tenants as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(tenants) || tenants.length === 0) return extracted;

    // Only non-vacant tenants with a name
    const scorable = tenants.filter(
      (t) =>
        typeof t.name === "string" &&
        t.name.trim().toLowerCase() !== "vacant" &&
        t.name.trim() !== "",
    );
    if (scorable.length === 0) return extracted;

    // Resolve raw → canonical names
    const aliasMap = await loadAliasMap();
    const rawToCanonical = new Map<string, string>();
    for (const t of scorable) {
      const raw = t.name as string;
      rawToCanonical.set(raw, aliasMap[raw] ?? raw);
    }
    const canonicalNames = [...new Set(rawToCanonical.values())];

    // Query portfolio benchmarks (exclude this deal)
    const benchmarks = await queryBenchmarks(canonicalNames, dealId);
    if (benchmarks.size === 0) return extracted; // No other portfolio data — skip augmentation

    // Build per-tenant benchmark lines — only where comparison is possible
    const tenantLines: string[] = [];
    for (const t of scorable) {
      const rawName = t.name as string;
      const canonical = rawToCanonical.get(rawName) ?? rawName;
      const bench = benchmarks.get(canonical);
      if (!bench) continue;

      // Compute effective rent/SF for this deal
      const rentPSF =
        toNum(t.rentPerSF) ??
        (toNum(t.annualRent) != null && toNum(t.sf) != null
          ? toNum(t.annualRent)! / toNum(t.sf)!
          : null);

      const sfStr = toNum(t.sf) != null ? `${Math.round(toNum(t.sf)!).toLocaleString()} SF` : "SF unknown";

      if (rentPSF != null && bench.avgRentPerSf != null) {
        const pct = ((rentPSF - bench.avgRentPerSf) / bench.avgRentPerSf) * 100;
        tenantLines.push(
          `• ${rawName} (${sfStr}): this deal ${fmtMoney(rentPSF)}/SF vs portfolio avg ${fmtMoney(bench.avgRentPerSf)}/SF across ${bench.locationCount} other location(s) → ${pctStr(pct)} vs benchmark`,
        );
      } else if (bench.locationCount > 0) {
        tenantLines.push(
          `• ${rawName} (${sfStr}): ${bench.locationCount} other location(s) in portfolio — no rent/SF data available for comparison`,
        );
      }
    }

    // If we have no lines with actual comparisons, don't waste a Claude call
    const comparableLines = tenantLines.filter((l) => l.includes("vs benchmark"));
    if (comparableLines.length === 0) return extracted;

    // Build prompt
    const existingFlags = Array.isArray(extracted.redFlags) ? extracted.redFlags : [];
    const prompt = buildAugmentPrompt(
      extracted,
      tenantLines,
      JSON.stringify(existingFlags, null, 2),
    );

    // Call Claude (haiku — small fast call)
    const upstream = await callAnthropicOnce({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const respData = await upstream.json() as Record<string, unknown>;
    if (!upstream.ok) {
      const errMsg =
        typeof respData.error === "object" && respData.error !== null
          ? ((respData.error as Record<string, unknown>).message ?? JSON.stringify(respData.error))
          : String(respData.error ?? "Unknown error");
      log.warn({ errMsg }, "Benchmark scoring augmentation: Claude returned error — using original score");
      return extracted;
    }

    const blocks = respData.content as Array<{ type: string; text?: string }>;
    const raw = blocks?.find((b) => b.type === "text")?.text ?? "";
    if (!raw.trim()) return extracted;

    const parsed = robustParseJSON(raw) as Record<string, unknown>;
    const updatedScore = parsed.dealScore as Record<string, unknown> | undefined;
    const updatedFlags = parsed.redFlags;

    if (!updatedScore && !updatedFlags) return extracted;

    log.info({ dealId, benchmarkTenants: comparableLines.length }, "Benchmark scoring augmentation applied");

    return {
      ...extracted,
      ...(updatedScore ? { dealScore: updatedScore } : {}),
      ...(Array.isArray(updatedFlags) ? { redFlags: updatedFlags } : {}),
    };
  } catch (err) {
    log.warn({ err }, "Benchmark scoring augmentation failed — using original extraction");
    return extracted;
  }
}
