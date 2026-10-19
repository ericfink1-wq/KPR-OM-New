import { Router } from "express";
import { db, dealsTable, dealImagesTable, dealSourcesTable, tenantIndexTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runBackgroundExtraction } from "../lib/extract";
import { isTombstoned, tombstoneDeal, GONE_BODY } from "../lib/dealTombstone";

import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";

const router = Router();

// OM ingestion is the heaviest token spender (full extraction); cap it per user so
// a bulk drag-drop of many files can't fan out into an unbounded Anthropic bill.
const ingestLimit = rateLimit({ bucket: "ingest", perMinute: 12, perHour: 120 });

// POST /api/deals/ingest
// Immediately creates a "processing" deal row and returns the id.
// The actual Claude extraction runs in the background.
router.post("/deals/ingest", requireAuth, ingestLimit, async (req, res) => {
  const { id, text, fileName, pageCount, correctionsNote } = req.body as {
    id?: string;
    text?: string;
    fileName?: string;
    pageCount?: number;
    correctionsNote?: string;
  };

  if (!id || typeof id !== "string") {
    res.status(400).json({ error: "id is required" });
    return;
  }
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "text is required" });
    return;
  }

  const processingData: Record<string, unknown> = {
    _processing: true,
    fileName: fileName || "Unknown",
    uploadedAt: new Date().toISOString(),
    status: "Prospect",
    pdfPages: pageCount || 0,
    _ingestBy: req.session.userId ?? null,
  };

  try {
    // A deleted id is never re-created — not even by a retried upload of the same file.
    if (await isTombstoned(id)) { res.status(410).json(GONE_BODY); return; }
    await db.insert(dealsTable)
      .values({ id, data: processingData })
      .onConflictDoUpdate({ target: dealsTable.id, set: { data: processingData, updatedAt: new Date() } });

    // Return immediately — don't await extraction
    res.json({ id });

    // Fire background extraction after response is sent
    setImmediate(() => {
      runBackgroundExtraction(id, text, fileName || "Unknown", pageCount || 0, req.log, correctionsNote || "", req.session.userId ?? null).catch(() => {});
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create processing deal");
    res.status(500).json({ error: "Failed to start extraction" });
  }
});

// GET /api/deals/:id/status
// Returns { processing: true } while Claude is working,
// { processing: false, deal: {...} } when done,
// { processing: false, error: "..." } on failure.
router.get("/deals/:id/status", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  try {
    const rows = await db.select().from(dealsTable).where(eq(dealsTable.id, id));
    if (!rows.length) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const data = rows[0].data;
    if (data._processing) {
      res.json({ processing: true });
      return;
    }
    if (data._processingError) {
      res.json({ processing: false, error: data._processingError });
      return;
    }
    // Strip internal keys before returning (incl. the uploader marker, so a save drops it = claimed)
    const { _processing: _p, _processingError: _e, _ingestBy: _b, ...rest } = data;
    res.json({ processing: false, deal: { ...rest, id } });
  } catch (err) {
    req.log.error({ err }, "Failed to poll deal status");
    res.status(500).json({ error: "Failed to poll status" });
  }
});

// POST /api/deals/:id/discard-ingest — the uploader throws away THEIR OWN upload that was
// never kept: skipped, discarded, or turned away as "Not an OM — not added" (Eric,
// 10/19/26). DELETE /deals/:id is admin-only, so a member's turned-away upload used to
// stay in the library as a junk deal. Refuses (409) unless the row still carries
// `_ingestBy` equal to this session's user — i.e. an upload no client has saved yet (a
// save replaces the data and drops the marker) — created in the last 24 hours.
router.post("/deals/:id/discard-ingest", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  try {
    const row = (await db.select().from(dealsTable).where(eq(dealsTable.id, id)))[0];
    if (!row) { res.json({ ok: true, gone: true }); return; }
    const data = (row.data ?? {}) as Record<string, unknown>;
    const fresh = Date.now() - new Date(row.createdAt).getTime() < 24 * 3600 * 1000;
    if (!data._ingestBy || data._ingestBy !== req.session.userId || !fresh) {
      res.status(409).json({ error: "Only an upload of yours that was never saved can be discarded this way." });
      return;
    }
    await db.delete(dealImagesTable).where(eq(dealImagesTable.id, id));
    await db.delete(dealSourcesTable).where(eq(dealSourcesTable.id, id));
    await db.delete(tenantIndexTable).where(eq(tenantIndexTable.dealId, id));
    await db.delete(dealsTable).where(eq(dealsTable.id, id));
    // The uploading tab may still hold this record (deferred image / analysis saves) — keep it gone.
    await tombstoneDeal(id, req.session.userEmail ?? null, "discarded upload");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "discard-ingest failed");
    res.status(500).json({ error: "Failed to discard" });
  }
});

export default router;
