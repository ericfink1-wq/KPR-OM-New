import { pgTable, text, integer, jsonb, date, timestamp } from "drizzle-orm/pg-core";

// Self-improvement bookkeeping tables (see artifacts/api-server/src/lib/selfImprove.ts).
// Both are runtime-provisioned (CREATE TABLE IF NOT EXISTS) AND declared here so
// Drizzle treats them as managed and never proposes a destructive migration — same
// pattern as extraction_lessons. Column defs match the CREATE TABLE statements exactly.

// Daily metrics snapshot of the extraction-audit health (one row per day).
export const auditHistoryTable = pgTable("audit_history", {
  day: date("day").primaryKey(),
  dealsWithIssues: integer("deals_with_issues").notNull().default(0),
  totalIssues: integer("total_issues").notNull().default(0),
  dealsScanned: integer("deals_scanned").notNull().default(0),
  breakdown: jsonb("breakdown"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Last-run tracker for cadenced (non-daily) self-improvement jobs, keyed by job kind
// (e.g. 'autofix' weekly, 'watchlist-news' fortnightly).
export const selfImproveRunsTable = pgTable("self_improve_runs", {
  kind: text("kind").primaryKey(),
  lastRun: date("last_run").notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditHistoryRow = typeof auditHistoryTable.$inferSelect;
export type SelfImproveRunRow = typeof selfImproveRunsTable.$inferSelect;
