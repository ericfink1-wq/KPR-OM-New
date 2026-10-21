import { Router } from "express";
import { callAnthropicOnce, robustParseJSON, runOmExtraction } from "../lib/extract";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";

const router = Router();

// Per-user ceilings on the LLM endpoints — defense against a runaway retry loop or
// one user monopolizing the Anthropic budget. Generous enough for normal analyst use.
const aiLimit = rateLimit({ bucket: "ai", perMinute: 20, perHour: 240 });

// Only allow the models the app actually uses. Without this, the authenticated
// proxy could be pointed at an arbitrary (pricier) model on our API key. Built from
// every "claude-" model the client sends today, plus the server default.
const MODEL_ALLOWLIST = new Set([
  "claude-sonnet-4-5",           // still accepted (an old open tab may send it) — upgraded below
  "claude-sonnet-4-6",           // default
  "claude-haiku-4-5-20251001",
]);

// A high SAFETY NET on answer length, not a real cap: legitimate callers request up
// to 16000 (sales/abstract/amort extraction), so this only blocks a pathological
// "give me 200,000 tokens" abuse request. NEVER clips normal analyst/extraction use.
const MAX_TOKENS_CAP = 32000;

// POST /api/ai/messages — generic Claude proxy (used by AnalystChat, DetailView lookups).
// requireAuth is essential here: without it the public URL is an open proxy to the
// Anthropic API key for anyone on the internet.
router.post("/ai/messages", requireAuth, aiLimit, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return;
  }

  const { model, max_tokens, system, messages, tools } = req.body;
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "messages are required" });
    return;
  }
  // Token count: reject a non-positive/garbage value; clamp a too-large one DOWN to
  // the safety cap (don't error — just clamp, so normal use is never rejected).
  const nTokens = Number(max_tokens);
  if (!Number.isFinite(nTokens) || nTokens <= 0) {
    res.status(400).json({ error: "max_tokens must be a positive number" });
    return;
  }
  const cappedTokens = Math.min(nTokens, MAX_TOKENS_CAP);
  // Reject an unknown/unsupported model (an omitted model falls back to the default).
  if (model != null && model !== "" && !MODEL_ALLOWLIST.has(model)) {
    res.status(400).json({ error: `Unsupported model "${String(model)}". Allowed models: ${[...MODEL_ALLOWLIST].join(", ")}.` });
    return;
  }

  try {
    // Default = current Sonnet (Eric, 10/21/26). 4.5 is deprecated and costs the same, so a
    // request that omits the model, or still names 4.5, runs on 4.6.
    const resolvedModel = !model || model === "claude-sonnet-4-5" ? "claude-sonnet-4-6" : model;
    const body: Record<string, unknown> = { model: resolvedModel, max_tokens: cappedTokens, messages };
    if (system) {
      // Prompt-cache a LARGE, stable system prompt (e.g. the Analyst's whole-library
      // context) so follow-up turns and repeat queries reuse it at ~10% of the input
      // cost instead of re-billing the full library every time — no answer-quality
      // trade-off (the model still sees everything). Small prompts are sent plainly to
      // avoid the cache-write premium. Cache lives ~5 min and keys on the exact prefix.
      body.system = typeof system === "string" && system.length > 4000
        ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
        : system;
    }
    if (tools) body.tools = tools;
    // Automatic caching for multi-turn Analyst chats: the API moves this breakpoint to the
    // end of the conversation as it grows, so each follow-up re-reads the earlier turns at
    // ~10% of the input price instead of paying full price for the whole history again.
    // Prompts too short to cache are simply sent uncached (no error, no premium).
    if (messages.length > 1) body.cache_control = { type: "ephemeral" };

    const upstream = await callAnthropicOnce(body);
    const data = await upstream.json() as Record<string, unknown>;

    if (!upstream.ok) {
      const errMsg = typeof data.error === "object" && data.error !== null
        ? (data.error as Record<string, unknown>).message ?? JSON.stringify(data.error)
        : String(data.error ?? "Unknown upstream error");
      req.log.error({ status: upstream.status, errMsg }, "Anthropic API error");
      res.status(upstream.status >= 500 ? 502 : 400).json({ error: String(errMsg) });
      return;
    }

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to proxy AI message");
    res.status(500).json({ error: "Failed to reach AI service" });
  }
});

// POST /api/ai/extract — kept for backward compatibility; prefer /api/deals/ingest for PDF uploads
router.post("/ai/extract", requireAuth, aiLimit, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return;
  }

  const { text } = req.body;
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "text is required" });
    return;
  }

  try {
    const result = await runOmExtraction(text);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "OM extraction failed");
    res.status(500).json({ error: message });
  }
});

export { robustParseJSON };
export default router;
