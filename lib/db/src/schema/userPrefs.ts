import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

// Per-user settings (loan-sizer default base rate + last-used inputs). Runtime-provisioned
// by ensureUserPrefsTable() (api-server lib/userPrefs.ts) AND declared here so the publish
// diff never proposes a DROP — column defs match that CREATE TABLE exactly
// (schemaRuntimeDrift.test.ts holds them to it).
export const userPrefsTable = pgTable("user_prefs", {
  userId: text("user_id").primaryKey(),
  prefs: jsonb("prefs").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserPrefsRow = typeof userPrefsTable.$inferSelect;
