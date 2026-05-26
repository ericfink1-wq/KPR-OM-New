import { useState, FormEvent } from "react";
import { apiLogin } from "../lib/api";

interface Props {
  onLogin: () => void;
}

export default function Login({ onLogin }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim() || loading) return;
    setLoading(true);
    setError(null);
    const result = await apiLogin(password);
    setLoading(false);
    if (result.ok) {
      onLogin();
    } else {
      setError(result.error || "Incorrect password");
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f1ece1",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{
        background: "#fff",
        border: "1px solid #e7e0d2",
        borderRadius: 14,
        padding: "44px 48px",
        width: 360,
        boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
      }}>
        <div style={{ marginBottom: 28, textAlign: "center" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 400, color: "#26281f", letterSpacing: "-0.01em" }}>
            KPR <span style={{ fontWeight: 600 }}>OM</span> Database
          </div>
          <div style={{ fontSize: 12, color: "#a89f8f", marginTop: 4 }}>Team access only</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "#a89f8f", textTransform: "uppercase", marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              placeholder="Enter team password"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 14px",
                border: "1.5px solid #e7e0d2",
                borderRadius: 8,
                fontSize: 14,
                fontFamily: "'Inter', sans-serif",
                background: "#faf7f0",
                color: "#26281f",
                outline: "none",
              }}
            />
          </div>

          {error && (
            <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 12 }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            style={{
              width: "100%",
              padding: "10px 0",
              background: "#26281f",
              color: "#f1ece1",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontFamily: "'Inter', sans-serif",
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
              opacity: (!password.trim() || loading) ? 0.5 : 1,
              letterSpacing: "0.02em",
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
