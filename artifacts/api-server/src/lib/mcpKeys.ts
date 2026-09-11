// MCP access keys — mint / list / revoke / verify.
//
// These gate the Model Context Protocol endpoint (/api/mcp), which is how a Claude
// client reads this deal library. The site's normal login is a session COOKIE, which an
// MCP client cannot hold, so MCP gets its own credential: a long random bearer token,
// stored only as a SHA-256 hash.
//
// ACCESS IS TIED TO A KPR ACCOUNT (Eric's requirement, 9/10/26: only KPR employees, using
// their own credentials). Two things enforce that:
//   1. A key is minted only by a signed-in user FOR THEMSELVES — you cannot obtain one
//      without first passing password + 2FA as an approved member.
//   2. Every request re-checks the OWNING ACCOUNT, not just the key. The moment that
//      account stops being approved — rejected, reset to pending, or deleted — the key
//      stops working, with nothing further to remember. Offboarding a person offboards
//      their MCP access as a side effect, which is the only way it reliably happens.
// Read-only by design — nothing here can write to the library.
import { db, mcpKeysTable, usersTable } from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { randomBytes, createHash, timingSafeEqual } from "crypto";

export const KEY_PREFIX = "kpr_mcp_";

// A person has a laptop, a desktop, maybe a phone — not twenty. Capping active keys per
// account stops both the accidental case (someone re-minting instead of reusing, leaving a
// trail of live credentials nobody tracks) and the deliberate one (an authenticated user
// filling the table). Generous enough that nobody legitimate will hit it; low enough that
// the admin's list stays readable and every live key is one somebody can account for.
export const MAX_ACTIVE_KEYS_PER_USER = 20;

// SHA-256 is the right primitive here (not scrypt, which guards low-entropy human
// passwords): the key is 32 bytes of CSPRNG randomness, so there is nothing to
// brute-force, and the hash has to be cheap enough to run on every MCP request.
const hashKey = (raw: string) => createHash("sha256").update(raw).digest("hex");

let tableReady: Promise<void> | null = null;
export function ensureMcpKeysTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS mcp_api_keys (
          id text PRIMARY KEY,
          user_id text,
          name text NOT NULL,
          key_hash text NOT NULL,
          key_prefix text NOT NULL,
          scope text NOT NULL DEFAULT 'read',
          created_at timestamptz NOT NULL DEFAULT now(),
          created_by text,
          created_by_email text,
          last_used_at timestamptz,
          use_count integer NOT NULL DEFAULT 0,
          expires_at timestamptz,
          revoked_at timestamptz,
          revoked_by text
        )
      `);
      await db.execute(sql`ALTER TABLE mcp_api_keys ADD COLUMN IF NOT EXISTS user_id text`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS mcp_api_keys_hash_idx ON mcp_api_keys (key_hash)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS mcp_api_keys_user_idx ON mcp_api_keys (user_id)`);
    })().catch((err) => { tableReady = null; throw err; });
  }
  return tableReady;
}

export interface McpKeySummary {
  id: string;
  userId: string | null;
  ownerEmail: string | null;
  name: string;
  keyPrefix: string;
  scope: string;
  createdAt: string;
  createdByEmail: string | null;
  lastUsedAt: string | null;
  useCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  active: boolean;
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export function summarize(row: typeof mcpKeysTable.$inferSelect): McpKeySummary {
  const expired = !!row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now();
  return {
    id: row.id,
    userId: (row as { userId?: string | null }).userId ?? null,
    ownerEmail: row.createdByEmail ?? null,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scope: row.scope,
    createdAt: new Date(row.createdAt).toISOString(),
    createdByEmail: row.createdByEmail ?? null,
    lastUsedAt: iso(row.lastUsedAt),
    useCount: row.useCount ?? 0,
    expiresAt: iso(row.expiresAt),
    revokedAt: iso(row.revokedAt),
    active: !row.revokedAt && !expired,
  };
}

// Mint a new key. The RAW key is returned once and never persisted — the caller
// must show it to the admin immediately; it can never be recovered afterwards.
export async function createMcpKey(opts: {
  /** The account this key acts as. Required — an unowned key cannot be tied to an
   *  employee, so there is no way to mint one. */
  userId: string;
  name: string;
  createdBy?: string | null;
  createdByEmail?: string | null;
  expiresInDays?: number | null;
}): Promise<{ key: string; summary: McpKeySummary }> {
  if (!opts.userId) throw new Error("createMcpKey requires the owning userId");
  await ensureMcpKeysTable();
  const live = await db.select({ id: mcpKeysTable.id }).from(mcpKeysTable)
    .where(and(eq(mcpKeysTable.userId, opts.userId), isNull(mcpKeysTable.revokedAt)));
  if (live.length >= MAX_ACTIVE_KEYS_PER_USER) {
    throw Object.assign(
      new Error(`You already have ${live.length} active keys (the limit is ${MAX_ACTIVE_KEYS_PER_USER}). Turn off one you no longer use before creating another.`),
      { code: "key_limit_reached" },
    );
  }
  await ensureMcpKeysTable();
  const name = (opts.name || "").trim().slice(0, 120) || "Unnamed key";
  // 32 bytes of entropy, base64url — long enough that guessing is hopeless.
  const raw = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const id = `mcpk_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const expiresAt = opts.expiresInDays && opts.expiresInDays > 0
    ? new Date(Date.now() + opts.expiresInDays * 86400_000)
    : null;
  const row = {
    id,
    userId: opts.userId,
    name,
    keyHash: hashKey(raw),
    keyPrefix: raw.slice(0, KEY_PREFIX.length + 6),
    scope: "read",
    createdBy: opts.createdBy ?? null,
    createdByEmail: opts.createdByEmail ?? null,
    expiresAt,
  };
  await db.insert(mcpKeysTable).values(row);
  const [saved] = await db.select().from(mcpKeysTable).where(eq(mcpKeysTable.id, id)).limit(1);
  return { key: raw, summary: summarize(saved!) };
}

export async function listMcpKeys(userId?: string | null): Promise<McpKeySummary[]> {
  await ensureMcpKeysTable();
  const q = db.select().from(mcpKeysTable);
  const rows = userId
    ? await q.where(eq(mcpKeysTable.userId, userId)).orderBy(desc(mcpKeysTable.createdAt))
    : await q.orderBy(desc(mcpKeysTable.createdAt));
  return rows.map(summarize);
}

/** The owner of a key, for authorising a revoke/delete by a non-admin. */
export async function keyOwner(id: string): Promise<string | null> {
  await ensureMcpKeysTable();
  const [row] = await db.select({ userId: mcpKeysTable.userId }).from(mcpKeysTable).where(eq(mcpKeysTable.id, id)).limit(1);
  return row?.userId ?? null;
}

// Revocation is a timestamp, never a delete — the record of who had access (and
// when it was cut off) is the point of the audit trail.
export async function revokeMcpKey(id: string, revokedBy?: string | null): Promise<boolean> {
  await ensureMcpKeysTable();
  const res = await db.update(mcpKeysTable)
    .set({ revokedAt: new Date(), revokedBy: revokedBy ?? null })
    .where(and(eq(mcpKeysTable.id, id), isNull(mcpKeysTable.revokedAt)))
    .returning({ id: mcpKeysTable.id });
  return res.length > 0;
}

export async function deleteMcpKey(id: string): Promise<boolean> {
  await ensureMcpKeysTable();
  const res = await db.delete(mcpKeysTable).where(eq(mcpKeysTable.id, id)).returning({ id: mcpKeysTable.id });
  return res.length > 0;
}

export interface VerifiedKey { id: string; name: string; scope: string; userId: string; email: string }

// Constant-time hash comparison. The lookup is by hash (indexed), so the DB does
// the matching; this guards the final confirmation against a timing oracle.
function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ── THE BREAK-GLASS KEY, HELD OUTSIDE THE DATABASE ───────────────────────────────
// Every key above lives in mcp_api_keys, which means it dies with that table. On this
// deployment that is not hypothetical: the publish step compares the development
// database against production, decides a table it can only see in production must have
// been deleted, and proposes DROP TABLE — which has destroyed the live key more than
// once, breaking the connector each time with no way to recover the secret (only its
// hash was ever stored).
//
// So one key may be supplied by the environment instead. It is never written to the
// database, so nothing the publish step does can remove it, and the connector survives.
// Deliberately NOT a bypass of the "KPR employees, using their credentials" rule:
//   • It names an OWNER by email, and that account must still exist and be approved —
//     same check every stored key passes, on every request.
//   • Both variables are required. One without the other disables it, rather than
//     silently falling back to something weaker.
//   • It must meet the same length bar as a minted key, so a short secret can't become
//     a credential to the whole library.
// Rotate by changing the secret; revoke by deleting it or un-approving the owner.
const STATIC_KEY = () => (process.env.MCP_STATIC_KEY ?? "").trim();
const STATIC_KEY_EMAIL = () => (process.env.MCP_STATIC_KEY_EMAIL ?? "").trim().toLowerCase();
const MIN_KEY_BODY = 20;

/** Is the environment-held key configured well enough to be usable at all? */
export function staticKeyStatus(): { configured: boolean; reason: string | null; email: string | null } {
  const k = STATIC_KEY(), e = STATIC_KEY_EMAIL();
  if (!k && !e) return { configured: false, reason: null, email: null };
  if (!k) return { configured: false, reason: "MCP_STATIC_KEY_EMAIL is set but MCP_STATIC_KEY is missing", email: e };
  if (!e) return { configured: false, reason: "MCP_STATIC_KEY is set but MCP_STATIC_KEY_EMAIL is missing — a key with no named owner is not accepted", email: null };
  if (!k.startsWith(KEY_PREFIX) || k.length < KEY_PREFIX.length + MIN_KEY_BODY) {
    return { configured: false, reason: `MCP_STATIC_KEY must start with ${KEY_PREFIX} and carry at least ${MIN_KEY_BODY} more characters`, email: e };
  }
  return { configured: true, reason: null, email: e };
}

/** Look up an account by email, case-insensitively. Used to resolve the env key's owner
 *  and to explain, in the UI, exactly why a configured key is still being refused. */
export async function findUserByEmail(email: string): Promise<{ id: string; email: string; status: string } | null> {
  const [row] = await db
    .select({ id: usersTable.id, email: usersTable.email, status: usersTable.status })
    .from(usersTable).where(eq(sql`lower(${usersTable.email})`, email.trim().toLowerCase())).limit(1);
  return row ?? null;
}

async function verifyStaticKey(key: string): Promise<VerifiedKey | null> {
  const st = staticKeyStatus();
  if (!st.configured || !st.email) return null;
  // Compare the SHA-256 digests rather than the raw strings: equal-length buffers are
  // required for a constant-time compare, and hashing normalises that for free.
  if (!sameHash(hashKey(key), hashKey(STATIC_KEY()))) return null;
  const owner = await findUserByEmail(st.email);
  if (!owner || owner.status !== "approved") return null;
  return { id: "env-static", name: "Environment key (MCP_STATIC_KEY)", scope: "read", userId: owner.id, email: owner.email };
}

// Verify a raw key. Returns null for anything that isn't a live, unexpired,
// unrevoked key — callers must treat null as a hard 401, never as a soft failure.
export async function verifyMcpKey(raw: string | null | undefined): Promise<VerifiedKey | null> {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (!key.startsWith(KEY_PREFIX) || key.length < KEY_PREFIX.length + 20) return null;
  // Checked FIRST, and without touching mcp_api_keys — this is the path that has to keep
  // working when that table has just been dropped and recreated empty.
  const viaEnv = await verifyStaticKey(key);
  if (viaEnv) return viaEnv;
  await ensureMcpKeysTable();
  const hash = hashKey(key);
  const [row] = await db.select().from(mcpKeysTable).where(eq(mcpKeysTable.keyHash, hash)).limit(1);
  if (!row || !sameHash(row.keyHash, hash)) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return null;

  // THE ACCOUNT CHECK. A valid key is not enough — the person behind it must still be an
  // approved member. This is what makes "only KPR employees" true on an ongoing basis
  // rather than only at the moment the key was handed over: rejecting, un-approving or
  // deleting the account kills every key it owns on the very next request.
  if (!row.userId) return null;   // legacy/unowned key — fail closed, it ties to nobody
  const [owner] = await db
    .select({ id: usersTable.id, email: usersTable.email, status: usersTable.status })
    .from(usersTable).where(eq(usersTable.id, row.userId)).limit(1);
  if (!owner || owner.status !== "approved") return null;
  // Usage stamp is fire-and-forget so it never delays or fails the request.
  void db.update(mcpKeysTable)
    .set({ lastUsedAt: new Date(), useCount: sql`${mcpKeysTable.useCount} + 1` })
    .where(eq(mcpKeysTable.id, row.id))
    .catch(() => {});
  return { id: row.id, name: row.name, scope: row.scope, userId: owner.id, email: owner.email };
}

// Pull the key out of a request. Four shapes are accepted because different Claude
// clients can send different things:
//   1. Authorization: Bearer <key>   — Claude Code / Claude Desktop (preferred)
//   2. X-API-Key: <key>              — generic MCP clients
//   3. /api/mcp/k/<key>              — clients that only take a bare URL (claude.ai
//                                      custom connectors), so the secret rides in the path
//   4. ?key=<key>                    — last-resort fallback for the same reason
// Path and query keys are unavoidably more exposed (proxy logs, browser history), so
// the admin UI recommends the header form and every key stays independently revocable.
export function extractKeyFromRequest(req: {
  headers: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}): string | null {
  const header = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const auth = header(req.headers["authorization"]);
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m) return m[1]!.trim();
    if (auth.startsWith(KEY_PREFIX)) return auth;
  }
  const apiKey = header(req.headers["x-api-key"]);
  if (apiKey) return apiKey;
  const pathKey = req.params?.["key"];
  if (typeof pathKey === "string" && pathKey.trim()) return decodeURIComponent(pathKey.trim());
  const queryKey = req.query?.["key"];
  if (typeof queryKey === "string" && queryKey.trim()) return queryKey.trim();
  return null;
}
