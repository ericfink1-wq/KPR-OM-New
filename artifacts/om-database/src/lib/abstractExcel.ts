// Styled lease-abstract Excel export (ExcelJS) — mirrors Eric's MRI per-tenant tab.
// Uses the real column widths extracted from his workbook, the merged label/value
// grid, the two-column Lease Dates / Deposit layout (with the narrow column-L
// divider), wrapped Lease-Notes text, thin borders on tables, and styled section
// headers. SheetJS (the app's other exports) can't do cell styling; ExcelJS can.

import ExcelJS from "exceljs";
import type {
  LeaseAbstract, AbstractCitation, AbstractField, AbstractOption, AbstractRentStep,
} from "./idb";
import { LEASE_NOTE_SECTIONS } from "./idb";

// Real per-column widths (A..W) pulled from the Concordia Stop & Shop tab.
const COL_WIDTHS = [8.82, 8.73, 9.73, 9.73, 8.73, 8.73, 8.73, 8.73, 8.73, 8.73, 8.73, 2, 11.82, 8.73, 10.82, 9.82, 8.73, 8.73, 8.73, 8.73, 8.73, 11.82, 10.82];
const LAST_COL = COL_WIDTHS.length; // 23 (W)

const INK = "FF383A37", SUB = "FF6F6A5F", FAINT = "FFA69E91";
const SECTION_FILL = "FFEFE8DA", HEADER_FILL = "FFF3EEE3", LINE = "FFD8CFBD";
const RED = "FFB42318", AMBER = "FFB45309", GREEN = "FF1F6F43";

const thin = { style: "thin" as const, color: { argb: LINE } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

function mdy(v: unknown): string {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : s;
}
const fval = (f?: AbstractField | null): string => (f && f.value != null ? String(f.value) : "");
const fdate = (f?: AbstractField | null): string => mdy(fval(f));
const sv = (v: unknown): string => (v == null ? "" : String(v));
const yn = (b?: boolean | null): string => (b == null ? "" : b ? "Yes" : "No");

function citeShort(c?: AbstractCitation | null): string {
  if (!c) return "";
  const doc = (c.doc || "").trim(); const sec = (c.section || "").trim(); const page = (c.page || "").trim();
  if (!doc && !sec && !page) return "";
  const low = doc.toLowerCase(); let prefix = doc;
  if (/supplement/.test(low)) prefix = "Supplement to Lse.";
  else if (/memo/.test(low)) prefix = "Memo.";
  else if (/guaranty|guarantee/.test(low)) prefix = "Guaranty";
  else if (/amendment|expansion/.test(low)) prefix = "Amend.";
  else if (/\blease\b|indenture/.test(low)) prefix = "Lse.";
  let secPart = ""; if (sec) secPart = /sec\.|§|exh/i.test(sec) ? sec.replace(/§/g, "Sec. ") : `Sec. ${sec}`;
  const pagePart = page ? `p. ${page}` : "";
  return [prefix, secPart, pagePart].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

type WS = ExcelJS.Worksheet;

// A small cursor-based writer over one worksheet.
function makeWriter(ws: WS) {
  let r = 1;
  ws.columns = COL_WIDTHS.map((w) => ({ width: w }));

  const set = (row: number, col: number, value: string | number, opts: Partial<ExcelJS.Style> = {}) => {
    const cell = ws.getCell(row, col);
    cell.value = value === "" ? null : value;
    if (opts.font) cell.font = opts.font;
    if (opts.alignment) cell.alignment = opts.alignment;
    if (opts.fill) cell.fill = opts.fill;
    if (opts.border) cell.border = opts.border;
    return cell;
  };
  const merge = (row: number, c1: number, c2: number) => { if (c2 > c1) ws.mergeCells(row, c1, row, c2); };

  const blank = () => { r += 1; };

  const title = (text: string) => {
    set(r, 1, text, { font: { bold: true, size: 13, color: { argb: INK } } });
    merge(r, 1, LAST_COL); r += 2;
  };

  const section = (text: string) => {
    const c = set(r, 1, text, { font: { bold: true, size: 10.5, color: { argb: INK } }, alignment: { vertical: "middle" }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL } } });
    void c; merge(r, 1, LAST_COL); ws.getRow(r).height = 16; r += 1;
  };

  // label (A:B) | value (C:valEnd, wrapped) | cite (after value, italic faint)
  const kv = (label: string, value: string | number, cite?: AbstractCitation | null, valEnd = 11) => {
    set(r, 1, label, { font: { color: { argb: SUB }, size: 10 } }); merge(r, 1, 2);
    set(r, 3, value, { alignment: { wrapText: true, vertical: "top" }, font: { color: { argb: INK }, size: 10 } }); merge(r, 3, valEnd);
    const cs = citeShort(cite);
    if (cs) { set(r, valEnd + 1, cs, { font: { italic: true, color: { argb: FAINT }, size: 9 } }); merge(r, valEnd + 1, LAST_COL); }
    r += 1;
  };

  return {
    ws,
    get r() { return r; },
    set: (row: number, col: number, value: string | number, opts?: Partial<ExcelJS.Style>) => set(row, col, value, opts),
    merge,
    row: () => r,
    next: () => { r += 1; },
    blank, title, section, kv,
  };
}

function writeTab(ws: WS, a: LeaseAbstract): void {
  const w = makeWriter(ws);
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];

  w.title(`${a.tenantName || ""}${a.dba && a.dba !== a.tenantName ? "   —   " + a.dba : ""}`);

  w.section("Lease – Property / Tenant Information");
  w.kv("Building Name", sv(a.center));
  w.kv("Suite #", sv(a.suite));
  w.kv("Tenant Name", sv(a.tenantName));
  w.kv("DBA", sv(a.dba));
  w.kv("Premises GLA", a.premisesGLA != null || a.currentSF != null ? Number(a.premisesGLA ?? a.currentSF).toLocaleString() : "");
  if (a.mriNumber) w.kv("MRI #", sv(a.mriNumber));
  w.blank();

  if (a.documents?.length) {
    w.section("Lease & Amendments");
    for (const dc of a.documents) {
      const r = w.row();
      w.set(r, 1, mdy(dc.date), { font: { color: { argb: SUB }, size: 9.5 } }); w.merge(r, 1, 2);
      const txt = `${dc.name || ""}${dc.description ? " — " + dc.description : ""}`;
      w.set(r, 3, txt, { alignment: { wrapText: true, vertical: "top" }, font: { color: { argb: INK }, size: 10 } }); w.merge(r, 3, LAST_COL);
      w.next();
    }
    w.blank();
  }

  // Lease Dates + Deposit, side by side (divider at column L = 12).
  {
    const hr = w.row();
    w.set(hr, 1, "LEASE DATES", { font: { bold: true, size: 10, color: { argb: INK } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL } } }); w.merge(hr, 1, 11);
    w.set(hr, 13, "DEPOSIT INFORMATION", { font: { bold: true, size: 10, color: { argb: INK } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL } } }); w.merge(hr, 13, LAST_COL);
    w.next();
    const d = a.dates || {}; const dep = a.deposit || {};
    const left: [string, string, AbstractCitation | null | undefined][] = [
      ["Lease Date", fdate(d.leaseDate), d.leaseDate?.cite],
      ["Open Date", fdate(d.openDate), d.openDate?.cite],
      ["Lease Comm.", fdate(d.leaseCommencement), d.leaseCommencement?.cite],
      ["Cancel", fdate(d.cancelDate), d.cancelDate?.cite],
      ["Insurance Cert. Exp.", sv(dep.insuranceCertExp), null],
      ["Lease Expiration", fdate(d.leaseExpiration), d.leaseExpiration?.cite],
      ["Rent Start Date", fdate(d.rentStartDate), d.rentStartDate?.cite],
    ];
    const right: [string, string][] = [
      ["Non-Cash Deposit", sv(dep.nonCashDeposit)],
      ["Interest Start Date", sv(dep.interestStartDate)],
      ["Last Interest Earned", sv(dep.lastInterestEarnedDate)],
      ["Vendor ID", sv(dep.vendorId)],
      ["", ""],
      ["Cash Deposit", sv(dep.cashDeposit)],
      ["Interest Bearing", sv(dep.interestBearing)],
    ];
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const rr = w.row();
      const l = left[i]; const rt = right[i];
      if (l) {
        w.set(rr, 1, l[0], { font: { color: { argb: SUB }, size: 9.5 } }); w.merge(rr, 1, 2);
        w.set(rr, 3, l[1], { font: { color: { argb: INK }, size: 10 } }); w.merge(rr, 3, 6);
        const cs = citeShort(l[2]); if (cs) { w.set(rr, 7, cs, { font: { italic: true, color: { argb: FAINT }, size: 9 } }); w.merge(rr, 7, 11); }
      }
      if (rt && rt[0]) {
        w.set(rr, 13, rt[0], { font: { color: { argb: SUB }, size: 9.5 } }); w.merge(rr, 13, 16);
        w.set(rr, 17, rt[1], { font: { color: { argb: INK }, size: 10 } }); w.merge(rr, 17, LAST_COL);
      }
      w.next();
    }
    w.blank();
  }

  if (a.noticeAddresses?.length) {
    w.section("Notice Address");
    for (const na of a.noticeAddresses) {
      const rr = w.row();
      w.set(rr, 1, "Lease Address Type", { font: { color: { argb: SUB }, size: 9.5 } }); w.merge(rr, 1, 2);
      w.set(rr, 3, sv(na.type || "Address"), { font: { bold: true, color: { argb: GREEN }, size: 10 } }); w.merge(rr, 3, 7);
      const cs = citeShort(na.cite); if (cs) { w.set(rr, 8, cs, { font: { italic: true, color: { argb: FAINT }, size: 9 } }); w.merge(rr, 8, 11); }
      w.next();
      if (na.name) w.kv("Name:", na.name);
      if (na.attn) w.kv("Attn:", na.attn);
      const addr = [na.address1, na.address2].filter(Boolean).join(", "); if (addr) w.kv("Address", addr);
      w.kv("City / State / Zip", [na.city, na.state, na.zip].filter(Boolean).join(", "));
      if (na.phone) w.kv("Phone", na.phone);
      if (na.email) w.kv("Email", na.email);
    }
    w.blank();
  }

  if (a.options?.length) {
    w.section("Lease – Options");
    const headers = ["Option Number", "Option Date", "Type", "Notice Date", "Suite ID", "Square Feet", "Term Months", "Rate (PSF)", "Rate Descriptor", "Expire Date"];
    const hr = w.row();
    headers.forEach((h, i) => w.set(hr, i + 1, h, { font: { bold: true, size: 9, color: { argb: INK } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }, border: allBorders, alignment: { wrapText: true, vertical: "middle" } }));
    w.next();
    for (const o of a.options as AbstractOption[]) {
      const rr = w.row();
      const cells = [
        sv(o.number ?? (o.ordinal != null ? `${o.ordinal}` : "")), mdy(o.windowStart), sv(o.optionType), mdy(o.noticeDate),
        sv(o.suiteId), o.squareFeet != null ? Number(o.squareFeet).toLocaleString() : "", sv(o.termMonths),
        o.ratePSF != null ? `$${o.ratePSF}` : "", sv(o.rateDescriptor), mdy(o.expireDate ?? o.windowEnd),
      ];
      cells.forEach((c, i) => w.set(rr, i + 1, c, { border: allBorders, font: { size: 9.5, color: { argb: INK } }, alignment: { vertical: "top" } }));
      w.next();
    }
    if (a.optionNotes) {
      const rr = w.row();
      w.set(rr, 1, "Option Notes:", { font: { bold: true, color: { argb: SUB }, size: 9.5 } }); w.merge(rr, 1, 2);
      w.set(rr, 3, a.optionNotes, { alignment: { wrapText: true, vertical: "top" }, font: { color: { argb: INK }, size: 9.5 } }); w.merge(rr, 3, LAST_COL);
      w.next();
    }
    w.blank();
  }

  if (a.rentSchedule?.length) {
    w.section("Billing – Recurring Charges");
    const headers = ["Income Category", "Effective Date", "End Date", "Annual Amount/sf", "Annual Total", "Monthly Amount", "Note"];
    const hr = w.row();
    headers.forEach((h, i) => w.set(hr, i + 1, h, { font: { bold: true, size: 9, color: { argb: INK } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }, border: allBorders, alignment: { wrapText: true, vertical: "middle" } }));
    w.next();
    for (const rs of a.rentSchedule as AbstractRentStep[]) {
      const rr = w.row();
      const psf = rs.amountPerSF ?? rs.psf;
      const cells: (string | number)[] = [
        sv(rs.incomeCategory ?? "RNT"), mdy(rs.periodStart), mdy(rs.periodEnd),
        psf != null ? `$${Number(psf).toFixed(2)}` : "",
        rs.annualRent != null ? `$${Math.round(Number(rs.annualRent)).toLocaleString()}` : "",
        rs.monthlyRent != null ? `$${Number(rs.monthlyRent).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "",
        sv(rs.note),
      ];
      cells.forEach((c, i) => w.set(rr, i + 1, c, { border: allBorders, font: { size: 9.5, color: { argb: INK } }, alignment: { vertical: "top", horizontal: i >= 3 && i <= 5 ? "right" : "left" } }));
      w.next();
    }
    w.blank();
  }

  const pr = a.percentageRentDetail;
  if (pr || a.percentageRent) {
    w.section("Retail – Percentage Rent");
    if (pr) {
      if (pr.summary) w.kv("Summary", pr.summary);
      w.kv("Reporting Frequency", sv(pr.reportingFrequency));
      w.kv("Use Natural Breakpoint", yn(pr.naturalBreakpoint));
      w.kv("% Rent in Lieu of Minimum", yn(pr.inLieuOfMinimum));
      if (pr.salesYearEnd) w.kv("Sales Year End", sv(pr.salesYearEnd));
      if (pr.paymentTiming) w.kv("Percentage Rent Paid", sv(pr.paymentTiming), pr.cite);
      if (pr.breakpoints?.length) {
        const hr = w.row();
        ["Start Date", "Percentage", "Breakpoint"].forEach((h, i) => w.set(hr, i + 1, h, { font: { bold: true, size: 9, color: { argb: INK } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }, border: allBorders }));
        w.next();
        for (const b of pr.breakpoints) {
          const rr = w.row();
          [mdy(b.startDate), sv(b.percentage), b.breakpoint != null ? `$${Number(b.breakpoint).toLocaleString()}` : ""].forEach((c, i) => w.set(rr, i + 1, c, { border: allBorders, font: { size: 9.5, color: { argb: INK } } }));
          w.next();
        }
      }
    } else if (a.percentageRent) {
      w.kv("Percentage Rent", fval(a.percentageRent), a.percentageRent.cite);
    }
    w.blank();
  }

  // Lease Notes: Section | Code | (Category) | Notes (wrapped, full width).
  w.section("Lease Notes");
  {
    const hr = w.row();
    w.set(hr, 1, "Section", { font: { bold: true, size: 9, color: { argb: INK } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }, border: allBorders }); w.merge(hr, 1, 2);
    w.set(hr, 3, "Code", { font: { bold: true, size: 9, color: { argb: INK } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }, border: allBorders });
    w.set(hr, 4, "Category", { font: { bold: true, size: 9, color: { argb: INK } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }, border: allBorders }); w.merge(hr, 4, 6);
    w.set(hr, 7, "Notes", { font: { bold: true, size: 9, color: { argb: INK } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }, border: allBorders }); w.merge(hr, 7, LAST_COL);
    w.next();
    const byCode = new Map((a.leaseNotes || []).map((n) => [n.code, n]));
    for (const sec of LEASE_NOTE_SECTIONS) {
      const n = byCode.get(sec.code); if (!n) continue;
      const rr = w.row();
      w.set(rr, 1, sv(n.cite?.section), { font: { size: 9, color: { argb: SUB } }, border: allBorders, alignment: { vertical: "top" } }); w.merge(rr, 1, 2);
      w.set(rr, 3, sec.code, { font: { size: 9, bold: true, color: { argb: INK } }, border: allBorders, alignment: { vertical: "top" } });
      w.set(rr, 4, `(${sec.label})`, { font: { size: 9, color: { argb: SUB } }, border: allBorders, alignment: { vertical: "top", wrapText: true } }); w.merge(rr, 4, 6);
      w.set(rr, 7, sv(n.value), { font: { size: 9.5, color: { argb: INK } }, border: allBorders, alignment: { vertical: "top", wrapText: true } }); w.merge(rr, 7, LAST_COL);
      w.next();
    }
    w.blank();
  }

  if (a.flags?.length) {
    w.section("KPR Flags — verify these");
    for (const f of a.flags) {
      const rr = w.row();
      const color = f.severity === "defect" ? RED : f.severity === "watch" ? AMBER : GREEN;
      w.set(rr, 1, (f.severity || "note").toUpperCase(), { font: { bold: true, size: 9, color: { argb: color } } }); w.merge(rr, 1, 2);
      w.set(rr, 3, `${f.issue || ""}${f.detail ? " — " + f.detail : ""}`, { alignment: { wrapText: true, vertical: "top" }, font: { size: 9.5, color: { argb: INK } } }); w.merge(rr, 3, LAST_COL);
      w.next();
    }
  }
}

function sheetName(name: string): string {
  return (name || "Sheet").replace(/[\\/?*:[\]]/g, "-").slice(0, 31) || "Sheet";
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

const today = () => new Date().toISOString().slice(0, 10);

// Single tenant → one styled sheet that mirrors the tab.
export async function exportLeaseAbstract(a: LeaseAbstract): Promise<void> {
  const wb = new ExcelJS.Workbook();
  writeTab(wb.addWorksheet(sheetName(a.tenantName || "Abstract")), a);
  const safe = (a.tenantName || "abstract").replace(/[/\\?%*:|"<>]/g, "-").slice(0, 60);
  await downloadWorkbook(wb, `KPR_LeaseAbstract_${safe}_${today()}.xlsx`);
}

// Deal → workbook with one styled tab per tenant.
export async function exportLeaseAbstractsWorkbook(dealName: string, abstracts: LeaseAbstract[]): Promise<void> {
  if (!abstracts.length) return;
  const wb = new ExcelJS.Workbook();
  for (const a of abstracts) writeTab(wb.addWorksheet(sheetName(a.tenantName || a.dba || "Tenant")), a);
  const safe = (dealName || "deal").replace(/[/\\?%*:|"<>]/g, "-").slice(0, 60);
  await downloadWorkbook(wb, `KPR_LeaseAbstracts_${safe}_${today()}.xlsx`);
}
