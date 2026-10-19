import { Router, type Request, type Response, type NextFunction } from "express";
import { db, dealsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { isDocOwner } from "../lib/docPrivacy";
import { isDismissed, CATEGORY_LABEL, type LocalIntelRecord } from "../lib/localIntel";
import { loadLocalIntel, loadAllLocalIntel, scanLocalIntel, setDismissed, runLocalIntelTick, localIntelPending } from "../lib/localIntelScan";

// Local Intel routes (Eric, 10/19/26). Reads = any member. Triggering a scan or dismissing a
// finding = admins / the owner only (a scan spends API credits).
const router = Router();

const canAct = (req: Request) => !!req.session.isAdmin || isDocOwner({ userId: req.session.userId, email: req.session.userEmail });
function requireAdminOrOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.session.authenticated) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!canAct(req)) { res.status(403).json({ error: "Only admins can run or edit Local Intel" }); return; }
  next();
}
/** What the page gets: each finding marked dismissed or not (dismissed ones stay listable, never deleted). */
const present = (rec: LocalIntelRecord | null, req: Request) => ({
  record: rec ? { ...rec, findings: rec.findings.map(f => ({ ...f, dismissed: isDismissed(f, rec.dismissed) })) } : null,
  canScan: canAct(req),
  configured: !!process.env.ANTHROPIC_API_KEY,
});

router.get("/deals/:id/local-intel", requireAuth, async (req, res) => {
  res.json(present(await loadLocalIntel(String(req.params.id)), req));
});

// Manual Refresh: runs now (about a minute or two) and returns the result.
router.post("/deals/:id/local-intel/scan", requireAdminOrOwner, async (req, res) => {
  try {
    const rec = await scanLocalIntel(String(req.params.id), { trigger: "manual", by: req.session.userEmail ?? null });
    res.json(present(rec, req));
  } catch (err) {
    req.log.warn({ err }, "local intel scan failed");
    res.status(502).json({ error: err instanceof Error ? err.message : "Scan failed" });
  }
});

router.post("/deals/:id/local-intel/dismiss", requireAdminOrOwner, async (req, res) => {
  const b = (req.body ?? {}) as { findingId?: unknown; dismissed?: unknown };
  if (typeof b.findingId !== "string" || !b.findingId) { res.status(400).json({ error: "findingId required" }); return; }
  const rec = await setDismissed(String(req.params.id), b.findingId, b.dismissed !== false, req.session.userEmail ?? null);
  if (!rec) { res.status(404).json({ error: "No Local Intel scan for this deal yet" }); return; }
  res.json(present(rec, req));
});

// NEW high-severity negatives from the latest scan of each Owned deal (Asset Mgmt, Credit Watch, This week).
router.get("/local-intel/alerts", requireAuth, async (_req, res) => {
  const recs = (await loadAllLocalIntel()).filter(r => r.newHighIds?.length && r.scannedAt && Date.now() - Date.parse(r.scannedAt) < 45 * 86_400_000);
  if (!recs.length) { res.json({ alerts: [] }); return; }
  const rows = await db.select({ id: dealsTable.id, data: dealsTable.data }).from(dealsTable).where(inArray(dealsTable.id, recs.map(r => r.dealId)));
  const deals = new Map(rows.map(r => [r.id, r.data as Record<string, unknown>]));
  const alerts = recs.flatMap(r => {
    const d = deals.get(r.dealId);
    if (!d || d.trashedAt || d.status !== "Owned") return [];
    return r.findings.filter(f => r.newHighIds.includes(f.id) && !isDismissed(f, r.dismissed)).map(f => ({
      dealId: r.dealId, property: String(d.propertyName ?? "Property"), scannedAt: r.scannedAt,
      id: f.id, category: CATEGORY_LABEL[f.category], headline: f.headline, whyItMatters: f.whyItMatters,
      distanceMiles: f.distanceMiles, date: f.date, source: f.sources[0] ?? null,
    }));
  });
  res.json({ alerts });
});

router.get("/local-intel/status", requireAuth, async (_req, res) => {
  res.json({ pending: await localIntelPending(), configured: !!process.env.ANTHROPIC_API_KEY });
});
// One bounded slice of queued background scans (the open app calls this; see useLocalIntelTick).
router.post("/local-intel/tick", requireAuth, async (req, res) => {
  try { res.json(await runLocalIntelTick()); }
  catch (err) { req.log.warn({ err }, "local intel tick failed"); res.status(500).json({ error: err instanceof Error ? err.message : "tick failed" }); }
});

export default router;
