import { useState, useRef, useEffect } from "react";
import { SUGGESTED } from "../lib/constants";

interface Props {
  onAsk: (q: string) => void;
}

export default function AnalystBar({ onAsk }: Props) {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSuggestions) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSuggestions]);

  const send = () => {
    const q = input.trim();
    if (!q) return;
    setShowSuggestions(false);
    onAsk(q);
    setInput("");
  };

  return (
    <div style={{
      borderTop: "1px solid #e7e0d2",
      background: "rgba(250,247,240,0.95)",
      backdropFilter: "blur(12px)",
      flexShrink: 0,
    }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "14px 28px" }}>
        <div ref={wrapRef} style={{ display: "flex", gap: 10, position: "relative" }}>
          {showSuggestions && (
            <div style={{
              position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 54,
              background: "#fff", border: "1px solid #e3dccd", borderRadius: 12,
              boxShadow: "0 4px 20px rgba(56,58,55,0.13)", overflow: "hidden", zIndex: 200,
            }}>
              {SUGGESTED.slice(0, 5).map((s, i) => (
                <button key={s}
                  onMouseDown={e => { e.preventDefault(); setInput(s); setShowSuggestions(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left", background: "transparent",
                    border: "none", borderBottom: i < 4 ? "1px solid #f1eadc" : "none",
                    padding: "10px 14px", fontSize: 13, color: "#5c5f57", cursor: "pointer",
                    fontFamily: "'Inter',sans-serif", lineHeight: 1.4,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#faf7f0")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >{s}</button>
              ))}
            </div>
          )}
          <textarea
            value={input}
            onChange={e => { setInput(e.target.value); if (e.target.value) setShowSuggestions(false); }}
            onFocus={() => { if (!input.trim()) setShowSuggestions(true); }}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              if (e.key === "Escape") setShowSuggestions(false);
            }}
            placeholder="Ask anything about your deal library…"
            rows={1}
            style={{
              flex: 1,
              resize: "none",
              fontFamily: "'Inter', sans-serif",
              fontSize: 13.5,
              padding: "10px 14px",
              border: "1px solid #e3dccd",
              borderRadius: 12,
              color: "#383a37",
              background: "#fff",
              lineHeight: 1.55,
              outline: "none",
              boxShadow: "0 1px 2px rgba(56,58,55,0.05)",
            }}
          />
          <button
            onClick={send}
            disabled={!input.trim()}
            style={{
              background: input.trim() ? "#26281f" : "#e3dccd",
              border: "none",
              color: input.trim() ? "#e8e0cf" : "#a89f8f",
              borderRadius: 12,
              width: 44,
              cursor: input.trim() ? "pointer" : "default",
              fontSize: 18,
              flexShrink: 0,
            }}
          >↑</button>
        </div>
        <div style={{ fontSize: 10, color: "#c4bba7", marginTop: 6, fontFamily: "'Inter',sans-serif" }}>
          Enter to send · Shift+Enter for new line · Powered by Claude
        </div>
      </div>
    </div>
  );
}
