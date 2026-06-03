import { useState, useEffect, useRef } from "react";
import { apiVerifyEmail, apiResendVerification } from "../lib/api";

// Shown when the app is opened from an email-verification link
// (?verify=1&email=…&token=…). Verifies automatically on mount, then routes the
// user to the sign-in screen.
export default function VerifyEmail({ email, token, onDone }: { email: string; token: string; onDone: () => void }) {
  const [state, setState] = useState<"verifying" | "ok" | "error">("verifying");
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;       // guard React 18 double-invoke
    ran.current = true;
    apiVerifyEmail(email, token).then(r => {
      if (r.ok) setState("ok");
      else { setState("error"); setError(r.error || "Verification failed."); }
    });
  }, [email, token]);

  const resend = async () => { await apiResendVerification(email); setResent(true); };

  return (
    <div style={{ minHeight: "100vh", background: "#f1ece1", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif", padding: 16 }}>
      <div style={{ background: "#fff", border: "1px solid #e7e0d2", borderRadius: 14, padding: "40px 44px", width: "min(400px, 100%)", boxSizing: "border-box", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
        <div style={{ marginBottom: 22, textAlign: "center" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 400, color: "#26281f" }}>KPR <span style={{ fontWeight: 600 }}>OM</span> Database</div>
          <div style={{ fontSize: 12, color: "#a89f8f", marginTop: 4 }}>Email verification{email ? ` · ${email}` : ""}</div>
        </div>

        {state === "verifying" && (
          <div style={{ fontSize: 13, color: "#6f6a5f", textAlign: "center", padding: "10px 0" }}>Verifying your email…</div>
        )}

        {state === "ok" && (
          <>
            <div style={{ fontSize: 13, color: "#0f7a3d", background: "#eef7ee", border: "1px solid #cfe9c4", borderRadius: 8, padding: "11px 13px", marginBottom: 16 }}>
              ✓ Email verified. An administrator will review and approve your access — you'll get an email when you're cleared to sign in.
            </div>
            <button onClick={onDone} style={{ width: "100%", padding: "10px 0", background: "#26281f", color: "#f1ece1", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Go to sign in</button>
          </>
        )}

        {state === "error" && (
          <>
            <div style={{ fontSize: 13, color: "#dc2626", background: "#fdecea", border: "1px solid #f3c9c2", borderRadius: 8, padding: "11px 13px", marginBottom: 16 }}>{error}</div>
            {resent
              ? <div style={{ fontSize: 12.5, color: "#0f7a3d", marginBottom: 14 }}>✓ If that email is registered and unverified, a fresh link is on its way.</div>
              : <button onClick={resend} style={{ width: "100%", padding: "10px 0", background: "#3f7a1f", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 12 }}>Send a new verification link</button>}
            <button onClick={onDone} style={{ width: "100%", padding: "10px 0", background: "transparent", color: "#a89f8f", border: "none", fontSize: 12, cursor: "pointer" }}>Back to sign in</button>
          </>
        )}
      </div>
    </div>
  );
}
