import { pgTable, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

// MCP access keys — the bearer tokens that let an outside Claude client (Claude
// Desktop / Claude Code / a claude.ai custom connector) read this deal library
// through the Model Context Protocol endpoint at /api/mcp.
//
// The RAW key is shown exactly once at creation and is never stored: only its
// SHA-256 hash lives here, plus a short display prefix so a key can be told apart
// in the admin list. Revocation is a timestamp (never a delete) so the audit trail
// of who had access — and when it was cut off — survives.
//
// Runtime-provisioned by ensureMcpKeysTable() (CREATE TABLE IF NOT EXISTS); declared
// here so the deploy's schema-diff recognizes it instead of proposing to DROP it.
// THIS DECLARATION MUST MIRROR THAT RUNTIME DDL EXACTLY — column nullability AND
// indexes. A mismatch (e.g. NOT NULL here vs nullable there) is not cosmetic: the
// diff can't ALTER its way across it, so it proposes DROP TABLE ... CASCADE and
// every live key is destroyed on publish. That happened once; don't let it recur.
export const mcpKeysTable = pgTable("mcp_api_keys", {
  id: text("id").primaryKey(),
  // The OWNER. A key acts as this user and is only valid while that account is an
  // approved KPR account — so removing someone's login removes their MCP access with it,
  // rather than leaving an orphaned credential that outlives their employment.
  //
  // NULLABLE at the database level to match the runtime DDL (the column was added
  // via ADD COLUMN IF NOT EXISTS, which can't be NOT NULL over existing rows). The
  // invariant is enforced in code instead, and it FAILS CLOSED: verifyMcpKey()
  // rejects any key whose userId is null, so an ownerless key can never authenticate.
  userId: text("user_id"),
  name: text("name").notNull(),                       // human label: "Eric — laptop", "Sarah — desktop"
  keyHash: text("key_hash").notNull(),                // sha256(raw key) — the raw key is never stored
  keyPrefix: text("key_prefix").notNull(),            // e.g. "kpr_mcp_a1b2…" for display only
  scope: text("scope").notNull().default("read"),     // read-only today; reserved for future write scopes
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),                      // user id that performed the mint
  createdByEmail: text("created_by_email"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  useCount: integer("use_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),  // null = no expiry
  revokedAt: timestamp("revoked_at", { withTimezone: true }),  // null = still active
  revokedBy: text("revoked_by"),
}, (t) => ({
  // Names and uniqueness must match ensureMcpKeysTable() in
  // artifacts/api-server/src/lib/mcpKeys.ts.
  hashIdx: uniqueIndex("mcp_api_keys_hash_idx").on(t.keyHash),
  userIdx: index("mcp_api_keys_user_idx").on(t.userId),
}));

export type McpKeyRow = typeof mcpKeysTable.$inferSelect;
export type InsertMcpKey = typeof mcpKeysTable.$inferInsert;
