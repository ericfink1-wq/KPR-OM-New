import { Router } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db, dealsTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middleware/auth";
import {
  listRecords, upsertRecord, deleteRecord, planImport, sanitizeFor, validateRecord, recordId,
  listDatexMap, saveDatexMapRow, cleanBldgIds, loadDatexMapFromDb, headlineNamesBrand, ENTRY_KINDS, type EntryKind, type AmKind, type OwnedDealRef,
} from "../lib/assetMgmt";
import { fetchBrandNews, assessNews, brandNorm } from "../lib/watchlistNews";
import { callAnthropicOnce } from "../lib/extract";
import { proposeCovenants } from "../lib/covenants";
import { listIngestTokens, createIngestToken, revokeIngestToken, listIngestLogs, getAutoRefreshSetting, setAutoRefreshEnabled, listIngestAudit } from "../lib/datexAutoRefresh";

// ASSET MANAGEMENT — owned properties only. Reads for any signed-in member; every write is
// admin-only (Eric: "admin-only edit controls"). Records carry a per-row source note.
const router = Router();

async function ownedDeals(): Promise<OwnedDealRef[]> {
  const rows = await db.select().from(dealsTable);
  const map = await loadDatexMapFromDb();
  const bldg = new Map(map.mappings.map(m => [m.dealId, m.bldgIds.map(b => b.toLowerCase())]));
  return rows.map(r => ({ id: r.id, d: r.data as Record<string, unknown> }))
    .filter(x => x.d.status === "Owned" && !x.d.trashedAt)
    .map(x => ({ id: x.id, name: String(x.d.propertyName ?? ""), bldgIds: bldg.get(x.id) ?? [] }));
}

router.get("/am/records", requireAuth, async (req, res) => {
  try { res.json({ records: await listRecords([...ENTRY_KINDS]) }); }
  catch (err) { req.log.error({ err }, "am records list failed"); res.status(500).json({ error: "Couldn't load asset-management records" }); }
});

router.post("/am/records", requireAdmin, async (req, res) => {
  try {
    const b = (req.body ?? {}) as { id?: string; kind?: string; dealId?: string; data?: Record<string, unknown>; sourceNote?: string };
    const kind = b.kind as EntryKind;
    if (!ENTRY_KINDS.includes(kind)) { res.status(400).json({ error: "kind must be loan, swap, date or pref" }); return; }
    const owned = await ownedDeals();
    if (!b.dealId || !owned.some(d => d.id === b.dealId)) { res.status(400).json({ error: "pick an owned property" }); return; }
    const data = sanitizeFor(kind, b.data ?? {});
    const bad = validateRecord(kind, data);
    if (bad) { res.status(400).json({ error: bad }); return; }
    const id = (b.id && String(b.id).slice(0, 120)) || recordId(kind, b.dealId, data);
    await upsertRecord(id, kind, b.dealId, data, b.sourceNote ? String(b.sourceNote).slice(0, 300) : null, req.session.userEmail || "admin");
    res.json({ ok: true, id, data });
  } catch (err) { req.log.error({ err }, "am record save failed"); res.status(500).json({ error: "Couldn't save the record" }); }
});

router.delete("/am/records/:id", requireAdmin, async (req, res) => {
  try { res.json({ ok: await deleteRecord(String(req.params.id)) }); }
  catch (err) { req.log.error({ err }, "am record delete failed"); res.status(500).json({ error: "Couldn't delete the record" }); }
});

// Paste JSON or CSV. DRY RUN by default — shows what would be created/updated/rejected.
router.post("/am/records/import", requireAdmin, async (req, res) => {
  try {
    const text = String((req.body ?? {}).text ?? "").slice(0, 2_000_000);
    const recs = await listRecords([...ENTRY_KINDS]);
    const plan = planImport(text, await ownedDeals(), new Set(recs.map(r => r.id)), recs);
    if (plan.problem) { res.status(400).json({ error: plan.problem }); return; }
    if ((req.body ?? {}).apply === true) {
      for (const r of plan.rows) await upsertRecord(r.id, r.kind as AmKind, r.dealId, r.data, r.sourceNote, req.session.userEmail || "admin");
    }
    res.json({ ok: true, applied: (req.body ?? {}).apply === true, rows: plan.rows, rejected: plan.rejected });
  } catch (err) { req.log.error({ err }, "am import failed"); res.status(500).json({ error: "Import failed" }); }
});

router.get("/am/datex-map", requireAuth, async (req, res) => {
  try { res.json({ rows: await listDatexMap() }); }
  catch (err) { req.log.error({ err }, "datex map list failed"); res.status(500).json({ error: "Couldn't load the Datex map" }); }
});
router.put("/am/datex-map/:dealId", requireAdmin, async (req, res) => {
  try {
    const dealId = String(req.params.dealId);
    const owned = await ownedDeals();
    const deal = owned.find(d => d.id === dealId);
    if (!deal) { res.status(400).json({ error: "only owned deals can be mapped to Datex" }); return; }
    const ids = cleanBldgIds((req.body ?? {}).bldgIds ?? []);
    if (!ids) { res.status(400).json({ error: "building ids are short codes like keene or rockcom" }); return; }
    const clash = (await listDatexMap()).find(r => r.dealId !== dealId && r.bldgIds.some(b => ids.includes(b)));
    if (clash) { res.status(400).json({ error: `${clash.bldgIds.find(b => ids.includes(b))} is already mapped to ${clash.propertyName}` }); return; }
    const note = (req.body ?? {}).note != null ? String((req.body ?? {}).note).slice(0, 500) : null;
    await saveDatexMapRow(dealId, deal.name, ids, note, req.session.userEmail || "admin");
    res.json({ ok: true });
  } catch (err) { req.log.error({ err }, "datex map save failed"); res.status(500).json({ error: "Couldn't save the mapping" }); }
});

// Covenant detection: KPR's seed list + a parser over each loan's covenant text. DRY RUN by
// default; {apply:true, ids?:[…]} saves the chosen proposals (all when ids is omitted).
router.post("/am/covenants/detect", requireAdmin, async (req, res) => {
  try {
    const owned = await ownedDeals();
    const { proposals, notes } = proposeCovenants(await listRecords([...ENTRY_KINDS]), new Set(owned.map(d => d.id)));
    const name = new Map(owned.map(d => [d.id, d.name]));
    const rows = proposals.map(p => ({ ...p, property: name.get(p.dealId) ?? p.dealId }));
    if ((req.body ?? {}).apply === true) {
      const want = Array.isArray(req.body.ids) ? new Set((req.body.ids as unknown[]).map(String)) : null;
      let saved = 0;
      for (const p of proposals) if (!want || want.has(p.id)) { await upsertRecord(p.id, "covenant", p.dealId, p.data, p.sourceNote, req.session.userEmail || "admin"); saved++; }
      res.json({ ok: true, applied: true, saved, rows, notes }); return;
    }
    res.json({ ok: true, applied: false, rows, notes });
  } catch (err) { req.log.error({ err }, "covenant detect failed"); res.status(500).json({ error: "Couldn't detect covenants" }); }
});

// QUARTERLY COMMENT DRAFT — one AI call, only when someone clicks the button. The client sends
// the facts it already computed and shows (Datex occupancy change, leasing, NOI vs budget,
// debt); the model only writes them up, in KPR's investor-letter voice. Nothing is stored.
router.post("/am/quarterly-comment", requireAuth, async (req, res) => {
  try {
    const b = (req.body ?? {}) as { dealId?: string; facts?: unknown; quarter?: string };
    const owned = await ownedDeals();
    const deal = owned.find(d => d.id === b.dealId);
    if (!deal) { res.status(400).json({ error: "Quarterly comments are for owned properties only." }); return; }
    const facts = JSON.stringify(b.facts ?? {}).slice(0, 12_000);
    if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: "AI is not configured" }); return; }
    const prompt = `You write the property paragraph of KPR Centers' quarterly investor letter (KPR owns and operates grocery-anchored and open-air retail centers). Write ONE paragraph of 4-6 sentences for ${deal.name}${b.quarter ? ` for ${b.quarter}` : ""}.

Rules:
- Use ONLY the facts below. Never invent a number, tenant, date or event. If a fact is missing, leave the topic out — do not mention that it is missing.
- Cover, in this order where the facts exist: occupancy and its change; leasing (name tenants; the Datex leasing pipeline rows are APPLICATIONS in negotiation — describe them as "in lease negotiations" or "applications", never as signed or executed leases unless an executed date is given); NOI versus budget year to date; debt (balance, rate/hedge, maturity) only if notable.
- Investor-letter voice: confident, plain, factual, third person ("the property", "we"). No bullet points, no headings, no markdown.
- Round money to $0.1M (or $K under $1M), percentages to one decimal.
- Never mention a pending sale, a marketing process or anything about selling the property.

FACTS (JSON):
${facts}`;
    const r = await callAnthropicOnce({ model: "claude-sonnet-4-6", max_tokens: 600, messages: [{ role: "user", content: prompt }] });
    const j = await r.json() as { content?: Array<{ type: string; text?: string }>; error?: { message?: string } };
    if (!r.ok) { res.status(502).json({ error: j.error?.message ?? "AI call failed" }); return; }
    res.json({ draft: (j.content ?? []).find(x => x.type === "text")?.text?.trim() ?? "" });
  } catch (err) { req.log.error({ err }, "quarterly comment failed"); res.status(500).json({ error: "Couldn't draft the comment" }); }
});

// ── Credit watch news: free Google News RSS, headline keyword match, NO AI. The client sends
//    its top brands by owned rent (≤60, brand grouping is client-side); anything not scanned
//    in 24 h is re-scanned inside this request's time budget, the rest on the next call. ──
const NEWS_TTL_MS = 24 * 3_600_000;
router.post("/am/credit-news", requireAuth, async (req, res) => {
  try {
    const brands = [...new Set(((req.body ?? {}).brands as unknown[] ?? []).map(b => String(b ?? "").trim()).filter(b => b.length >= 3))].slice(0, 60);
    const stored = new Map((await listRecords(["news"])).map(r => [r.id, r]));
    const deadline = Date.now() + 12_000;
    const stale = brands.filter(b => { const r = stored.get(`news:${brandNorm(b)}`); return !r || Date.now() - Date.parse(String(r.data.scannedAt ?? 0)) > NEWS_TTL_MS; });
    let scanned = 0;
    for (let i = 0; i < stale.length && Date.now() < deadline; i += 4) {
      await Promise.all(stale.slice(i, i + 4).map(async brand => {
        try {
          // Only headlines that actually name the brand — a generic "grocery store closures" story
          // returned for "Fred Meyer" must not read as a Fred Meyer closure.
          const articles = (await fetchBrandNews(brand, 6_000)).filter(a => headlineNamesBrand(a.title, brand));
          const sig = assessNews(articles, "none");
          const data = { brand, level: sig?.suggestedStatus ?? null, headline: sig?.headline ?? null, url: sig?.url ?? null, at: sig?.at ?? null,
            recent: articles.slice(0, 5).map(a => ({ title: a.title, url: a.link, at: a.publishedAt, source: a.source })), scannedAt: new Date().toISOString() };
          await upsertRecord(`news:${brandNorm(brand)}`, "news", null, data, "Google News RSS (headline keyword match)", "credit-news");
          stored.set(`news:${brandNorm(brand)}`, { id: `news:${brandNorm(brand)}`, kind: "news", dealId: null, data, sourceNote: null, updatedBy: null, updatedAt: data.scannedAt });
          scanned++;
        } catch { /* soft-fail: an RSS hiccup must never read as "all clear" — the brand stays unscanned */ }
      }));
    }
    const signals = brands.map(b => stored.get(`news:${brandNorm(b)}`)?.data ?? { brand: b, level: null, scannedAt: null });
    res.json({ signals, scanned, remaining: Math.max(0, stale.length - scanned) });
  } catch (err) { req.log.error({ err }, "credit news failed"); res.status(500).json({ error: "Couldn't check the news" }); }
});

// One AI call, ONLY when a user clicks "Summarize" for a brand. Reads the stored headlines.
router.post("/am/credit-news/summarize", requireAuth, async (req, res) => {
  try {
    const brand = String((req.body ?? {}).brand ?? "").trim();
    const rec = (await listRecords(["news"])).find(r => r.id === `news:${brandNorm(brand)}`);
    const recent = (rec?.data.recent as Array<{ title: string; at: string | null; source: string }> | undefined) ?? [];
    if (!recent.length) { res.status(400).json({ error: "No stored headlines for that brand yet." }); return; }
    if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: "AI is not configured" }); return; }
    const prompt = `You are a retail credit analyst for a shopping-center landlord. In 2-3 plain sentences, say what these recent headlines mean for "${brand}" as a tenant (bankruptcy, store closures, downgrades, or nothing material). Only use what the headlines say; if they are routine, say so.\n\n${recent.map(a => `- ${a.title} (${a.source || "?"}, ${a.at?.slice(0, 10) ?? "undated"})`).join("\n")}`;
    const r = await callAnthropicOnce({ model: "claude-haiku-4-5-20251001", max_tokens: 300, messages: [{ role: "user", content: prompt }] });
    const j = await r.json() as { content?: Array<{ type: string; text?: string }>; error?: { message?: string } };
    if (!r.ok) { res.status(502).json({ error: j.error?.message ?? "AI call failed" }); return; }
    res.json({ summary: (j.content ?? []).find(b => b.type === "text")?.text?.trim() ?? "", headlines: recent.length });
  } catch (err) { req.log.error({ err }, "credit news summarize failed"); res.status(500).json({ error: "Couldn't summarize" }); }
});

// Read-only operating docs for admins (Eric reads them in a browser — chat code blocks don't
// render for him). Whitelisted names only; the file ships in dist/docs via build.mjs.
const SERVED_DOCS: Record<string, string> = { "datex-refresh": "datex-refresh.md", "datex-snapshot-example": "datex-snapshot-example.json" };
router.get("/admin/docs/:name", requireAdmin, async (req, res) => {
  const file = SERVED_DOCS[String(req.params.name)];
  if (!file) { res.status(404).type("text/plain").send("Unknown doc. Available: " + Object.keys(SERVED_DOCS).join(", ")); return; }
  const here = typeof __dirname === "string" ? __dirname : process.cwd();
  for (const p of [path.join(here, "docs", file), path.resolve(process.cwd(), "dist/docs", file), path.resolve(process.cwd(), "../../docs", file), path.resolve(process.cwd(), "docs", file)]) {
    try { const text = await readFile(p, "utf8"); res.type("text/plain; charset=utf-8").set("Cache-Control", "no-store").send(text); return; }
    catch { /* try the next location */ }
  }
  res.status(404).type("text/plain").send(`${file} is missing from this build.`);
});

// ── Datex auto-refresh: scoped ingest tokens (admin) + status (members) ──
router.get("/am/datex-auto/tokens", requireAdmin, async (req, res) => {
  try { res.json({ tokens: await listIngestTokens() }); }
  catch (err) { req.log.error({ err }, "ingest tokens list failed"); res.status(500).json({ error: "Couldn't load tokens" }); }
});
router.post("/am/datex-auto/tokens", requireAdmin, async (req, res) => {
  try {
    const r = await createIngestToken(String(req.body?.label ?? ""), { email: req.session.userEmail || "admin", userId: req.session.userId ?? null });
    if ("problem" in r) { res.status(400).json({ error: r.problem }); return; }
    res.json(r);
  } catch (err) { req.log.error({ err }, "ingest token create failed"); res.status(500).json({ error: "Couldn't create the token" }); }
});
router.post("/am/datex-auto/tokens/:id/revoke", requireAdmin, async (req, res) => {
  try { const ok = await revokeIngestToken(String(req.params.id), req.session.userEmail || "admin"); res.status(ok ? 200 : 404).json({ ok }); }
  catch (err) { req.log.error({ err }, "ingest token revoke failed"); res.status(500).json({ error: "Couldn't revoke the token" }); }
});
router.put("/am/datex-auto/settings", requireAdmin, async (req, res) => {
  try {
    if (typeof req.body?.enabled !== "boolean") { res.status(400).json({ error: "enabled must be true or false" }); return; }
    res.json({ setting: await setAutoRefreshEnabled(req.body.enabled, req.session.userEmail || "admin") });
  } catch (err) { req.log.error({ err }, "ingest setting failed"); res.status(500).json({ error: "Couldn't save the setting" }); }
});
router.get("/am/datex-auto/status", requireAuth, async (req, res) => {
  try {
    const logs = await listIngestLogs(20);
    res.json({ last: logs.find(l => !l.dryRun) ?? null, lastDryRun: logs.find(l => l.dryRun) ?? null, recent: logs, setting: await getAutoRefreshSetting(),
      shortLived: req.session.isAdmin ? await listIngestAudit(10) : undefined });
  } catch (err) { req.log.error({ err }, "ingest status failed"); res.status(500).json({ error: "Couldn't load the auto-refresh status" }); }
});

export default router;
