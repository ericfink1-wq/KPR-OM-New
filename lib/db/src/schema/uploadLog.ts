import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Audit log of file uploads — powers the admin "Upload activity" view: what was
// uploaded, when, whether it succeeded or failed, and who did it.
export const uploadLogTable = pgTable("upload_log", {
  id: text("id").primaryKey(),
  fileName: text("file_name"),
  docType: text("doc_type"),          // om | rent-roll | lease-options | sales | unknown
  status: text("status").notNull(),   // success | failed
  detail: text("detail"),             // property name (success) or error message (failure)
  dealId: text("deal_id"),
  userId: text("user_id"),
  userEmail: text("user_email"),
  userName: text("user_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
