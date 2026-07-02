// Portfolio tenant benchmark query + scoring augmentation.
//
// Flow (called AFTER main extraction returns):
//   1. Resolve raw tenant names → canonical names (via alias map)
//   2. Query tenant_index rows (joined with deals for uploadedAt) — excluding this deal
//   3. Compute recency-weighted MEDIANS in TS (robust to outliers; "medians, not means"):
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
import { backfillTenantIndexFields } from "./tenantIndex";

// Sales/SF is sparse and noisy, so we only QUOTE a brand sales average once enough
// other locations have disclosed sales — below this we suppress the comparison
// entirely rather than mislead off a tiny sample (Eric's explicit guard).
const MIN_SALES_N = 3;
// Store-size deviation needs at least a couple of comparable boxes to mean anything.
const MIN_SIZE_N = 2;

// Sanity bounds — drop values outside plausible retail ranges BEFORE averaging, so a
// mis-extracted figure (monthly rent left in the annual field, total sales dropped
// into the per-SF field, a missing/extra zero) can't move a brand's average. The
// engine uses a MEAN over often-small samples, so one bad row would otherwise skew it.
// Mirrors the comp benchmark's validity gate; generous, so only true errors drop.
const RENT_PSF_MIN = 1, RENT_PSF_MAX = 300;       // $/SF/yr
const SALES_PSF_MIN = 10, SALES_PSF_MAX = 6000;   // $/SF/yr
const SF_MIN = 100, SF_MAX = 600000;              // leasable SF
const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

// ─── Types ────────────────────────────────────────────────────────────────────

type Confidence = "high" | "medium" | "low";

interface TenantBenchmark {
  canonicalName: string;
  locationCount: number;
  medianRentPerSf: number | null;       // primary — recency-weighted median
  simpleMedianRentPerSf: number | null; // unweighted median (reference)
  medianSf: number | null;              // median store size (prototype proxy)
  sfCount: number;                     // # locations with SF (size sample)
  medianSalesPerSf: number | null;      // recency-weighted median, by sales year
  salesCount: number;                  // # locations with disclosed sales (sample gate)
  salesOldestYear: number | null;
  salesNewestYear: number | null;
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

// Recency weight for a sales figure by its reporting YEAR (more recent sales are
// fresher evidence of how a location is performing). Mirrors recencyWeight's tiers.
function salesRecencyWeight(year: number | null): number {
  if (!year || !isFinite(year)) return 0.5;
  const yearsAgo = new Date().getFullYear() - year;
  if (yearsAgo <= 3) return 1.0;
  if (yearsAgo <= 7) return 0.5;
  return 0.25;
}

// Weighted median: the value at which cumulative weight reaches half the total.
// Far more robust than a mean — one mis-priced or atypical lease can't drag it —
// while still honoring recency (a recent lease carries more weight toward the middle).
function weightedMedian(pairs: Array<{ v: number; w: number }>): number | null {
  const xs = pairs.filter((p) => p.w > 0).sort((a, b) => a.v - b.v);
  if (xs.length === 0) return null;
  const total = xs.reduce((s, p) => s + p.w, 0);
  let cum = 0;
  for (const p of xs) {
    cum += p.w;
    if (cum >= total / 2) return p.v;
  }
  return xs[xs.length - 1].v;
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

  // Make sure the post-creation columns (sales/SF, sales year, NAP flag) exist AND
  // are backfilled from the deal JSON before we read them. Idempotent and cached, so
  // this is a no-op after the first benchmark query each process.
  await backfillTenantIndexFields();

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
      salesPsf: tenantIndexTable.salesPsf,
      salesYear: tenantIndexTable.salesYear,
      isNap: tenantIndexTable.isNap,
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
    Array<{ rentPerSf: number | null; sf: number | null; salesPsf: number | null; salesYear: number | null; vintage: string | null; vintageFromLease: boolean }>
  >();
  for (const row of rows) {
    if (!row.canonicalName) continue;
    // NAP tenants (shadow anchors / outparcels not part of the center) are not real
    // leases at this property — usually a real brand name carried at 0 SF. They must
    // NOT count as comparables: a NAP "Costco" would otherwise drag the brand's size
    // average toward 0 and inflate the location count. Drop them entirely.
    if (row.isNap === true) continue;
    const arr = groups.get(row.canonicalName) ?? [];
    const vintage = row.leaseStartDate ?? row.uploadedAt;
    arr.push({ rentPerSf: row.rentPerSf, sf: row.sf, salesPsf: row.salesPsf, salesYear: row.salesYear, vintage, vintageFromLease: row.leaseStartDate != null });
    groups.set(row.canonicalName, arr);
  }

  const result = new Map<string, TenantBenchmark>();

  for (const [canonicalName, entries] of groups) {
    // Collect in-range observations with their recency weight, then take a WEIGHTED
    // MEDIAN (matching the comp benchmark's "medians, not means" rule). Out-of-range
    // values (unit/typo errors) and 0/blank rows are dropped before the median.
    const rentPairs: Array<{ v: number; w: number }> = [];
    const sfVals: number[] = [];
    const salesPairs: Array<{ v: number; w: number }> = [];
    let salesCount = 0;
    let salesOldestYear: number | null = null;
    let salesNewestYear: number | null = null;
    let oldest: Date | null = null;
    let newest: Date | null = null;

    for (const e of entries) {
      const weight = recencyWeight(e.vintage);
      if (e.rentPerSf != null && inRange(e.rentPerSf, RENT_PSF_MIN, RENT_PSF_MAX)) {
        rentPairs.push({ v: e.rentPerSf, w: weight });
      }
      if (e.sf != null && inRange(e.sf, SF_MIN, SF_MAX)) {
        sfVals.push(e.sf);
      }
      if (e.salesPsf != null && inRange(e.salesPsf, SALES_PSF_MIN, SALES_PSF_MAX)) {
        salesPairs.push({ v: e.salesPsf, w: salesRecencyWeight(e.salesYear) });
        salesCount++;
        if (e.salesYear != null) {
          if (salesOldestYear == null || e.salesYear < salesOldestYear) salesOldestYear = e.salesYear;
          if (salesNewestYear == null || e.salesYear > salesNewestYear) salesNewestYear = e.salesYear;
        }
      }
      if (e.vintage) {
        const d = new Date(e.vintage);
        if (!oldest || d < oldest) oldest = d;
        if (!newest || d > newest) newest = d;
      }
    }

    const effectiveWeightedCount = rentPairs.reduce((s, p) => s + p.w, 0); // effective rent sample
    const confidence = deriveConfidence(entries.length, effectiveWeightedCount);

    result.set(canonicalName, {
      canonicalName,
      locationCount: entries.length,
      medianRentPerSf: weightedMedian(rentPairs),
      simpleMedianRentPerSf: weightedMedian(rentPairs.map((p) => ({ v: p.v, w: 1 }))),
      medianSf: weightedMedian(sfVals.map((v) => ({ v, w: 1 }))),
      sfCount: sfVals.length,
      medianSalesPerSf: weightedMedian(salesPairs),
      salesCount,
      salesOldestYear: salesOldestYear != null ? Math.round(salesOldestYear) : null,
      salesNewestYear: salesNewestYear != null ? Math.round(salesNewestYear) : null,
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

  return `You are a CRE investment analyst. The existing score below was produced from OM text alone, without database benchmark data. You now have recency-weighted rent/SF, store-size, and sales/SF benchmarks from previously analyzed deals in the database — use them to augment the score and flags. Each tenant line may carry RENT, SIZE and/or SALES segments (only the ones the data supports are shown).

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
- "high" (≥3 database locations): the database median is AUTHORITATIVE and supersedes general market assumptions.
- "medium" (2 locations): a reliable comparison.
- "low" (1 location / thin data): directional only — cap severity at "medium".

HOW TO PHRASE THE DATA in descriptions (IMPORTANT — Eric finds "high/medium confidence" repetitive):
- Do NOT write "high confidence" / "medium confidence" in the output. Instead just state HOW MANY leases you're verifying against, e.g. "across 4 Marshalls leases in the database ($22.50/SF median)…".
- RENTS DO NOT "TRADE." Properties trade; rents do not. Never say a rent "trades below/above" the median. Say a rent "IS X% below/above" the database median. e.g. write "Five Below at $15.00/SF is 24% below the database median of $19.83/SF across 15 comparable leases (2026 recency-weighted)" — NOT "…trades 24% below…".
- WORD "PORTFOLIO": reserve "portfolio" / "KPR portfolio" for assets KPR actually OWNS. This benchmark set spans ALL analyzed deals (owned + pipeline + passed), so call it "the database" (or "comparable leases in the database") — never "the portfolio."
- HOLD-PERIOD LENS (three tiers): KPR underwrites a 5–7 year hold (max ~10). Rollover within ~7 yrs = in-hold upside KPR captures. Rollover ~7–12 yrs out = residual/exit upside to position for the NEXT buyer (note it as a future-owner mark-to-market, not in-hold). Locked deeper than ~12 yrs = not upside.
- ONLY call out data strength when it's genuinely LIMITED — i.e. a single lease / thin sample. In that case say so plainly, e.g. "(only 1 database lease — directional)".
- The lease years already reflect recency (more recent leases are weighted more); you may note when the comparison leans on recent vs older leases if relevant, but keep it brief.

RULES:
1. For any tenant paying >20% BELOW their weighted database median, decide what the gap MEANS using the per-tenant signals in {curly braces} (lease term left, renewal options, sales/SF, occupancy-cost %). Below-market rent is NOT automatically good or bad:
   a. CAPTURABLE MARK-TO-MARKET UPSIDE → add to dealScore.strengths or upsideItems (NOT a red flag). Strongest when the tenant is below market AND has LITTLE term left (low remaining term / near expiry) AND few/no remaining fixed-rate options AND can clearly afford more (strong sales/SF with low occupancy-cost %). This is the rent we can push at rollover.
   b. LOCKED PAST THE HOLD → if the tenant has many years of term left and/or remaining fixed/below-market options, we won't reach market during the 5–7yr hold. CRITICAL — LOCKED BELOW-MARKET RENT IS NOT A RISK AND MUST NOT GO IN redFlags OR dealScore.risks. A tenant never walks away from a below-market deal, so this is the STICKIEST, most secure income in the center (near-zero vacancy/re-leasing risk); the only thing "lost" is theoretical upside we were never underwriting. Treat it as a NEUTRAL data point worth calling out: state the rent, the option rents/dates, that it is secure/durable income, and that the mark-to-market simply is not capturable in the hold. Put it in the narrative/notes or (if the tenant is a healthy credit) a mild income-durability strength — NEVER a risk. BANNED framings for a healthy locked tenant: "structural rent underperformance", "rent compression", "concession", "persists through exit" as if it were a negative. If the realistic rollover lands ~7–12 yrs out, you MAY note it as residual/exit upside for the NEXT buyer (low, framed as future-owner mark-to-market — not in-hold). Locked deeper than ~12 yrs: mention neutrally as secure income, do NOT score as upside, do NOT score as a risk.
   c. WARNING / POSSIBLE SOFTNESS → below-market rent belongs in redFlags ONLY in these genuine-risk cases, NOT merely because the rent is low or locked: (i) the tenant looks distressed — weak sales/SF or occupancy-cost % already high — so even the low rent may not be secure (pushing rent, or a closure, is the real risk); or (ii) it is a DOMINANT ANCHOR whose locked below-market rent materially caps the center's income growth and thus resale value (a valuation/exit point, worded as such — the income is still secure); or (iii) the deal is being PRICED as if that locked upside were capturable. Absent one of these, below-market rent is NOT a red flag. Severity when it IS a risk, by data strength + gap: 3+ leases & ≥35% below → "high"; 3+ leases & 20–34% → "medium"; 2 leases → "medium"; 1 lease → "low".
   d. SIGNALS ABSENT → if term/options/sales/occ-cost are unknown, stay measured: note it as a POSSIBLE mark-to-market opportunity contingent on lease term and sales, at "low" severity — do not assert either upside or distress.
   - Any below-market mention must include: tenant name, this deal rent/SF, database median, the LEASE COUNT you're comparing against, data years, and % gap. Example (capturable): "Across 4 Starbucks leases in the database (2021–2024) at a median $42/SF, this deal has them at $27/SF — 36% below — with only 1.5y left, no remaining options, and strong $1.1M/SF sales at a ~6% occupancy cost: a clear mark-to-market opportunity at rollover."
2. ABOVE-MARKET RENT (>20% ABOVE the database median, 2+ leases) — this is potential MARK-TO-MARKET DOWNSIDE, NOT automatically a strength and NEVER "upside." The premium may not survive renewal: at the next expiry/option the rent can reset DOWN toward market, or the tenant leaves — and the above-market rent INFLATES current NOI, so a buyer capping that NOI overpays for income that rolls off. NEVER write that above-market rent "creates mark-to-market upside." Judge sustainability with the per-tenant signals in {curly braces}:
   a. SUSTAINABLE → strong sales/SF and/or LOW occupancy-cost % ⇒ the store can afford the premium (defensible rent). Add a MILD strength bullet (reliable income / productive location), but note an exit buyer discounts above-market rent at sale.
   b. AT-RISK → weak sales/SF or HIGH occupancy-cost %, ESPECIALLY with an expiry/option INSIDE the ~5–7yr hold ⇒ the premium likely resets down or the tenant leaves. Add a redFlag (rollover / NOI-quality risk) sized to the tenant: anchor or large rent share into a near-term reset → "high"/"medium"; small inline → "low". Note the OM's in-place NOI overstates sustainable NOI.
   c. SIGNALS ABSENT (no sales/occ-cost segment) → do NOT call it a strength and do NOT assume upside. Add a "verify" redFlag at "low"–"medium": "[tenant] at $X/SF is Y% above the database median of $Z across N leases; confirm the tenant's sales/occupancy cost support the premium — if not, this is rollover/mark-to-market DOWNSIDE at the ~YYYY expiry/option and current NOI may be overstated." The premium only helps if the trade area is strong and market rents are RISING toward the in-place rent (lower rollover risk) — mention that only when demographics clearly support it, never as scored upside.
3. Keep ALL existing red flags unchanged — append benchmark-derived flags after them.
4. When backed by 3+ leases, prefer the database data over general market assumptions. You may update dealScore.grade and rationale if it materially changes the thesis (e.g. multiple anchors deeply below-market vs. database). Otherwise leave the grade unchanged.
5. DO NOT invent benchmark data. Only flag tenants listed in the analysis above.
6. Vacant tenants: skip entirely.
7. For single-lease flags, note "(only 1 database lease — directional)" in the description.
8. STORE SIZE vs PROTOTYPE (SIZE segments): a box far from its chain's typical size is a real re-leasing risk — off-prototype stores are harder to backfill and likelier to sit on a chain's "non-prototype / do-not-renew" list, so they carry higher closure risk even at a market rent.
   a. DATABASE size: when a SIZE segment shows this store >=40% SMALLER or >=40% LARGER than the database median (it already requires 2+ locations), add a redFlag framed as prototype-fit / backfill risk, citing this SF, the database median, the location count, and the % gap. Severity: >=60% off OR 3+ locations -> "medium"; otherwise "low" (database size samples are directional). Do NOT raise a size flag under a 40% deviation.
   b. NATIONAL prototype (use sparingly, only when you are genuinely confident): if you reliably know a well-known chain's typical national prototype footprint and THIS store is well outside that range, you MAY add a low/medium note — but you MUST label it as based on the chain's general/national prototype (NOT database data), and it must never override the database SIZE segment. If unsure of the prototype, say nothing about size beyond the database segment. NEVER invent a prototype size.
9. SALES PER SF (SALES segments) — treat as AT LEAST as important as rent. A SALES segment is shown ONLY when >=${MIN_SALES_N} database locations disclosed sales, so when one is present the median is reliable enough to quote.
   a. This store materially BELOW the database sales/SF median is a struggling-location / closure-risk redFlag (a weak-selling box is a re-leasing risk regardless of its current rent). Severity by gap + sample: >=40% below -> "medium" (or "high" with 5+ locations); 25–39% below -> "low"–"medium"; under 25% below -> mention only if it compounds another risk.
   b. This store materially ABOVE the median -> a strength bullet (a healthy, productive, sticky location that supports its rent).
   c. If a tenant has NO SALES segment, do NOT comment on its sales and never quote a brand sales median for it — the sample was too small to be reliable.
   - Every sales mention must cite this store's sales/SF, the database median, the location count, and the years.

Return ONLY valid JSON with no markdown or explanation:
{"dealScore": {"grade": "A+|A|B+|B|C+|C|D", "rationale": "string", "strengths": ["string"], "risks": ["string"]}, "redFlags": [{"severity": "high|medium|low", "description": "string"}]}`;
}

// ─── Database-wide benchmarks (for the AI analyst) ────────────────────────────
//
// Runs the SAME recency-weighted engine over EVERY brand in the database (no deal
// excluded), so the analyst quotes the exact medians the app computes — no second,
// divergent methodology. Returns multi-location brands only (a single-location brand
// has no peer set to benchmark against), each with its official rent/sales/size
// medians, sample counts, recency range and confidence. Cached briefly so repeated
// analyst sessions don't re-query.
export interface AnalystTenantBenchmark {
  brand: string;
  locations: number;
  medianRentPerSf: number | null;
  medianSalesPerSf: number | null;
  salesCount: number;
  medianSf: number | null;
  sfCount: number;
  recencyYears: [number | null, number | null];
  salesYears: [number | null, number | null];
  confidence: Confidence;
}

let _benchCache: { at: number; data: AnalystTenantBenchmark[] } | null = null;
const BENCH_TTL_MS = 5 * 60 * 1000;

export async function getAllTenantBenchmarks(): Promise<AnalystTenantBenchmark[]> {
  if (_benchCache && Date.now() - _benchCache.at < BENCH_TTL_MS) return _benchCache.data;
  await backfillTenantIndexFields();
  const nameRows = await db
    .selectDistinct({ canonicalName: tenantIndexTable.canonicalName })
    .from(tenantIndexTable)
    .where(isNotNull(tenantIndexTable.canonicalName));
  const names = nameRows.map((r) => r.canonicalName).filter((n): n is string => !!n);
  // excludeDealId="" excludes no real deal — benchmark spans the whole database.
  const map = await queryBenchmarks(names, "");
  const data: AnalystTenantBenchmark[] = [];
  for (const b of map.values()) {
    // Multi-location brands with at least one usable median — others have nothing to
    // compare against and would just bloat the prompt.
    if (b.locationCount < 2) continue;
    if (b.medianRentPerSf == null && b.medianSalesPerSf == null) continue;
    data.push({
      brand: b.canonicalName,
      locations: b.locationCount,
      medianRentPerSf: b.medianRentPerSf,
      medianSalesPerSf: b.medianSalesPerSf,
      salesCount: b.salesCount,
      medianSf: b.medianSf,
      sfCount: b.sfCount,
      recencyYears: [b.oldestDataYear, b.newestDataYear],
      salesYears: [b.salesOldestYear, b.salesNewestYear],
      confidence: b.confidence,
    });
  }
  data.sort((a, b) => b.locations - a.locations);
  _benchCache = { at: Date.now(), data };
  return data;
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
      desc.includes("database median") ||
      desc.includes("database avg") ||  // legacy wording (pre-median) — keep so old flags strip
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

      const leaseWord = bench.locationCount === 1 ? "lease" : "leases";

      // Signals that frame a below-market rent as capturable upside, locked-in, or a warning.
      const term = toNum(t.remainingTermYears);
      const occCost = toNum(t.occupancyCost);
      const optsRaw = typeof t.renewalOptions === "string" ? t.renewalOptions.trim() : "";
      const thisSales = toNum(t.salesPSF);
      const mtmBits = [
        term != null ? `term ${term.toFixed(1)}y left` : null,
        optsRaw ? `options: ${optsRaw.slice(0, 60)}` : "options: none/unknown",
        thisSales != null ? `sales ${fmtMoney(thisSales)}/SF` : null,
        occCost != null ? `occ-cost ${occCost.toFixed(1)}%` : null,
      ].filter(Boolean).join(", ");

      // — RENT segment: recency-weighted MEDIAN $/SF vs the database —
      let rentSeg = "";
      if (rentPSF != null && bench.medianRentPerSf != null) {
        const pct = ((rentPSF - bench.medianRentPerSf) / bench.medianRentPerSf) * 100;
        const simpleNote =
          bench.simpleMedianRentPerSf != null &&
          Math.abs(bench.simpleMedianRentPerSf - bench.medianRentPerSf) > 0.5
            ? ` (unweighted median ${fmtMoney(bench.simpleMedianRentPerSf)}/SF)`
            : "";
        rentSeg =
          `RENT: this deal ${fmtMoney(rentPSF)}/SF vs database median ${fmtMoney(bench.medianRentPerSf)}/SF across ${bench.locationCount} ${leaseWord}${simpleNote}` +
          ` [${dateRange}, recency-weighted; severity tier: ${bench.confidence}, eff. weight ${effCount}] → ${pctStr(pct)} vs rent benchmark`;
      }

      // — SIZE segment: this box vs the database median store size (prototype proxy) —
      let sizeSeg = "";
      const thisSf = toNum(t.sf);
      if (thisSf != null && bench.medianSf != null && bench.sfCount >= MIN_SIZE_N) {
        const spct = ((thisSf - bench.medianSf) / bench.medianSf) * 100;
        sizeSeg =
          `SIZE: this ${Math.round(thisSf).toLocaleString()} SF vs database median ${Math.round(bench.medianSf).toLocaleString()} SF` +
          ` across ${bench.sfCount} ${bench.sfCount === 1 ? "location" : "locations"} → ${pctStr(spct)} vs size benchmark`;
      }

      // — SALES segment: only when a large-enough sample (≥MIN_SALES_N) has disclosed sales —
      let salesSeg = "";
      if (thisSales != null && bench.medianSalesPerSf != null && bench.salesCount >= MIN_SALES_N) {
        const salesPct = ((thisSales - bench.medianSalesPerSf) / bench.medianSalesPerSf) * 100;
        const syRange =
          bench.salesOldestYear && bench.salesNewestYear
            ? bench.salesOldestYear === bench.salesNewestYear
              ? `${bench.salesNewestYear}`
              : `${bench.salesOldestYear}–${bench.salesNewestYear}`
            : "years n/a";
        salesSeg =
          `SALES: this ${fmtMoney(thisSales)}/SF vs database median ${fmtMoney(bench.medianSalesPerSf)}/SF` +
          ` across ${bench.salesCount} locations [${syRange}, recency-weighted] → ${pctStr(salesPct)} vs sales benchmark`;
      }

      const segs = [rentSeg, sizeSeg, salesSeg].filter(Boolean);
      if (segs.length > 0) {
        tenantLines.push(`• ${rawName} (${sfStr}): ` + segs.join("  ·  ") + (mtmBits ? ` {${mtmBits}}` : ""));
      } else if (bench.locationCount > 0) {
        tenantLines.push(
          `• ${rawName} (${sfStr}): ${bench.locationCount} database ${leaseWord} [${dateRange}; severity tier: ${bench.confidence}] — no rent/size/sales comparison available`,
        );
      }
    }

    // Only proceed if at least one tenant has an actual comparison (rent, size, or sales)
    const comparableLines = tenantLines.filter((l) => /vs (rent|sales|size) benchmark/.test(l));
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
