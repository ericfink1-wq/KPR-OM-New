import { describe, it, expect } from "vitest";
import { watchlistFreshness, WATCHLIST_CURATED_AS_OF, WATCHLIST_STALE_AFTER_DAYS } from "../watchlistFreshness";

describe("watchlistFreshness", () => {
  const asOfMs = new Date(WATCHLIST_CURATED_AS_OF + "T00:00:00Z").getTime();

  it("reports 0 age on the as-of date and is not stale", () => {
    const f = watchlistFreshness(new Date(asOfMs));
    expect(f.asOf).toBe(WATCHLIST_CURATED_AS_OF);
    expect(f.ageDays).toBe(0);
    expect(f.stale).toBe(false);
  });

  it("is NOT stale exactly at the threshold, and IS stale one day past it", () => {
    const atThreshold = new Date(asOfMs + WATCHLIST_STALE_AFTER_DAYS * 86_400_000);
    expect(watchlistFreshness(atThreshold).stale).toBe(false);
    const pastThreshold = new Date(asOfMs + (WATCHLIST_STALE_AFTER_DAYS + 1) * 86_400_000);
    const f = watchlistFreshness(pastThreshold);
    expect(f.stale).toBe(true);
    expect(f.ageDays).toBe(WATCHLIST_STALE_AFTER_DAYS + 1);
  });

  it("never returns a negative age for a clock earlier than the as-of date", () => {
    const before = new Date(asOfMs - 10 * 86_400_000);
    expect(watchlistFreshness(before).ageDays).toBe(0);
  });
});
