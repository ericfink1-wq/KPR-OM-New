import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  apiMcpInfo, apiListMcpKeys, apiCreateMcpKey, apiRevokeMcpKey, apiDeleteMcpKey,
  type McpKeySummary, type McpInfo, type StaticKeyStatus } from "../lib/api";
import { useIsMobile } from "../hooks/use-mobile";

// Admin-only screen for "Claude access": mint and revoke the keys that let an outside
// Claude (desktop app, Claude Code, or a claude.ai connector) read this deal library
// live through the MCP endpoint at /api/mcp.
//
// Written for a non-technical admin: every step is spelled out, the key is copyable in
// one tap, and the destructive action (revoke) is confirmed and reversible only by
// minting a new key. Access is per-key, so one person losing a laptop never means
// cutting off everyone else.

function relTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function CopyBox({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); }
    catch {
      // Clipboard API is blocked in some mobile browsers — fall back to a hidden
      // textarea + execCommand so "Copy" still works rather than silently no-op'ing.
      const ta = document.createElement("textarea");
      ta.value = value; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* nothing more we can do */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div>
      {label && <div style={{ fontSize: 10.5, fontWeight: 700, color: "#a69e91", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{label}</div>}
      <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
        <code style={{
          flex: "1 1 auto", minWidth: 0, background: "#fff", border: "1px solid #e3dccd", borderRadius: 7,
          padding: "8px 10px", fontSize: 11.5, color: "#26281f", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          overflowWrap: "anywhere", lineHeight: 1.45,
          // pre-wrap so multi-line config JSON keeps its indentation instead of
          // collapsing into one unreadable run of text.
          whiteSpace: "pre-wrap",
        }}>{value}</code>
        <button onClick={copy} style={{
          flexShrink: 0, background: copied ? "#eef7ee" : "#fff", border: `1px solid ${copied ? "#cfe9c4" : "#ddd4c2"}`,
          color: copied ? "#0f7a3d" : "#52554e", borderRadius: 7, padding: "0 12px", height: 38,
          alignSelf: "flex-start", cursor: "pointer", fontSize: 11.5, fontWeight: 700,
          fontFamily: "'Inter',sans-serif", whiteSpace: "nowrap",
        }}>{copied ? "✓ Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

export default function McpAccess({ onClose, isAdmin = false }: { onClose: () => void; isAdmin?: boolean }) {
  const isMobile = useIsMobile();
  const [showAll, setShowAll] = useState(false);   // admin oversight: everyone's keys
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [keys, setKeys] = useState<McpKeySummary[] | null>(null);
  // Environment-held key (deploy secret). Not in `keys` — it never touches the DB.
  const [staticKey, setStaticKey] = useState<StaticKeyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<{ key: string; name: string } | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [howTo, setHowTo] = useState<"desktop" | "code" | "web">("desktop");

  const load = useCallback(() => {
    setError(null);
    apiMcpInfo().then(setInfo).catch(() => setError("Couldn't load the connection details."));
    apiListMcpKeys(showAll).then(r => { setKeys(r.keys); setStaticKey(r.staticKey ?? null); }).catch(() => setError("Couldn't load the access keys."));
  }, [showAll]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const create = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await apiCreateMcpKey(newName.trim() || "Unnamed key");
      setMinted({ key: r.key, name: r.summary.name });
      setNewName("");
      load();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't create the key."); }
    finally { setBusy(false); }
  };

  const revoke = async (k: McpKeySummary) => {
    if (!window.confirm(`Turn off access for "${k.name}"?\n\nThat connection stops working immediately. This can't be undone — a new key would have to be created.`)) return;
    setBusy(true); setError(null);
    try { await apiRevokeMcpKey(k.id); load(); }
    catch { setError("Couldn't revoke that key — try again."); }
    finally { setBusy(false); }
  };

  const remove = async (k: McpKeySummary) => {
    if (!window.confirm(`Delete the record of "${k.name}" from this list?\n\nIt's already switched off — this just tidies the list.`)) return;
    setBusy(true);
    try { await apiDeleteMcpKey(k.id); load(); }
    catch { setError("Couldn't delete that record."); }
    finally { setBusy(false); }
  };

  const active = (keys || []).filter(k => k.active);
  const dead = (keys || []).filter(k => !k.active);
  const url = info?.url ?? "";
  const urlWithKey = minted && info ? info.urlWithKeyTemplate.replace("<YOUR-KEY>", minted.key) : "";

  const desktopConfig = minted
    ? JSON.stringify({ mcpServers: { "kpr-deal-library": { type: "http", url, headers: { Authorization: `Bearer ${minted.key}` } } } }, null, 2)
    : "";
  const codeCommand = minted
    ? `claude mcp add --transport http kpr-deal-library ${url} --header "Authorization: Bearer ${minted.key}"`
    : "";

  const sectionTitle = (t: string) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: "#a69e91", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{t}</div>
  );

  const tab = (id: "desktop" | "code" | "web", label: string) => (
    <button key={id} onClick={() => setHowTo(id)} style={{
      background: howTo === id ? "#26281f" : "#fff",
      color: howTo === id ? "#e8e0cf" : "#52554e",
      border: `1px solid ${howTo === id ? "#26281f" : "#ddd4c2"}`,
      borderRadius: 7, padding: "6px 11px", fontSize: 11.5, fontWeight: 600,
      cursor: "pointer", fontFamily: "'Inter',sans-serif", flex: isMobile ? "1 1 auto" : "0 0 auto",
    }}>{label}</button>
  );

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9700, background: "rgba(38,40,31,0.42)", backdropFilter: "blur(2px)" }} />
      <div role="dialog" aria-label="Claude access" style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 9701,
        width: "min(680px, 94vw)", maxHeight: "88vh", background: "#faf7f0", border: "1px solid #e0d8c8",
        borderRadius: 14, boxShadow: "0 18px 56px rgba(38,40,31,0.28)", display: "flex", flexDirection: "column",
        overflow: "hidden", fontFamily: "'Inter',sans-serif",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #ece5d7", background: "#fff", flexShrink: 0 }}>
          <span style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 600, color: "#26281f" }}>Claude access</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "1px solid #e3dccd", color: "#7d766a", width: 30, height: 30, borderRadius: 7, cursor: "pointer", fontSize: 15 }}>✕</button>
        </div>

        <div style={{ padding: isMobile ? "14px 13px" : "16px 18px", overflowY: "auto" }}>
          <p style={{ margin: "0 0 10px", fontSize: 12.5, lineHeight: 1.55, color: "#52554e" }}>
            This connects Claude directly to the deal library, so you can ask about centers,
            tenants, rents, lease terms and comps in any Claude chat — no exporting, no pasting.
            Claude can only <strong>read</strong> the library; it can't change or delete anything.
          </p>
          <p style={{ margin: "0 0 14px", fontSize: 12, lineHeight: 1.55, color: "#6f6a5f", background: "#f4f1e8", border: "1px solid #e3dccd", borderRadius: 8, padding: "10px 12px" }}>
            Keys are tied to <strong>your KPR account</strong>. You create your own below — you've
            already proved who you are by signing in — and it works only while your account is
            active. If your account is removed or suspended, the key stops working straight away.
            That also means a key is <strong>personal</strong>: don't pass it to anyone, including
            colleagues. They can make their own in ten seconds.
          </p>

          {error && <div style={{ color: "#c0392b", fontSize: 12.5, marginBottom: 12 }}>⚠ {error}</div>}

          {/* The freshly-minted key — shown once, with ready-to-use setup. */}
          {minted && (
            <div style={{ border: "1px solid #cfe9c4", background: "#f4faf2", borderRadius: 10, padding: isMobile ? 12 : 14, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f7a3d", marginBottom: 4 }}>Key created — copy it now</div>
              <p style={{ margin: "0 0 10px", fontSize: 12, lineHeight: 1.5, color: "#4a5a44" }}>
                This is the only time it will ever be shown. If you lose it, come back and create
                a new one. Treat it like a password — anyone with it can read the library.
              </p>
              <CopyBox value={minted.key} label={`Key for "${minted.name}"`} />

              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                  {tab("desktop", "Claude desktop app")}
                  {tab("code", "Claude Code")}
                  {tab("web", "claude.ai")}
                </div>
                {howTo === "desktop" && (
                  <>
                    <p style={{ margin: "0 0 8px", fontSize: 12, lineHeight: 1.55, color: "#4a5a44" }}>
                      In the Claude desktop app open <strong>Settings → Connectors → Add custom connector</strong>,
                      or paste this into your <code>claude_desktop_config.json</code>:
                    </p>
                    <CopyBox value={desktopConfig} />
                  </>
                )}
                {howTo === "code" && (
                  <>
                    <p style={{ margin: "0 0 8px", fontSize: 12, lineHeight: 1.55, color: "#4a5a44" }}>
                      Run this once in a terminal — Claude Code will remember it:
                    </p>
                    <CopyBox value={codeCommand} />
                  </>
                )}
                {howTo === "web" && (
                  <>
                    <p style={{ margin: "0 0 8px", fontSize: 12, lineHeight: 1.55, color: "#4a5a44" }}>
                      On claude.ai go to <strong>Settings → Connectors → Add custom connector</strong> and paste
                      this address. The key is built into the link, so no extra setup is needed —
                      but that also means the link itself is the password. Only paste it into your
                      own Claude settings, never into a chat, an email or a shared doc.
                    </p>
                    <CopyBox value={urlWithKey} />
                  </>
                )}
              </div>
              <button onClick={() => setMinted(null)} style={{ marginTop: 12, background: "transparent", border: "1px solid #cfe9c4", color: "#0f7a3d", borderRadius: 7, padding: "6px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                I've saved it — hide
              </button>
            </div>
          )}

          {/* Create */}
          <div style={{ marginBottom: 18 }}>
            {sectionTitle("Create a key for yourself")}
            <div style={{ display: "flex", gap: 8, flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center" }}>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void create(); }}
                placeholder="What's it for? e.g. “My laptop”, “Claude desktop app”"
                style={{ flex: "1 1 auto", minWidth: 0, background: "#fff", border: "1px solid #e3dccd", borderRadius: 7, padding: "9px 11px", fontSize: 12.5, color: "#26281f", fontFamily: "'Inter',sans-serif", minHeight: 38 }}
              />
              <button onClick={create} disabled={busy} style={{
                background: busy ? "#e3dccd" : "#26281f", color: busy ? "#a89f8f" : "#e8e0cf", border: "none",
                borderRadius: 7, padding: "9px 16px", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer",
                fontFamily: "'Inter',sans-serif", minHeight: 38, whiteSpace: "nowrap",
              }}>{busy ? "…" : "Create key"}</button>
            </div>
            <div style={{ fontSize: 11, color: "#a69e91", marginTop: 6, lineHeight: 1.5 }}>
              Make a separate key per device, so losing one laptop doesn't mean re-doing the rest.
            </div>
          </div>

          {/* The environment-held key. Shown ABOVE the list because it is not in the
              list: it lives in deploy secrets, so it survives the database being
              rebuilt — which is exactly when someone will be looking here, wondering
              why their connector died. A broken secret says so rather than failing
              silently. */}
          {staticKey && (staticKey.configured || staticKey.reason) && (
            <div style={{
              display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap",
              border: `1px solid ${staticKey.configured ? "#cfe0cb" : "#f0d9a8"}`,
              background: staticKey.configured ? "#f4f8f2" : "#fdf6e7",
              borderRadius: 10, padding: "10px 12px", marginBottom: 14, fontSize: 12.5, lineHeight: 1.45,
            }}>
              <span style={{ fontSize: 15, lineHeight: 1.2 }}>{staticKey.configured ? "🔒" : "⚠️"}</span>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                {staticKey.configured ? (
                  <>
                    <strong>Backup key active</strong> — set in the deployment secrets and owned by{" "}
                    <span style={{ wordBreak: "break-all" }}>{staticKey.email}</span>. It isn't stored in the
                    database, so republishing can't wipe it. Change or remove the <code>MCP_STATIC_KEY</code>{" "}
                    secret to rotate or switch it off.
                  </>
                ) : (
                  <>
                    <strong>Backup key not active.</strong> {staticKey.reason}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Active keys */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              {sectionTitle(showAll ? `Active keys — everyone · ${active.length}` : `Your active keys · ${active.length}`)}
              {isAdmin && (
                <button onClick={() => setShowAll(v => !v)}
                  style={{ background: "transparent", border: "1px solid #ddd4c2", color: "#52554e", borderRadius: 6, padding: "3px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer", marginBottom: 8 }}>
                  {showAll ? "Show only mine" : "Show everyone's"}
                </button>
              )}
            </div>
            {!keys && <div style={{ color: "#a69e91", fontSize: 12.5 }}>Loading…</div>}
            {keys && active.length === 0 && (
              <div style={{ color: "#a69e91", fontSize: 12.5 }}>
                {showAll ? "Nobody has an active key yet." : "You don't have a key yet — create one above to connect Claude."}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {active.map(k => (
                <div key={k.id} style={{ border: "1px solid #ece5d7", borderRadius: 9, background: "#fff", padding: "10px 12px", display: "flex", gap: 10, alignItems: isMobile ? "flex-start" : "center", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row" }}>
                  <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#26281f", overflowWrap: "anywhere" }}>{k.name}</div>
                    <div style={{ fontSize: 11, color: "#8b8578", marginTop: 2, overflowWrap: "anywhere" }}>
                      <code style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{k.keyPrefix}…</code>
                      {" · "}
                      {k.lastUsedAt ? `used ${relTime(k.lastUsedAt)} (${k.useCount})` : "never used"}
                      {showAll && k.ownerEmail ? ` · ${k.ownerEmail}` : ""}
                    </div>
                  </div>
                  <button onClick={() => revoke(k)} disabled={busy} style={{
                    background: "transparent", border: "1px solid #c0392b44", color: "#c0392b", borderRadius: 6,
                    padding: "6px 11px", fontSize: 11.5, fontWeight: 600, cursor: busy ? "default" : "pointer",
                    whiteSpace: "nowrap", fontFamily: "'Inter',sans-serif", minHeight: 34, alignSelf: isMobile ? "flex-start" : "auto",
                  }}>Turn off</button>
                </div>
              ))}
            </div>
          </div>

          {/* Revoked / expired */}
          {dead.length > 0 && (
            <div style={{ borderTop: "1px solid #ece5d7", paddingTop: 12 }}>
              <button onClick={() => setShowRevoked(s => !s)} style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#a69e91", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {showRevoked ? "▾" : "▸"} Switched off · {dead.length}
              </button>
              {showRevoked && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                  {dead.map(k => (
                    <div key={k.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11.5, color: "#8b8578", padding: "5px 2px", borderBottom: "1px solid #f4efe6", flexWrap: "wrap" }}>
                      <span style={{ color: "#52554e", fontWeight: 600, overflowWrap: "anywhere" }}>{k.name}</span>
                      <span><code style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{k.keyPrefix}…</code></span>
                      <span>{k.revokedAt ? `off ${relTime(k.revokedAt)}` : "expired"}</span>
                      <button onClick={() => remove(k)} style={{ marginLeft: "auto", background: "transparent", border: "1px solid #e3dccd", color: "#a69e91", borderRadius: 6, padding: "3px 8px", fontSize: 10.5, cursor: "pointer" }}>Delete</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* What Claude can see */}
          {info && (
            <div style={{ borderTop: "1px solid #ece5d7", marginTop: 16, paddingTop: 12 }}>
              {sectionTitle("What Claude can do with a key")}
              <div style={{ fontSize: 12, color: "#6f6a5f", lineHeight: 1.6 }}>
                Read-only access to {info.tools.length} tools: {info.tools.map(t => t.title).join(", ")}.
                It also reads your underwriting playbook and house view, so its answers follow
                KPR's rules rather than generic commercial-real-estate advice.
              </div>
              <div style={{ marginTop: 10 }}>
                <CopyBox value={info.url} label="Server address" />
              </div>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
