import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getAutoRefreshSetting, mintTempIngestToken } from "./datexAutoRefresh";
import type { McpCallContext, McpToolDef } from "./mcpTools";

// datex_refresh_credentials — the ONE tool on this connector that is not read-only (Eric
// approved it, 10/18/26). It lets the scheduled Datex refresh, running in a cloud Claude
// session that already holds this connector, get a short-lived ingest token instead of
// carrying a pasted kpr_dx_ token. The token it mints can do exactly what kpr_dx_ can —
// GET /datex/state, POST /datex/ingest, GET /datex/job-kit — and expires in 3 hours.
//
// Who may call it: the KPR account that owns the connector key must be an APPROVED ADMIN,
// re-checked on every call. (The connector authenticates with a key bound to a KPR account;
// there is no separate OAuth identity, so the key's owner is the user.)
export const DEFAULT_PUBLIC_BASE = "https://kpr-oms.replit.app";

export async function isApprovedAdmin(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const [u] = await db.select({ status: usersTable.status, isAdmin: usersTable.isAdmin }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return !!u && u.status === "approved" && u.isAdmin === true;
}

export const datexRefreshCredentials: McpToolDef = {
  name: "datex_refresh_credentials",
  title: "Datex refresh credentials",
  description: "Admins only. Mints a 3-hour ingest token for the scheduled Datex refresh (state, ingest and job-kit only). Returns {token, expiresAt, baseUrl, jobKitUrl}.",
  readOnly: false,
  inputSchema: { type: "object", properties: {} },
  handler: async (_args, ctx?: McpCallContext) => {
    const caller = ctx?.caller;
    if (!caller || !(await isApprovedAdmin(caller.userId))) {
      throw new Error("Not allowed: only an approved KPR admin can mint Datex refresh credentials. This connector key belongs to a non-admin account.");
    }
    const setting = await getAutoRefreshSetting();
    if (!setting.enabled) {
      throw new Error(`Datex auto-refresh is turned OFF${setting.updatedBy ? ` (by ${setting.updatedBy}${setting.updatedAt ? ` on ${setting.updatedAt.slice(0, 10)}` : ""})` : ""}. An admin can turn it back on at Asset Mgmt → Properties → Datex auto-refresh. No token was issued.`);
    }
    const minted = await mintTempIngestToken({ userId: caller.userId, email: caller.email, via: `MCP key "${caller.name}"` });
    if ("problem" in minted) throw new Error(minted.problem);
    const baseUrl = (ctx?.baseUrl || DEFAULT_PUBLIC_BASE).replace(/\/+$/, "");
    return { token: minted.token, expiresAt: minted.expiresAt, baseUrl, jobKitUrl: `${baseUrl}/api/datex/job-kit` };
  },
};
