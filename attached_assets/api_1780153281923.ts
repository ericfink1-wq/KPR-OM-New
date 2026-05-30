// API layer — replaces IndexedDB with backend calls
// All functions maintain the same signatures as idb.ts for easy drop-in replacement

import type { Deal, ImageBundle } from "./idb";

const BASE = "/api";

async function apiFetch(path: string, opts?: RequestInit): Promise<Response> {
  const resp = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    ...opts,
  });
  return resp;
}

// --- Auth ---

export async function apiLogin(password: string): Promise<{ ok: boolean; error?: string }> {
  const resp = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: body.error || "Login failed" };
  }
  return { ok: true };
}

export async function apiLogout(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" });
}

export async function apiCheckAuth(): Promise<{ authenticated: boolean; isAdmin: boolean }> {
  try {
    const resp = await apiFetch("/auth/me");
    if (!resp.ok) return { authenticated: false, isAdmin: false };
    const body = await resp.json() as { authenticated?: boolean; isAdmin?: boolean };
    return { authenticated: !!body.authenticated, isAdmin: !!body.isAdmin };
  } catch {
    return { authenticated: false, isAdmin: false };
  }
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
  return resp.json() as Promise<Deal[]>;
}

export async function apiSaveDeal(deal: Deal): Promise<void> {
  const { id, ...rest } = deal;
  const resp = await apiFetch(`/deals/${id}`, {
    method: "PUT",
    body: JSON.stringify({ ...rest }),
  });
  if (!resp.ok) throw new Error("Failed to save deal");
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

export async function apiSaveImages(id: string, bundle: ImageBundle): Promise<void> {
  const resp = await apiFetch(`/deals/${id}/images`, {
    method: "PUT",
    body: JSON.stringify(bundle),
  });
  if (!resp.ok) throw new Error("Failed to save images");
}

export async function apiLoadImages(id: string): Promise<ImageBundle | null> {
  const resp = await apiFetch(`/deals/${id}/images`);
  if (!resp.ok) return null;
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
