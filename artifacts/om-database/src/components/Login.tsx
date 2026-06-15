import { useState, FormEvent } from "react";
import { apiLogin, apiRegister, apiForgotPassword, apiResendVerification, apiVerify2fa } from "../lib/api";

interface Props {
  onLogin: () => void;
  // When the page reloads mid-login (password done, 2FA code still owed), start on
  // the code step instead of the password form.
  startOn2fa?: boolean;
}

type Mode = "login" | "register" | "forgot" | "twofa";

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 14px",
  border: "1.5px solid #e7e0d2", borderRadius: 8, fontSize: 14,
  fontFamily: "'Inter', sans-serif", background: "#faf7f0", color: "#26281f", outline: "none",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
  color: "#a89f8f", textTransform: "uppercase", marginBottom: 6,
};

export default function Login({ onLogin, startOn2fa }: Props) {
  const [mode, setMode] = useState<Mode>(startOn2fa ? "twofa" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Show a "resend verification" prompt when sign-in is blocked on an unverified
  // email, or right after requesting an account.
  const [needsVerify, setNeedsVerify] = useState(false);

  const switchMode = (m: Mode) => { setMode(m); setError(null); setNotice(null); setPassword(""); setCode(""); setNeedsVerify(false); };

  const resendVerify = async () => {
    if (!email.trim()) return;
    await apiResendVerification(email.trim());
    setNeedsVerify(false);
    setNotice("Sent — check your inbox for a fresh verification link (it may take a minute).");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null); setNotice(null);

    if (mode === "login") {
      if (!email.trim() || !password) return;
      setLoading(true);
      const result = await apiLogin(email.trim(), password);
      setLoading(false);
      if (result.ok) onLogin();
      else if (result.twoFactorRequired) { setMode("twofa"); setCode(""); }
      else { setError(result.error || "Incorrect email or password"); setNeedsVerify(!!result.needsVerification); }
      return;
    }

    if (mode === "twofa") {
      const c = code.replace(/\s+/g, "");
      if (!c) return;
      setLoading(true);
      const result = await apiVerify2fa(c);
      setLoading(false);
      if (result.ok) onLogin();
      else setError(result.error || "Invalid code");
      return;
    }

    if (mode === "forgot") {
      if (!email.trim()) return;
      setLoading(true);
      await apiForgotPassword(email.trim());
      setLoading(false);
      setMode("login");
      setNotice("If an account exists for that email, we've sent a password-reset link. Check your inbox.");
      return;
    }

    // register
    if (!email.trim() || !password) return;
    if (password.length < 10) { setError("Password must be at least 10 characters."); return; }
    setLoading(true);
    const result = await apiRegister(name.trim(), email.trim(), password);
    setLoading(false);
    if (result.ok) {
      setMode("login");
      setPassword("");
      setNotice("Account requested! An administrator will review and confirm your access — you'll be able to sign in once you're approved.");
    } else {
      setError(result.error || "Could not create account");
    }
  };

  const canSubmit = mode === "login" ? !!email.trim() && !!password
    : mode === "forgot" ? !!email.trim()
    : mode === "twofa" ? !!code.trim()
    : !!email.trim() && password.length >= 10;

  const subtitle = mode === "login" ? "Sign in to your account"
    : mode === "register" ? "Request an account"
    : mode === "twofa" ? "Two-factor authentication"
    : "Reset your password";
  const submitLabel = loading
    ? (mode === "register" ? "Submitting…" : mode === "forgot" ? "Sending…" : mode === "twofa" ? "Verifying…" : "Signing in…")
    : (mode === "register" ? "Request access" : mode === "forgot" ? "Send reset link" : mode === "twofa" ? "Verify" : "Sign in");

  return (
    <div style={{ minHeight: "100vh", background: "#f1ece1", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif", padding: 16 }}>
      <div style={{ background: "#fff", border: "1px solid #e7e0d2", borderRadius: 14, padding: "40px 44px", width: "min(380px, 100%)", boxSizing: "border-box", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 400, color: "#26281f", letterSpacing: "-0.01em" }}>
            KPR <span style={{ fontWeight: 600 }}>OM</span> Database
          </div>
          <div style={{ fontSize: 12, color: "#a89f8f", marginTop: 4 }}>{subtitle}</div>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === "register" && (
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Your name" style={inputStyle} />
            </div>
          )}

          {mode !== "twofa" && (
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Email</label>
              <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} autoFocus={mode !== "register"} placeholder="you@company.com" style={inputStyle} />
            </div>
          )}

          {mode !== "forgot" && mode !== "twofa" && (
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Password</label>
              <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === "register" ? "At least 10 characters" : "Your password"} style={inputStyle} />
            </div>
          )}

          {mode === "twofa" && (
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Authentication code</label>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code}
                onChange={e => setCode(e.target.value)} placeholder="6-digit code"
                style={{ ...inputStyle, letterSpacing: "0.3em", fontSize: 18, textAlign: "center" }} />
              <div style={{ fontSize: 11.5, color: "#a89f8f", marginTop: 7, lineHeight: 1.45 }}>
                Enter the 6-digit code from your authenticator app. Lost your phone? Enter one of your backup codes instead.
              </div>
            </div>
          )}

          {notice && <div style={{ fontSize: 12.5, color: "#0f7a3d", background: "#eef7ee", border: "1px solid #cfe9c4", borderRadius: 8, padding: "9px 11px", marginBottom: 12, lineHeight: 1.4 }}>{notice}</div>}
          {error && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 12 }}>{error}</div>}
          {needsVerify && email.trim() && (
            <div style={{ marginBottom: 12, textAlign: "center" }}>
              <button type="button" onClick={resendVerify} style={{ background: "none", border: "none", color: "#3f7a1f", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: 0 }}>
                Resend verification email
              </button>
            </div>
          )}

          <button type="submit" disabled={loading || !canSubmit}
            style={{ width: "100%", padding: "10px 0", background: "#26281f", color: "#f1ece1", border: "none", borderRadius: 8, fontSize: 13, fontFamily: "'Inter', sans-serif", fontWeight: 600, cursor: loading ? "wait" : "pointer", opacity: (!canSubmit || loading) ? 0.5 : 1, letterSpacing: "0.02em" }}>
            {submitLabel}
          </button>
        </form>

        {mode === "login" && (
          <div style={{ marginTop: 12, textAlign: "center" }}>
            <button onClick={() => switchMode("forgot")} style={{ background: "none", border: "none", color: "#7d766a", cursor: "pointer", fontSize: 14, fontWeight: 500, padding: 0 }}>Forgot password?</button>
          </div>
        )}

        <div style={{ marginTop: 16, textAlign: "center", fontSize: 14, color: "#7d766a" }}>
          {mode === "login" && <>New here? <button onClick={() => switchMode("register")} style={{ background: "none", border: "none", color: "#3f7a1f", cursor: "pointer", fontSize: 14, fontWeight: 600, padding: 0 }}>Create an account</button></>}
          {mode === "register" && <>Already have an account? <button onClick={() => switchMode("login")} style={{ background: "none", border: "none", color: "#3f7a1f", cursor: "pointer", fontSize: 14, fontWeight: 600, padding: 0 }}>Sign in</button></>}
          {(mode === "forgot" || mode === "twofa") && <button onClick={() => switchMode("login")} style={{ background: "none", border: "none", color: "#3f7a1f", cursor: "pointer", fontSize: 14, fontWeight: 600, padding: 0 }}>← Back to sign in</button>}
        </div>
      </div>
    </div>
  );
}
