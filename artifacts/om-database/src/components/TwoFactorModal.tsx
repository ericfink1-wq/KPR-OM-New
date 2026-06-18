import { useEffect, useState } from "react";
import { api2faStatus, api2faSetup, api2faEnable, api2faDisable } from "../lib/api";

interface Props {
  onClose: () => void;
  // Mandatory enrollment gate: no dismiss, copy says it's required, and the user is
  // dropped straight into setup. onClose is called once 2FA is on (re-checks auth).
  mandatory?: boolean;
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(28,30,25,0.45)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e7e0d2", borderRadius: 14, padding: "26px 28px", width: "min(420px, 100%)", boxSizing: "border-box", maxHeight: "90vh", overflowY: "auto", fontFamily: "'Inter', sans-serif" };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "10px 14px", border: "1.5px solid #e7e0d2", borderRadius: 8, fontSize: 14, background: "#faf7f0", color: "#26281f", outline: "none" };
const primaryBtn: React.CSSProperties = { width: "100%", padding: "10px 0", background: "#26281f", color: "#f1ece1", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: "0.02em" };

export default function TwoFactorModal({ onClose, mandatory }: Props) {
  // step: loading → off (offer setup) → setup (QR+code) → codes (show backup) → on (manage)
  const [step, setStep] = useState<"loading" | "off" | "setup" | "codes" | "on">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupRemaining, setBackupRemaining] = useState(0);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disablePw, setDisablePw] = useState("");

  useEffect(() => {
    api2faStatus().then(s => { setStep(s.enabled ? "on" : "off"); setBackupRemaining(s.backupCodesRemaining); });
  }, []);

  // Escape always closes the modal (except the mandatory enrollment gate), so a
  // mis-click on "Security" is never a trap — even on a short screen where the
  // card scrolls and the top-right × is pushed out of view.
  useEffect(() => {
    if (mandatory) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mandatory, onClose]);

  const startSetup = async () => {
    setBusy(true); setError(null);
    const r = await api2faSetup();
    setBusy(false);
    if (!r.ok) { setError(r.error || "Could not start setup"); return; }
    setQr(r.qrDataUrl || null); setSecret(r.secret || null); setCode(""); setStep("setup");
  };

  const confirmEnable = async () => {
    const c = code.replace(/\s+/g, "");
    if (!c) return;
    setBusy(true); setError(null);
    const r = await api2faEnable(c);
    setBusy(false);
    if (!r.ok) { setError(r.error || "That code didn't match"); return; }
    setBackupCodes(r.backupCodes || []); setStep("codes");
  };

  const disable = async () => {
    setBusy(true); setError(null);
    const c = code.replace(/\s+/g, "");
    const r = await api2faDisable(c ? { code: c } : { password: disablePw });
    setBusy(false);
    if (!r.ok) { setError(r.error || "Could not disable"); return; }
    setStep("off"); setCode(""); setDisablePw(""); setBackupRemaining(0);
  };

  return (
    <div style={overlay} onClick={mandatory ? undefined : onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 19, color: "#26281f" }}>Two-Factor Authentication</div>
          {!mandatory && <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#a89f8f", cursor: "pointer", lineHeight: 1 }}>×</button>}
        </div>

        {step === "loading" && <div style={{ fontSize: 13, color: "#a89f8f", padding: "16px 0" }}>Loading…</div>}

        {step === "off" && (
          <>
            <p style={{ fontSize: 13, color: "#5c5f57", lineHeight: 1.55, marginTop: 6 }}>
              {mandatory ? "Two-factor authentication is required for all accounts. " : ""}
              Add a second step at sign-in using an authenticator app (Google Authenticator, Authy, 1Password). After your password, you'll enter a rotating 6-digit code.
            </p>
            {error && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 10 }}>{error}</div>}
            <button onClick={startSetup} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy ? "Starting…" : "Set up two-factor"}</button>
          </>
        )}

        {step === "setup" && (
          <>
            <p style={{ fontSize: 13, color: "#5c5f57", lineHeight: 1.5, marginTop: 6 }}>1. Scan this QR code with your authenticator app (or enter the key manually).</p>
            {qr && <div style={{ textAlign: "center", margin: "10px 0" }}><img src={qr} alt="2FA QR code" style={{ width: 200, height: 200, border: "1px solid #efe8da", borderRadius: 8 }} /></div>}
            {secret && (
              <div style={{ fontSize: 11, color: "#7d766a", textAlign: "center", marginBottom: 14, wordBreak: "break-all" }}>
                Manual key: <span style={{ fontFamily: "monospace", color: "#383a37", letterSpacing: "0.05em" }}>{secret}</span>
              </div>
            )}
            <p style={{ fontSize: 13, color: "#5c5f57", lineHeight: 1.5 }}>2. Enter the current 6-digit code to confirm.</p>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} placeholder="6-digit code"
              style={{ ...input, letterSpacing: "0.3em", fontSize: 18, textAlign: "center", margin: "8px 0 12px" }} />
            {error && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 10 }}>{error}</div>}
            <button onClick={confirmEnable} disabled={busy || !code.trim()} style={{ ...primaryBtn, opacity: (busy || !code.trim()) ? 0.6 : 1 }}>{busy ? "Verifying…" : "Verify & enable"}</button>
          </>
        )}

        {step === "codes" && (
          <>
            <div style={{ fontSize: 13, color: "#0f7a3d", background: "#eef7ee", border: "1px solid #cfe9c4", borderRadius: 8, padding: "9px 11px", margin: "8px 0 12px", lineHeight: 1.45 }}>
              ✓ Two-factor is on. Save these backup codes somewhere safe — each works once if you lose your phone. They won't be shown again.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontFamily: "monospace", fontSize: 13, background: "#faf7f0", border: "1px solid #efe8da", borderRadius: 8, padding: 12, marginBottom: 14 }}>
              {backupCodes.map(c => <div key={c} style={{ color: "#383a37", letterSpacing: "0.04em" }}>{c}</div>)}
            </div>
            <button onClick={() => { navigator.clipboard?.writeText(backupCodes.join("\n")).catch(() => {}); }} style={{ ...primaryBtn, background: "transparent", color: "#3f7a1f", border: "1px solid #b8d49a", marginBottom: 8 }}>Copy codes</button>
            <button onClick={onClose} style={primaryBtn}>Done</button>
          </>
        )}

        {/* Mandatory gate but already enrolled: don't strand on the disable screen —
            confirm they're set and let them clear the gate (re-checks auth). */}
        {step === "on" && mandatory && (
          <>
            <div style={{ fontSize: 13, color: "#0f7a3d", background: "#eef7ee", border: "1px solid #cfe9c4", borderRadius: 8, padding: "9px 11px", margin: "8px 0 12px", lineHeight: 1.45 }}>
              ✓ Two-factor authentication is already <b>enabled</b> on your account — you're all set.
            </div>
            <button onClick={onClose} style={primaryBtn}>Continue</button>
          </>
        )}

        {step === "on" && !mandatory && (
          <>
            <div style={{ fontSize: 13, color: "#0f7a3d", background: "#eef7ee", border: "1px solid #cfe9c4", borderRadius: 8, padding: "9px 11px", margin: "8px 0 12px" }}>
              ✓ Two-factor authentication is <b>enabled</b>. {backupRemaining} backup code{backupRemaining === 1 ? "" : "s"} remaining.
            </div>
            <p style={{ fontSize: 12.5, color: "#7d766a", lineHeight: 1.5 }}>To turn it off, enter a current authenticator code or your account password.</p>
            <input type="text" inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} placeholder="Authenticator code" style={{ ...input, marginBottom: 8 }} />
            <input type="password" value={disablePw} onChange={e => setDisablePw(e.target.value)} placeholder="…or account password" style={{ ...input, marginBottom: 12 }} />
            {error && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 10 }}>{error}</div>}
            <button onClick={disable} disabled={busy || (!code.trim() && !disablePw)} style={{ ...primaryBtn, background: "#b91c1c", opacity: (busy || (!code.trim() && !disablePw)) ? 0.6 : 1 }}>{busy ? "Disabling…" : "Disable two-factor"}</button>
            {/* Always-visible exit so a mis-click on "Security" can be backed out of
                without hunting for the top-right × (which can scroll off a short screen). */}
            <button onClick={onClose} style={{ ...primaryBtn, background: "transparent", color: "#7d766a", border: "1px solid #e7e0d2", marginTop: 8 }}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}
