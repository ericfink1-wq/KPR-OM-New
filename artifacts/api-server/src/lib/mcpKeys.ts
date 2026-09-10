// MCP access keys — mint / list / revoke / verify.
//
// These are the passwords that gate the Model Context Protocol endpoint (/api/mcp),
// which is how an outside Claude client reads this deal library. The site's normal
// login is a session COOKIE, which an MCP client can't hold, so MCP gets its own
// credential: a long random bearer token, stored only as a SHA-256 hash, mintable
// and revocable by an admin. No key = no access; a revoked key stops working on the
// next request. Read-only by design — nothing here can write to the library.
import { db, mcpKeysTable } from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { randomBytes, createHash, timingSafeEqual } from "crypto";

export const KEY_PREFIX = "kpr_mcp_";

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
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS mcp_api_keys_hash_idx ON mcp_api_keys (key_hash)`);
    })().catch((err) => { tableReady = null; throw err; });
  }
  return tableReady;
}

export interface McpKeySummary {
  id: string;
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
  name: string;
  createdBy?: string | null;
  createdByEmail?: string | null;
  expiresInDays?: number | null;
}): Promise<{ key: string; summary: McpKeySummary }> {
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

export async function listMcpKeys(): Promise<McpKeySummary[]> {
  await ensureMcpKeysTable();
  const rows = await db.select().from(mcpKeysTable).orderBy(desc(mcpKeysTable.createdAt));
  return rows.map(summarize);
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

export interface VerifiedKey { id: string; name: string; scope: string }

// Constant-time hash comparison. The lookup is by hash (indexed), so the DB does
// the matching; this guards the final confirmation against a timing oracle.
function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// Verify a raw key. Returns null for anything that isn't a live, unexpired,
// unrevoked key — callers must treat null as a hard 401, never as a soft failure.
export async function verifyMcpKey(raw: string | null | undefined): Promise<VerifiedKey | null> {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (!key.startsWith(KEY_PREFIX) || key.length < KEY_PREFIX.length + 20) return null;
  await ensureMcpKeysTable();
  const hash = hashKey(key);
  const [row] = await db.select().from(mcpKeysTable).where(eq(mcpKeysTable.keyHash, hash)).limit(1);
  if (!row || !sameHash(row.keyHash, hash)) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return null;
  // Usage stamp is fire-and-forget so it never delays or fails the request.
  void db.update(mcpKeysTable)
    .set({ lastUsedAt: new Date(), useCount: sql`${mcpKeysTable.useCount} + 1` })
    .where(eq(mcpKeysTable.id, row.id))
    .catch(() => {});
  return { id: row.id, name: row.name, scope: row.scope };
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
