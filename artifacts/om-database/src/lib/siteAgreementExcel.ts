// Styled REA / site-agreement Excel export (ExcelJS) — mirrors Eric's
// "Rockaway - REA & Easements - Updated 5-19-26.xlsx" reference workbook:
//   • Sheet 1 "REA & Easements" — the summary index: one lead row per agreement
//     (#, Document Name, Property, Parties, Purpose, Comments, Abstract Yes/No),
//     with the rest of each agreement's document chain as indented sub-rows.
//   • One detailed tab per agreement with the full abstract.
// Same look/quality as the tenant lease-abstract export (lib/abstractExcel.ts).

import ExcelJS from "exceljs";
import type { SiteAgreement } from "./idb";

const INK = "FF383A37", SUB = "FF6F6A5F", FAINT = "FFA69E91";
const SECTION_FILL = "FFEFE8DA", HEADER_FILL = "FFF3EEE3", LINE = "FFD8CFBD";
const thin = { style: "thin" as const, color: { argb: LINE } };
const boxBorder = { top: thin, left: thin, bottom: thin, right: thin };

function asList(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).filter(Boolean);
  if (typeof v === "string") return v.trim() ? [v] : [];
  return [];
}
function sv(v: unknown): string { return v == null ? "" : String(v); }
const today = () => new Date().toISOString().slice(0, 10);

function typeLabel(t?: string | null): string {
  const map: Record<string, string> = {
    operating_agreement: "Operating Agreement",
    reciprocal_easement_OEA: "OEA / Reciprocal Easement",
    pad_declaration: "Pad Declaration",
    maintenance_easement: "Maintenance / Cost-share",
    use_restriction: "Use Restriction",
    developer_agreement: "Developer Agreement",
    drainage_easement: "Drainage Easement",
    utility_easement: "Utility Easement",
    other: "Other",
  };
  return (t && map[t]) || (t ? String(t) : "Agreement");
}

// First 1-2 sentences of the summary — the "Purpose" column stays concise like the reference.
function purposeOf(a: SiteAgreement): string {
  const s = (a.summary || "").trim();
  if (!s) return a.materialityAssessment || "";
  const parts = s.split(/(?<=[.!?])\s+/);
  return parts.slice(0, 2).join(" ");
}
function commentsOf(a: SiteAgreement): string {
  const bits: string[] = [];
  if (a.materialityAssessment) bits.push(a.materialityAssessment);
  const topFlag = [...(a.flags ?? [])].sort((x, y) => sevRank(x.severity) - sevRank(y.severity))[0];
  if (topFlag && sevRank(topFlag.severity) <= 1 && topFlag.issue) bits.push(`Flag: ${topFlag.issue}`);
  if (a.verifiedAgainstExecutedDoc === false) bits.push("Unverified against executed doc — see flags.");
  return bits.join("  •  ");
}
function sevRank(s?: string | null): 0 | 1 | 2 {
  const v = (s || "info").toLowerCase();
  if (v === "critical" || v === "high") return 0;
  if (v === "watch" || v === "warn" || v === "medium") return 1;
  return 2;
}
// "Yes" unless the agreement is boilerplate (matches the reference's Abstract column intent).
function abstractYesNo(a: SiteAgreement): string {
  return /^\s*boilerplate/i.test(a.materialityAssessment || "") ? "No" : "Yes";
}
function leadDocName(a: SiteAgreement): string {
  const chain = a.documentChain ?? [];
  return (chain[0]?.name && String(chain[0].name)) || a.agreementName;
}
function chainSubDocs(a: SiteAgreement): string[] {
  const chain = a.documentChain ?? [];
  const rest = chain.slice(1).map((d) => [d.name, d.date, d.recording, d.role].filter(Boolean).join(" · ")).filter(Boolean);
  if (rest.length) return rest;
  // fall back to source documents if no real chain
  return (a.sourceDocuments ?? []).slice(1).map((d) => [d.name, d.date].filter(Boolean).join(" · ")).filter(Boolean);
}

const SUMMARY_COLS = [6, 52, 18, 34, 40, 40, 11]; // #, Document Name, Property, Parties, Purpose, Comments, Abstract
const SUMMARY_HEADERS = ["#", "Document Name", "Property", "Parties", "Purpose", "Comments", "Abstract"];

function bumpHeight(ws: ExcelJS.Worksheet, row: number, text: string, colWidthTotal: number) {
  const perLine = Math.max(8, colWidthTotal * 0.92);
  let lines = 0;
  for (const seg of String(text || "").split("\n")) lines += Math.max(1, Math.ceil((seg.length || 1) / perLine));
  const h = Math.max(15, Math.min(lines, 40) * 14);
  const cur = ws.getRow(row).height || 0;
  if (h > cur) ws.getRow(row).height = h;
}

function writeSummary(ws: ExcelJS.Worksheet, dealName: string, agreements: SiteAgreement[]): void {
  ws.columns = SUMMARY_COLS.map((w) => ({ width: w }));
  // Title
  ws.mergeCells(1, 1, 1, SUMMARY_COLS.length);
  ws.getCell(1, 1).value = `REA & Easements — ${dealName}`;
  ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: INK } };
  // Header
  const hr = 3;
  SUMMARY_HEADERS.forEach((h, i) => {
    const c = ws.getCell(hr, i + 1);
    c.value = h;
    c.font = { bold: true, size: 10, color: { argb: INK } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    c.alignment = { vertical: "middle", wrapText: true };
    c.border = boxBorder;
  });
  ws.getRow(hr).height = 18;
  ws.views = [{ state: "frozen", ySplit: hr, xSplit: 0 }];

  let r = hr + 1;
  agreements.forEach((a, idx) => {
    const vals = [
      String(idx + 1),
      leadDocName(a),
      sv(a.center),
      asList(a.parties).join("; "),
      purposeOf(a),
      commentsOf(a),
      abstractYesNo(a),
    ];
    vals.forEach((v, ci) => {
      const cell = ws.getCell(r, ci + 1);
      cell.value = v === "" ? null : v;
      cell.alignment = { wrapText: true, vertical: "top", horizontal: ci === 0 || ci === 6 ? "center" : "left" };
      cell.font = { size: 9.5, color: { argb: ci === 1 ? INK : SUB }, bold: ci === 1 };
      cell.border = boxBorder;
    });
    const longest = Math.max(vals[1].length / 1.4, vals[3].length / 1.2, vals[4].length / 1.2, vals[5].length / 1.2);
    bumpHeight(ws, r, "x".repeat(Math.round(longest)), 40);
    r += 1;
    // Document-chain sub-rows (Document Name column only, indented).
    for (const sub of chainSubDocs(a)) {
      const cell = ws.getCell(r, 2);
      cell.value = `      ${sub}`;
      cell.alignment = { wrapText: true, vertical: "top" };
      cell.font = { size: 9, italic: true, color: { argb: SUB } };
      for (let c = 1; c <= SUMMARY_COLS.length; c++) ws.getCell(r, c).border = boxBorder;
      bumpHeight(ws, r, sub, 52);
      r += 1;
    }
  });
}

function writeDetailTab(ws: ExcelJS.Worksheet, a: SiteAgreement): void {
  const W = 110; // single wide content column (B); A is a narrow label gutter
  ws.columns = [{ width: 26 }, { width: W }];
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];
  let r = 1;

  const title = (t: string) => {
    ws.mergeCells(r, 1, r, 2);
    const c = ws.getCell(r, 1); c.value = t; c.font = { bold: true, size: 13, color: { argb: INK } };
    r += 2;
  };
  const section = (t: string) => {
    ws.mergeCells(r, 1, r, 2);
    const c = ws.getCell(r, 1); c.value = t;
    c.font = { bold: true, size: 10.5, color: { argb: INK } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL } };
    ws.getRow(r).height = 16; r += 1;
  };
  const kv = (label: string, value: string) => {
    if (!value) return;
    ws.getCell(r, 1).value = label; ws.getCell(r, 1).font = { color: { argb: SUB }, size: 10 };
    const c = ws.getCell(r, 2); c.value = value;
    c.alignment = { wrapText: true, vertical: "top" }; c.font = { color: { argb: INK }, size: 10 };
    bumpHeight(ws, r, value, W); r += 1;
  };
  const bullets = (label: string, items: string[]) => {
    if (!items.length) return;
    section(label);
    for (const it of items) {
      ws.mergeCells(r, 1, r, 2);
      const c = ws.getCell(r, 1); c.value = `•  ${it}`;
      c.alignment = { wrapText: true, vertical: "top" }; c.font = { color: { argb: INK }, size: 10 };
      bumpHeight(ws, r, it, W + 26); r += 1;
    }
    r += 1;
  };

  title(a.agreementName);
  section("Overview");
  kv("Center / property", sv(a.center));
  kv("Type", typeLabel(a.type));
  kv("Effective term", sv(a.effectiveTerm));
  kv("Runs with land", a.runsWithLand == null ? "" : a.runsWithLand ? "Yes" : "No");
  kv("Parcels covered", sv(a.parcelsCovered));
  kv("Parties", asList(a.parties).join("; "));
  kv("Materiality", sv(a.materialityAssessment));
  kv("Verified vs executed doc", a.verifiedAgainstExecutedDoc === false ? "NO — see flags" : a.verifiedAgainstExecutedDoc ? "Yes" : "");
  r += 1;

  if (a.summary) { section("Summary"); kv("", a.summary); r += 1; }
  if (a.kprImpact) { section("What KPR inherits"); kv("", a.kprImpact); r += 1; }

  bullets("Purchase / ROFR / recapture", asList(a.purchaseRightsROFR).length ? asList(a.purchaseRightsROFR) : ["None found in this document set."]);
  bullets("Cost-sharing / recurring $", asList(a.costSharing));
  bullets("Use restrictions", asList(a.useRestrictions));
  bullets("Building / no-build", asList(a.buildingRestrictions));
  bullets("Operating covenants", asList(a.operatingCovenants));
  bullets("Approval rights", asList(a.approvalRights));
  bullets("Maintenance obligations", asList(a.maintenanceObligations));
  bullets("Termination / recapture", asList(a.terminationRecapture));
  bullets("Easements", asList(a.easements));
  if (a.assignmentTransfer) bullets("Assignment / transfer", [a.assignmentTransfer]);
  if (a.defaultRemedies) bullets("Default / remedies", [a.defaultRemedies]);

  const flags = [...(a.flags ?? [])].sort((x, y) => sevRank(x.severity) - sevRank(y.severity));
  if (flags.length) {
    section("Flags / open questions");
    for (const f of flags) {
      const lab = sevRank(f.severity) === 0 ? "CRITICAL" : sevRank(f.severity) === 1 ? "WATCH" : "INFO";
      const txt = `[${lab}] ${sv(f.issue)}${f.verifiedAgainstExecutedDoc === false ? " (unverified)" : ""}${f.detail ? "\n" + sv(f.detail) : ""}`;
      ws.mergeCells(r, 1, r, 2);
      const c = ws.getCell(r, 1); c.value = txt;
      c.alignment = { wrapText: true, vertical: "top" };
      c.font = { color: { argb: sevRank(f.severity) === 0 ? "FFB42318" : INK }, size: 10 };
      bumpHeight(ws, r, txt, W + 26); r += 1;
    }
    r += 1;
  }

  if (a.crossCheckVsEricSummary) { section("Cross-check vs your REA summary"); kv("", a.crossCheckVsEricSummary); r += 1; }

  const chain = (a.documentChain ?? []).map((d) => [d.name, d.date, d.recording, d.role].filter(Boolean).join(" · ")).filter(Boolean);
  if (chain.length) bullets("Document chain", chain);
  const srcs = (a.sourceDocuments ?? []).map((d) => [d.name, d.date, d.readNote].filter(Boolean).join(" · ")).filter(Boolean);
  if (srcs.length) bullets("Source documents", srcs);
}

const usedNames = new Set<string>();
function sheetName(name: string): string {
  let base = (name || "Agreement").replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Agreement";
  let n = base, i = 2;
  while (usedNames.has(n.toLowerCase())) { n = `${base.slice(0, 25)} ${i}`; i += 1; }
  usedNames.add(n.toLowerCase());
  return n;
}

async function downloadWorkbook(wb: ExcelJS.Workbook, fileName: string): Promise<void> {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Whole property: a REA & Easements summary index + one detailed tab per agreement.
export async function exportSiteAgreementsWorkbook(dealName: string, agreements: SiteAgreement[]): Promise<void> {
  usedNames.clear();
  const sorted = [...agreements].sort((a, b) =>
    (a.center || "").localeCompare(b.center || "") || (a.agreementName || "").localeCompare(b.agreementName || ""));
  const wb = new ExcelJS.Workbook();
  writeSummary(wb.addWorksheet("REA & Easements"), dealName, sorted);
  for (const a of sorted) writeDetailTab(wb.addWorksheet(sheetName(a.agreementName)), a);
  const safe = (dealName || "deal").replace(/[/\\?%*:|"<>]/g, "-").slice(0, 60);
  await downloadWorkbook(wb, `KPR_REA_Easements_${safe}_${today()}.xlsx`);
}
