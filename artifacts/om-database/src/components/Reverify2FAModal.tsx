import { useState } from "react";
import { api2faReverify } from "../lib/api";

interface Props { email?: string | null; onVerified: () => void; }

// Periodic step-up prompt: the session is still valid, but the 2FA verification
// window has lapsed, so the user re-enters a code (no password) to continue.
export default function Reverify2FAModal({ email, onVerified }: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.replace(/\s+/g, "");
    if (!c || busy) return;
    setBusy(true); setError(null);
    const r = await api2faReverify(c);
    setBusy(false);
    if (r.ok) onVerified();
    else setError(r.error || "Invalid code");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f1ece1", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif", padding: 16 }}>
      <div style={{ background: "#fff", border: "1px solid #e7e0d2", borderRadius: 14, padding: "36px 40px", width: "min(380px, 100%)", boxSizing: "border-box", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: "#26281f" }}>Confirm it's you</div>
          <div style={{ fontSize: 12.5, color: "#a89f8f", marginTop: 6, lineHeight: 1.5 }}>
            For security, re-enter the 6-digit code from your authenticator app{email ? ` for ${email}` : ""}. (Or a backup code.)
          </div>
        </div>
        <form onSubmit={submit}>
          <input type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code}
            onChange={e => setCode(e.target.value)} placeholder="6-digit code"
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", border: "1.5px solid #e7e0d2", borderRadius: 8, fontSize: 18, letterSpacing: "0.3em", textAlign: "center", background: "#faf7f0", color: "#26281f", outline: "none", marginBottom: 12 }} />
          {error && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 10 }}>{error}</div>}
          <button type="submit" disabled={busy || !code.trim()}
            style={{ width: "100%", padding: "10px 0", background: "#26281f", color: "#f1ece1", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer", opacity: (busy || !code.trim()) ? 0.5 : 1, letterSpacing: "0.02em" }}>
            {busy ? "Verifying…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
