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
//   ingest_token_temp — SHORT-LIVED tokens (kpr_dxt_…, 3 h) minted by the MCP tool
//                   datex_refresh_credentials. Never listed with the permanent tokens.
//   ingest_audit  — who minted a short-lived token, when, via which key (newest 200 kept).
//   ingest_setting — the on/off switch for Datex auto-refresh (default ON).

export const INGEST_TOKEN_PREFIX = "kpr_dx_";
export const TEMP_TOKEN_PREFIX = "kpr_dxt_";
export const TEMP_TOKEN_TTL_MS = 3 * 60 * 60 * 1000;
export const MAX_ACTIVE_TEMP_TOKENS_PER_USER = 10;
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

/** Which kind a presented token is looked up as — by prefix, so a short-lived token can
 *  never be matched against (or listed with) the permanent ones. */
export function tokenKindFor(raw: string): "ingest_token" | "ingest_token_temp" | null {
  if (raw.startsWith(TEMP_TOKEN_PREFIX)) return raw.length >= TEMP_TOKEN_PREFIX.length + 30 ? "ingest_token_temp" : null;
  if (raw.startsWith(INGEST_TOKEN_PREFIX)) return raw.length >= INGEST_TOKEN_PREFIX.length + 30 ? "ingest_token" : null;
  return null;
}
/** A stored token row is usable when it isn't revoked and — for a short-lived one — hasn't
 *  expired. A short-lived row with no expiry is refused (fail closed). */
export function tokenRowUsable(data: Record<string, unknown>, temp: boolean, now = Date.now()): boolean {
  if (data.revokedAt) return false;
  if (temp && !(Date.parse(String(data.expiresAt ?? "")) > now)) return false;
  return true;
}

/** Verify a Bearer token. Fails closed: unknown, revoked, malformed, or a token whose
 *  creating account is no longer approved (offboarding the admin offboards the token). */
export async function verifyIngestToken(raw: string, now = Date.now()): Promise<{ id: string; label: string } | null> {
  const kind = tokenKindFor(raw);
  if (!kind) return null;
  const temp = kind === "ingest_token_temp";
  await ensureAssetMgmtTables();
  const h = hashToken(raw);
  const r = await db.execute(sql`SELECT id, kind, deal_id, data, updated_at FROM am_records WHERE kind = ${kind} AND data->>'hash' = ${h} LIMIT 1`);
  const row = (r.rows as unknown as Row[])[0];
  if (!row || !tokenRowUsable(row.data, temp, now)) return null;
  const uid = row.data.createdByUserId as string | null;
  if (uid) {
    const [u] = await db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.id, uid)).limit(1);
    if (!u || u.status !== "approved") return null;
  }
  const last = Date.parse(String(row.data.lastUsedAt ?? "")) || 0;
  if (Date.now() - last > 60_000) void put(row.id, kind, null, { ...row.data, lastUsedAt: new Date().toISOString() }, "ingest").catch(() => {});
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

// ── on/off switch ───────────────────────────────────────────────────────────
const SETTING_ID = "ingest_setting:datex_auto";
export interface AutoRefreshSetting { enabled: boolean; updatedBy: string | null; updatedAt: string | null }
export async function getAutoRefreshSetting(): Promise<AutoRefreshSetting> {
  const r = (await rows("ingest_setting")).find(x => x.id === SETTING_ID);
  return { enabled: r ? r.data.enabled !== false : true, updatedBy: (r?.data.updatedBy as string) ?? null, updatedAt: (r?.data.updatedAt as string) ?? null };
}
export async function setAutoRefreshEnabled(enabled: boolean, by: string): Promise<AutoRefreshSetting> {
  const data = { enabled, updatedBy: by, updatedAt: new Date().toISOString() };
  await put(SETTING_ID, "ingest_setting", null, data, by);
  return data;
}

// ── short-lived tokens (minted by the MCP tool) ─────────────────────────────
export interface MintedTempToken { token: string; id: string; expiresAt: string }
export async function mintTempIngestToken(by: { userId: string; email: string; via: string }, now = Date.now()): Promise<MintedTempToken | { problem: string }> {
  const live = (await rows("ingest_token_temp")).filter(r => r.data.createdByUserId === by.userId && Date.parse(String(r.data.expiresAt)) > now && !r.data.revokedAt);
  if (live.length >= MAX_ACTIVE_TEMP_TOKENS_PER_USER) return { problem: `You already have ${live.length} unexpired refresh tokens — wait for one to expire (they last 3 hours).` };
  const raw = `${TEMP_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const id = `ingest_token_temp:${now.toString(36)}${randomBytes(3).toString("hex")}`;
  const expiresAt = new Date(now + TEMP_TOKEN_TTL_MS).toISOString();
  await put(id, "ingest_token_temp", null, { label: `Short-lived (${by.via})`, hash: hashToken(raw), createdAt: new Date(now).toISOString(), createdBy: by.email, createdByUserId: by.userId, via: by.via, expiresAt }, by.email);
  await put(`ingest_audit:${new Date(now).toISOString()}:${randomBytes(2).toString("hex")}`, "ingest_audit", null,
    { at: new Date(now).toISOString(), event: "temp-token-minted", tokenId: id, by: by.email, userId: by.userId, via: by.via, expiresAt }, by.email);
  // Housekeeping: tokens expired over a day ago are deleted (the audit entry keeps the record).
  await db.execute(sql`DELETE FROM am_records WHERE kind = 'ingest_token_temp' AND (data->>'expiresAt')::timestamptz < now() - interval '1 day'`);
  await db.execute(sql`DELETE FROM am_records WHERE kind = 'ingest_audit' AND id NOT IN (SELECT id FROM am_records WHERE kind = 'ingest_audit' ORDER BY id DESC LIMIT 200)`);
  return { token: raw, id, expiresAt };
}
export interface IngestAudit { at: string; event: string; by: string; via: string; expiresAt: string }
export async function listIngestAudit(limit = 10): Promise<IngestAudit[]> {
  return (await rows("ingest_audit")).map(r => r.data as unknown as IngestAudit).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
