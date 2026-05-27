import { pgTable, serial, text, doublePrecision, date, boolean, timestamp } from "drizzle-orm/pg-core";

export const tenantIndexTable = pgTable("tenant_index", {
  id: serial("id").primaryKey(),
  dealId: text("deal_id").notNull(),
  dealName: text("deal_name"),
  rawName: text("raw_name"),
  canonicalName: text("canonical_name"),
  sf: doublePrecision("sf"),
  rentPerSf: doublePrecision("rent_per_sf"),
  annualRent: doublePrecision("annual_rent"),
  leaseExpiry: text("lease_expiry"),
  leaseExpiryDate: date("lease_expiry_date"),
  leaseType: text("lease_type"),
  creditRating: text("credit_rating"),
  isAnchor: boolean("is_anchor"),
  dealStatus: text("deal_status"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TenantIndexRow = typeof tenantIndexTable.$inferSelect;
