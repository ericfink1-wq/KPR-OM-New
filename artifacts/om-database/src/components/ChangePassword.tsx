import { useState, useEffect, FormEvent } from "react";
import { createPortal } from "react-dom";
import { apiChangePassword } from "../lib/api";

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "9px 12px", border: "1.5px solid #e7e0d2",
  borderRadius: 8, fontSize: 13.5, fontFamily: "'Inter',sans-serif", background: "#faf7f0", color: "#26281f", outline: "none",
};
const lbl: React.CSSProperties = { display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#a89f8f", textTransform: "uppercase", marginBottom: 6 };

export default function ChangePassword({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (next.length < 10) { setError("New password must be at least 10 characters."); return; }
    if (next !== confirm) { setError("New passwords don't match."); return; }
    setBusy(true);
    const r = await apiChangePassword(current, next);
    setBusy(false);
    if (r.ok) { setDone(true); setTimeout(onClose, 1400); }
    else setError(r.error || "Could not change password");
  };

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9700, background: "rgba(38,40,31,0.42)", backdropFilter: "blur(2px)" }} />
      <div role="dialog" aria-label="Change password" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 9701, width: "min(380px, 94vw)", background: "#faf7f0", border: "1px solid #e0d8c8", borderRadius: 14, boxShadow: "0 18px 56px rgba(38,40,31,0.28)", overflow: "hidden", fontFamily: "'Inter',sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #ece5d7", background: "#fff" }}>
          <span style={{ fontFamily: "'Fraunces',serif", fontSize: 17, fontWeight: 600, color: "#26281f" }}>Change password</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "1px solid #e3dccd", color: "#7d766a", width: 30, height: 30, borderRadius: 7, cursor: "pointer", fontSize: 15 }}>✕</button>
        </div>
        <form onSubmit={submit} style={{ padding: "16px 18px" }}>
          {done ? (
            <div style={{ fontSize: 13, color: "#0f7a3d", background: "#eef7ee", border: "1px solid #cfe9c4", borderRadius: 8, padding: "11px 13px" }}>✓ Password changed.</div>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Current password</label>
                <input type="password" autoComplete="current-password" autoFocus value={current} onChange={e => setCurrent(e.target.value)} style={inp} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>New password</label>
                <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} placeholder="At least 10 characters" style={inp} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>Confirm new password</label>
                <input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} style={inp} />
              </div>
              {error && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 12 }}>{error}</div>}
              <button type="submit" disabled={busy || !current || !next || !confirm}
                style={{ width: "100%", padding: "10px 0", background: "#26281f", color: "#f1ece1", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer", opacity: (busy || !current || !next || !confirm) ? 0.5 : 1 }}>
                {busy ? "Saving…" : "Update password"}
              </button>
            </>
          )}
        </form>
      </div>
    </>,
    document.body
  );
}
