import { describe, it, expect, vi, beforeEach } from "vitest";

// The tool's gate: approved ADMIN only, auto-refresh must be ON, and the minted token comes
// back with its expiry and the URLs the scheduled task needs. DB-touching helpers are mocked;
// the token-row rules are tested directly below.
const user = vi.hoisted(() => ({ row: null as null | { status: string; isAdmin: boolean } }));
const auto = vi.hoisted(() => ({ enabled: true, minted: 0 }));
vi.mock("@workspace/db", () => ({
  usersTable: { status: "status", isAdmin: "isAdmin", id: "id" },
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => (user.row ? [user.row] : []) }) }) }) },
}));
vi.mock("../datexAutoRefresh", async (orig) => ({
  ...(await orig<typeof import("../datexAutoRefresh")>()),
  getAutoRefreshSetting: async () => ({ enabled: auto.enabled, updatedBy: auto.enabled ? null : "efink@kprcenters.com", updatedAt: "2026-10-18T12:00:00Z" }),
  mintTempIngestToken: async (_by: unknown, now = Date.now()) => { auto.minted++; return { token: "kpr_dxt_" + "x".repeat(43), id: "ingest_token_temp:1", expiresAt: new Date(now + 3 * 3600_000).toISOString() }; },
}));

import { datexRefreshCredentials } from "../mcpDatexCredentials";
import { tokenKindFor, tokenRowUsable, TEMP_TOKEN_TTL_MS } from "../datexAutoRefresh";

const ctx = { caller: { id: "mcpk_1", name: "Eric laptop", userId: "u1", email: "efink@kprcenters.com" }, baseUrl: "https://kpr-oms.replit.app/" };

describe("datex_refresh_credentials", () => {
  beforeEach(() => { user.row = { status: "approved", isAdmin: true }; auto.enabled = true; auto.minted = 0; });

  it("mints for an approved admin and returns token, expiry and URLs", async () => {
    const r = await datexRefreshCredentials.handler({}, ctx) as Record<string, string>;
    expect(r.token.startsWith("kpr_dxt_")).toBe(true);
    expect(Date.parse(r.expiresAt) - Date.now()).toBeGreaterThan(2.9 * 3600_000);
    expect(r.baseUrl).toBe("https://kpr-oms.replit.app");
    expect(r.jobKitUrl).toBe("https://kpr-oms.replit.app/api/datex/job-kit");
    expect(Object.keys(r).sort()).toEqual(["baseUrl", "expiresAt", "jobKitUrl", "token"]);
  });
  it("refuses a non-admin, an unapproved admin, and a call with no caller", async () => {
    user.row = { status: "approved", isAdmin: false };
    await expect(datexRefreshCredentials.handler({}, ctx)).rejects.toThrow(/only an approved KPR admin/);
    user.row = { status: "rejected", isAdmin: true };
    await expect(datexRefreshCredentials.handler({}, ctx)).rejects.toThrow(/only an approved KPR admin/);
    await expect(datexRefreshCredentials.handler({})).rejects.toThrow(/only an approved KPR admin/);
    expect(auto.minted).toBe(0);
  });
  it("refuses clearly when auto-refresh is turned off — and mints nothing", async () => {
    auto.enabled = false;
    await expect(datexRefreshCredentials.handler({}, ctx)).rejects.toThrow(/turned OFF \(by efink@kprcenters.com on 2026-10-18\).*No token was issued/);
    expect(auto.minted).toBe(0);
  });
  it("keeps a short description and is marked not read-only", () => {
    expect(datexRefreshCredentials.description.length).toBeLessThan(200);
    expect(datexRefreshCredentials.readOnly).toBe(false);
  });
});

describe("short-lived token rules", () => {
  it("prefix decides the kind — short-lived tokens are never looked up as permanent ones", () => {
    expect(tokenKindFor("kpr_dxt_" + "a".repeat(43))).toBe("ingest_token_temp");
    expect(tokenKindFor("kpr_dx_" + "a".repeat(43))).toBe("ingest_token");
    expect(tokenKindFor("kpr_dxt_short")).toBeNull();
    expect(tokenKindFor("kpr_mcp_" + "a".repeat(43))).toBeNull();
  });
  it("expired → refused (401); unexpired → accepted; no expiry on a short-lived row → refused", () => {
    const now = Date.parse("2026-10-18T12:00:00Z");
    const exp = new Date(now + TEMP_TOKEN_TTL_MS).toISOString();
    expect(tokenRowUsable({ expiresAt: exp }, true, now)).toBe(true);
    expect(tokenRowUsable({ expiresAt: exp }, true, now + TEMP_TOKEN_TTL_MS + 1)).toBe(false);
    expect(tokenRowUsable({}, true, now)).toBe(false);
    expect(tokenRowUsable({ expiresAt: exp, revokedAt: "x" }, true, now)).toBe(false);
    expect(tokenRowUsable({}, false, now)).toBe(true);           // permanent tokens don't expire
    expect(TEMP_TOKEN_TTL_MS).toBe(3 * 3600_000);
  });
});
