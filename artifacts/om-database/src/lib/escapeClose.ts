// Escape closes the top-most modal or drawer, everywhere (Eric, 10/16/26: Escape did
// nothing on Closing Costs and several others). Rather than wire a key handler into
// each of ~20 overlays, this does what a click outside would do: find the top-most
// full-screen backdrop and click it. Each overlay already closes on a backdrop click,
// so Escape inherits exactly that behaviour — no new close paths to get wrong.
//
// Overlays that handle Escape themselves are respected: the backdrop is picked at
// key-down, and only clicked if it is still on screen a tick later (i.e. nobody else
// closed it). So nothing ever closes twice.

// Only an element that actually reacts to a click is a "backdrop" (a full-screen
// drawer panel is not). React keeps each element's props on the DOM node.
function hasClickHandler(el: HTMLElement): boolean {
  const key = Object.keys(el).find(k => k.startsWith("__reactProps"));
  const props = key ? (el as unknown as Record<string, { onClick?: unknown }>)[key] : null;
  return !!props && typeof props.onClick === "function";
}

function topBackdrop(): HTMLElement | null {
  const w = window.innerWidth, h = window.innerHeight;
  let best: HTMLElement | null = null;
  let bestZ = -Infinity;
  const all = document.body.querySelectorAll<HTMLElement>("div[style*='fixed']");
  all.forEach(el => {
    if (el.style.position !== "fixed" || !hasClickHandler(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < w * 0.9 || r.height < h * 0.9) return;
    const cs = getComputedStyle(el);
    if (cs.pointerEvents === "none" || cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return;
    const z = Number.parseInt(cs.zIndex, 10);
    const zz = Number.isFinite(z) ? z : 0;
    if (zz >= bestZ) { bestZ = zz; best = el; }   // ties → later in the page wins
  });
  return best;
}

export function installEscapeToClose(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
    const target = topBackdrop();
    if (!target) return;
    setTimeout(() => { if (target.isConnected) target.click(); }, 0);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
