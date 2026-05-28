import { useState } from "react";

interface Props {
  onAsk: (q: string) => void;
}

export default function AnalystBar({ onAsk }: Props) {
  const [input, setInput] = useState("");

  const send = () => {
    const q = input.trim();
    if (!q) return;
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
        <div style={{ display: "flex", gap: 10 }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
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
