import { useState, FormEvent } from "react";
import { apiResetPassword } from "../lib/api";

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 14px", border: "1.5px solid #e7e0d2",
  borderRadius: 8, fontSize: 14, fontFamily: "'Inter', sans-serif", background: "#faf7f0", color: "#26281f", outline: "none",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "#a89f8f", textTransform: "uppercase", marginBottom: 6 };

// Shown when the app is opened from a password-reset email link
// (?reset=1&email=…&token=…). On success, sends the user to the sign-in screen.
export default function ResetPassword({ email, token, onDone }: { email: string; token: string; onDone: () => void }) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (next.length < 10) { setError("Password must be at least 10 characters."); return; }
    if (next !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    const r = await apiResetPassword(email, token, next);
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(r.error || "Could not reset password");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f1ece1", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif", padding: 16 }}>
      <div style={{ background: "#fff", border: "1px solid #e7e0d2", borderRadius: 14, padding: "40px 44px", width: "min(380px, 100%)", boxSizing: "border-box", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
        <div style={{ marginBottom: 22, textAlign: "center" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 400, color: "#26281f" }}>KPR <span style={{ fontWeight: 600 }}>OM</span> Database</div>
          <div style={{ fontSize: 12, color: "#a89f8f", marginTop: 4 }}>Choose a new password{email ? ` for ${email}` : ""}</div>
        </div>

        {done ? (
          <>
            <div style={{ fontSize: 13, color: "#0f7a3d", background: "#eef7ee", border: "1px solid #cfe9c4", borderRadius: 8, padding: "11px 13px", marginBottom: 16 }}>✓ Password updated. You can sign in now.</div>
            <button onClick={onDone} style={{ width: "100%", padding: "10px 0", background: "#26281f", color: "#f1ece1", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Go to sign in</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>New password</label>
              <input type="password" autoComplete="new-password" autoFocus value={next} onChange={e => setNext(e.target.value)} placeholder="At least 10 characters" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Confirm new password</label>
              <input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} style={inputStyle} />
            </div>
            {error && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 12 }}>{error}</div>}
            <button type="submit" disabled={busy || !next || !confirm}
              style={{ width: "100%", padding: "10px 0", background: "#26281f", color: "#f1ece1", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer", opacity: (busy || !next || !confirm) ? 0.5 : 1 }}>
              {busy ? "Saving…" : "Reset password"}
            </button>
            <div style={{ marginTop: 14, textAlign: "center" }}>
              <button type="button" onClick={onDone} style={{ background: "none", border: "none", color: "#a89f8f", cursor: "pointer", fontSize: 11.5, padding: 0 }}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
