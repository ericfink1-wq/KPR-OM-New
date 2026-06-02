import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiListMembers, apiApproveMember, apiRejectMember, apiSetMemberAdmin, apiDeleteMember, apiLoginEvents, type MemberAccount, type LoginEvent } from "../lib/api";

// Admin-only screen to approve / decline account requests and manage members.
export default function Members({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<MemberAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [events, setEvents] = useState<LoginEvent[] | null>(null);
  const [showActivity, setShowActivity] = useState(false);

  const load = useCallback(() => {
    setError(null);
    apiListMembers().then(setRows).catch(() => setError("Couldn't load members"));
    apiLoginEvents().then(setEvents).catch(() => { /* non-fatal */ });
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try { await fn(); load(); }
    catch { setError("Action failed — try again."); }
    finally { setBusy(null); }
  };

  // Approve has its own handler so we can report whether the "you're approved"
  // email actually went out (Resend's test sender can only email the account
  // owner — so if it fails, the admin needs to tell the user manually).
  const approve = async (u: MemberAccount) => {
    setBusy(u.id); setNotice(null);
    try {
      const r = await apiApproveMember(u.id);
      load();
      setNotice(r.emailSent
        ? `Approved ${u.email} — they've been emailed that they can sign in.`
        : `Approved ${u.email}, but the notification email did NOT send — tell them to sign in with the password they created. (${r.emailDetail || "email not configured"})`);
    } catch { setError("Action failed — try again."); }
    finally { setBusy(null); }
  };

  const pending = (rows || []).filter(r => r.status === "pending");
  const others = (rows || []).filter(r => r.status !== "pending");

  const statusChip = (s: string) => {
    const m: Record<string, { bg: string; fg: string; label: string }> = {
      approved: { bg: "#eef7ee", fg: "#0f7a3d", label: "Approved" },
      pending: { bg: "#fff3df", fg: "#9a6a1e", label: "Pending" },
      rejected: { bg: "#fdeaea", fg: "#b3261e", label: "Declined" },
    };
    const c = m[s] || m.pending;
    return <span style={{ fontSize: 9.5, fontWeight: 700, color: c.fg, background: c.bg, borderRadius: 4, padding: "2px 7px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{c.label}</span>;
  };

  const btn = (label: string, onClick: () => void, color: string, disabled: boolean) => (
    <button onClick={onClick} disabled={disabled}
      style={{ background: "transparent", border: `1px solid ${color}44`, color, borderRadius: 6, padding: "4px 9px", fontSize: 11, fontWeight: 600, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap", fontFamily: "'Inter',sans-serif" }}>{label}</button>
  );

  const row = (u: MemberAccount) => (
    <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #ece5d7", borderRadius: 9, background: "#fff", flexWrap: "wrap" }}>
      <div style={{ minWidth: 0, flex: "1 1 200px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#26281f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {u.name || u.email}{u.isAdmin && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: "#5c5047", background: "#f1eadc", border: "1px solid #ddd4c2", borderRadius: 4, padding: "1px 5px" }}>ADMIN</span>}
        </div>
        {u.name && <div style={{ fontSize: 11, color: "#8b8578", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</div>}
      </div>
      {statusChip(u.status)}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
        {u.status === "pending" && btn("✓ Approve", () => approve(u), "#0f7a3d", busy === u.id)}
        {u.status === "pending" && btn("Decline", () => act(u.id, () => apiRejectMember(u.id)), "#b3261e", busy === u.id)}
        {u.status === "rejected" && btn("Approve", () => approve(u), "#0f7a3d", busy === u.id)}
        {u.status === "approved" && btn(u.isAdmin ? "Remove admin" : "Make admin", () => act(u.id, () => apiSetMemberAdmin(u.id, !u.isAdmin)), "#5c5047", busy === u.id)}
        {btn("Remove", () => { if (window.confirm(`Remove ${u.email}? They'll lose access and would have to request a new account.`)) act(u.id, () => apiDeleteMember(u.id)); }, "#c0392b", busy === u.id)}
      </div>
    </div>
  );

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9700, background: "rgba(38,40,31,0.42)", backdropFilter: "blur(2px)" }} />
      <div role="dialog" aria-label="Members" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 9701, width: "min(640px, 94vw)", maxHeight: "86vh", background: "#faf7f0", border: "1px solid #e0d8c8", borderRadius: 14, boxShadow: "0 18px 56px rgba(38,40,31,0.28)", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "'Inter',sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #ece5d7", background: "#fff", flexShrink: 0 }}>
          <span style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 600, color: "#26281f" }}>Members</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "1px solid #e3dccd", color: "#7d766a", width: 30, height: 30, borderRadius: 7, cursor: "pointer", fontSize: 15 }}>✕</button>
        </div>
        <div style={{ padding: "16px 18px", overflowY: "auto" }}>
          {error && <div style={{ color: "#c0392b", fontSize: 12.5, marginBottom: 12 }}>⚠ {error}</div>}
          {notice && <div style={{ color: notice.includes("did NOT send") ? "#92400e" : "#0f7a3d", background: notice.includes("did NOT send") ? "#fef6e7" : "#eef7ee", border: `1px solid ${notice.includes("did NOT send") ? "#f5c842" : "#cfe9c4"}`, borderRadius: 8, padding: "8px 11px", fontSize: 12.5, marginBottom: 12, lineHeight: 1.45 }}>{notice}</div>}
          {!rows && <div style={{ color: "#a69e91", fontSize: 13, padding: "20px 0", textAlign: "center" }}>Loading…</div>}

          {rows && pending.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9a6a1e", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Awaiting approval · {pending.length}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>{pending.map(row)}</div>
            </>
          )}

          {rows && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#a69e91", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Members · {others.length}</div>
              {others.length === 0
                ? <div style={{ color: "#a69e91", fontSize: 12.5 }}>No active members yet.</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{others.map(row)}</div>}
            </>
          )}

          {/* Recent sign-in activity */}
          {events && events.length > 0 && (
            <div style={{ marginTop: 18, borderTop: "1px solid #ece5d7", paddingTop: 12 }}>
              <button onClick={() => setShowActivity(s => !s)}
                style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#a69e91", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {showActivity ? "▾" : "▸"} Recent sign-in activity
              </button>
              {showActivity && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2, maxHeight: 240, overflowY: "auto" }}>
                  {events.map(ev => (
                    <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, padding: "4px 2px", borderBottom: "1px solid #f4efe6" }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: ev.success ? "#3f7a1f" : "#c0392b", flexShrink: 0 }} />
                      <span style={{ color: "#383a37", minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.email || "(unknown)"}</span>
                      <span style={{ color: ev.success ? "#6f6a5f" : "#c0392b", flexShrink: 0 }}>{ev.success ? "signed in" : "failed"}</span>
                      <span style={{ color: "#a89f8f", flexShrink: 0 }}>{new Date(ev.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 10.5, color: "#bcae97", marginTop: 14, lineHeight: 1.5 }}>
            New people request access from the sign-in screen and appear here as “Pending” until you approve them. Approved members can use the app; admins can also approve others and use admin features.
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
