import * as XLSX from "xlsx";
import { extractPdfText } from "./pdfExtract";

export type SourceKind = "pdf" | "spreadsheet";

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

export function isSupportedUpload(file: File): boolean {
  return isPdf(file) || isSpreadsheet(file);
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
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
    if (csv.trim()) parts.push(`### SHEET: ${name}\n${csv}`);
  }
  return { text: parts.join("\n\n"), pages: wb.SheetNames.length, kind: "spreadsheet" };
}

/** Extract text from any supported upload (PDF or spreadsheet). */
export async function extractAnyFile(file: File): Promise<ExtractedFile> {
  if (isSpreadsheet(file)) return extractSpreadsheetText(file);
  const { text, pages } = await extractPdfText(await file.arrayBuffer());
  return { text, pages, kind: "pdf" };
}
