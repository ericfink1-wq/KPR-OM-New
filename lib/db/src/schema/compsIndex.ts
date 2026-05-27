import { pgTable, serial, text, doublePrecision, date, timestamp } from "drizzle-orm/pg-core";

export const compsIndexTable = pgTable("comps_index", {
  id: serial("id").primaryKey(),
  sourceDealId: text("source_deal_id").notNull(),
  sourceDealName: text("source_deal_name"),
  sourceDealMarket: text("source_deal_market"),
  name: text("name"),
  address: text("address"),
  market: text("market"),
  saleDateRaw: text("sale_date_raw"),
  saleDate: date("sale_date"),
  salePrice: doublePrecision("sale_price"),
  capRate: doublePrecision("cap_rate"),
  pricePerSf: doublePrecision("price_per_sf"),
  sf: doublePrecision("sf"),
  occupancy: doublePrecision("occupancy"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CompsIndexRow = typeof compsIndexTable.$inferSelect;
