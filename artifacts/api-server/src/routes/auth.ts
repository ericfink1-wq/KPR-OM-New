import { Router } from "express";
import type { Request } from "express";
import { randomBytes } from "crypto";
import { db, usersTable, loginEventsTable } from "@workspace/db";
import { eq, and, gt, desc, sql } from "drizzle-orm";
import { hashPassword, verifyPassword, validatePassword, sha256 } from "../lib/password";
import { requireAuth, requireAdmin } from "../middleware/auth";

const router = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "efink@kprcenters.com").trim().toLowerCase();

const normEmail = (v: unknown) => typeof v === "string" ? v.trim().toLowerCase() : "";
const genId = () => `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Create the users table if it doesn't exist (Eric can't run migrations), and
// seed the owner admin account from ADMIN_PASSWORD so it exists pre-approved and
// can't be squatted. ON CONFLICT DO NOTHING — never overwrites a later password
// change. Idempotent; runs once per process.
let tableReady: Promise<void> | null = null;
export function ensureUsersTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS users (
          id text PRIMARY KEY,
          email text NOT NULL UNIQUE,
          password_hash text NOT NULL,
          name text,
          status text NOT NULL DEFAULT 'pending',
          is_admin boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          approved_at timestamptz,
          approved_by text,
          last_login_at timestamptz
        )
      `);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash text`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires timestamptz`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS login_events (
          id text PRIMARY KEY,
          user_id text,
          email text,
          success boolean NOT NULL,
          ip text,
          user_agent text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      if (ADMIN_PASSWORD) {
        await db.execute(sql`
          INSERT INTO users (id, email, password_hash, name, status, is_admin, approved_at, approved_by)
          VALUES (${"usr_owner"}, ${OWNER_EMAIL}, ${hashPassword(ADMIN_PASSWORD)}, ${"KPR Admin"}, 'approved', true, now(), 'system')
          ON CONFLICT (email) DO NOTHING
        `);
      }
    })().catch((err) => { tableReady = null; throw err; });
  }
  return tableReady;
}

// Best-effort: email the owner when someone requests an account. Reuses the
// Resend setup used for feedback. Never throws to the caller.
async function notifyNewSignup(email: string, name: string | null): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const to = process.env.SIGNUP_EMAIL_TO || process.env.FEEDBACK_EMAIL_TO || "efink@kprcenters.com";
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "KPR OM Database <onboarding@resend.dev>",
      to,
      subject: `New account request: ${email}`,
      text: `${name || "(no name given)"} <${email}> requested access to the KPR OM Database.\n\nApprove or decline them in the app: open Members (admin menu) → Approve.`,
    }),
  });
}

// Brute-force lockout: block an email after too many recent failures.
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;

function clientIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.ip || null;
}

async function recordLoginEvent(req: Request, email: string, userId: string | null, success: boolean): Promise<void> {
  try {
    await db.insert(loginEventsTable).values({
      id: `le_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      userId, email: email || null, success,
      ip: clientIp(req),
      userAgent: (typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "").slice(0, 300) || null,
    });
  } catch { /* best-effort audit */ }
}

// Best-effort: tell a user their account was approved. Never throws to the caller.
async function notifyApproved(email: string, name: string | null, loginUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "KPR OM Database <onboarding@resend.dev>",
      to: email,
      subject: "You're approved — KPR OM Database",
      text: `${name ? name + "," : "Hi,"}\n\nYour account for the KPR OM Database has been approved. You can now sign in with the email and password you created when you requested access:\n\n${loginUrl}\n\nIf you've forgotten your password, use the "Forgot password?" link on the sign-in screen.`,
    }),
  });
}

// Best-effort: email a password-reset link. Never throws to the caller.
async function sendResetEmail(email: string, link: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "KPR OM Database <onboarding@resend.dev>",
      to: email,
      subject: "Reset your KPR OM Database password",
      text: `We received a request to reset your password.\n\nReset it here (this link expires in 1 hour):\n${link}\n\nIf you didn't request this, you can safely ignore this email.`,
    }),
  });
}

// POST /api/auth/register — create a pending account
router.post("/auth/register", async (req, res) => {
  try {
    await ensureUsersTable();
    const body = req.body as Record<string, unknown>;
    const email = normEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
    if (!EMAIL_RE.test(email)) { res.status(400).json({ error: "Please enter a valid email address." }); return; }
    const pwErr = validatePassword(password, email);
    if (pwErr) { res.status(400).json({ error: pwErr }); return; }
    const existing = (await db.select().from(usersTable).where(eq(usersTable.email, email)))[0];
    if (existing) { res.status(409).json({ error: "An account with that email already exists. Try signing in." }); return; }
    await db.insert(usersTable).values({
      id: genId(), email, passwordHash: hashPassword(password), name, status: "pending", isAdmin: false,
    });
    void notifyNewSignup(email, name).catch(() => { /* best-effort */ });
    res.status(201).json({ ok: true, status: "pending" });
  } catch (err) {
    req.log.error({ err }, "Registration failed");
    res.status(500).json({ error: "Registration failed — please try again." });
  }
});

// POST /api/auth/login — email + password
router.post("/auth/login", async (req, res) => {
  try {
    await ensureUsersTable();
    const body = req.body as Record<string, unknown>;
    const email = normEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    // Brute-force lockout — too many recent failed attempts for this email.
    if (email) {
      const since = new Date(Date.now() - FAIL_WINDOW_MS);
      const fails = await db.select().from(loginEventsTable)
        .where(and(eq(loginEventsTable.email, email), eq(loginEventsTable.success, false), gt(loginEventsTable.createdAt, since)));
      if (fails.length >= MAX_FAILS) {
        await recordLoginEvent(req, email, null, false);
        res.status(429).json({ error: "Too many failed attempts. Please wait about 15 minutes and try again." });
        return;
      }
    }
    const user = (await db.select().from(usersTable).where(eq(usersTable.email, email)))[0];
    if (!user || !verifyPassword(password, user.passwordHash)) {
      await recordLoginEvent(req, email, user?.id ?? null, false);
      res.status(401).json({ error: "Incorrect email or password." });
      return;
    }
    if (user.status !== "approved") {
      await recordLoginEvent(req, email, user.id, false);
      res.status(403).json({ error: user.status === "rejected"
        ? "Your account request was declined. Contact the administrator."
        : "Your account is awaiting approval. You'll be able to sign in once it's approved." });
      return;
    }
    req.session.authenticated = true;
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.userName = user.name ?? null;
    req.session.isAdmin = user.isAdmin;
    req.session.loginAt = Date.now();
    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
    await recordLoginEvent(req, email, user.id, true);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Login failed");
    res.status(500).json({ error: "Login failed — please try again." });
  }
});

// POST /api/auth/logout
router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => { res.json({ ok: true }); });
});

// POST /api/auth/admin-unlock — legacy fallback elevation via ADMIN_PASSWORD
// (account admins already get isAdmin on login; kept so the 5-tap still works).
router.post("/auth/admin-unlock", (req, res) => {
  if (!req.session.authenticated) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { password } = req.body as { password?: string };
  if (!ADMIN_PASSWORD || !password || password !== ADMIN_PASSWORD) {
    res.status(403).json({ error: "Invalid admin password" });
    return;
  }
  req.session.isAdmin = true;
  res.json({ ok: true });
});

// POST /api/auth/admin-lock
router.post("/auth/admin-lock", (req, res) => {
  req.session.isAdmin = false;
  res.json({ ok: true });
});

// GET /api/auth/me
router.get("/auth/me", (req, res) => {
  res.json({
    authenticated: !!req.session.authenticated,
    isAdmin: !!req.session.isAdmin,
    email: req.session.userEmail || null,
    name: req.session.userName || null,
  });
});

// POST /api/auth/change-password — the signed-in user changes their own password
router.post("/auth/change-password", requireAuth, async (req, res) => {
  try {
    await ensureUsersTable();
    if (!req.session.userId) { res.status(400).json({ error: "Please sign out and sign in again, then retry." }); return; }
    const body = req.body as Record<string, unknown>;
    const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const next = typeof body.newPassword === "string" ? body.newPassword : "";
    const pwErr = validatePassword(next, req.session.userEmail || undefined);
    if (pwErr) { res.status(400).json({ error: pwErr }); return; }
    const user = (await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId)))[0];
    if (!user) { res.status(404).json({ error: "Account not found." }); return; }
    if (!verifyPassword(current, user.passwordHash)) { res.status(403).json({ error: "Current password is incorrect." }); return; }
    await db.update(usersTable).set({ passwordHash: hashPassword(next) }).where(eq(usersTable.id, user.id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Change password failed");
    res.status(500).json({ error: "Could not change password — please try again." });
  }
});

// POST /api/auth/forgot-password — email a reset link (generic response always,
// so it never reveals whether an email is registered).
router.post("/auth/forgot-password", async (req, res) => {
  try {
    await ensureUsersTable();
    const email = normEmail((req.body as Record<string, unknown>).email);
    if (EMAIL_RE.test(email)) {
      const user = (await db.select().from(usersTable).where(eq(usersTable.email, email)))[0];
      if (user && user.status === "approved") {
        const token = randomBytes(32).toString("hex");
        await db.update(usersTable)
          .set({ resetTokenHash: sha256(token), resetTokenExpires: new Date(Date.now() + 60 * 60 * 1000) })
          .where(eq(usersTable.id, user.id));
        const origin = (typeof req.headers.origin === "string" && req.headers.origin) || `https://${req.headers.host}`;
        const link = `${origin}/?reset=1&email=${encodeURIComponent(email)}&token=${token}`;
        void sendResetEmail(email, link).catch(() => { /* best-effort */ });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Forgot-password failed");
    res.json({ ok: true });
  }
});

// POST /api/auth/reset-password — set a new password using an emailed token
router.post("/auth/reset-password", async (req, res) => {
  try {
    await ensureUsersTable();
    const body = req.body as Record<string, unknown>;
    const email = normEmail(body.email);
    const token = typeof body.token === "string" ? body.token : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    const pwErr = validatePassword(newPassword, email);
    if (pwErr) { res.status(400).json({ error: pwErr }); return; }
    const user = (await db.select().from(usersTable).where(eq(usersTable.email, email)))[0];
    if (!user || !user.resetTokenHash || !user.resetTokenExpires ||
        user.resetTokenExpires.getTime() < Date.now() || sha256(token) !== user.resetTokenHash) {
      res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
      return;
    }
    await db.update(usersTable)
      .set({ passwordHash: hashPassword(newPassword), resetTokenHash: null, resetTokenExpires: null })
      .where(eq(usersTable.id, user.id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Reset-password failed");
    res.status(500).json({ error: "Could not reset password — please try again." });
  }
});

// ── Admin: account management ────────────────────────────────────────────────
// GET /api/auth/login-events — recent sign-in activity (success + failures)
router.get("/auth/login-events", requireAdmin, async (_req, res) => {
  await ensureUsersTable();
  const rows = await db.select().from(loginEventsTable).orderBy(desc(loginEventsTable.createdAt)).limit(100);
  res.json(rows.map(e => ({ id: e.id, email: e.email, success: e.success, ip: e.ip, createdAt: e.createdAt })));
});

// GET /api/auth/users — list all accounts (pending first)
router.get("/auth/users", requireAdmin, async (_req, res) => {
  await ensureUsersTable();
  const rows = await db.select().from(usersTable);
  const rank = (s: string) => s === "pending" ? 0 : s === "approved" ? 1 : 2;
  rows.sort((a, b) => rank(a.status) - rank(b.status) || a.email.localeCompare(b.email));
  res.json(rows.map(u => ({
    id: u.id, email: u.email, name: u.name, status: u.status, isAdmin: u.isAdmin,
    createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
  })));
});

// POST /api/auth/users/:id/approve
router.post("/auth/users/:id/approve", requireAdmin, async (req, res) => {
  await ensureUsersTable();
  const [row] = await db.update(usersTable)
    .set({ status: "approved", approvedAt: new Date(), approvedBy: req.session.userEmail || "admin" })
    .where(eq(usersTable.id, String(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  // Let the newly-approved user know they can sign in now (best-effort).
  const origin = (typeof req.headers.origin === "string" && req.headers.origin) || `https://${req.headers.host}`;
  notifyApproved(row.email, row.name, origin).catch(() => { /* best-effort */ });
  res.json({ ok: true });
});

// POST /api/auth/users/:id/reject
router.post("/auth/users/:id/reject", requireAdmin, async (req, res) => {
  await ensureUsersTable();
  if (String(req.params.id) === req.session.userId) { res.status(400).json({ error: "You can't decline your own account." }); return; }
  await db.update(usersTable).set({ status: "rejected" }).where(eq(usersTable.id, String(req.params.id)));
  res.json({ ok: true });
});

// POST /api/auth/users/:id/set-admin  { isAdmin: boolean }
router.post("/auth/users/:id/set-admin", requireAdmin, async (req, res) => {
  await ensureUsersTable();
  const makeAdmin = !!(req.body as Record<string, unknown>).isAdmin;
  if (String(req.params.id) === req.session.userId && !makeAdmin) { res.status(400).json({ error: "You can't remove your own admin access." }); return; }
  await db.update(usersTable).set({ isAdmin: makeAdmin }).where(eq(usersTable.id, String(req.params.id)));
  res.json({ ok: true });
});

// DELETE /api/auth/users/:id — remove an account entirely
router.delete("/auth/users/:id", requireAdmin, async (req, res) => {
  await ensureUsersTable();
  if (String(req.params.id) === req.session.userId) { res.status(400).json({ error: "You can't remove your own account." }); return; }
  await db.delete(usersTable).where(eq(usersTable.id, String(req.params.id)));
  res.json({ ok: true });
});

export default router;
