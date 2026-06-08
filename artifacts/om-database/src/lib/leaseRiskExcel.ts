// Styled lease-risk MATRIX export (ExcelJS). Turns the Anchor-Dependency panel into
// a workbook answering: "if an anchor goes dark, who trips, and how much base rent is
// at stake?" Two sheets — a ranked anchor summary, and the full anchor × tenant grid
// (cells = the worst tier at which each tenant trips on each anchor). Deterministic;
// all math comes from buildRiskMatrix (leaseRisk.ts), nothing is re-derived here.

import ExcelJS from "exceljs";
import type { Deal, LeaseAbstract } from "./idb";
import { resolveTenantRisk, buildRiskMatrix, type MatrixCell, type RiskMatrix } from "./leaseRisk";
import { lookupWatch, WATCH_STATUS_META, type WatchMap } from "./useWatchlist";

const INK = "FF383A37", SUB = "FF6F6A5F", FAINT = "FFA69E91";
const SECTION_FILL = "FFEFE8DA", HEADER_FILL = "FFF3EEE3", LINE = "FFD8CFBD";
const RED = "FFB42318", AMBER = "FFB45309", GREEN = "FF1F6F43";
const RED_BG = "FFFDECEC", AMBER_BG = "FFFBF1E4", GRAY_BG = "FFF3EFE7";

const thin = { style: "thin" as const, color: { argb: LINE } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };
const MONEY_FMT = '$#,##0;[Red]-$#,##0';

// Tier styling, shared by both sheets so the grid and the summary read the same.
const tierStyle = (t: 1 | 2 | 3) =>
  t === 1 ? { fg: RED, bg: RED_BG, label: "Tier 1" }
  : t === 2 ? { fg: AMBER, bg: AMBER_BG, label: "Tier 2" }
  : { fg: SUB, bg: GRAY_BG, label: "Tier 3" };

// Excel styling for a watchlist / concern flag, mirroring the app's severity tiers:
// bankruptcy / liquidating read red; watch / distressed read amber.
function watchStyleXlsx(status: string) {
  const label = WATCH_STATUS_META[status]?.label || (status ? status[0].toUpperCase() + status.slice(1) : "Watchlist");
  const severe = status === "bankruptcy" || status === "liquidating";
  return severe ? { fg: RED, bg: RED_BG, label } : { fg: AMBER, bg: AMBER_BG, label };
}

function remedyText(cell: MatrixCell): string {
  const parts: string[] = [];
  if (cell.clauseType) parts.push(`${cell.clauseType} co-tenancy`);
  if (cell.remedy?.mechanism) {
    const m = cell.remedy.mechanism.replace(/_/g, " ");
    parts.push(`remedy: ${m}${cell.remedy.value != null ? ` ${cell.remedy.value}${/pct|percent/.test(cell.remedy.mechanism) ? "%" : ""}` : ""}`);
  }
  if (cell.terminationNoticeDays) parts.push(`${cell.terminationNoticeDays}-day termination`);
  return parts.join(" · ");
}

type WS = ExcelJS.Worksheet;

const today = () => new Date().toISOString().slice(0, 10);

async function downloadWorkbook(wb: ExcelJS.Workbook, fileName: string): Promise<void> {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Sheet 1: ranked anchor summary ────────────────────────────────────────────────
function writeSummary(ws: WS, dealName: string, m: RiskMatrix): void {
  ws.columns = [{ width: 6 }, { width: 34 }, { width: 13 }, { width: 18 }, { width: 16 }, { width: 16 }];
  let r = 1;
  const set = (col: number, value: string | number | null, opts: Partial<ExcelJS.Style> = {}) => {
    const cell = ws.getCell(r, col);
    cell.value = value === "" ? null : value;
    if (opts.font) cell.font = opts.font;
    if (opts.alignment) cell.alignment = opts.alignment;
    if (opts.fill) cell.fill = opts.fill;
    if (opts.border) cell.border = opts.border;
    if (opts.numFmt) cell.numFmt = opts.numFmt;
    return cell;
  };

  set(1, `Lease Risk — Anchor Exposure  ·  ${dealName}`, { font: { bold: true, size: 13, color: { argb: INK } } });
  ws.mergeCells(r, 1, r, 6); r += 1;
  set(1, "Base rent at stake if each anchor goes dark / relocates, ranked. Tier 1 = a tenant trips on this anchor alone; Tier 2 = needs a second event; Total = every linked tenant.", { font: { italic: true, size: 9.5, color: { argb: SUB } }, alignment: { wrapText: true, vertical: "top" } });
  ws.mergeCells(r, 1, r, 6); ws.getRow(r).height = 28; r += 2;

  const headers = ["Rank", "Anchor", "Dependents", "Tier-1 Rent (alone)", "Tier-2 Rent", "Total at Risk"];
  headers.forEach((h, i) => set(i + 1, h, { font: { bold: true, size: 9.5, color: { argb: INK } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }, border: allBorders, alignment: { wrapText: true, vertical: "middle", horizontal: i >= 2 ? "right" : "left" } }));
  ws.getRow(r).height = 26; r += 1;

  m.anchors.forEach((a, i) => {
    set(1, i + 1, { font: { size: 10, color: { argb: SUB } }, border: allBorders, alignment: { horizontal: "center" } });
    set(2, a.anchor, { font: { bold: true, size: 10, color: { argb: INK } }, border: allBorders, alignment: { wrapText: true } });
    set(3, a.dependentCount, { font: { size: 10, color: { argb: INK } }, border: allBorders, alignment: { horizontal: "right" } });
    set(4, a.tier1Rent || null, { font: { bold: true, size: 10, color: { argb: a.tier1Rent ? RED : FAINT } }, border: allBorders, numFmt: MONEY_FMT, fill: a.tier1Rent ? { type: "pattern", pattern: "solid", fgColor: { argb: RED_BG } } : undefined });
    set(5, a.tier2Rent || null, { font: { size: 10, color: { argb: a.tier2Rent ? AMBER : FAINT } }, border: allBorders, numFmt: MONEY_FMT });
    set(6, a.totalRent || null, { font: { size: 10, color: { argb: INK } }, border: allBorders, numFmt: MONEY_FMT });
    r += 1;
  });

  // Grand total row (Tier-1 and Total summed across anchors; note the caveat below).
  const sumT1 = m.anchors.reduce((s, a) => s + a.tier1Rent, 0);
  set(2, "All anchors", { font: { bold: true, size: 10, color: { argb: INK } }, border: allBorders });
  set(4, sumT1 || null, { font: { bold: true, size: 10, color: { argb: RED } }, border: allBorders, numFmt: MONEY_FMT });
  set(3, "", { border: allBorders }); set(5, "", { border: allBorders }); set(6, "", { border: allBorders });
  set(1, "", { border: allBorders });
  r += 2;
  set(1, "Note: a tenant can appear under more than one anchor, so the per-anchor columns are not additive across rows — read each anchor's row as its own scenario.", { font: { italic: true, size: 9, color: { argb: FAINT } }, alignment: { wrapText: true, vertical: "top" } });
  ws.mergeCells(r, 1, r, 6); ws.getRow(r).height = 24;

  ws.views = [{ state: "frozen", ySplit: 4, xSplit: 0 }];
}

// ── Sheet 2: anchor × tenant matrix ───────────────────────────────────────────────
function writeMatrix(ws: WS, dealName: string, m: RiskMatrix, watch?: WatchMap): void {
  const anchorCols = m.anchors.map((a) => a.anchor);
  const FIXED = 5; // Tenant | Base Rent | Worst | #Anchors | Watch / Concern
  ws.columns = [
    { width: 28 }, { width: 13 }, { width: 9 }, { width: 9 }, { width: 17 },
    ...anchorCols.map(() => ({ width: 12 })),
  ];
  let r = 1;
  const set = (col: number, value: string | number | null, opts: Partial<ExcelJS.Style> = {}) => {
    const cell = ws.getCell(r, col);
    cell.value = value === "" ? null : value;
    if (opts.font) cell.font = opts.font;
    if (opts.alignment) cell.alignment = opts.alignment;
    if (opts.fill) cell.fill = opts.fill;
    if (opts.border) cell.border = opts.border;
    if (opts.numFmt) cell.numFmt = opts.numFmt;
    return cell;
  };
  const lastCol = FIXED + anchorCols.length;

  set(1, `Lease Risk Matrix — who trips if an anchor goes dark  ·  ${dealName}`, { font: { bold: true, size: 13, color: { argb: INK } } });
  ws.mergeCells(r, 1, r, lastCol); r += 1;
  set(1, "Rows = tenants with co-tenancy, ranked by Tier-1 exposure $ (base rent that trips if a single anchor goes dark on its own), then base rent. Columns = anchors (ranked by Tier-1 rent). Cell = the worst tier at which that tenant trips on that anchor: 1 = on that anchor alone, 2 = needs a second event, 3 = linked / deeper trigger. Blank = no link. Tenants on the watchlist / flagged as a concern are highlighted, with the reason in the Watch / Concern column.", { font: { italic: true, size: 9.5, color: { argb: SUB } }, alignment: { wrapText: true, vertical: "top" } });
  ws.mergeCells(r, 1, r, lastCol); ws.getRow(r).height = 30; r += 1;

  // Header row 1: fixed labels + anchor names (rotated to keep columns narrow).
  const hr = r;
  ["Tenant", "Base Rent", "Worst", "Anchors", "Watch / Concern"].forEach((h, i) =>
    set(i + 1, h, { font: { bold: true, size: 9.5, color: { argb: INK } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }, border: allBorders, alignment: { vertical: "bottom", horizontal: i >= 1 && i <= 3 ? "center" : "left", wrapText: true } }));
  anchorCols.forEach((a, i) =>
    set(FIXED + 1 + i, a, { font: { bold: true, size: 9, color: { argb: INK } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }, border: allBorders, alignment: { textRotation: 90, vertical: "bottom", horizontal: "center", wrapText: true } }));
  ws.getRow(hr).height = 96; r += 1;

  // Tenant rows.
  for (const t of m.tenants) {
    const w = watch ? lookupWatch(watch, t.tenant) : undefined;
    const wst = w ? watchStyleXlsx(w.status) : null;
    // Tenant name — tinted when the tenant is on the watchlist / flagged a concern.
    set(1, t.tenant, { font: { bold: true, size: 10, color: { argb: wst ? wst.fg : INK } }, fill: wst ? { type: "pattern", pattern: "solid", fgColor: { argb: wst.bg } } : undefined, border: allBorders, alignment: { wrapText: true, vertical: "middle" } });
    set(2, t.baseRentAnnual ?? null, { font: { size: 10, color: { argb: INK } }, border: allBorders, numFmt: MONEY_FMT, alignment: { vertical: "middle" } });
    const ws_ = tierStyle(t.worstTier);
    set(3, ws_.label, { font: { bold: true, size: 9, color: { argb: ws_.fg } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: ws_.bg } }, border: allBorders, alignment: { horizontal: "center", vertical: "middle" } });
    set(4, t.anchorsAffecting, { font: { size: 10, color: { argb: SUB } }, border: allBorders, alignment: { horizontal: "center", vertical: "middle" } });
    // Watch / Concern — the status label, colored; reason (if any) as a hover note.
    if (wst) {
      const c5 = set(5, wst.label, { font: { bold: true, size: 9, color: { argb: wst.fg } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: wst.bg } }, border: allBorders, alignment: { horizontal: "center", vertical: "middle", wrapText: true } });
      if (w?.note) c5.note = w.note;
    } else {
      set(5, null, { border: allBorders });
    }
    anchorCols.forEach((a, i) => {
      const cell = t.cells[a];
      if (!cell) { set(FIXED + 1 + i, null, { border: allBorders }); return; }
      const st = tierStyle(cell.tier);
      const c = set(FIXED + 1 + i, cell.tier, {
        font: { bold: true, size: 11, color: { argb: st.fg } },
        fill: { type: "pattern", pattern: "solid", fgColor: { argb: st.bg } },
        border: allBorders, alignment: { horizontal: "center", vertical: "middle" },
      });
      // Detail (remedy / trigger) as a hover comment so the grid stays clean.
      const note = [`${cell.verified ? "Verified lease" : "OM — unverified"}`, remedyText(cell), cell.triggerSummary ? `Trigger: ${cell.triggerSummary}` : ""].filter(Boolean).join("\n");
      if (note) c.note = note;
    });
    r += 1;
  }

  // Footer totals: Tier-1 rent at risk, then total at risk, per anchor column.
  const t1Row = r;
  set(1, "Tier-1 rent at risk (trips alone)", { font: { bold: true, size: 9.5, color: { argb: RED } }, border: allBorders });
  ws.mergeCells(t1Row, 1, t1Row, FIXED);
  m.anchors.forEach((a, i) => set(FIXED + 1 + i, a.tier1Rent || null, { font: { bold: true, size: 9, color: { argb: a.tier1Rent ? RED : FAINT } }, border: allBorders, numFmt: MONEY_FMT, alignment: { horizontal: "right" } }));
  r += 1;
  const totRow = r;
  set(1, "Total rent at risk (any linkage)", { font: { bold: true, size: 9.5, color: { argb: INK } }, border: allBorders });
  ws.mergeCells(totRow, 1, totRow, FIXED);
  m.anchors.forEach((a, i) => set(FIXED + 1 + i, a.totalRent || null, { font: { size: 9, color: { argb: INK } }, border: allBorders, numFmt: MONEY_FMT, alignment: { horizontal: "right" } }));

  ws.views = [{ state: "frozen", ySplit: hr, xSplit: FIXED }];
  ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: hr + m.tenants.length, column: lastCol } };
}

const sheetSafe = (name: string) => (name || "Sheet").replace(/[\\/?*:[\]]/g, "-").slice(0, 31) || "Sheet";

/** Export the anchor-dependency risk matrix for one deal as a styled workbook. */
export async function exportLeaseRiskMatrix(deal: Deal, abstracts: LeaseAbstract[], watch?: WatchMap): Promise<void> {
  const resolved = resolveTenantRisk(deal, abstracts);
  const matrix = buildRiskMatrix(resolved);
  if (!matrix.anchors.length || !matrix.tenants.length) return;

  const dealName = deal.propertyName || "Deal";
  const wb = new ExcelJS.Workbook();
  writeSummary(wb.addWorksheet(sheetSafe("Anchor Exposure")), dealName, matrix);
  writeMatrix(wb.addWorksheet(sheetSafe("Risk Matrix")), dealName, matrix, watch);

  const safe = dealName.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 60);
  await downloadWorkbook(wb, `KPR_LeaseRiskMatrix_${safe}_${today()}.xlsx`);
}
