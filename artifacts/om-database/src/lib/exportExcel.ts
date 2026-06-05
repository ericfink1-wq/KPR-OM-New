import * as XLSX from "xlsx";
import type { Deal, CashFlowRow, LeaseAbstract, AbstractCitation, AbstractField } from "./idb";
import { LEASE_NOTE_SECTIONS } from "./idb";
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
    "Suite",
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
    t.suite ?? "",
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
    { wch: 9 },  // Suite
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
    applyFmt(rrWs, row, 5, "#,##0");         // SF
    applyFmt(rrWs, row, 6, '$#,##0.00');     // Rent/SF
    applyFmt(rrWs, row, 7, '$#,##0');        // Annual Rent
    applyFmt(rrWs, row, 14, '$#,##0.00');    // Sales PSF
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
    "Tenant", "Suite", "Anchor", "Dark", "Credit", "SF", "Rent/SF", "Annual Rent",
    "Lease Start", "Lease Expiry", "Rem. Term (yrs)", "Lease Type",
    "Renewal Options", "Rent Steps", "Sales PSF", "Notes",
  ];
  const rows = tenants.map(t => [
    t.name ?? "",
    t.suite ?? "",
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
  const totalRow = ["TOTAL", "", "", "", "", totSF || "", "", totRent || "", "", "", "", "", "", "", "", ""];
  const aoa = [headers, ...rows, totalRow];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  polishSheet(ws, {
    rows: aoa.length, cols: headers.length,
    widths: [32, 9, 8, 7, 12, 12, 10, 14, 13, 13, 16, 16, 26, 36, 11, 40],
    colFormats: { 5: "#,##0", 6: '$#,##0.00', 7: '$#,##0', 10: "0.0", 14: '$#,##0.00' },
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

// ===========================================================================
// Lease-abstract export — mirrors Eric's detailed per-tenant abstract tab.
// A single tenant exports as one sheet laid out like the tab; a deal exports as
// a workbook with an "Issues Summary" sheet plus one tab per tenant.
// ===========================================================================

type Cell = string | number;
type Aoa = Cell[][];

// Render a citation in Eric's shorthand, e.g. "Lse. Sec. 9.3", "Supplement to
// Lse. Sec. 4", "Memo. Exh A", "Guaranty Sec. 9".
function citeShort(c?: AbstractCitation | null): string {
  if (!c) return "";
  const doc = (c.doc || "").trim();
  const sec = (c.section || "").trim();
  const page = (c.page || "").trim();
  if (!doc && !sec && !page) return "";
  const low = doc.toLowerCase();
  let prefix = doc;
  if (/supplement/.test(low)) prefix = "Supplement to Lse.";
  else if (/memo/.test(low)) prefix = "Memo.";
  else if (/guaranty|guarantee/.test(low)) prefix = "Guaranty";
  else if (/amendment|expansion/.test(low)) prefix = "Amend.";
  else if (/\blease\b|indenture/.test(low)) prefix = "Lse.";
  // letters / options / waivers keep their descriptive name
  let secPart = "";
  if (sec) secPart = /sec\.|§|exh/i.test(sec) ? sec.replace(/§/g, "Sec. ") : `Sec. ${sec}`;
  const pagePart = page ? `p. ${page}` : "";
  return [prefix, secPart, pagePart].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

const fval = (f?: AbstractField | null): string => (f && f.value != null ? String(f.value) : "");
const sv = (v: unknown): Cell => (v == null || v === "" ? "" : (typeof v === "number" ? v : String(v)));
const yn = (b?: boolean | null): string => (b == null ? "" : b ? "Yes" : "No");

// Format an ISO date (yyyy-mm-dd) as M/D/YYYY to match Eric's tabs; pass other
// strings ("None", "Not Provided", "Months 1", a bare year) through unchanged.
function mdy(v: unknown): string {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : s;
}
const fdate = (f?: AbstractField | null): string => mdy(fval(f));

// Build the per-tenant tab as an array-of-arrays, mirroring the layout/labels of
// Eric's MRI-style abstract tab.
function abstractTabAoa(a: LeaseAbstract): Aoa {
  const A: Aoa = [];
  const row = (...cells: Cell[]) => A.push(cells);
  const blank = () => A.push([""]);
  const head = (t: string) => { row(t); };

  row(`${a.tenantName || ""}${a.dba && a.dba !== a.tenantName ? "  —  " + a.dba : ""}`);
  blank();

  head("Lease – Property / Tenant Information");
  row("Building Name", sv(a.center));
  row("Suite #", sv(a.suite));
  row("Tenant Name", sv(a.tenantName));
  row("DBA", sv(a.dba));
  row("Premises GLA", sv(a.premisesGLA ?? a.currentSF));
  if (a.mriNumber) row("MRI #", sv(a.mriNumber));
  blank();

  if (a.documents?.length) {
    head("Lease & Amendments");
    for (const dc of a.documents) row(mdy(dc.date), sv(dc.name), sv(dc.description));
    blank();
  }

  // Lease Dates and Deposit Information side by side, like the tab.
  const d = a.dates || {};
  const dep = a.deposit || {};
  const leftRows: Cell[][] = [
    ["Lease Date", fdate(d.leaseDate), citeShort(d.leaseDate?.cite)],
    ["Open Date", fdate(d.openDate), citeShort(d.openDate?.cite)],
    ["Lease Comm.", fdate(d.leaseCommencement), citeShort(d.leaseCommencement?.cite)],
    ["Cancel", fdate(d.cancelDate), citeShort(d.cancelDate?.cite)],
    ["Insurance Cert. Exp.", sv(dep.insuranceCertExp), ""],
    ["Lease Expiration", fdate(d.leaseExpiration), citeShort(d.leaseExpiration?.cite)],
    ["Rent Start Date", fdate(d.rentStartDate), citeShort(d.rentStartDate?.cite)],
  ];
  const rightRows: Cell[][] = [
    ["Non-Cash Deposit", sv(dep.nonCashDeposit)],
    ["Interest Start Date", sv(dep.interestStartDate)],
    ["Last Interest Earned Date", sv(dep.lastInterestEarnedDate)],
    ["Vendor ID", sv(dep.vendorId)],
    ["", ""],
    ["Cash Deposit", sv(dep.cashDeposit)],
    ["Interest Bearing", sv(dep.interestBearing)],
  ];
  row("LEASE DATES", "", "", "", "DEPOSIT INFORMATION");
  for (let i = 0; i < Math.max(leftRows.length, rightRows.length); i++) {
    const l = leftRows[i] ?? ["", "", ""];
    const r = rightRows[i] ?? ["", ""];
    row(l[0], l[1], l[2], "", r[0], r[1]);
  }
  blank();

  if (a.noticeAddresses?.length) {
    head("Notice Address");
    for (const na of a.noticeAddresses) {
      row("Lease Address Type", sv(na.type || "Address"), citeShort(na.cite));
      if (na.name) row("Name:", na.name);
      if (na.attn) row("Attn:", na.attn);
      const addr = [na.address1, na.address2].filter(Boolean).join(", ");
      if (addr) row("Address", addr);
      row("City / State / Zip", [na.city, na.state, na.zip].filter(Boolean).join(", "));
      if (na.phone) row("Phone", na.phone);
      if (na.email) row("Email", na.email);
    }
    blank();
  }

  if (a.options?.length) {
    head("Lease – Options");
    row("Option Number", "Option Date", "Type", "Notice Date", "Suite ID", "Square Feet", "Term Months", "Rate (PSF)", "Rate Descriptor", "Expire Date");
    for (const o of a.options) {
      row(
        sv(o.number ?? (o.ordinal != null ? `${o.ordinal}` : "")),
        mdy(o.windowStart), sv(o.optionType), mdy(o.noticeDate), sv(o.suiteId),
        sv(o.squareFeet), sv(o.termMonths), sv(o.ratePSF), sv(o.rateDescriptor),
        mdy(o.expireDate ?? o.windowEnd),
      );
    }
    if (a.optionNotes) row("Option Notes:", a.optionNotes);
    blank();
  }

  if (a.rentSchedule?.length) {
    head("Billing – Recurring Charges");
    row("Income Category", "Effective Date", "End Date", "Annual Amount/sf", "Annual Total", "Monthly Amount", "Note");
    for (const r of a.rentSchedule) {
      row(
        sv(r.incomeCategory ?? "RNT"), mdy(r.periodStart), mdy(r.periodEnd),
        sv(r.amountPerSF ?? r.psf), sv(r.annualRent), sv(r.monthlyRent), sv(r.note),
      );
    }
    blank();
  }

  const pr = a.percentageRentDetail;
  if (pr || a.percentageRent) {
    head("Retail – Percentage Rent");
    if (pr) {
      if (pr.summary) row("Summary", pr.summary);
      row("Reporting Frequency", sv(pr.reportingFrequency));
      row("Use Natural Breakpoint", yn(pr.naturalBreakpoint));
      row("Percentage Rent in Lieu of Minimum Rent", yn(pr.inLieuOfMinimum));
      if (pr.salesYearEnd) row("Sales Year End", sv(pr.salesYearEnd));
      if (pr.paymentTiming) row("Percentage Rent Paid", sv(pr.paymentTiming));
      if (pr.breakpoints?.length) {
        row("Start Date", "Percentage", "Breakpoint");
        for (const b of pr.breakpoints) row(mdy(b.startDate), sv(b.percentage), sv(b.breakpoint));
      }
      if (pr.cite) row("Source", citeShort(pr.cite));
    } else if (a.percentageRent) {
      row("Percentage Rent", fval(a.percentageRent), citeShort(a.percentageRent.cite));
    }
    blank();
  }

  // Lease Notes: Section (lease ref) | Code | (Category) | Notes — like the tab.
  head("Lease Notes");
  row("Section", "Code", "Category", "Notes");
  const byCode = new Map((a.leaseNotes || []).map((n) => [n.code, n]));
  for (const sec of LEASE_NOTE_SECTIONS) {
    const n = byCode.get(sec.code);
    let val = n?.value ?? "";
    let cite = n?.cite ?? null;
    if (!val) {
      if (sec.code === "SECDEP") { val = fval(a.securityDeposit); cite = a.securityDeposit?.cite ?? null; }
      else if (sec.code === "GO DARK") { val = fval(a.goDark); cite = a.goDark?.cite ?? null; }
      else if (sec.code === "ASSNSUB") { val = fval(a.assignment); cite = a.assignment?.cite ?? null; }
      else if (sec.code === "DEFAULT") { val = fval(a.defaultTerms); cite = a.defaultTerms?.cite ?? null; }
      else if (sec.code === "EXCLUSI" && a.exclusives?.length) { val = a.exclusives.map((e) => e.description).filter(Boolean).join("  |  "); cite = a.exclusives[0]?.cite ?? null; }
      else if (sec.code === "GUARANT" && a.guaranties?.length) { val = a.guaranties.map((g) => `${g.guarantor}: ${g.scope ?? ""}`).join("  |  "); cite = a.guaranties[0]?.cite ?? null; }
    }
    row(sv(cite?.section), sec.code, `(${sec.label})`, val);
  }

  if (a.flags?.length) {
    blank();
    head("KPR Flags — verify these");
    for (const f of a.flags) row((f.severity || "note").toUpperCase(), f.issue || "", f.detail || "");
  }

  return A;
}

function sanitizeSheetName(name: string): string {
  return (name || "Sheet").replace(/[\\/?*:[\]]/g, "-").slice(0, 31) || "Sheet";
}

const ABSTRACT_COL_WIDTHS = [24, 26, 30, 48, 16, 16, 16, 14, 16, 14];

function appendAbstractTab(wb: XLSX.WorkBook, a: LeaseAbstract): void {
  const ws = XLSX.utils.aoa_to_sheet(abstractTabAoa(a));
  ws["!cols"] = ABSTRACT_COL_WIDTHS.map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(a.tenantName || a.dba || "Tenant"));
}

// Renewal-options one-liner for the Issues Summary (count + length, next start, rate).
function optsSummary(a: LeaseAbstract): { numLen: string; begins: string; rate: string } {
  const opts = a.options ?? [];
  if (!opts.length) return { numLen: "None", begins: "", rate: "" };
  const len = opts[0].length || (opts[0].termMonths ? `${opts[0].termMonths} mo` : "");
  const first = opts[0];
  const rate = first.ratePSF != null ? `$${first.ratePSF}` : (first.rent || "");
  return { numLen: `${opts.length} @ ${len}`.trim(), begins: mdy(first.windowStart), rate };
}

// Consolidated, topic-major "Issues Summary" across all of a deal's abstracts.
function issuesSummaryAoa(abstracts: LeaseAbstract[]): Aoa {
  const A: Aoa = [];
  const row = (...c: Cell[]) => A.push(c);
  const blank = () => A.push([""]);
  row("Issues Summary");
  blank();
  row("RENEWAL OPTIONS");
  row("Tenant", "Number/Length", "1st Option Begins", "Initial Annual Rent/sf");
  for (const a of abstracts) { const s = optsSummary(a); row(sv(a.tenantName), s.numLen, s.begins, s.rate); }
  blank();
  for (const sec of LEASE_NOTE_SECTIONS) {
    row(sec.label.toUpperCase());
    for (const a of abstracts) {
      const n = (a.leaseNotes || []).find((x) => x.code === sec.code);
      let val = n?.value ?? "";
      if (!val && sec.code === "SECDEP") val = fval(a.securityDeposit);
      if (!val && sec.code === "GO DARK") val = fval(a.goDark);
      if (!val && sec.code === "ASSNSUB") val = fval(a.assignment);
      row(sv(a.tenantName), val);
    }
    blank();
  }
  return A;
}

// Export a SINGLE tenant's abstract as a one-sheet workbook (mirrors the tab).
export function exportLeaseAbstract(a: LeaseAbstract): void {
  const wb = XLSX.utils.book_new();
  appendAbstractTab(wb, a);
  const safe = (a.tenantName || "abstract").replace(/[/\\?%*:|"<>]/g, "-").slice(0, 60);
  XLSX.writeFile(wb, `KPR_LeaseAbstract_${safe}_${today()}.xlsx`);
}

// Export ALL of a deal's abstracts: Issues Summary + one tab per tenant.
export function exportLeaseAbstractsWorkbook(dealName: string, abstracts: LeaseAbstract[]): void {
  if (!abstracts.length) return;
  const wb = XLSX.utils.book_new();
  const sumWs = XLSX.utils.aoa_to_sheet(issuesSummaryAoa(abstracts));
  sumWs["!cols"] = [{ wch: 26 }, { wch: 60 }, { wch: 22 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, sumWs, "Issues Summary");
  for (const a of abstracts) appendAbstractTab(wb, a);
  const safe = (dealName || "deal").replace(/[/\\?%*:|"<>]/g, "-").slice(0, 60);
  XLSX.writeFile(wb, `KPR_LeaseAbstracts_${safe}_${today()}.xlsx`);
}
