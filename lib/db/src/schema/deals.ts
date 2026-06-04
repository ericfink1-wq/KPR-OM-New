import { pgTable, text, jsonb, timestamp, boolean, bigserial } from "drizzle-orm/pg-core";

// Diagnostic trace tables (operational telemetry, not deal data): img_trace records
// recent image-save attempts (/api/image-save-diag), upload_trace records per-OM
// extraction timing (/api/upload-timing). Declared here so the deploy's schema-diff
// recognizes them and stops proposing to DROP the runtime-created versions.
export const imgTraceTable = pgTable("img_trace", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  data: jsonb("data").notNull(),
});

export const uploadTraceTable = pgTable("upload_trace", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  data: jsonb("data").notNull(),
});

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
