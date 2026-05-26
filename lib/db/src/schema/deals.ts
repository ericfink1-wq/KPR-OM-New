import { pgTable, text, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";

export const dealsTable = pgTable("deals", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const dealImagesTable = pgTable("deal_images", {
  id: text("id").primaryKey(),
  cover: text("cover"),
  coverThumb: text("cover_thumb"),
  sitePlan: jsonb("site_plan").$type<string[]>(),
  pagePicks: jsonb("page_picks").$type<{ page: number; img: string }[]>(),
  needsSitePlanPick: boolean("needs_site_plan_pick"),
});

export const dealSourcesTable = pgTable("deal_sources", {
  id: text("id").primaryKey(),
  sourceText: text("source_text"),
});

export type DealRow = typeof dealsTable.$inferSelect;
export type DealImageRow = typeof dealImagesTable.$inferSelect;
export type DealSourceRow = typeof dealSourcesTable.$inferSelect;
