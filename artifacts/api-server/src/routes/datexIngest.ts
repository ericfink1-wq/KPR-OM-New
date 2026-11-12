import express, { Router, type Request, type Response, type NextFunction } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db, dealsTable } from "@workspace/db";
import { loadDatexMapFromDb, datexLoanToRecord, upsertRecord } from "../lib/assetMgmt";
import { DATEX_BLOCK_KEY, type DatexPayload } from "../lib/datexImport";
import { mergeDatexDeal, dealState, type SalesRow } from "../lib/datexIngest";
import { verifyIngestToken, loadSalesRows, saveSalesRows, writeIngestLog, getAutoRefreshSetting, type IngestLog } from "../lib/datexAutoRefresh";
import { updateDealSafely } from "../lib/dealWrite";
import { createSnapshot } from "./snapshots";
import { buildPayload, planCalls, normalizeCalls, parseCallsNdjson, PLAN_BUILD_VERSION, type DatexCall, type KitState, type PlanMode, type SalesMode } from "../lib/datexPlanBuild";

// DATEX AUTO-REFRESH endpoints for the scheduled Claude task (Eric, 10/18/26). Authenticated
// by a scoped ingest token (Bearer), NOT a browser session — so this router is mounted ahead
// of the session/2FA gate, like the MCP endpoint. The token can do exactly two things: read
// the per-deal state below and post a Datex payload. Nothing else on the site accepts it.
const router = Router();
const MAX_BYTES = 10 * 1024 * 1024;
const PER_MINUTE = 20;
const hits = new Map<string, number[]>();

function rateLimited(id: string): boolean {
  const now = Date.now(), times = (hits.get(id) ?? []).filter(t => now - t < 60_000);
  if (times.length >= PER_MINUTE) { hits.set(id, times); return true; }
  times.push(now); hits.set(id, times); return false;
}

type Authed = Request & { ingestToken?: { id: string; label: string } };
async function requireIngestToken(req: Authed, res: Response, next: NextFunction) {
  const h = String(req.headers.authorization ?? "");
  const raw = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  const tok = raw ? await verifyIngestToken(raw).catch(() => null) : null;
  if (!tok) { res.status(401).json({ error: "A valid, unexpired Datex ingest token is required (Authorization: Bearer kpr_dx_… or kpr_dxt_…)." }); return; }
  // The admin off switch stops every token, permanent and short-lived alike.
  const setting = await getAutoRefreshSetting().catch(() => ({ enabled: true }));
  if (!setting.enabled) { res.status(403).json({ error: "Datex auto-refresh is turned off (Asset Mgmt → Properties → Datex auto-refresh)." }); return; }
  if (rateLimited(tok.id)) { res.status(429).json({ error: `Rate limit: at most ${PER_MINUTE} calls a minute per token.` }); return; }
  req.ingestToken = tok;
  next();
}

async function ownedMapped() {
  const map = await loadDatexMapFromDb();
  const rows = await db.select().from(dealsTable);
  const byId = new Map(rows.map(r => [r.id, r.data as Record<string, unknown>]));
  return map.mappings.map(m => ({ ...m, data: byId.get(m.dealId) }))
    .filter(m => m.data && m.data.status === "Owned" && !m.data.trashedAt);
}

async function currentState() {
  const deals = await ownedMapped(), sales = await loadSalesRows();
  return {
    generatedAt: new Date().toISOString(),
    rosterHashFormula: "sha256 of sorted lines 'tenantId|sf|annualRent|leaseExpiry' (numbers rounded to 2dp, blank when unknown; current + signed-not-open tenants only), joined by \\n — first 16 hex chars",
    deals: deals.map(d => dealState(d.dealId, String(d.data!.propertyName ?? d.propertyName ?? ""), d.bldgIds, (d.data![DATEX_BLOCK_KEY] as Record<string, unknown>) ?? null, sales.get(d.dealId) ?? [])),
  };
}

// GET /api/datex/state — per mapped owned deal, what is stored and as of when.
router.get("/datex/state", requireIngestToken, async (req, res) => {
  try {
    res.json(await currentState());
  } catch (err) {
    req.log.error({ err }, "datex state failed");
    res.status(500).json({ error: "Couldn't read the Datex state" });
  }
});

// POST /api/datex/ingest[?dryRun=1] — MERGE a Datex payload (v2 shape). Blocks absent from a
// deal are kept; see lib/datexIngest.ts for exactly how each sent block combines.
router.post("/datex/ingest", requireIngestToken, async (req: Authed, res) => {
  const dryRun = /^(1|true|yes)$/i.test(String(req.query.dryRun ?? "")) || req.body?.dryRun === true;
  const len = Number(req.headers["content-length"] ?? 0);
  if (len > MAX_BYTES || Buffer.byteLength(JSON.stringify(req.body ?? {})) > MAX_BYTES) { res.status(413).json({ error: "Payload is over 10 MB — send fewer buildings per call." }); return; }
  await runIngest(req.body?.payload ?? req.body, dryRun, req, res);
});

type IngestReply = { status: number; body: Record<string, unknown> };
/** Merge a v2 Datex payload (dry run or real write). Shared by POST /datex/ingest and
 *  POST /datex/build (which builds the payload here on the site from raw Datex rows). */
async function ingestPayload(payloadIn: unknown, dryRun: boolean, tokenLabel: string, reqLog: Request["log"]): Promise<IngestReply> {
  const log: IngestLog = { at: new Date().toISOString(), dryRun, token: tokenLabel, asOf: null, blocks: {}, dealsChanged: 0, dealsUnchanged: 0, rejected: [], warnings: 0 };
  try {
    const payload = payloadIn as DatexPayload;
    const asOf = String(payload?.asOf ?? "").slice(0, 10);
    log.asOf = asOf || null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return { status: 400, body: { error: "asOf must be an ISO date (YYYY-MM-DD)" } };
    if (asOf > new Date().toISOString().slice(0, 10)) return { status: 400, body: { error: `asOf ${asOf} is in the future` } };
    if (!Array.isArray(payload.deals) || !payload.deals.length) return { status: 400, body: { error: "payload contains no deals" } };
    const map = await loadDatexMapFromDb();
    const mapped = new Map(map.mappings.map(m => [m.dealId, m]));
    const unmapped = new Set(map.unmapped.map(m => m.dealId));
    const rows = await db.select().from(dealsTable);
    const byId = new Map(rows.map(r => [r.id, r.data as Record<string, unknown>]));
    const sales = await loadSalesRows();

    type Plan = { dealId: string; propertyName: string; block: Record<string, unknown>; salesRows: SalesRow[]; salesChanged: boolean; sent: string[]; changed: string[]; warnings: string[] };
    const plans: Plan[] = [], skipped: Array<{ dealId: string; reason: string }> = [];
    for (const p of payload.deals) {
      const dealId = String(p?.dealId ?? ""), deal = byId.get(dealId), name = String(deal?.propertyName ?? "");
      if (unmapped.has(dealId)) { skipped.push({ dealId, reason: "not set up in Datex yet — skipped by design" }); continue; }
      const entry = mapped.get(dealId);
      if (!entry) { log.rejected.push({ dealId, problem: "not in the Datex building map" }); continue; }
      if (!deal || deal.trashedAt) { log.rejected.push({ dealId, problem: "no such deal in the library" }); continue; }
      if (deal.status !== "Owned") { log.rejected.push({ dealId, problem: `status is "${deal.status ?? "(none)"}", not Owned — Datex only covers owned assets` }); continue; }
      const prev = (deal[DATEX_BLOCK_KEY] as Record<string, unknown> | undefined) ?? null;
      const stored = sales.get(dealId) ?? [];
      const m = mergeDatexDeal(prev, stored, p, asOf, entry);
      if ("problem" in m) { log.rejected.push({ dealId, problem: m.problem }); continue; }
      for (const b of m.sent) log.blocks[b] = (log.blocks[b] ?? 0) + 1;
      plans.push({ dealId, propertyName: name || entry.propertyName, block: m.block, salesRows: m.salesRows, salesChanged: JSON.stringify(m.salesRows) !== JSON.stringify(stored), sent: m.sent, changed: m.changed, warnings: m.warnings });
    }
    const changing = plans.filter(p => p.changed.length || p.salesChanged);
    log.dealsChanged = changing.length; log.dealsUnchanged = plans.length - changing.length;
    log.warnings = plans.reduce((t, p) => t + p.warnings.length, 0);

    const loanSeeds = plans.flatMap(a => {
      const p = payload.deals.find(x => x.dealId === a.dealId);
      return (Array.isArray(p?.loans) ? p!.loans : []).map(l => ({ dealId: a.dealId, rec: datexLoanToRecord(l) })).filter(x => x.rec);
    });
    if (!dryRun && (changing.length || loanSeeds.length)) {
      await createSnapshot("before-datex-ingest");
      for (const p of changing) {
        // Re-read and write only the live block — no acquisition-era field can change.
        await updateDealSafely(p.dealId, () => ({ [DATEX_BLOCK_KEY]: p.block }));
        if (p.salesChanged) await saveSalesRows(p.dealId, p.salesRows);
      }
      for (const s of loanSeeds) await upsertRecord(s.rec!.id, "loan", s.dealId, s.rec!.data as Record<string, unknown>, s.rec!.note, "datex-ingest");
    }
    await writeIngestLog(log).catch(err => reqLog.warn({ err }, "ingest log write failed"));
    reqLog.info({ dryRun, changed: changing.length, rejected: log.rejected.length }, "Datex ingest");
    return { status: 200, body: {
      ok: true, dryRun, asOf,
      counts: { received: payload.deals.length, changed: changing.length, unchanged: plans.length - changing.length, skipped: skipped.length, rejected: log.rejected.length, datexLoans: loanSeeds.length },
      deals: plans.map(p => ({ dealId: p.dealId, propertyName: p.propertyName, blocksSent: p.sent, changed: p.changed, warnings: p.warnings })),
      skipped, rejected: log.rejected,
      note: dryRun ? "DRY RUN — nothing was written." : changing.length ? "Merged. Only the Datex live block changed; blocks not sent were kept." : "Nothing changed.",
    } };
  } catch (err) {
    log.error = err instanceof Error ? err.message : "ingest failed";
    await writeIngestLog(log).catch(() => {});
    reqLog.error({ err }, "Datex ingest failed");
    return { status: 500, body: { error: log.error } };
  }
}

async function runIngest(payload: unknown, dryRun: boolean, req: Authed, res: Response) {
  const r = await ingestPayload(payload, dryRun, req.ingestToken!.label, req.log);
  res.status(r.status).json(r.body);
}


// ── SERVER-SIDE PLAN + BUILD (11/12/26) ─────────────────────────────────────────────
// Claude's safety check stopped the monthly run for downloading job_kit.py and running it
// ("code from external"). These two endpoints do the kit's plan/build HERE, so the scheduled
// task only makes plain HTTPS calls: it calls Datex, writes the raw result rows to a file,
// and POSTs that file. Body = the calls, either NDJSON (the kit's calls.jsonl: one
// {entity, tool, filters, rows} per line; Content-Type application/x-ndjson) or JSON
// {calls:[...]} / a bare array. Options come from the query string (or the JSON body):
// mode=weekly|monthly|all, sales=auto|none|newest|all, asOf=YYYY-MM-DD (default today UTC),
// finPeriod=YYYYMM, force=1, dryRun=1. gzip (Content-Encoding: gzip) is accepted.
const CALLS_LIMIT = "60mb";
const ndjson = express.text({ type: ["application/x-ndjson", "application/jsonl", "text/plain"], limit: CALLS_LIMIT });
const opt = (req: Request, k: string): string => String((req.query[k] ?? (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Record<string, unknown>)[k] : undefined)) ?? "").trim();
const truthy = (v: string) => /^(1|true|yes)$/i.test(v);

function readCalls(req: Request): DatexCall[] {
  if (typeof req.body === "string") return parseCallsNdjson(req.body);
  if (Array.isArray(req.body)) return normalizeCalls(req.body);
  const c = (req.body as Record<string, unknown> | undefined)?.calls;
  if (typeof c === "string") return parseCallsNdjson(c);
  // curl --data-binary without a Content-Type arrives form-encoded — say how to fix it.
  if (c === undefined && /urlencoded/i.test(String(req.headers["content-type"] ?? ""))) throw new Error("Send calls.jsonl with the header 'Content-Type: application/x-ndjson' (curl --data-binary @calls.jsonl -H 'Content-Type: application/x-ndjson').");
  return normalizeCalls(c);
}
function readOptions(req: Request): { asOf: string; mode: PlanMode; sales: SalesMode } | { error: string } {
  const today = new Date().toISOString().slice(0, 10);
  const asOf = opt(req, "asOf") || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || asOf > today) return { error: "asOf must be today or an earlier ISO date (YYYY-MM-DD)" };
  const mode = (opt(req, "mode") || "weekly") as PlanMode;
  if (!["weekly", "monthly", "all"].includes(mode)) return { error: "mode must be weekly, monthly or all" };
  const sales = (opt(req, "sales") || "auto") as SalesMode;
  if (!["auto", "none", "newest", "all"].includes(sales)) return { error: "sales must be auto, none, newest or all" };
  return { asOf, mode, sales };
}
const callsSummary = (calls: DatexCall[]) => {
  const by: Record<string, number> = {};
  for (const c of calls) by[String(c.entity)] = (by[String(c.entity)] ?? 0) + (c.rows?.length ?? 0);
  return { calls: calls.length, rowsByEntity: by };
};

// POST /api/datex/plan — the Datex MCP calls to make next. No calls (or no Occupancy rows) →
// phase 1: the single Occupancy call. With the Occupancy rows → phase 2: everything else.
router.post("/datex/plan", requireIngestToken, ndjson, async (req: Authed, res) => {
  try {
    const o = readOptions(req);
    if ("error" in o) { res.status(400).json({ error: o.error }); return; }
    let calls: DatexCall[];
    try { calls = readCalls(req); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }
    const state = await currentState() as KitState;
    const plan = planCalls(state, calls, o.asOf, o.mode, o.sales);
    res.json({ ...plan, version: PLAN_BUILD_VERSION, asOf: o.asOf, mode: o.mode, received: callsSummary(calls), properties: state.deals?.length ?? 0 });
  } catch (err) {
    req.log.error({ err }, "datex plan failed");
    res.status(500).json({ error: "Couldn't build the Datex plan" });
  }
});

// POST /api/datex/build[?dryRun=1] — build the delta payload from the raw Datex rows (the
// kit's build step, run here) and merge it exactly like POST /datex/ingest. With dryRun
// nothing is written; the reply says what would change and which rows would be rejected.
router.post("/datex/build", requireIngestToken, ndjson, async (req: Authed, res) => {
  try {
    const o = readOptions(req);
    if ("error" in o) { res.status(400).json({ error: o.error }); return; }
    let calls: DatexCall[];
    try { calls = readCalls(req); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }
    if (!calls.length) { res.status(400).json({ error: "No Datex calls received — send calls.jsonl as the body." }); return; }
    const finPeriod = opt(req, "finPeriod");
    if (finPeriod && !/^\d{6}$/.test(finPeriod)) { res.status(400).json({ error: "finPeriod must be YYYYMM" }); return; }
    const dryRun = truthy(opt(req, "dryRun"));
    const state = await currentState() as KitState;
    const { payload, report } = buildPayload(state, calls, o.asOf, finPeriod || null, truthy(opt(req, "force")));
    const base = { version: PLAN_BUILD_VERSION, asOf: o.asOf, received: callsSummary(calls), report, propertiesWithChanges: payload.deals.length,
      ...(truthy(opt(req, "includePayload")) ? { payload } : {}) };
    if (!payload.deals.length) { res.json({ ...base, ok: true, dryRun, ingest: null, note: "Nothing to send — the calls covered no mapped property." }); return; }
    const r = await ingestPayload(payload, dryRun, req.ingestToken!.label, req.log);
    res.status(r.status).json({ ...base, ...(r.status === 200 ? { ok: true, dryRun } : {}), ingest: r.body });
  } catch (err) {
    req.log.error({ err }, "datex build failed");
    res.status(500).json({ error: "Couldn't build the Datex payload" });
  }
});

// GET /api/datex/job-kit — the Python helper the scheduled task runs (stdlib only). The task
// starts in a fresh session with no files, so it downloads this with the same token.
router.get("/datex/job-kit", requireIngestToken, async (req, res) => {
  const here = typeof __dirname === "string" ? __dirname : process.cwd();
  for (const p of [path.join(here, "docs", "job_kit.py"), path.resolve(process.cwd(), "dist/docs/job_kit.py"), path.resolve(process.cwd(), "../../tools/datex-job-kit/job_kit.py"), path.resolve(process.cwd(), "tools/datex-job-kit/job_kit.py")]) {
    try {
      const text = await readFile(p, "utf8");
      res.type("text/plain; charset=utf-8").set("Cache-Control", "no-store").set("Content-Disposition", 'inline; filename="job_kit.py"').send(text);
      return;
    } catch { /* next location */ }
  }
  req.log.error("job_kit.py missing from this build");
  res.status(404).type("text/plain").send("job_kit.py is missing from this build.");
});

export default router;
