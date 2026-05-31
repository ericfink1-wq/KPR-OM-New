import { Router } from "express";
import { db } from "@workspace/db";
import { retailerWatchlistTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

import { requireAuth } from "../middleware/auth";

const router = Router();

const VALID_STATUS = new Set(["watch", "distressed", "bankruptcy", "liquidating"]);

// Starter set of currently-distressed retail chains. Seeded once, on first load
// of an empty table. Eric can edit/remove any of these in the UI.
const SEED: Array<{ brand: string; status: string; note: string }> = [
  { brand: "Party City",   status: "bankruptcy",  note: "Filed Chapter 11 and began winding down all U.S. stores (2025)." },
  { brand: "Big Lots",     status: "liquidating", note: "Chapter 11; going-out-of-business sales across the fleet." },
  { brand: "Joann",        status: "liquidating", note: "Second Chapter 11; full store-closing process underway." },
  { brand: "Express",      status: "bankruptcy",  note: "Chapter 11; large number of store closures." },
  { brand: "Rite Aid",     status: "distressed",  note: "Emerged from bankruptcy smaller; ongoing store closures — watch exposure." },
  { brand: "Conn's",       status: "liquidating", note: "Chapter 11; liquidating HomePlus / Conn's stores." },
];

// Ensure the table exists even if `drizzle-kit push` hasn't been run against this
// database yet (Eric pulls + restarts; he can't run shell migrations). Idempotent.
let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS retailer_watchlist (
          id text PRIMARY KEY,
          brand text NOT NULL,
          status text NOT NULL,
          note text,
          source_url text,
          added_by text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      // Seed only when completely empty
      const existing = await db.select({ id: retailerWatchlistTable.id }).from(retailerWatchlistTable).limit(1);
      if (existing.length === 0) {
        const now = new Date();
        await db.insert(retailerWatchlistTable).values(
          SEED.map((s, i) => ({
            id: `seed_${i}_${Math.random().toString(36).slice(2, 8)}`,
            brand: s.brand,
            status: s.status,
            note: s.note,
            sourceUrl: null,
            addedBy: "seed",
            createdAt: now,
            updatedAt: now,
          })),
        ).onConflictDoNothing();
      }
    })().catch((err) => {
      tableReady = null; // allow retry on next request if it failed
      throw err;
    });
  }
  return tableReady;
}

// GET /api/watchlist — all watched retailers
router.get("/watchlist", requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const rows = await db.select().from(retailerWatchlistTable);
    rows.sort((a, b) => a.brand.localeCompare(b.brand));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to load watchlist");
    res.status(500).json({ error: "Failed to load watchlist" });
  }
});

// POST /api/watchlist — add a retailer
router.post("/watchlist", requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const { brand, status, note, sourceUrl } = req.body as Record<string, unknown>;
    const b = typeof brand === "string" ? brand.trim() : "";
    const s = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (!b) { res.status(400).json({ error: "brand is required" }); return; }
    if (!VALID_STATUS.has(s)) { res.status(400).json({ error: "invalid status" }); return; }
    const id = `wl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const [row] = await db.insert(retailerWatchlistTable).values({
      id, brand: b, status: s,
      note: typeof note === "string" && note.trim() ? note.trim() : null,
      sourceUrl: typeof sourceUrl === "string" && sourceUrl.trim() ? sourceUrl.trim() : null,
      addedBy: "user",
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to add watchlist retailer");
    res.status(500).json({ error: "Failed to add retailer" });
  }
});

// PUT /api/watchlist/:id — update status/note/source
router.put("/watchlist/:id", requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const id = String(req.params.id);
    const { brand, status, note, sourceUrl } = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof brand === "string" && brand.trim()) patch.brand = brand.trim();
    if (typeof status === "string") {
      const s = status.trim().toLowerCase();
      if (!VALID_STATUS.has(s)) { res.status(400).json({ error: "invalid status" }); return; }
      patch.status = s;
    }
    if (note !== undefined) patch.note = typeof note === "string" && note.trim() ? note.trim() : null;
    if (sourceUrl !== undefined) patch.sourceUrl = typeof sourceUrl === "string" && sourceUrl.trim() ? sourceUrl.trim() : null;
    const [row] = await db.update(retailerWatchlistTable).set(patch).where(eq(retailerWatchlistTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update watchlist retailer");
    res.status(500).json({ error: "Failed to update retailer" });
  }
});

// DELETE /api/watchlist/:id
router.delete("/watchlist/:id", requireAuth, async (req, res) => {
  try {
    await ensureTable();
    const id = String(req.params.id);
    await db.delete(retailerWatchlistTable).where(eq(retailerWatchlistTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete watchlist retailer");
    res.status(500).json({ error: "Failed to delete retailer" });
  }
});

export default router;
