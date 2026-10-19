import { describe, it, expect } from "vitest";
import { tapTipFor } from "../tapTip";

// Minimal fake DOM: enough for closest() with tag / [attr] / [attr=value] selectors.
type Fake = { tagName: string; attrs: Record<string, string>; parent: Fake | null; textContent: string; w: number; h: number;
  getAttribute(k: string): string | null; closest<T>(sel: string): T | null; getBoundingClientRect(): { width: number; height: number } };
const matches = (e: Fake, sel: string) => sel.split(",").some(s => {
  s = s.trim();
  const m = /^\[([\w-]+)(?:=([\w-]+))?\]$/.exec(s);
  if (m) return m[1] in e.attrs && (m[2] == null || e.attrs[m[1]] === m[2]);
  return e.tagName.toLowerCase() === s;
});
function el(tagName: string, attrs: Record<string, string> = {}, parent: Fake | null = null, textContent = "", w = 40, h = 18): Fake {
  const e: Fake = { tagName: tagName.toUpperCase(), attrs, parent, textContent, w, h,
    getAttribute: k => (k in e.attrs ? e.attrs[k] : null),
    closest: <T,>(sel: string) => { let c: Fake | null = e; while (c) { if (matches(c, sel)) return c as unknown as T; c = c.parent; } return null; },
    getBoundingClientRect: () => ({ width: e.w, height: e.h }) };
  return e;
}
const tip = (x: Fake) => tapTipFor(x as unknown as Element);

describe("tap-to-show tooltip rules (touch only)", () => {
  const row = el("tr", { title: "Click for every field" });
  const td = el("td", {}, row);
  it("a flag chip inside a clickable roster row shows its meaning and swallows the tap", () => {
    const chip = el("span", { title: "Below mkt — In-place rent ≥15% below market", "data-tap-tip": "" }, td, "▼");
    expect(tip(chip)).toMatchObject({ text: "Below mkt — In-place rent ≥15% below market", swallow: true });
  });
  it("a plain small badge with a title works without opting in", () => {
    const ig = el("span", { title: "Investment-grade credit" }, td, "IG");
    expect(tip(ig)).toMatchObject({ text: "Investment-grade credit", swallow: true });
  });
  it("the Debt doc badge inside a phone card BUTTON still shows (opt-in), without pressing the card", () => {
    const card = el("button");
    const badge = el("span", { title: "4 source documents", "data-tap-tip": "" }, card, "4 docs");
    expect(tip(badge)).toMatchObject({ text: "4 source documents", swallow: true });
  });
  it("filter chips show their description AND still filter", () => {
    const chip = el("button", { title: "In-place rent ≥15% below…", "data-tap-tip": "also" }, null, "▼ Below mkt 4");
    expect(tip(chip)).toMatchObject({ swallow: false });
  });
  it("leaves rows, cells, buttons, links and big blocks alone", () => {
    expect(tip(td)).toBeNull();                                                          // reaches the tr's title → not a small hint
    expect(tip(el("button", { title: "Delete this record" }, null, "Delete"))).toBeNull();
    expect(tip(el("span", { title: "Open deal" }, el("a"), "x"))).toBeNull();            // hint inside a link belongs to the link
    expect(tip(el("span", { title: "Long explanation" }, null, "x", 400, 18))).toBeNull(); // too big to be an icon/badge
    expect(tip(el("div", { title: "x" }, null, "a much longer block of visible text here"))).toBeNull();
  });
  it("a title that only repeats the visible (truncated) text is ignored, so card taps still open the card", () => {
    expect(tip(el("span", { title: "Willow Creek Commons" }, el("div"), "Willow Creek Commons"))).toBeNull();
  });
  it("nothing titled → nothing", () => { expect(tip(el("span", {}, td, "plain"))).toBeNull(); expect(tapTipFor(null)).toBeNull(); });
});
