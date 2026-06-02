import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

// Operator-taught extraction rules. When Eric catches an extraction mistake he
// records a plain-English lesson here; active lessons are injected into the
// AI extraction prompts (OM / rent-roll / sales) so the system "learns" from
// corrections. Runtime-provisioned (CREATE TABLE IF NOT EXISTS) like the users
// table, so Replit never proposes a destructive migration.
export const extractionLessonsTable = pgTable("extraction_lessons", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull().default("all"), // all | om | rent-roll | sales
  lesson: text("lesson").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
});

export type ExtractionLessonRow = typeof extractionLessonsTable.$inferSelect;
