import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Curated watchlist of at-risk retailers. Cross-referenced against every deal's
// tenant roster (client-side, via the canonical tenantKey matcher) to surface
// portfolio exposure to distressed chains. Editable by any signed-in user.
// Built curated/manual; structured so a future job could auto-set status from
// bankruptcy/closure feeds without a schema change.
export const retailerWatchlistTable = pgTable("retailer_watchlist", {
  id: text("id").primaryKey(),
  brand: text("brand").notNull(),              // display name, e.g. "Party City"
  status: text("status").notNull(),            // watch | distressed | bankruptcy | liquidating
  note: text("note"),                          // optional context
  sourceUrl: text("source_url"),               // optional link to news/filing
  addedBy: text("added_by"),                   // "admin" | "user" — informational
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type RetailerWatchlistRow = typeof retailerWatchlistTable.$inferSelect;
export type InsertRetailerWatchlist = typeof retailerWatchlistTable.$inferInsert;
