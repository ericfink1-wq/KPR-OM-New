// PDF.js extraction utilities — loaded dynamically from CDN
import { PDF_JS_CDN, PDF_JS_WORKER, TESSERACT_CDN } from "./constants";

let pdfJsLib: unknown = null;
let tesseractLib: any = null;

// Load Tesseract.js (OCR) from CDN on demand — only when a PDF turns out to be
// scanned/image-based. No account / API key / per-page cost; runs in a web worker.
async function loadTesseract(): Promise<any> {
  if (tesseractLib) return tesseractLib;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TESSERACT_CDN;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Tesseract.js"));
    document.head.appendChild(s);
  });
  tesseractLib = (window as any).Tesseract;
  if (!tesseractLib) throw new Error("Tesseract.js did not load");
  return tesseractLib;
}

// OCR a scanned PDF's pages and return the recovered text. Renders each page to a
// JPEG (reusing the existing page renderer) and runs it through one reused Tesseract
// worker. Bounded for time/memory — OCR is ~1–3s/page, so a hard page cap keeps a
// huge scanned OM from running for many minutes. Best-effort: a page that fails is
// skipped, never throwing.
async function ocrPdfPages(
  pdf: any,
  pageCount: number,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const T = await loadTesseract();
  const maxPages = Math.min(pageCount, 60);
  const worker = await T.createWorker("eng");
  let out = "";
  try {
    for (let i = 1; i <= maxPages; i++) {
      let img: string;
      try { img = await _renderPdfPage(pdf, i, 1700, 0.9); } catch { continue; }
      try {
        const { data } = await worker.recognize(img);
        const txt = (data?.text || "").trim();
        if (txt) out += `\n--- Page ${i} (OCR) ---\n${txt}`;
      } catch { /* skip this page */ }
      onProgress?.(i, maxPages);
    }
  } finally {
    try { await worker.terminate(); } catch { /* ignore */ }
  }
  return out;
}

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
    const minW = half === "full" ? 560 : 360;
    const minH = half === "full" ? 360 : 240;
    let best: { img: any; w: number; h: number } | null = null;
    let bestScore = -Infinity;
    for (const it of found) {
      if (half === "left" && it.cx > halfBound) continue;
      if (half === "right" && it.cx < halfBound) continue;
      let img: any = null;
      try { img = page.objs.get(it.name); } catch { img = null; }
      if (!img) continue;
      const w = img.width || (img.bitmap && img.bitmap.width) || 0;
      const h = img.height || (img.bitmap && img.bitmap.height) || 0;
      if (w < minW || h < minH) continue;
      // Rank by PHOTOGRAPHIC quality, not raw size: a tenant-logo collage is often
      // the BIGGEST image on the page yet mostly white, while the real building photo
      // sits next to it slightly smaller. Photo score dominates; area breaks ties.
      const score = _imagePhotoScore(img) * 1e6 + w * h;
      if (score > bestScore) { bestScore = score; best = { img, w, h }; }
    }
    if (best) {
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
  // Even on a marketing flyer the hero photo isn't always page 1's largest image —
  // some lead with a tenant-LOGO collage. Pick the genuinely photographic page.
  try { const cp = await _pickCoverPage(pdf, lib); const c = await _capturePagePhoto(pdf, cp, lib); cover = c.cover; coverThumb = c.thumb; } catch {}
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

  // Site plans are COMPOSED pages — an aerial/base layer with vector building
  // outlines, color fills, labels and (very often) image MASKS layered on top.
  // Pulling the "largest embedded image" grabbed the wrong object: usually a 1-bpp
  // stencil mask (which decodes to white blobs on a black field — the "weird" image
  // we were storing), or at best the bare aerial background with no labels. The real
  // site plan is the COMPOSED page render (exactly what you see in the PDF), so we
  // render the page and auto-crop it to its content. (Same lesson cover photos
  // already learned via preferPageRender.)
  const cropped = _autoCropCanvas(pc);
  const url = _scaleCanvas(cropped, 1600, 0.82);
  if (cropped !== pc) { cropped.width = cropped.height = 0; }
  pc.width = pc.height = 0;
  return url;
}

// Extract all text from a PDF file (ArrayBuffer), using position-aware line assembly.
export async function extractPdfText(buffer: ArrayBuffer): Promise<{ text: string; pages: number; ocrUsed?: boolean }> {
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

  // AUTOMATIC OCR FALLBACK. If the native text layer is essentially empty, the PDF
  // is scanned / image-based (its rent roll, financials, etc. won't read). Render the
  // pages and OCR them to recover the text. Measures content excluding the per-page
  // markers; a text PDF runs thousands of chars/page, a scan ~0. Best-effort — if OCR
  // fails or yields less than the native text, we keep the native text.
  let ocrUsed = false;
  const contentLen = allText.replace(/\n--- Page \d+ ---\n?/g, "").trim().length;
  const perPage = pagesToExtract > 0 ? contentLen / pagesToExtract : contentLen;
  if (pagesToExtract >= 1 && perPage < 200) {
    try {
      const ocrText = await ocrPdfPages(pdf, pagesToExtract);
      if (ocrText.replace(/\n--- Page \d+ \(OCR\) ---\n?/g, "").trim().length > contentLen) {
        allText = ocrText;
        ocrUsed = true;
      }
    } catch { /* OCR is best-effort; fall back to the native text layer */ }
  }

  if (allText.length > 180000) {
    allText = allText.slice(0, 120000) + "\n...[middle truncated]...\n" + allText.slice(-40000);
  }

  return { text: allText, pages: totalPages, ocrUsed };
}

// Decode a pdf.js image object to a canvas (handles RGBA bitmaps and the kind 2/3
// raw-buffer cases). Used only to SAMPLE a candidate cover image's pixels; returns
// null when the image can't be decoded cheaply.
function _imageObjToCanvas(im: any): HTMLCanvasElement | null {
  const w = im?.width || (im?.bitmap && im.bitmap.width) || 0;
  const h = im?.height || (im?.bitmap && im.bitmap.height) || 0;
  if (!w || !h) return null;
  const ic = document.createElement("canvas");
  ic.width = w; ic.height = h;
  const ictx = ic.getContext("2d");
  if (!ictx) return null;
  try {
    if (im.bitmap) { ictx.drawImage(im.bitmap, 0, 0); return ic; }
    if (im.data && (im.kind === 2 || im.kind === 3)) {
      const out = new Uint8ClampedArray(w * h * 4);
      const d = im.data;
      if (im.kind === 3) { out.set(d.subarray(0, out.length)); }
      else { for (let p = 0, q = 0; q < out.length; p += 3, q += 4) { out[q]=d[p]; out[q+1]=d[p+1]; out[q+2]=d[p+2]; out[q+3]=255; } }
      ictx.putImageData(new ImageData(out, w, h), 0, 0);
      return ic;
    }
  } catch {}
  return null;
}

// Tell a photographic hero shot apart from a logo/brand collage or title page.
// Samples a grid of pixels: a property photo has a LOW near-white fraction and HIGH
// tonal variety; a logo montage sits on white with only a handful of flat colors.
function _photoMetrics(cnv: HTMLCanvasElement): { whiteFrac: number; variety: number } {
  const w = cnv.width, h = cnv.height;
  const ctx = cnv.getContext("2d");
  if (!ctx || !w || !h) return { whiteFrac: 1, variety: 0 };
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(0, 0, w, h).data; } catch { return { whiteFrac: 1, variety: 0 }; }
  const buckets = new Set<number>();
  let white = 0, n = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 2500)));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
      n++;
      if (a < 16 || (r > 244 && g > 244 && b > 244)) { white++; continue; }
      buckets.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)); // 12-bit color bucket
    }
  }
  if (!n) return { whiteFrac: 1, variety: 0 };
  return { whiteFrac: white / n, variety: buckets.size / n };
}

// Photographic-quality score for ONE embedded image: high for a real photo/aerial,
// 0 for a logo/brand collage or line-art (mostly white, or very few flat colors).
// This is the discriminator that keeps the cover from landing on a tenant-logo grid.
function _imagePhotoScore(im: any): number {
  const cnv = _imageObjToCanvas(im);
  if (!cnv) return -1; // undecodable — treat as "unknown", below any real photo
  const { whiteFrac, variety } = _photoMetrics(cnv);
  cnv.width = cnv.height = 0;
  if (whiteFrac > 0.7 || variety < 0.02) return 0; // logo collage / flat art
  return (1 - whiteFrac) * 120 + variety * 240;
}

// Choose the best COVER page from the first few pages. OMs and flyers frequently put
// the building/aerial hero photo on the SAME page as a tenant-LOGO collage (and the
// collage is often the bigger image), or behind a title page — so blindly taking
// page 1's largest image grabs the wrong thing (Eric: "flyers pull the wrong cover").
// We score every sizable image on each page by photographic quality and pick the page
// holding the single best real photo. Falls back to page 1 when nothing on the first
// pages reads as a photo (preserves the old behavior).
async function _pickCoverPage(pdf: any, lib: any): Promise<number> {
  const OPS = lib.OPS;
  const maxScan = Math.min(pdf.numPages, 6);
  let bestPage = 1, bestScore = -Infinity, anyPhoto = false;
  for (let pageNum = 1; pageNum <= maxScan; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      // A small render forces pdf.js to decode/resolve the page's image objects so
      // page.objs.get(name) returns real bitmaps below.
      const vp = page.getViewport({ scale: 0.4 });
      const tc = document.createElement("canvas");
      tc.width = Math.max(1, Math.round(vp.width));
      tc.height = Math.max(1, Math.round(vp.height));
      const tctx = tc.getContext("2d");
      if (tctx) { tctx.fillStyle = "#ffffff"; tctx.fillRect(0, 0, tc.width, tc.height); await page.render({ canvasContext: tctx, viewport: vp }).promise; }
      tc.width = tc.height = 0;

      const opList = await page.getOperatorList();
      const names: string[] = [];
      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
          const a = opList.argsArray[i][0];
          if (typeof a === "string") names.push(a);
        }
      }
      // Best PHOTOGRAPHIC image on the page (not the largest) — mirrors the selection
      // _capturePagePhoto uses, so the page we pick is the page it will capture from.
      let pagePhoto = 0, pageAspect = 0;
      for (const nm of names) {
        let img: any = null;
        try { img = page.objs.get(nm); } catch { img = null; }
        if (!img) continue;
        const w = img.width || (img.bitmap && img.bitmap.width) || 0;
        const h = img.height || (img.bitmap && img.bitmap.height) || 0;
        if (w < 560 || h < 360) continue; // same min as a full-page cover capture
        const ps = _imagePhotoScore(img);
        if (ps > pagePhoto) { pagePhoto = ps; pageAspect = w / h; }
      }
      if (pagePhoto <= 0) continue; // no real photo on this page
      anyPhoto = true;
      const aspectBonus = pageAspect >= 1.1 && pageAspect <= 2.4 ? 20 : (pageAspect < 0.8 || pageAspect > 3 ? -40 : 0);
      const frontBonus = pageNum <= 2 ? (3 - pageNum) * 4 : 0; // tiebreak toward the front
      const score = pagePhoto + aspectBonus + frontBonus;
      if (score > bestScore) { bestScore = score; bestPage = pageNum; }
    } catch {}
  }
  return anyPhoto ? bestPage : 1;
}

// Choose the SITE-PLAN page(s) from the front-section page texts. OM site plans sit on
// ONE page ~95% of the time, yet the old logic captured the top THREE scoring pages —
// so the real plan came back bundled with whatever else was nearby and SF-label-heavy:
// the rent roll, the lease-expiration schedule, the tenant summary, an aerial. This
// returns the SINGLE best page (and at most a genuine adjacent strong-titled spread),
// and it rejects the look-alikes:
//   • the table of contents (matches "site plan" but is a list, not the plan);
//   • rent rolls / lease-expiration / financial TABLES (full of "<n> SF" tokens but
//     hundreds of text items — a table, not a diagram);
//   • narrative pages that merely mention the site plan.
// Each candidate carries its text AND its text-ITEM count — a diagram has a handful of
// labels, a rent-roll table has hundreds — so a graphic plan outranks an SF-heavy table.
export function pickSitePlanPages(
  pages: { page: number; text: string; itemCount: number }[],
): number[] {
  const strong = /site\s*plan|site\s*map|leasing\s*plan|leasing\s*map|site\s*layout|plot\s*plan|lease\s*plan|overall\s*plan|parcel\s*map|tax\s*parcel|key\s*plan/i;
  const weak = /aerial|site\s*aerial|asset\s*overview/i;
  const toc = /table\s+of\s+contents/i;
  // Pages full of "SF" labels that are really TABLES/financials, not a plan.
  const tableLike = /rent\s*roll|lease\s*expiration|expiration\s*report|rent\s*schedule|cash\s*flow|operating\s*statement|income\s*statement|tenant\s*sales|debt\s*service|argus|amortization/i;
  const sfLabel = /\b\d{1,3}(?:,\d{3})?\s*SF\b/gi;

  // TITLE CHECK (first, and strongest — Eric's rule): the real site-plan page is
  // LABELED "Site Plan" as a page title at the top (or a running header), not just
  // mentioned in prose. A title = the strong keyword appears at/near the START of the
  // page text and is NOT embedded in a sentence ("the site plan on the following
  // page…"). We allow a property-name running header before it ("TRUSSVILLE
  // PROMENADE  SITE PLAN …") but reject a lowercase article/verb lead-in.
  const TITLE_ZONE = 80;
  const proseLead = /\b(the|a|an|see|our|this|these|its|their|refer|following|below|above|on|to|as|per|for|of|in|at|and|shows?|depicts?|illustrat)\s+$/i;
  const isTitled = (text: string): boolean => {
    const zone = text.slice(0, TITLE_ZONE);
    const m = zone.match(strong);
    if (!m || m.index == null) return false;
    return !proseLead.test(zone.slice(0, m.index));
  };

  const scoreOf = (text: string, itemCount: number): { s: number; strongHit: boolean } => {
    if (toc.test(text)) return { s: 0, strongHit: false };
    const strongHit = strong.test(text);
    // A rent roll / lease-expiration / financial table is never a site plan, even when
    // it's full of "SF" labels — unless the page is explicitly titled a site/leasing plan.
    if (tableLike.test(text) && !strongHit) return { s: 0, strongHit: false };
    const sfCount = (text.match(sfLabel) || []).length;
    let s = 0;
    if (isTitled(text)) {
      // TITLED "Site Plan" — the highest-confidence signal. Dominates a page that
      // merely mentions the plan in prose, and a graphic-but-untitled page.
      s = 200;
    } else if (strongHit && sfCount >= 3) {
      // Not titled at the top, but carries the keyword AND suite-SF labels — a real
      // plan whose title just wasn't first in the text stream. A bare keyword mention
      // with NO SF labels ("see the site plan below") is a reference/divider, not a
      // plan, and scores nothing.
      s = 100;
    } else if (sfCount >= 6 && itemCount <= 220) {
      s = 50; // SF-dense GRAPHIC page (suite labels on a diagram), not a big table
    } else if (weak.test(text)) {
      s = 20; // bare "aerial" — weak signal
    }
    if (s <= 0) return { s: 0, strongHit };
    // Among comparable pages prefer the most graphic one: fewer text items = more
    // diagram-like, so the actual plan beats a narrative that merely mentions it.
    s -= Math.min(itemCount, 600) * 0.05;
    return { s, strongHit };
  };

  const scored = pages
    .map(p => ({ page: p.page, ...scoreOf(p.text, p.itemCount) }))
    .filter(p => p.s > 0)
    .sort((a, b) => b.s - a.s || a.page - b.page);
  if (!scored.length) return [];
  const best = scored[0];
  const chosen = [best.page];
  // Allow a genuine TWO-PAGE spread: an ADJACENT page that is ALSO strong-titled and
  // scores close to the winner (a deliberate "Site Plan" spread). Otherwise one page.
  if (best.strongHit) {
    const neighbor = scored.find(
      p => p.strongHit && Math.abs(p.page - best.page) === 1 && p.s >= best.s - 15,
    );
    if (neighbor) chosen.push(neighbor.page);
  }
  return chosen.sort((a, b) => a - b);
}

// Auto-detect cover + site plan pages from the PDF.
// Cover: best photographic page among the first few (see _pickCoverPage).
// Site plan: single best page by keyword/graphic scan (see pickSitePlanPages).
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
    const coverPage = await _pickCoverPage(pdf, lib);
    const c = await _capturePagePhoto(pdf, coverPage, lib);
    result.cover = c.cover;
    result.coverThumb = c.thumb;
  } catch {}

  // AUTO SITE-PLAN DETECTION. Scan only the FRONT ~40 pages (OM site plans always live
  // in the first section) for speed. Pick the SINGLE best site-plan page via the pure
  // pickSitePlanPages (below) — this fixed the old "captures the plan plus a couple of
  // neighboring pages" behavior, which took the top THREE scoring pages and so bundled
  // the rent roll / lease-expiration schedule / aerial that sit near the real plan.
  try {
    const scanPages = Math.min(pdf.numPages, 40);
    const pages: { page: number; text: string; itemCount: number }[] = [];
    const textPages = Array.from({ length: Math.max(0, scanPages - 1) }, (_, i) => i + 2);
    const TEXT_CONC = 6;
    for (let i = 0; i < textPages.length; i += TEXT_CONC) {
      await Promise.all(textPages.slice(i, i + TEXT_CONC).map(async p => {
        try {
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          pages.push({ page: p, text: content.items.map((it: any) => it.str).join(" "), itemCount: content.items.length });
        } catch {}
      }));
    }
    for (const p of pickSitePlanPages(pages)) {
      try {
        const img = await _captureSitePlan(pdf, p, lib);
        if (img) result.sitePlan.push(img);
      } catch {}
    }
  } catch {}

  return result;
}
