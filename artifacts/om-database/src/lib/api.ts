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

export interface AuthState { authenticated: boolean; isAdmin: boolean; email: string | null; name: string | null; twoFactorPending?: boolean; needs2faSetup?: boolean; needs2faReverify?: boolean }
export async function apiCheckAuth(): Promise<AuthState> {
  try {
    const resp = await apiFetch("/auth/me");
    if (!resp.ok) return { authenticated: false, isAdmin: false, email: null, name: null };
    const body = await resp.json() as { authenticated?: boolean; isAdmin?: boolean; email?: string | null; name?: string | null; twoFactorPending?: boolean; needs2faSetup?: boolean; needs2faReverify?: boolean };
    return { authenticated: !!body.authenticated, isAdmin: !!body.isAdmin, email: body.email ?? null, name: body.name ?? null, twoFactorPending: !!body.twoFactorPending, needs2faSetup: !!body.needs2faSetup, needs2faReverify: !!body.needs2faReverify };
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
export interface UploadLogEntry {
  id: string; fileName: string | null; docType: string | null; status: string;
  detail: string | null; dealId: string | null;
  userEmail: string | null; userName: string | null; createdAt: string;
}
// Record one upload outcome (best-effort; the WHO is filled in server-side from
// the session). Never throws — logging must never break the upload flow.
export async function apiRecordUpload(e: { fileName: string; docType?: string | null; status: "success" | "failed"; detail?: string | null; dealId?: string | null }): Promise<void> {
  try { await apiFetch("/upload-log", { method: "POST", body: JSON.stringify(e) }); } catch { /* non-fatal */ }
}
export async function apiUploadLog(): Promise<UploadLogEntry[]> {
  const resp = await apiFetch("/upload-log");
  if (!resp.ok) return [];
  return await resp.json().catch(() => []) as UploadLogEntry[];
}
// Who first uploaded a given deal (team attribution shown on the deal page). Any
// signed-in user can read it; returns null when the deal has no logged upload.
export interface DealUploader { userName: string | null; userEmail: string | null; at: string | null }
export async function apiDealUploadedBy(dealId: string): Promise<DealUploader | null> {
  try {
    const resp = await apiFetch(`/upload-log/by-deal/${encodeURIComponent(dealId)}`);
    if (!resp.ok) return null;
    return await resp.json().catch(() => null) as DealUploader | null;
  } catch { return null; }
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

export async function apiLoadDeals(): Promise<Deal[]> {
  const resp = await apiFetch("/deals");
  if (!resp.ok) throw new Error("Failed to load deals");
  const deals = await resp.json() as Deal[];
  // Normalize occupancy on load so stored fraction values (1.0 / 0.99 read as
  // "1%") display correctly everywhere without needing a re-extract.
  return deals.map(normalizeDeal);
}

// Save a deal, retrying transient failures (network drop, 5xx) with backoff. A 4xx
// is a real rejection — don't retry it. Throws after the final attempt fails.
async function putDealWithRetry(id: string, rest: Record<string, unknown>): Promise<void> {
  const delays = [400, 1200, 3000];
  let lastErr = "Failed to save deal";
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const resp = await apiFetch(`/deals/${id}`, { method: "PUT", body: JSON.stringify(rest) });
      if (resp.ok) return;
      if (resp.status >= 400 && resp.status < 500) {
        throw new Error(resp.status === 401 ? "Signed out — please sign in again." : `Save rejected (HTTP ${resp.status}).`);
      }
      lastErr = `Server error (HTTP ${resp.status}).`;
    } catch (e) {
      // A thrown 4xx above is final; rethrow it rather than retrying.
      if (e instanceof Error && /Signed out|Save rejected/.test(e.message)) throw e;
      lastErr = "Network error — couldn't reach the server.";
    }
    if (attempt < delays.length) await new Promise(r => setTimeout(r, delays[attempt]));
  }
  throw new Error(lastErr);
}

export async function apiSaveDeal(deal: Deal): Promise<void> {
  const { id, ...rest } = deal;
  beginSave();
  try {
    await putDealWithRetry(id, rest);
    endSaveOk(id);
  } catch (e) {
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
const THUMB_CAP = 120_000;   // crisp 600px tile thumbnail
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
      headers: { "Content-Type": "image/jpeg" },
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

export async function apiLoadImages(id: string): Promise<ImageBundle | null> {
  const resp = await apiFetch(`/deals/${id}/images`);
  if (!resp.ok) {
    reportClientError(`apiLoadImages failed: HTTP ${resp.status}`, `deal ${id}`);
    return null;
  }
  return resp.json() as Promise<ImageBundle | null>;
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
export interface RatesPayload {
  treasuries: { rows: RateRow[]; asOf: string | null; source: string };
  sofr: { rows: RateRow[]; asOf: string | null; source: string };
  swaps: { rows: RateRow[]; asOf: string | null; source: string; spreadBps: number };
  fetchedAt: string;
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
