import { Router } from "express";
import { db, dealsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runBackgroundExtraction } from "../lib/extract";

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
  };

  try {
    await db.insert(dealsTable)
      .values({ id, data: processingData })
      .onConflictDoUpdate({ target: dealsTable.id, set: { data: processingData, updatedAt: new Date() } });

    // Return immediately — don't await extraction
    res.json({ id });

    // Fire background extraction after response is sent
    setImmediate(() => {
      runBackgroundExtraction(id, text, fileName || "Unknown", pageCount || 0, req.log, correctionsNote || "").catch(() => {});
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
    // Strip internal keys before returning
    const { _processing: _p, _processingError: _e, ...rest } = data;
    res.json({ processing: false, deal: { ...rest, id } });
  } catch (err) {
    req.log.error({ err }, "Failed to poll deal status");
    res.status(500).json({ error: "Failed to poll status" });
  }
});

export default router;
