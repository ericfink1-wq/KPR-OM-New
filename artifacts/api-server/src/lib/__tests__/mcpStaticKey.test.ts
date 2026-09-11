import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { staticKeyStatus } from "../mcpKeys";
import { KEY_PREFIX } from "../mcpKeys";

// The environment-held break-glass key. It exists because the publish step has
// repeatedly proposed DROP TABLE on mcp_api_keys, destroying the live key — and a
// minted key cannot be recovered, since only its hash is ever stored. A key supplied
// by the environment is never written to the database, so a drop cannot remove it.
//
// It is a credential to the whole library, so these tests pin what it REFUSES.
// Ownership resolution (the account must exist and be approved) needs a database and
// is covered by verifyMcpKey's own account check, which this path reuses verbatim.

const GOOD = `${KEY_PREFIX}${"a".repeat(32)}`;
const saved = { k: process.env.MCP_STATIC_KEY, e: process.env.MCP_STATIC_KEY_EMAIL };

const set = (k?: string, e?: string) => {
  if (k === undefined) delete process.env.MCP_STATIC_KEY; else process.env.MCP_STATIC_KEY = k;
  if (e === undefined) delete process.env.MCP_STATIC_KEY_EMAIL; else process.env.MCP_STATIC_KEY_EMAIL = e;
};

beforeEach(() => set(undefined, undefined));
afterEach(() => set(saved.k, saved.e));

describe("environment key — off unless deliberately and completely configured", () => {
  it("is off when neither variable is set, and says nothing is wrong", () => {
    expect(staticKeyStatus()).toEqual({ configured: false, reason: null, email: null, fingerprint: null, length: null });
  });

  it("REFUSES a key with no named owner — an unowned credential is what we already fail closed on", () => {
    set(GOOD, undefined);
    const st = staticKeyStatus();
    expect(st.configured).toBe(false);
    expect(st.reason).toMatch(/no named owner/);
  });

  it("refuses an owner with no key, and says which half is missing", () => {
    set(undefined, "eric@example.com");
    const st = staticKeyStatus();
    expect(st.configured).toBe(false);
    expect(st.reason).toMatch(/MCP_STATIC_KEY is missing/);
  });

  it("REFUSES a short secret — it must meet the same bar as a minted key", () => {
    for (const weak of [`${KEY_PREFIX}short`, KEY_PREFIX, `${KEY_PREFIX}${"a".repeat(19)}`]) {
      set(weak, "eric@example.com");
      expect(staticKeyStatus().configured, `${weak} must be refused`).toBe(false);
    }
  });

  it("refuses a secret that isn't shaped like a key at all (e.g. a password pasted in)", () => {
    for (const wrong of ["hunter2", "correct-horse-battery-staple-long-enough", "Bearer abc123"]) {
      set(wrong, "eric@example.com");
      expect(staticKeyStatus().configured, `${wrong} must be refused`).toBe(false);
    }
  });

  it("accepts a properly formed key with an owner, and reports the owner lower-cased", () => {
    set(GOOD, "  Eric@Example.COM ");
    const st = staticKeyStatus();
    expect(st.configured).toBe(true);
    expect(st.email).toBe("eric@example.com");
  });

  it("ignores surrounding whitespace, which a pasted secret often carries", () => {
    set(`  ${GOOD}  `, "eric@example.com");
    expect(staticKeyStatus().configured).toBe(true);
  });

  it("treats an empty or whitespace-only secret as unset, not as a valid empty key", () => {
    set("   ", "eric@example.com");
    expect(staticKeyStatus().configured).toBe(false);
  });
});

describe("fingerprint — identifies WHICH key is set, without disclosing it", () => {
  it("shows the prefix and last four, and never the middle", () => {
    set(GOOD, "eric@example.com");
    const st = staticKeyStatus();
    expect(st.fingerprint).toBe(`${KEY_PREFIX}aaaa…aaaa`);
    expect(st.length).toBe(GOOD.length);
    // The entropy must not be reconstructable from what we display.
    expect(st.fingerprint!.length).toBeLessThan(GOOD.length);
    expect(GOOD.includes(st.fingerprint!)).toBe(false);
  });

  it("distinguishes two different keys — the whole point of showing it", () => {
    set(`${KEY_PREFIX}${"a".repeat(28)}ZZZZ`, "eric@example.com");
    const a = staticKeyStatus().fingerprint;
    set(`${KEY_PREFIX}${"a".repeat(28)}QQQQ`, "eric@example.com");
    expect(staticKeyStatus().fingerprint).not.toBe(a);
  });

  it("reports the length, so a paste that dropped characters is visible", () => {
    set(`${KEY_PREFIX}${"a".repeat(24)}`, "eric@example.com");
    expect(staticKeyStatus().length).toBe(KEY_PREFIX.length + 24);
  });

  it("still fingerprints a REJECTED key, so you can see what's wrong in there", () => {
    set(`${KEY_PREFIX}tooshort`, "eric@example.com");
    const st = staticKeyStatus();
    expect(st.configured).toBe(false);
    expect(st.fingerprint).toBeTruthy();
  });
});
