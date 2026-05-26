import { Router } from "express";
import { db } from "@workspace/db";
import { dealsTable, dealImagesTable, dealSourcesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

function requireAuth(req: Parameters<Router>[0], res: Parameters<Router>[1], next: Parameters<Router>[2]) {
  if (!req.session.authenticated) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

// GET /api/deals — list all deals
router.get("/deals", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(dealsTable).orderBy(dealsTable.createdAt);
    const deals = rows.map(r => ({ ...(r.data as Record<string, unknown>), id: r.id }));
    res.json(deals);
  } catch (err) {
    req.log.error({ err }, "Failed to load deals");
    res.status(500).json({ error: "Failed to load deals" });
  }
});

// POST /api/deals — create a deal
router.post("/deals", requireAuth, async (req, res) => {
  try {
    const { id, ...rest } = req.body as Record<string, unknown>;
    if (!id || typeof id !== "string") {
      res.status(400).json({ error: "id is required" });
      return;
    }
    await db.insert(dealsTable).values({ id, data: rest });
    res.status(201).json({ ok: true, id });
  } catch (err) {
    req.log.error({ err }, "Failed to create deal");
    res.status(500).json({ error: "Failed to create deal" });
  }
});

// PUT /api/deals/:id — upsert a deal
router.put("/deals/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const { id: _bodyId, ...rest } = req.body as Record<string, unknown>;
    await db.insert(dealsTable)
      .values({ id, data: rest })
      .onConflictDoUpdate({ target: dealsTable.id, set: { data: rest, updatedAt: new Date() } });
    res.json({ ok: true, id });
  } catch (err) {
    req.log.error({ err }, "Failed to upsert deal");
    res.status(500).json({ error: "Failed to upsert deal" });
  }
});

// DELETE /api/deals/:id — delete a deal and its images/source
router.delete("/deals/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    await db.delete(dealImagesTable).where(eq(dealImagesTable.id, id));
    await db.delete(dealSourcesTable).where(eq(dealSourcesTable.id, id));
    await db.delete(dealsTable).where(eq(dealsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete deal");
    res.status(500).json({ error: "Failed to delete deal" });
  }
});

// GET /api/deals/:id/images
router.get("/deals/:id/images", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const rows = await db.select().from(dealImagesTable).where(eq(dealImagesTable.id, id));
    if (!rows.length) { res.json(null); return; }
    const r = rows[0];
    res.json({
      cover: r.cover ?? null,
      coverThumb: r.coverThumb ?? null,
      sitePlan: r.sitePlan ?? null,
      pagePicks: r.pagePicks ?? null,
      needsSitePlanPick: r.needsSitePlanPick ?? false,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load images");
    res.status(500).json({ error: "Failed to load images" });
  }
});

// PUT /api/deals/:id/images
router.put("/deals/:id/images", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const body = req.body as {
      cover?: string | null;
      coverThumb?: string | null;
      sitePlan?: string[] | null;
      pagePicks?: { page: number; img: string }[] | null;
      needsSitePlanPick?: boolean;
    };
    const { cover, coverThumb, sitePlan, pagePicks, needsSitePlanPick } = body;
    await db.insert(dealImagesTable)
      .values({ id, cover: cover ?? null, coverThumb: coverThumb ?? null, sitePlan: sitePlan ?? null, pagePicks: pagePicks ?? null, needsSitePlanPick: needsSitePlanPick ?? false })
      .onConflictDoUpdate({
        target: dealImagesTable.id,
        set: { cover: cover ?? null, coverThumb: coverThumb ?? null, sitePlan: sitePlan ?? null, pagePicks: pagePicks ?? null, needsSitePlanPick: needsSitePlanPick ?? false },
      });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save images");
    res.status(500).json({ error: "Failed to save images" });
  }
});

// GET /api/deals/:id/source
router.get("/deals/:id/source", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const rows = await db.select().from(dealSourcesTable).where(eq(dealSourcesTable.id, id));
    res.json({ text: rows[0]?.sourceText ?? null });
  } catch (err) {
    req.log.error({ err }, "Failed to load source");
    res.status(500).json({ error: "Failed to load source" });
  }
});

// PUT /api/deals/:id/source
router.put("/deals/:id/source", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const { text } = req.body as { text?: string };
    await db.insert(dealSourcesTable)
      .values({ id, sourceText: text ?? null })
      .onConflictDoUpdate({ target: dealSourcesTable.id, set: { sourceText: text ?? null } });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save source");
    res.status(500).json({ error: "Failed to save source" });
  }
});

export default router;
