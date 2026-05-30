import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// Persistent record of the user's tenant-name audit decisions (merge / dismiss),
// keyed by the pair id used in the UI. This is the source of truth so decisions
// survive across browsers and devices and never re-prompt. Merges ALSO write
// tenant_aliases (which the backend applies to the tenant index); dismisses live
// only here (they just suppress a split suggestion).
export const tenantDecisionsTable = pgTable("tenant_decisions", {
  id: text("id").primaryKey(),                 // pair id, e.g. "name_a||name_b"
  type: text("type").notNull(),                // "merge" | "dismiss"
  nameA: text("name_a"),
  nameB: text("name_b"),
  canonical: text("canonical"),                // merge only
  variants: jsonb("variants").$type<string[]>(), // merge only
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type TenantDecision = typeof tenantDecisionsTable.$inferSelect;
export type InsertTenantDecision = typeof tenantDecisionsTable.$inferInsert;
