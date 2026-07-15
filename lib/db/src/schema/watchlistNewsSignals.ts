import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

// Latest auto-scanned news signal per watched retailer brand (see
// artifacts/api-server/src/lib/watchlistNews.ts). Runtime-provisioned
// (CREATE TABLE IF NOT EXISTS) AND declared here so Drizzle recognizes it as a
// managed table and never proposes a destructive migration to DROP it — same
// pattern as extraction_lessons. Rows are cheap and fully regeneratable (the
// fortnightly scan rebuilds them), but a spurious DROP warning on every deploy is
// noise we don't want. Column defs match the CREATE TABLE statement exactly.
export const watchlistNewsSignalsTable = pgTable("watchlist_news_signals", {
  brandNorm: text("brand_norm").primaryKey(),
  brand: text("brand").notNull(),
  suggestedStatus: text("suggested_status"),
  exceedsCurrent: boolean("exceeds_current").notNull().default(false),
  headline: text("headline"),
  url: text("url"),
  headlineAt: timestamp("headline_at", { withTimezone: true }),
  scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WatchlistNewsSignalRow = typeof watchlistNewsSignalsTable.$inferSelect;
