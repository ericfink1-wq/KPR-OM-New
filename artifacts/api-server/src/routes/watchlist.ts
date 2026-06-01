import { Router } from "express";
import { db } from "@workspace/db";
import { retailerWatchlistTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

import { requireAuth } from "../middleware/auth";
import { fetchWithTimeout } from "../lib/http";

const router = Router();

const VALID_STATUS = new Set(["watch", "distressed", "bankruptcy", "liquidating"]);

// Curated list of distressed / failed retail tenants, compiled from reputable
// sources (Coresight Research store trackers, Retail Dive, RapidRatings, CNBC,
// Axios, TheStreet) as of May 2026. Status reflects current condition:
//   liquidating = closed / GOB now (a sighting in a rent roll = a dark box)
//   bankruptcy  = in Chapter 11, operating but closing stores
//   distressed  = not filed, but downgraded / mass closures / unsustainable
//   watch       = financial pressure, negative outlook, smaller closures
// These auto-refresh on every deploy (keyed by brand); retailers Eric adds
// himself (added_by = 'user') are never touched.
const CURATED: Array<{ brand: string; status: string; note: string; sourceUrl: string }> = [
  // — Defunct / liquidated: if listed as in-place, treat the space as dark —
  { brand: "Rite Aid", status: "liquidating", note: "Completed its Chapter 11 wind-down in 2025 and closed ALL U.S. stores; scripts sold to CVS/Walgreens/Kroger/Albertsons. Any Rite Aid in a rent roll is a dark box.", sourceUrl: "https://www.foxbusiness.com/lifestyle/cvs-walgreens-rite-aid-closing-stores-brick-mortar-downfall" },
  { brand: "Party City", status: "liquidating", note: "Liquidated in 2025 after Chapter 11; closed all ~695 U.S. stores. Defunct — treat as vacant if listed.", sourceUrl: "https://www.the-sun.com/money/15533893/retail-bankruptcy-joann-party-city-claires/" },
  { brand: "Joann", status: "liquidating", note: "Liquidated in 2025 (second Chapter 11); closed ~800 fabric/craft stores. Defunct.", sourceUrl: "https://www.the-sun.com/money/15533893/retail-bankruptcy-joann-party-city-claires/" },
  { brand: "Forever 21", status: "liquidating", note: "U.S. operator liquidated in 2025; closed all 354 U.S. stores. Defunct.", sourceUrl: "https://www.axios.com/local/new-orleans/2025/03/20/forever-21-party-city-joann-store-closures" },
  { brand: "Conn's HomePlus", status: "liquidating", note: "Liquidated in a 2024 Chapter 11; closed all furniture/electronics stores. Defunct.", sourceUrl: "https://www.retaildive.com/news/distressed-retailers-vulnerable-could-file-bankruptcy-2026/810234/" },
  { brand: "rue21", status: "liquidating", note: "Liquidated in 2024 (its third bankruptcy); closed all ~540 stores. Defunct.", sourceUrl: "https://www.retaildive.com/news/distressed-retailers-vulnerable-could-file-bankruptcy-2026/810234/" },
  { brand: "LL Flooring", status: "liquidating", note: "Lumber Liquidators liquidated in 2024; most stores closed (some banners acquired). Largely defunct.", sourceUrl: "https://www.retaildive.com/news/distressed-retailers-vulnerable-could-file-bankruptcy-2026/810234/" },
  { brand: "Eddie Bauer", status: "liquidating", note: "Filed for bankruptcy and liquidation in February 2026.", sourceUrl: "https://passionatepennypincher.com/retail-store-closures/" },
  { brand: "Allbirds", status: "liquidating", note: "Closed all U.S. full-price stores by Feb 2026 and sold to American Exchange Group (~$39M); now DTC/e-commerce. Minimal center exposure.", sourceUrl: "https://www.rapidratings.com/post/bankruptcy-watch-retailers-most-at-risk-after-saks-francescas-eddie-bauer-and-fat-brands" },

  // — In Chapter 11, still operating / closing stores —
  { brand: "Saks Fifth Avenue", status: "bankruptcy", note: "Saks Global filed Chapter 11 in Jan 2026 on Neiman Marcus acquisition debt; closing ~57 Saks OFF 5th and ~8 Saks Fifth Avenue stores.", sourceUrl: "https://www.axios.com/2026/01/14/saks-global-bankruptcy-2026-department-stores" },
  { brand: "Saks OFF 5th", status: "liquidating", note: "Part of Saks Global's Jan 2026 Chapter 11; ~57 stores closing with an online liquidation underway.", sourceUrl: "https://www.axios.com/2026/01/14/saks-global-bankruptcy-2026-department-stores" },
  { brand: "Francesca's", status: "bankruptcy", note: "Filed Chapter 11 again in early 2026 (second time); closing mall apparel stores.", sourceUrl: "https://www.rapidratings.com/post/bankruptcy-watch-retailers-most-at-risk-after-saks-francescas-eddie-bauer-and-fat-brands" },
  { brand: "Claire's", status: "bankruptcy", note: "Filed Chapter 11 again in 2025 (PE-leveraged); closing stores and exploring an asset sale.", sourceUrl: "https://www.the-sun.com/money/15533893/retail-bankruptcy-joann-party-city-claires/" },
  { brand: "At Home", status: "bankruptcy", note: "Filed Chapter 11 in 2025; closing underperforming big-box home stores under restructuring.", sourceUrl: "https://www.retaildive.com/news/distressed-retailers-vulnerable-could-file-bankruptcy-2026/810234/" },

  // — Not filed, but materially distressed (downgrades / mass closures) —
  { brand: "Big Lots", status: "distressed", note: "2024 Chapter 11 closed ~340 net stores; Variety Wholesalers acquired the brand and reopened a subset. Surviving footprint is far smaller and fragile.", sourceUrl: "https://www.mmcginvest.com/post/the-great-american-store-closure-tracker-2026-edition" },
  { brand: "Express", status: "distressed", note: "Liquidated most stores in a 2024 Chapter 11; WHP/brand group kept a limited number operating. Footprint gutted.", sourceUrl: "https://www.retaildive.com/news/distressed-retailers-vulnerable-could-file-bankruptcy-2026/810234/" },
  { brand: "Container Store", status: "distressed", note: "Emerged from a 2024 Chapter 11 in Jan 2025 with reduced debt; still pressured by weak discretionary demand.", sourceUrl: "https://www.thestreet.com/retail/torrid-closes-stores-no-bankruptcy" },
  { brand: "Walgreens", status: "distressed", note: "Closing ~1,200 stores over three years (under 100 in 2026) under its PE take-private; squeezed by low drug reimbursement. Major drug anchor — watch lease exposure.", sourceUrl: "https://www.thestreet.com/retail/another-major-pharmacy-chain-walgreens-closes-stores-nationwide" },
  { brand: "JCPenney", status: "distressed", note: "Ongoing closures with a thin balance sheet under Catalyst/SPARC ownership; anchor risk.", sourceUrl: "https://coresight.com/coresight-research-store-trackers/" },
  { brand: "GameStop", status: "distressed", note: "Closing 470+ stores to start 2026; secular decline in physical game retail.", sourceUrl: "https://www.cnbc.com/2026/02/02/store-openings-and-closures-2026-dollar-general-aldi-gamestop.html" },
  { brand: "Torrid", status: "distressed", note: "S&P downgrade called its capital structure 'unsustainable'; closing up to 180 stores (no filing yet).", sourceUrl: "https://www.thestreet.com/retail/torrid-closes-stores-no-bankruptcy" },
  { brand: "Tillys", status: "distressed", note: "On RapidRatings' 2026 'retailers to watch' list; closing stores amid mounting losses.", sourceUrl: "https://www.rapidratings.com/post/bankruptcy-watch-retailers-most-at-risk-after-saks-francescas-eddie-bauer-and-fat-brands" },

  // — Watch: pressure / negative outlook, smaller closures —
  { brand: "Macy's", status: "watch", note: "Closing stores under its 'Bold New Chapter' plan (66 in 2025, 50 in 2024); anchor footprint shrinking.", sourceUrl: "https://coresight.com/coresight-research-store-trackers/" },
  { brand: "Kohl's", status: "watch", note: "Closing 27 underperforming stores in 2026 amid multi-year sales declines and leadership turnover; ~1,100 stores remain.", sourceUrl: "https://www.mmcginvest.com/post/the-great-american-store-closure-tracker-2026-edition" },
  { brand: "CVS", status: "watch", note: "Closed ~270 stores in 2025 (and ~900 in 2022–24) but is stabilizing and planning modest 2026 openings. Lower risk than its drug-store peers.", sourceUrl: "https://www.pymnts.com/news/retail/2026/cvs-to-expand-retail-footprint-after-shrinking-for-4-years/" },
  { brand: "Carter's", status: "watch", note: "Announced ~150 store closures and layoffs across 2025–26.", sourceUrl: "https://coresight.com/coresight-research-store-trackers/" },
  { brand: "Cato", status: "watch", note: "On RapidRatings' 2026 'retailers to watch' list; weak apparel sales.", sourceUrl: "https://www.rapidratings.com/post/bankruptcy-watch-retailers-most-at-risk-after-saks-francescas-eddie-bauer-and-fat-brands" },
  { brand: "Wayfair", status: "watch", note: "On RapidRatings' 2026 'retailers to watch' list; primarily online, so limited shopping-center exposure.", sourceUrl: "https://www.rapidratings.com/post/bankruptcy-watch-retailers-most-at-risk-after-saks-francescas-eddie-bauer-and-fat-brands" },
  { brand: "AMC Theatres", status: "watch", note: "Highly leveraged movie-theater operator carrying heavy meme-stock-era debt; completed another debt restructuring in early 2026 (new financing plus debt-to-equity conversions) to push out 2026 maturities. Negative equity and free cash flow with a Q4 2025 earnings miss; deeply junk-rated and reliant on equity raises/refinancings to avoid an in- or out-of-court restructuring. Operating and not filed — but a leverage/credit name to watch as a big-box anchor or junior anchor.", sourceUrl: "https://www.tipranks.com/news/company-announcements/amc-entertainment-advances-debt-restructuring-with-indenture-amendments" },
];

// Deterministic id per curated brand so re-seeding upserts instead of duplicating.
function brandNorm(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function seedId(brand: string): string {
  return "seed_" + brandNorm(brand);
}

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
      // Upsert the curated list on every boot, keyed by a deterministic per-brand
      // id. This keeps the sourced statuses/notes current as situations change,
      // adds any brands introduced since last deploy, and — because user-added
      // rows get random ids with added_by = 'user' — never clobbers Eric's own
      // entries. (If he deletes a curated brand it returns on next deploy; tell
      // me and I'll drop it from the source list instead.)
      for (const c of CURATED) {
        await db.insert(retailerWatchlistTable)
          .values({ id: seedId(c.brand), brand: c.brand, status: c.status, note: c.note, sourceUrl: c.sourceUrl, addedBy: "seed" })
          .onConflictDoUpdate({
            target: retailerWatchlistTable.id,
            set: { brand: c.brand, status: c.status, note: c.note, sourceUrl: c.sourceUrl, updatedAt: new Date() },
          });
      }
      // Self-healing dedupe: if a brand Eric once hand-added later becomes
      // curated, drop his duplicate so it isn't counted twice in the exposure
      // totals. Only removes user rows whose brand matches a curated brand —
      // every other personal entry is left untouched.
      const curatedNorms = new Set(CURATED.map(c => brandNorm(c.brand)));
      const userRows = await db.select().from(retailerWatchlistTable).where(eq(retailerWatchlistTable.addedBy, "user"));
      for (const u of userRows) {
        if (curatedNorms.has(brandNorm(u.brand))) {
          await db.delete(retailerWatchlistTable).where(eq(retailerWatchlistTable.id, u.id));
        }
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

// ── Related news — recent headlines for a brand from Google News RSS (free, no
//    key). Surfaces WHY a retailer is on the watchlist when adding/editing. ─────
interface NewsArticle { title: string; link: string; source: string; publishedAt: string | null }

function parseGoogleNews(xml: string): NewsArticle[] {
  const decode = (s: string) => s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .trim();
  const out: NewsArticle[] = [];
  for (const chunk of xml.split(/<item>/i).slice(1)) {
    const block = chunk.split(/<\/item>/i)[0] || "";
    const pick = (tag: string): string | null => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? m[1].trim() : null;
    };
    const link = pick("link");
    const rawTitle = pick("title");
    if (!link || !rawTitle) continue;
    const source = pick("source");
    const src = source ? decode(source) : "";
    let title = decode(rawTitle);
    // Google formats titles as "Headline - Source"; trim the trailing source.
    if (src && title.endsWith(` - ${src}`)) title = title.slice(0, title.length - src.length - 3).trim();
    const pubDate = pick("pubDate");
    const d = pubDate ? new Date(pubDate) : null;
    out.push({ title, link: decode(link), source: src, publishedAt: d && !isNaN(d.getTime()) ? d.toISOString() : null });
  }
  return out;
}

// GET /api/watchlist/news?brand=AMC Theatres — recent retail-health headlines.
router.get("/watchlist/news", requireAuth, async (req, res) => {
  const brand = typeof req.query.brand === "string" ? req.query.brand.trim() : "";
  if (!brand) { res.status(400).json({ error: "brand is required" }); return; }
  try {
    const q = encodeURIComponent(
      `"${brand}" when:180d (stores OR retail OR bankruptcy OR closing OR closures OR earnings OR layoffs OR sales)`,
    );
    const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetchWithTimeout(url, 10_000);
    if (!r.ok) throw new Error(`news HTTP ${r.status}`);
    const xml = await r.text();
    res.json({ brand, articles: parseGoogleNews(xml).slice(0, 6) });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch watchlist news");
    // Soft-fail: the modal still works without news.
    res.json({ brand, articles: [], error: "news unavailable" });
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
