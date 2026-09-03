// Helvetica / Helvetica-Bold advance widths (AFM units per 1000 em) — the two
// built-in faces every KPR PDF uses. Lets the exporter MEASURE text before laying
// a table out, instead of guessing at percentage column widths and hoping.
const HELV: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "{": 334, "|": 260, "}": 334, "~": 584,
};
const HELV_BOLD: Record<string, number> = {
  " ": 278, "!": 333, '"': 474, "#": 556, $: 556, "%": 889, "&": 722, "'": 238,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  ":": 333, ";": 333, "<": 584, "=": 584, ">": 584, "?": 611, "@": 975,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556,
  K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 333, "\\": 278, "]": 333, "^": 584, _: 556, "`": 333,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
  k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
  u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  "{": 389, "|": 280, "}": 389, "~": 584,
};
// Characters our formatters actually emit beyond ASCII.
const EXTRA: Record<string, number> = { "—": 1000, "–": 556, "·": 278, "÷": 584, "’": 191, "“": 333, "”": 333 };
const FALLBACK = 556;

/** Width of `text` in POINTS at `fontSize`. */
export function measureText(text: string, fontSize: number, bold = false): number {
  const table = bold ? HELV_BOLD : HELV;
  let units = 0;
  for (const ch of String(text ?? "")) units += table[ch] ?? EXTRA[ch] ?? FALLBACK;
  return (units / 1000) * fontSize;
}

/** Width of the single widest WORD — a column narrower than this must hyphenate. */
export function measureLongestWord(text: string, fontSize: number, bold = false): number {
  let max = 0;
  for (const w of String(text ?? "").split(/\s+/)) max = Math.max(max, measureText(w, fontSize, bold));
  return max;
}

/**
 * How many lines `text` needs at `width`, wrapping on spaces only (no hyphenation —
 * the document disables it). A word wider than the column still occupies its own line.
 */
export function wrappedLineCount(text: string, width: number, fontSize: number, bold = false): number {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length || width <= 0) return 1;
  let lines = 1, cur = 0;
  const space = measureText(" ", fontSize, bold);
  for (const w of words) {
    const ww = measureText(w, fontSize, bold);
    // A word WIDER than the column can't be wrapped onto one line — the renderer
    // spills it across several. Count those, or a single unbreakable value reads as
    // "fits" and the auto-fit never steps the font down.
    if (ww > width) {
      const spans = Math.ceil(ww / width);
      lines += (cur === 0 ? spans - 1 : spans);
      cur = width;   // the tail occupies the last line
      continue;
    }
    if (cur === 0) { cur = ww; continue; }
    if (cur + space + ww <= width) cur += space + ww;
    else { lines++; cur = ww; }
  }
  return lines;
}
