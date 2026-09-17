import { useEffect, useMemo, useState } from "react";
import { CATEGORY_LABEL, CATEGORY_STYLE, entriesSince, visibleChangelog } from "../lib/changelog";
import type { ChangeEntry } from "../lib/changelog";
import { useIsMobile } from "../hooks/use-mobile";

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * The instant this reader was last caught up. Entries after it are "new". When
   * null the modal shows the FULL list — that is the manual "What's new" button in
   * the header, where the reader asked to see everything rather than being
   * interrupted with it.
   */
  cutoff: string | null;
  /** Whether the cutoff came from a recorded read or from their previous sign-in. */
  basis?: "seen" | "previous-login" | "none";
}

function fmtDate(iso: string): string {
  // Parse as a plain calendar day. `new Date("2026-09-16")` is parsed as UTC
  // midnight, which renders as the 15th for anyone west of Greenwich — so build
  // the date from its parts instead of letting the timezone shift it a day.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function Entry({ e, isNew }: { e: ChangeEntry; isNew: boolean }) {
  const c = CATEGORY_STYLE[e.category];
  return (
    <li style={{ display:"flex", flexDirection:"column", gap:6, padding:"14px 0", borderTop:"1px solid #f1eadc" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        <span style={{ fontSize:9, letterSpacing:"0.07em", fontWeight:700, textTransform:"uppercase", color:c.fg, background:c.bg, border:`1px solid ${c.border}`, borderRadius:8, padding:"2px 8px", whiteSpace:"nowrap" }}>
          {CATEGORY_LABEL[e.category]}
        </span>
        <span style={{ fontSize:11, color:"#a89f8f", whiteSpace:"nowrap" }}>{fmtDate(e.date)}</span>
        {isNew && (
          <span style={{ fontSize:9, letterSpacing:"0.07em", fontWeight:700, textTransform:"uppercase", color:"#fff", background:"#3f7a1f", borderRadius:8, padding:"2px 8px", whiteSpace:"nowrap" }}>
            New to you
          </span>
        )}
      </div>
      <div style={{ fontFamily:"'Fraunces',serif", fontSize:16, fontWeight:600, color:"#2a2c28", lineHeight:1.35 }}>{e.title}</div>
      <div style={{ fontSize:13.5, color:"#55584f", lineHeight:1.6 }}>{e.detail}</div>
      {e.where && (
        <div style={{ fontSize:12, color:"#8a8579" }}>
          <span style={{ color:"#a89f8f" }}>Where: </span>{e.where}
        </div>
      )}
    </li>
  );
}

export default function WhatsNewModal({ open, onClose, cutoff, basis }: Props) {
  const isMobile = useIsMobile();
  // When opened manually the reader wants the archive, so show everything and mark
  // which entries are the ones they hadn't seen.
  const [showAll, setShowAll] = useState(false);

  const all = useMemo(() => visibleChangelog(), []);
  const unseen = useMemo(() => entriesSince(cutoff), [cutoff]);
  const unseenIds = useMemo(() => new Set(unseen.map(e => e.id)), [unseen]);
  const shown = cutoff && !showAll ? unseen : all;
  // The "new to you" badge only carries information when read and unread entries are
  // mixed together. In the automatic view every row is unread by construction, so the
  // badge would sit on all of them and say nothing.
  const mixed = shown.length > unseenIds.size && unseenIds.size > 0;

  // Reset the expand state each time it opens, so a manual open after an automatic
  // one doesn't inherit the previous view.
  useEffect(() => { if (open) setShowAll(!cutoff); }, [open, cutoff]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const subtitle = !cutoff
    ? "Everything that has shipped recently."
    : basis === "previous-login"
      ? `${unseen.length} ${unseen.length === 1 ? "change" : "changes"} since you were last signed in.`
      : `${unseen.length} ${unseen.length === 1 ? "change" : "changes"} since you last checked.`;

  return (
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(42,44,40,0.52)", zIndex:1200, backdropFilter:"blur(2px)" }} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        style={{
          position:"fixed", zIndex:1201, background:"#fff",
          fontFamily:"'Inter',-apple-system,sans-serif",
          boxShadow:"0 20px 60px rgba(42,44,40,0.22)",
          display:"flex", flexDirection:"column",
          // On a phone the dialog is a bottom sheet pinned to the bottom edge, so the
          // close button sits under the thumb instead of at the top of a tall card.
          ...(isMobile
            ? { left:0, right:0, bottom:0, top:"auto", maxHeight:"88vh", borderRadius:"16px 16px 0 0" }
            : { top:"50%", left:"50%", transform:"translate(-50%,-50%)", width:"min(680px, calc(100vw - 32px))", maxHeight:"85vh", borderRadius:14 }),
        }}
      >
        <div style={{ padding: isMobile ? "18px 18px 12px" : "24px 26px 14px", borderBottom:"1px solid #f1eadc", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
            <div style={{ minWidth:0 }}>
              <div id="whats-new-title" style={{ fontFamily:"'Fraunces',serif", fontSize: isMobile ? 20 : 23, fontWeight:600, color:"#2a2c28" }}>
                What's new
              </div>
              <div style={{ fontSize:12.5, color:"#8a8579", marginTop:4 }}>{subtitle}</div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{ flexShrink:0, width:34, height:34, borderRadius:8, border:"1px solid #e3dccd", background:"#fff", color:"#8a8579", fontSize:17, cursor:"pointer", lineHeight:1 }}
            >×</button>
          </div>
        </div>

        <div style={{ overflowY:"auto", padding: isMobile ? "0 18px" : "0 26px", flex:1, WebkitOverflowScrolling:"touch" as any }}>
          {shown.length === 0 ? (
            <div style={{ padding:"28px 0", textAlign:"center", color:"#8a8579", fontSize:13.5 }}>
              You're all caught up.
            </div>
          ) : (
            <ul style={{ listStyle:"none", margin:0, padding:0 }}>
              {shown.map(e => <Entry key={e.id} e={e} isNew={mixed && unseenIds.has(e.id)} />)}
            </ul>
          )}
        </div>

        <div style={{ padding: isMobile ? "12px 18px calc(16px + env(safe-area-inset-bottom))" : "14px 26px 20px", borderTop:"1px solid #f1eadc", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap", flexShrink:0 }}>
          {cutoff && !showAll && all.length > unseen.length ? (
            <button
              onClick={() => setShowAll(true)}
              style={{ background:"none", border:"none", padding:0, color:"#3f7a1f", fontSize:12.5, fontWeight:600, cursor:"pointer", textDecoration:"underline", fontFamily:"'Inter',sans-serif" }}
            >
              Show earlier updates
            </button>
          ) : <span />}
          <button
            onClick={onClose}
            style={{ background:"#3f7a1f", border:"1px solid #3f7a1f", color:"#fff", borderRadius:8, padding:"9px 20px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"'Inter',sans-serif", minHeight:40 }}
          >
            Got it
          </button>
        </div>
      </div>
    </>
  );
}
