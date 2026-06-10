import { createPortal } from "react-dom";
import type { ImportPlan, ChangeType } from "../lib/importDiff";

interface Props {
  plan: ImportPlan;
  onConfirm: () => void;
  onCancel: () => void;
}

const TYPE_STYLE: Record<ChangeType, { label: string; color: string; bg: string }> = {
  removed: { label: "WIPES", color: "#b3403f", bg: "#fdecec" },
  changed: { label: "CHANGES", color: "#9a6a12", bg: "#fff3df" },
  added: { label: "ADDS", color: "#2f6b1f", bg: "#eef5e6" },
};

export default function ImportDiffModal({ plan, onConfirm, onCancel }: Props) {
  const { updates, addCount } = plan;
  const wipeCount = updates.reduce((s, u) => s + u.changes.filter(c => c.type === "removed").length, 0);

  return createPortal(
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 9700, background: "rgba(38,40,31,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 14 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(660px, 100%)", maxHeight: "84vh", background: "#fff", border: "1px solid #e6dfd0", borderRadius: 14, boxShadow: "0 18px 50px rgba(38,40,31,0.3)", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "'Inter',sans-serif" }}>
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #f1eadc" }}>
          <div style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: 19, fontWeight: 600, color: "#26281f" }}>Review this import</div>
          <div style={{ fontSize: 12.5, color: "#7d766a", marginTop: 4, lineHeight: 1.5 }}>
            {addCount > 0 && <><strong>{addCount}</strong> new deal{addCount === 1 ? "" : "s"} will be added. </>}
            <strong>{updates.length}</strong> existing deal{updates.length === 1 ? "" : "s"} will be updated.
            {wipeCount > 0 && <span style={{ color: "#b3403f" }}> {wipeCount} field{wipeCount === 1 ? "" : "s"} will be wiped (not in the file).</span>}
            {" "}Your roster, notes, and KPR underwriting fields are always preserved. You can also Undo right after.
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: "8px 20px" }}>
          {updates.length === 0 ? (
            <div style={{ fontSize: 13, color: "#7d766a", padding: "16px 0" }}>No changes to existing deals — these are all new.</div>
          ) : updates.map(u => (
            <div key={u.id} style={{ padding: "12px 0", borderBottom: "1px solid #f4efe4" }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: "#26281f", marginBottom: 6 }}>{u.propertyName}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {u.changes.map((c, i) => {
                  const ts = TYPE_STYLE[c.type];
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11.5, flexWrap: "wrap" }}>
                      <span style={{ flexShrink: 0, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.04em", color: ts.color, background: ts.bg, borderRadius: 4, padding: "1px 5px", minWidth: 50, textAlign: "center" }}>{ts.label}</span>
                      <span style={{ fontWeight: 600, color: "#2a2c28", fontFamily: "ui-monospace,monospace" }}>{c.key}</span>
                      <span style={{ color: "#8b8578" }}>
                        {c.type === "added" ? <>→ {c.after}</> : c.type === "removed" ? <span style={{ textDecoration: "line-through" }}>{c.before}</span> : <>{c.before} → <span style={{ color: "#2a2c28", fontWeight: 600 }}>{c.after}</span></>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: "12px 20px", borderTop: "1px solid #f1eadc", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onCancel} style={{ border: "1px solid #d9d2c4", background: "#fff", color: "#5c5047", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", minHeight: 38 }}>Cancel</button>
          <button onClick={onConfirm} style={{ border: "none", background: "#3f7a1f", color: "#fff", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 38 }}>Import {updates.length + addCount} deal{updates.length + addCount === 1 ? "" : "s"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
