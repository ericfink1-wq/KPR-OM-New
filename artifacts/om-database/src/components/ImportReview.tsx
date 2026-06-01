import { useState, useMemo } from "react";
import type { Deal, ReviewQuestion, Tenant } from "../lib/idb";
import { buildReviewQuestions, tenantKey } from "../lib/utils";

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

  // Which question is currently being edited inline, and the draft value.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startFix = (q: ReviewQuestion) => {
    setEditingId(q.id);
    setDraft(q.suggestedValue ?? "");
  };

  // Apply a correction to the actual deal/tenant field, then mark the question
  // "fixed". Tenant SF edits also recompute occupancy/WALT (respecting verified
  // locks), matching the rent-roll path.
  const applyFix = (q: ReviewQuestion) => {
    const t = q.target;
    if (!t) return;
    const coerce = (s: string): string | number | null => {
      const v = s.trim();
      if (v === "") return null;
      if (t.valueType === "text") return v;
      const num = Number(v.replace(/[$,%\s]/g, ""));
      return isNaN(num) ? v : num;
    };
    const value = coerce(draft);
    const patch: Partial<Deal> = {};

    if (t.kind === "deal") {
      (patch as Record<string, unknown>)[t.fieldKey] = value;
    } else {
      // tenant edit — find by name (canonical-insensitive), patch that row
      const tenants = (deal.tenants || []) as Tenant[];
      const wantKey = tenantKey(t.tenantName || "");
      const idx = tenants.findIndex(tn => tenantKey(tn.canonicalName || tn.name) === wantKey || tn.name === t.tenantName);
      if (idx < 0) return;
      const newTenants = tenants.map((tn, i) => i === idx ? { ...tn, [t.fieldKey]: value } : tn);
      patch.tenants = newTenants;
      // Recompute occupancy + WALT when SF or term changed, honoring verified locks.
      const nv = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
      if ((t.fieldKey === "sf") && !deal.verified?.occupancy && deal.totalSF) {
        const occSF = newTenants.reduce((s, tn) => s + (nv(tn.sf) ?? 0), 0);
        const occ = Math.round(occSF / Number(deal.totalSF) * 1000) / 10;
        if (occ > 0 && occ <= 100) patch.occupancy = occ;
      }
      if ((t.fieldKey === "sf" || t.fieldKey === "remainingTermYears") && !deal.verified?.walt) {
        const sfT = newTenants.reduce((s, tn) => s + (nv(tn.sf) ?? 0), 0);
        const wT = newTenants.reduce((s, tn) => s + (nv(tn.sf) ?? 0) * (nv(tn.remainingTermYears) ?? 0), 0);
        if (sfT > 0) patch.walt = Math.round(wT / sfT * 10) / 10;
      }
    }

    patch.reviewQuestions = all.map(x => x.id === q.id
      ? { ...x, suggestedValue: value == null ? null : String(value), resolvedAt: new Date().toISOString(), resolution: "fixed" as const }
      : x);
    onUpdate(deal.id, patch);
    setEditingId(null);
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
                ? `${open.length} item${open.length === 1 ? "" : "s"} I wasn't fully sure I captured correctly from this document. Confirm it, or hit "Fix it" to correct the value right here — nothing is blocked.`
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
              {q.suggestedValue && editingId !== q.id && (
                <div style={{ fontSize: 12, color: "#5c5047", marginTop: 6 }}>
                  Captured as: <span style={{ fontWeight: 600, background: "#fff", border: "1px solid #e7e0d2", borderRadius: 4, padding: "1px 6px" }}>{q.suggestedValue}</span>
                </div>
              )}

              {editingId === q.id ? (
                /* Inline correction editor */
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
                    Corrected value{q.target?.kind === "tenant" && q.target.tenantName ? ` for ${q.target.tenantName}` : ""}:
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      autoFocus
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") applyFix(q); if (e.key === "Escape") setEditingId(null); }}
                      placeholder={q.target?.valueType === "text" ? "Enter the correct value" : "Enter the correct number"}
                      style={{ flex: 1, border: "1px solid #c8b89a", borderRadius: 7, padding: "7px 10px", fontSize: 13, color: "#383a37", fontFamily: "'Inter',sans-serif", outline: "none", background: "#fff" }}
                    />
                    <button onClick={() => applyFix(q)} style={{ background: "#3f7a1f", border: "none", color: "#fff", padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>Save</button>
                    <button onClick={() => setEditingId(null)} style={{ background: "transparent", border: "1px solid #d9d2c4", color: "#7d766a", padding: "7px 12px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontFamily: "'Inter',sans-serif" }}>Cancel</button>
                  </div>
                  {q.target?.kind === "tenant" && (q.target.fieldKey === "sf" || q.target.fieldKey === "remainingTermYears") && (
                    <div style={{ fontSize: 10.5, color: "#bcae97", marginTop: 5 }}>Occupancy / WALT will recompute automatically.</div>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button onClick={() => resolve(q, "confirmed")} style={{ background: "#26281f", border: "none", color: "#e8e0cf", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>✓ Looks right</button>
                  {q.target ? (
                    <button onClick={() => startFix(q)} style={{ background: "#fff", border: "1px solid #8cbf63", color: "#3f7a1f", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>✎ Fix it</button>
                  ) : null}
                  <button onClick={() => resolve(q, "dismissed")} style={{ background: "#fff", border: "1px solid #d9d2c4", color: "#7d766a", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>Dismiss</button>
                  {!q.target && (
                    <span style={{ fontSize: 11, color: "#bcae97", alignSelf: "center", marginLeft: 2 }}>edit on the deal page if needed</span>
                  )}
                </div>
              )}
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
                <span style={{ color: q.resolution === "confirmed" ? "#0f9d63" : q.resolution === "fixed" ? "#3f7a1f" : "#a89f8f", flexShrink: 0 }}>{q.resolution === "confirmed" ? "✓" : q.resolution === "fixed" ? "✎" : "—"}</span>
                <span style={{ color: "#8b8578", flex: 1, textDecoration: "line-through", textDecorationColor: "#d9d2c4" }}>{q.question}{q.resolution === "fixed" && q.suggestedValue ? ` → ${q.suggestedValue}` : ""}</span>
                <button onClick={() => reopen(q)} style={{ background: "transparent", border: "none", color: "#bcae97", cursor: "pointer", fontSize: 11, flexShrink: 0 }}>reopen</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
