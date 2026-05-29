import { Router } from "express";
import { db } from "@workspace/db";
import { compsIndexTable } from "@workspace/db";
import { and, eq, gte, lte, ilike, sql, asc, desc } from "drizzle-orm";
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
// POST /api/comps/manual — insert a manually entered comp
// ---------------------------------------------------------------------------
router.post("/comps/manual", requireAuth, async (req, res) => {
  try {
    const {
      name, address, market, saleDateRaw, saleDate,
      salePrice, capRate, pricePerSf, sf, occupancy,
      anchor, propertyType, sourceNotes,
    } = req.body as Record<string, unknown>;

    const toFloat = (v: unknown): number | null => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return isFinite(n) ? n : null;
    };
    const toStr = (v: unknown): string | null =>
      typeof v === "string" && v.trim() ? v.trim() : null;

    const parsedPrice = toFloat(salePrice);
    const parsedSf    = toFloat(sf);
    let parsedPsf     = toFloat(pricePerSf);
    if (parsedPsf == null && parsedPrice != null && parsedSf != null && parsedSf > 0) {
      parsedPsf = Math.round(parsedPrice / parsedSf);
    }

    const [inserted] = await db.insert(compsIndexTable).values({
      sourceDealId: "__manual__",
      sourceDealName: null,
      sourceDealMarket: toStr(market),
      name: toStr(name),
      address: toStr(address),
      market: toStr(market),
      saleDateRaw: toStr(saleDateRaw),
      saleDate: toStr(saleDate),
      salePrice: parsedPrice,
      capRate: toFloat(capRate),
      pricePerSf: parsedPsf,
      sf: parsedSf,
      occupancy: toFloat(occupancy),
      isManual: true,
      anchor: toStr(anchor),
      propertyType: toStr(propertyType),
      sourceNotes: toStr(sourceNotes),
    }).returning();

    res.json(inserted);
  } catch (err) {
    req.log.error({ err }, "Failed to insert manual comp");
    res.status(500).json({ error: "Failed to insert manual comp" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/comps/manual/bulk — batch insert manually entered comps
// ---------------------------------------------------------------------------
router.post("/comps/manual/bulk", requireAuth, async (req, res) => {
  try {
    const body = req.body;
    if (!Array.isArray(body) || body.length === 0) {
      res.status(400).json({ error: "Body must be a non-empty array of comp objects" });
      return;
    }

    const toFloat = (v: unknown): number | null => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return isFinite(n) ? n : null;
    };
    const toStr = (v: unknown): string | null =>
      typeof v === "string" && v.trim() ? v.trim() : null;

    const insertRows: {
      sourceDealId: string; sourceDealName: null; sourceDealMarket: string | null;
      name: string | null; address: string | null; market: string | null;
      saleDateRaw: string | null; saleDate: string | null;
      salePrice: number | null; capRate: number | null; pricePerSf: number | null;
      sf: number | null; occupancy: number | null;
      isManual: true; anchor: string | null; propertyType: string | null; sourceNotes: string | null;
    }[] = [];

    let skipped = 0;
    for (const item of body as Record<string, unknown>[]) {
      const name      = toStr(item.name);
      const salePrice = toFloat(item.salePrice);
      if (!name && salePrice == null) { skipped++; continue; }

      const parsedSf  = toFloat(item.sf);
      let parsedPsf   = toFloat(item.pricePerSf);
      if (parsedPsf == null && salePrice != null && parsedSf != null && parsedSf > 0) {
        parsedPsf = Math.round(salePrice / parsedSf);
      }
      const market = toStr(item.market);
      insertRows.push({
        sourceDealId: "__manual__", sourceDealName: null, sourceDealMarket: market,
        name, address: toStr(item.address), market,
        saleDateRaw: toStr(item.saleDateRaw),
        saleDate: toStr(item.saleDate),
        salePrice, capRate: toFloat(item.capRate), pricePerSf: parsedPsf,
        sf: parsedSf, occupancy: toFloat(item.occupancy),
        isManual: true,
        anchor: toStr(item.anchor), propertyType: toStr(item.propertyType), sourceNotes: toStr(item.sourceNotes),
      });
    }
    if (insertRows.length > 0) {
      await db.insert(compsIndexTable).values(insertRows);
    }
    res.json({ ok: true, inserted: insertRows.length, skipped });
  } catch (err) {
    req.log.error({ err }, "Failed to bulk-insert manual comps");
    res.status(500).json({ error: "Failed to bulk-insert manual comps" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/comps/manual/:id — delete a manual comp by id
// ---------------------------------------------------------------------------
router.delete("/comps/manual/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [row] = await db.select().from(compsIndexTable).where(eq(compsIndexTable.id, id));
    if (!row || !row.isManual) {
      res.status(404).json({ error: "Not found or not a manual comp" });
      return;
    }
    await db.delete(compsIndexTable).where(eq(compsIndexTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete manual comp");
    res.status(500).json({ error: "Failed to delete manual comp" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/comps/rebuild-all — full backfill from all deals
// Preserves manually entered comps.
// ---------------------------------------------------------------------------
router.post("/comps/rebuild-all", requireAuth, async (req, res) => {
  try {
    // Save manual rows before rebuild wipes non-manual rows
    const manualRows = await db.select().from(compsIndexTable).where(eq(compsIndexTable.isManual, true));
    const count = await rebuildAllComps();
    // Re-insert manual rows if any were accidentally removed
    if (manualRows.length > 0) {
      // rebuildAllComps only deletes rows by sourceDealId = deal.id, so "__manual__" rows
      // are inherently preserved; but re-insert any that were lost just in case
      const surviving = await db.select({ id: compsIndexTable.id }).from(compsIndexTable).where(eq(compsIndexTable.isManual, true));
      const survivingIds = new Set(surviving.map(r => r.id));
      const toRestore = manualRows.filter(r => !survivingIds.has(r.id));
      if (toRestore.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const restoreRows = toRestore.map(({ id: _id, updatedAt: _ts, ...rest }) => rest);
        await db.insert(compsIndexTable).values(restoreRows);
      }
    }
    res.json({ ok: true, rebuilt: count });
  } catch (err) {
    req.log.error({ err }, "Failed to rebuild comps index");
    res.status(500).json({ error: "Failed to rebuild comps index" });
  }
});

export default router;
