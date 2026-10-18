import { Router } from "express";
import { db, dealsTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middleware/auth";
import {
  listRecords, upsertRecord, deleteRecord, planImport, sanitizeFor, validateRecord, recordId,
  listDatexMap, saveDatexMapRow, cleanBldgIds, loadDatexMapFromDb, headlineNamesBrand, type AmKind, type OwnedDealRef,
} from "../lib/assetMgmt";
import { fetchBrandNews, assessNews, brandNorm } from "../lib/watchlistNews";
import { callAnthropicOnce } from "../lib/extract";

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
  try { res.json({ records: await listRecords(["loan", "swap", "date"]) }); }
  catch (err) { req.log.error({ err }, "am records list failed"); res.status(500).json({ error: "Couldn't load asset-management records" }); }
});

router.post("/am/records", requireAdmin, async (req, res) => {
  try {
    const b = (req.body ?? {}) as { id?: string; kind?: string; dealId?: string; data?: Record<string, unknown>; sourceNote?: string };
    const kind = b.kind as Exclude<AmKind, "news">;
    if (!["loan", "swap", "date"].includes(kind)) { res.status(400).json({ error: "kind must be loan, swap or date" }); return; }
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
    const existing = new Set((await listRecords(["loan", "swap", "date"])).map(r => r.id));
    const plan = planImport(text, await ownedDeals(), existing);
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

export default router;
