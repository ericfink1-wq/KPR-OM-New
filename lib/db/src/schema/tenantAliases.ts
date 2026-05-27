import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const tenantAliasesTable = pgTable("tenant_aliases", {
  rawName: text("raw_name").primaryKey(),
  canonicalName: text("canonical_name").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type TenantAlias = typeof tenantAliasesTable.$inferSelect;
export type InsertTenantAlias = typeof tenantAliasesTable.$inferInsert;
