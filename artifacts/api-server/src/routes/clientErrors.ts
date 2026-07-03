import { Router } from "express";
import { db } from "@workspace/db";
import { clientErrorsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";

const router = Router();

// The error reporter is intentionally UNAUTHENTICATED (a crash can happen before
// login), so throttle it to stop anyone spamming the endpoint to bloat the table.
// rateLimit keys by session when present, else by IP — which is what we want here.
const errLimit = rateLimit({ bucket: "client-errors", perMinute: 5, perHour: 60 });

// GET /api/client-errors/recent — admin: the latest logged client errors, so we
// can see the actual crash message/stack. Temporary diagnostic.
router.get("/client-errors/recent", requireAdmin, async (_req, res) => {
  try {
    const rows = await db.select().from(clientErrorsTable).orderBy(desc(clientErrorsTable.id)).limit(15);
    res.json(rows.map(r => ({ id: r.id, message: r.message, route: r.route, stack: (r.stack || "").slice(0, 1500), createdAt: (r as { createdAt?: unknown }).createdAt })));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "failed" });
  }
});

router.post("/client-errors", errLimit, async (req, res) => {
  try {
    const body = req.body as {
      message?: unknown;
      stack?: unknown;
      route?: unknown;
      userAgent?: unknown;
    };
    await db.insert(clientErrorsTable).values({
      message: String(body.message ?? "unknown").slice(0, 2000),
      stack: body.stack ? String(body.stack).slice(0, 8000) : null,
      route: body.route ? String(body.route).slice(0, 500) : null,
      userAgent: body.userAgent ? String(body.userAgent).slice(0, 500) : null,
    });
  } catch {
    // swallow — never let the error reporter throw
  }
  res.json({ ok: true });
});

export default router;
