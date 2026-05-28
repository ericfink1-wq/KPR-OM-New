import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  type: text("type").notNull().default("other"),
  message: text("message").notNull(),
  name: text("name"),
  page: text("page"),
  userAgent: text("user_agent"),
  resolved: boolean("resolved").notNull().default(false),
  emailStatus: text("email_status"),
  emailError: text("email_error"),
});
