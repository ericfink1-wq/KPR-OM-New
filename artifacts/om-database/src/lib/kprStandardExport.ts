// KPR STANDARD RENT ROLL (Excel) — the same columns, in the same order, with the same
// flags and benchmarks for EVERY OM, whatever the broker's format (Eric, 10/18/26).
// The row/summary content is pure (standardRentRollRows / standardSummaryRows, tested);
// the workbook is just formatting on top. Lazy-loaded from the deal page.
import ExcelJS from "exceljs";
import type { Deal, Tenant } from "./idb";
import { FLAG_META, FLAG_ORDER, isProposedTenant, type ScrubRow, type ScrubSummary } from "./rosterScrub";
import { isVacant, isNAPTenant, isNonGLA, toStepString } from "./utils";
import { isInvestmentGrade } from "./tenantCredit";

export const STANDARD_COLUMNS = [
  "Suite", "Tenant", "Status", "SF", "% of GLA", "Rent / SF", "Annual base rent", "% of base rent",
  "Lease start", "Lease expiry", "Remaining (yrs)", "Lease type / recoveries", "Next rent step", "Renewal options",
  "Sales / SF", "Occupancy cost %", "Credit", "Anchor", "Market rent / SF", "Benchmark basis", "Vs market %", "Mark-to-market $/yr", "Flags",
] as const;

const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const statusOf = (t: Tenant) => isVacant(t.name) ? "Vacant" : isNAPTenant(t) ? "NAP" : isProposedTenant(t) ? "Proposed / unsigned" : t.isDark ? "Dark (paying)" : t.leaseStatus === "signed-not-open" ? "Signed, not open" : isNonGLA(t) ? "Non-GLA" : "In place";

export function standardRentRollRows(deal: Deal, scrub: { rows: ScrubRow[]; summary: ScrubSummary }, today = new Date()): Array<Array<string | number | null>> {
  const byTenant = new Map(scrub.rows.map(r => [r.tenant, r]));
  const gla = scrub.summary.gla || null, rent = scrub.summary.inPlaceRent || null;
  const t0 = today.getTime();
  return (deal.tenants ?? []).filter(Boolean).map(t => {
    const sr = byTenant.get(t), sf = num(t.sf), ar = num(t.annualRent), psf = num(t.rentPerSF);
    const exp = t.leaseExpiry && /^\d{4}-\d{2}-\d{2}/.test(t.leaseExpiry) ? t.leaseExpiry.slice(0, 10) : null;
    const st = statusOf(t), counted = st !== "Vacant" && st !== "NAP" && st !== "Proposed / unsigned";
    const vs = sr?.bench.rentMedian && psf ? Math.round((psf / sr.bench.rentMedian - 1) * 1000) / 10 : null;
    return [
      t.suite ?? null, t.canonicalName || t.name || "", st, sf, sf != null && gla && !isNonGLA(t) ? Math.round((sf / gla) * 1000) / 10 : null,
      psf, ar, ar != null && rent && counted ? Math.round((ar / rent) * 1000) / 10 : null,
      t.leaseStart ?? null, exp, exp ? Math.max(0, Math.round(((Date.parse(exp) - t0) / (365.25 * 86_400_000)) * 10) / 10) : null,
      [t.leaseType, t.reimbursementMethod].filter(Boolean).join(" — ").slice(0, 160) || null,
      sr?.nextStep?.label.replace(/^→ /, "") ?? null, (toStepString(t.renewalOptions) || "").slice(0, 160) || null,
      num(t.salesPSF), num(t.occupancyCost), t.creditRating || (t.name && isInvestmentGrade(t.name, t.creditRating) ? "Investment grade" : null), t.isAnchor ? "Yes" : null,
      sr?.bench.rentMedian ?? null, sr?.bench.rentMedian ? `${sr.bench.basisLabel} (n=${sr.bench.rentN})` : null, vs, sr?.mtm ?? null,
      sr ? FLAG_ORDER.filter(f => sr.flags.includes(f)).map(f => FLAG_META[f].label).join(", ") || null : null,
    ];
  });
}

export function standardSummaryRows(deal: Deal, s: ScrubSummary): Array<[string, string | number | null, string?]> {
  const $ = (v: number | null | undefined) => (v == null ? null : Math.round(v));
  return [
    ["Property", deal.propertyName ?? null],
    ["Location", [deal.address, deal.city, deal.state].filter(Boolean).join(", ") || null],
    ["Center type", deal.centerType ?? null],
    ["Rent roll as of", deal.tenantsAsOf ?? deal.omDate ?? null],
    ["GLA (SF)", $(s.gla)],
    ["Leased % (excl. proposed)", s.leasedPct, "%"], ["Physically open %", s.openPct, "%"],
    ["In-place base rent ($/yr, excl. proposed)", $(s.inPlaceRent)],
    ["Investment-grade share of rent", s.igRentPct, "%"], ["Top-5 tenant concentration", s.top5Pct, "%"],
    ["WALT (yrs, SF-weighted)", s.walt],
    ["Rent rolling ≤12 mo", s.roll12Pct, "%"], ["Rent rolling ≤24 mo", s.roll24Pct, "%"], ["Rent rolling ≤36 mo", s.roll36Pct, "%"],
    ["Tenants below market (n)", s.belowN], ["Below-market gap ($/yr, to market)", $(s.belowAnnual)],
    ["Tenants above market (n)", s.aboveN], ["Above-market premium ($/yr, at risk at renewal)", $(-s.aboveAnnual)],
    ["Tenants with a market benchmark", s.benchmarked],
    ["Tenants reporting sales", s.salesReporting], ["Weighted occupancy cost", s.wtdOccCost, "%"],
    ["No remaining options (stated)", s.noOptionsN], ["Options not stated", s.optionsUnknownN],
    ["Kickout / early termination", s.kickoutN], ["Co-tenancy", s.cotenancyN],
    ["Rent mix — NNN / fixed CAM", s.mix.nnn, "%"], ["Rent mix — gross", s.mix.gross, "%"], ["Rent mix — modified gross", s.mix.mg, "%"], ["Rent mix — not stated", s.mix.unknown, "%"],
    ["Proposed / unsigned (pipeline)", s.proposed.n ? `${s.proposed.n} tenants · ${s.proposed.sf.toLocaleString()} SF · $${s.proposed.rent.toLocaleString()}/yr` : "none"],
  ];
}

const CHAR = "FF383A37", GREEN = "FF5BBA47", PAGE = "FFFAF9F5", LINE = "FFE7E5DF";
export async function exportKprStandardRentRoll(deal: Deal, scrub: { rows: ScrubRow[]; summary: ScrubSummary }): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "KPR Deal Intelligence";
  const font = { name: "Roboto", size: 10 };

  const sum = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  sum.columns = [{ width: 46 }, { width: 44 }];
  sum.addRow(["KPR STANDARD RENT ROLL — ROSTER SCRUB"]).font = { name: "Montserrat", size: 12, bold: true, color: { argb: CHAR } };
  sum.addRow([`${deal.propertyName ?? ""} · generated ${new Date().toISOString().slice(0, 10)}`]).font = { ...font, italic: true, color: { argb: "FF676767" } };
  sum.addRow([]);
  for (const [label, value, unit] of standardSummaryRows(deal, scrub.summary)) {
    const r = sum.addRow([label, value == null ? "—" : unit === "%" && typeof value === "number" ? value / 100 : value]);
    r.font = font; r.getCell(1).font = { ...font, color: { argb: "FF676767" } };
    if (unit === "%" && typeof value === "number") r.getCell(2).numFmt = "0.0%";
    else if (typeof value === "number" && Math.abs(value) >= 1000) r.getCell(2).numFmt = "#,##0";
    r.getCell(2).alignment = { horizontal: "right" };
    r.eachCell(c => { c.border = { bottom: { style: "thin", color: { argb: LINE } } }; });
  }
  sum.addRow([]);
  sum.addRow(["Notes"]).font = { name: "Montserrat", size: 10, bold: true };
  for (const n of [
    "Proposed / unsigned leases are excluded from occupancy and in-place rent; they are listed as pipeline.",
    "Market rent = median in-place rent for the same brand at other centers in the KPR library; else same category + size band; else same state + size band. n = locations.",
    "Below-market and above-market gaps are reported separately and never netted: above-market rent can reset down at renewal; below-market rent is only capturable at expiry when no fixed options lock it.",
  ]) sum.addRow([n]).font = { ...font, color: { argb: "FF676767" } };

  const ws = wb.addWorksheet("Rent Roll", { views: [{ state: "frozen", xSplit: 2, ySplit: 1, showGridLines: false }] });
  const widths = [8, 30, 16, 10, 8, 9, 13, 9, 11, 11, 9, 34, 16, 30, 10, 10, 14, 7, 11, 30, 9, 13, 34];
  ws.columns = STANDARD_COLUMNS.map((h, i) => ({ header: h, width: widths[i] }));
  const head = ws.getRow(1);
  head.font = { name: "Montserrat", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
  head.height = 30;
  head.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CHAR } }; c.alignment = { vertical: "middle", wrapText: true }; });
  const rows = standardRentRollRows(deal, scrub);
  rows.forEach((v, i) => {
    const r = ws.addRow(v);
    r.font = font;
    if (i % 2) r.eachCell({ includeEmpty: true }, c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PAGE } }; });
    const st = String(v[2]);
    if (st === "Vacant") r.font = { ...font, italic: true, color: { argb: "FF8B8578" } };
    if (st.startsWith("Proposed")) r.font = { ...font, italic: true, color: { argb: "FFA8640F" } };
  });
  const fmt: Record<number, string> = { 4: "#,##0", 5: "0.0", 6: "$#,##0.00", 7: "$#,##0", 8: "0.0", 11: "0.0", 15: "$#,##0", 16: "0.0", 19: "$#,##0.00", 21: "0.0", 22: "$#,##0;[Red]-$#,##0" };
  for (const [col, f] of Object.entries(fmt)) ws.getColumn(Number(col)).numFmt = f;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: STANDARD_COLUMNS.length } };
  // Totals
  const s = scrub.summary;
  const tot = ws.addRow(["", "Totals (excl. proposed)", `${s.tenantCount} tenants`, s.leasedSF, s.leasedPct, s.leasedSF ? Math.round((s.inPlaceRent / s.leasedSF) * 100) / 100 : null, s.inPlaceRent, 100, "", "", s.walt]);
  tot.font = { ...font, bold: true }; tot.eachCell(c => { c.border = { top: { style: "medium", color: { argb: GREEN } } }; });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `KPR_Standard_Rent_Roll_${String(deal.propertyName ?? "deal").replace(/[^A-Za-z0-9]+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
