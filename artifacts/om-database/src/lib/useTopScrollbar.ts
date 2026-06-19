import { useEffect, useRef } from "react";

// Adds a SECOND horizontal scrollbar at the TOP of a horizontally-scrolling box,
// synced with the real one at the bottom. On tall boxes (tenant rosters, comps,
// wide tables) the bottom scrollbar sits below the fold, so when you're looking at
// the top of the box you can't see or use it — this puts a matching bar up top.
//
// Usage: const ref = useTopScrollbar<HTMLDivElement>();  then  <div ref={ref}
// style={{ overflowX: "auto" }}>…wide content…</div>. The bar is created/destroyed
// imperatively as a sibling just above the container, shows ONLY when the content
// overflows, and stays in sync both ways. No JSX restructuring needed.

const STYLE_ID = "hz-topbar-style";
function ensureStyle() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  // A visibly-styled thin scrollbar so it's discoverable on every platform (macOS
  // overlay scrollbars would otherwise hide it until hover).
  s.textContent = `
.hz-topbar{overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;scrollbar-color:#cdbf9f #f1eadc}
.hz-topbar::-webkit-scrollbar{height:10px}
.hz-topbar::-webkit-scrollbar-track{background:#f1eadc;border-radius:5px}
.hz-topbar::-webkit-scrollbar-thumb{background:#cdbf9f;border-radius:5px}
.hz-topbar::-webkit-scrollbar-thumb:hover{background:#b9a87f}`;
  document.head.appendChild(s);
}

export function useTopScrollbar<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof document === "undefined") return;
    ensureStyle();

    const bar = document.createElement("div");
    bar.className = "hz-topbar";
    bar.setAttribute("aria-hidden", "true");
    const spacer = document.createElement("div");
    spacer.style.height = "1px";
    bar.appendChild(spacer);
    el.parentNode?.insertBefore(bar, el);

    // Two-way scroll sync (guard against the feedback loop).
    let syncing = false;
    const onBar = () => { if (syncing) return; syncing = true; el.scrollLeft = bar.scrollLeft; syncing = false; };
    const onEl = () => { if (syncing) return; syncing = true; bar.scrollLeft = el.scrollLeft; syncing = false; };
    bar.addEventListener("scroll", onBar, { passive: true });
    el.addEventListener("scroll", onEl, { passive: true });

    const measure = () => {
      spacer.style.width = `${el.scrollWidth}px`;
      bar.style.display = el.scrollWidth > el.clientWidth + 1 ? "block" : "none";
    };
    measure();

    // Re-measure when the box resizes, its content changes (rows added/sorted), or
    // the window resizes.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", measure);

    return () => {
      bar.removeEventListener("scroll", onBar);
      el.removeEventListener("scroll", onEl);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
      bar.remove();
    };
  }, []);
  return ref;
}
