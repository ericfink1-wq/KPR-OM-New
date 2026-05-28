// Portfolio tenant benchmark query + scoring augmentation.
//
// Flow (called AFTER main extraction returns):
//   1. Resolve raw tenant names → canonical names (via alias map)
//   2. Query tenant_index rows (joined with deals for uploadedAt) — excluding this deal
//   3. Compute recency-weighted averages in TS:
//        uploaded ≤3yr ago → weight 1.0 | 3–7yr → 0.5 | >7yr → 0.25
//   4. If any matches: call Claude with existing dealScore + redFlags + weighted benchmark lines
//      The prompt instructs the model to treat portfolio data as authoritative when confidence is high.
//   5. Merge updated dealScore + redFlags back; return amended extracted object
//
// Non-fatal — any throw returns the original extracted data unchanged.

import { db } from "@workspace/db";
import { tenantIndexTable, tenantAliasesTable, dealsTable } from "@workspace/db";
import { and, ne, inArray, isNotNull, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import { callAnthropicOnce, robustParseJSON } from "./extract";

// ─── Types ────────────────────────────────────────────────────────────────────

type Confidence = "high" | "medium" | "low";

interface TenantBenchmark {
  canonicalName: string;
  locationCount: number;
  weightedAvgRentPerSf: number | null; // primary — recency-weighted
  simpleAvgRentPerSf: number | null;   // unweighted reference
  avgSf: number | null;
  effectiveWeightedCount: number;      // sum of weights (effective sample size)
  oldestDataYear: number | null;
  newestDataYear: number | null;
  confidence: Confidence;
}

// ─── Recency weight ───────────────────────────────────────────────────────────

function recencyWeight(uploadedAt: string | null): number {
  if (!uploadedAt) return 0.5; // unknown vintage — conservative middle weight
  const yearsAgo =
    (Date.now() - new Date(uploadedAt).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (yearsAgo <= 3) return 1.0;
  if (yearsAgo <= 7) return 0.5;
  return 0.25;
}

function deriveConfidence(locationCount: number, effectiveWeightedCount: number): Confidence {
  if (locationCount >= 3 && effectiveWeightedCount >= 2.0) return "high";
  if (locationCount >= 2 || effectiveWeightedCount >= 1.0) return "medium";
  return "low";
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

// ─── DB query — fetches individual rows with uploadedAt from deal JSONB ───────

async function queryBenchmarks(
  canonicalNames: string[],
  excludeDealId: string,
): Promise<Map<string, TenantBenchmark>> {
  if (canonicalNames.length === 0) return new Map();

  // Fetch individual rows joined with deals to get uploadedAt for recency weighting
  const rows = await db
    .select({
      canonicalName: tenantIndexTable.canonicalName,
      rentPerSf: tenantIndexTable.rentPerSf,
      sf: tenantIndexTable.sf,
      uploadedAt: sql<string | null>`${dealsTable.data}->>'uploadedAt'`,
    })
    .from(tenantIndexTable)
    .innerJoin(dealsTable, eq(tenantIndexTable.dealId, dealsTable.id))
    .where(
      and(
        ne(tenantIndexTable.dealId, excludeDealId),
        inArray(tenantIndexTable.canonicalName, canonicalNames),
        isNotNull(tenantIndexTable.canonicalName),
      ),
    );

  // Group by canonical name and compute recency-weighted statistics
  const groups = new Map<
    string,
    Array<{ rentPerSf: number | null; sf: number | null; uploadedAt: string | null }>
  >();
  for (const row of rows) {
    if (!row.canonicalName) continue;
    const arr = groups.get(row.canonicalName) ?? [];
    arr.push({ rentPerSf: row.rentPerSf, sf: row.sf, uploadedAt: row.uploadedAt });
    groups.set(row.canonicalName, arr);
  }

  const result = new Map<string, TenantBenchmark>();

  for (const [canonicalName, entries] of groups) {
    let weightedRentSum = 0;
    let weightSum = 0;
    let simpleRentSum = 0;
    let simpleRentCount = 0;
    let sfSum = 0;
    let sfCount = 0;
    let oldest: Date | null = null;
    let newest: Date | null = null;

    for (const e of entries) {
      const weight = recencyWeight(e.uploadedAt);

      if (e.rentPerSf != null) {
        weightedRentSum += e.rentPerSf * weight;
        weightSum += weight;
        simpleRentSum += e.rentPerSf;
        simpleRentCount++;
      }
      if (e.sf != null) {
        sfSum += e.sf;
        sfCount++;
      }
      if (e.uploadedAt) {
        const d = new Date(e.uploadedAt);
        if (!oldest || d < oldest) oldest = d;
        if (!newest || d > newest) newest = d;
      }
    }

    const weightedAvgRentPerSf = weightSum > 0 ? weightedRentSum / weightSum : null;
    const simpleAvgRentPerSf = simpleRentCount > 0 ? simpleRentSum / simpleRentCount : null;
    const effectiveWeightedCount = weightSum; // sum of weights = effective sample size
    const confidence = deriveConfidence(entries.length, effectiveWeightedCount);

    result.set(canonicalName, {
      canonicalName,
      locationCount: entries.length,
      weightedAvgRentPerSf,
      simpleAvgRentPerSf,
      avgSf: sfCount > 0 ? sfSum / sfCount : null,
      effectiveWeightedCount,
      oldestDataYear: oldest ? oldest.getFullYear() : null,
      newestDataYear: newest ? newest.getFullYear() : null,
      confidence,
    });
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

  return `You are a CRE investment analyst. The existing score below was produced from OM text alone, without portfolio benchmark data. You now have recency-weighted rent/SF benchmarks from previously analyzed deals in the portfolio — use them to augment the score and flags.

DEAL: ${name}, ${addr}

EXISTING SCORE:
Grade: ${grade}
Rationale: ${rationale}
Strengths: ${strengths}
Risks: ${risks}

EXISTING RED FLAGS (JSON — preserve ALL of these):
${existingFlagsJson}

RECENCY-WEIGHTED TENANT BENCHMARK DATA (primary reference for flagging):
${tenantLines.join("\n")}

DATA CONFIDENCE LEVELS (already computed — use as stated):
- "high" (≥3 portfolio locations, effective weighted count ≥2.0): Portfolio weighted avg is AUTHORITATIVE. It supersedes general market assumptions. Explicitly state "Portfolio data from N locations (YYYY–YYYY) shows…" in the description.
- "medium" (2 locations or effective weight ≥1.0): Reliable comparison. Flag normally with sample context.
- "low" (1 location or low effective weight): Directional only. Cap severity at "medium". Note "single data point" in description.

RULES:
1. For any tenant paying >20% BELOW their weighted portfolio avg:
   - high confidence + 20–34% below → severity "medium"
   - high confidence + ≥35% below → severity "high"
   - medium confidence → severity "medium" regardless of gap size
   - low confidence → severity "low" regardless of gap size
   - Description must include: tenant name, this deal rent/SF, weighted portfolio avg, location count, data years, confidence, and % gap. Example: "Portfolio data from 4 locations (2021–2024, high confidence) shows Petco averaging $22.50/SF; this deal has them at $14.00/SF — 38% below benchmark, suggesting below-market rent or market softness."
2. For any tenant paying >20% ABOVE their weighted portfolio avg with high or medium confidence: add a strength bullet to dealScore.strengths noting the premium and data source.
3. Keep ALL existing red flags unchanged — append benchmark-derived flags after them.
4. When high-confidence data exists, prefer it over general market assumptions. You may update dealScore.grade and rationale if high-confidence benchmarks materially change the investment thesis (e.g. multiple anchors are deeply below-market vs. portfolio). Otherwise leave the grade unchanged.
5. DO NOT invent benchmark data. Only flag tenants listed in the analysis above.
6. Vacant tenants: skip entirely.
7. For low-confidence flags, prefix the description with "(1 portfolio data point — directional only)".

Return ONLY valid JSON with no markdown or explanation:
{"dealScore": {"grade": "A+|A|B+|B|C+|C|D", "rationale": "string", "strengths": ["string"], "risks": ["string"]}, "redFlags": [{"severity": "high|medium|low", "description": "string"}]}`;
}

// ─── Deal count helper ────────────────────────────────────────────────────────

export async function getTotalDealCount(): Promise<number> {
  const result = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(dealsTable);
  return result[0]?.count ?? 0;
}

// ─── Rescore: re-run benchmark augmentation, stripping stale benchmark flags ──
//
// Does NOT re-run the full extraction prompt — uses the existing dealScore and
// redFlags from stored deal data, strips any prior benchmark-derived flags,
// then re-queries tenant_index for fresh portfolio data.

export async function rescoreDeal(
  dealId: string,
  dealData: Record<string, unknown>,
  log: Logger,
): Promise<{
  dealScore?: unknown;
  redFlags?: Array<Record<string, unknown>>;
  lastScoredAt: string;
  lastScoredDealCount: number;
}> {
  // Strip previously-injected benchmark flags so they don't accumulate
  const existingFlags = Array.isArray(dealData.redFlags)
    ? (dealData.redFlags as Array<Record<string, unknown>>)
    : [];
  const strippedFlags = existingFlags.filter((f) => {
    const desc = typeof f.description === "string" ? f.description.toLowerCase() : "";
    return (
      !desc.includes("portfolio avg") &&
      !desc.includes("weighted avg") &&
      !desc.includes("portfolio data from") &&
      !desc.includes("benchmark") &&
      !desc.includes("data point — directional")
    );
  });

  const freshData: Record<string, unknown> = { ...dealData, redFlags: strippedFlags };

  // Run augmentation and total count in parallel
  const [augmented, totalCount] = await Promise.all([
    augmentScoringWithBenchmarks(dealId, freshData, log),
    getTotalDealCount(),
  ]);

  return {
    dealScore: augmented.dealScore,
    redFlags: augmented.redFlags as Array<Record<string, unknown>> | undefined,
    lastScoredAt: new Date().toISOString(),
    lastScoredDealCount: totalCount,
  };
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

    // Query recency-weighted portfolio benchmarks (exclude this deal)
    const benchmarks = await queryBenchmarks(canonicalNames, dealId);
    if (benchmarks.size === 0) return extracted;

    // Build per-tenant benchmark lines
    const tenantLines: string[] = [];
    for (const t of scorable) {
      const rawName = t.name as string;
      const canonical = rawToCanonical.get(rawName) ?? rawName;
      const bench = benchmarks.get(canonical);
      if (!bench) continue;

      const rentPSF =
        toNum(t.rentPerSF) ??
        (toNum(t.annualRent) != null && toNum(t.sf) != null
          ? toNum(t.annualRent)! / toNum(t.sf)!
          : null);

      const sfStr =
        toNum(t.sf) != null ? `${Math.round(toNum(t.sf)!).toLocaleString()} SF` : "SF unknown";

      const dateRange =
        bench.oldestDataYear && bench.newestDataYear
          ? bench.oldestDataYear === bench.newestDataYear
            ? `${bench.oldestDataYear}`
            : `${bench.oldestDataYear}–${bench.newestDataYear}`
          : "date unknown";

      const effCount = bench.effectiveWeightedCount.toFixed(1);

      if (rentPSF != null && bench.weightedAvgRentPerSf != null) {
        const pct = ((rentPSF - bench.weightedAvgRentPerSf) / bench.weightedAvgRentPerSf) * 100;
        const simpleNote =
          bench.simpleAvgRentPerSf != null &&
          Math.abs(bench.simpleAvgRentPerSf - bench.weightedAvgRentPerSf) > 0.5
            ? ` (unweighted avg ${fmtMoney(bench.simpleAvgRentPerSf)}/SF)`
            : "";
        tenantLines.push(
          `• ${rawName} (${sfStr}): this deal ${fmtMoney(rentPSF)}/SF vs weighted portfolio avg ${fmtMoney(bench.weightedAvgRentPerSf)}/SF${simpleNote}` +
            ` [${bench.locationCount} location(s), ${dateRange}, effective weight ${effCount}, confidence: ${bench.confidence}]` +
            ` → ${pctStr(pct)} vs benchmark`,
        );
      } else if (bench.locationCount > 0) {
        tenantLines.push(
          `• ${rawName} (${sfStr}): ${bench.locationCount} location(s) in portfolio [${dateRange}, confidence: ${bench.confidence}] — no rent/SF data for comparison`,
        );
      }
    }

    // Only proceed if we have lines with actual rent comparisons
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

    const respData = (await upstream.json()) as Record<string, unknown>;
    if (!upstream.ok) {
      const errMsg =
        typeof respData.error === "object" && respData.error !== null
          ? ((respData.error as Record<string, unknown>).message ??
            JSON.stringify(respData.error))
          : String(respData.error ?? "Unknown error");
      log.warn(
        { errMsg },
        "Benchmark scoring augmentation: Claude returned error — using original score",
      );
      return extracted;
    }

    const blocks = respData.content as Array<{ type: string; text?: string }>;
    const raw = blocks?.find((b) => b.type === "text")?.text ?? "";
    if (!raw.trim()) return extracted;

    const parsed = robustParseJSON(raw) as Record<string, unknown>;
    const updatedScore = parsed.dealScore as Record<string, unknown> | undefined;
    const updatedFlags = parsed.redFlags;

    if (!updatedScore && !updatedFlags) return extracted;

    log.info(
      {
        dealId,
        benchmarkTenants: comparableLines.length,
        highConfidence: [...benchmarks.values()].filter((b) => b.confidence === "high").length,
      },
      "Benchmark scoring augmentation applied",
    );

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
