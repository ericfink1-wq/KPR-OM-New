import { pgTable, text, jsonb, integer, timestamp } from "drizzle-orm/pg-core";

// Lease abstracts: a structured, reconciled summary of an anchor/tenant's full
// lease document set (original lease + amendments + assignments + guaranties +
// option exercises + waivers), keyed to a deal and a roster tenant by name.
// The whole reconciled abstract lives in `data` (jsonb) — see the LeaseAbstract
// interface in artifacts/om-database/src/lib/idb.ts for the field-name source of
// truth. Source documents are NOT stored here; each field cites its document
// name, section, and page so the user can find the original on their own server.
export const leaseAbstractsTable = pgTable("lease_abstracts", {
  id: text("id").primaryKey(),
  dealId: text("deal_id").notNull(),
  tenantName: text("tenant_name").notNull(),
  data: jsonb("data").notNull().$type<Record<string, unknown>>(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type LeaseAbstractRow = typeof leaseAbstractsTable.$inferSelect;
export type InsertLeaseAbstract = typeof leaseAbstractsTable.$inferInsert;
