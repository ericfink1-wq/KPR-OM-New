import * as XLSX from "xlsx";
import { extractPdfText } from "./pdfExtract";
import { MAMMOTH_CDN } from "./constants";

export type SourceKind = "pdf" | "spreadsheet" | "word";

export interface ExtractedFile {
  text: string;
  pages: number;     // PDF page count, or sheet count for spreadsheets
  kind: SourceKind;
}

const SPREADSHEET_RE = /\.(xlsx|xlsm|xlsb|xls|csv)$/i;

export function isSpreadsheet(file: File): boolean {
  return SPREADSHEET_RE.test(file.name) ||
    file.type.includes("spreadsheet") ||
    file.type === "text/csv" ||
    file.type === "application/vnd.ms-excel";
}

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

// Word: only the modern .docx (zip/XML) is readable in-browser via mammoth. The old
// binary .doc is NOT — isWordLegacy lets callers give a clear "re-save as PDF/.docx"
// message instead of a confusing failure.
export function isWord(file: File): boolean {
  return /\.docx$/i.test(file.name) ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}
export function isWordLegacy(file: File): boolean {
  return /\.doc$/i.test(file.name) || file.type === "application/msword";
}

export function isSupportedUpload(file: File): boolean {
  return isPdf(file) || isSpreadsheet(file) || isWord(file);
}

// Read a Word .docx into plain text. mammoth is loaded on demand from CDN (the
// browser build sets window.mammoth), so a normal upload never pays for it.
let mammothLib: any = null;
async function loadMammoth(): Promise<any> {
  if (mammothLib) return mammothLib;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = MAMMOTH_CDN;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load the Word reader"));
    document.head.appendChild(s);
  });
  mammothLib = (window as any).mammoth;
  if (!mammothLib) throw new Error("Word reader did not load");
  return mammothLib;
}

async function extractWordText(file: File): Promise<ExtractedFile> {
  const m = await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result = await m.extractRawText({ arrayBuffer });
  return { text: (result?.value || "").trim(), pages: 1, kind: "word" };
}

// Read an Excel/CSV file into plain text the AI extractors can consume. Every
// sheet is rendered as CSV with a header line, so rent rolls / sales reports
// that arrive as spreadsheets flow through the same prompts as PDFs.
async function extractSpreadsheetText(file: File): Promise<ExtractedFile> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const raw = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
    // Trim trailing empty cells (rent rolls / MRI exports carry many blank columns
    // past the data) and drop rows left empty — ~14% less text, zero data loss, so
    // more of a large workbook fits before truncation and the extractor wastes fewer
    // tokens on commas.
    const csv = raw.split("\n").map((line) => line.replace(/,+\s*$/, "")).filter((line) => line.trim() !== "").join("\n");
    if (csv.trim()) parts.push(`### SHEET: ${name}\n${csv}`);
  }
  return { text: parts.join("\n\n"), pages: wb.SheetNames.length, kind: "spreadsheet" };
}

/** Extract text from any supported upload (PDF, spreadsheet, or Word .docx). */
export async function extractAnyFile(file: File): Promise<ExtractedFile> {
  if (isSpreadsheet(file)) return extractSpreadsheetText(file);
  if (isWord(file)) return extractWordText(file);
  if (isWordLegacy(file)) throw new Error("Old Word .doc files can't be read directly — please re-save it as a PDF or .docx and try again.");
  const { text, pages } = await extractPdfText(await file.arrayBuffer());
  return { text, pages, kind: "pdf" };
}
