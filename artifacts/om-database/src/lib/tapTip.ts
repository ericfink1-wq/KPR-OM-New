// Pure tap-tooltip decision for TapTipLayer (components/TapTip.tsx) — kept DOM-light so it is unit-tested.
const SMALL_TAGS = new Set(["SPAN", "ABBR", "I", "B", "STRONG", "EM", "SMALL", "SUP", "SUB", "IMG", "SVG", "MARK", "CODE"]);
const INTERACTIVE = "button,a,input,select,textarea,summary,label,[role=button],[role=tab],[role=radio],[role=checkbox]";

/** Pure decision (exported for tests): should a tap on `target` open a tip, and does it swallow the tap? */
export function tapTipFor(target: Element | null): { el: HTMLElement; text: string; swallow: boolean } | null {
  if (!target) return null;
  const opt = target.closest<HTMLElement>("[data-tap-tip]");
  if (opt) {
    const text = (opt.getAttribute("data-tip") || opt.getAttribute("title") || opt.getAttribute("aria-label") || "").trim();
    return text ? { el: opt, text, swallow: opt.getAttribute("data-tap-tip") !== "also" } : null;
  }
  const titled = target.closest<HTMLElement>("[title]");
  if (!titled) return null;
  const text = (titled.getAttribute("title") || "").trim();
  if (!text) return null;
  // A title that only repeats the visible text (a truncated name) adds nothing — and the element is often
  // the face of a clickable card, so leave the tap alone.
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const shown = norm(titled.textContent ?? "");
  if (shown && (norm(text) === shown || shown.includes(norm(text)))) return null;
  const tag = titled.tagName.toUpperCase();
  if (!SMALL_TAGS.has(tag) && !(tag === "DIV" && (titled.textContent ?? "").trim().length <= 24)) return null;
  // A hint INSIDE a control belongs to the control — tapping it must still press the button.
  if (titled.closest(INTERACTIVE)) return null;
  const r = titled.getBoundingClientRect?.();
  if (r && (r.width > 260 || r.height > 64)) return null;
  return { el: titled, text, swallow: true };
}

