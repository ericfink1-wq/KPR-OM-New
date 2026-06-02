import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

// Audit log of sign-in attempts (success and failure) — powers the admin
// activity view and brute-force lockout.
export const loginEventsTable = pgTable("login_events", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  email: text("email"),
  success: boolean("success").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
