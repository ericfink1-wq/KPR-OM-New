import * as XLSX from "xlsx";
import type { Deal, CashFlowRow } from "./idb";

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

export function exportDealToExcel(deal: Deal): void {
  const wb = XLSX.utils.book_new();

  // ─── Sheet 1: Rent Roll ────────────────────────────────────────────────
  const tenants = deal.tenants ?? [];
  const rrHeaders = [
    "Tenant",
    "Anchor?",
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
    t.creditRating ?? "",
    safeNum(t.sf),
    safeNum(t.rentPerSF),
    safeNum(t.annualRent),
    fmtDate(t.leaseStart),
    fmtDate(t.leaseExpiry),
    safeNum(t.remainingTermYears),
    t.leaseType ?? "",
    t.renewalOptions ?? "",
    t.rentBumps ?? "",
    safeNum(t.salesPSF),
    t.assumptionNote ?? "",
  ]);

  const rrAoa = [rrHeaders, ...rrRows];
  const rrWs = XLSX.utils.aoa_to_sheet(rrAoa);

  rrWs["!cols"] = [
    { wch: 32 }, // Tenant
    { wch: 8 },  // Anchor
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
    applyFmt(rrWs, row, 3, "#,##0");         // SF
    applyFmt(rrWs, row, 4, '$#,##0.00');     // Rent/SF
    applyFmt(rrWs, row, 5, '$#,##0');        // Annual Rent
    applyFmt(rrWs, row, 12, '$#,##0.00');    // Sales PSF
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
