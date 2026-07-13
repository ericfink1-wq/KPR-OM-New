// FRESHNESS of the CURATED retailer-health list (see routes/watchlist.ts).
//
// The curated distress statuses are hand-refreshed by Claude from reputable trackers
// (Coresight, Retail Dive, RapidRatings, CNBC, Axios) and re-seeded into the DB on
// every deploy. There is NO live data feed, so the list is only as current as the
// last refresh. This module tracks how old the curation is so:
//   • the Watchlist UI can show an "as of <date>" freshness line, and
//   • the daily self-improvement job can log a reminder when it goes stale,
// prompting the operator to ask Claude to refresh it (bump WATCHLIST_CURATED_AS_OF).
//
// Update WATCHLIST_CURATED_AS_OF to today's date every time the CURATED list is
// refreshed — that single edit is what resets the freshness clock.
export const WATCHLIST_CURATED_AS_OF = "2026-07-13"; // YYYY-MM-DD — bump on each refresh
export const WATCHLIST_STALE_AFTER_DAYS = 45;

export interface WatchlistFreshness {
  asOf: string;            // YYYY-MM-DD the curated list was last refreshed
  ageDays: number;         // whole days since that date
  staleAfterDays: number;  // threshold past which we consider it stale
  stale: boolean;          // ageDays > staleAfterDays
}

export function watchlistFreshness(now: Date = new Date()): WatchlistFreshness {
  const asOfMs = new Date(WATCHLIST_CURATED_AS_OF + "T00:00:00Z").getTime();
  const ageDays = Number.isFinite(asOfMs)
    ? Math.max(0, Math.floor((now.getTime() - asOfMs) / 86_400_000))
    : 0;
  return {
    asOf: WATCHLIST_CURATED_AS_OF,
    ageDays,
    staleAfterDays: WATCHLIST_STALE_AFTER_DAYS,
    stale: ageDays > WATCHLIST_STALE_AFTER_DAYS,
  };
}
