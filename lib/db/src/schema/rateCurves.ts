import { pgTable, text, date, timestamp, jsonb } from "drizzle-orm/pg-core";

// SOFR swap curves read off DTCC's public swap data (end-of-day + intraday) and curves
// pasted by hand. Runtime-provisioned by ensureRateCurvesTable() (api-server
// lib/rateCurves.ts) AND declared here so the publish diff never proposes a DROP —
// column defs match that CREATE TABLE exactly (schemaRuntimeDrift.test.ts holds them to it).
export const rateCurvesTable = pgTable("rate_curves", {
  id: text("id").primaryKey(),
  curveDate: date("curve_date").notNull(),
  kind: text("kind").notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull().defaultNow(),
  source: text("source").notNull().default(""),
  points: jsonb("points").notNull(),
  enteredBy: text("entered_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RateCurveRow = typeof rateCurvesTable.$inferSelect;
