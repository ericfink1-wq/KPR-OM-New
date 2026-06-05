import { Router } from "express";
import { sql, eq, and, asc } from "drizzle-orm";
import { db, leaseAbstractsTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middleware/auth";

const router = Router();

// Self-healing table provisioning (mirrors ensureUploadLogTable) so the table
// exists at runtime even before a drizzle push, and DEV matches PROD on publish
// (keeps Replit's schema-diff from proposing to create/drop it every time).
let ready: Promise<void> | null = null;
export function ensureLeaseAbstractsTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS lease_abstracts (
          id text PRIMARY KEY,
          deal_id text NOT NULL,
          tenant_name text NOT NULL,
          data jsonb NOT NULL,
          version integer NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      // One abstract per (deal, tenant): the upsert path keys on this pair.
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS lease_abstracts_deal_tenant_idx
          ON lease_abstracts (deal_id, tenant_name)
      `);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

function newAbstractId(): string {
  return `la_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// GET /api/lease-abstracts — every abstract across the library (powers the
// Analyst chat's lease-level recall). Returns the stored `data` objects stamped
// with id/dealId/version so the chat can cite and link them.
router.get("/lease-abstracts", requireAuth, async (req, res) => {
  try {
    await ensureLeaseAbstractsTable();
    const rows = await db.select().from(leaseAbstractsTable)
      .orderBy(asc(leaseAbstractsTable.tenantName));
    const abstracts = rows.map((r) => ({
      ...(r.data as Record<string, unknown>),
      id: r.id,
      dealId: r.dealId,
      tenantName: r.tenantName,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    res.json(abstracts);
  } catch (err) {
    req.log.error({ err }, "Failed to load all lease abstracts");
    res.status(500).json({ error: "Failed to load lease abstracts" });
  }
});

// GET /api/deals/:id/lease-abstracts — all abstracts for a deal (powers the
// roster "Abstract" button state and the abstract page). Returns the stored
// `data` objects, each stamped with id/version so the client has the full record.
router.get("/deals/:id/lease-abstracts", requireAuth, async (req, res) => {
  try {
    await ensureLeaseAbstractsTable();
    const dealId = String(req.params.id);
    const rows = await db.select().from(leaseAbstractsTable)
      .where(eq(leaseAbstractsTable.dealId, dealId))
      .orderBy(asc(leaseAbstractsTable.tenantName));
    const abstracts = rows.map((r) => ({
      ...(r.data as Record<string, unknown>),
      id: r.id,
      dealId: r.dealId,
      tenantName: r.tenantName,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    res.json(abstracts);
  } catch (err) {
    req.log.error({ err }, "Failed to load lease abstracts");
    res.status(500).json({ error: "Failed to load lease abstracts" });
  }
});

// GET /api/lease-abstracts/:id — one abstract by its id.
router.get("/lease-abstracts/:id", requireAuth, async (req, res) => {
  try {
    await ensureLeaseAbstractsTable();
    const id = String(req.params.id);
    const rows = await db.select().from(leaseAbstractsTable).where(eq(leaseAbstractsTable.id, id));
    if (!rows.length) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const r = rows[0];
    res.json({
      ...(r.data as Record<string, unknown>),
      id: r.id,
      dealId: r.dealId,
      tenantName: r.tenantName,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load lease abstract");
    res.status(500).json({ error: "Failed to load lease abstract" });
  }
});

// POST /api/deals/:id/lease-abstracts — upsert one abstract from a pasted
// (Claude-reconciled) JSON object. Keyed on (dealId, tenantName): if one already
// exists for that tenant it's replaced and its version is bumped; otherwise a new
// row is created. Body is the LeaseAbstract object (see idb.ts).
router.post("/deals/:id/lease-abstracts", requireAuth, async (req, res) => {
  try {
    await ensureLeaseAbstractsTable();
    const dealId = String(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const tenantName = typeof body.tenantName === "string" ? body.tenantName.trim() : "";
    if (!tenantName) {
      res.status(400).json({ error: "tenantName is required in the abstract" });
      return;
    }

    // Strip envelope keys from the stored payload — they live in their own columns
    // and are re-attached on read, so they never go stale inside `data`.
    const { id: _i, dealId: _d, version: _v, createdAt: _c, updatedAt: _u, ...data } = body;
    data.tenantName = tenantName;

    const existing = await db.select().from(leaseAbstractsTable)
      .where(and(eq(leaseAbstractsTable.dealId, dealId), eq(leaseAbstractsTable.tenantName, tenantName)));

    if (existing.length) {
      const row = existing[0];
      const nextVersion = (row.version ?? 1) + 1;
      await db.update(leaseAbstractsTable)
        .set({ data: data as Record<string, unknown>, version: nextVersion, updatedAt: new Date() })
        .where(eq(leaseAbstractsTable.id, row.id));
      res.json({ ok: true, id: row.id, version: nextVersion });
      return;
    }

    const id = newAbstractId();
    await db.insert(leaseAbstractsTable).values({
      id, dealId, tenantName, data: data as Record<string, unknown>, version: 1,
    });
    res.json({ ok: true, id, version: 1 });
  } catch (err) {
    req.log.error({ err }, "Failed to save lease abstract");
    res.status(500).json({ error: "Failed to save lease abstract" });
  }
});

// POST /api/deals/:id/lease-abstracts/bulk — upsert MANY abstracts at once.
// Body: { abstracts: LeaseAbstract[] } or a raw array. Each is keyed on
// (dealId, tenantName); existing rows are replaced + version-bumped. Lets a whole
// property's abstracts be uploaded in one shot instead of tenant by tenant.
router.post("/deals/:id/lease-abstracts/bulk", requireAuth, async (req, res) => {
  try {
    await ensureLeaseAbstractsTable();
    const dealId = String(req.params.id);
    const body = req.body as { abstracts?: unknown } | unknown[];
    const list = Array.isArray(body) ? body : (Array.isArray(body?.abstracts) ? body.abstracts : null);
    if (!list) {
      res.status(400).json({ error: "Expected an array of abstracts, or { abstracts: [...] }" });
      return;
    }

    let saved = 0; const skipped: string[] = [];
    for (const item of list) {
      const obj = (item ?? {}) as Record<string, unknown>;
      const tenantName = typeof obj.tenantName === "string" ? obj.tenantName.trim() : "";
      if (!tenantName) { skipped.push("(missing tenantName)"); continue; }
      const { id: _i, dealId: _d, version: _v, createdAt: _c, updatedAt: _u, ...data } = obj;
      data.tenantName = tenantName;
      const existing = await db.select().from(leaseAbstractsTable)
        .where(and(eq(leaseAbstractsTable.dealId, dealId), eq(leaseAbstractsTable.tenantName, tenantName)));
      if (existing.length) {
        const row = existing[0];
        await db.update(leaseAbstractsTable)
          .set({ data: data as Record<string, unknown>, version: (row.version ?? 1) + 1, updatedAt: new Date() })
          .where(eq(leaseAbstractsTable.id, row.id));
      } else {
        await db.insert(leaseAbstractsTable).values({ id: newAbstractId(), dealId, tenantName, data: data as Record<string, unknown>, version: 1 });
      }
      saved += 1;
    }
    res.json({ ok: true, saved, skipped });
  } catch (err) {
    req.log.error({ err }, "Failed to bulk-save lease abstracts");
    res.status(500).json({ error: "Failed to bulk-save lease abstracts" });
  }
});

// DELETE /api/lease-abstracts/:id — remove an abstract (admin only; destructive).
router.delete("/lease-abstracts/:id", requireAdmin, async (req, res) => {
  try {
    await ensureLeaseAbstractsTable();
    const id = String(req.params.id);
    await db.delete(leaseAbstractsTable).where(eq(leaseAbstractsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete lease abstract");
    res.status(500).json({ error: "Failed to delete lease abstract" });
  }
});

export default router;
