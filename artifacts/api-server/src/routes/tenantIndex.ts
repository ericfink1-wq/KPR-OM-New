import { Router } from "express";
import { db } from "@workspace/db";
import { tenantIndexTable, dealsTable } from "@workspace/db";
import { and, eq, lt, lte, gte, ilike, SQL } from "drizzle-orm";
import { rebuildTenantIndex } from "../lib/tenantIndex";

import { requireAuth } from "../middleware/auth";

const router = Router();

// GET /api/tenant-index
// Query params (all optional, combined with AND):
//   expiringBefore=YYYY-MM-DD   — lease_expiry_date <= date
//   expiringAfter=YYYY-MM-DD    — lease_expiry_date >= date
//   rentPerSFBelow=number        — rent_per_sf < number
//   canonicalName=string         — case-insensitive match on canonical_name
//   status=string                — exact match on deal_status
//   dealId=string                — rows for a single deal
//   isAnchor=true|false
router.get("/tenant-index", requireAuth, async (req, res) => {
  try {
    const { expiringBefore, expiringAfter, rentPerSFBelow, canonicalName, status, dealId, isAnchor } = req.query;
    const filters: SQL[] = [];

    if (typeof expiringBefore === "string" && expiringBefore) {
      filters.push(lte(tenantIndexTable.leaseExpiryDate, expiringBefore));
    }
    if (typeof expiringAfter === "string" && expiringAfter) {
      filters.push(gte(tenantIndexTable.leaseExpiryDate, expiringAfter));
    }
    if (typeof rentPerSFBelow === "string" && rentPerSFBelow && !isNaN(parseFloat(rentPerSFBelow))) {
      filters.push(lt(tenantIndexTable.rentPerSf, parseFloat(rentPerSFBelow)));
    }
    if (typeof canonicalName === "string" && canonicalName) {
      filters.push(ilike(tenantIndexTable.canonicalName, canonicalName));
    }
    if (typeof status === "string" && status) {
      filters.push(eq(tenantIndexTable.dealStatus, status));
    }
    if (typeof dealId === "string" && dealId) {
      filters.push(eq(tenantIndexTable.dealId, dealId));
    }
    if (isAnchor === "true") {
      filters.push(eq(tenantIndexTable.isAnchor, true));
    } else if (isAnchor === "false") {
      filters.push(eq(tenantIndexTable.isAnchor, false));
    }

    const rows = filters.length > 0
      ? await db.select().from(tenantIndexTable).where(and(...filters)).orderBy(tenantIndexTable.dealId, tenantIndexTable.canonicalName)
      : await db.select().from(tenantIndexTable).orderBy(tenantIndexTable.dealId, tenantIndexTable.canonicalName);

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to query tenant index");
    res.status(500).json({ error: "Failed to query tenant index" });
  }
});

// POST /api/tenant-index/rebuild-all
// One-time (or on-demand) full rebuild from deals.data. Auth required.
router.post("/tenant-index/rebuild-all", requireAuth, async (req, res) => {
  try {
    const dealRows = await db.select().from(dealsTable);
    const active = dealRows.filter(r => !r.data._processing && !r.data._processingError);

    let rebuilt = 0;
    for (const row of active) {
      await rebuildTenantIndex(row.id, row.data as Record<string, unknown>);
      rebuilt++;
    }

    res.json({ ok: true, rebuilt });
  } catch (err) {
    req.log.error({ err }, "Failed to rebuild tenant index");
    res.status(500).json({ error: "Failed to rebuild tenant index" });
  }
});

export default router;
