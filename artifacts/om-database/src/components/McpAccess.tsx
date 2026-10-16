import { useState, useEffect, useCallback, type ReactNode, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  apiMcpInfo, apiListMcpKeys, apiCreateMcpKey, apiRevokeMcpKey, apiDeleteMcpKey,
  type McpKeySummary, type McpInfo, type StaticKeyStatus } from "../lib/api";
import { useIsMobile } from "../hooks/use-mobile";
import { makeZip } from "../lib/zipStore";

// "Claude access": every member mints their own key and connects an outside Claude
// (claude.ai / desktop / phone, or Claude Code) to this library through /api/mcp.
//
// Built for teammates who are NOT tech-savvy: a one-step-at-a-time wizard with a big
// Next button, drawn copies of Claude's real screens with the thing to click ringed in
// orange (Settings → Customize → Connectors → "+ Add" → "Add custom connector" → Name /
// MCP server URL → Continue — taken from Eric's screenshots 10/16/26; re-check them if
// Claude's UI moves), Free-vs-paid branching, and a "Stuck?" list. The terminal (Claude
// Code) path and key management are small links so they never distract. Closing while a fresh key is on
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
const HILITE = "#e8590c";   // the "click here" ring on the mock screens

const TEST_QUESTION = "Using the KPR deal library, what's the typical rent per SF for Dollar Tree, and how many leases is that based on?";
const CONNECTOR_NAME = "KPR Deal Library";

type Plan = "free" | "paid";
type StepId = "plan" | "key" | "copy" | "open" | "add" | "fill" | "turnon" | "rules" | "test" | "code";

function downloadSkill() {
  const blob = makeZip({ "kpr-retail-analysis/SKILL.md": skillMarkdown });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "kpr-retail-analysis.zip";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function copyText(value: string) {
  try { await navigator.clipboard.writeText(value); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = value; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch { /* nothing more we can do */ }
    document.body.removeChild(ta);
  }
}

/** One big, obvious copy button — for people who'd miss a small one. */
function BigCopy({ value, label, onCopied }: { value: string; label: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async () => { await copyText(value); setCopied(true); onCopied?.(); setTimeout(() => setCopied(false), 2500); }}
      style={{
        width: "100%", minHeight: 52, borderRadius: 10, cursor: "pointer", fontFamily: "'Inter',sans-serif",
        background: copied ? "#eef7ee" : GREEN, color: copied ? GREEN : "#fff",
        border: `2px solid ${GREEN}`, fontSize: 15, fontWeight: 700,
      }}>{copied ? "✓ Copied! Now go to the next step" : `📋 ${label}`}</button>
  );
}

/** A word on screen the person must find — styled like a button label. */
const B = ({ children }: { children: ReactNode }) => (
  <strong style={{ background: "#fff3e8", border: `1px solid ${HILITE}66`, borderRadius: 4, padding: "0 5px", fontWeight: 700, color: OLIVE }}>{children}</strong>
);

// ---- Drawn copies of Claude's screens (from real screenshots, simplified). The point
// is "find the thing with the orange ring", not pixel accuracy.

function MockFrame({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <div style={{ margin: "10px 0 4px" }}>
      <div style={{ border: "1px solid #d9d4c8", borderRadius: 10, background: "#fbfbf9", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
        {children}
      </div>
      <div style={{ fontSize: 10.5, color: "#a69e91", marginTop: 4, textAlign: "center" }}>{caption ?? "What it looks like in Claude (may differ slightly)"}</div>
    </div>
  );
}

const ring = (on: boolean): CSSProperties => on
  ? { outline: `3px solid ${HILITE}`, outlineOffset: 2, borderRadius: 6, background: "#fff3e8", position: "relative" }
  : {};

function ClickHere() {
  return <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: HILITE, whiteSpace: "nowrap" }}>◀ click</span>;
}

function MockSidebar({ highlight }: { highlight: "Connectors" | "Skills" | "Capabilities" }) {
  const item = (label: string, icon: string) => (
    <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", fontSize: 12.5, color: "#222", ...ring(highlight === label) }}>
      <span style={{ width: 16, textAlign: "center", opacity: 0.6 }}>{icon}</span>{label}{highlight === label && <ClickHere />}
    </div>
  );
  const head = (t: string) => <div style={{ fontSize: 10.5, color: "#888", padding: "8px 8px 2px" }}>{t}</div>;
  return (
    <MockFrame>
      <div style={{ display: "flex" }}>
        <div style={{ width: 190, maxWidth: "60%", padding: "8px 8px 10px", borderRight: "1px solid #ebe8e0", background: "#f7f6f2" }}>
          {head("Settings")}
          {item("General", "⚙")}{item("Account", "◉")}{item("Billing", "▭")}{item("Capabilities", "▣")}
          {head("Customize")}
          {item("Skills", "▤")}{item("Connectors", "⊞")}{item("Plugins", "✧")}
        </div>
        <div style={{ flex: 1, padding: 12, color: "#bbb", fontSize: 11 }}>…</div>
      </div>
    </MockFrame>
  );
}

function MockAddMenu() {
  return (
    <MockFrame>
      <div style={{ padding: "12px 12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>Connectors</span>
          <span style={{ fontSize: 11, border: "1px solid #ddd", borderRadius: 6, padding: "2px 7px", color: "#444" }}>Yours</span>
          <span style={{ flex: 1 }} />
          <span style={{ background: "#111", color: "#fff", borderRadius: 7, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, ...ring(true), backgroundColor: "#111" }}>＋ Add ▾</span>
          <ClickHere />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <div style={{ border: "1px solid #ddd", borderRadius: 8, background: "#fff", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", padding: 4, minWidth: 190 }}>
            <div style={{ padding: "6px 9px", fontSize: 12.5, color: "#222", ...ring(true) }}>Add custom connector <span style={{ color: HILITE, fontWeight: 800, fontSize: 11 }}>◀ then this</span></div>
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

function MockDialog() {
  const field = (label: string, val: string, hint: string, n: string) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: HILITE, marginBottom: 3 }}>{n}</div>
      <div style={{ border: `2px solid ${HILITE}`, borderRadius: 7, padding: "7px 9px", fontSize: 12.5, color: "#111", background: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <span style={{ color: "#999", marginRight: 6 }}>{label}:</span>{val}
      </div>
      <div style={{ fontSize: 10.5, color: "#888", marginTop: 2 }}>{hint}</div>
    </div>
  );
  return (
    <MockFrame>
      <div style={{ padding: 14, background: "#fff" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 10 }}>Add custom connector</div>
        {field("Name", CONNECTOR_NAME, "Shown in the connectors list.", "① Type the name here")}
        {field("MCP server URL", "https://kpr-oms.replit.app/api/mcp/k/kpr_…", "The HTTPS address where the server accepts MCP requests…", "② Paste your link here")}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
          <span style={{ border: "1px solid #ddd", borderRadius: 7, padding: "5px 11px", fontSize: 12 }}>Cancel</span>
          <span style={{ background: "#111", color: "#fff", borderRadius: 7, padding: "5px 11px", fontSize: 12, fontWeight: 600, ...ring(true), backgroundColor: "#111" }}>Continue</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: HILITE }}>③</span>
        </div>
      </div>
    </MockFrame>
  );
}

function MockChat() {
  return (
    <MockFrame>
      <div style={{ padding: 12, background: "#fff" }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: "10px 10px 8px" }}>
          <div style={{ fontSize: 12.5, color: "#aaa", marginBottom: 10 }}>How can I help you today?</div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ width: 26, height: 26, border: "1px solid #ddd", borderRadius: 7, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15, ...ring(true) }}>＋</span>
            <ClickHere />
          </div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, marginTop: 6, padding: 4, maxWidth: 260, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
          <div style={{ padding: "5px 8px", fontSize: 12, color: "#444" }}>Connectors ›</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 8px", fontSize: 12.5, ...ring(true) }}>
            {CONNECTOR_NAME}
            <span style={{ width: 30, height: 17, borderRadius: 9, background: "#2f7de1", position: "relative", display: "inline-block" }}>
              <span style={{ position: "absolute", right: 2, top: 2, width: 13, height: 13, borderRadius: "50%", background: "#fff" }} />
            </span>
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  const warn = tone === "warn";
  return (
    <div style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.55, color: warn ? "#7a4a10" : "#4a5a44", background: warn ? "#fdf4e7" : "#f4f8f2", border: `1px solid ${warn ? "#f0d9b5" : "#cfe0cb"}`, borderRadius: 8, padding: "9px 11px" }}>
      {children}
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
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<{ key: string; name: string } | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [unsurePlan, setUnsurePlan] = useState(false);
  const [codePath, setCodePath] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [done, setDone] = useState(false);

  const steps: StepId[] = codePath
    ? ["key", "code", "test"]
    : ["plan", "key", "copy", "open", "add", "fill", "turnon", "rules", "test"];
  const step = steps[Math.min(stepIdx, steps.length - 1)];

  const load = useCallback(() => {
    setError(null);
    apiMcpInfo().then(setInfo).catch(() => setError("Couldn't load the connection details."));
    apiListMcpKeys(showAll).then(r => { setKeys(r.keys); setStaticKey(r.staticKey ?? null); }).catch(() => setError("Couldn't load the access keys."));
  }, [showAll]);
  useEffect(() => { load(); }, [load]);

  // Closing by accident would lose a key that is shown only once — so while one is on
  // screen, Escape / backdrop / ✕ ask first.
  const tryClose = useCallback(() => {
    if (minted && !done && !window.confirm("Close this window?\n\nYou haven't finished. Your link is only shown once — if you close now, you'll need to start again with a new key (that's fine, just takes a minute).")) return;
    onClose();
  }, [minted, done, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") tryClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tryClose]);

  const create = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await apiCreateMcpKey(codePath ? "Claude Code" : "My Claude");
      setMinted({ key: r.key, name: r.summary.name });
      load();
      setStepIdx(i => i + 1);
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

  const P = ({ children }: { children: ReactNode }) => (
    <p style={{ margin: "0 0 8px", fontSize: 14, lineHeight: 1.6, color: "#2f3229" }}>{children}</p>
  );
  const H = ({ children }: { children: ReactNode }) => (
    <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: 700, color: OLIVE, marginBottom: 10, fontFamily: "'Fraunces',serif" }}>{children}</div>
  );

  const planBtn = (id: Plan, title: string, sub: string) => (
    <button key={id} onClick={() => { setPlan(id); setUnsurePlan(false); }} style={{
      flex: "1 1 200px", textAlign: "left", cursor: "pointer", fontFamily: "'Inter',sans-serif",
      background: plan === id ? "#f4f8f2" : "#fff", border: `2px solid ${plan === id ? GREEN : "#e3dccd"}`,
      borderRadius: 10, padding: "12px 14px", minHeight: 64,
    }}>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: OLIVE }}>{plan === id ? "● " : "○ "}{title}</div>
      <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>{sub}</div>
    </button>
  );

  // Can the person move on from this step?
  const canNext = step === "plan" ? plan !== null : step === "key" ? !!minted : true;

  const body = (() => {
    switch (step) {
      case "plan": return (<>
        <H>First: which Claude do you have?</H>
        <P>Do this on a <strong>computer</strong>, not your phone. Once it's set up, it works on your phone too.</P>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "6px 0 8px" }}>
          {planBtn("paid", "Paid — Pro or Max", "You pay for Claude each month")}
          {planBtn("free", "Free", "You don't pay for Claude")}
        </div>
        <button onClick={() => setUnsurePlan(v => !v)} style={{ background: "transparent", border: "none", color: "#1d4ed8", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "6px 0", minHeight: 36 }}>
          I'm not sure — how do I check?
        </button>
        {unsurePlan && (
          <Note>
            In Claude, click your <B>name</B> in the bottom-left corner → <B>Settings</B> → <B>Billing</B>.
            It will say <strong>Free</strong>, <strong>Pro</strong> or <strong>Max</strong>. Come back and pick that above.
          </Note>
        )}
        {plan === "free" && (
          <Note tone="warn">
            <strong>Free works, with limits.</strong> Free accounts can only add a small number of custom
            connectors (currently one) — if you already added one for something else, Claude may say you've hit the limit.
            Free accounts also run out of messages faster, and library questions use a lot. If you'll use this regularly,
            the Pro plan is worth it.
          </Note>
        )}
      </>);

      case "key": return (<>
        <H>Create your personal key</H>
        <P>This makes a private link that lets <strong>your</strong> Claude read the deal library. It's tied to your KPR login.</P>
        <P>Don't share it with anyone — colleagues make their own here.</P>
        <button onClick={create} disabled={busy || !!minted} style={{
          width: "100%", minHeight: 54, marginTop: 6, borderRadius: 10, border: "none", fontFamily: "'Inter',sans-serif",
          background: minted ? "#eef7ee" : busy ? "#e3dccd" : GREEN, color: minted ? GREEN : busy ? "#a89f8f" : "#fff",
          fontSize: 15.5, fontWeight: 700, cursor: busy || minted ? "default" : "pointer",
        }}>{minted ? "✓ Key created" : busy ? "Creating…" : "Create my key"}</button>
      </>);

      case "copy": return (<>
        <H>Copy your link</H>
        <P>Click the green button. That copies your private link, so you can paste it into Claude in a moment.</P>
        <BigCopy value={urlWithKey} label="Copy my link" />
        <Note tone="warn">
          Keep <strong>this</strong> window open until you're finished. You'll go back and forth between this tab and Claude.
        </Note>
        <details style={{ marginTop: 10, fontSize: 12, color: MUTED }}>
          <summary style={{ cursor: "pointer", padding: "4px 0" }}>Show the link</summary>
          <div style={{ marginTop: 6 }}><CopyBox value={urlWithKey} /></div>
        </details>
      </>);

      case "open": return (<>
        <H>Open Claude's Connectors page</H>
        <P>Click the button below. Claude opens in a <strong>new tab</strong> (sign in if it asks).</P>
        <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer" style={{
          display: "flex", alignItems: "center", justifyContent: "center", minHeight: 52, borderRadius: 10,
          background: OLIVE, color: "#fff", fontSize: 15, fontWeight: 700, textDecoration: "none",
        }}>Open Claude Connectors ↗</a>
        <P><span style={{ display: "block", marginTop: 10 }}>You should land on <B>Connectors</B>. If not, click your name bottom-left → <B>Settings</B>, then <B>Connectors</B> on the left, under "Customize":</span></P>
        <MockSidebar highlight="Connectors" />
        <P><span style={{ display: "block", marginTop: 8 }}>Then come back to <strong>this tab</strong> (at the top of your browser) and click <strong>Next</strong>.</span></P>
      </>);

      case "add": return (<>
        <H>Click "+ Add", then "Add custom connector"</H>
        <P>In Claude, on the Connectors page, click the black <B>＋ Add</B> button in the <strong>top-right</strong> corner.
          A small menu drops down — click <B>Add custom connector</B>.</P>
        <MockAddMenu />
        <P><span style={{ display: "block", marginTop: 8 }}>A box called <strong>"Add custom connector"</strong> pops up. Leave it open and click <strong>Next</strong> here.</span></P>
      </>);

      case "fill": return (<>
        <H>Fill in the box and click Continue</H>
        <ol style={{ margin: "0 0 6px", paddingLeft: 20, fontSize: 14, lineHeight: 1.7, color: "#2f3229" }}>
          <li>Click in the <B>Name</B> box and type: <strong>{CONNECTOR_NAME}</strong></li>
          <li>Click in the <B>MCP server URL</B> box and <strong>paste</strong> your link
            ({/Mac|iPhone|iPad/.test(navigator.userAgent) ? <><B>⌘ Command</B> + <B>V</B></> : <><B>Ctrl</B> + <B>V</B></>}).</li>
          <li>Click <B>Continue</B>.</li>
        </ol>
        <MockDialog />
        <Note>
          Pasted nothing, or the wrong thing? Click here to copy your link again, then paste:
          <div style={{ marginTop: 8 }}><BigCopy value={urlWithKey} label="Copy my link again" /></div>
        </Note>
        <P><span style={{ display: "block", marginTop: 10 }}>If Claude shows another screen, click <B>Add</B> or <B>Connect</B>. When <strong>{CONNECTOR_NAME}</strong> appears in your list with a ✓, you're connected.</span></P>
      </>);

      case "turnon": return (<>
        <H>Turn it on in a chat</H>
        <P>In Claude, start a <B>New chat</B>. Click the <B>＋</B> button at the bottom-left of the message box,
          and make sure <strong>{CONNECTOR_NAME}</strong> is switched <strong>on</strong> (blue).</P>
        <MockChat />
        <P><span style={{ display: "block", marginTop: 8 }}>It usually stays on for future chats.</span></P>
      </>);

      case "rules": return (<>
        <H>Add the KPR rules {plan === "free" ? "(optional)" : "(recommended)"}</H>
        <P>This teaches Claude how KPR underwrites, so its answers follow our rules — not generic real-estate advice.</P>
        {plan === "free" && (
          <Note tone="warn">On a Free plan you may not have <strong>Skills</strong>. If you don't see it in step 3 below, just click <strong>Next</strong> — the library still works without it.</Note>
        )}
        <ol style={{ margin: "10px 0 6px", paddingLeft: 20, fontSize: 14, lineHeight: 1.75, color: "#2f3229" }}>
          <li>
            <button onClick={downloadSkill} style={{ background: OLIVE, color: "#fff", border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 42 }}>
              ⬇ Download KPR rules
            </button>
            <div style={{ fontSize: 12.5, color: MUTED }}>It saves a file called <strong>kpr-retail-analysis.zip</strong> to your Downloads.</div>
          </li>
          <li>In Claude: <B>Settings</B> → <B>Capabilities</B> → make sure <B>Code execution and file creation</B> is <strong>on</strong>.</li>
          <li>Click <B>Skills</B> on the left (under "Customize") → <B>＋ Add</B> (or <B>Upload skill</B>) → choose the <strong>kpr-retail-analysis.zip</strong> file from Downloads.</li>
          <li>Make sure <strong>kpr-retail-analysis</strong> is switched <strong>on</strong>.</li>
        </ol>
        <MockSidebar highlight="Skills" />
        <Note tone="warn">
          <strong>On a Mac using Safari?</strong> Safari sometimes unzips the file by itself, so you get a <em>folder</em> instead of a .zip and the upload won't take it.
          If that happens, open Downloads, right-click the <strong>kpr-retail-analysis</strong> folder → <strong>Compress</strong>, and upload the new .zip.
        </Note>
      </>);

      case "code": return (<>
        <H>Add it to Claude Code</H>
        <P>Copy this command, paste it into your terminal and press Enter. You only do this once.</P>
        <CopyBox value={codeCommand} />
        <P><span style={{ display: "block", marginTop: 10 }}>Then run <B>claude</B> and type <B>/mcp</B> — <strong>kpr-deal-library</strong> should show as connected.
          For the KPR rules, <button onClick={downloadSkill} style={{ background: "transparent", border: "none", padding: 0, color: "#1d4ed8", fontWeight: 600, cursor: "pointer", fontSize: 14, textDecoration: "underline" }}>download them</button> and unzip into <code>~/.claude/skills/</code> (already included inside the KPR-OM-New project).</span></P>
      </>);

      case "test": return (<>
        <H>Last step: test it</H>
        <P>Copy this question, paste it into a <strong>new chat</strong> in Claude, and send it.</P>
        <BigCopy value={TEST_QUESTION} label="Copy the test question" />
        <Note>
          <strong>It's working</strong> if Claude mentions <em>{CONNECTOR_NAME}</em> and answers with a rent per SF and a number of leases.
          The first time, Claude may ask permission to use it — click <B>Allow always</B>.
        </Note>
        <Note tone="warn">
          <strong>Claude says it can't access the library?</strong> Go back to the "Turn it on" step and check the switch is on, then try a brand-new chat.
        </Note>
      </>);
    }
  })();

  const isLast = stepIdx >= steps.length - 1;

  return createPortal(
    <>
      <div onClick={tryClose} style={{ position: "fixed", inset: 0, zIndex: 9700, background: "rgba(38,40,31,0.42)", backdropFilter: "blur(2px)" }} />
      <div role="dialog" aria-label="Claude access" style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 9701,
        width: "min(640px, 96vw)", maxHeight: "92vh", background: "#faf7f0", border: "1px solid #e0d8c8",
        borderRadius: 14, boxShadow: "0 18px 56px rgba(38,40,31,0.28)", display: "flex", flexDirection: "column",
        overflow: "hidden", fontFamily: "'Inter',sans-serif",
      }}>
        {/* Header + progress */}
        <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid #ece5d7", background: "#fff", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: MUTED }}>
              Connect Claude to the deal library{!done && <> · <span style={{ color: OLIVE }}>Step {stepIdx + 1} of {steps.length}</span></>}
            </div>
            <button onClick={tryClose} aria-label="Close" style={{ flexShrink: 0, background: "transparent", border: "1px solid #e3dccd", color: "#7d766a", width: 36, height: 36, borderRadius: 8, cursor: "pointer", fontSize: 15 }}>✕</button>
          </div>
          {!done && (
            <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
              {steps.map((s, i) => (
                <div key={s} style={{ flex: 1, height: 5, borderRadius: 3, background: i < stepIdx ? GREEN : i === stepIdx ? "#7fb37f" : "#e8e2d4" }} />
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: isMobile ? "16px 14px" : "20px 22px", overflowY: "auto", flex: "1 1 auto" }}>
          {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>}

          {done ? (
            <div style={{ textAlign: "center", padding: "10px 0 6px" }}>
              <div style={{ fontSize: 40 }}>🎉</div>
              <H>You're all set</H>
              <P>Just ask Claude about any center, tenant, rent, lease or comp — in any chat, on your computer or phone.</P>
              <P>Claude can only <strong>read</strong> the library. It can't change anything.</P>
              <button onClick={onClose} style={{ marginTop: 6, minHeight: 48, padding: "0 28px", borderRadius: 10, border: "none", background: GREEN, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Close</button>
            </div>
          ) : body}

          {/* Help — always one tap away */}
          {!done && (
            <div style={{ marginTop: 18, border: "1px solid #e3dccd", borderRadius: 10, background: "#fff" }}>
              <button onClick={() => setShowHelp(v => !v)} style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "11px 14px", cursor: "pointer", fontSize: 13.5, fontWeight: 700, color: OLIVE, minHeight: 44 }}>
                {showHelp ? "▾" : "▸"} Stuck? Common problems
              </button>
              {showHelp && (
                <div style={{ padding: "0 14px 12px", fontSize: 13, color: "#3a3d33", lineHeight: 1.6 }}>
                  {[
                    ["I can't find “+ Add” or “Add custom connector”.", "Make sure you're on claude.ai on a computer (not the phone app), on Settings → Connectors. The ＋ Add button is black, in the top-right corner."],
                    ["Claude says I've reached the limit for custom connectors.", "Free accounts allow only a small number. Remove a custom connector you don't use (click it in the list → remove), or upgrade to Pro."],
                    ["The Continue button stays grey.", "Both boxes need something in them. Type the name, then paste the link into the second box."],
                    ["It connected before, but now shows an error.", "Start this window again from the top to make a new key. Then in Claude's Connectors list, remove the old KPR Deal Library and add it again with the new link."],
                    ["I closed this window before I finished.", "No problem — open Claude access again and start over. It just makes a fresh key."],
                    ["Still stuck?", "Ask Eric — send him a screenshot of what you're seeing."],
                  ].map(([q, a]) => (
                    <div key={q} style={{ padding: "7px 0", borderTop: "1px solid #f1ece2" }}>
                      <div style={{ fontWeight: 700 }}>{q}</div>
                      <div style={{ color: MUTED }}>{a}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Small, out-of-the-way links: the terminal path and key management */}
          <div style={{ marginTop: 14, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
            {!done && step === "plan" && !codePath && (
              <button onClick={() => { setCodePath(true); setStepIdx(0); }} style={{ background: "transparent", border: "none", padding: "6px 0", color: "#8b8578", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}>
                I use Claude Code in a terminal (advanced)
              </button>
            )}
            {codePath && !minted && (
              <button onClick={() => { setCodePath(false); setStepIdx(0); }} style={{ background: "transparent", border: "none", padding: "6px 0", color: "#8b8578", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}>
                ← Back to the normal setup
              </button>
            )}
            <button onClick={() => setShowManage(v => !v)} style={{ background: "transparent", border: "none", padding: "6px 0", color: "#8b8578", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}>
              {showManage ? "Hide my keys" : `Manage my keys${keys ? ` (${active.length} active)` : ""}`}
            </button>
          </div>

          {showManage && (<div style={{ marginTop: 12, borderTop: "1px solid #ece5d7", paddingTop: 12 }}>
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

        {/* Back / Next — big, always in the same place */}
        {!done && (
          <div style={{ display: "flex", gap: 10, padding: "12px 16px", borderTop: "1px solid #ece5d7", background: "#fff", flexShrink: 0 }}>
            <button onClick={() => setStepIdx(i => Math.max(0, i - 1))} disabled={stepIdx === 0} style={{
              minHeight: 50, padding: "0 18px", borderRadius: 10, border: "1px solid #ddd4c2", background: "#fff",
              color: stepIdx === 0 ? "#cfc7b8" : "#52554e", fontSize: 14.5, fontWeight: 600, cursor: stepIdx === 0 ? "default" : "pointer",
            }}>← Back</button>
            <button onClick={() => { if (!canNext) return; if (isLast) setDone(true); else setStepIdx(i => i + 1); }} disabled={!canNext} style={{
              flex: 1, minHeight: 50, borderRadius: 10, border: "none", fontSize: 15.5, fontWeight: 700,
              background: canNext ? GREEN : "#e3dccd", color: canNext ? "#fff" : "#a89f8f", cursor: canNext ? "pointer" : "default",
            }}>{isLast ? "✓ It works — finish" : step === "key" && !minted ? "Create your key first" : step === "plan" && !plan ? "Pick one above" : "Next →"}</button>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
