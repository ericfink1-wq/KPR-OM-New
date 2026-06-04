// Portfolio tenant benchmark query + scoring augmentation.
//
// Flow (called AFTER main extraction returns):
//   1. Resolve raw tenant names → canonical names (via alias map)
//   2. Query tenant_index rows (joined with deals for uploadedAt) — excluding this deal
//   3. Compute recency-weighted averages in TS:
//        uploaded ≤3yr ago → weight 1.0 | 3–7yr → 0.5 | >7yr → 0.25
//   4. If any matches: call Claude with existing dealScore + redFlags + weighted benchmark lines
//      The prompt instructs the model to treat database data as authoritative when confidence is high.
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

// Weight a comparable by its vintage — ideally the lease COMMENCEMENT date (when
// the rent was actually set), falling back to OM upload date. A more recently
// signed lease is fresher market evidence and counts more.
function recencyWeight(vintage: string | null): number {
  if (!vintage) return 0.5; // unknown vintage — conservative middle weight
  const ms = new Date(vintage).getTime();
  if (isNaN(ms)) return 0.5; // unparseable date → treat as unknown, not oldest
  const yearsAgo = (Date.now() - ms) / (365.25 * 24 * 60 * 60 * 1000);
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

  // Fetch individual rows. Recency weighting prefers each lease's COMMENCEMENT
  // date (when it was actually signed/repriced) over the OM's upload date — a
  // freshly uploaded OM can still contain a 10-year-old lease, which is staler
  // market evidence than a recently signed one. Falls back to upload date when a
  // lease-start date isn't available.
  const rows = await db
    .select({
      canonicalName: tenantIndexTable.canonicalName,
      rentPerSf: tenantIndexTable.rentPerSf,
      sf: tenantIndexTable.sf,
      leaseStartDate: sql<string | null>`${tenantIndexTable.leaseStartDate}`,
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
    Array<{ rentPerSf: number | null; sf: number | null; vintage: string | null; vintageFromLease: boolean }>
  >();
  for (const row of rows) {
    if (!row.canonicalName) continue;
    const arr = groups.get(row.canonicalName) ?? [];
    const vintage = row.leaseStartDate ?? row.uploadedAt;
    arr.push({ rentPerSf: row.rentPerSf, sf: row.sf, vintage, vintageFromLease: row.leaseStartDate != null });
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
    let leaseDatedCount = 0;

    for (const e of entries) {
      const weight = recencyWeight(e.vintage);
      if (e.vintageFromLease) leaseDatedCount++;

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
      if (e.vintage) {
        const d = new Date(e.vintage);
        if (!oldest || d < oldest) oldest = d;
        if (!newest || d > newest) newest = d;
      }
    }

    const weightedAvgRentPerSf = weightSum > 0 ? weightedRentSum / weightSum : null;
    const simpleAvgRentPerSf = simpleRentCount > 0 ? simpleRentSum / simpleRentCount : null;
    const effectiveWeightedCount = weightSum; // sum of weights = effective sample size
    const confidence = deriveConfidence(entries.length, effectiveWeightedCount);
    void leaseDatedCount;

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

  return `You are a CRE investment analyst. The existing score below was produced from OM text alone, without database benchmark data. You now have recency-weighted rent/SF benchmarks from previously analyzed deals in the database — use them to augment the score and flags.

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

DATA STRENGTH (each tenant line shows its confidence tier — use it to set SEVERITY, but DON'T parrot the word "confidence" in your prose):
- "high" (≥3 database locations): the database average is AUTHORITATIVE and supersedes general market assumptions.
- "medium" (2 locations): a reliable comparison.
- "low" (1 location / thin data): directional only — cap severity at "medium".

HOW TO PHRASE THE DATA in descriptions (IMPORTANT — Eric finds "high/medium confidence" repetitive):
- Do NOT write "high confidence" / "medium confidence" in the output. Instead just state HOW MANY leases you're verifying against, e.g. "across 4 Marshalls leases in the database ($22.50/SF avg)…".
- RENTS DO NOT "TRADE." Properties trade; rents do not. Never say a rent "trades below/above" the average. Say a rent "IS X% below/above" the database average. e.g. write "Five Below at $15.00/SF is 24% below the database average of $19.83/SF across 15 comparable leases (2026 recency-weighted)" — NOT "…trades 24% below…".
- WORD "PORTFOLIO": reserve "portfolio" / "KPR portfolio" for assets KPR actually OWNS. This benchmark set spans ALL analyzed deals (owned + pipeline + passed), so call it "the database" (or "comparable leases in the database") — never "the portfolio."
- HOLD-PERIOD LENS (three tiers): KPR underwrites a 5–7 year hold (max ~10). Rollover within ~7 yrs = in-hold upside KPR captures. Rollover ~7–12 yrs out = residual/exit upside to position for the NEXT buyer (note it as a future-owner mark-to-market, not in-hold). Locked deeper than ~12 yrs = not upside.
- ONLY call out data strength when it's genuinely LIMITED — i.e. a single lease / thin sample. In that case say so plainly, e.g. "(only 1 database lease — directional)".
- The lease years already reflect recency (more recent leases are weighted more); you may note when the comparison leans on recent vs older leases if relevant, but keep it brief.

RULES:
1. For any tenant paying >20% BELOW their weighted database avg, decide what the gap MEANS using the per-tenant signals in {curly braces} (lease term left, renewal options, sales/SF, occupancy-cost %). Below-market rent is NOT automatically good or bad:
   a. CAPTURABLE MARK-TO-MARKET UPSIDE → add to dealScore.strengths or upsideItems (NOT a red flag). Strongest when the tenant is below market AND has LITTLE term left (low remaining term / near expiry) AND few/no remaining fixed-rate options AND can clearly afford more (strong sales/SF with low occupancy-cost %). This is the rent we can push at rollover.
   b. LOCKED PAST THE HOLD → if the tenant has many years of term left and/or remaining fixed/below-market options, we won't reach market during the 5–7yr hold. If the realistic rollover lands ~7–12 yrs out, position it as residual/exit upside for the NEXT buyer (low severity, framed as a future-owner mark-to-market — NOT in-hold upside). If locked deeper than ~12 yrs, mention only briefly / neutral and do NOT score it as upside.
   c. WARNING / POSSIBLE SOFTNESS → if sales are weak or occupancy-cost % is already high, the low rent may signal a struggling tenant or soft market; pushing rent risks losing them. THIS is when below-market belongs in redFlags. Severity by data strength + gap: 3+ leases & ≥35% below → "high"; 3+ leases & 20–34% → "medium"; 2 leases → "medium"; 1 lease → "low".
   d. SIGNALS ABSENT → if term/options/sales/occ-cost are unknown, stay measured: note it as a POSSIBLE mark-to-market opportunity contingent on lease term and sales, at "low" severity — do not assert either upside or distress.
   - Any below-market mention must include: tenant name, this deal rent/SF, database avg, the LEASE COUNT you're comparing against, data years, and % gap. Example (capturable): "Across 4 Starbucks leases in the database (2021–2024) averaging $42/SF, this deal has them at $27/SF — 36% below — with only 1.5y left, no remaining options, and strong $1.1M/SF sales at a ~6% occupancy cost: a clear mark-to-market opportunity at rollover."
2. For any tenant paying >20% ABOVE their database avg backed by 2+ leases: add a strength bullet to dealScore.strengths noting the premium and the lease count.
3. Keep ALL existing red flags unchanged — append benchmark-derived flags after them.
4. When backed by 3+ leases, prefer the database data over general market assumptions. You may update dealScore.grade and rationale if it materially changes the thesis (e.g. multiple anchors deeply below-market vs. database). Otherwise leave the grade unchanged.
5. DO NOT invent benchmark data. Only flag tenants listed in the analysis above.
6. Vacant tenants: skip entirely.
7. For single-lease flags, note "(only 1 database lease — directional)" in the description.

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
// then re-queries tenant_index for fresh database data.

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
    // Identify auto-injected benchmark flags by their machine phrasing. The bare
    // word "benchmark" alone is NOT enough — a human/OM red flag can legitimately
    // say "rent above submarket benchmark" and must not be deleted on rescore.
    // The injected flags always name "the database", so require that pairing.
    const isInjected =
      desc.includes("database avg") ||
      desc.includes("portfolio avg") || // legacy wording — keep so old stored flags still strip
      desc.includes("weighted avg") ||
      desc.includes("database data from") ||
      desc.includes("data point — directional") ||
      (desc.includes("benchmark") && desc.includes("database"));
    return !isInjected;
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

    // Query recency-weighted database benchmarks (exclude this deal)
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
        // Signals that decide whether below-market rent is capturable upside, locked-in, or a warning.
        const term = toNum(t.remainingTermYears);
        const sales = toNum(t.salesPSF);
        const occCost = toNum(t.occupancyCost);
        const optsRaw = typeof t.renewalOptions === "string" ? t.renewalOptions.trim() : "";
        const mtmBits = [
          term != null ? `term ${term.toFixed(1)}y left` : null,
          optsRaw ? `options: ${optsRaw.slice(0, 60)}` : "options: none/unknown",
          sales != null ? `sales ${fmtMoney(sales)}/SF` : null,
          occCost != null ? `occ-cost ${occCost.toFixed(1)}%` : null,
        ].filter(Boolean).join(", ");
        const leaseWord = bench.locationCount === 1 ? "lease" : "leases";
        tenantLines.push(
          `• ${rawName} (${sfStr}): this deal ${fmtMoney(rentPSF)}/SF vs avg ${fmtMoney(bench.weightedAvgRentPerSf)}/SF across ${bench.locationCount} database ${leaseWord}${simpleNote}` +
            ` [${dateRange}, recency-weighted; severity tier: ${bench.confidence}, eff. weight ${effCount}]` +
            ` → ${pctStr(pct)} vs benchmark` +
            (mtmBits ? ` {${mtmBits}}` : ""),
        );
      } else if (bench.locationCount > 0) {
        const leaseWord = bench.locationCount === 1 ? "lease" : "leases";
        tenantLines.push(
          `• ${rawName} (${sfStr}): ${bench.locationCount} database ${leaseWord} [${dateRange}; severity tier: ${bench.confidence}] — no rent/SF data for comparison`,
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
