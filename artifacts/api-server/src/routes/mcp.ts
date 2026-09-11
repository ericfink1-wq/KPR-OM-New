// MCP (Model Context Protocol) endpoint — how an outside Claude client reads this
// deal library as a live tool, instead of Eric pasting exports into a chat.
//
// AUTH: this route deliberately does NOT use the site's session cookie — an MCP client
// cannot hold a browser session. Access is gated by a minted API key (lib/mcpKeys.ts)
// that a member creates FOR THEMSELVES after passing password + 2FA, and that is bound
// to their account: every request re-checks that the owning account is still approved, so
// removing someone's login removes their MCP access with it. Nobody can mint a key for
// anyone else. Because it carries its own, stricter door, this router is mounted BEFORE
// the session/2FA gate in routes/index.ts; key MANAGEMENT (mcpAdminRouter) is mounted
// after it, so it still requires a signed-in, 2FA-verified member.
//
// SCOPE: every tool is read-only (see lib/mcpTools.ts). A key can read the library;
// it can never write to it, delete anything, or trigger a token-spending AI call.
import { Router, type Request, type Response, type NextFunction } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MCP_TOOLS, MCP_TOOLS_BY_NAME, MCP_SERVER_INSTRUCTIONS } from "../lib/mcpTools";
import {
  createMcpKey, listMcpKeys, revokeMcpKey, deleteMcpKey,
  verifyMcpKey, extractKeyFromRequest, ensureMcpKeysTable, keyOwner, type VerifiedKey,
  staticKeyStatus, findUserByEmail,
} from "../lib/mcpKeys";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";

// Two routers, deliberately: `router` (the MCP protocol endpoint) is mounted BEFORE
// the site's session/2FA gate because it authenticates with its own API key, while
// `mcpAdminRouter` (minting and revoking those keys) is mounted AFTER it, so managing
// access still requires a fully signed-in, 2FA-verified KPR admin.
const router = Router();
export const mcpAdminRouter: Router = Router();

const SERVER_NAME = "kpr-deal-library";
const SERVER_VERSION = "1.0.0";

// ─── per-key rate limit ─────────────────────────────────────────────────────
// Keyed on the API key (not the session, which MCP requests don't have), so one
// misbehaving client can't hammer the database on everyone else's behalf.
const hits = new Map<string, number[]>();
const PER_MINUTE = 120;
let lastSweep = 0;
function overRateLimit(keyId: string): boolean {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, times] of hits) {
      const kept = times.filter(t => now - t < 60_000);
      if (kept.length) hits.set(k, kept); else hits.delete(k);
    }
  }
  const times = (hits.get(keyId) ?? []).filter(t => now - t < 60_000);
  if (times.length >= PER_MINUTE) { hits.set(keyId, times); return true; }
  times.push(now);
  hits.set(keyId, times);
  return false;
}

// ─── key gate ───────────────────────────────────────────────────────────────
interface McpRequest extends Request { mcpKey?: VerifiedKey }

async function requireMcpKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw = extractKeyFromRequest(req as unknown as { headers: Record<string, unknown>; params?: Record<string, unknown>; query?: Record<string, unknown> });
  const verified = raw ? await verifyMcpKey(raw) : null;
  if (!verified) {
    // WWW-Authenticate tells a well-behaved MCP client that this is an auth failure
    // rather than a broken endpoint, so it prompts for a token instead of retrying.
    res.setHeader("WWW-Authenticate", 'Bearer realm="KPR deal library", error="invalid_token"');
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "This KPR deal library requires an access key. Ask Eric for one, then send it as an Authorization: Bearer header." },
      id: null,
    });
    return;
  }
  if (overRateLimit(verified.id)) {
    res.setHeader("Retry-After", "30");
    res.status(429).json({ jsonrpc: "2.0", error: { code: -32000, message: "Too many requests — slow down and try again shortly." }, id: null });
    return;
  }
  (req as McpRequest).mcpKey = verified;
  next();
}

// ─── MCP server wiring ──────────────────────────────────────────────────────
// One Server + transport per request (stateless mode). Statelessness is the point:
// there is nothing to leak between callers, a restart loses nothing, and the whole
// endpoint stays safe behind a single-process deploy.
function buildServer(keyName: string): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: MCP_SERVER_INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOLS.map(t => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const tool = MCP_TOOLS_BY_NAME.get(name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Unknown tool "${name}". Available: ${MCP_TOOLS.map(t => t.name).join(", ")}` }],
      };
    }
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await tool.handler(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      // Return the failure as tool content rather than throwing: the client can then
      // tell the user what broke instead of the whole conversation dying on a 500.
      logger.error({ err, tool: name, key: keyName }, "MCP tool call failed");
      return {
        isError: true,
        content: [{ type: "text" as const, text: `The "${name}" tool failed: ${err instanceof Error ? err.message : "unknown error"}. The data was not changed (this server is read-only).` }],
      };
    }
  });

  return server;
}

async function handleMcp(req: Request, res: Response): Promise<void> {
  const key = (req as McpRequest).mcpKey!;
  const server = buildServer(key.name);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,   // stateless — no server-side session to hijack
    enableJsonResponse: true,        // plain JSON replies; clients that want SSE still get it
  });
  res.on("close", () => {
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error({ err }, "MCP request failed");
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
}

// GET on a Streamable HTTP endpoint opens a server→client notification stream. This
// server is STATELESS and never sends unsolicited notifications, so that stream can only
// ever sit there — and it did: a GET held the connection open indefinitely instead of
// returning, which is an accidental resource leak and a very cheap way to tie up a
// single-process server. The spec permits refusing it, so refuse it explicitly. DELETE
// gets the same treatment: it exists to end a session that stateless mode never creates.
function methodNotAllowed(_req: Request, res: Response): void {
  res.setHeader("Allow", "POST");
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "This MCP endpoint is stateless and accepts POST only. It never sends " +
        "server-initiated notifications, so there is no GET stream to open.",
    },
    id: null,
  });
}

// `/mcp` with an Authorization: Bearer header is the preferred shape. `/mcp/k/<key>`
// exists for clients that accept only a bare URL (some claude.ai custom-connector
// setups) — same key, same revocation, but the secret rides in the path, so the admin UI
// labels it as the less-private option.
router.post("/mcp", requireMcpKey, handleMcp);
router.post("/mcp/k/:key", requireMcpKey, handleMcp);
router.get("/mcp", methodNotAllowed);
router.get("/mcp/k/:key", methodNotAllowed);
router.delete("/mcp", methodNotAllowed);
router.delete("/mcp/k/:key", methodNotAllowed);

// ─── admin: key management (session-authenticated, admin only) ──────────────
// Ordinary site routes behind the session + 2FA gate. Access is SELF-SERVICE and tied to
// the signed-in account: a member mints a key for THEMSELVES, having just proved who they
// are with a password and an authenticator code. Nobody can obtain a key without a live
// KPR account, and nobody can mint one on someone else's behalf. Admins get oversight —
// they can see and revoke every key — but handing keys out is not the model, because a
// handed-out key says nothing about who is holding it.
mcpAdminRouter.get("/mcp-keys", requireAuth, async (req, res) => {
  try {
    // A member sees their own keys. An admin can ask for everyone's, for oversight.
    const wantsAll = req.session.isAdmin && String(req.query.all ?? "") === "1";
    const keys = await listMcpKeys(wantsAll ? null : req.session.userId);
    // Report the environment-held key too. It lives in deploy secrets rather than the
    // database (so a dropped table can't destroy it), which also means it appears
    // nowhere in the list above — without this the UI would show "no keys" while a
    // perfectly good one is working, and a misconfigured secret would fail silently.
    // Report the environment-held key too. It lives in deploy secrets rather than the
    // database (so a dropped table can't destroy it), which also means it appears
    // nowhere in the list above — without this the UI would show "no keys" while a
    // perfectly good one is working, and a misconfigured secret would fail silently.
    //
    // The format check alone isn't enough to explain a 401: the key ALSO requires an
    // approved account matching MCP_STATIC_KEY_EMAIL, and the commonest mistake is
    // naming an address that isn't the one the person signs in with. So resolve the
    // owner here and say precisely which half is wrong, rather than "not working".
    const staticKey: { configured: boolean; reason: string | null; email: string | null } = staticKeyStatus();
    if (staticKey.configured && staticKey.email) {
      const owner = await findUserByEmail(staticKey.email);
      if (!owner) {
        staticKey.configured = false;
        staticKey.reason = `No account here uses ${staticKey.email}. Set MCP_STATIC_KEY_EMAIL to the email address you sign in with.`;
      } else if (owner.status !== "approved") {
        staticKey.configured = false;
        staticKey.reason = `The account ${staticKey.email} is "${owner.status}", not approved, so the key is refused.`;
      }
    }
    res.json({ keys, scope: wantsAll ? "all" : "mine", isAdmin: !!req.session.isAdmin, staticKey });
  } catch (err) {
    logger.error({ err }, "Failed to list MCP keys");
    res.status(500).json({ error: "Failed to load access keys" });
  }
});

mcpAdminRouter.post("/mcp-keys", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
    const body = req.body as { name?: string; expiresInDays?: number };
    // Always minted for the CALLER. There is deliberately no way to mint for someone
    // else: a key must correspond to an account whose owner passed 2FA to create it.
    const created = await createMcpKey({
      userId,
      name: String(body?.name ?? "").trim() || "Unnamed key",
      createdBy: userId,
      createdByEmail: req.session.userEmail ?? null,
      expiresInDays: typeof body?.expiresInDays === "number" ? body.expiresInDays : null,
    });
    logger.info({ keyId: created.summary.id, by: req.session.userEmail }, "MCP access key created");
    // The raw key is returned exactly once — it is not stored and can never be
    // shown again. The UI must make the admin copy it now.
    res.json({ key: created.key, summary: created.summary });
  } catch (err) {
    // A hit limit is the caller's to fix, not a server fault — say what to do about it.
    if ((err as { code?: string })?.code === "key_limit_reached") {
      res.status(409).json({ error: (err as Error).message, code: "key_limit_reached" });
      return;
    }
    logger.error({ err }, "Failed to create MCP key");
    res.status(500).json({ error: "Failed to create access key" });
  }
});

// A member may revoke their OWN keys; an admin may revoke anyone's.
async function mayManage(req: Parameters<typeof requireAuth>[0], id: string): Promise<boolean> {
  if (req.session.isAdmin) return true;
  const owner = await keyOwner(id);
  return !!owner && owner === req.session.userId;
}

mcpAdminRouter.post("/mcp-keys/:id/revoke", requireAuth, async (req, res) => {
  try {
    if (!(await mayManage(req, String(req.params.id)))) { res.status(403).json({ error: "That key belongs to someone else." }); return; }
    const ok = await revokeMcpKey(String(req.params.id), req.session.userEmail ?? null);
    logger.info({ keyId: req.params.id, by: req.session.userEmail, ok }, "MCP access key revoked");
    res.json({ ok });
  } catch (err) {
    logger.error({ err }, "Failed to revoke MCP key");
    res.status(500).json({ error: "Failed to revoke access key" });
  }
});

mcpAdminRouter.delete("/mcp-keys/:id", requireAuth, async (req, res) => {
  try {
    if (!(await mayManage(req, String(req.params.id)))) { res.status(403).json({ error: "That key belongs to someone else." }); return; }
    res.json({ ok: await deleteMcpKey(String(req.params.id)) });
  } catch (err) {
    logger.error({ err }, "Failed to delete MCP key");
    res.status(500).json({ error: "Failed to delete access key" });
  }
});

// What the admin screen shows as the connection details, so the UI never has to
// guess the public origin (Replit sits behind a proxy).
mcpAdminRouter.get("/mcp-info", requireAuth, async (req, res) => {
  await ensureMcpKeysTable().catch(() => {});
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0] || req.get("host") || "";
  const base = `${proto}://${host}`;
  res.json({
    serverName: SERVER_NAME,
    version: SERVER_VERSION,
    url: `${base}/api/mcp`,
    urlWithKeyTemplate: `${base}/api/mcp/k/<YOUR-KEY>`,
    tools: MCP_TOOLS.map(t => ({ name: t.name, title: t.title })),
  });
});

export default router;
