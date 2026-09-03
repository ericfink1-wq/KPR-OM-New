// Locations-table columns shared by the tenant and parent-company roll-up pages.
// ONE definition drives both the PDF and the Excel file, so they can't drift.
// Lives in lib/ (not the component) so the layout tests can import it without a
// JSX transform — vitest here is deliberately plugin-free.
import { n0, m0, m2, type ExportCol } from "./tableExport";

export function rollupColumns(brandHeader: string): ExportCol[] {
  return [
    { header: "Property",     width: 26, tone: "bold",  text: r => String(r.property ?? "—") },
    { header: brandHeader,    width: 20,                text: r => String(r.brand ?? "—") },
    { header: "Market",       width: 20, tone: "faint", text: r => String(r.market ?? "—") },
    { header: "SF",           width: 10, align: "right", text: r => n0(r.sf),      value: r => (r.sf as number) ?? "",         fmt: "#,##0" },
    { header: "Rent / SF",    width: 10, align: "right", tone: "money", text: r => m2(r.rentPSF), value: r => (r.rentPSF as number) ?? "", fmt: "$#,##0.00" },
    { header: "Annual Rent",  width: 13, align: "right", text: r => m0(r.annualRent), value: r => (r.annualRent as number) ?? "", fmt: "$#,##0" },
    { header: "Start",        width: 11,                text: r => String(r.start ?? "—") },
    { header: "Expiry",       width: 11,                text: r => String(r.expiry ?? "—") },
    { header: "Sales",        width: 19, align: "right", text: r => String(r.sales ?? "—") },
  ];
}

/** Blended totals row for the roll-up tables. */
export function rollupTotalRow(cols: ExportCol[], rows: Record<string, unknown>[]): string[] {
  const sum = (k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const sf = sum("sf"), rent = sum("annualRent");
  return cols.map(col =>
    col.header === "Property"    ? `TOTAL · ${rows.length} ${rows.length === 1 ? "location" : "locations"}`
    : col.header === "SF"          ? n0(sf)
    : col.header === "Rent / SF"   ? (sf > 0 ? m2(rent / sf) : "—")
    : col.header === "Annual Rent" ? m0(rent)
    : "");
}

