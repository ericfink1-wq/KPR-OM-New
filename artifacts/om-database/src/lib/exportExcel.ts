import * as XLSX from "xlsx";
import type { Deal, CashFlowRow } from "./idb";
import { filterFutureRentSteps } from "./utils";

function safeNum(v: unknown): number | "" {
  if (v == null || v === "") return "";
  const n = Number(v);
  return isNaN(n) ? "" : n;
}

function fmtDate(raw: unknown): string {
  if (raw == null || raw === "") return "";
  const s = String(raw).trim();
  const d = new Date(s.includes("T") ? s : s + "T00:00:00");
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return s;
}

function applyFmt(ws: XLSX.WorkSheet, r: number, c: number, fmt: string) {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = ws[addr];
  if (cell && cell.v !== "" && cell.v != null) cell.z = fmt;
}

// ---------------------------------------------------------------------------
// Shared "polish": freeze the header row, add an autofilter dropdown over it,
// and bold it where the SheetJS build supports cell styles. Column number
// formats are applied per-exporter via colFormats (1-based-safe column index map).
// Works with the community xlsx build (freeze + autofilter + widths + z-formats
// are honored; bold is best-effort).
// ---------------------------------------------------------------------------
function polishSheet(
  ws: XLSX.WorkSheet,
  opts: { rows: number; cols: number; widths: number[]; colFormats?: Record<number, string> },
) {
  const { rows, cols, widths, colFormats } = opts;
  ws["!cols"] = widths.map(w => ({ wch: w }));
  // Freeze the header row so it stays visible while scrolling.
  ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  // Autofilter across the header row.
  const lastCol = XLSX.utils.encode_col(Math.max(0, cols - 1));
  ws["!autofilter"] = { ref: `A1:${lastCol}1` };
  // Best-effort bold header (honored by styled builds; ignored otherwise).
  for (let c = 0; c < cols; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell) cell.s = { font: { bold: true }, alignment: { vertical: "center" } };
  }
  // Number formats per data column.
  if (colFormats) {
    for (let r = 1; r < rows; r++) {
      for (const [cStr, fmt] of Object.entries(colFormats)) applyFmt(ws, r, Number(cStr), fmt);
    }
  }
}

function downloadWb(ws: XLSX.WorkSheet, sheetName: string, fileName: string) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

const today = () => new Date().toISOString().slice(0, 10);


export function exportDealToExcel(deal: Deal): void {
  const wb = XLSX.utils.book_new();

  // ─── Sheet 1: Rent Roll ────────────────────────────────────────────────
  const tenants = deal.tenants ?? [];
  const rrHeaders = [
    "Tenant",
    "Anchor?",
    "Dark?",
    "Credit Rating",
    "SF",
    "Rent / SF",
    "Annual Rent",
    "Lease Start",
    "Lease Expiry",
    "Rem. Term (yrs)",
    "Lease Type",
    "Renewal Options",
    "Rent Bumps / Steps",
    "Sales PSF",
    "Notes",
  ];

  const rrRows = tenants.map(t => [
    t.name ?? "",
    t.isAnchor ? "Yes" : "",
    t.isDark ? "Yes" : "",
    t.creditRating ?? "",
    safeNum(t.sf),
    safeNum(t.rentPerSF),
    safeNum(t.annualRent),
    fmtDate(t.leaseStart),
    fmtDate(t.leaseExpiry),
    safeNum(t.remainingTermYears),
    t.leaseType ?? "",
    t.renewalOptions ?? "",
    (() => {
      const raw = t.rentSchedule || t.rentBumps;
      const filtered = filterFutureRentSteps(raw);
      return filtered ? filtered.split(";").map(s => s.trim()).filter(Boolean).join("\n") : "";
    })(),
    safeNum(t.salesPSF),
    t.assumptionNote ?? "",
  ]);

  const rrAoa = [rrHeaders, ...rrRows];
  const rrWs = XLSX.utils.aoa_to_sheet(rrAoa);

  rrWs["!cols"] = [
    { wch: 32 }, // Tenant
    { wch: 8 },  // Anchor
    { wch: 7 },  // Dark
    { wch: 14 }, // Credit Rating
    { wch: 12 }, // SF
    { wch: 10 }, // Rent/SF
    { wch: 14 }, // Annual Rent
    { wch: 13 }, // Lease Start
    { wch: 13 }, // Lease Expiry
    { wch: 16 }, // Rem. Term
    { wch: 16 }, // Lease Type
    { wch: 26 }, // Renewal Options
    { wch: 36 }, // Rent Bumps
    { wch: 11 }, // Sales PSF
    { wch: 40 }, // Notes
  ];

  for (let row = 1; row < rrAoa.length; row++) {
    applyFmt(rrWs, row, 4, "#,##0");         // SF
    applyFmt(rrWs, row, 5, '$#,##0.00');     // Rent/SF
    applyFmt(rrWs, row, 6, '$#,##0');        // Annual Rent
    applyFmt(rrWs, row, 13, '$#,##0.00');    // Sales PSF
  }

  if (deal.tenantsAsOf) {
    rrWs["A1"].c = [{ a: "KPR", t: `Rent roll as of: ${fmtDate(deal.tenantsAsOf)}` }];
  }

  XLSX.utils.book_append_sheet(wb, rrWs, "Rent Roll");

  // ─── Sheet 2: Cash Flow ────────────────────────────────────────────────
  const cfRows: CashFlowRow[] = deal.cashFlowProjection ?? [];
  if (cfRows.length > 0) {
    const labels = cfRows.map(r => r.label ?? "");
    const metrics: [string, keyof CashFlowRow][] = [
      ["Total Base Rent",       "totalBaseRent"],
      ["Reimbursements",        "reimbursements"],
      ["Effective Gross Rev.",  "egr"],
      ["Operating Expenses",   "operatingExpenses"],
      ["NOI",                   "noi"],
    ];

    const cfAoa: (string | number | "")[][] = [
      ["", ...labels],
      ...metrics.map(([lbl, key]) => [lbl, ...cfRows.map(r => safeNum(r[key]))]),
    ];

    const cfWs = XLSX.utils.aoa_to_sheet(cfAoa);

    cfWs["!cols"] = [
      { wch: 24 },
      ...cfRows.map(() => ({ wch: 14 })),
    ];

    const cfRange = XLSX.utils.decode_range(cfWs["!ref"] ?? "A1");
    for (let r = 1; r <= cfRange.e.r; r++) {
      for (let c = 1; c <= cfRange.e.c; c++) {
        applyFmt(cfWs, r, c, '$#,##0');
      }
    }

    XLSX.utils.book_append_sheet(wb, cfWs, "Cash Flow");
  }

  // ─── Download ──────────────────────────────────────────────────────────
  const safeName = (deal.propertyName || deal.fileName || "deal")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .slice(0, 80);

  XLSX.writeFile(wb, `${safeName}.xlsx`);
}

// ---------------------------------------------------------------------------
// Export comps index to Excel
// ---------------------------------------------------------------------------
type CompExportRow = {
  name: string | null; address: string | null; market: string | null; state: string | null;
  saleDate: string | null; salePrice: number | null; capRate: number | null;
  pricePerSf: number | null; sf: number | null; occupancy: number | null;
  anchor: string | null; propertyType: string | null;
  buyer: string | null; seller: string | null;
  sourceNotes: string | null; sourceDealName: string | null;
  isOwnTransaction: boolean; isManual: boolean;
};

export function exportCompsToExcel(comps: CompExportRow[]): void {
  const headers = [
    "Property", "Address", "Market", "State",
    "Sale Date", "Sale Price", "Cap Rate (%)", "Price/SF",
    "SF", "Occupancy (%)", "Anchor", "Property Type",
    "Buyer", "Seller", "Source", "Notes",
  ];

  const dataRows = comps.map(c => [
    c.name        ?? "",
    c.address     ?? "",
    c.market      ?? "",
    c.state       ?? "",
    c.saleDate    ?? "",
    c.salePrice   != null ? c.salePrice   : "",
    c.capRate     != null ? c.capRate     : "",
    c.pricePerSf  != null ? c.pricePerSf  : "",
    c.sf          != null ? c.sf          : "",
    c.occupancy   != null ? c.occupancy   : "",
    c.anchor      ?? "",
    c.propertyType ?? "",
    c.buyer       ?? "",
    c.seller      ?? "",
    c.isOwnTransaction ? "OWNED" : c.isManual ? "Manual" : "OM",
    c.sourceNotes ?? (c.sourceDealName ?? ""),
  ]);

  const aoa = [headers, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws["!cols"] = [
    { wch: 34 }, // Property
    { wch: 30 }, // Address
    { wch: 22 }, // Market
    { wch: 8  }, // State
    { wch: 12 }, // Sale Date
    { wch: 16 }, // Sale Price
    { wch: 12 }, // Cap Rate
    { wch: 12 }, // Price/SF
    { wch: 12 }, // SF
    { wch: 14 }, // Occupancy
    { wch: 26 }, // Anchor
    { wch: 22 }, // Property Type
    { wch: 24 }, // Buyer
    { wch: 24 }, // Seller
    { wch: 8  }, // Source
    { wch: 36 }, // Notes
  ];

  for (let row = 1; row < aoa.length; row++) {
    applyFmt(ws, row, 5, "#,##0");        // Sale Price
    applyFmt(ws, row, 6, "0.00");         // Cap Rate
    applyFmt(ws, row, 7, "#,##0.00");     // Price/SF
    applyFmt(ws, row, 8, "#,##0");        // SF
    applyFmt(ws, row, 9, "0.0");          // Occupancy
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Comps");
  XLSX.writeFile(wb, `KPR_Comps_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------------------------------------------------------------------------
// Export the PORTFOLIO deal library list to Excel (polished + formatted).
// ---------------------------------------------------------------------------
export function exportPortfolioToExcel(deals: Deal[], scopeLabel = "All"): void {
  const headers = [
    "Property", "City", "State", "Market", "Asset Type", "Center Type", "Status",
    "Grade", "Total SF", "Occupancy (%)", "WALT (yrs)", "Avg Rent/SF",
    "Cap Rate (%)", "NOI", "Asking Price", "Price/SF",
  ];
  const rows = deals.map(d => {
    const sf = Number(d.totalSF) || 0;
    const price = Number(d.askingPrice) || 0;
    return [
      d.propertyName ?? d.fileName ?? "",
      d.city ?? "",
      d.state ?? "",
      d.market ?? "",
      d.assetType ?? "",
      d.centerType ?? "",
      d.status ?? "",
      d.dealScore?.grade ?? "",
      safeNum(d.totalSF),
      safeNum(d.occupancy),
      safeNum(d.walt),
      safeNum(d.weightedAvgRentPSF),
      safeNum(d.capRate),
      safeNum(d.noi),
      safeNum(d.askingPrice),
      sf > 0 && price > 0 ? Math.round(price / sf) : "",
    ];
  });
  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  polishSheet(ws, {
    rows: aoa.length, cols: headers.length,
    widths: [34, 16, 7, 20, 18, 18, 14, 7, 12, 13, 11, 11, 11, 16, 16, 11],
    colFormats: { 8: "#,##0", 9: "0.0", 10: "0.0", 11: '$#,##0.00', 12: "0.00", 13: '$#,##0', 14: '$#,##0', 15: '$#,##0' },
  });
  downloadWb(ws, "Portfolio", `KPR_Portfolio_${scopeLabel}_${today()}.xlsx`);
}

// ---------------------------------------------------------------------------
// Export ONE deal's rent roll to a clean, formatted single-sheet Excel.
// (Distinct from exportDealToExcel, which is the full multi-sheet workbook.)
// ---------------------------------------------------------------------------
export function exportRosterToExcel(deal: Deal): void {
  const tenants = deal.tenants ?? [];
  const headers = [
    "Tenant", "Anchor", "Dark", "Credit", "SF", "Rent/SF", "Annual Rent",
    "Lease Start", "Lease Expiry", "Rem. Term (yrs)", "Lease Type",
    "Renewal Options", "Rent Steps", "Sales PSF", "Notes",
  ];
  const rows = tenants.map(t => [
    t.name ?? "",
    t.isAnchor ? "Yes" : "",
    t.isDark ? "Yes" : "",
    t.creditRating ?? "",
    safeNum(t.sf),
    safeNum(t.rentPerSF),
    safeNum(t.annualRent),
    fmtDate(t.leaseStart),
    fmtDate(t.leaseExpiry),
    safeNum(t.remainingTermYears),
    t.leaseType ?? "",
    t.renewalOptions ?? "",
    (() => { const f = filterFutureRentSteps(t.rentSchedule || t.rentBumps); return f ? f.split(";").map(s => s.trim()).filter(Boolean).join("\n") : ""; })(),
    safeNum(t.salesPSF),
    t.assumptionNote ?? "",
  ]);
  // Totals row
  const totSF = tenants.reduce((s, t) => s + (Number(t.sf) || 0), 0);
  const totRent = tenants.reduce((s, t) => s + (Number(t.annualRent) || 0), 0);
  const totalRow = ["TOTAL", "", "", "", totSF || "", "", totRent || "", "", "", "", "", "", "", "", ""];
  const aoa = [headers, ...rows, totalRow];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  polishSheet(ws, {
    rows: aoa.length, cols: headers.length,
    widths: [32, 8, 7, 12, 12, 10, 14, 13, 13, 16, 16, 26, 36, 11, 40],
    colFormats: { 4: "#,##0", 5: '$#,##0.00', 6: '$#,##0', 9: "0.0", 13: '$#,##0.00' },
  });
  if (deal.tenantsAsOf && ws["A1"]) ws["A1"].c = [{ a: "KPR", t: `Rent roll as of: ${fmtDate(deal.tenantsAsOf)}` }];
  const safeName = (deal.propertyName || deal.fileName || "deal").replace(/[/\\?%*:|"<>]/g, "-").slice(0, 80);
  downloadWb(ws, "Rent Roll", `KPR_RentRoll_${safeName}_${today()}.xlsx`);
}

// ---------------------------------------------------------------------------
// Export a Tenant Analytics aggregate list (by-tenant or by-parent) to Excel.
// Generic: caller passes the already-aggregated rows + a column spec.
// ---------------------------------------------------------------------------
export type AggColumn = { header: string; width: number; fmt?: string; get: (r: Record<string, unknown>) => string | number | "" };

export function exportAggregateToExcel(
  rowsIn: Record<string, unknown>[],
  columns: AggColumn[],
  sheetName: string,
  fileName: string,
): void {
  const headers = columns.map(c => c.header);
  const rows = rowsIn.map(r => columns.map(c => c.get(r)));
  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const colFormats: Record<number, string> = {};
  columns.forEach((c, i) => { if (c.fmt) colFormats[i] = c.fmt; });
  polishSheet(ws, { rows: aoa.length, cols: headers.length, widths: columns.map(c => c.width), colFormats });
  downloadWb(ws, sheetName, fileName);
}
