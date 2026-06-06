import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiGetHouseView, apiSaveHouseView, apiRebuildHouseView, type HouseViewData } from "../lib/api";
import { useIsMobile } from "../hooks/use-mobile";

// The House View: KPR's distilled, cross-deal underwriting lens — synthesized from
// every deal's "Our Review" and applied to all future analyses. This modal lets the
// team read it, rebuild it from the latest reviews, and hand-edit it.

const C = { ink: "#383a37", sub: "#6f6a5f", faint: "#a69e91", line: "#efe8da", green: "#1f7a43", greenBg: "#f1f8f2", greenBd: "#c2e0c9" };

export default function HouseViewModal({ open, onClose, isAdmin }: { open: boolean; onClose: () => void; isAdmin?: boolean }) {
  const isMobile = useIsMobile();
  const [data, setData] = useState<HouseViewData | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "rebuild">("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true); setErr(null);
    apiGetHouseView().then((hv) => { setData(hv); setText(hv.content); }).catch((e) => setErr(String(e?.message || e))).finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  const dirty = data != null && text.trim() !== (data.content || "").trim();
  const save = async () => {
    setBusy("save"); setErr(null);
    try { const hv = await apiSaveHouseView(text); setData(hv); setText(hv.content); } catch (e) { setErr(String((e as Error)?.message || e)); } finally { setBusy(""); }
  };
  const rebuild = async () => {
    if (!window.confirm("Rebuild the House View by re-reading every deal's review? This runs a token pass and overwrites the current text.")) return;
    setBusy("rebuild"); setErr(null);
    try { const hv = await apiRebuildHouseView(); setData(hv); setText(hv.content); } catch (e) { setErr(String((e as Error)?.message || e)); } finally { setBusy(""); }
  };

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(42,44,40,0.52)", zIndex: 2000, backdropFilter: "blur(2px)" }} aria-hidden="true" />
      <div role="dialog" aria-modal="true"
        style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 2001, width: "min(720px, calc(100vw - 24px))", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 14, boxShadow: "0 20px 60px rgba(42,44,40,0.22)", fontFamily: "'Inter',-apple-system,sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: isMobile ? "14px 16px 10px" : "18px 22px 12px", borderBottom: `1px solid ${C.line}` }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>🧠 House View</div>
            <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>
              KPR's underwriting lens — distilled from your deal reviews, applied to every future analysis.
              {data ? ` · from ${data.sourceCount} review${data.sourceCount === 1 ? "" : "s"}${data.lastDistilledAt ? ` · rebuilt ${new Date(data.lastDistilledAt).toLocaleDateString()}` : ""}` : ""}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ fontSize: 20, lineHeight: 1, color: C.faint, background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}>×</button>
        </div>

        <div style={{ overflowY: "auto", padding: "14px 22px 18px" }}>
          {loading ? (
            <div style={{ color: C.faint, fontSize: 13, padding: "20px 0" }}>Loading…</div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.5, marginBottom: 10 }}>
                This is what the analyst applies to grades, strengths, risks and pricing on every deal. {isAdmin ? "Edit it directly, or rebuild it from the latest reviews." : "Ask an admin to edit or rebuild it."}
              </div>
              {isAdmin ? (
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16}
                  placeholder="No House View yet. Write a few deal reviews, then click “Rebuild from reviews” to distill them — or type your underwriting principles here directly."
                  style={{ width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "'Inter',sans-serif", fontSize: 13, lineHeight: 1.6, padding: "12px 14px", border: `1px solid ${C.greenBd}`, borderRadius: 8, color: C.ink, background: C.greenBg, outline: "none" }} />
              ) : (
                <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.6, color: C.ink, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 8, padding: "12px 14px", minHeight: 80 }}>
                  {text || <span style={{ color: C.faint }}>No House View yet — it builds once deals have reviews.</span>}
                </div>
              )}
              {err && <div style={{ marginTop: 8, fontSize: 12, color: "#b3261e", background: "#fdecec", border: "1px solid #f3c0c0", borderRadius: 8, padding: "8px 10px" }}>{err}</div>}
              {isAdmin && (
                <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                  <button onClick={save} disabled={!dirty || !!busy}
                    style={{ background: dirty && !busy ? "#fff" : "#f1eadc", border: `1px solid ${C.greenBd}`, color: dirty && !busy ? C.green : C.faint, padding: "8px 16px", borderRadius: 8, cursor: dirty && !busy ? "pointer" : "default", fontSize: 13, fontWeight: 600 }}>
                    {busy === "save" ? "Saving…" : "Save edits"}
                  </button>
                  <button onClick={rebuild} disabled={!!busy}
                    style={{ background: C.green, border: "none", color: "#fff", padding: "8px 16px", borderRadius: 8, cursor: busy ? "default" : "pointer", fontSize: 13, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
                    {busy === "rebuild" ? "Rebuilding…" : "🔄 Rebuild from reviews"}
                  </button>
                  <span style={{ fontSize: 10.5, color: C.faint, alignSelf: "center" }}>Rebuild re-reads every review (token pass).</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
