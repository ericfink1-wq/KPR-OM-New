import { Router } from "express";
import { db } from "@workspace/db";
import { compsIndexTable, dealsTable } from "@workspace/db";
import { and, or, eq, gte, lte, ilike, sql, asc, desc } from "drizzle-orm";
import { rebuildAllComps, rebuildCompsIndex } from "../lib/compsIndex";

import { requireAuth, requireAdmin } from "../middleware/auth";
import { toFloat, toStr } from "../lib/parsers";

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/comps/stats — whole-table aggregates (unfiltered)
// ---------------------------------------------------------------------------
router.get("/comps/stats", requireAuth, async (req, res) => {
  try {
    const [result] = await db.select({
      count:         sql<number>`count(*)::int`,
      totalVolume:   sql<number>`coalesce(sum(sale_price) filter (where sale_price > 0), 0)`,
      statesCovered: sql<number>`count(distinct state) filter (where state is not null)::int`,
      earliestSale:  sql<string | null>`min(sale_date) filter (where sale_date is not null)`,
      latestSale:    sql<string | null>`max(sale_date) filter (where sale_date is not null)`,
    }).from(compsIndexTable);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch comps stats");
    res.status(500).json({ error: "Failed to fetch comps stats" });
  }
});

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
    const { q, market, dateFrom, dateTo, capRateMin, capRateMax, sourceDealId, sort } = req.query as Record<string, string | undefined>;

    const conditions = [];
    if (q?.trim()) {
      const term = `%${q.trim()}%`;
      conditions.push(or(
        ilike(compsIndexTable.name, term),
        ilike(compsIndexTable.sourceDealName, term),
        ilike(compsIndexTable.address, term),
        ilike(compsIndexTable.market, term),
        ilike(compsIndexTable.state, term),
        ilike(compsIndexTable.anchor, term),
        ilike(compsIndexTable.propertyType, term),
        ilike(compsIndexTable.buyer, term),
        ilike(compsIndexTable.seller, term),
        ilike(compsIndexTable.sourceNotes, term),
      )!);
    }
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
        case "date_asc":          return [asc(compsIndexTable.saleDate),      asc(compsIndexTable.id)];
        case "cap_rate_asc":      return [asc(compsIndexTable.capRate),        desc(compsIndexTable.saleDate)];
        case "cap_rate_desc":     return [desc(compsIndexTable.capRate),       desc(compsIndexTable.saleDate)];
        case "price_per_sf_asc":  return [asc(compsIndexTable.pricePerSf),    desc(compsIndexTable.saleDate)];
        case "price_per_sf_desc": return [desc(compsIndexTable.pricePerSf),   desc(compsIndexTable.saleDate)];
        case "sale_price_asc":    return [asc(compsIndexTable.salePrice),     desc(compsIndexTable.saleDate)];
        case "sale_price_desc":   return [desc(compsIndexTable.salePrice),    desc(compsIndexTable.saleDate)];
        case "name_asc":          return [asc(compsIndexTable.name),          asc(compsIndexTable.id)];
        case "name_desc":         return [desc(compsIndexTable.name),         asc(compsIndexTable.id)];
        case "market_asc":        return [asc(compsIndexTable.market),        asc(compsIndexTable.id)];
        case "market_desc":       return [desc(compsIndexTable.market),       asc(compsIndexTable.id)];
        case "state_asc":         return [asc(compsIndexTable.state),         asc(compsIndexTable.id)];
        case "state_desc":        return [desc(compsIndexTable.state),        asc(compsIndexTable.id)];
        case "sf_asc":            return [asc(compsIndexTable.sf),            desc(compsIndexTable.saleDate)];
        case "sf_desc":           return [desc(compsIndexTable.sf),           desc(compsIndexTable.saleDate)];
        case "occ_asc":           return [asc(compsIndexTable.occupancy),     desc(compsIndexTable.saleDate)];
        case "occ_desc":          return [desc(compsIndexTable.occupancy),    desc(compsIndexTable.saleDate)];
        case "anchor_asc":        return [asc(compsIndexTable.anchor),        asc(compsIndexTable.id)];
        case "anchor_desc":       return [desc(compsIndexTable.anchor),       asc(compsIndexTable.id)];
        case "type_asc":          return [asc(compsIndexTable.propertyType),  asc(compsIndexTable.id)];
        case "type_desc":         return [desc(compsIndexTable.propertyType), asc(compsIndexTable.id)];
        case "buyer_asc":         return [asc(compsIndexTable.buyer),         asc(compsIndexTable.id)];
        case "buyer_desc":        return [desc(compsIndexTable.buyer),        asc(compsIndexTable.id)];
        case "seller_asc":        return [asc(compsIndexTable.seller),        asc(compsIndexTable.id)];
        case "seller_desc":       return [desc(compsIndexTable.seller),       asc(compsIndexTable.id)];
        default:                  return [desc(compsIndexTable.saleDate),     asc(compsIndexTable.id)]; // date_desc
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
      name, address, market, state, saleDateRaw, saleDate,
      salePrice, capRate, pricePerSf, sf, occupancy,
      anchor, propertyType, sourceNotes, buyer, seller,
    } = req.body as Record<string, unknown>;


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
      state: toStr(state),
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
      buyer: toStr(buyer),
      seller: toStr(seller),
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


    type CompInsert = {
      sourceDealId: string; sourceDealName: null; sourceDealMarket: string | null;
      name: string | null; address: string | null; market: string | null; state: string | null;
      saleDateRaw: string | null; saleDate: string | null;
      salePrice: number | null; capRate: number | null; pricePerSf: number | null;
      sf: number | null; occupancy: number | null;
      isManual: true; anchor: string | null; propertyType: string | null; sourceNotes: string | null;
      buyer: string | null; seller: string | null;
    };

    const candidates: CompInsert[] = [];
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
      candidates.push({
        // Bulk/file imports are tagged "__upload__" so the UI can show an UPLOAD
        // badge distinct from a hand-typed MANUAL comp. Still isManual:true — same
        // broker/manual quality tier for benchmarking, and still editable/deletable.
        sourceDealId: "__upload__", sourceDealName: null, sourceDealMarket: market,
        name, address: toStr(item.address), market, state: toStr(item.state),
        saleDateRaw: toStr(item.saleDateRaw),
        saleDate: toStr(item.saleDate),
        salePrice, capRate: toFloat(item.capRate), pricePerSf: parsedPsf,
        sf: parsedSf, occupancy: toFloat(item.occupancy),
        isManual: true,
        anchor: toStr(item.anchor), propertyType: toStr(item.propertyType), sourceNotes: toStr(item.sourceNotes),
        buyer: toStr(item.buyer), seller: toStr(item.seller),
      });
    }

    // Smart import: never replace/delete. Skip any comp that duplicates one
    // already in the database OR an earlier row in this same upload.
    const norm = (s: string | null) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const sigOf = (r: { name: string | null; address: string | null; salePrice: number | null; saleDate: string | null; saleDateRaw: string | null; sf: number | null }) =>
      [norm(r.name || r.address), r.salePrice != null ? Math.round(r.salePrice) : "", (r.saleDate || r.saleDateRaw || ""), r.sf != null ? Math.round(r.sf) : ""].join("|");

    const existing = await db.select({
      name: compsIndexTable.name, address: compsIndexTable.address,
      salePrice: compsIndexTable.salePrice, saleDate: compsIndexTable.saleDate,
      saleDateRaw: compsIndexTable.saleDateRaw, sf: compsIndexTable.sf,
    }).from(compsIndexTable);
    const seen = new Set<string>(existing.map(sigOf));

    const insertRows: CompInsert[] = [];
    let duplicates = 0;
    for (const r of candidates) {
      const s = sigOf(r);
      if (seen.has(s)) { duplicates++; continue; }
      seen.add(s);
      insertRows.push(r);
    }

    if (insertRows.length > 0) {
      await db.insert(compsIndexTable).values(insertRows);
    }
    res.json({ ok: true, inserted: insertRows.length, skipped, duplicates });
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
// PUT /api/comps/manual/:id — update a manually entered comp in place
// ---------------------------------------------------------------------------
router.put("/comps/manual/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [existing] = await db.select().from(compsIndexTable).where(eq(compsIndexTable.id, id));
    if (!existing || !existing.isManual) {
      res.status(404).json({ error: "Not found or not a manual comp" });
      return;
    }

    const {
      name, address, market, state, saleDateRaw, saleDate,
      salePrice, capRate, pricePerSf, sf, occupancy,
      anchor, propertyType, sourceNotes, buyer, seller,
    } = req.body as Record<string, unknown>;


    const parsedPrice = toFloat(salePrice);
    const parsedSf    = toFloat(sf);
    let parsedPsf     = toFloat(pricePerSf);
    if (parsedPsf == null && parsedPrice != null && parsedSf != null && parsedSf > 0) {
      parsedPsf = Math.round(parsedPrice / parsedSf);
    }

    const [updated] = await db.update(compsIndexTable)
      .set({
        name: toStr(name),
        address: toStr(address),
        market: toStr(market),
        state: toStr(state),
        saleDateRaw: toStr(saleDateRaw),
        saleDate: toStr(saleDate),
        salePrice: parsedPrice,
        capRate: toFloat(capRate),
        pricePerSf: parsedPsf,
        sf: parsedSf,
        occupancy: toFloat(occupancy),
        anchor: toStr(anchor),
        propertyType: toStr(propertyType),
        sourceNotes: toStr(sourceNotes),
        buyer: toStr(buyer),
        seller: toStr(seller),
        updatedAt: new Date(),
      })
      .where(eq(compsIndexTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update manual comp");
    res.status(500).json({ error: "Failed to update manual comp" });
  }
});

// ---------------------------------------------------------------------------
// OM-sourced comp edits.
//
// OM comps are not stored independently — they are regenerated from each deal's
// comparableSales array on every rebuild. So editing/deleting one in the index
// alone would silently reappear. Instead we mutate the *source* (the parent
// deal's comparableSales entry) and rebuild that deal's rows, which makes the
// change durable and also keeps the deal page in sync.
// ---------------------------------------------------------------------------
// Signature built from a comp's identifying fields, using the same
// normalisation rebuildCompsIndex applies, so an index row can be matched back
// to the comparableSales entry that produced it.
function compSignature(p: {
  name: unknown; address: unknown; salePrice: number | null; capRate: number | null;
  pricePerSf: number | null; sf: number | null; occupancy: number | null; saleDateRaw: unknown;
}): string {
  return JSON.stringify([
    toStr(p.name), toStr(p.address),
    p.salePrice, p.capRate, p.pricePerSf, p.sf, p.occupancy,
    toStr(p.saleDateRaw),
  ]);
}

// Locate the comparableSales entry that produced a given index row. Returns the
// array index, or -1 if no confident match.
function findComparableIndex(
  comps: Array<Record<string, unknown>>,
  row: typeof compsIndexTable.$inferSelect,
): number {
  const rowSig = compSignature({
    name: row.name, address: row.address, salePrice: row.salePrice, capRate: row.capRate,
    pricePerSf: row.pricePerSf, sf: row.sf, occupancy: row.occupancy, saleDateRaw: row.saleDateRaw,
  });
  return comps.findIndex(c => compSignature({
    name: c.name, address: c.address, salePrice: toFloat(c.salePrice), capRate: toFloat(c.capRate),
    pricePerSf: toFloat(c.pricePerSF), sf: toFloat(c.sf), occupancy: toFloat(c.occupancy),
    saleDateRaw: c.saleDate,
  }) === rowSig);
}

type OmCompCtx =
  | { error: number; message: string }
  | { row: typeof compsIndexTable.$inferSelect; deal: { id: string; data: unknown } | null };

// Load an OM-sourced comp row + its parent deal, guarding against manual and
// own-transaction comps (which are edited through other paths).
async function loadOmCompContext(id: number): Promise<OmCompCtx> {
  const [row] = await db.select().from(compsIndexTable).where(eq(compsIndexTable.id, id));
  if (!row) return { error: 404, message: "Comp not found" };
  if (row.isManual) return { error: 400, message: "This is a manual comp — use the manual comp endpoint" };
  if (row.isOwnTransaction) {
    return { error: 400, message: "Own-transaction comps come from this deal's KPR underwriting and can't be edited here" };
  }
  const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, row.sourceDealId));
  return { row, deal: deal ?? null };
}

// ---------------------------------------------------------------------------
// DELETE /api/comps/om/:id — remove an OM-sourced comp
// ---------------------------------------------------------------------------
router.delete("/comps/om/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const ctx = await loadOmCompContext(id);
    if ("error" in ctx) { res.status(ctx.error).json({ error: ctx.message }); return; }
    const { row, deal } = ctx;

    // Source deal is gone — the row is orphaned, so just drop it from the index.
    if (!deal) {
      await db.delete(compsIndexTable).where(eq(compsIndexTable.id, id));
      res.json({ ok: true });
      return;
    }

    const data = deal.data as Record<string, unknown>;
    const comps = Array.isArray(data.comparableSales)
      ? (data.comparableSales as Array<Record<string, unknown>>) : [];
    const idx = findComparableIndex(comps, row);
    if (idx === -1) {
      res.status(409).json({ error: "Could not locate this comp in the source deal. Try rebuilding the comp index, then retry." });
      return;
    }

    const nextComps = comps.slice(0, idx).concat(comps.slice(idx + 1));
    const nextData = { ...data, comparableSales: nextComps };
    await db.update(dealsTable).set({ data: nextData, updatedAt: new Date() }).where(eq(dealsTable.id, deal.id));
    await rebuildCompsIndex(deal.id, nextData);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete OM comp");
    res.status(500).json({ error: "Failed to delete OM comp" });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/comps/om/:id — edit an OM-sourced comp in place
// ---------------------------------------------------------------------------
router.put("/comps/om/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const ctx = await loadOmCompContext(id);
    if ("error" in ctx) { res.status(ctx.error).json({ error: ctx.message }); return; }
    const { row, deal } = ctx;
    if (!deal) { res.status(404).json({ error: "Source deal not found" }); return; }

    const data = deal.data as Record<string, unknown>;
    const comps = Array.isArray(data.comparableSales)
      ? (data.comparableSales as Array<Record<string, unknown>>) : [];
    const idx = findComparableIndex(comps, row);
    if (idx === -1) {
      res.status(409).json({ error: "Could not locate this comp in the source deal. Try rebuilding the comp index, then retry." });
      return;
    }

    const b = req.body as Record<string, unknown>;
    const salePrice = toFloat(b.salePrice);
    const sf = toFloat(b.sf);
    let psf = toFloat(b.pricePerSf);
    if (psf == null && salePrice != null && sf != null && sf > 0) psf = Math.round(salePrice / sf);

    // Only the fields carried by a comparableSales entry; preserve any others.
    const updatedEntry: Record<string, unknown> = {
      ...comps[idx],
      name: toStr(b.name),
      address: toStr(b.address),
      market: toStr(b.market),
      state: toStr(b.state),
      saleDate: toStr(b.saleDate),
      salePrice,
      capRate: toFloat(b.capRate),
      pricePerSF: psf,
      sf,
      occupancy: toFloat(b.occupancy),
    };
    const nextComps = comps.slice();
    nextComps[idx] = updatedEntry;
    const nextData = { ...data, comparableSales: nextComps };
    await db.update(dealsTable).set({ data: nextData, updatedAt: new Date() }).where(eq(dealsTable.id, deal.id));
    await rebuildCompsIndex(deal.id, nextData);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update OM comp");
    res.status(500).json({ error: "Failed to update OM comp" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/comps/benchmark — deterministic comp benchmark for a deal
// ---------------------------------------------------------------------------
router.post("/comps/benchmark", requireAuth, async (req, res) => {
  try {
    const { computeBenchmark } = await import("../lib/compBenchmark");
    const body = req.body as {
      dealId?: string; market?: string | null; state?: string | null;
      propertyType?: string | null; sf?: number | null;
      capRate?: number | null; pricePerSf?: number | null; excludeOmComps?: boolean;
      excludeCompIds?: number[]; includeCompIds?: number[]; starCompIds?: number[];
      occupancy?: number | null; anchor?: string | null; anchorIG?: boolean;
      manual?: { months?: number | null; geography?: "national" | "state" | "metro"; sameType?: boolean; sizeBand?: boolean } | null;
    };
    if (!body.dealId) { res.status(400).json({ error: "dealId required" }); return; }
    const result = await computeBenchmark({
      dealId: body.dealId, market: body.market ?? null, state: body.state ?? null,
      propertyType: body.propertyType ?? null, sf: body.sf ?? null,
      capRate: body.capRate ?? null, pricePerSf: body.pricePerSf ?? null,
      excludeOmComps: body.excludeOmComps ?? false,
      excludeCompIds: Array.isArray(body.excludeCompIds) ? body.excludeCompIds : [],
      includeCompIds: Array.isArray(body.includeCompIds) ? body.includeCompIds : [],
      starCompIds: Array.isArray(body.starCompIds) ? body.starCompIds : [],
      occupancy: body.occupancy ?? null, anchor: body.anchor ?? null, anchorIG: !!body.anchorIG,
      manual: body.manual ?? null,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to compute comp benchmark");
    res.status(500).json({ error: "Failed to compute comp benchmark" });
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

// ---------------------------------------------------------------------------
// POST /api/comps/retag-manual-to-upload — admin one-time cleanup
// Re-tags every legacy "__manual__" comp as "__upload__" so historical bulk
// imports show the UPLOAD badge. Only touches rows whose sourceDealId is exactly
// "__manual__"; isManual stays true (same quality tier). Idempotent.
// ---------------------------------------------------------------------------
router.post("/comps/retag-manual-to-upload", requireAdmin, async (req, res) => {
  try {
    const updated = await db.update(compsIndexTable)
      .set({ sourceDealId: "__upload__", updatedAt: new Date() })
      .where(eq(compsIndexTable.sourceDealId, "__manual__"))
      .returning({ id: compsIndexTable.id });
    req.log.info({ retagged: updated.length }, "Retagged manual comps to upload");
    res.json({ ok: true, retagged: updated.length });
  } catch (err) {
    req.log.error({ err }, "Failed to retag manual comps");
    res.status(500).json({ error: "Failed to retag manual comps" });
  }
});

export default router;
