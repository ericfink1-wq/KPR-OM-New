import { useState, useEffect, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  apiMcpInfo, apiListMcpKeys, apiCreateMcpKey, apiRevokeMcpKey, apiDeleteMcpKey,
  type McpKeySummary, type McpInfo, type StaticKeyStatus } from "../lib/api";
import { useIsMobile } from "../hooks/use-mobile";
import { makeZip } from "../lib/zipStore";

// "Claude access": every member mints their own key and connects an outside Claude
// (claude.ai / desktop / phone, or Claude Code) to this library through /api/mcp.
//
// Built as a guided, numbered setup for non-technical teammates: create key → add to
// Claude (click-by-click, with the copy box sitting at the exact step that needs it) →
// add the KPR rules skill → test with a sample question. Key management is folded
// below so the setup is the first thing people see. Closing while a fresh key is on
// screen asks first, because the key is shown only once.

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

// The KPR rules skill, shipped in the bundle so each person can download it and
// upload it to their own Claude — the connector's own instructions only reach Claude
// when it calls this library, the skill makes the rules apply everywhere.
import skillMarkdown from "../../../../.claude/skills/kpr-retail-analysis/SKILL.md?raw";

const OLIVE = "#26281f";
const GREEN = "#0f7a3d";
const MUTED = "#6f6a5f";

const TEST_QUESTION = "Using the KPR deal library, what's the typical rent per SF for Dollar Tree, and how many leases is that based on?";

type Client = "app" | "code";

function StepNum({ n, done }: { n: number | string; done?: boolean }) {
  return (
    <span style={{
      flexShrink: 0, width: 24, height: 24, borderRadius: "50%",
      background: done ? GREEN : OLIVE, color: "#fff", fontSize: 12, fontWeight: 700,
      display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1,
    }}>{done ? "✓" : n}</span>
  );
}

/** One numbered click-by-click instruction, with optional copy box / extra content below. */
function Click({ n, children, extra }: { n: number; children: ReactNode; extra?: ReactNode }) {
  return (
    <li style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderTop: n === 1 ? "none" : "1px solid #efe9dc" }}>
      <span style={{
        flexShrink: 0, minWidth: 20, height: 20, borderRadius: 5, background: "#ece5d7", color: "#52554e",
        fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1,
      }}>{n}</span>
      <div style={{ flex: "1 1 auto", minWidth: 0, fontSize: 12.5, lineHeight: 1.55, color: "#3a3d33" }}>
        {children}
        {extra && <div style={{ marginTop: 8 }}>{extra}</div>}
      </div>
    </li>
  );
}

/** A big step card: number badge + title + body. */
function StepCard({ n, title, done, children, subtitle }: { n: number; title: string; done?: boolean; subtitle?: string; children?: ReactNode }) {
  return (
    <div style={{ border: `1px solid ${done ? "#cfe9c4" : "#e3dccd"}`, background: done ? "#f6fbf4" : "#fff", borderRadius: 11, padding: "12px 14px", marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <StepNum n={n} done={done} />
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: done ? GREEN : OLIVE }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2, lineHeight: 1.45 }}>{subtitle}</div>}
        </div>
      </div>
      {children && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

const B = ({ children }: { children: ReactNode }) => (
  <strong style={{ background: "#f4f1e8", border: "1px solid #e3dccd", borderRadius: 4, padding: "0 4px", whiteSpace: "nowrap", fontWeight: 700, color: OLIVE }}>{children}</strong>
);

function downloadSkill() {
  const blob = makeZip({ "kpr-retail-analysis/SKILL.md": skillMarkdown });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "kpr-retail-analysis.zip";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
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
  const [client, setClient] = useState<Client>("app");
  const [showHelp, setShowHelp] = useState(false);
  const [showManage, setShowManage] = useState(false);

  const load = useCallback(() => {
    setError(null);
    apiMcpInfo().then(setInfo).catch(() => setError("Couldn't load the connection details."));
    apiListMcpKeys(showAll).then(r => { setKeys(r.keys); setStaticKey(r.staticKey ?? null); }).catch(() => setError("Couldn't load the access keys."));
  }, [showAll]);
  useEffect(() => { load(); }, [load]);

  // Closing by accident would lose a key that is shown only once — so while one is on
  // screen, Escape / backdrop ask first.
  const tryClose = useCallback(() => {
    if (minted && !window.confirm("Close this window?\n\nYour key is only shown once. If you haven't finished adding it to Claude, you'll need to create a new one.")) return;
    onClose();
  }, [minted, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") tryClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tryClose]);

  const create = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await apiCreateMcpKey(newName.trim() || "My Claude");
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
  const urlWithKey = minted && info ? info.urlWithKeyTemplate.replace("<YOUR-KEY>", minted.key) : "";
  const url = info?.url ?? "";
  const codeCommand = minted
    ? `claude mcp add --transport http --scope user kpr-deal-library ${url} --header "Authorization: Bearer ${minted.key}"`
    : "";

  const sectionTitle = (t: string) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: "#a69e91", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{t}</div>
  );

  const clientBtn = (id: Client, title: string, sub: string) => (
    <button key={id} onClick={() => setClient(id)} style={{
      flex: "1 1 200px", textAlign: "left", cursor: "pointer", fontFamily: "'Inter',sans-serif",
      background: client === id ? "#f4f8f2" : "#fff",
      border: `2px solid ${client === id ? GREEN : "#e3dccd"}`, borderRadius: 9, padding: "9px 11px", minHeight: 52,
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: OLIVE }}>{client === id ? "● " : "○ "}{title}</div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 2, lineHeight: 1.4 }}>{sub}</div>
    </button>
  );

  const stepsApp = (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      <Click n={1} extra={<CopyBox value={urlWithKey} label="Your connector link" />}>
        Click <B>Copy</B> below to copy your personal connector link.
      </Click>
      <Click n={2}>
        In a new browser tab, open <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer" style={{ color: "#1d4ed8", fontWeight: 600 }}>claude.ai → Settings → Connectors</a> and sign in if asked.
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>
          Using the desktop app instead? Click your <B>name</B> in the bottom-left corner → <B>Settings</B> → <B>Connectors</B>. It's the same screen.
        </div>
      </Click>
      <Click n={3}>
        Scroll to the bottom of the list and click <B>Add custom connector</B>.
      </Click>
      <Click n={4} extra={<CopyBox value="KPR Deal Library" label="Name" />}>
        In the <B>Name</B> box type <strong>KPR Deal Library</strong>.
      </Click>
      <Click n={5}>
        Click in the <B>Remote MCP server URL</B> box and paste your link (<B>Ctrl+V</B> on Windows, <B>⌘+V</B> on Mac).
        Leave <B>Advanced settings</B> alone — nothing goes there.
      </Click>
      <Click n={6}>
        Click <B>Add</B>. "KPR Deal Library" now appears in your connectors list.
      </Click>
      <Click n={7}>
        Start a <B>New chat</B>. Click the <B>+</B> button (or the <B>sliders</B> icon) under the message box and make sure
        <strong> KPR Deal Library</strong> is switched <strong>on</strong>.
      </Click>
    </ol>
  );

  const stepsCode = (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      <Click n={1} extra={<CopyBox value={codeCommand} label="Command" />}>
        Click <B>Copy</B> below to copy the setup command.
      </Click>
      <Click n={2}>
        Open a terminal (<B>Terminal</B> on Mac, <B>PowerShell</B> on Windows), paste the command and press <B>Enter</B>.
        You only do this once — it works in every project.
      </Click>
      <Click n={3}>
        Type <B>claude</B> and press Enter, then type <B>/mcp</B>. You should see <strong>kpr-deal-library</strong> listed as <strong>connected</strong>.
      </Click>
    </ol>
  );

  return createPortal(
    <>
      <div onClick={tryClose} style={{ position: "fixed", inset: 0, zIndex: 9700, background: "rgba(38,40,31,0.42)", backdropFilter: "blur(2px)" }} />
      <div role="dialog" aria-label="Claude access" style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 9701,
        width: "min(700px, 96vw)", maxHeight: "90vh", background: "#faf7f0", border: "1px solid #e0d8c8",
        borderRadius: 14, boxShadow: "0 18px 56px rgba(38,40,31,0.28)", display: "flex", flexDirection: "column",
        overflow: "hidden", fontFamily: "'Inter',sans-serif",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 18px", borderBottom: "1px solid #ece5d7", background: "#fff", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 600, color: OLIVE }}>Connect Claude to the deal library</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>About 2 minutes · 4 steps · do it once per device</div>
          </div>
          <button onClick={tryClose} aria-label="Close" style={{ flexShrink: 0, background: "transparent", border: "1px solid #e3dccd", color: "#7d766a", width: 34, height: 34, borderRadius: 7, cursor: "pointer", fontSize: 15 }}>✕</button>
        </div>

        <div style={{ padding: isMobile ? "14px 12px" : "16px 18px", overflowY: "auto" }}>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, lineHeight: 1.55, color: "#52554e" }}>
            Once connected, you can ask Claude about any center, tenant, rent, lease term or comp in the library —
            right in your normal Claude chat, no exporting or pasting. Claude can only <strong>read</strong>; it can't change anything.
          </p>

          {error && <div style={{ color: "#c0392b", fontSize: 12.5, marginBottom: 12 }}>⚠ {error}</div>}

          {/* STEP 1 — create the key */}
          <StepCard n={1} done={!!minted} title={minted ? `Key created — "${minted.name}"` : "Create your personal key"}
            subtitle={minted
              ? "Shown only once. Keep this window open until you've finished step 2."
              : "Your key is like a password tied to your KPR login. Don't share it — colleagues make their own here."}>
            {!minted && (
              <div style={{ display: "flex", gap: 8, flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center" }}>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") void create(); }}
                  placeholder="Name it (optional) — e.g. “My laptop”"
                  aria-label="Key name"
                  style={{ flex: "1 1 auto", minWidth: 0, background: "#fff", border: "1px solid #e3dccd", borderRadius: 7, padding: "9px 11px", fontSize: 13, color: OLIVE, fontFamily: "'Inter',sans-serif", minHeight: 42 }}
                />
                <button onClick={create} disabled={busy} style={{
                  background: busy ? "#e3dccd" : GREEN, color: busy ? "#a89f8f" : "#fff", border: "none",
                  borderRadius: 7, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer",
                  fontFamily: "'Inter',sans-serif", minHeight: 42, whiteSpace: "nowrap",
                }}>{busy ? "Creating…" : "Create my key →"}</button>
              </div>
            )}
          </StepCard>

          {/* STEP 2 — add to Claude */}
          <StepCard n={2} title="Add it to Claude"
            subtitle={minted ? "Pick how you use Claude, then follow the clicks in order." : "Unlocks after step 1."}>
            {minted && (
              <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  {clientBtn("app", "Claude website, desktop or phone app", "Most people — claude.ai")}
                  {clientBtn("code", "Claude Code", "Only if you use Claude in a terminal")}
                </div>
                {client === "app" ? stepsApp : stepsCode}
                {client === "app" && (
                  <div style={{ marginTop: 8, fontSize: 11.5, color: MUTED, lineHeight: 1.5, background: "#f4f1e8", borderRadius: 7, padding: "8px 10px" }}>
                    Adding it once on claude.ai also turns it on in the desktop and phone apps — no need to repeat it there.
                    The link has your key built in, so only paste it into Claude's Connectors screen — never into a chat, email or shared doc.
                  </div>
                )}
              </>
            )}
          </StepCard>

          {/* STEP 3 — add the KPR rules skill */}
          <StepCard n={3} title="Add the KPR rules (recommended)"
            subtitle="Teaches Claude KPR's underwriting rules and how to use the library and Datex together — in every chat.">
            {client === "app" ? (
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                <Click n={1}>
                  <button onClick={downloadSkill} style={{ background: OLIVE, color: "#e8e0cf", border: "none", borderRadius: 7, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", minHeight: 38 }}>
                    ⬇ Download KPR rules
                  </button>
                  <span style={{ marginLeft: 8, fontSize: 11.5, color: MUTED }}>saves <code>kpr-retail-analysis.zip</code> — don't unzip it</span>
                </Click>
                <Click n={2}>
                  In Claude, go to <B>Settings</B> → <B>Capabilities</B> and make sure <B>Code execution and file creation</B> is switched on (skills need it).
                </Click>
                <Click n={3}>
                  On the same page, find <B>Skills</B> and click <B>Upload skill</B>. Pick the <code>kpr-retail-analysis.zip</code> file you just downloaded.
                </Click>
                <Click n={4}>
                  Make sure <strong>kpr-retail-analysis</strong> is switched <strong>on</strong> in the skills list.
                </Click>
              </ol>
            ) : (
              <div style={{ fontSize: 12.5, color: "#3a3d33", lineHeight: 1.55 }}>
                Already included if you work inside the KPR-OM-New project. Elsewhere,{" "}
                <button onClick={downloadSkill} style={{ background: "transparent", border: "none", padding: 0, color: "#1d4ed8", fontWeight: 600, cursor: "pointer", fontSize: 12.5, textDecoration: "underline" }}>download it</button>{" "}
                and unzip it into <code>~/.claude/skills/</code>.
              </div>
            )}
          </StepCard>

          {/* STEP 4 — test */}
          <StepCard n={4} title="Test it"
            subtitle="Ask Claude something only the library knows.">
            <CopyBox value={TEST_QUESTION} label="Paste this into a new chat" />
            <div style={{ marginTop: 8, fontSize: 12, color: "#3a3d33", lineHeight: 1.55 }}>
              <strong>It's working</strong> if Claude says it's using <em>KPR Deal Library</em> and answers with a rent and a lease count.
              The first time, Claude may ask permission to use the connector — click <B>Allow always</B>.
            </div>
          </StepCard>

          {/* Troubleshooting */}
          <div style={{ border: "1px solid #e3dccd", borderRadius: 10, background: "#fff", marginBottom: 12 }}>
            <button onClick={() => setShowHelp(v => !v)} style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "11px 14px", cursor: "pointer", fontSize: 13, fontWeight: 700, color: OLIVE, minHeight: 44 }}>
              {showHelp ? "▾" : "▸"} Something not working?
            </button>
            {showHelp && (
              <div style={{ padding: "0 14px 12px", fontSize: 12, color: "#3a3d33", lineHeight: 1.6 }}>
                {[
                  ["I don't see “Add custom connector”.", "Your Claude organization's owner controls custom connectors. Ask them to allow them (or add KPR Deal Library for the team), then try again."],
                  ["Claude says it can't find the deal library.", "Start a new chat and check the + / sliders menu under the message box — KPR Deal Library must be switched on for that chat."],
                  ["It connected before but now shows an error.", "The key was probably turned off, or it was copied incompletely. Create a new key here, then in Claude's Connectors screen remove the old KPR Deal Library and add it again with the new link."],
                  ["I closed this window before finishing.", "No problem — create a new key and start again. The unfinished one does nothing; you can turn it off below."],
                  ["Can I use one key on two computers?", "You can, but making one per device is safer: if a laptop is lost you turn off just that one."],
                ].map(([q, a]) => (
                  <div key={q} style={{ padding: "6px 0", borderTop: "1px solid #f1ece2" }}>
                    <div style={{ fontWeight: 700 }}>{q}</div>
                    <div style={{ color: MUTED }}>{a}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {minted && (
            <button onClick={() => setMinted(null)} style={{ width: "100%", marginBottom: 14, background: GREEN, border: "none", color: "#fff", borderRadius: 8, padding: "11px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 44 }}>
              ✓ I'm all set — hide my key
            </button>
          )}

          {/* Manage keys — collapsed by default so the setup steps are the first thing people see */}
          <div style={{ borderTop: "1px solid #ece5d7", paddingTop: 12 }}>
            <button onClick={() => setShowManage(v => !v)} style={{ background: "transparent", border: "none", padding: "4px 0", cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "#52554e", minHeight: 36 }}>
              {showManage ? "▾" : "▸"} Manage my keys{keys ? ` · ${active.length} active` : ""}
            </button>
          </div>

          {showManage && (<div style={{ marginTop: 10 }}>
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
                    {staticKey.fingerprint && (
                      <div style={{ marginTop: 6, color: "#5c6b57" }}>
                        Key in use: <code style={{ wordBreak: "break-all" }}>{staticKey.fingerprint}</code>
                        {staticKey.length != null && <> · {staticKey.length} characters</>}
                        {" — "}this must match the key in your Claude connector. If it doesn't, the secret
                        holds a different key (or lost characters when pasted).
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <strong>Backup key not active.</strong> {staticKey.reason}
                    {staticKey.fingerprint && (
                      <div style={{ marginTop: 6, color: "#7a6a4a" }}>
                        Key in use: <code style={{ wordBreak: "break-all" }}>{staticKey.fingerprint}</code>
                        {staticKey.length != null && <> · {staticKey.length} characters</>}
                      </div>
                    )}
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
                <CopyBox value={info.url} label="Server address (without key)" />
              </div>
            </div>
          )}
          </div>)}
        </div>
      </div>
    </>,
    document.body,
  );
}
