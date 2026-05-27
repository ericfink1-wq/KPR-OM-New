import { Router } from "express";
import { db } from "@workspace/db";
import { compsIndexTable } from "@workspace/db";
import { and, gte, lte, ilike, sql, asc, desc } from "drizzle-orm";
import { rebuildAllComps } from "../lib/compsIndex";

const router = Router();

function requireAuth(req: Parameters<Router>[0], res: Parameters<Router>[1], next: Parameters<Router>[2]) {
  if (!req.session.authenticated) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// GET /api/comps
// Filters (all optional, AND-combined):
//   market         — case-insensitive partial match
//   dateFrom       — YYYY-MM-DD; sale_date >= value
//   dateTo         — YYYY-MM-DD; sale_date <= value
//   capRateMin     — cap_rate >= value
//   capRateMax     — cap_rate <= value
//   sourceDealId   — exact match
// Sort:
//   sort=date_desc (default) | date_asc | cap_rate_asc | cap_rate_desc
//       | price_per_sf_asc | price_per_sf_desc | sale_price_desc | sale_price_asc
// ---------------------------------------------------------------------------
router.get("/comps", requireAuth, async (req, res) => {
  try {
    const { market, dateFrom, dateTo, capRateMin, capRateMax, sourceDealId, sort } = req.query as Record<string, string | undefined>;

    const conditions = [];
    if (market?.trim()) conditions.push(ilike(compsIndexTable.market, `%${market.trim()}%`));
    if (dateFrom) conditions.push(gte(compsIndexTable.saleDate, dateFrom));
    if (dateTo) conditions.push(lte(compsIndexTable.saleDate, dateTo));
    if (capRateMin) {
      const v = parseFloat(capRateMin);
      if (isFinite(v)) conditions.push(gte(compsIndexTable.capRate, v));
    }
    if (capRateMax) {
      const v = parseFloat(capRateMax);
      if (isFinite(v)) conditions.push(lte(compsIndexTable.capRate, v));
    }
    if (sourceDealId) conditions.push(sql`${compsIndexTable.sourceDealId} = ${sourceDealId}`);

    const orderBy = (() => {
      switch (sort) {
        case "date_asc":        return [asc(compsIndexTable.saleDate),  asc(compsIndexTable.id)];
        case "cap_rate_asc":    return [asc(compsIndexTable.capRate),   desc(compsIndexTable.saleDate)];
        case "cap_rate_desc":   return [desc(compsIndexTable.capRate),  desc(compsIndexTable.saleDate)];
        case "price_per_sf_asc":  return [asc(compsIndexTable.pricePerSf),  desc(compsIndexTable.saleDate)];
        case "price_per_sf_desc": return [desc(compsIndexTable.pricePerSf), desc(compsIndexTable.saleDate)];
        case "sale_price_asc":  return [asc(compsIndexTable.salePrice),  desc(compsIndexTable.saleDate)];
        case "sale_price_desc": return [desc(compsIndexTable.salePrice), desc(compsIndexTable.saleDate)];
        default:                return [desc(compsIndexTable.saleDate),  asc(compsIndexTable.id)]; // date_desc
      }
    })();

    const rows = conditions.length > 0
      ? await db.select().from(compsIndexTable).where(and(...conditions)).orderBy(...orderBy)
      : await db.select().from(compsIndexTable).orderBy(...orderBy);

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to query comps index");
    res.status(500).json({ error: "Failed to query comps index" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/comps/rebuild-all — full backfill from all deals
// ---------------------------------------------------------------------------
router.post("/comps/rebuild-all", requireAuth, async (req, res) => {
  try {
    const count = await rebuildAllComps();
    res.json({ ok: true, rebuilt: count });
  } catch (err) {
    req.log.error({ err }, "Failed to rebuild comps index");
    res.status(500).json({ error: "Failed to rebuild comps index" });
  }
});

export default router;
