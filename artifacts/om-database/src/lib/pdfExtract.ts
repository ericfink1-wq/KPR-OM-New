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

// Extract all text from a PDF file (ArrayBuffer)
export async function extractPdfText(buffer: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: any) => item.str).join(" "));
  }
  return { text: pages.join("\n\n"), pages: pdf.numPages };
}

// Capture a page as a canvas image (for cover photo / site plan)
export async function _capturePagePhoto(
  pdf: any,
  pageNum: number,
  lib: any,
  half: "full" | "left" | "right" = "full"
): Promise<{ cover: string | null; thumb: string | null }> {
  const page = await pdf.getPage(pageNum);
  const scale = 1.8;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const w = Math.round(viewport.width);
  const h = Math.round(viewport.height);
  const halfW = Math.round(w / 2);
  canvas.width = half === "full" ? w : halfW;
  canvas.height = h;
  if (half === "right") ctx.translate(-halfW, 0);
  await page.render({ canvasContext: ctx, viewport }).promise;

  const cover = canvas.toDataURL("image/jpeg", 0.85);

  // Thumbnail
  const thumbCanvas = document.createElement("canvas");
  const tw = 320, th = Math.round(320 * h / (half === "full" ? w : halfW));
  thumbCanvas.width = tw; thumbCanvas.height = th;
  const tctx = thumbCanvas.getContext("2d")!;
  tctx.drawImage(canvas, 0, 0, tw, th);
  const thumb = thumbCanvas.toDataURL("image/jpeg", 0.72);

  return { cover, thumb };
}

// Auto-detect cover + site plan pages from the PDF
export async function extractPdfImages(buffer: ArrayBuffer): Promise<{
  cover: string | null;
  coverThumb: string | null;
  sitePlan: string[] | null;
  pagePicks: { page: number; img: string }[];
  needsSitePlanPick: boolean;
}> {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: buffer }).promise;

  // Cover = page 1
  const coverRes = await _capturePagePhoto(pdf, 1, lib, "full");

  // Site plan heuristics — scan up to 30 pages
  const scanPages = Math.min(pdf.numPages, 30);
  const candidates: { page: number; img: string; score: number }[] = [];

  for (let i = 2; i <= scanPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item: any) => item.str.toLowerCase()).join(" ");
    const hasPlanKeyword = /site plan|aerial|layout|parcel|plat|footprint/.test(text);
    const hasLowText = content.items.length < 60;

    if (hasPlanKeyword || hasLowText) {
      const scale = 0.6;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
      const img = canvas.toDataURL("image/jpeg", 0.65);
      const score = (hasPlanKeyword ? 2 : 0) + (hasLowText ? 1 : 0);
      candidates.push({ page: i, img, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const isConfident = top && top.score >= 2;

  if (isConfident) {
    const sitePlanFull = await _capturePagePhoto(pdf, top.page, lib, "full");
    return {
      cover: coverRes.cover,
      coverThumb: coverRes.thumb,
      sitePlan: sitePlanFull.cover ? [sitePlanFull.cover] : null,
      pagePicks: [],
      needsSitePlanPick: false,
    };
  }

  // Not confident — return picks for manual selection (top 6 candidates)
  const picks = candidates.slice(0, 6).map(c => ({ page: c.page, img: c.img }));
  return {
    cover: coverRes.cover,
    coverThumb: coverRes.thumb,
    sitePlan: null,
    pagePicks: picks,
    needsSitePlanPick: picks.length > 0,
  };
}
