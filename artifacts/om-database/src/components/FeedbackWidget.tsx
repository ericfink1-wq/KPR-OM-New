import { useState } from "react";
import { apiSubmitFeedback } from "../lib/api";

interface Props {
  currentPage: string;
  liftAboveBar?: boolean;
}

type FeedbackType = "Bug" | "Idea" | "Other";
type Phase = "idle" | "open" | "submitting" | "done" | "error";

const TYPES: FeedbackType[] = ["Bug", "Idea", "Other"];

export default function FeedbackWidget({ currentPage, liftAboveBar }: Props) {
  const bottomOffset = liftAboveBar ? 110 : 24;
  const [phase, setPhase] = useState<Phase>("idle");
  const [type, setType] = useState<FeedbackType>("Idea");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");

  const open = () => {
    setPhase("open");
    setType("Idea");
    setMessage("");
    setName("");
  };

  const close = () => setPhase("idle");

  const submit = async () => {
    if (!message.trim()) return;
    setPhase("submitting");
    try {
      await apiSubmitFeedback({
        type: type.toLowerCase(),
        message: message.trim(),
        name: name.trim() || undefined,
        page: currentPage,
        userAgent: navigator.userAgent,
      });
      setPhase("done");
      setTimeout(() => setPhase("idle"), 2600);
    } catch {
      setPhase("error");
    }
  };

  return (
    <div style={{ position: "fixed", bottom: bottomOffset, left: 24, zIndex: 9500, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
      {(phase === "open" || phase === "submitting" || phase === "error") && (
        <div style={{
          background: "#fff",
          border: "1px solid #e6dfd0",
          borderRadius: 14,
          boxShadow: "0 8px 32px rgba(56,58,55,0.18)",
          width: 300,
          overflow: "hidden",
          fontFamily: "'Inter',sans-serif",
        }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px 10px", borderBottom: "1px solid #f1eadc" }}>
            <span style={{ fontFamily: "'Fraunces',serif", fontSize: 15, fontWeight: 500, color: "#26281f" }}>Send feedback</span>
            <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: "#b0a898", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
          </div>

          <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Type buttons */}
            <div style={{ display: "flex", gap: 6 }}>
              {TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  style={{
                    flex: 1,
                    padding: "5px 0",
                    borderRadius: 6,
                    border: type === t ? "1.5px solid #6dba43" : "1.5px solid #e6dfd0",
                    background: type === t ? "#f0f9ea" : "transparent",
                    color: type === t ? "#3f7a1f" : "#7d766a",
                    fontFamily: "'Inter',sans-serif",
                    fontSize: 12,
                    fontWeight: type === t ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Message */}
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Describe the issue or idea…"
              rows={4}
              style={{
                resize: "vertical",
                border: "1.5px solid #e6dfd0",
                borderRadius: 8,
                padding: "8px 10px",
                fontFamily: "'Inter',sans-serif",
                fontSize: 13,
                color: "#383a37",
                background: "#fdfaf5",
                outline: "none",
                width: "100%",
                boxSizing: "border-box",
              }}
            />

            {/* Name */}
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name (optional)"
              style={{
                border: "1.5px solid #e6dfd0",
                borderRadius: 8,
                padding: "7px 10px",
                fontFamily: "'Inter',sans-serif",
                fontSize: 13,
                color: "#383a37",
                background: "#fdfaf5",
                outline: "none",
                width: "100%",
                boxSizing: "border-box",
              }}
            />

            {phase === "error" && (
              <div style={{ fontSize: 12, color: "#c0392b", background: "#fdf0ee", borderRadius: 6, padding: "6px 10px" }}>
                Something went wrong — please try again.
              </div>
            )}

            <button
              onClick={submit}
              disabled={!message.trim() || phase === "submitting"}
              style={{
                background: !message.trim() || phase === "submitting" ? "#c8e4b4" : "#6dba43",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "8px 0",
                fontSize: 13,
                fontFamily: "'Inter',sans-serif",
                fontWeight: 600,
                cursor: !message.trim() || phase === "submitting" ? "default" : "pointer",
                width: "100%",
              }}
            >
              {phase === "submitting" ? "Sending…" : "Submit"}
            </button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div style={{
          background: "#fff",
          border: "1px solid #c8e4b4",
          borderRadius: 14,
          boxShadow: "0 8px 32px rgba(56,58,55,0.14)",
          padding: "14px 20px",
          fontFamily: "'Inter',sans-serif",
          fontSize: 13,
          color: "#3f7a1f",
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <span style={{ fontSize: 18 }}>✓</span> Thanks — got it!
        </div>
      )}

      {/* Trigger button */}
      <button
        onClick={phase === "idle" || phase === "done" ? open : close}
        title="Send feedback"
        aria-label="Send feedback"
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "#383a37",
          border: "none",
          boxShadow: "0 4px 16px rgba(56,58,55,0.28)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          transition: "background 0.15s",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "#52554e")}
        onMouseLeave={e => (e.currentTarget.style.background = "#383a37")}
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#f6f2ea" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
          <path d="M4 22v-7"/>
        </svg>
      </button>
    </div>
  );
}
