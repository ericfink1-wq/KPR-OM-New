import { useMemo, useState, useEffect } from "react";
import type { Deal } from "../lib/idb";
import { mineCorrectionPatterns, type CorrectionPattern } from "../lib/correctionPatterns";
import { apiAddExtractionLesson, apiGetExtractionLessons, type LessonScope, type ExtractionLesson } from "../lib/api";

// Phase A of the self-improving loop, surfaced: the corrections the system keeps
// making (mined from every deal's resolved Import-Review questions), each with a
// draft extraction LESSON you approve in one click → it flows into future
// extractions. The human stays the gatekeeper.

const C = {
  ink: "#383a37", sub: "#6f6a5f", faint: "#a69e91", line: "#efe8da", panel: "#faf7f0", panelBd: "#e7e0d2",
  green: "#3f7a1f", greenBg: "#eef3e6", greenBd: "#b8d49a",
  amber: "#c97a18", amberBg: "#fbf1e4", amberBd: "#e0c9a8", blue: "#1f4d8f",
};

function PatternCard({ p, isAdmin, onOpenDeal, existingLessons }: {
  p: CorrectionPattern; isAdmin: boolean; onOpenDeal: (id: string) => void; existingLessons: ExtractionLesson[];
}) {
  const [draft, setDraft] = useState(p.suggestedLesson);
  const [scope, setScope] = useState<LessonScope>(p.scope);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const alreadyTaught = existingLessons.some((l) => draft && l.lesson.trim() === draft.trim());
  const overFiring = p.fixed < 2 && p.dismissed >= 3;

  const save = async () => {
    if (!draft.trim()) return;
    setState("saving");
    const r = await apiAddExtractionLesson(scope, draft.trim());
    setState(r.ok ? "saved" : "error");
  };

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `3px solid ${overFiring ? C.amber : C.green}`, borderRadius: 8, padding: "11px 13px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{p.label}</div>
        <div style={{ fontSize: 10.5, color: C.sub }}>
          {p.fixed > 0 && <span style={{ color: C.green, fontWeight: 700 }}>✎ corrected {p.fixed}×</span>}
          {p.dismissed > 0 && <span style={{ marginLeft: 8, color: overFiring ? C.amber : C.faint }}>dismissed {p.dismissed}×</span>}
          {p.confirmed > 0 && <span style={{ marginLeft: 8, color: C.faint }}>confirmed {p.confirmed}×</span>}
        </div>
      </div>
      {overFiring && (
        <div style={{ fontSize: 11, color: C.amber, marginTop: 4 }}>⚠ This check is mostly being DISMISSED — it may be over-firing. Consider relaxing the check rather than adding a lesson.</div>
      )}
      {p.sampleQuestion && <div style={{ fontSize: 11, color: C.sub, marginTop: 4, fontStyle: "italic" }}>e.g. “{p.sampleQuestion.length > 160 ? p.sampleQuestion.slice(0, 160) + "…" : p.sampleQuestion}”</div>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
        {p.deals.slice(0, 12).map((d) => (
          <span key={d.dealId} onClick={() => onOpenDeal(d.dealId)} role="button"
            style={{ fontSize: 10, color: C.blue, background: "#eef2f8", border: "1px solid #d3def0", borderRadius: 5, padding: "1px 6px", cursor: "pointer", whiteSpace: "nowrap" }}>{d.dealName}</span>
        ))}
        {p.deals.length > 12 && <span style={{ fontSize: 10, color: C.faint }}>+{p.deals.length - 12} more</span>}
      </div>

      {/* Proposed lesson (editable) + approve */}
      <div style={{ marginTop: 9, borderTop: `1px solid ${C.line}`, paddingTop: 9 }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.05em", color: C.sub, textTransform: "uppercase", marginBottom: 4 }}>Proposed extraction lesson</div>
        <textarea value={draft} onChange={(e) => { setDraft(e.target.value); setState("idle"); }} rows={3} disabled={!isAdmin}
          style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.panelBd}`, borderRadius: 7, padding: "7px 9px", fontSize: 12, color: C.ink, fontFamily: "'Inter',sans-serif", background: isAdmin ? "#fff" : C.panel, resize: "vertical" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          <select value={scope} onChange={(e) => setScope(e.target.value as LessonScope)} disabled={!isAdmin}
            style={{ fontSize: 11, padding: "4px 6px", border: `1px solid ${C.panelBd}`, borderRadius: 6, background: "#fff", color: C.ink }}>
            <option value="all">All extractions</option>
            <option value="om">OM only</option>
            <option value="rent-roll">Rent roll only</option>
            <option value="sales">Sales only</option>
          </select>
          {isAdmin ? (
            <button onClick={save} disabled={state === "saving" || state === "saved" || alreadyTaught || !draft.trim()}
              style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", background: (state === "saved" || alreadyTaught) ? C.faint : C.green, border: "none", borderRadius: 6, padding: "5px 12px", cursor: (state === "saving" || state === "saved" || alreadyTaught) ? "default" : "pointer" }}>
              {alreadyTaught ? "✓ Already taught" : state === "saved" ? "✓ Added as lesson" : state === "saving" ? "Adding…" : state === "error" ? "Retry" : "Approve → add lesson"}
            </button>
          ) : <span style={{ fontSize: 10.5, color: C.faint }}>Admin approval required to add a lesson.</span>}
        </div>
      </div>
    </div>
  );
}

export default function LearningView({ deals, isAdmin, onOpenDeal }: { deals: Deal[]; isAdmin: boolean; onOpenDeal: (id: string) => void }) {
  const patterns = useMemo(() => mineCorrectionPatterns(deals), [deals]);
  const [lessons, setLessons] = useState<ExtractionLesson[]>([]);
  useEffect(() => { apiGetExtractionLessons("all").then(setLessons).catch(() => setLessons([])); }, []);
  const activeCount = lessons.length;

  // Download every active learning rule as JSON — including the "[REQUESTED: a
  // deterministic check…]" notes — so they can be handed off (the same way the deal
  // data is) to implement the requested code-level checks.
  const exportRules = () => {
    const payload = { app: "KPR Deal Intelligence", type: "extraction-lessons", exportedAt: new Date().toISOString(), count: lessons.length, lessons };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    a.download = `kpr-learning-rules-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  return (
    <div style={{ padding: "20px 18px 40px", maxWidth: 1000, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, fontFamily: "Georgia, serif" }}>Learning · corrections the system keeps making</div>
        {activeCount > 0 && (
          <button onClick={exportRules} title="Download all active learning rules (incl. requested hard-check notes) as JSON"
            style={{ background: "#fff", border: `1px solid ${C.greenBd}`, color: C.green, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif", whiteSpace: "nowrap" }}>
            ⬇ Export rules
          </button>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: C.sub, marginTop: 4, lineHeight: 1.5 }}>
        Mined from every deal's resolved data-review questions across all {deals.filter((d) => !d.trashedAt).length} deals. When the same correction recurs, approve a lesson and it flows into future extractions — so the extractor stops making it. {activeCount > 0 && <span>({activeCount} lesson{activeCount !== 1 ? "s" : ""} already active.)</span>}
      </div>

      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
        {patterns.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 8, padding: "11px 13px" }}>
            ✓ No recurring corrections yet. As you confirm/fix data-review questions on deals, repeated fixes will surface here as proposed lessons. The loop tightens as more deals flow through.
          </div>
        ) : patterns.map((p) => <PatternCard key={p.key} p={p} isAdmin={isAdmin} onOpenDeal={onOpenDeal} existingLessons={lessons} />)}
      </div>
    </div>
  );
}
