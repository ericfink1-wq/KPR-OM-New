// API layer — replaces IndexedDB with backend calls
// All functions maintain the same signatures as idb.ts for easy drop-in replacement

import type { Deal, ImageBundle, LeaseAbstract, SiteAgreement } from "./idb";
import { normalizeDeal } from "./utils";
import type { CompInput } from "./compsSummary";
import { beginSave, endSaveOk, endSaveError } from "./saveStatus";

const BASE = "/api";

async function apiFetch(path: string, opts?: RequestInit): Promise<Response> {
  const resp = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    ...opts,
  });
  return resp;
}

// Fire-and-forget telemetry to the same store the ErrorBoundary uses, so failures
// that the UI otherwise swallows (e.g. image saves wrapped in .catch) still leave a
// readable trace at GET /api/client-errors/recent (admin). Never throws.
export function reportClientError(message: string, detail?: string): void {
  try {
    fetch(`${BASE}/client-errors`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message.slice(0, 2000),
        stack: (detail ?? "").slice(0, 8000),
        route: typeof window !== "undefined" ? window.location.pathname : null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
      }),
    }).catch(() => undefined);
  } catch { /* never throw from the reporter */ }
}

// --- Auth ---

export async function apiLogin(email: string, password: string): Promise<{ ok: boolean; error?: string; needsVerification?: boolean; twoFactorRequired?: boolean }> {
  try {
    const resp = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({})) as { error?: string; needsVerification?: boolean };
      return { ok: false, error: body.error || "Login failed", needsVerification: body.needsVerification };
    }
    const body = await resp.json().catch(() => ({})) as { twoFactorRequired?: boolean };
    if (body.twoFactorRequired) return { ok: false, twoFactorRequired: true };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and that the app finished publishing, then try again." };
  }
}

// Second login step when 2FA is enabled: submit the authenticator (or backup) code.
export async function apiVerify2fa(code: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await apiFetch("/auth/2fa/verify", { method: "POST", body: JSON.stringify({ code }) });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error || "Verification failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again in a moment." };
  }
}

export interface TwoFactorStatus { enabled: boolean; backupCodesRemaining: number }
export async function api2faStatus(): Promise<TwoFactorStatus> {
  try {
    const resp = await apiFetch("/auth/2fa/status");
    if (!resp.ok) return { enabled: false, backupCodesRemaining: 0 };
    return await resp.json() as TwoFactorStatus;
  } catch { return { enabled: false, backupCodesRemaining: 0 }; }
}
export async function api2faSetup(): Promise<{ ok: boolean; secret?: string; otpauthUri?: string; qrDataUrl?: string; error?: string }> {
  const resp = await apiFetch("/auth/2fa/setup", { method: "POST" });
  const body = await resp.json().catch(() => ({})) as { secret?: string; otpauthUri?: string; qrDataUrl?: string; error?: string };
  return resp.ok ? { ok: true, ...body } : { ok: false, error: body.error || "Could not start setup" };
}
export async function api2faEnable(code: string): Promise<{ ok: boolean; backupCodes?: string[]; error?: string }> {
  const resp = await apiFetch("/auth/2fa/enable", { method: "POST", body: JSON.stringify({ code }) });
  const body = await resp.json().catch(() => ({})) as { backupCodes?: string[]; error?: string };
  return resp.ok ? { ok: true, backupCodes: body.backupCodes } : { ok: false, error: body.error || "Could not enable two-factor" };
}
export async function api2faDisable(opts: { code?: string; password?: string }): Promise<{ ok: boolean; error?: string }> {
  const resp = await apiFetch("/auth/2fa/disable", { method: "POST", body: JSON.stringify(opts) });
  const body = await resp.json().catch(() => ({})) as { error?: string };
  return resp.ok ? { ok: true } : { ok: false, error: body.error || "Could not disable two-factor" };
}
// Periodic step-up within a live session.
export async function api2faReverify(code: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await apiFetch("/auth/2fa/reverify", { method: "POST", body: JSON.stringify({ code }) });
    if (!resp.ok) { const body = await resp.json().catch(() => ({})) as { error?: string }; return { ok: false, error: body.error || "Verification failed" }; }
    return { ok: true };
  } catch { return { ok: false, error: "Couldn't reach the server. Try again in a moment." }; }
}

// --- What's new ---

// How far back to summarise shipped changes for this reader. Returns null when the
// server can't say (brand-new account, or the lookup failed) — the modal then stays
// shut rather than dumping the whole history on someone.
export async function apiWhatsNewCutoff(): Promise<{ cutoff: string | null; basis: "seen" | "previous-login" | "none" }> {
  try {
    const resp = await apiFetch("/auth/whats-new");
    if (!resp.ok) return { cutoff: null, basis: "none" };
    return await resp.json() as { cutoff: string | null; basis: "seen" | "previous-login" | "none" };
  } catch { return { cutoff: null, basis: "none" }; }
}

// Mark the list as read up to now. Fire-and-forget: failing to record this just
// means the reader sees the same entries again, which is not worth an error toast.
export async function apiWhatsNewSeen(): Promise<void> {
  try { await apiFetch("/auth/whats-new/seen", { method: "POST" }); } catch { /* non-critical */ }
}

export async function apiRegister(name: string, email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error || "Could not create account" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again in a moment." };
  }
}

export async function apiLogout(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" });
}

export async function apiChangePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const resp = await apiFetch("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: body.error || "Could not change password" };
  }
  return { ok: true };
}

export interface AuthState { authenticated: boolean; isAdmin: boolean; isOwner?: boolean; email: string | null; name: string | null; twoFactorPending?: boolean; needs2faSetup?: boolean; needs2faReverify?: boolean }
export async function apiCheckAuth(): Promise<AuthState> {
  try {
    const resp = await apiFetch("/auth/me");
    if (!resp.ok) return { authenticated: false, isAdmin: false, email: null, name: null };
    const body = await resp.json() as { authenticated?: boolean; isAdmin?: boolean; isOwner?: boolean; email?: string | null; name?: string | null; twoFactorPending?: boolean; needs2faSetup?: boolean; needs2faReverify?: boolean };
    return { authenticated: !!body.authenticated, isAdmin: !!body.isAdmin, isOwner: !!body.isOwner, email: body.email ?? null, name: body.name ?? null, twoFactorPending: !!body.twoFactorPending, needs2faSetup: !!body.needs2faSetup, needs2faReverify: !!body.needs2faReverify };
  } catch {
    return { authenticated: false, isAdmin: false, email: null, name: null };
  }
}

export async function apiForgotPassword(email: string): Promise<void> {
  await apiFetch("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
}

export async function apiVerifyEmail(email: string, token: string): Promise<{ ok: boolean; error?: string }> {
  const resp = await apiFetch("/auth/verify-email", { method: "POST", body: JSON.stringify({ email, token }) });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: body.error || "Verification failed" };
  }
  return { ok: true };
}
export async function apiResendVerification(email: string): Promise<void> {
  await apiFetch("/auth/resend-verification", { method: "POST", body: JSON.stringify({ email }) }).catch(() => { /* generic */ });
}
export async function apiVerifyMember(id: string): Promise<void> { await apiFetch(`/auth/users/${id}/verify`, { method: "POST" }); }
export async function apiResetPassword(email: string, token: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const resp = await apiFetch("/auth/reset-password", { method: "POST", body: JSON.stringify({ email, token, newPassword }) });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: body.error || "Could not reset password" };
  }
  return { ok: true };
}

// --- Admin: member accounts ---
export interface LoginEvent { id: string; email: string | null; success: boolean; ip: string | null; createdAt: string }
export async function apiLoginEvents(): Promise<LoginEvent[]> {
  const resp = await apiFetch("/auth/login-events");
  if (!resp.ok) return [];
  return await resp.json().catch(() => []) as LoginEvent[];
}

// --- Upload activity log ---
/** What one upload did: created a deal / was added to one / was skipped / was turned away
 *  ("Not an OM — not added") / failed. Legacy rows say success. */
export type UploadResult = "created" | "attached" | "skipped" | "rejected" | "failed";
export interface UploadLogEntry {
  id: string; fileName: string | null; docType: string | null; status: string;
  detail: string | null; dealId: string | null;
  userEmail: string | null; userName: string | null; createdAt: string;
  result?: UploadResult; dealName?: string | null; dealExists?: boolean;
}
// Record one upload outcome (best-effort; the WHO is filled in server-side from
// the session). Never throws — logging must never break the upload flow.
export async function apiRecordUpload(e: { fileName: string; docType?: string | null; status: UploadResult | "success"; detail?: string | null; dealId?: string | null }): Promise<void> {
  try { await apiFetch("/upload-log", { method: "POST", body: JSON.stringify(e) }); } catch { /* non-fatal */ }
}
export async function apiUploadLog(f: { user?: string; from?: string; to?: string; result?: string; limit?: number } = {}): Promise<UploadLogEntry[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") qs.set(k, String(v));
  const resp = await apiFetch(`/upload-log${qs.toString() ? `?${qs}` : ""}`);
  if (!resp.ok) return [];
  return await resp.json().catch(() => []) as UploadLogEntry[];
}
// A deal's upload provenance (shown on the deal page). Any signed-in user can read it.
// `createdBy` = who created the deal (null = before upload tracking — `inferredCreator`
// is only a guess); `lastUpload` = the most recent upload that created or added to it.
export interface UploadPerson { userName: string | null; userEmail: string | null; at: string | null }
export interface UploadHistoryEntry { id: string; fileName: string | null; docType: string | null; result: UploadResult; detail: string | null; userName: string | null; userEmail: string | null; at: string }
export interface DealUploader {
  userName: string | null; userEmail: string | null; at: string | null; inferred?: boolean;
  createdBy?: UploadPerson | null; lastUpload?: UploadPerson | null; history?: UploadHistoryEntry[];
  inferredCreator?: { userName: string | null; userEmail: string | null } | null;
}
export async function apiDealUploadedBy(dealId: string): Promise<DealUploader | null> {
  try {
    const resp = await apiFetch(`/upload-log/by-deal/${encodeURIComponent(dealId)}`);
    if (!resp.ok) return null;
    return await resp.json().catch(() => null) as DealUploader | null;
  } catch { return null; }
}

// Change the name a member is shown as (admin). Throws with the server's message.
export async function apiRenameMember(id: string, name: string): Promise<void> {
  const r = await apiFetch(`/auth/users/${id}/rename`, { method: "POST", body: JSON.stringify({ name }) });
  if (!r.ok) {
    const j = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(j.error || "Couldn't rename.");
  }
}

export interface MemberAccount { id: string; email: string; name: string | null; status: string; isAdmin: boolean; emailVerified?: boolean; createdAt: string; lastLoginAt: string | null; lastSeenAt?: string | null }
export async function apiListMembers(): Promise<MemberAccount[]> {
  const resp = await apiFetch("/auth/users");
  if (!resp.ok) return [];
  return await resp.json().catch(() => []) as MemberAccount[];
}
export async function apiApproveMember(id: string): Promise<{ emailSent: boolean; emailDetail?: string }> {
  const r = await apiFetch(`/auth/users/${id}/approve`, { method: "POST" });
  const j = await r.json().catch(() => ({})) as { emailSent?: boolean; emailDetail?: string };
  return { emailSent: j.emailSent !== false, emailDetail: j.emailDetail };
}
export async function apiRejectMember(id: string): Promise<void> { await apiFetch(`/auth/users/${id}/reject`, { method: "POST" }); }
export async function apiSetMemberAdmin(id: string, isAdmin: boolean): Promise<void> { await apiFetch(`/auth/users/${id}/set-admin`, { method: "POST", body: JSON.stringify({ isAdmin }) }); }
export async function apiDeleteMember(id: string): Promise<void> { await apiFetch(`/auth/users/${id}`, { method: "DELETE" }); }
export async function apiResetMember2fa(id: string): Promise<void> { await apiFetch(`/auth/users/${id}/reset-2fa`, { method: "POST" }); }
// Admin resets a member's password (email-independent). Returns the new temporary
// password ONCE so the admin can pass it to the user. Optionally set a specific one.
// --- MCP (Claude) access keys — admin only ---
// These gate /api/mcp, the endpoint an outside Claude client reads the library
// through. The RAW key comes back exactly once, from apiCreateMcpKey — it is never
// stored in readable form and can never be shown again.

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

export interface McpInfo {
  serverName: string;
  version: string;
  url: string;
  urlWithKeyTemplate: string;
  tools: { name: string; title: string }[];
}

export async function apiMcpInfo(): Promise<McpInfo> {
  const r = await apiFetch("/mcp-info");
  if (!r.ok) throw new Error("Couldn't load the Claude connection details");
  return r.json() as Promise<McpInfo>;
}

// The environment-held key: configured in deploy secrets rather than the database, so
// it survives a dropped table. It is never in the `keys` list, hence reported alongside.
export interface StaticKeyStatus { configured: boolean; reason: string | null; email: string | null; fingerprint?: string | null; length?: number | null }

// Own keys by default; admins may request every member's for oversight.
export async function apiListMcpKeys(all = false): Promise<{ keys: McpKeySummary[]; scope: string; isAdmin: boolean; staticKey?: StaticKeyStatus }> {
  const r = await apiFetch(`/mcp-keys${all ? "?all=1" : ""}`);
  if (!r.ok) throw new Error("Couldn't load access keys");
  return (await r.json()) as { keys: McpKeySummary[]; scope: string; isAdmin: boolean; staticKey?: StaticKeyStatus };
}

// Always mints for the SIGNED-IN user — there is no way to mint on someone else's behalf.
export async function apiCreateMcpKey(name: string, expiresInDays?: number | null): Promise<{ key: string; summary: McpKeySummary }> {
  const r = await apiFetch("/mcp-keys", { method: "POST", body: JSON.stringify({ name, expiresInDays: expiresInDays ?? null }) });
  if (!r.ok) {
    // The server explains a hit key limit in terms the person can act on — pass that
    // through rather than replacing it with a generic failure they can do nothing about.
    const body = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Couldn't create the access key");
  }
  return r.json() as Promise<{ key: string; summary: McpKeySummary }>;
}

export async function apiRevokeMcpKey(id: string): Promise<void> {
  const r = await apiFetch(`/mcp-keys/${id}/revoke`, { method: "POST" });
  if (!r.ok) throw new Error("Couldn't revoke the access key");
}

export async function apiDeleteMcpKey(id: string): Promise<void> {
  const r = await apiFetch(`/mcp-keys/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Couldn't delete the access key");
}

export async function apiResetMemberPassword(id: string, newPassword?: string): Promise<{ email: string; password: string; twoFactorEnabled: boolean }> {
  const r = await apiFetch(`/auth/users/${id}/reset-password`, { method: "POST", body: JSON.stringify(newPassword ? { newPassword } : {}) });
  const j = await r.json().catch(() => ({})) as { error?: string; email?: string; password?: string; twoFactorEnabled?: boolean };
  if (!r.ok || !j.password) throw new Error(j.error || "Could not reset the password.");
  return { email: j.email || "", password: j.password, twoFactorEnabled: !!j.twoFactorEnabled };
}

// Safety valves when email can't be delivered: a fresh reset (1 h) / verification (24 h) link
// handed to the admin instead of emailed.
export async function apiMemberLink(id: string, kind: "reset" | "verify"): Promise<{ email: string; link: string; expiresAt: string }> {
  const r = await apiFetch(`/auth/users/${id}/${kind === "reset" ? "reset-link" : "verify-link"}`, { method: "POST" });
  const j = await r.json().catch(() => ({})) as { error?: string; email?: string; link?: string; expiresAt?: string };
  if (!r.ok || !j.link) throw new Error(j.error || "Couldn't create the link.");
  return { email: j.email || "", link: j.link, expiresAt: j.expiresAt || "" };
}

export interface TestEmailResult { ok: boolean; via: "smtp" | "resend" | "none"; from: string | null; to: string; detail?: string }
export async function apiSendTestEmail(): Promise<TestEmailResult> {
  const r = await apiFetch("/auth/test-email", { method: "POST" });
  const j = await r.json().catch(() => ({})) as Partial<TestEmailResult> & { error?: string };
  if (!r.ok) throw new Error(j.error || `Test email request failed (HTTP ${r.status}).`);
  return { ok: !!j.ok, via: j.via ?? "none", from: j.from ?? null, to: j.to ?? "", detail: j.detail };
}

// --- Extraction lessons (operator-taught rules) ---
export type LessonScope = "all" | "om" | "rent-roll" | "lease-options" | "sales" | "flyer" | "swap" | "loan";
export interface ExtractionLesson { id: string; scope: LessonScope; lesson: string; createdAt: string; createdBy: string | null }
export async function apiGetExtractionLessons(scope: LessonScope = "all"): Promise<ExtractionLesson[]> {
  const resp = await apiFetch(`/extraction-lessons?scope=${encodeURIComponent(scope)}`);
  if (!resp.ok) return [];
  return await resp.json().catch(() => []) as ExtractionLesson[];
}
export async function apiAddExtractionLesson(scope: LessonScope, lesson: string): Promise<{ ok: boolean; error?: string }> {
  const resp = await apiFetch("/extraction-lessons", { method: "POST", body: JSON.stringify({ scope, lesson }) });
  if (resp.ok) return { ok: true };
  const data = await resp.json().catch(() => ({})) as { error?: string };
  return { ok: false, error: data.error || "Could not save the rule." };
}
export async function apiDeleteExtractionLesson(id: string): Promise<void> {
  await apiFetch(`/extraction-lessons/${id}`, { method: "DELETE" });
}

// Build a prompt block from active lessons for a given document type, for the
// client-side extractors (rent roll / sales) that call the AI proxy directly.
export async function lessonGuidanceClient(scope: LessonScope): Promise<string> {
  let rows: ExtractionLesson[] = [];
  try { rows = await apiGetExtractionLessons(scope); } catch { return ""; }
  if (rows.length === 0) return "";
  const list = rows.map((r, i) => `${i + 1}. ${r.lesson.trim()}`).join("\n");
  return `\n\nOPERATOR-TAUGHT RULES — HIGHEST PRIORITY (from real corrections; follow exactly):\n${list}\n`;
}

export async function apiAdminUnlock(password: string): Promise<void> {
  const resp = await apiFetch("/auth/admin-unlock", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  if (!resp.ok) throw new Error("Invalid admin password");
}

// --- Deals ---

// The library LIST: live deals only, with the blocks only the deal page uses left out
// (marked `_summary`). Use apiLoadFullDeal / apiLoadDealsFull where the whole record matters.
export async function apiLoadDeals(): Promise<Deal[]> {
  const resp = await apiFetch("/deals");
  if (!resp.ok) throw new Error("Failed to load deals");
  const deals = await resp.json() as Deal[];
  // Normalize occupancy on load so stored fraction values (1.0 / 0.99 read as
  // "1%") display correctly everywhere without needing a re-extract.
  return deals.map(normalizeDeal);
}

/** One complete record (the deal page, merges, re-uploads). */
export async function apiLoadFullDeal(id: string): Promise<Deal> {
  const resp = await apiFetch(`/deals/${encodeURIComponent(id)}/full`);
  if (!resp.ok) throw new Error("Failed to load deal");
  return normalizeDeal(await resp.json() as Deal);
}

/** Complete records for backups / exports; `includeTrashed` for the full backup. */
export async function apiLoadDealsFull(includeTrashed = false): Promise<Deal[]> {
  const resp = await apiFetch(`/deals?full=1${includeTrashed ? "&all=1" : ""}`);
  if (!resp.ok) throw new Error("Failed to load deals");
  return (await resp.json() as Deal[]).map(normalizeDeal);
}

/** Fill a list copy's missing detail from the full record. Only keys the copy LACKS are
 *  taken, so edits made since the list loaded are kept. */
export function withDetail(d: Deal, full: Deal): Deal {
  const merged: Record<string, unknown> = { ...d };
  for (const [k, v] of Object.entries(full)) if (!(k in merged)) merged[k] = v;
  delete merged._summary;
  return merged as unknown as Deal;
}

/** `d` with its detail filled in when it is a list copy, else `d` itself. Never throws
 *  (falls back to `d`, whose saves are still made safe server-side). */
export async function ensureFullDeal(d: Deal): Promise<Deal> {
  if (!d._summary) return d;
  try { return withDetail(d, await apiLoadFullDeal(d.id)); } catch { return d; }
}

// Save a deal, retrying transient failures (network drop, 5xx) with backoff. A 4xx
// is a real rejection — don't retry it. Throws after the final attempt fails.
/** The server refused a save because the deal was DELETED (410). Final — never retried. */
export class DealDeletedError extends Error {
  constructor(public dealId: string) { super("This deal was deleted, so it wasn't saved again."); }
}
async function putDealWithRetry(id: string, rest: Record<string, unknown>, restoreDeleted = false): Promise<void> {
  const delays = [400, 1200, 3000];
  let lastErr = "Failed to save deal";
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const resp = await apiFetch(`/deals/${id}${restoreDeleted ? "?restoreDeleted=1" : ""}`, { method: "PUT", body: JSON.stringify(rest) });
      if (resp.ok) return;
      // Deleted (Eric, 10/19/26): a late save from this tab must not bring it back — drop it everywhere.
      if (resp.status === 410) throw new DealDeletedError(id);
      if (resp.status >= 400 && resp.status < 500) {
        // Surface the server's own reason (e.g. "mark Sold only once the sale has closed").
        let why = "";
        try { why = String(((await resp.json()) as { error?: unknown })?.error ?? ""); } catch { /* no body */ }
        throw new Error(resp.status === 401 ? "Signed out — please sign in again." : `Save rejected${why ? `: ${why}` : ` (HTTP ${resp.status}).`}`);
      }
      lastErr = `Server error (HTTP ${resp.status}).`;
    } catch (e) {
      // A thrown 4xx above is final; rethrow it rather than retrying.
      if (e instanceof DealDeletedError || (e instanceof Error && /Signed out|Save rejected/.test(e.message))) throw e;
      lastErr = "Network error — couldn't reach the server.";
    }
    if (attempt < delays.length) await new Promise(r => setTimeout(r, delays[attempt]));
  }
  throw new Error(lastErr);
}

/** `opts.restoreDeleted` (admin backup restore only) deliberately brings back a deleted id. */
export async function apiSaveDeal(deal: Deal, opts: { restoreDeleted?: boolean } = {}): Promise<void> {
  const { id, ...rest } = deal;
  beginSave();
  try {
    await putDealWithRetry(id, rest, !!opts.restoreDeleted);
    endSaveOk(id);
  } catch (e) {
    if (e instanceof DealDeletedError) {
      // Not an error to retry: the deal is gone. Clear the indicator and tell the app to forget it.
      endSaveOk(id);
      try { window.dispatchEvent(new CustomEvent("kpr:deal-deleted", { detail: { id } })); } catch { /* non-browser */ }
      throw e;
    }
    const msg = e instanceof Error ? e.message : "Failed to save deal";
    endSaveError(id, () => apiSaveDeal(deal), msg);
    reportClientError("Deal save failed", `${id}: ${msg}`);
    throw e;
  }
}

export interface ImportDealResult {
  ok: boolean;
  id: string;
  merged: boolean;
  propertyName: string;
}

export async function apiImportDeal(deal: Deal): Promise<ImportDealResult> {
  const resp = await apiFetch("/deals/import", {
    method: "POST",
    body: JSON.stringify(deal),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `Import failed (HTTP ${resp.status})`);
  }
  return resp.json() as Promise<ImportDealResult>;
}

export async function apiSaveDeals(deals: Deal[]): Promise<void> {
  await Promise.all(deals.map(d => apiSaveDeal(d)));
}

export async function apiDeleteDeal(id: string): Promise<void> {
  const resp = await apiFetch(`/deals/${id}`, { method: "DELETE" });
  if (!resp.ok) throw new Error("Failed to delete deal");
}

// Throw away THIS upload's own in-flight record (skipped / discarded / "Not an OM — not
// added"). Members can't DELETE deals, so the server lets the uploader discard a record
// they started and no one has saved; an admin falls back to the normal delete. Never throws.
export async function apiDiscardUpload(id: string): Promise<void> {
  try {
    const r = await apiFetch(`/deals/${encodeURIComponent(id)}/discard-ingest`, { method: "POST" });
    if (r.ok) return;
  } catch { /* fall through */ }
  await apiDeleteDeal(id).catch(() => {});
}

export async function apiCreateDeal(deal: Deal): Promise<void> {
  const { id, ...rest } = deal;
  const resp = await apiFetch("/deals", {
    method: "POST",
    body: JSON.stringify({ id, ...rest }),
  });
  if (!resp.ok) throw new Error("Failed to create deal");
}

// --- Images ---

// PUT a SUBSET of image fields. The server applies a partial update, so omitted
// fields are left untouched. A hard timeout (via AbortController) means a stalled
// request FAILS instead of hanging forever — the cause of "processing images" /
// "attaching cover & site plan" spinning for minutes and a cover silently never
// reaching the DB. Reports the precise status + payload size on failure.
async function putImageFields(id: string, fields: Partial<ImageBundle>, timeoutMs = 20000): Promise<void> {
  const body = JSON.stringify(fields);
  // A timeout / network error on the FIRST try is almost always a cold-starting
  // server (the app waking from idle), which the very next request resolves. So we
  // retry the transient cases ONCE before giving up. We do NOT retry a real HTTP
  // error response — that's a genuine rejection that a retry won't fix.
  const attempts = 2;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let resp: Response;
    try {
      resp = await apiFetch(`/deals/${id}/images`, { method: "PUT", body, signal: ctrl.signal });
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      if (attempt < attempts) {
        reportClientError(`apiSaveImages ${aborted ? "timeout" : "network error"} — retrying (${body.length} bytes)`, String(e));
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      reportClientError(`apiSaveImages ${aborted ? "timeout" : "network error"} (${body.length} bytes)`, String(e));
      throw new Error(aborted ? `timed out after ${Math.round(timeoutMs / 1000)}s` : "network error — check your connection");
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      const serverMsg = (await resp.text().catch(() => "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      reportClientError(`apiSaveImages failed: HTTP ${resp.status} (${body.length} bytes)`, serverMsg.slice(0, 500));
      // Surface the real reason (status + server message) so a failure is diagnosable
      // instead of a generic "try a smaller image" that sends everyone down a dead end.
      throw new Error(`HTTP ${resp.status}${serverMsg ? ` — ${serverMsg.slice(0, 140)}` : ""}`);
    }
    return;
  }
}

// Re-encode a base64 image data URL down to <= maxBytes by stepping JPEG quality,
// then dimensions, down. This is THE fix for "the cover/site-plan upload never
// reaches the server": the platform proxy silently drops a request whose body is too
// large, so we guarantee every image payload is small BEFORE sending — regardless of
// whether it came from a manual upload or OM extraction. Browser-only; returns the
// input unchanged if it's already small, not an image, or can't be processed.
async function capImageDataUrl(url: string | null | undefined, maxBytes: number): Promise<string | null | undefined> {
  if (!url || typeof url !== "string" || !url.startsWith("data:image") || url.length <= maxBytes) return url;
  if (typeof document === "undefined") return url;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("decode failed"));
      im.src = url;
    });
    const longest = Math.max(img.width, img.height);
    const render = (dim: number, q: number): string => {
      const s = Math.min(1, dim / longest);
      const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const cx = c.getContext("2d");
      if (!cx) return url;
      cx.drawImage(img, 0, 0, w, h);
      const u = c.toDataURL("image/jpeg", q);
      c.width = c.height = 0;
      return u;
    };
    let dim = Math.min(longest, 1200);
    let q = 0.7;
    let out = render(dim, q);
    let guard = 0;
    while (out.length > maxBytes && guard++ < 12) {
      if (q > 0.42) q = Math.max(0.4, q - 0.1);
      else { dim = Math.round(dim * 0.82); q = 0.6; }
      out = render(dim, q);
    }
    return out.length < url.length ? out : url;
  } catch {
    return url;
  }
}

// Generous caps for QUALITY. The earlier tiny caps were to dodge a size threshold,
// but the real blocker was the WAF rejecting base64-in-JSON — which raw-binary upload
// now sidesteps entirely. So images can be full quality again (only genuinely huge
// ones get trimmed). These are data-URL char lengths (~75% is the actual byte size).
const COVER_CAP = 500_000;   // ~1200px sharp cover
const THUMB_CAP = 120_000;   // 480px WebP tile thumbnail (typically ~20–40 KB)
const PLAN_CAP = 650_000;    // detailed site plan

// Upload one image as RAW BINARY (not base64-in-JSON). The platform WAF was 403-ing
// the JSON body because of the long base64 blob; raw JPEG bytes pass straight through.
async function putImageRaw(id: string, field: "cover" | "coverThumb" | "sitePlanSet" | "sitePlanAdd", dataUrl: string): Promise<void> {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const resp = await fetch(`${BASE}/deals/${id}/image-raw/${field}`, {
      method: "PUT",
      credentials: "include",
      // Send the real type (thumbs are WebP now) so the server stores it labelled correctly.
      headers: { "Content-Type": /^data:(image\/(?:jpeg|png|webp));/.exec(dataUrl)?.[1] ?? "image/jpeg" },
      body: bytes,
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const m = (await resp.text().catch(() => "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
      reportClientError(`apiSaveImages raw ${field} failed: HTTP ${resp.status} (${bytes.length} bytes)`, m);
      throw new Error(`HTTP ${resp.status}${m ? ` — ${m}` : ""}`);
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") { reportClientError(`apiSaveImages raw ${field} timeout`, `${bytes.length} bytes`); throw new Error("timed out after 20s"); }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function apiSaveImages(id: string, bundle: ImageBundle): Promise<void> {
  invalidateRead(`images:${id}`);
  // Save in isolated requests, smallest/most-important first (cover, then site plan,
  // then pagePicks), and CAP each image's size so the request body can't exceed the
  // platform proxy's limit (which was silently dropping the upload before it ever
  // reached the server — covers/site plans "saved nothing").
  const { cover, coverThumb, sitePlan, pagePicks, needsSitePlanPick } = bundle;
  if (cover !== undefined || coverThumb !== undefined) {
    const c = await capImageDataUrl(cover, COVER_CAP);
    const ct = await capImageDataUrl(coverThumb, THUMB_CAP);
    const cIsImg = typeof c === "string" && c.startsWith("data:");
    const ctIsImg = typeof ct === "string" && ct.startsWith("data:");
    // Real images → raw-binary endpoint (dodges the WAF). Null/clear → small JSON.
    if (cIsImg) await putImageRaw(id, "cover", c as string);
    if (ctIsImg) await putImageRaw(id, "coverThumb", ct as string);
    const clearFields: Partial<ImageBundle> = {};
    if (cover !== undefined && !cIsImg) clearFields.cover = c ?? null;
    if (coverThumb !== undefined && !ctIsImg) clearFields.coverThumb = ct ?? null;
    if (Object.keys(clearFields).length) await putImageFields(id, clearFields);
  }
  if (sitePlan !== undefined) {
    const imgs = Array.isArray(sitePlan)
      ? (await Promise.all(sitePlan.map(u => capImageDataUrl(u, PLAN_CAP)))).filter((u): u is string => typeof u === "string" && u.startsWith("data:"))
      : [];
    if (imgs.length) {
      // Send each plan image as raw binary (WAF-safe): first replaces the array, rest append.
      // Errors propagate so the caller can show the real reason (no silent swallow).
      for (let i = 0; i < imgs.length; i++) await putImageRaw(id, i === 0 ? "sitePlanSet" : "sitePlanAdd", imgs[i]);
    } else {
      // Empty array = clear the site plan → small JSON (no base64) is fine.
      await putImageFields(id, { sitePlan: Array.isArray(sitePlan) ? [] : sitePlan });
    }
  }
  if (needsSitePlanPick !== undefined) {
    // No image data → small JSON request, never tripped the WAF.
    await putImageFields(id, { needsSitePlanPick }).catch(() => reportClientError(`needsSitePlanPick save skipped`, `deal ${id}`));
  }
  if (Array.isArray(pagePicks) && pagePicks.length) {
    try {
      await putImageFields(id, { pagePicks });
    } catch {
      reportClientError(`pagePicks save skipped (likely too large)`, `${pagePicks.length} page picks`);
    }
  }
}

// Update only the cover thumbnail (used by the library's thumbnail backfill).
export async function apiSetCoverThumb(id: string, coverThumb: string): Promise<void> {
  await apiFetch(`/deals/${id}/cover-thumb`, { method: "PUT", body: JSON.stringify({ coverThumb }) });
}

// Shared read cache: several components ask for the same thing at once (the home chat
// and the chat drawer both load lease abstracts, comps and benchmarks; the deal page and
// its cards both load images). One request in flight, reused for a short window.
const readCache = new Map<string, { at: number; p: Promise<unknown> }>();
export function cachedRead<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = readCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = load();
  readCache.set(key, { at: Date.now(), p });
  p.catch(() => readCache.delete(key));
  return p;
}
export function invalidateRead(prefix: string): void {
  for (const k of [...readCache.keys()]) if (k.startsWith(prefix)) readCache.delete(k);
}

export async function apiLoadImages(id: string): Promise<ImageBundle | null> {
  return cachedRead(`images:${id}`, 60_000, async () => {
    const resp = await apiFetch(`/deals/${id}/images`);
    if (!resp.ok) {
      reportClientError(`apiLoadImages failed: HTTP ${resp.status}`, `deal ${id}`);
      readCache.delete(`images:${id}`);
      return null;
    }
    return resp.json() as Promise<ImageBundle | null>;
  });
}

// --- Async ingest ---

export async function apiIngestDeal(params: { id: string; text: string; fileName: string; pageCount: number; correctionsNote?: string }): Promise<void> {
  const resp = await apiFetch("/deals/ingest", {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Failed to start extraction");
  }
}

export async function apiPollDealStatus(id: string): Promise<{ processing: boolean; deal?: Deal; error?: string }> {
  const resp = await apiFetch(`/deals/${id}/status`);
  if (!resp.ok) throw new Error("Failed to poll status");
  return resp.json() as Promise<{ processing: boolean; deal?: Deal; error?: string }>;
}

// Re-run AI extraction from stored source text, preserving all user-entered fields
export async function apiReanalyzeDeal(id: string, opts?: { overwriteRoster?: boolean }): Promise<{ processing?: boolean; error?: string; rosterManual?: boolean; message?: string; tenantsAsOf?: string | null }> {
  const resp = await apiFetch(`/deals/${id}/reanalyze`, {
    method: "POST",
    body: JSON.stringify({ overwriteRoster: opts?.overwriteRoster === true }),
  });
  if (resp.status === 409) {
    const body = await resp.json().catch(() => ({})) as { error?: string; message?: string; tenantsAsOf?: string | null };
    return { rosterManual: true, message: body.message, tenantsAsOf: body.tenantsAsOf ?? null };
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Failed to start re-analysis");
  }
  return resp.json() as Promise<{ processing: boolean; error?: string }>;
}

// Regenerate summary/grade/strengths/risks/upside/red flags from the CURRENT roster
// (not the stored OM). Safe after a manual rent-roll update — does not touch tenants.
// --- House View (distilled cross-deal underwriting lens) ---
export interface HouseViewData {
  content: string; sourceCount: number; pendingReviews: number; manuallyEdited: boolean;
  /** KPR's built-in standing rules — always applied ahead of the learned content. */
  baseline?: string;
  lastDistilledAt: string | null; updatedAt: string | null; updatedBy: string | null;
}
export async function apiGetHouseView(): Promise<HouseViewData> {
  const resp = await apiFetch("/house-view");
  if (!resp.ok) throw new Error("Failed to load House View");
  return resp.json() as Promise<HouseViewData>;
}
export async function apiSaveHouseView(content: string): Promise<HouseViewData> {
  const resp = await apiFetch("/house-view", { method: "PUT", body: JSON.stringify({ content }) });
  if (!resp.ok) { const b = await resp.json().catch(() => ({})) as { error?: string }; throw new Error(b.error || "Failed to save House View"); }
  return resp.json() as Promise<HouseViewData>;
}
export async function apiRebuildHouseView(): Promise<HouseViewData> {
  const resp = await apiFetch("/house-view/rebuild", { method: "POST" });
  if (!resp.ok) { const b = await resp.json().catch(() => ({})) as { error?: string }; throw new Error(b.error || "Failed to rebuild House View"); }
  return resp.json() as Promise<HouseViewData>;
}

export async function apiRefreshAnalysis(id: string): Promise<{
  ok?: boolean; notes?: unknown; dealScore?: unknown;
  upsideItems?: unknown; redFlags?: { severity: string; description: string }[];
  analysisStale?: boolean;
}> {
  const resp = await apiFetch(`/deals/${id}/refresh-analysis`, { method: "POST" });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Refresh analysis failed");
  }
  return resp.json() as Promise<{ ok?: boolean; notes?: unknown; dealScore?: unknown; upsideItems?: unknown; redFlags?: { severity: string; description: string }[]; analysisStale?: boolean }>;
}

// --- Sources ---

export async function apiSaveSource(id: string, text: string): Promise<void> {
  const resp = await apiFetch(`/deals/${id}/source`, {
    method: "PUT",
    body: JSON.stringify({ text }),
  });
  if (!resp.ok) throw new Error("Failed to save source");
}

export async function apiLoadSource(id: string): Promise<string | null> {
  const resp = await apiFetch(`/deals/${id}/source`);
  if (!resp.ok) return null;
  const body = await resp.json() as { text?: string | null };
  return body.text ?? null;
}

// --- Demographics ---

export async function apiRefreshDemographics(dealId: string): Promise<import("./idb").MarketDemographics | null> {
  const resp = await apiFetch(`/deals/${dealId}/refresh-demographics`, { method: "POST" });
  if (!resp.ok) throw new Error(`Refresh failed: ${resp.status}`);
  const data = await resp.json() as { marketDemographics?: import("./idb").MarketDemographics | null };
  return data.marketDemographics ?? null;
}

// Derive Market/Submarket from the deal's address (free Census geocoder).
export async function apiRefreshMarket(dealId: string): Promise<{ marketGeo: import("./idb").MarketGeo | null; market: string | null; submarket: string | null }> {
  const resp = await apiFetch(`/deals/${dealId}/refresh-market`, { method: "POST" });
  if (!resp.ok) throw new Error(`Market lookup failed: ${resp.status}`);
  const data = await resp.json() as { marketGeo?: import("./idb").MarketGeo | null; market?: string | null; submarket?: string | null };
  return { marketGeo: data.marketGeo ?? null, market: data.market ?? null, submarket: data.submarket ?? null };
}

// Refresh score using latest tenant benchmarks — no re-extraction, no PDF needed
export async function apiRescore(id: string): Promise<{
  dealScore?: unknown;
  redFlags?: { severity: string; description: string }[];
  lastScoredAt: string;
  lastScoredDealCount: number;
}> {
  const resp = await apiFetch(`/deals/${id}/rescore`, { method: "POST" });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Rescore failed");
  }
  return resp.json() as Promise<{
    dealScore?: unknown;
    redFlags?: { severity: string; description: string }[];
    lastScoredAt: string;
    lastScoredDealCount: number;
  }>;
}

export async function apiStaleAnalysisCount(): Promise<{ count: number; currentVersion: number }> {
  const resp = await apiFetch(`/deals/stale-analysis-count`);
  if (!resp.ok) return { count: 0, currentVersion: 0 };
  return resp.json() as Promise<{ count: number; currentVersion: number }>;
}

// Deterministic data-integrity audit across all existing deals (token-free).
export async function apiAuditStats(): Promise<{ deals: number; issues: number; high: number }> {
  const resp = await apiFetch(`/deals/audit-stats`);
  if (!resp.ok) return { deals: 0, issues: 0, high: 0 };
  return resp.json() as Promise<{ deals: number; issues: number; high: number }>;
}

export interface TxnImportRow {
  propertyName: string;
  address?: string;
  txnPurchasePrice?: number | null;
  txnCloseDate?: string | null;
  txnSeller?: string | null;
  acqNOIAtClose?: number | null;
  acqCapRate?: number | null;
}
export interface TxnImportResult {
  ok: boolean;
  dryRun: boolean;
  matchedCount: number;
  unmatchedCount: number;
  matched: { propertyName: string; id: string; fieldsSet: string[] }[];
  unmatched: string[];
}
// Bulk-set transaction/acquisition fields on existing deals (matched by name/address),
// patching ONLY those fields and never wiping the rest. dryRun reports without writing.
export async function apiImportTransactions(rows: TxnImportRow[], dryRun = false): Promise<TxnImportResult> {
  const resp = await apiFetch(`/deals/import-transactions`, { method: "POST", body: JSON.stringify({ rows, dryRun }) });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Transaction import failed");
  }
  return resp.json() as Promise<TxnImportResult>;
}

export async function apiReauditDeals(): Promise<{ ok: boolean; scanned: number; flagged: number; added: number; cleared: number }> {
  const resp = await apiFetch(`/deals/reaudit`, { method: "POST" });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Re-audit failed");
  }
  return resp.json() as Promise<{ ok: boolean; scanned: number; flagged: number; added: number; cleared: number }>;
}

export async function apiAutofixDeals(): Promise<{ ok: boolean; scanned: number; occCostFixed: number; rentFixed: number; metricFixes: number; changedDeals: number; cleared: number }> {
  const resp = await apiFetch(`/deals/autofix`, { method: "POST" });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Auto-fix failed");
  }
  return resp.json() as Promise<{ ok: boolean; scanned: number; occCostFixed: number; rentFixed: number; metricFixes: number; changedDeals: number; cleared: number }>;
}

export interface AuditListDeal { dealId: string; dealName: string; high: number; issues: { key: string; label: string; severity: string; question: string }[] }
export async function apiAuditList(): Promise<{ deals: AuditListDeal[]; totalDeals: number; totalIssues: number }> {
  const resp = await apiFetch(`/deals/audit-list`);
  if (!resp.ok) return { deals: [], totalDeals: 0, totalIssues: 0 };
  return resp.json() as Promise<{ deals: AuditListDeal[]; totalDeals: number; totalIssues: number }>;
}

export interface IssueGroup {
  key: string; label: string; severity: "high" | "medium" | "low";
  kind: "audit" | "ai" | "arithmetic" | "other";
  count: number; dealCount: number; deals: { id: string; name: string }[]; sample: string;
}
export async function apiIssuesSummary(): Promise<{ groups: IssueGroup[]; totalOpen: number; dealsWithIssues: number; scanned: number }> {
  const resp = await apiFetch(`/deals/issues-summary`);
  if (!resp.ok) return { groups: [], totalOpen: 0, dealsWithIssues: 0, scanned: 0 };
  return resp.json() as Promise<{ groups: IssueGroup[]; totalOpen: number; dealsWithIssues: number; scanned: number }>;
}

export async function apiRefreshStaleAnalysis(): Promise<{ ok: boolean; refreshed: number; failed: number; total: number }> {
  const resp = await apiFetch(`/deals/refresh-stale-analysis`, { method: "POST" });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Bulk refresh failed");
  }
  return resp.json() as Promise<{ ok: boolean; refreshed: number; failed: number; total: number }>;
}

// --- AI (web search / generic Claude proxy) ---

export async function apiAiMessages(params: {
  model?: string;
  system?: string;
  messages: { role: string; content: string }[];
  max_tokens?: number;
  tools?: unknown[];
}): Promise<{ content: { type: string; text?: string }[] }> {
  const resp = await apiFetch("/ai/messages", {
    method: "POST",
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.max_tokens ?? 1500,
      system: params.system,
      messages: params.messages,
      tools: params.tools,
    }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "AI request failed");
  }
  return resp.json() as Promise<{ content: { type: string; text?: string }[] }>;
}

// --- Snapshots ---

export interface SnapshotMeta {
  id: number;
  createdAt: string;
  reason: string;
  dealCount: number;
}

export async function apiCreateSnapshot(
  reason: string,
): Promise<{ id: number; createdAt: string } | { skipped: boolean }> {
  const resp = await apiFetch("/snapshots", {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
  if (!resp.ok) throw new Error("Snapshot request failed");
  return resp.json() as Promise<{ id: number; createdAt: string } | { skipped: boolean }>;
}

export async function apiListSnapshots(): Promise<SnapshotMeta[]> {
  const resp = await apiFetch("/snapshots");
  if (!resp.ok) throw new Error("Failed to list snapshots");
  return resp.json() as Promise<SnapshotMeta[]>;
}

// --- Feedback ---

export interface FeedbackItem {
  id: number;
  createdAt: string;
  type: string;
  message: string;
  name: string | null;
  page: string | null;
  userAgent: string | null;
  resolved: boolean;
  emailStatus: string | null;
  emailError: string | null;
}

export async function apiSubmitFeedback(payload: {
  type: string;
  message: string;
  name?: string;
  page?: string;
  userAgent?: string;
  images?: string[];   // data URLs (e.g. "data:image/png;base64,…"), emailed as attachments
}): Promise<{ id: number; createdAt: string }> {
  const resp = await apiFetch("/feedback", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Failed to submit feedback");
  }
  return resp.json() as Promise<{ id: number; createdAt: string }>;
}

export async function apiListFeedback(): Promise<FeedbackItem[]> {
  const resp = await apiFetch("/feedback");
  if (!resp.ok) throw new Error("Failed to list feedback");
  return resp.json() as Promise<FeedbackItem[]>;
}

export async function apiSetFeedbackResolved(id: number, resolved: boolean): Promise<void> {
  await apiFetch(`/feedback/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ resolved }),
  });
}

export async function apiRestoreSnapshot(
  id: number,
): Promise<{ restored: number; updated: number }> {
  const resp = await apiFetch(`/snapshots/${id}/restore`, { method: "POST" });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Restore failed");
  }
  return resp.json() as Promise<{ restored: number; updated: number }>;
}

// ── Today's Rates ────────────────────────────────────────────────────────────
export interface RateRow { label: string; value: number | null; asOf: string | null; note?: string }
export interface SwapCurveView {
  kind: "dtcc-eod" | "dtcc-intraday" | "manual" | "chatham";
  asOf: string; curveDate: string; source: string; enteredBy: string | null;
  points: Array<{ tenor: number; rate: number; n?: number; nDay?: number; p25?: number; p75?: number; method?: string }>;
  trades: number | null; tradesUsed: number | null;
}
export interface TermSwapCurveView {
  derived: true; fromKind: SwapCurveView["kind"]; asOf: string; curveDate: string; source: string; basisWindowDays: number;
  points: Array<{ tenor: number; rate: number; oisRate: number; monthly: number; basisBp: number; basisSource: "measured" | "default" | "chatham"; basisPrints: number; n?: number; p25?: number; p75?: number }>;
}
export interface RatesPayload {
  treasuries: { rows: RateRow[]; asOf: string | null; source: string };
  sofr: { rows: RateRow[]; asOf: string | null; source: string };
  swaps: { rows: RateRow[]; asOf: string | null; source: string; spreadBps: number };
  tenYearMonthly?: Array<{ month: string; value: number }>;
  swapCurve?: SwapCurveView | null;
  /** Pasted Chatham marks, with DTCC's error vs each (bp, DTCC − Chatham), newest first. */
  chathamLog?: Array<{ date: string; enteredBy: string | null; enteredAt: string; termSofr1m: number | null; dtccErrorBp: Record<string, number> | null; maxAbsErrorBp2to10: number | null }>;
  /** 1M CME Term SOFR swaps (monthly) — derived from the OIS curve + a Term basis. */
  termSwapCurve?: TermSwapCurveView | null;
  swapHistory?: Array<{ month: string; y5: number | null; y10: number | null }>;
  sofrOvernight?: { rate: number; date: string } | null;
  fetchedAt: string;
}
/** Daily index history (FRED + NY Fed, cached server-side) for the rate detail panel. One fetch per page load. */
export interface IndexHistoryView { series: "SOFR" | "DGS10"; label: string; source: string; asOf: string | null; fetchedAt: string | null; points: Array<[string, number | null]> }
let historyCache: Promise<IndexHistoryView[]> | null = null;
export function apiRateHistory(): Promise<IndexHistoryView[]> {
  historyCache ??= apiFetch("/rates/history?series=SOFR,DGS10").then(async resp => {
    const body = await resp.json().catch(() => ({})) as { series?: IndexHistoryView[]; error?: string };
    if (!resp.ok) throw new Error(body.error || "Couldn't load rate history");
    return body.series ?? [];
  }).catch(err => { historyCache = null; throw err; });
  return historyCache;
}
/** Paste today's swap curve (e.g. from Chatham); it shows until DTCC has newer trades. */
export async function apiSaveSwapCurve(text: string, source: string): Promise<{ points: Array<{ tenor: number; rate: number }> }> {
  const resp = await apiFetch("/rates/swap-curve", { method: "POST", body: JSON.stringify({ text, source }) });
  const body = await resp.json().catch(() => ({})) as { error?: string; points?: Array<{ tenor: number; rate: number }> };
  if (!resp.ok) throw new Error(body.error || "Couldn't save the curve");
  return { points: body.points ?? [] };
}
// The signed-in user's loan-sizer settings, stored on their account (follows them across
// devices and publishes). Server keeps only known fields with sane values.
export interface LoanSizerPrefs {
  defaultBase?: string | null;
  spreadBps?: number; premiumBps?: number; cushionBps?: number;
  dscr?: number; debtYieldPct?: number; ltvPct?: number;
  io?: boolean; amortYears?: number;
}
export async function apiGetLoanSizerPrefs(): Promise<LoanSizerPrefs> {
  const resp = await apiFetch("/me/prefs");
  if (!resp.ok) throw new Error("Couldn't load your settings");
  const body = await resp.json().catch(() => ({})) as { loanSizer?: LoanSizerPrefs };
  return body.loanSizer ?? {};
}
export async function apiSaveLoanSizerPrefs(patch: LoanSizerPrefs): Promise<LoanSizerPrefs> {
  const resp = await apiFetch("/me/prefs/loan-sizer", { method: "PUT", body: JSON.stringify(patch) });
  const body = await resp.json().catch(() => ({})) as { error?: string; loanSizer?: LoanSizerPrefs };
  if (!resp.ok) throw new Error(body.error || "Couldn't save your settings");
  return body.loanSizer ?? {};
}
export interface ChathamMarkParse { date: string | null; ois: Array<{ tenor: number; rate: number }>; term: Array<{ tenor: number; rate: number }>; termSofr1m: number | null; warnings: string[] }
/** Parse pasted Chatham text WITHOUT saving — for the preview. */
export async function apiPreviewChathamMark(text: string): Promise<ChathamMarkParse> {
  const resp = await apiFetch("/rates/chatham-mark/preview", { method: "POST", body: JSON.stringify({ text }) });
  if (!resp.ok) throw new Error("Couldn't read the pasted text");
  return resp.json() as Promise<ChathamMarkParse>;
}
/** Save the Chatham mark (admin only). */
export async function apiSaveChathamMark(text: string): Promise<{ date: string }> {
  const resp = await apiFetch("/rates/chatham-mark", { method: "POST", body: JSON.stringify({ text }) });
  const body = await resp.json().catch(() => ({})) as { error?: string; date?: string };
  if (!resp.ok) throw new Error(body.error || "Couldn't save the Chatham mark");
  return { date: body.date ?? "" };
}
export async function apiGetRates(refresh = false): Promise<RatesPayload> {
  const resp = await apiFetch(`/rates${refresh ? "?refresh=1" : ""}`);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Couldn't fetch rates");
  }
  return resp.json() as Promise<RatesPayload>;
}

// ── Lease abstracts ──────────────────────────────────────────────────────────
// All abstracts on file for a deal (powers the roster "Abstract" button state and
// the abstract page). Returns [] on any failure so the roster never breaks.
export async function apiListLeaseAbstracts(dealId: string): Promise<LeaseAbstract[]> {
  try {
    const resp = await apiFetch(`/deals/${encodeURIComponent(dealId)}/lease-abstracts`);
    if (!resp.ok) return [];
    return resp.json() as Promise<LeaseAbstract[]>;
  } catch {
    return [];
  }
}

// Every abstract across the library (for the Analyst chat's lease-level recall).
// Returns [] on any failure so the chat never breaks.
export async function apiListAllLeaseAbstracts(): Promise<LeaseAbstract[]> {
  return cachedRead("lease-abstracts:all", 5 * 60_000, apiListAllLeaseAbstractsUncached);
}
async function apiListAllLeaseAbstractsUncached(): Promise<LeaseAbstract[]> {
  try {
    const resp = await apiFetch(`/lease-abstracts`);
    if (!resp.ok) return [];
    return resp.json() as Promise<LeaseAbstract[]>;
  } catch {
    return [];
  }
}

// Whole comps_index table — used to build the analyst's comp-benchmark summary.
export async function apiLoadComps(): Promise<CompInput[]> {
  return cachedRead("comps:all", 5 * 60_000, apiLoadCompsUncached);
}
async function apiLoadCompsUncached(): Promise<CompInput[]> {
  try {
    const resp = await apiFetch(`/comps`);
    if (!resp.ok) return [];
    return resp.json() as Promise<CompInput[]>;
  } catch {
    return [];
  }
}

// Database-wide recency-weighted per-brand rent/sales/size medians — the SAME engine
// the deal-page scoring uses — so the analyst quotes the app's official numbers.
export interface AnalystTenantBenchmark {
  brand: string;
  locations: number;
  medianRentPerSf: number | null;
  medianSalesPerSf: number | null;
  salesCount: number;
  medianSf: number | null;
  sfCount: number;
  recencyYears: [number | null, number | null];
  salesYears: [number | null, number | null];
  confidence: "high" | "medium" | "low" | string;
}
export async function apiLoadTenantBenchmarks(): Promise<AnalystTenantBenchmark[]> {
  return cachedRead("tenant-benchmarks", 5 * 60_000, apiLoadTenantBenchmarksUncached);
}
async function apiLoadTenantBenchmarksUncached(): Promise<AnalystTenantBenchmark[]> {
  try {
    const resp = await apiFetch(`/analytics/tenant-benchmarks`);
    if (!resp.ok) return [];
    return resp.json() as Promise<AnalystTenantBenchmark[]>;
  } catch {
    return [];
  }
}

// One abstract by id.
export async function apiGetLeaseAbstract(id: string): Promise<LeaseAbstract | null> {
  try {
    const resp = await apiFetch(`/lease-abstracts/${encodeURIComponent(id)}`);
    if (!resp.ok) return null;
    return resp.json() as Promise<LeaseAbstract>;
  } catch {
    return null;
  }
}

// Upsert an abstract (Claude-reconciled JSON) for a deal+tenant. The server keys
// on (dealId, tenantName): replaces and bumps version if one already exists.
export async function apiSaveLeaseAbstract(
  dealId: string,
  abstract: LeaseAbstract,
): Promise<{ ok: boolean; id?: string; version?: number; error?: string }> {
  invalidateRead("lease-abstracts:");
  try {
    const resp = await apiFetch(`/deals/${encodeURIComponent(dealId)}/lease-abstracts`, {
      method: "POST",
      body: JSON.stringify(abstract),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error || "Couldn't save the lease abstract" };
    }
    return resp.json() as Promise<{ ok: boolean; id?: string; version?: number }>;
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again in a moment." };
  }
}

// Delete an abstract (admin only on the server).
export async function apiDeleteLeaseAbstract(id: string): Promise<{ ok: boolean; error?: string }> {
  invalidateRead("lease-abstracts:");
  try {
    const resp = await apiFetch(`/lease-abstracts/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error || "Couldn't delete the lease abstract" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again in a moment." };
  }
}

// Bulk-upsert many abstracts for a deal in one call (a whole property at once).
export async function apiBulkSaveLeaseAbstracts(
  dealId: string,
  abstracts: LeaseAbstract[],
): Promise<{ ok: boolean; saved?: number; skipped?: string[]; error?: string }> {
  invalidateRead("lease-abstracts:");
  try {
    const resp = await apiFetch(`/deals/${encodeURIComponent(dealId)}/lease-abstracts/bulk`, {
      method: "POST",
      body: JSON.stringify({ abstracts }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error || "Couldn't bulk-save the abstracts" };
    }
    return resp.json() as Promise<{ ok: boolean; saved?: number; skipped?: string[] }>;
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again in a moment." };
  }
}

// ── Site agreements / REAs (center-level) ─────────────────────────────────────
// All site agreements on file for a deal (powers the deal page's "Site Agreements
// / REAs" section). Returns [] on any failure so the page never breaks.
export async function apiListSiteAgreements(dealId: string): Promise<SiteAgreement[]> {
  try {
    const resp = await apiFetch(`/deals/${encodeURIComponent(dealId)}/site-agreements`);
    if (!resp.ok) return [];
    return resp.json() as Promise<SiteAgreement[]>;
  } catch {
    return [];
  }
}

// Bulk-upsert a whole property's REA set in one call. Accepts the same
// { siteAgreements: [...] } envelope the compiled REA file uses (or a raw array).
export async function apiBulkSaveSiteAgreements(
  dealId: string,
  siteAgreements: SiteAgreement[],
): Promise<{ ok: boolean; saved?: number; skipped?: string[]; error?: string }> {
  try {
    const resp = await apiFetch(`/deals/${encodeURIComponent(dealId)}/site-agreements/bulk`, {
      method: "POST",
      body: JSON.stringify({ siteAgreements }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error || "Couldn't bulk-save the site agreements" };
    }
    return resp.json() as Promise<{ ok: boolean; saved?: number; skipped?: string[] }>;
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again in a moment." };
  }
}

// Delete a site agreement (admin only on the server).
export async function apiDeleteSiteAgreement(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await apiFetch(`/site-agreements/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error || "Couldn't delete the site agreement" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again in a moment." };
  }
}

// ── Asset Management (owned properties) ─────────────────────────────────────
import type { AmRecord, NewsSignal } from "./assetMgmt";
export async function apiAmRecords(): Promise<AmRecord[]> {
  const r = await apiFetch("/am/records");
  if (!r.ok) throw new Error("Couldn't load asset-management records");
  return ((await r.json()) as { records: AmRecord[] }).records ?? [];
}
export async function apiAmSaveRecord(body: { id?: string; kind: AmRecord["kind"]; dealId: string; data: Record<string, unknown>; sourceNote?: string | null }): Promise<{ id: string }> {
  const r = await apiFetch("/am/records", { method: "POST", body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})) as { error?: string; id?: string };
  if (!r.ok) throw new Error(j.error || "Couldn't save");
  return { id: j.id ?? "" };
}
export async function apiAmDeleteRecord(id: string): Promise<void> {
  const r = await apiFetch(`/am/records/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Couldn't delete");
}
export interface AmImportChange { field: string; label: string; from: unknown; to: unknown }
export interface AmImportResult { applied: boolean; rows: Array<{ kind: string; id: string; dealId: string; property: string; data: Record<string, unknown>; sourceNote: string | null; action: "create" | "update"; changes?: AmImportChange[]; matchNote?: string }>; rejected: Array<{ row: number; problem: string }> }
export async function apiAmImport(text: string, apply: boolean): Promise<AmImportResult> {
  const r = await apiFetch("/am/records/import", { method: "POST", body: JSON.stringify({ text, apply }) });
  const j = await r.json().catch(() => ({})) as AmImportResult & { error?: string };
  if (!r.ok) throw new Error(j.error || "Import failed");
  return j;
}
export interface DatexMapRow { dealId: string; propertyName: string | null; bldgIds: string[]; note: string | null; updatedBy: string | null; updatedAt: string }
export async function apiAmDatexMap(): Promise<DatexMapRow[]> {
  const r = await apiFetch("/am/datex-map");
  if (!r.ok) throw new Error("Couldn't load the Datex map");
  return ((await r.json()) as { rows: DatexMapRow[] }).rows ?? [];
}
export async function apiAmSaveDatexMap(dealId: string, bldgIds: string[], note: string | null): Promise<void> {
  const r = await apiFetch(`/am/datex-map/${encodeURIComponent(dealId)}`, { method: "PUT", body: JSON.stringify({ bldgIds, note }) });
  const j = await r.json().catch(() => ({})) as { error?: string };
  if (!r.ok) throw new Error(j.error || "Couldn't save the mapping");
}
export async function apiAmCreditNews(brands: string[]): Promise<{ signals: NewsSignal[]; remaining: number }> {
  const r = await apiFetch("/am/credit-news", { method: "POST", body: JSON.stringify({ brands }) });
  if (!r.ok) throw new Error("Couldn't check the news");
  return r.json() as Promise<{ signals: NewsSignal[]; remaining: number }>;
}
export interface CovenantProposal { id: string; dealId: string; property: string; loanId: string | null; data: Record<string, unknown>; sourceNote: string; from: "seed" | "parsed" }
export async function apiAmDetectCovenants(apply: boolean, ids?: string[]): Promise<{ rows: CovenantProposal[]; notes: string[]; saved?: number }> {
  const r = await apiFetch("/am/covenants/detect", { method: "POST", body: JSON.stringify({ apply, ids }) });
  const j = await r.json().catch(() => ({})) as { rows?: CovenantProposal[]; notes?: string[]; saved?: number; error?: string };
  if (!r.ok) throw new Error(j.error || "Couldn't detect covenants");
  return { rows: j.rows ?? [], notes: j.notes ?? [], saved: j.saved };
}
export async function apiAmQuarterlyComment(dealId: string, facts: unknown, quarter: string): Promise<string> {
  const r = await apiFetch("/am/quarterly-comment", { method: "POST", body: JSON.stringify({ dealId, facts, quarter }) });
  const j = await r.json().catch(() => ({})) as { draft?: string; error?: string };
  if (!r.ok) throw new Error(j.error || "Couldn't draft the comment");
  return j.draft ?? "";
}
export async function apiAmSummarizeNews(brand: string): Promise<string> {
  const r = await apiFetch("/am/credit-news/summarize", { method: "POST", body: JSON.stringify({ brand }) });
  const j = await r.json().catch(() => ({})) as { error?: string; summary?: string };
  if (!r.ok) throw new Error(j.error || "Couldn't summarize");
  return j.summary ?? "";
}

// ── Datex auto-refresh (scoped ingest tokens + status) ──
export interface IngestTokenView { id: string; label: string; display: string; scope: string[]; createdAt: string; createdBy: string | null; lastUsedAt: string | null; revokedAt: string | null }
export interface IngestLogView { at: string; dryRun: boolean; token: string; asOf: string | null; blocks: Record<string, number>; dealsChanged: number; dealsUnchanged: number; rejected: Array<{ dealId: string; problem: string }>; warnings: number; error?: string }
export async function apiDatexAutoTokens(): Promise<IngestTokenView[]> {
  const r = await apiFetch("/am/datex-auto/tokens");
  if (!r.ok) throw new Error("Couldn't load tokens");
  return ((await r.json()) as { tokens: IngestTokenView[] }).tokens ?? [];
}
export async function apiDatexAutoCreateToken(label: string): Promise<{ token: string; view: IngestTokenView }> {
  const r = await apiFetch("/am/datex-auto/tokens", { method: "POST", body: JSON.stringify({ label }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || "Couldn't create the token");
  return j as { token: string; view: IngestTokenView };
}
export async function apiDatexAutoRevokeToken(id: string): Promise<void> {
  const r = await apiFetch(`/am/datex-auto/tokens/${encodeURIComponent(id)}/revoke`, { method: "POST" });
  if (!r.ok) throw new Error("Couldn't revoke the token");
}
export interface AutoRefreshSettingView { enabled: boolean; updatedBy: string | null; updatedAt: string | null }
export interface IngestAuditView { at: string; event: string; by: string; via: string; expiresAt: string }
export async function apiDatexAutoSetEnabled(enabled: boolean): Promise<AutoRefreshSettingView> {
  const r = await apiFetch("/am/datex-auto/settings", { method: "PUT", body: JSON.stringify({ enabled }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || "Couldn't save the setting");
  return (j as { setting: AutoRefreshSettingView }).setting;
}
export async function apiDatexAutoStatus(): Promise<{ last: IngestLogView | null; lastDryRun: IngestLogView | null; recent: IngestLogView[]; setting?: AutoRefreshSettingView; shortLived?: IngestAuditView[] }> {
  const r = await apiFetch("/am/datex-auto/status");
  if (!r.ok) throw new Error("Couldn't load the auto-refresh status");
  return r.json();
}

// --- Local Intel (web-research scan of local news & development per deal) ---
export type IntelCategory = "competing_supply" | "tenant_health" | "demand" | "access" | "municipal" | "property";
export interface IntelFinding {
  id: string; category: IntelCategory; headline: string; whyItMatters: string;
  distanceMiles: number | null; distanceBasis: "geocoded" | "reported" | "estimated" | null; location: string | null;
  date: string | null; forwardLooking: boolean; impact: "negative" | "positive" | "watch"; severity: "high" | "medium" | "low";
  tenant: string | null; sources: Array<{ title: string; url: string; date?: string | null }>; firstSeenAt: string; isNew?: boolean; dismissed?: boolean;
}
export interface LocalIntelRecord {
  dealId: string; scannedAt: string | null; trigger: "manual" | "new-om" | "monthly" | null; by: string | null;
  queries: string[]; queriesRun?: string[]; searchesUsed: number; findings: IntelFinding[]; newHighIds: string[]; error?: string | null; radiusMiles: number;
}
export interface LocalIntelResponse { record: LocalIntelRecord | null; canScan: boolean; configured: boolean }
export async function apiLocalIntel(dealId: string): Promise<LocalIntelResponse | null> {
  try {
    const r = await apiFetch(`/deals/${encodeURIComponent(dealId)}/local-intel`);
    return r.ok ? await r.json() as LocalIntelResponse : null;
  } catch { return null; }
}
/** Manual Refresh (admins / owner). Takes a minute or two; throws with the server's reason. */
export async function apiLocalIntelScan(dealId: string): Promise<LocalIntelResponse> {
  const r = await apiFetch(`/deals/${encodeURIComponent(dealId)}/local-intel/scan`, { method: "POST" });
  const j = await r.json().catch(() => ({})) as LocalIntelResponse & { error?: string };
  if (!r.ok) throw new Error(j.error || `Scan failed (HTTP ${r.status})`);
  return j;
}
export async function apiLocalIntelDismiss(dealId: string, findingId: string, dismissed: boolean): Promise<LocalIntelResponse> {
  const r = await apiFetch(`/deals/${encodeURIComponent(dealId)}/local-intel/dismiss`, { method: "POST", body: JSON.stringify({ findingId, dismissed }) });
  const j = await r.json().catch(() => ({})) as LocalIntelResponse & { error?: string };
  if (!r.ok) throw new Error(j.error || "Couldn't save");
  return j;
}
export interface LocalIntelAlert { dealId: string; property: string; scannedAt: string | null; id: string; category: string; headline: string; whyItMatters: string; distanceMiles: number | null; date: string | null; source: { title: string; url: string } | null }
export async function apiLocalIntelAlerts(): Promise<LocalIntelAlert[]> {
  try {
    const r = await apiFetch("/local-intel/alerts");
    return r.ok ? ((await r.json()) as { alerts: LocalIntelAlert[] }).alerts ?? [] : [];
  } catch { return []; }
}
