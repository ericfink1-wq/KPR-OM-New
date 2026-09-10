import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";

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
export const mcpKeysTable = pgTable("mcp_api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),                       // human label: "Eric — laptop", "Analyst: Sarah"
  keyHash: text("key_hash").notNull(),                // sha256(raw key) — the raw key is never stored
  keyPrefix: text("key_prefix").notNull(),            // e.g. "kpr_mcp_a1b2…" for display only
  scope: text("scope").notNull().default("read"),     // read-only today; reserved for future write scopes
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),                      // admin user id that minted it
  createdByEmail: text("created_by_email"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  useCount: integer("use_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),  // null = no expiry
  revokedAt: timestamp("revoked_at", { withTimezone: true }),  // null = still active
  revokedBy: text("revoked_by"),
});

export type McpKeyRow = typeof mcpKeysTable.$inferSelect;
export type InsertMcpKey = typeof mcpKeysTable.$inferInsert;
