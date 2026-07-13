// AUTO-REFRESH for the retailer-health watchlist.
//
// The curated distress STATUSES are Claude's hand-authored judgment calls and can't
// refresh themselves. But retail-health NEWS is live, so every WATCHLIST_NEWS_REFRESH_DAYS
// the self-improvement scheduler scans Google News (free RSS, no key) for each watched
// brand and, when a RECENT headline signals a MORE SEVERE condition than the stored
// status (e.g. a "watch" name now has "files for Chapter 11" headlines), records a
// review signal against that brand. It NEVER silently rewrites a status — a single
// noisy headline shouldn't flip a tenant to "bankruptcy" — it flags the brand so the
// operator (or Claude) confirms and updates the curated entry. Deterministic + token-free.
//
// Signals live in their own side table (managed in-code like audit_history), so the
// curated retailer_watchlist rows and Eric's own entries are never touched.

import { db, retailerWatchlistTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { fetchWithTimeout } from "./http";
import { logger } from "./logger";

export const WATCHLIST_NEWS_REFRESH_DAYS = 14; // auto-scan cadence (~every 2 weeks)

export interface NewsArticle { title: string; link: string; source: string; publishedAt: string | null }

// Google News formats titles as "Headline - Source"; parse item blocks from the RSS.
export function parseGoogleNews(xml: string): NewsArticle[] {
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
    if (src && title.endsWith(` - ${src}`)) title = title.slice(0, title.length - src.length - 3).trim();
    const pubDate = pick("pubDate");
    const d = pubDate ? new Date(pubDate) : null;
    out.push({ title, link: decode(link), source: src, publishedAt: d && !isNaN(d.getTime()) ? d.toISOString() : null });
  }
  return out;
}

// Recent retail-health headlines for one brand. Throws on network/HTTP failure so the
// caller can count it as an error (soft-fail) rather than record a false "all clear".
export async function fetchBrandNews(brand: string, timeoutMs = 10_000): Promise<NewsArticle[]> {
  const q = encodeURIComponent(
    `"${brand}" when:180d (stores OR retail OR bankruptcy OR closing OR closures OR earnings OR layoffs OR sales)`,
  );
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const r = await fetchWithTimeout(url, timeoutMs);
  if (!r.ok) throw new Error(`news HTTP ${r.status}`);
  return parseGoogleNews(await r.text());
}

// Status severity ladder (higher = worse). Used to decide whether news is an escalation.
const RANK: Record<string, number> = { watch: 1, distressed: 2, bankruptcy: 3, liquidating: 4 };

// Distress keyword → the status level it implies, ordered most-severe first.
const SIGNALS: Array<{ level: string; re: RegExp }> = [
  { level: "liquidating", re: /\b(liquidat\w*|going out of business|winding down|closing all|shutting down all|ceased operations|gob sale)\b/i },
  { level: "bankruptcy",  re: /\b(chapter 11|files? for bankruptcy|filed for bankruptcy|bankruptcy protection|bankruptcy filing|declares bankruptcy)\b/i },
  { level: "distressed",  re: /\b(mass (store )?closures?|closing \d{2,}|store closures|store closings|credit downgrade|debt default|going concern)\b/i },
];
// Headlines that MENTION distress words but mean the opposite — never escalate on these.
const NEGATION = /\b(avoids?|averts?|avoided|emerg\w* from|exit(s|ed)?|escap\w*|no longer|not (in|facing|filing)|denies|rejects|stav\w* off)\b/i;

export interface NewsSignal {
  suggestedStatus: string;
  exceedsCurrent: boolean;
  headline: string;
  url: string;
  at: string | null;
}

// Scan recent (<~5 months) headlines and return the MOST-SEVERE distress signal found,
// or null. Negation headlines ("avoids bankruptcy") are skipped so they don't false-fire.
export function assessNews(articles: NewsArticle[], currentStatus: string, now: Date = new Date()): NewsSignal | null {
  const cutoff = now.getTime() - 150 * 86_400_000;
  const recent = articles.filter((a) => {
    if (!a.publishedAt) return false;
    const t = new Date(a.publishedAt).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  for (const s of SIGNALS) {
    const hit = recent.find((a) => s.re.test(a.title) && !NEGATION.test(a.title));
    if (hit) {
      return {
        suggestedStatus: s.level,
        exceedsCurrent: (RANK[s.level] ?? 0) > (RANK[currentStatus] ?? 0),
        headline: hit.title,
        url: hit.link,
        at: hit.publishedAt,
      };
    }
  }
  return null;
}

export function brandNorm(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Side table for the latest news signal per brand — created in-code (like audit_history)
// so no migration is needed and the curated table is never altered.
let newsTableReady: Promise<void> | null = null;
export function ensureWatchlistNewsTable(): Promise<void> {
  if (!newsTableReady) {
    newsTableReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS watchlist_news_signals (
          brand_norm text PRIMARY KEY,
          brand text NOT NULL,
          suggested_status text,
          exceeds_current boolean NOT NULL DEFAULT false,
          headline text,
          url text,
          headline_at timestamptz,
          scanned_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    })().catch((err) => { newsTableReady = null; throw err; });
  }
  return newsTableReady;
}

export interface NewsRefreshResult { scanned: number; flagged: number; errors: number; skipped: number }

// Scan live news for every watched brand and upsert its signal. Best-effort: per-brand
// failures are counted, never fatal. Liquidating (defunct) brands are skipped — there's
// nothing worse to escalate to. Only records a review flag when news EXCEEDS the stored
// status; otherwise the signal is cleared (news is consistent with the curated status).
export async function refreshWatchlistNews(): Promise<NewsRefreshResult> {
  await ensureWatchlistNewsTable();
  const rows = await db.select().from(retailerWatchlistTable);
  let scanned = 0, flagged = 0, errors = 0, skipped = 0;
  for (const r of rows) {
    if ((r.status || "") === "liquidating") { skipped++; continue; }
    try {
      const articles = await fetchBrandNews(r.brand);
      const sig = assessNews(articles, r.status || "watch");
      scanned++;
      const flag = sig?.exceedsCurrent ? sig : null;
      await db.execute(sql`
        INSERT INTO watchlist_news_signals (brand_norm, brand, suggested_status, exceeds_current, headline, url, headline_at, scanned_at)
        VALUES (${brandNorm(r.brand)}, ${r.brand}, ${flag?.suggestedStatus ?? null}, ${!!flag}, ${flag?.headline ?? null}, ${flag?.url ?? null}, ${flag?.at ?? null}, now())
        ON CONFLICT (brand_norm) DO UPDATE SET
          brand = EXCLUDED.brand, suggested_status = EXCLUDED.suggested_status,
          exceeds_current = EXCLUDED.exceeds_current, headline = EXCLUDED.headline,
          url = EXCLUDED.url, headline_at = EXCLUDED.headline_at, scanned_at = now()
      `);
      if (flag) flagged++;
      await new Promise((res) => setTimeout(res, 300)); // be polite to the RSS endpoint
    } catch {
      errors++;
    }
  }
  logger.info({ scanned, flagged, errors, skipped }, "Watchlist news auto-refresh complete");
  return { scanned, flagged, errors, skipped };
}

export interface StoredNewsSignal {
  suggestedStatus: string | null; exceedsCurrent: boolean;
  headline: string | null; url: string | null; headlineAt: string | null; scannedAt: string | null;
}

// brand_norm -> latest stored signal, for merging into GET /watchlist.
export async function getWatchlistNewsSignals(): Promise<Map<string, StoredNewsSignal>> {
  await ensureWatchlistNewsTable();
  const res = await db.execute(sql`SELECT brand_norm, suggested_status, exceeds_current, headline, url, headline_at, scanned_at FROM watchlist_news_signals`);
  const m = new Map<string, StoredNewsSignal>();
  for (const row of (res.rows ?? []) as Array<Record<string, unknown>>) {
    m.set(String(row.brand_norm), {
      suggestedStatus: (row.suggested_status as string) ?? null,
      exceedsCurrent: !!row.exceeds_current,
      headline: (row.headline as string) ?? null,
      url: (row.url as string) ?? null,
      headlineAt: row.headline_at ? new Date(row.headline_at as string).toISOString() : null,
      scannedAt: row.scanned_at ? new Date(row.scanned_at as string).toISOString() : null,
    });
  }
  return m;
}
