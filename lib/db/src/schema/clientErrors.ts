import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const clientErrorsTable = pgTable("client_errors", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  message: text("message").notNull(),
  stack: text("stack"),
  route: text("route"),
  userAgent: text("user_agent"),
});
