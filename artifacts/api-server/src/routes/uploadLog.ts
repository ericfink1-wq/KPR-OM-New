import { Router } from "express";
import { sql, desc, asc, eq } from "drizzle-orm";
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

// The dominant uploader across the whole log — used to RETROACTIVELY attribute
// deals that have no upload record of their own (older JSON imports, or uploads
// from before logging existed). Cached briefly; recomputed from the log so it
// tracks whoever actually does the uploading (no hard-coded name).
let primaryCache: { userName: string | null; userEmail: string | null } | null = null;
let primaryAt = 0;
async function getPrimaryUploader(): Promise<{ userName: string | null; userEmail: string | null } | null> {
  if (primaryCache && Date.now() - primaryAt < 300_000) return primaryCache;
  try {
    await ensureUploadLogTable();
    const rows = await db.select().from(uploadLogTable);
    const counts = new Map<string, { n: number; userName: string | null; userEmail: string | null }>();
    for (const r of rows) {
      if (r.status !== "success") continue;
      const key = (r.userEmail || r.userName || "").toLowerCase();
      if (!key) continue;
      const c = counts.get(key) || { n: 0, userName: r.userName ?? null, userEmail: r.userEmail ?? null };
      c.n++; counts.set(key, c);
    }
    let best: { n: number; userName: string | null; userEmail: string | null } | null = null;
    for (const c of counts.values()) if (!best || c.n > best.n) best = { n: c.n, userName: c.userName, userEmail: c.userEmail };
    primaryCache = best ? { userName: best.userName, userEmail: best.userEmail } : null;
    primaryAt = Date.now();
    return primaryCache;
  } catch { return null; }
}

// GET /api/upload-log/by-deal/:dealId — WHO uploaded this deal. Uses the deal's own
// earliest successful upload record when it has one; otherwise falls back to the
// library's primary uploader (marked `inferred`) so EXISTING deals with no record
// still show attribution. Any signed-in user can see it (team attribution, not the
// full admin audit). Null only when the log is empty (no basis to attribute).
router.get("/upload-log/by-deal/:dealId", requireAuth, async (req, res) => {
  try {
    await ensureUploadLogTable();
    const dealId = String(req.params.dealId);
    const rows = await db.select().from(uploadLogTable)
      .where(eq(uploadLogTable.dealId, dealId))
      .orderBy(asc(uploadLogTable.createdAt));
    const r = rows.find(x => x.status === "success") ?? null;
    if (r) { res.json({ userName: r.userName ?? null, userEmail: r.userEmail ?? null, at: r.createdAt, inferred: false }); return; }
    const primary = await getPrimaryUploader();
    res.json(primary ? { userName: primary.userName, userEmail: primary.userEmail, at: null, inferred: true } : null);
  } catch (err) {
    req.log.error({ err }, "upload-log by-deal lookup failed");
    res.json(null);
  }
});

// GET /api/upload-log — recent upload activity (admin only), newest first.
router.get("/upload-log", requireAdmin, async (_req, res) => {
  await ensureUploadLogTable();
  const rows = await db.select().from(uploadLogTable).orderBy(desc(uploadLogTable.createdAt)).limit(300);
  res.json(rows);
});

export default router;
