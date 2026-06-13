import { pgTable, text, jsonb, integer, timestamp } from "drizzle-orm/pg-core";

// Site agreements / REAs: a structured, reconciled abstract of a CENTER-LEVEL
// recorded agreement (Operating Agreement / OEA / Reciprocal Easement / Pad
// Declaration / use-restriction / cost-share / utility easement) that binds the
// land rather than a single tenant. Mirrors lease_abstracts, but keyed to a deal
// and an AGREEMENT NAME (not a roster tenant) — because REAs are property-level.
// The whole reconciled abstract lives in `data` (jsonb) — see the SiteAgreement
// interface in artifacts/om-database/src/lib/idb.ts for the field-name source of
// truth. Source documents are NOT stored here; each finding cites its document.
export const siteAgreementsTable = pgTable("site_agreements", {
  id: text("id").primaryKey(),
  dealId: text("deal_id").notNull(),
  agreementName: text("agreement_name").notNull(),
  data: jsonb("data").notNull().$type<Record<string, unknown>>(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SiteAgreementRow = typeof siteAgreementsTable.$inferSelect;
export type InsertSiteAgreement = typeof siteAgreementsTable.$inferInsert;
