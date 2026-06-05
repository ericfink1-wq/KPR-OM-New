// ─────────────────────────────────────────────────────────────────────────────
// Auto-extraction route (Phase 2) — DORMANT / NOT REGISTERED.
//
// This exposes the lease-abstract reconciliation engine as an endpoint, but it is
// intentionally NOT mounted in routes/index.ts, so it is unreachable on the live
// site. It is admin-gated AND feature-flagged off as defense-in-depth for the day
// we enable it.
//
// To turn it on (one day):
//   1. In routes/index.ts:
//        import leaseAbstractExtractRouter from "./leaseAbstractExtract";
//        router.use(leaseAbstractExtractRouter);
//   2. Set env ENABLE_LEASE_ABSTRACT_AUTOEXTRACT=true in the deployment.
//   3. Add a UI trigger that POSTs the document set (see
//      apiAutoExtractLeaseAbstract in the frontend api.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, leaseAbstractsTable } from "@workspace/db";
import { requireAdmin } from "../middleware/auth";
import { ensureLeaseAbstractsTable } from "./leaseAbstracts";
import { runLeaseAbstractReconciliation, type LeaseDocInput } from "../lib/leaseAbstractExtract";

const router = Router();

function autoExtractEnabled(): boolean {
  return process.env.ENABLE_LEASE_ABSTRACT_AUTOEXTRACT === "true";
}

function newAbstractId(): string {
  return `la_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// POST /api/deals/:id/lease-abstracts/auto
// Body: { tenantName: string, dealName?: string, docs: [{ name, date?, type?, text }] }
// Runs the two-pass reconciliation engine and upserts the result (same keying as
// the manual paste path). Admin + feature-flag gated; returns 404 when disabled.
router.post("/deals/:id/lease-abstracts/auto", requireAdmin, async (req, res) => {
  if (!autoExtractEnabled()) {
    res.status(404).json({ error: "Auto-extraction is not enabled." });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return;
  }

  try {
    await ensureLeaseAbstractsTable();
    const dealId = String(req.params.id);
    const body = (req.body ?? {}) as { tenantName?: string; dealName?: string; docs?: LeaseDocInput[] };
    const tenantName = typeof body.tenantName === "string" ? body.tenantName.trim() : "";
    const docs = Array.isArray(body.docs) ? body.docs.filter((d) => d && typeof d.text === "string" && d.text.trim()) : [];

    if (!tenantName) {
      res.status(400).json({ error: "tenantName is required" });
      return;
    }
    if (!docs.length) {
      res.status(400).json({ error: "At least one document (with text) is required" });
      return;
    }

    const abstract = await runLeaseAbstractReconciliation(docs, {
      tenantName,
      dealName: body.dealName ?? null,
      log: req.log,
    });
    abstract.tenantName = tenantName;

    // Upsert keyed on (dealId, tenantName), mirroring the manual path.
    const existing = await db.select().from(leaseAbstractsTable)
      .where(and(eq(leaseAbstractsTable.dealId, dealId), eq(leaseAbstractsTable.tenantName, tenantName)));

    if (existing.length) {
      const row = existing[0];
      const nextVersion = (row.version ?? 1) + 1;
      await db.update(leaseAbstractsTable)
        .set({ data: abstract, version: nextVersion, updatedAt: new Date() })
        .where(eq(leaseAbstractsTable.id, row.id));
      res.json({ ok: true, id: row.id, version: nextVersion, abstract });
      return;
    }

    const id = newAbstractId();
    await db.insert(leaseAbstractsTable).values({ id, dealId, tenantName, data: abstract, version: 1 });
    res.json({ ok: true, id, version: 1, abstract });
  } catch (err) {
    req.log.error({ err }, "Lease-abstract auto-extraction failed");
    const message = err instanceof Error ? err.message : "Auto-extraction failed";
    res.status(500).json({ error: message });
  }
});

export default router;
