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

// Capture a clean property photo from a page: extract the largest EMBEDDED image
// (the actual photo) rather than screenshotting the page, which strips the broker
// logos and text that are layered on top. Tracks the transform matrix so it can
// pick the largest photo on a chosen `half` ("full"|"left"|"right") of a two-page
// spread. Falls back to a (optionally half-cropped) page render. Returns {cover,thumb}.
export async function _capturePagePhoto(
  pdf: any,
  pageNum: number,
  lib: any,
  half: "full" | "left" | "right" = "full"
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
  const thumb = _scaleCanvas(source, 168, 0.5);
  pc.width = pc.height = 0;
  if (cleanCanvas) { cleanCanvas.width = cleanCanvas.height = 0; }
  if (source !== pc && source !== cleanCanvas) { source.width = source.height = 0; }
  return { cover, thumb };
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
  const pagesToExtract = Math.min(pdf.numPages, 120);

  const result = {
    cover: null as string | null,
    coverThumb: null as string | null,
    sitePlan: [] as string[],
    pagePicks: [] as { page: number; img: string }[],
    needsSitePlanPick: false,
  };

  // Cover: extract embedded image from page 1
  try {
    const c = await _capturePagePhoto(pdf, 1, lib);
    result.cover = c.cover;
    result.coverThumb = c.thumb;
  } catch {}

  // Site plan: scan page text with strong/weak keyword sets
  try {
    const strong = /site\s*plan|site\s*map|leasing\s*plan|leasing\s*map|site\s*layout|plot\s*plan|lease\s*plan|overall\s*plan|parcel\s*map|tax\s*parcel|key\s*plan/i;
    const weak = /aerial|site\s*aerial|asset\s*overview/i;

    // Collect per-page text for scoring
    const pageTexts: Record<number, string> = {};
    for (let p = 2; p <= pagesToExtract; p++) {
      try {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        pageTexts[p] = content.items.map((it: any) => it.str).join(" ");
      } catch {}
    }

    const score = (p: number) => {
      const t = pageTexts[p] || "";
      if (strong.test(t)) return 2;
      if (weak.test(t)) return 1;
      return 0;
    };

    const matches: number[] = [];
    for (let p = 2; p <= pagesToExtract; p++) {
      if (score(p) > 0) matches.push(p);
    }
    matches.sort((a, b) => score(b) - score(a) || a - b);
    const chosen = matches.slice(0, 3).sort((a, b) => a - b);

    for (const p of chosen) {
      try {
        const img = await _renderPdfPage(pdf, p, 1500, 0.74);
        if (img) result.sitePlan.push(img);
      } catch {}
    }

    // No site plan found → render page thumbnails for manual pick
    if (result.sitePlan.length === 0) {
      const limit = Math.min(pagesToExtract, 24);
      for (let p = 1; p <= limit; p++) {
        try {
          const thumb = await _renderPdfPage(pdf, p, 900, 0.6);
          if (thumb) result.pagePicks.push({ page: p, img: thumb });
        } catch {}
      }
      if (result.pagePicks.length) result.needsSitePlanPick = true;
    }
  } catch {}

  return result;
}
