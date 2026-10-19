// Local Intel — the scan (network + storage). Pure rules live in lib/localIntel.ts.
//
// One scan = ONE Claude request with the server-side web_search tool, capped at the 8–12
// planned queries (max_uses), so a scan's cost is bounded. The API key stays on the server.
// Results are cached per deal in am_records (kind `local_intel`, id `local_intel:<dealId>`) —
// no new table. Auto scans go through a small queue (kind `local_intel_queue`) that the open
// app advances (POST /local-intel/tick — autoscale hosting only runs code during a request),
// never more than once a week per deal; a manual Refresh (admins / owner) always may.
import { sql } from "drizzle-orm";
import { db, dealsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { callAnthropicOnce } from "./extract";
import { robustParseJSON } from "./jsonRepair";
import { resolveJurisdiction } from "./jurisdiction";
import { isTombstoned } from "./dealTombstone";
import { logger } from "./logger";
import {
  LOCAL_INTEL_KIND, LOCAL_INTEL_QUEUE_KIND, AUTO_RESCAN_MIN_DAYS, OWNED_RESCAN_DAYS, LOCAL_INTEL_SYSTEM,
  siteFacts, buildQueries, buildPrompt, normalizeFindings, mergeScan, indexSearchResults, replyJsonText, haversineMiles,
  type LocalIntelRecord, type IntelFinding, type Dismissal,
} from "./localIntel";

export const LOCAL_INTEL_MODEL = "claude-opus-5-5";
/** Auto (unattended) scans per UTC day across the library — a runaway guard, not a budget. */
export const AUTO_SCANS_PER_DAY = 25;
const recId = (dealId: string) => `${LOCAL_INTEL_KIND}:${dealId}`;
const queueId = (dealId: string) => `${LOCAL_INTEL_QUEUE_KIND}:${dealId}`;

type Row = { id: string; kind: string; deal_id: string | null; data: Record<string, unknown>; created_at?: string };
async function put(id: string, kind: string, dealId: string | null, data: unknown, by: string | null): Promise<void> {
  await db.execute(sql`
    INSERT INTO am_records (id, kind, deal_id, data, source_note, updated_by, updated_at)
    VALUES (${id}, ${kind}, ${dealId}, ${JSON.stringify(data)}::jsonb, ${"local-intel"}, ${by}, now())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`);
}

export async function loadLocalIntel(dealId: string): Promise<LocalIntelRecord | null> {
  try {
    const r = await db.execute(sql`SELECT data FROM am_records WHERE id = ${recId(dealId)} LIMIT 1`);
    const row = (r.rows as unknown as Row[])[0];
    return row ? (row.data as unknown as LocalIntelRecord) : null;
  } catch { return null; }
}
export async function loadAllLocalIntel(): Promise<LocalIntelRecord[]> {
  try {
    const r = await db.execute(sql`SELECT data FROM am_records WHERE kind = ${LOCAL_INTEL_KIND}`);
    return (r.rows as unknown as Row[]).map(x => x.data as unknown as LocalIntelRecord);
  } catch { return []; }
}

export async function setDismissed(dealId: string, findingId: string, dismissed: boolean, by: string | null): Promise<LocalIntelRecord | null> {
  const rec = await loadLocalIntel(dealId);
  if (!rec) return null;
  const f = rec.findings.find(x => x.id === findingId);
  const next: Record<string, Dismissal> = { ...rec.dismissed };
  if (dismissed && f) next[f.id] = { by, at: new Date().toISOString(), headline: f.headline, category: f.category, urls: f.sources.map(s => s.url) };
  if (!dismissed) delete next[findingId];
  // Dismissing clears the item's "new" alert; restoring a new high-severity negative brings it back.
  const newHighIds = dismissed ? rec.newHighIds.filter(id => id !== findingId)
    : f && f.isNew && f.impact === "negative" && f.severity === "high" && !rec.newHighIds.includes(f.id) ? [...rec.newHighIds, f.id] : rec.newHighIds;
  const out = { ...rec, dismissed: next, newHighIds };
  await put(recId(dealId), LOCAL_INTEL_KIND, dealId, out, by);
  return out;
}

// ── the Claude call ──────────────────────────────────────────────────────────────────────
type Block = { type: string; text?: string; [k: string]: unknown };
interface ApiReply { content?: Block[]; stop_reason?: string; error?: { message?: string } }

/** Runs the search request, following pause_turn continuations. Returns every content block. */
async function runSearch(system: string, prompt: string, maxUses: number, site: { city: string | null; state: string | null }): Promise<{ blocks: Block[]; stop: string | null }> {
  const tool: Record<string, unknown> = { type: "web_search_20260209", name: "web_search", max_uses: maxUses };
  if (site.city || site.state) tool.user_location = { type: "approximate", ...(site.city ? { city: site.city } : {}), ...(site.state ? { region: site.state } : {}), country: "US" };
  const messages: Array<{ role: string; content: unknown }> = [{ role: "user", content: prompt }];
  const blocks: Block[] = [];
  let stop: string | null = null;
  for (let turn = 0; turn < 4; turn++) {
    const resp = await callAnthropicOnce({
      model: LOCAL_INTEL_MODEL, max_tokens: 16000, system,
      output_config: { effort: "medium" },
      tools: [tool], messages,
      // A policy decline is re-run on the fallback model the API picks (opt-in, Claude API).
      fallbacks: "default",
    }, 0, { "anthropic-beta": "server-side-fallback-2026-07-01" });
    const j = await resp.json().catch(() => ({})) as ApiReply;
    if (!resp.ok) throw new Error(`Claude API ${resp.status}: ${j.error?.message ?? "request failed"}`);
    const content = j.content ?? [];
    blocks.push(...content);
    stop = j.stop_reason ?? null;
    // The server ran out of turn budget mid-search: send the assistant turn back to resume.
    if (stop === "pause_turn") { messages.push({ role: "assistant", content }); continue; }
    break;
  }
  return { blocks, stop };
}

/** Distance by geocoding both ends when the source gives a street address (Census geocoder, free). */
async function geocodeDistances(findings: IntelFinding[], site: { lat: number; lng: number } | null, state: string | null): Promise<void> {
  if (!site) return;
  let budget = 6;
  for (const f of findings) {
    if (budget <= 0) break;
    if (!f.location || !/\d+\s+\S+/.test(f.location)) continue;     // needs a street number to geocode reliably
    budget--;
    try {
      const where = state && !new RegExp(`\\b${state}\\b`, "i").test(f.location) ? `${f.location}, ${state}` : f.location;
      const g = await resolveJurisdiction(where);
      if (g.matched && typeof g.lat === "number" && typeof g.lng === "number") {
        f.distanceMiles = Math.round(haversineMiles(site, { lat: g.lat, lng: g.lng }) * 10) / 10;
        f.distanceBasis = "geocoded";
      }
    } catch { /* keep the reported / estimated figure */ }
  }
}

const inFlight = new Set<string>();

/** One scan for one deal. Throws on a real failure (no key, API error); stores the result. */
export async function scanLocalIntel(dealId: string, opts: { trigger: "manual" | "new-om" | "monthly"; by: string | null }): Promise<LocalIntelRecord> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  if (await isTombstoned(dealId)) throw new Error("This deal was deleted.");
  if (inFlight.has(dealId)) throw new Error("A scan for this deal is already running — try again in a minute.");
  inFlight.add(dealId);
  try {
    const row = (await db.select().from(dealsTable).where(eq(dealsTable.id, dealId)))[0];
    if (!row) throw new Error("Deal not found");
    const deal = row.data as Record<string, unknown>;
    const facts = siteFacts(deal);
    const queries = buildQueries(facts);
    const now = new Date();
    const prev = await loadLocalIntel(dealId);

    let site: { lat: number; lng: number } | null = prev?.site ?? null;
    if (!site && (facts.address || facts.city)) {
      try {
        const g = await resolveJurisdiction([facts.address, facts.city, facts.state].filter(Boolean).join(", "));
        if (g.matched && typeof g.lat === "number" && typeof g.lng === "number") site = { lat: g.lat, lng: g.lng };
      } catch { /* distance stays as reported */ }
    }

    const { blocks, stop } = await runSearch(LOCAL_INTEL_SYSTEM, buildPrompt(facts, queries, now.toISOString().slice(0, 10)), queries.length, facts);
    const searchesUsed = blocks.filter(b => b.type === "server_tool_use" && b.name === "web_search").length;
    if (stop === "refusal") throw new Error("The research request was declined by the model's safety filter.");
    const index = indexSearchResults(blocks);
    const text = blocks.filter(b => b.type === "text").map(b => b.text ?? "").join("");
    let parsed: unknown = { findings: [] };
    try { parsed = robustParseJSON(replyJsonText(text)); }
    catch (err) { logger.warn({ err, dealId, excerpt: text.slice(-400) }, "local intel: reply not readable"); throw new Error("The research reply couldn't be read — try Refresh again."); }

    const findings = normalizeFindings(parsed, index, now);
    await geocodeDistances(findings, site, facts.state);
    const rec = mergeScan(prev, findings, {
      dealId, scannedAt: now.toISOString(), trigger: opts.trigger, by: opts.by, queries, searchesUsed,
      error: null, radiusMiles: facts.radiusMiles, site,
    });
    await put(recId(dealId), LOCAL_INTEL_KIND, dealId, rec, opts.by);
    await db.execute(sql`DELETE FROM am_records WHERE id = ${queueId(dealId)}`).catch(() => {});
    logger.info({ dealId, trigger: opts.trigger, searchesUsed, results: index.size, findings: findings.length, newHigh: rec.newHighIds.length }, "Local intel scan complete");
    return rec;
  } finally { inFlight.delete(dealId); }
}

// ── the queue (auto scans) ───────────────────────────────────────────────────────────────
/** Ask for a background scan. Ignored when the deal was scanned within the auto window. */
export async function enqueueLocalIntel(dealId: string, reason: "new-om" | "monthly"): Promise<void> {
  try {
    const prev = await loadLocalIntel(dealId);
    if (prev?.scannedAt && Date.now() - Date.parse(prev.scannedAt) < AUTO_RESCAN_MIN_DAYS * 86_400_000) return;
    await db.execute(sql`
      INSERT INTO am_records (id, kind, deal_id, data, source_note)
      VALUES (${queueId(dealId)}, ${LOCAL_INTEL_QUEUE_KIND}, ${dealId}, ${JSON.stringify({ reason, at: new Date().toISOString() })}::jsonb, ${"local-intel"})
      ON CONFLICT (id) DO NOTHING`);
  } catch (err) { logger.warn({ err, dealId }, "local intel enqueue failed"); }
}

export async function localIntelPending(): Promise<number> {
  try {
    const r = await db.execute(sql`SELECT count(*)::int AS n FROM am_records WHERE kind = ${LOCAL_INTEL_QUEUE_KIND}`);
    return Number((r.rows as Array<{ n: number }>)[0]?.n ?? 0);
  } catch { return 0; }
}

/** Once a day: queue every Owned deal whose last scan is older than the monthly window. */
async function enqueueMonthlyOwned(): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const marker = `${LOCAL_INTEL_KIND}_meta:monthly:${day}`;
  const r = await db.execute(sql`INSERT INTO am_records (id, kind, data, source_note) VALUES (${marker}, ${"local_intel_meta"}, ${JSON.stringify({ at: new Date().toISOString() })}::jsonb, ${"local-intel"}) ON CONFLICT (id) DO NOTHING RETURNING id`);
  if (!(r.rows?.length)) return;   // already done today
  const recs = new Map((await loadAllLocalIntel()).map(x => [x.dealId, x]));
  const rows = await db.select({ id: dealsTable.id, data: dealsTable.data }).from(dealsTable);
  for (const row of rows) {
    const d = row.data as Record<string, unknown>;
    if (d.status !== "Owned" || d.trashedAt || d._processing) continue;
    const last = recs.get(row.id)?.scannedAt;
    if (!last || Date.now() - Date.parse(last) > OWNED_RESCAN_DAYS * 86_400_000) await enqueueLocalIntel(row.id, "monthly");
  }
}

async function autoScansToday(): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const recs = await loadAllLocalIntel();
  return recs.filter(r => r.trigger !== "manual" && (r.scannedAt ?? "").startsWith(day)).length;
}

/**
 * One bounded step of background work (called by the open app every couple of minutes):
 * queue the monthly owned re-scans, then run at most ONE queued scan.
 */
export async function runLocalIntelTick(): Promise<{ ran: string | null; pending: number; skipped?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { ran: null, pending: 0, skipped: "no API key" };
  await enqueueMonthlyOwned().catch(err => logger.warn({ err }, "local intel monthly enqueue failed"));
  if ((await autoScansToday()) >= AUTO_SCANS_PER_DAY) return { ran: null, pending: await localIntelPending(), skipped: "daily auto-scan cap reached" };
  // Claim the oldest unclaimed item (or one whose claim went stale) — safe across tabs/instances.
  const claim = await db.execute(sql`
    UPDATE am_records SET data = data || ${JSON.stringify({ claimedAt: new Date().toISOString() })}::jsonb, updated_at = now()
    WHERE id = (
      SELECT id FROM am_records WHERE kind = ${LOCAL_INTEL_QUEUE_KIND}
        AND (data->>'claimedAt' IS NULL OR (data->>'claimedAt')::timestamptz < now() - interval '10 minutes')
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING deal_id, data`);
  const item = (claim.rows as Array<{ deal_id: string; data: { reason?: string } }>)[0];
  if (!item) return { ran: null, pending: await localIntelPending() };
  const dealId = item.deal_id;
  const drop = () => db.execute(sql`DELETE FROM am_records WHERE id = ${queueId(dealId)}`).catch(() => {});
  const row = (await db.select().from(dealsTable).where(eq(dealsTable.id, dealId)))[0];
  const d = row?.data as Record<string, unknown> | undefined;
  if (!d || d.trashedAt || d._processingError || (await isTombstoned(dealId))) { await drop(); return { ran: null, pending: await localIntelPending(), skipped: "deal gone" }; }
  // Still reading, or an upload nobody has kept yet (it may be turned away) — try again later.
  if (d._processing || d._ingestBy) {
    await db.execute(sql`UPDATE am_records SET data = data - 'claimedAt' WHERE id = ${queueId(dealId)}`).catch(() => {});
    return { ran: null, pending: await localIntelPending(), skipped: "deal not saved yet" };
  }
  try {
    await scanLocalIntel(dealId, { trigger: item.data?.reason === "monthly" ? "monthly" : "new-om", by: null });
  } catch (err) {
    logger.warn({ err, dealId }, "local intel auto scan failed");
    const prev = await loadLocalIntel(dealId);
    await put(recId(dealId), LOCAL_INTEL_KIND, dealId, { ...(prev ?? { dealId, scannedAt: null, trigger: null, by: null, queries: [], searchesUsed: 0, findings: [], newHighIds: [], dismissed: {}, radiusMiles: 3 }), error: err instanceof Error ? err.message : "scan failed", errorAt: new Date().toISOString() }, null).catch(() => {});
    await drop();
  }
  return { ran: dealId, pending: await localIntelPending() };
}
