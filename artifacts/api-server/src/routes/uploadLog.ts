import { Router } from "express";
import { sql, desc, asc, eq, inArray } from "drizzle-orm";
import { db, uploadLogTable, usersTable, dealsTable } from "@workspace/db";
import { normalizeStatusIn, dealProvenance, resultOf, filterLog, type LogRow } from "../lib/uploadProvenance";
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
      // created / attached / skipped / rejected / failed (legacy clients: success / failed).
      status: normalizeStatusIn(b.status),
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
      if (r.status !== "success" && r.status !== "created" && r.status !== "attached") continue;
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

async function currentUserName(userId: string | null | undefined, email: string | null | undefined): Promise<string | null> {
  try {
    const u = userId
      ? (await db.select().from(usersTable).where(eq(usersTable.id, userId)))[0]
      : email ? (await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())))[0] : undefined;
    return u?.name ?? null;
  } catch { return null; }
}

// Every user's CURRENT name (a rename carries back to old rows), keyed by id and email.
async function nameLookup(): Promise<(r: LogRow) => string | null> {
  try {
    const users = await db.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name }).from(usersTable);
    const byId = new Map(users.map(u => [u.id, u.name ?? null]));
    const byEmail = new Map(users.map(u => [(u.email || "").toLowerCase(), u.name ?? null]));
    return (r: LogRow) => (r.userId ? byId.get(r.userId) : undefined) ?? (r.userEmail ? byEmail.get(r.userEmail.toLowerCase()) : undefined) ?? null;
  } catch { return () => null; }
}

// GET /api/upload-log/by-deal/:dealId — the deal's provenance: who CREATED it, who LAST
// uploaded to it, and its full Upload history (file, doc type, what it did, who, when).
// Any signed-in member can read it (team attribution, not the admin audit).
// Back-compat: the top-level userName / userEmail / at / inferred still describe the
// creator (older clients read those). When the creator predates upload tracking,
// `createdBy` is null and the old "library's primary uploader" guess rides along ONLY as
// `inferredCreator`, labelled as a guess — it is never shown as fact.
router.get("/upload-log/by-deal/:dealId", requireAuth, async (req, res) => {
  try {
    await ensureUploadLogTable();
    const dealId = String(req.params.dealId);
    const rows = await db.select().from(uploadLogTable)
      .where(eq(uploadLogTable.dealId, dealId))
      .orderBy(asc(uploadLogTable.createdAt));
    const deal = (await db.select({ createdAt: dealsTable.createdAt }).from(dealsTable).where(eq(dealsTable.id, dealId)))[0];
    const nameFor = await nameLookup();
    const prov = dealProvenance(rows as LogRow[], deal?.createdAt ?? null, nameFor);
    let inferredCreator: { userName: string | null; userEmail: string | null } | null = null;
    if (!prov.createdBy) {
      const primary = await getPrimaryUploader();
      if (primary) inferredCreator = { userName: (await currentUserName(null, primary.userEmail)) ?? primary.userName, userEmail: primary.userEmail };
    }
    const c = prov.createdBy;
    res.json({
      ...prov, inferredCreator,
      userName: c?.userName ?? inferredCreator?.userName ?? null, userEmail: c?.userEmail ?? inferredCreator?.userEmail ?? null,
      at: c?.at ?? null, inferred: !c,
    });
  } catch (err) {
    req.log.error({ err }, "upload-log by-deal lookup failed");
    res.json(null);
  }
});

// GET /api/upload-log — the site-wide Upload log (admins / the owner), newest first.
// ?user= (name or email, substring) &from=YYYY-MM-DD &to=YYYY-MM-DD &result= &limit= (≤2000, default 500).
// Each row carries `result` (created / attached / skipped / rejected / failed) and the
// deal it landed on (`dealName`, `dealExists` — false once that deal was deleted or trashed).
router.get("/upload-log", requireAdmin, async (req, res) => {
  await ensureUploadLogTable();
  const q = req.query as Record<string, string | undefined>;
  const limit = Math.max(1, Math.min(2000, Number(q.limit) || 500));
  const raw = (await db.select().from(uploadLogTable).orderBy(desc(uploadLogTable.createdAt)).limit(5000)) as LogRow[];
  // Legacy "success" rows: the first one per deal is the creation (see resultOf).
  const firstSuccess = new Map<string, string>();
  for (const r of [...raw].reverse()) if (r.dealId && r.status === "success" && !firstSuccess.has(r.dealId)) firstSuccess.set(r.dealId, r.id);
  const ids = [...new Set(raw.map(r => r.dealId).filter((x): x is string => !!x))];
  const deals = new Map<string, { name: string | null; trashed: boolean; createdAt: Date }>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const found = await db.select({ id: dealsTable.id, data: dealsTable.data, createdAt: dealsTable.createdAt }).from(dealsTable).where(inArray(dealsTable.id, chunk));
    for (const d of found) {
      const data = (d.data ?? {}) as Record<string, unknown>;
      deals.set(d.id, { name: (data.propertyName as string) || (data.fileName as string) || null, trashed: !!data.trashedAt, createdAt: d.createdAt });
    }
  }
  const nameFor = await nameLookup();
  const rows = raw.map(r => {
    const d = r.dealId ? deals.get(r.dealId) : undefined;
    return {
      ...r, userName: nameFor(r) || r.userName,
      result: resultOf(r, r.dealId ? firstSuccess.get(r.dealId) ?? null : null, d?.createdAt ?? null),
      dealName: d?.name ?? null, dealExists: !!d && !d.trashed,
    };
  });
  res.json(filterLog(rows, { user: q.user, from: q.from, to: q.to, result: q.result }).slice(0, limit));
});

export default router;
