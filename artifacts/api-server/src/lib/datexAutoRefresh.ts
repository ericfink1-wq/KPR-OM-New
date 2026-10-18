import { randomBytes, createHash } from "crypto";
import { sql, eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { ensureAssetMgmtTables } from "./assetMgmt";
import type { SalesRow } from "./datexIngest";

// DATEX AUTO-REFRESH storage (Eric, 10/18/26). NO NEW TABLES: everything lives in the
// existing am_records table under kinds that the member-facing record list never returns
// (it reads ENTRY_KINDS / "news" only):
//   ingest_token  — one row per scoped token: label, sha256 hash (the token itself is shown
//                   once and never stored), created/last-used/revoked stamps.
//   datex_sales   — per deal, the raw monthly SalesHistory rows (last 24 months), so a weekly
//                   job can APPEND new months instead of re-sending two years.
//   ingest_log    — one row per ingest call (dry runs included), newest 60 kept.

export const INGEST_TOKEN_PREFIX = "kpr_dx_";
export const INGEST_SCOPE = ["datex:ingest", "datex:state"] as const;
const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

interface Row { id: string; kind: string; deal_id: string | null; data: Record<string, unknown>; updated_at: string }
async function rows(kind: string): Promise<Row[]> {
  await ensureAssetMgmtTables();
  const r = await db.execute(sql`SELECT id, kind, deal_id, data, updated_at FROM am_records WHERE kind = ${kind} ORDER BY id`);
  return r.rows as unknown as Row[];
}
async function put(id: string, kind: string, dealId: string | null, data: Record<string, unknown>, by: string): Promise<void> {
  await ensureAssetMgmtTables();
  await db.execute(sql`INSERT INTO am_records (id, kind, deal_id, data, source_note, updated_by, updated_at)
    VALUES (${id}, ${kind}, ${dealId}, ${JSON.stringify(data)}::jsonb, ${null}, ${by}, now())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`);
}

// ── tokens ──────────────────────────────────────────────────────────────────
export interface IngestTokenView { id: string; label: string; display: string; scope: string[]; createdAt: string; createdBy: string | null; lastUsedAt: string | null; revokedAt: string | null }
const view = (r: Row): IngestTokenView => ({
  id: r.id, label: String(r.data.label ?? ""), display: String(r.data.display ?? ""), scope: [...INGEST_SCOPE],
  createdAt: String(r.data.createdAt ?? r.updated_at), createdBy: (r.data.createdBy as string) ?? null,
  lastUsedAt: (r.data.lastUsedAt as string) ?? null, revokedAt: (r.data.revokedAt as string) ?? null,
});
export async function listIngestTokens(): Promise<IngestTokenView[]> {
  return (await rows("ingest_token")).map(view).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export const MAX_ACTIVE_INGEST_TOKENS = 5;
export async function createIngestToken(label: string, by: { email: string; userId: string | null }): Promise<{ token: string; view: IngestTokenView } | { problem: string }> {
  const active = (await listIngestTokens()).filter(t => !t.revokedAt);
  if (active.length >= MAX_ACTIVE_INGEST_TOKENS) return { problem: `There are already ${active.length} active tokens — revoke one first.` };
  const raw = `${INGEST_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const id = `ingest_token:${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const data = { label: label.trim().slice(0, 80) || "Datex auto-refresh", hash: hashToken(raw), display: `${raw.slice(0, INGEST_TOKEN_PREFIX.length + 4)}…${raw.slice(-4)}`,
    createdAt: new Date().toISOString(), createdBy: by.email, createdByUserId: by.userId };
  await put(id, "ingest_token", null, data, by.email);
  return { token: raw, view: view({ id, kind: "ingest_token", deal_id: null, data, updated_at: data.createdAt }) };
}
export async function revokeIngestToken(id: string, by: string): Promise<boolean> {
  const r = (await rows("ingest_token")).find(x => x.id === id);
  if (!r) return false;
  if (!r.data.revokedAt) await put(id, "ingest_token", null, { ...r.data, revokedAt: new Date().toISOString(), revokedBy: by }, by);
  return true;
}

/** Verify a Bearer token. Fails closed: unknown, revoked, malformed, or a token whose
 *  creating account is no longer approved (offboarding the admin offboards the token). */
export async function verifyIngestToken(raw: string): Promise<{ id: string; label: string } | null> {
  if (!raw.startsWith(INGEST_TOKEN_PREFIX) || raw.length < INGEST_TOKEN_PREFIX.length + 30) return null;
  await ensureAssetMgmtTables();
  const h = hashToken(raw);
  const r = await db.execute(sql`SELECT id, kind, deal_id, data, updated_at FROM am_records WHERE kind = 'ingest_token' AND data->>'hash' = ${h} LIMIT 1`);
  const row = (r.rows as unknown as Row[])[0];
  if (!row || row.data.revokedAt) return null;
  const uid = row.data.createdByUserId as string | null;
  if (uid) {
    const [u] = await db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.id, uid)).limit(1);
    if (!u || u.status !== "approved") return null;
  }
  const last = Date.parse(String(row.data.lastUsedAt ?? "")) || 0;
  if (Date.now() - last > 60_000) void put(row.id, "ingest_token", null, { ...row.data, lastUsedAt: new Date().toISOString() }, "ingest").catch(() => {});
  return { id: row.id, label: String(row.data.label ?? "") };
}

// ── stored monthly sales ────────────────────────────────────────────────────
export async function loadSalesRows(): Promise<Map<string, SalesRow[]>> {
  const out = new Map<string, SalesRow[]>();
  for (const r of await rows("datex_sales")) if (r.deal_id) out.set(r.deal_id, (r.data.rows as SalesRow[]) ?? []);
  return out;
}
export async function saveSalesRows(dealId: string, salesRows: SalesRow[]): Promise<void> {
  await put(`datex_sales:${dealId}`, "datex_sales", dealId, { rows: salesRows }, "datex-ingest");
}

// ── run log ─────────────────────────────────────────────────────────────────
export interface IngestLog { at: string; dryRun: boolean; token: string; asOf: string | null; blocks: Record<string, number>; dealsChanged: number; dealsUnchanged: number; rejected: Array<{ dealId: string; problem: string }>; warnings: number; error?: string }
export const LOG_KEPT = 60;
export async function writeIngestLog(entry: IngestLog): Promise<void> {
  await put(`ingest_log:${entry.at}:${randomBytes(2).toString("hex")}`, "ingest_log", null, entry as unknown as Record<string, unknown>, "datex-ingest");
  await db.execute(sql`DELETE FROM am_records WHERE kind = 'ingest_log' AND id NOT IN (SELECT id FROM am_records WHERE kind = 'ingest_log' ORDER BY id DESC LIMIT ${LOG_KEPT})`);
}
export async function listIngestLogs(limit = 20): Promise<IngestLog[]> {
  return (await rows("ingest_log")).map(r => r.data as unknown as IngestLog).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
