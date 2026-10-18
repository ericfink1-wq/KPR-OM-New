import { Router, type Request, type Response, type NextFunction } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db, dealsTable } from "@workspace/db";
import { loadDatexMapFromDb, datexLoanToRecord, upsertRecord } from "../lib/assetMgmt";
import { DATEX_BLOCK_KEY, type DatexPayload } from "../lib/datexImport";
import { mergeDatexDeal, dealState, type SalesRow } from "../lib/datexIngest";
import { verifyIngestToken, loadSalesRows, saveSalesRows, writeIngestLog, type IngestLog } from "../lib/datexAutoRefresh";
import { updateDealSafely } from "../lib/dealWrite";
import { createSnapshot } from "./snapshots";

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
  if (!tok) { res.status(401).json({ error: "A valid Datex ingest token is required (Authorization: Bearer kpr_dx_…)." }); return; }
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

// GET /api/datex/state — per mapped owned deal, what is stored and as of when.
router.get("/datex/state", requireIngestToken, async (req, res) => {
  try {
    const deals = await ownedMapped(), sales = await loadSalesRows();
    res.json({
      generatedAt: new Date().toISOString(),
      rosterHashFormula: "sha256 of sorted lines 'tenantId|sf|annualRent|leaseExpiry' (numbers rounded to 2dp, blank when unknown; current + signed-not-open tenants only), joined by \\n — first 16 hex chars",
      deals: deals.map(d => dealState(d.dealId, String(d.data!.propertyName ?? d.propertyName ?? ""), d.bldgIds, (d.data![DATEX_BLOCK_KEY] as Record<string, unknown>) ?? null, sales.get(d.dealId) ?? [])),
    });
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
  const log: IngestLog = { at: new Date().toISOString(), dryRun, token: req.ingestToken!.label, asOf: null, blocks: {}, dealsChanged: 0, dealsUnchanged: 0, rejected: [], warnings: 0 };
  try {
    const payload = (req.body?.payload ?? req.body) as DatexPayload;
    const asOf = String(payload?.asOf ?? "").slice(0, 10);
    log.asOf = asOf || null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) { res.status(400).json({ error: "asOf must be an ISO date (YYYY-MM-DD)" }); return; }
    if (asOf > new Date().toISOString().slice(0, 10)) { res.status(400).json({ error: `asOf ${asOf} is in the future` }); return; }
    if (!Array.isArray(payload.deals) || !payload.deals.length) { res.status(400).json({ error: "payload contains no deals" }); return; }

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
    await writeIngestLog(log).catch(err => req.log.warn({ err }, "ingest log write failed"));
    req.log.info({ dryRun, changed: changing.length, rejected: log.rejected.length }, "Datex ingest");
    res.json({
      ok: true, dryRun, asOf,
      counts: { received: payload.deals.length, changed: changing.length, unchanged: plans.length - changing.length, skipped: skipped.length, rejected: log.rejected.length, datexLoans: loanSeeds.length },
      deals: plans.map(p => ({ dealId: p.dealId, propertyName: p.propertyName, blocksSent: p.sent, changed: p.changed, warnings: p.warnings })),
      skipped, rejected: log.rejected,
      note: dryRun ? "DRY RUN — nothing was written." : changing.length ? "Merged. Only the Datex live block changed; blocks not sent were kept." : "Nothing changed.",
    });
  } catch (err) {
    log.error = err instanceof Error ? err.message : "ingest failed";
    await writeIngestLog(log).catch(() => {});
    req.log.error({ err }, "Datex ingest failed");
    res.status(500).json({ error: log.error });
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
