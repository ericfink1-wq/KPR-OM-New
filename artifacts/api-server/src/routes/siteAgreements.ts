import { Router } from "express";
import { sql, eq, and, asc } from "drizzle-orm";
import { db, siteAgreementsTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middleware/auth";

const router = Router();

// Self-healing table provisioning (mirrors ensureLeaseAbstractsTable) so the table
// exists at runtime even before a drizzle push, and DEV matches PROD on publish
// (keeps Replit's schema-diff from proposing to create/drop it every time).
let ready: Promise<void> | null = null;
export function ensureSiteAgreementsTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS site_agreements (
          id text PRIMARY KEY,
          deal_id text NOT NULL,
          agreement_name text NOT NULL,
          data jsonb NOT NULL,
          version integer NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      // One record per (deal, agreement): the upsert path keys on this pair.
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS site_agreements_deal_name_idx
          ON site_agreements (deal_id, agreement_name)
      `);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

function newSiteAgreementId(): string {
  return `sa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Re-attach the envelope columns on read so they never go stale inside `data`.
function shape(r: typeof siteAgreementsTable.$inferSelect) {
  return {
    ...(r.data as Record<string, unknown>),
    id: r.id,
    dealId: r.dealId,
    agreementName: r.agreementName,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// GET /api/site-agreements — every site agreement across the library.
router.get("/site-agreements", requireAuth, async (req, res) => {
  try {
    await ensureSiteAgreementsTable();
    const rows = await db.select().from(siteAgreementsTable)
      .orderBy(asc(siteAgreementsTable.agreementName));
    res.json(rows.map(shape));
  } catch (err) {
    req.log.error({ err }, "Failed to load all site agreements");
    res.status(500).json({ error: "Failed to load site agreements" });
  }
});

// GET /api/deals/:id/site-agreements — all site agreements for a deal (powers the
// deal page's "Site Agreements / REAs" section).
router.get("/deals/:id/site-agreements", requireAuth, async (req, res) => {
  try {
    await ensureSiteAgreementsTable();
    const dealId = String(req.params.id);
    const rows = await db.select().from(siteAgreementsTable)
      .where(eq(siteAgreementsTable.dealId, dealId))
      .orderBy(asc(siteAgreementsTable.agreementName));
    res.json(rows.map(shape));
  } catch (err) {
    req.log.error({ err }, "Failed to load site agreements");
    res.status(500).json({ error: "Failed to load site agreements" });
  }
});

// GET /api/site-agreements/:id — one record by its id.
router.get("/site-agreements/:id", requireAuth, async (req, res) => {
  try {
    await ensureSiteAgreementsTable();
    const id = String(req.params.id);
    const rows = await db.select().from(siteAgreementsTable).where(eq(siteAgreementsTable.id, id));
    if (!rows.length) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(shape(rows[0]));
  } catch (err) {
    req.log.error({ err }, "Failed to load site agreement");
    res.status(500).json({ error: "Failed to load site agreement" });
  }
});

// POST /api/deals/:id/site-agreements — upsert one site agreement from a pasted
// (Claude-reconciled) JSON object. Keyed on (dealId, agreementName): replaces and
// bumps version if one already exists; otherwise inserts. Body is a SiteAgreement.
router.post("/deals/:id/site-agreements", requireAuth, async (req, res) => {
  try {
    await ensureSiteAgreementsTable();
    const dealId = String(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const agreementName = typeof body.agreementName === "string" ? body.agreementName.trim() : "";
    if (!agreementName) {
      res.status(400).json({ error: "agreementName is required in the site agreement" });
      return;
    }

    const { id: _i, dealId: _d, version: _v, createdAt: _c, updatedAt: _u, ...data } = body;
    data.agreementName = agreementName;

    const existing = await db.select().from(siteAgreementsTable)
      .where(and(eq(siteAgreementsTable.dealId, dealId), eq(siteAgreementsTable.agreementName, agreementName)));

    if (existing.length) {
      const row = existing[0];
      const nextVersion = (row.version ?? 1) + 1;
      await db.update(siteAgreementsTable)
        .set({ data: data as Record<string, unknown>, version: nextVersion, updatedAt: new Date() })
        .where(eq(siteAgreementsTable.id, row.id));
      res.json({ ok: true, id: row.id, version: nextVersion });
      return;
    }

    const id = newSiteAgreementId();
    await db.insert(siteAgreementsTable).values({
      id, dealId, agreementName, data: data as Record<string, unknown>, version: 1,
    });
    res.json({ ok: true, id, version: 1 });
  } catch (err) {
    req.log.error({ err }, "Failed to save site agreement");
    res.status(500).json({ error: "Failed to save site agreement" });
  }
});

// POST /api/deals/:id/site-agreements/bulk — upsert MANY at once. Body:
// { siteAgreements: SiteAgreement[] } or a raw array. Each is keyed on
// (dealId, agreementName); existing rows are replaced + version-bumped. Lets a
// whole property's REA set be uploaded in one shot.
router.post("/deals/:id/site-agreements/bulk", requireAuth, async (req, res) => {
  try {
    await ensureSiteAgreementsTable();
    const dealId = String(req.params.id);
    const body = req.body as { siteAgreements?: unknown; abstracts?: unknown } | unknown[];
    const list = Array.isArray(body)
      ? body
      : (Array.isArray(body?.siteAgreements) ? body.siteAgreements
        : (Array.isArray(body?.abstracts) ? body.abstracts : null));
    if (!list) {
      res.status(400).json({ error: "Expected an array, or { siteAgreements: [...] }" });
      return;
    }

    let saved = 0; const skipped: string[] = [];
    for (const item of list) {
      const obj = (item ?? {}) as Record<string, unknown>;
      const agreementName = typeof obj.agreementName === "string" ? obj.agreementName.trim() : "";
      if (!agreementName) { skipped.push("(missing agreementName)"); continue; }
      const { id: _i, dealId: _d, version: _v, createdAt: _c, updatedAt: _u, ...data } = obj;
      data.agreementName = agreementName;
      const existing = await db.select().from(siteAgreementsTable)
        .where(and(eq(siteAgreementsTable.dealId, dealId), eq(siteAgreementsTable.agreementName, agreementName)));
      if (existing.length) {
        const row = existing[0];
        await db.update(siteAgreementsTable)
          .set({ data: data as Record<string, unknown>, version: (row.version ?? 1) + 1, updatedAt: new Date() })
          .where(eq(siteAgreementsTable.id, row.id));
      } else {
        await db.insert(siteAgreementsTable).values({ id: newSiteAgreementId(), dealId, agreementName, data: data as Record<string, unknown>, version: 1 });
      }
      saved += 1;
    }
    res.json({ ok: true, saved, skipped });
  } catch (err) {
    req.log.error({ err }, "Failed to bulk-save site agreements");
    res.status(500).json({ error: "Failed to bulk-save site agreements" });
  }
});

// DELETE /api/site-agreements/:id — remove a record (admin only; destructive).
router.delete("/site-agreements/:id", requireAdmin, async (req, res) => {
  try {
    await ensureSiteAgreementsTable();
    const id = String(req.params.id);
    await db.delete(siteAgreementsTable).where(eq(siteAgreementsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete site agreement");
    res.status(500).json({ error: "Failed to delete site agreement" });
  }
});

export default router;
