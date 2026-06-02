import { Router } from "express";
import { sql, desc } from "drizzle-orm";
import { db, uploadLogTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middleware/auth";

const router = Router();

// Self-healing table provisioning (mirrors ensureUsersTable) so the log exists at
// runtime even before a drizzle push, and DEV matches PROD on publish.
let ready: Promise<void> | null = null;
export function ensureUploadLogTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS upload_log (
          id text PRIMARY KEY,
          file_name text,
          doc_type text,
          status text NOT NULL,
          detail text,
          deal_id text,
          user_id text,
          user_email text,
          user_name text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

// POST /api/upload-log — record one upload outcome. The WHO comes from the
// session (not the client) so it can't be spoofed. Best-effort: never blocks UI.
router.post("/upload-log", requireAuth, async (req, res) => {
  try {
    await ensureUploadLogTable();
    const b = (req.body ?? {}) as Record<string, unknown>;
    const trunc = (v: unknown, n: number) => (typeof v === "string" && v ? v.slice(0, n) : null);
    await db.insert(uploadLogTable).values({
      id: `ul_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      fileName: trunc(b.fileName, 400),
      docType: trunc(b.docType, 40),
      status: b.status === "failed" ? "failed" : "success",
      detail: trunc(b.detail, 1000),
      dealId: trunc(b.dealId, 80),
      userId: req.session.userId ?? null,
      userEmail: req.session.userEmail ?? null,
      userName: req.session.userName ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "upload-log insert failed");
    res.json({ ok: false }); // best-effort audit — never fail the upload flow
  }
});

// GET /api/upload-log — recent upload activity (admin only), newest first.
router.get("/upload-log", requireAdmin, async (_req, res) => {
  await ensureUploadLogTable();
  const rows = await db.select().from(uploadLogTable).orderBy(desc(uploadLogTable.createdAt)).limit(300);
  res.json(rows);
});

export default router;
