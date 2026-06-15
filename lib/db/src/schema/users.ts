import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

// User accounts for per-user login with admin approval. Replaces the single
// shared password. status: "pending" (awaiting admin approval) → "approved"
// (can log in) | "rejected". isAdmin grants approval powers + admin features.
export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  status: text("status").notNull().default("pending"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: text("approved_by"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  resetTokenHash: text("reset_token_hash"),
  resetTokenExpires: timestamp("reset_token_expires", { withTimezone: true }),
  // Email verification — proves the registrant controls the address before an
  // admin can approve them. Existing approved users are grandfathered as verified.
  emailVerified: boolean("email_verified").notNull().default(false),
  verifyTokenHash: text("verify_token_hash"),
  verifyTokenExpires: timestamp("verify_token_expires", { withTimezone: true }),
  // Two-factor authentication (TOTP / authenticator app). totpSecret holds the
  // confirmed base32 secret once enabled; totpPendingSecret holds it during
  // enrollment (before the first code is verified); totpBackupCodes is a JSON array
  // of sha256-hashed single-use recovery codes.
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  totpSecret: text("totp_secret"),
  totpPendingSecret: text("totp_pending_secret"),
  totpBackupCodes: text("totp_backup_codes"),
});
