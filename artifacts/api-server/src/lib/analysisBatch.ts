// Anthropic Message Batches API client. Batches are processed asynchronously at ~50% of
// the per-token cost, so we use them for the BULK roster-analysis refresh (many stale
// deals at once) where latency doesn't matter but token cost does. Each request's
// custom_id is the deal id, so results map straight back with no stored cross-reference.
//
// Deliberately DB-free (only undici), so the pure helpers (custom_id validation, JSONL
// parsing) are unit-testable without a database connection.

import { Agent, fetch as undiciFetch } from "undici";

const ANTHROPIC_BATCH_URL = "https://api.anthropic.com/v1/messages/batches";

// Own agent (not shared with extract.ts) to keep this module free of DB imports.
const batchAgent = new Agent({
  headersTimeout: 5 * 60 * 1000,
  bodyTimeout: 10 * 60 * 1000,
  connectTimeout: 30 * 1000,
});
const batchHeaders = () => ({ "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" });

export interface BatchRequest { custom_id: string; params: Record<string, unknown> }
export interface BatchResultLine { custom_id: string; result: Record<string, unknown> }

// custom_id must be ≤64 chars of [a-zA-Z0-9_-]. App-generated deal ids qualify; this
// guards against an unusual imported id ever breaking a whole batch.
export const isValidBatchCustomId = (id: string): boolean => /^[a-zA-Z0-9_-]{1,64}$/.test(id);

export async function createMessageBatch(requests: BatchRequest[]): Promise<Record<string, unknown>> {
  const resp = await undiciFetch(ANTHROPIC_BATCH_URL, {
    method: "POST", headers: batchHeaders(), body: JSON.stringify({ requests }), dispatcher: batchAgent,
  }) as unknown as Response;
  const data = await resp.json() as Record<string, unknown>;
  if (!resp.ok) throw new Error(`Batch create failed (${resp.status}): ${JSON.stringify(data.error ?? data)}`);
  return data;
}

export async function retrieveMessageBatch(batchId: string): Promise<Record<string, unknown>> {
  const resp = await undiciFetch(`${ANTHROPIC_BATCH_URL}/${encodeURIComponent(batchId)}`, {
    method: "GET", headers: batchHeaders(), dispatcher: batchAgent,
  }) as unknown as Response;
  const data = await resp.json() as Record<string, unknown>;
  if (!resp.ok) throw new Error(`Batch retrieve failed (${resp.status}): ${JSON.stringify(data.error ?? data)}`);
  return data;
}

export async function fetchBatchResults(resultsUrl: string): Promise<BatchResultLine[]> {
  const resp = await undiciFetch(resultsUrl, { method: "GET", headers: batchHeaders(), dispatcher: batchAgent }) as unknown as Response;
  if (!resp.ok) throw new Error(`Batch results fetch failed (${resp.status})`);
  return parseBatchResultsJsonl(await resp.text());
}

// Pure JSONL parser (one result object per line). A malformed line is skipped rather than
// failing the whole apply. Exported for tests.
export function parseBatchResultsJsonl(text: string): BatchResultLine[] {
  const out: BatchResultLine[] = [];
  for (const line of (text ?? "").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s) as { custom_id?: string; result?: Record<string, unknown> };
      if (obj.custom_id && obj.result) out.push({ custom_id: obj.custom_id, result: obj.result });
    } catch { /* skip malformed line */ }
  }
  return out;
}
