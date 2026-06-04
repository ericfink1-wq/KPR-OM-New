// PDF.js extraction utilities — loaded dynamically from CDN
import { PDF_JS_CDN, PDF_JS_WORKER } from "./constants";

let pdfJsLib: unknown = null;

export async function loadPdfJs(): Promise<any> {
  if (pdfJsLib) return pdfJsLib;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PDF_JS_CDN;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load PDF.js"));
    document.head.appendChild(s);
  });
  const lib = (window as any).pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = PDF_JS_WORKER;
  pdfJsLib = lib;
  return lib;
}

// Render a single PDF page to a compressed JPEG data URL at a target pixel width.
// `half` can be "full" (default), "left", or "right" — for two-page-spread OMs.
export async function _renderPdfPage(
  pdf: any,
  n: number,
  targetW: number,
  quality: number,
  half: "full" | "left" | "right" = "full"
): Promise<string> {
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const wantW = half === "full" ? targetW : targetW * 2;
  const scale = Math.min(wantW / base.width, 3);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  let out: HTMLCanvasElement = canvas;
  if (half === "left" || half === "right") {
    const hw = Math.floor(canvas.width / 2);
    const c = document.createElement("canvas");
    c.width = hw; c.height = canvas.height;
    const cx = c.getContext("2d")!;
    cx.drawImage(canvas, half === "left" ? 0 : (canvas.width - hw), 0, hw, canvas.height, 0, 0, hw, canvas.height);
    out = c;
  }
  const url = out.toDataURL("image/jpeg", quality);
  canvas.width = canvas.height = 0;
  if (out !== canvas) { out.width = out.height = 0; }
  return url;
}

// Downscale a source canvas to a target width and return a JPEG data URL.
function _scaleCanvas(src: HTMLCanvasElement, targetW: number, quality: number): string {
  const ratio = Math.min(1, targetW / src.width);
  const w = Math.max(1, Math.round(src.width * ratio));
  const h = Math.max(1, Math.round(src.height * ratio));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const cx = c.getContext("2d")!;
  cx.fillStyle = "#ffffff";
  cx.fillRect(0, 0, w, h);
  cx.drawImage(src, 0, 0, w, h);
  const url = c.toDataURL("image/jpeg", quality);
  c.width = c.height = 0;
  return url;
}

// Downscale any image data URL to a small thumbnail JPEG sized for the deal
// library / tiles (used for raw cover uploads and the one-time backfill).
export function dataUrlToThumb(dataUrl: string, width = 600, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, width / (img.naturalWidth || width));
      const w = Math.max(1, Math.round((img.naturalWidth || width) * ratio));
      const h = Math.max(1, Math.round((img.naturalHeight || width) * ratio));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) { reject(new Error("no canvas context")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      const out = c.toDataURL("image/jpeg", quality);
      c.width = c.height = 0;
      resolve(out);
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = dataUrl;
  });
}

// Capture a clean property photo from a page: extract the largest EMBEDDED image
// (the actual photo) rather than screenshotting the page, which strips the broker
// logos and text that are layered on top. Tracks the transform matrix so it can
// pick the largest photo on a chosen `half` ("full"|"left"|"right") of a two-page
// spread. Falls back to a (optionally half-cropped) page render. Returns {cover,thumb}.
export async function _capturePagePhoto(
  pdf: any,
  pageNum: number,
  lib: any,
  half: "full" | "left" | "right" = "full",
  // Site plans are composed pages (a vector diagram + labels layered over an
  // aerial photo). Extracting the single largest embedded image grabs only the
  // aerial background (a green wash), so site-plan captures pass
  // preferPageRender=true to use the full composed page render instead.
  preferPageRender = false,
): Promise<{ cover: string | null; thumb: string | null }> {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  // Render the page (also resolves embedded image objects) — used as fallback.
  const wantW = half === "full" ? 1500 : 3000;
  const scale = Math.min(wantW / base.width, half === "full" ? 2.2 : 3);
  const viewport = page.getViewport({ scale });
  const pc = document.createElement("canvas");
  pc.width = Math.round(viewport.width);
  pc.height = Math.round(viewport.height);
  const pctx = pc.getContext("2d")!;
  pctx.fillStyle = "#ffffff";
  pctx.fillRect(0, 0, pc.width, pc.height);
  await page.render({ canvasContext: pctx, viewport }).promise;

  // For site plans, use the full composed page render and skip largest-image
  // extraction entirely (which would grab the aerial background only).
  if (preferPageRender && half === "full") {
    const cover = _scaleCanvas(pc, 1600, 0.8);
    const thumb = _scaleCanvas(pc, 600, 0.7);
    pc.width = pc.height = 0;
    return { cover, thumb };
  }

  let cleanCanvas: HTMLCanvasElement | null = null;
  try {
    const OPS = lib.OPS;
    const opList = await page.getOperatorList();
    // Track the current transform matrix to know where each image sits on the page.
    let m = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    const mul = (a: number[], b: number[]) => [
      a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
      a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
      a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5],
    ];
    const halfBound = base.width / 2;
    const found: { name: string; cx: number }[] = [];
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i], args = opList.argsArray[i];
      if (fn === OPS.save) stack.push(m.slice());
      else if (fn === OPS.restore) { if (stack.length) m = stack.pop()!; }
      else if (fn === OPS.transform) m = mul(m, args);
      else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
        const a = args[0];
        if (typeof a === "string") {
          found.push({ name: a, cx: m[0]*0.5 + m[2]*0.5 + m[4] });
        }
      }
    }
    let best: { img: any; w: number; h: number } | null = null;
    let bestArea = 0;
    for (const it of found) {
      if (half === "left" && it.cx > halfBound) continue;
      if (half === "right" && it.cx < halfBound) continue;
      let img: any = null;
      try { img = page.objs.get(it.name); } catch { img = null; }
      if (!img) continue;
      const w = img.width || (img.bitmap && img.bitmap.width) || 0;
      const h = img.height || (img.bitmap && img.bitmap.height) || 0;
      if (w * h > bestArea) { bestArea = w * h; best = { img, w, h }; }
    }
    const minW = half === "full" ? 560 : 360;
    const minH = half === "full" ? 360 : 240;
    if (best && best.w >= minW && best.h >= minH) {
      const ic = document.createElement("canvas");
      ic.width = best.w; ic.height = best.h;
      const ictx = ic.getContext("2d")!;
      const im = best.img;
      if (im.bitmap) {
        ictx.drawImage(im.bitmap, 0, 0);
        cleanCanvas = ic;
      } else if (im.data) {
        const out = new Uint8ClampedArray(best.w * best.h * 4);
        const d = im.data;
        if (im.kind === 3) { out.set(d.subarray(0, out.length)); }
        else if (im.kind === 2) {
          for (let p = 0, q = 0; q < out.length; p += 3, q += 4) {
            out[q] = d[p]; out[q+1] = d[p+1]; out[q+2] = d[p+2]; out[q+3] = 255;
          }
        }
        if (im.kind === 2 || im.kind === 3) {
          ictx.putImageData(new ImageData(out, best.w, best.h), 0, 0);
          cleanCanvas = ic;
        }
      }
    }
  } catch {}

  let source: HTMLCanvasElement = cleanCanvas || pc;
  // No clean photo found but a half was requested → crop the page render.
  if (!cleanCanvas && (half === "left" || half === "right")) {
    const hw = Math.floor(pc.width / 2);
    const c = document.createElement("canvas");
    c.width = hw; c.height = pc.height;
    const cx = c.getContext("2d")!;
    cx.drawImage(pc, half === "left" ? 0 : (pc.width - hw), 0, hw, pc.height, 0, 0, hw, pc.height);
    source = c;
  }
  const cover = _scaleCanvas(source, 1200, 0.74);
  const thumb = _scaleCanvas(source, 600, 0.7);
  pc.width = pc.height = 0;
  if (cleanCanvas) { cleanCanvas.width = cleanCanvas.height = 0; }
  if (source !== pc && source !== cleanCanvas) { source.width = source.height = 0; }
  return { cover, thumb };
}

// Fast, image-only extraction for a leasing FLYER (a known marketing format):
// the cover is the big hero photo on page 1, and the site plan is the map graphic
// on page 2 — both large embedded images, pulled directly (cropped) without any
// AI text passes. Much faster than the generic OM path.
export async function extractFlyerImages(buffer: ArrayBuffer): Promise<{ cover: string | null; coverThumb: string | null; sitePlan: string[] }> {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: buffer }).promise;
  let cover: string | null = null, coverThumb: string | null = null;
  try { const c = await _capturePagePhoto(pdf, 1, lib); cover = c.cover; coverThumb = c.thumb; } catch {}
  const sitePlan: string[] = [];
  if (pdf.numPages >= 2) {
    try { const sp = await _captureSitePlan(pdf, 2, lib); if (sp) sitePlan.push(sp); } catch {}
  }
  return { cover, coverThumb, sitePlan };
}

// Crop a rendered canvas to the bounding box of its non-white content, trimming
// the surrounding page margins/whitespace. Returns the original if there's
// nothing meaningful to trim.
function _autoCropCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  try {
    const ctx = src.getContext("2d")!;
    const w = src.width, h = src.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
    const step = Math.max(1, Math.floor(Math.min(w, h) / 700)); // subsample for speed
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        if (data[i + 3] > 10 && (data[i] < 244 || data[i + 1] < 244 || data[i + 2] < 244)) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          found = true;
        }
      }
    }
    if (!found) return src;
    const pad = Math.round(Math.min(w, h) * 0.012);
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    if (cw <= 0 || ch <= 0 || (cw >= w * 0.97 && ch >= h * 0.97)) return src; // nothing to trim
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    c.getContext("2d")!.drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch);
    return c;
  } catch { return src; }
}

// Capture a SITE PLAN from a page: prefer the actual embedded site-plan graphic
// (a large placed raster — the marketing site plan), cleanly cropped. When the
// plan is drawn as vectors instead (no big embedded image), fall back to the page
// render auto-cropped to its content, so we never store a page of whitespace with
// a tiny plan in the corner.
export async function _captureSitePlan(pdf: any, pageNum: number, lib: any): Promise<string | null> {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1600 / base.width, 2.2);
  const viewport = page.getViewport({ scale });
  const pc = document.createElement("canvas");
  pc.width = Math.round(viewport.width);
  pc.height = Math.round(viewport.height);
  const pctx = pc.getContext("2d")!;
  pctx.fillStyle = "#ffffff";
  pctx.fillRect(0, 0, pc.width, pc.height);
  await page.render({ canvasContext: pctx, viewport }).promise; // also resolves image objects

  // Find the largest embedded raster image on the page.
  let best: { img: any; w: number; h: number } | null = null;
  let bestArea = 0;
  try {
    const OPS = lib.OPS;
    const opList = await page.getOperatorList();
    const names = new Set<string>();
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i], args = opList.argsArray[i];
      if ((fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) && typeof args[0] === "string") names.add(args[0]);
    }
    for (const name of names) {
      let img: any = null;
      try { img = page.objs.get(name); } catch { img = null; }
      if (!img) continue;
      const w = img.width || (img.bitmap && img.bitmap.width) || 0;
      const h = img.height || (img.bitmap && img.bitmap.height) || 0;
      if (w * h > bestArea) { bestArea = w * h; best = { img, w, h }; }
    }
  } catch {}

  // A large embedded image IS the site-plan graphic — extract it directly.
  if (best && best.w >= 500 && best.h >= 320) {
    const ic = document.createElement("canvas");
    ic.width = best.w; ic.height = best.h;
    const ictx = ic.getContext("2d")!;
    const im = best.img;
    let ok = false;
    if (im.bitmap) { ictx.drawImage(im.bitmap, 0, 0); ok = true; }
    else if (im.data) {
      const out = new Uint8ClampedArray(best.w * best.h * 4);
      const d = im.data;
      if (im.kind === 3) { out.set(d.subarray(0, out.length)); ok = true; }
      else if (im.kind === 2) {
        for (let p = 0, q = 0; q < out.length; p += 3, q += 4) { out[q] = d[p]; out[q + 1] = d[p + 1]; out[q + 2] = d[p + 2]; out[q + 3] = 255; }
        ok = true;
      }
      if (ok) ictx.putImageData(new ImageData(out, best.w, best.h), 0, 0);
    }
    if (ok) { const url = _scaleCanvas(ic, 1600, 0.82); ic.width = ic.height = 0; pc.width = pc.height = 0; return url; }
    ic.width = ic.height = 0;
  }

  // Vector site plan — auto-crop the page render to its content.
  const cropped = _autoCropCanvas(pc);
  const url = _scaleCanvas(cropped, 1500, 0.78);
  if (cropped !== pc) { cropped.width = cropped.height = 0; }
  pc.width = pc.height = 0;
  return url;
}

// Extract all text from a PDF file (ArrayBuffer), using position-aware line assembly.
export async function extractPdfText(buffer: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: buffer }).promise;
  const totalPages = pdf.numPages;
  const pagesToExtract = Math.min(totalPages, 120);
  let allText = "";

  for (let i = 1; i <= pagesToExtract; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Position-aware extraction: group by Y, sort by X, detect word gaps
    const lines: Record<number, { str: string; x: number; width: number }[]> = {};
    for (const item of content.items) {
      if (!(item as any).str) continue;
      const it = item as any;
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      if (!lines[y]) lines[y] = [];
      lines[y].push({ str: it.str, x, width: it.width || 0 });
    }

    const lineKeys = Object.keys(lines).map(Number).sort((a, b) => b - a);
    const lineTexts: string[] = [];
    for (const y of lineKeys) {
      const items = lines[y].sort((a, b) => a.x - b.x);
      if (!items.length) continue;
      const widths = items.map(it => it.width / Math.max(it.str.length, 1)).filter(w => w > 0);
      const avgCharWidth = widths.length ? widths.reduce((s, w) => s + w, 0) / widths.length : 4;
      const wordGap = avgCharWidth * 0.6;
      let lineText = items[0].str;
      for (let j = 1; j < items.length; j++) {
        const prev = items[j-1];
        const curr = items[j];
        const gap = curr.x - (prev.x + prev.width);
        lineText += (gap > wordGap) ? " " + curr.str : curr.str;
      }
      lineTexts.push(lineText);
    }
    allText += `\n--- Page ${i} ---\n${lineTexts.join("\n")}`;
  }

  if (allText.length > 180000) {
    allText = allText.slice(0, 120000) + "\n...[middle truncated]...\n" + allText.slice(-40000);
  }

  return { text: allText, pages: totalPages };
}

// Auto-detect cover + site plan pages from the PDF.
// Cover: extracted from largest embedded image on page 1.
// Site plan: auto-detected by keyword scan; falls back to page picker.
export async function extractPdfImages(buffer: ArrayBuffer): Promise<{
  cover: string | null;
  coverThumb: string | null;
  sitePlan: string[] | null;
  pagePicks: { page: number; img: string }[];
  needsSitePlanPick: boolean;
}> {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: buffer }).promise;

  const result = {
    cover: null as string | null,
    coverThumb: null as string | null,
    sitePlan: [] as string[],
    pagePicks: [] as { page: number; img: string }[],
    needsSitePlanPick: false,
  };

  // COVER ONLY (page 1) — fast and the single piece worth doing automatically.
  // The old AUTO site-plan detection (scanning dozens of pages for keywords, then
  // rendering up to ~14–24 full pages as picker thumbnails) ran on the browser's
  // main thread and was the cause of multi-minute "processing images" hangs on big
  // OMs. Per Eric's call, we no longer auto-hunt the site plan here: the user sets
  // one on demand via the deal page's "Site plan → Choose PDF & set / Upload image"
  // (which renders just the one chosen page). Keeps OM uploads fast and predictable.
  try {
    const c = await _capturePagePhoto(pdf, 1, lib);
    result.cover = c.cover;
    result.coverThumb = c.thumb;
  } catch {}

  // AUTO SITE-PLAN DETECTION (re-enabled per Eric). Bounded for speed: scan only the
  // FRONT ~40 pages (OM site plans always live in the first section) and DON'T render
  // the slow 24-page picker fallback — if nothing is detected we just leave it empty
  // for the user to set manually. The heavy part that caused old slowdowns is gone.
  try {
    const scanPages = Math.min(pdf.numPages, 40);
    const strong = /site\s*plan|site\s*map|leasing\s*plan|leasing\s*map|site\s*layout|plot\s*plan|lease\s*plan|overall\s*plan|parcel\s*map|tax\s*parcel|key\s*plan/i;
    const weak = /aerial|site\s*aerial|asset\s*overview/i;
    const toc = /table\s+of\s+contents/i;
    const sfLabel = /\b\d{1,3}(?:,\d{3})?\s*SF\b/gi;

    const pageTexts: Record<number, string> = {};
    const textPages = Array.from({ length: Math.max(0, scanPages - 1) }, (_, i) => i + 2);
    const TEXT_CONC = 6;
    for (let i = 0; i < textPages.length; i += TEXT_CONC) {
      await Promise.all(textPages.slice(i, i + TEXT_CONC).map(async p => {
        try {
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          pageTexts[p] = content.items.map((it: any) => it.str).join(" ");
        } catch {}
      }));
    }
    // Score each page: the real plan is dense with "<n> SF" tenant labels even when the
    // "Site Plan" title is baked into artwork; the TOC matches the keyword but isn't one.
    const score = (p: number) => {
      const t = pageTexts[p] || "";
      if (toc.test(t)) return 0;
      if (strong.test(t)) return 3;
      if ((t.match(sfLabel) || []).length >= 5) return 2;
      if (weak.test(t)) return 1;
      return 0;
    };
    const matches: number[] = [];
    for (let p = 2; p <= scanPages; p++) if (score(p) > 0) matches.push(p);
    matches.sort((a, b) => score(b) - score(a) || a - b);
    const chosen = matches.slice(0, 3).sort((a, b) => a - b);
    for (const p of chosen) {
      try {
        const img = await _captureSitePlan(pdf, p, lib);
        if (img) result.sitePlan.push(img);
      } catch {}
    }
  } catch {}

  return result;
}
