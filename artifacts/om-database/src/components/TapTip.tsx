import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tapTipFor } from "../lib/tapTip";

// ONE shared tap-to-show tooltip for touch screens (Eric, 10/19/26): a phone can't hover,
// so every hint that lives in a `title` (icons, badges, flag chips, the Debt doc-count badge)
// was invisible there. Mounted once in App; desktop / mouse hover is untouched (the browser's
// own title tooltip still shows), because this only reacts to TOUCH (pointerType "touch"/"pen").
//
// What a tap does:
//  • a small hint element (span / icon / badge, not a whole row or cell) with a `title` →
//    shows the bubble and the tap stops there (so tapping a chip inside a clickable row shows
//    its meaning instead of opening the row);
//  • `data-tap-tip` on any element (even inside a button) → the same, opt-in;
//  • `data-tap-tip="also"` (e.g. the roster flag-filter chips) → shows the bubble AND lets the
//    tap do its normal job;
//  • buttons, links, inputs, table rows / cells and large blocks without the attribute → left alone.
// The bubble closes on the next tap anywhere, on scroll, or after 8 seconds.

export default function TapTipLayer() {
  const [tip, setTip] = useState<{ text: string; top: number; left: number; above: boolean } | null>(null);
  const lastPointer = useRef<string>("mouse");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => { lastPointer.current = e.pointerType || "mouse"; };
    const onClick = (e: MouseEvent) => {
      if (lastPointer.current !== "touch" && lastPointer.current !== "pen") return;
      const hit = tapTipFor(e.target as Element);
      if (!hit) { setTip(null); return; }
      if (hit.swallow) { e.stopPropagation(); e.preventDefault(); }
      const r = hit.el.getBoundingClientRect();
      const W = Math.min(300, window.innerWidth - 24);
      const above = window.innerHeight - r.bottom < 140;
      const left = Math.max(12, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 12));
      setTip({ text: hit.text, top: above ? r.top - 8 : r.bottom + 8, left, above });
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setTip(null), 8000);
    };
    const close = () => setTip(null);
    // Capture phase on document: runs before React's own handlers, so a swallowed tap never
    // reaches the row / button underneath.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <div role="tooltip" style={{
      position: "fixed", top: tip.top, left: tip.left, width: "max-content", maxWidth: Math.min(300, window.innerWidth - 24),
      transform: tip.above ? "translateY(-100%)" : "none", zIndex: 10001, background: "#232422", color: "#faf9f5",
      padding: "9px 12px", borderRadius: 8, fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
      boxShadow: "0 8px 24px rgba(0,0,0,0.25)", pointerEvents: "none", fontFamily: "'Roboto',sans-serif",
    }}>{tip.text}</div>,
    document.body,
  );
}
