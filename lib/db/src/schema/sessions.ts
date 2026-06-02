import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

// Session store table for connect-pg-simple (DB-backed express sessions). Defined
// here so drizzle-kit knows it should exist and Replit's publish diff never
// proposes to DROP it. Structure must match what connect-pg-simple expects:
// sid (pkey), sess (json), expire (timestamp). Also provisioned at runtime via
// ensureSessionTable() so it exists without a manual migration.
export const sessionTable = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6, mode: "date" }).notNull(),
}, (t) => ({
  expireIdx: index("IDX_session_expire").on(t.expire),
}));
