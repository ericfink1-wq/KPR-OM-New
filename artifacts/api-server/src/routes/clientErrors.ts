import { Router } from "express";
import { db } from "@workspace/db";
import { clientErrorsTable } from "@workspace/db";

const router = Router();

router.post("/client-errors", async (req, res) => {
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
