import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

// Asset Management (owned properties). Runtime-provisioned by ensureAssetMgmtTables()
// (api-server lib/assetMgmt.ts) AND declared here so the publish diff never proposes a
// DROP — column defs match those CREATE TABLEs exactly (schemaRuntimeDrift.test.ts).
export const amRecordsTable = pgTable("am_records", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  dealId: text("deal_id"),
  data: jsonb("data").notNull().default({}),
  sourceNote: text("source_note"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const datexBuildingMapTable = pgTable("datex_building_map", {
  dealId: text("deal_id").primaryKey(),
  propertyName: text("property_name"),
  bldgIds: jsonb("bldg_ids").notNull().default([]),
  note: text("note"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AmRecordRow = typeof amRecordsTable.$inferSelect;
export type DatexBuildingMapRow = typeof datexBuildingMapTable.$inferSelect;
