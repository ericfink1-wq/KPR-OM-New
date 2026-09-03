
import { pdf } from "@react-pdf/renderer";
import TablePDF from "./src/components/TablePDF.tsx";
const COLS = [
  { header: "Property", width: 26, tone: "bold", text: r => String(r.property ?? "—") },
  { header: "SF", width: 10, align: "right", text: r => String(r.sf ?? "—") },
  { header: "Rent", width: 14, align: "right", text: r => String(r.rent ?? "—") },
];
const ROWS = [
  { property: "Winterville Commons", sf: 50887, rent: 1043184 },
  { property: "Brier Creek", sf: 46522, rent: 709931 },
];
const CASES = [{ name: "full (kpis + totals + notes)", props: {
      title: "Lowes Foods", kicker: "TENANT SUMMARY",
      subtitle: "Across 2 properties in your database",
      chips: ["ANCHOR · 2", "Credit: Investment Grade"],
      description: "A Southeast supermarket chain under Ahold Delhaize.",
      kpis: [{ label: "Locations", value: "2" }, { label: "Avg Rent / SF", value: "$13.20" }],
      columns: COLS, rows: ROWS,
      totalRow: ["TOTAL · 2 locations", "97,409", "$1,753,115"],
      notes: "Base rent only.",
    } },
{ name: "bare table (no kpis, no totals)", props: { title: "Sale Comps", kicker: "COMPS", columns: COLS, rows: ROWS } },
{ name: "empty row set", props: { title: "Empty", kicker: "PORTFOLIO", columns: COLS, rows: [] } },
{ name: "many rows (pagination)", props: { title: "Portfolio", kicker: "PORTFOLIO", columns: COLS,
      rows: Array.from({ length: 120 }, (_, i) => ({ property: "Center " + i, sf: 30000 + i, rent: 400000 + i })) } }];
const drain = s => new Promise((res, rej) => { const b = []; s.on("data", c => b.push(c)); s.on("end", () => res(Buffer.concat(b))); s.on("error", rej); });
let failed = 0;
for (const c of CASES) {
  try {
    const out = await drain(await pdf(TablePDF(c.props)).toBuffer());
    const ok = out.subarray(0, 5).toString() === "%PDF-" && out.length > 1500;
    if (process.env.PDF_OUT) { (await import("node:fs")).writeFileSync(process.env.PDF_OUT + "/" + c.name.replace(/[^a-z0-9]+/gi, "-") + ".pdf", out); }
    console.log(`${ok ? "  ok  " : " FAIL "} ${c.name.padEnd(34)} ${out.length.toLocaleString()} bytes`);
    if (!ok) failed++;
  } catch (e) { console.log(` FAIL  ${c.name} — ${e.message}`); failed++; }
}
console.log(failed ? `\n${failed} case(s) failed` : "\nAll PDF render cases passed.");
process.exit(failed ? 1 : 0);
