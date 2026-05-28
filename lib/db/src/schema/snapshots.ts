import { pgTable, serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

export const snapshotsTable = pgTable("snapshots", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason").notNull().default("auto"),
  dealCount: integer("deal_count").notNull().default(0),
  data: jsonb("data").notNull().$type<{
    deals: { id: string; data: Record<string, unknown> }[];
    sources: { id: string; sourceText: string | null }[];
  }>(),
});
