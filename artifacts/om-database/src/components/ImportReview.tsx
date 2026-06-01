import { useState, useMemo } from "react";
import type { Deal, ReviewQuestion } from "../lib/idb";
import { buildReviewQuestions } from "../lib/utils";

// Non-blocking post-import data-integrity review. Opened from the "N to confirm"
// badge on the deal page. Each question is either an AI low-confidence capture or
// a deterministic arithmetic/missing-field check. Confirming or dismissing stamps
// resolvedAt so it never re-asks; the deal's reviewQuestions are updated via onUpdate.
export default function ImportReview({ deal, onClose, onUpdate }: {
  deal: Deal;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<Deal>) => void;
}) {
  // Compute the live merged list (AI + checks), preserving prior resolutions.
  const all = useMemo(() => buildReviewQuestions(deal), [deal]);
  const [showResolved, setShowResolved] = useState(false);
  const open = all.filter(q => !q.resolvedAt);
  const resolved = all.filter(q => q.resolvedAt);

  // Persist a resolution. We store the FULL merged list back onto the deal so the
  // deterministic checks (which aren't otherwise persisted) keep their resolved
  // state too.
  const resolve = (q: ReviewQuestion, resolution: "confirmed" | "dismissed") => {
    const next = all.map(x => x.id === q.id
      ? { ...x, resolvedAt: new Date().toISOString(), resolution }
      : x);
    onUpdate(deal.id, { reviewQuestions: next });
  };

  const reopen = (q: ReviewQuestion) => {
    const next = all.map(x => x.id === q.id ? { ...x, resolvedAt: null, resolution: null } : x);
    onUpdate(deal.id, { reviewQuestions: next });
  };

  const sevColor = (s: string) => s === "high" ? "#dc2626" : s === "medium" ? "#d9890c" : "#a89f8f";
  const sevBg = (s: string) => s === "high" ? "#fef2f2" : s === "medium" ? "#fffaf2" : "#faf7f0";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(38,40,31,0.45)", backdropFilter: "blur(3px)", zIndex: 9500, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px 16px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 620, boxShadow: "0 20px 60px rgba(38,40,31,0.3)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #f1eadc", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 19, fontWeight: 600, color: "#26281f" }}>Confirm import details</div>
            <div style={{ fontSize: 12.5, color: "#8b8578", marginTop: 4, lineHeight: 1.5 }}>
              {open.length > 0
                ? `${open.length} item${open.length === 1 ? "" : "s"} I wasn't fully sure I captured correctly from this document. Confirm or fix when you have a moment — nothing is blocked.`
                : "Everything checks out — no open data-integrity questions for this deal."}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, color: "#a89f8f", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {/* Open questions */}
        <div style={{ maxHeight: "56vh", overflowY: "auto", padding: open.length ? "12px 22px 6px" : "0" }}>
          {open.map(q => (
            <div key={q.id} style={{ background: sevBg(q.severity), border: `1px solid ${sevColor(q.severity)}33`, borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: sevColor(q.severity), background: "#fff", border: `1px solid ${sevColor(q.severity)}44`, borderRadius: 4, padding: "1px 6px" }}>{q.severity}</span>
                {q.field && <span style={{ fontSize: 10.5, color: "#a89f8f", fontFamily: "monospace" }}>{q.field}</span>}
                <span style={{ fontSize: 8.5, color: "#bcae97", marginLeft: "auto" }}>{q.source === "ai" ? "AI flag" : "auto-check"}</span>
              </div>
              <div style={{ fontSize: 13.5, color: "#383a37", fontWeight: 500, lineHeight: 1.5 }}>{q.question}</div>
              {q.detail && <div style={{ fontSize: 12, color: "#8b8578", marginTop: 4, lineHeight: 1.5 }}>{q.detail}</div>}
              {q.suggestedValue && (
                <div style={{ fontSize: 12, color: "#5c5047", marginTop: 6 }}>
                  Captured as: <span style={{ fontWeight: 600, background: "#fff", border: "1px solid #e7e0d2", borderRadius: 4, padding: "1px 6px" }}>{q.suggestedValue}</span>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={() => resolve(q, "confirmed")} style={{ background: "#26281f", border: "none", color: "#e8e0cf", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>✓ Looks right</button>
                <button onClick={() => resolve(q, "dismissed")} style={{ background: "#fff", border: "1px solid #d9d2c4", color: "#7d766a", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>Dismiss</button>
                <span style={{ fontSize: 11, color: "#bcae97", alignSelf: "center", marginLeft: 2 }}>
                  {q.source === "ai" ? "Open the field above to edit if it's wrong" : "edit values on the deal page"}
                </span>
              </div>
            </div>
          ))}

          {open.length === 0 && (
            <div style={{ padding: "26px 22px", textAlign: "center", color: "#9a917f", fontSize: 13 }}>
              ✓ No open questions.
            </div>
          )}
        </div>

        {/* Resolved (collapsed) */}
        {resolved.length > 0 && (
          <div style={{ borderTop: "1px solid #f1eadc", padding: "10px 22px 16px" }}>
            <button onClick={() => setShowResolved(s => !s)} style={{ background: "transparent", border: "none", color: "#a89f8f", cursor: "pointer", fontSize: 11.5, fontWeight: 600, fontFamily: "'Inter',sans-serif", padding: 0 }}>
              {showResolved ? "▾" : "▸"} {resolved.length} resolved
            </button>
            {showResolved && resolved.map(q => (
              <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: "1px solid #f6f1e7", fontSize: 12 }}>
                <span style={{ color: q.resolution === "confirmed" ? "#0f9d63" : "#a89f8f", flexShrink: 0 }}>{q.resolution === "confirmed" ? "✓" : "—"}</span>
                <span style={{ color: "#8b8578", flex: 1, textDecoration: "line-through", textDecorationColor: "#d9d2c4" }}>{q.question}</span>
                <button onClick={() => reopen(q)} style={{ background: "transparent", border: "none", color: "#bcae97", cursor: "pointer", fontSize: 11, flexShrink: 0 }}>reopen</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
