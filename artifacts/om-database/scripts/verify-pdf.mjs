// Renders TablePDF to REAL PDF bytes and checks the output — the thing a typecheck
// can't tell you. Run from artifacts/om-database:  node scripts/verify-pdf.mjs
//   PDF_OUT=/some/dir node scripts/verify-pdf.mjs   also writes the files out.
//
// The FIRST case is the real Food Lion tenant export (scripts/fixtures/food-lion.json),
// the one whose columns collided — long tenant name, long sales strings, right-aligned
// money next to a left-aligned date. Keep it: layout regressions show up there first.
//
// Lives outside the vitest suite on purpose: vitest.config.ts is deliberately
// plugin-free (see its header) and can't transform .tsx, so the component is bundled
// here with esbuild instead.
import { createRequire } from "node:module";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
const require_ = createRequire(import.meta.url);
const { build } = require_("/home/user/KPR-OM-New/node_modules/.pnpm/esbuild@0.27.3/node_modules/esbuild");

const entry = String.raw`
import { readFileSync, writeFileSync } from "node:fs";
import { pdf } from "@react-pdf/renderer";
import TablePDF from "./src/components/TablePDF.tsx";
import { rollupColumns, rollupTotalRow } from "./src/lib/rollupColumns.ts";

const FL = JSON.parse(readFileSync("./scripts/fixtures/food-lion.json", "utf8"));
const FL_ROWS = FL.map(([property, brand, market, sf, rentPSF, annualRent, start, expiry, sales]) =>
  ({ property, brand, market, sf, rentPSF, annualRent, start, expiry, sales }));
const FL_COLS = rollupColumns("Recorded As");

const COLS = [
  { header: "Property", width: 26, tone: "bold", text: r => String(r.property ?? "-") },
  { header: "SF", width: 10, align: "right", text: r => String(r.sf ?? "-") },
  { header: "Rent", width: 14, align: "right", text: r => String(r.rent ?? "-") },
];
const ROWS = [
  { property: "Winterville Commons", sf: 50887, rent: 1043184 },
  { property: "Brier Creek", sf: 46522, rent: 709931 },
];

const CASES = [
  { name: "REAL Food Lion export", props: {
      title: "Food Lion", kicker: "TENANT SUMMARY",
      subtitle: "Across 15 properties in your database",
      chips: ["ANCHOR · 15", "Credit: Investment Grade"],
      description: "Food Lion is a Southeast U.S. supermarket chain under Ahold Delhaize.",
      kpis: [{ label: "Locations", value: "15" }, { label: "Avg Size (SF)", value: "34,456" },
             { label: "Avg Rent / SF", value: "$8.87" }, { label: "Avg Annual Rent", value: "$305,678" },
             { label: "Avg Sales / SF", value: "$565" }],
      columns: FL_COLS, rows: FL_ROWS, totalRow: rollupTotalRow(FL_COLS, FL_ROWS),
      notes: "Base rent only." } },
  { name: "full (kpis + totals + notes)", props: {
      title: "Lowes Foods", kicker: "TENANT SUMMARY", subtitle: "Across 2 properties",
      chips: ["ANCHOR · 2"], description: "A supermarket chain.",
      kpis: [{ label: "Locations", value: "2" }], columns: COLS, rows: ROWS,
      totalRow: ["TOTAL · 2 locations", "97,409", "$1,753,115"], notes: "Base rent only." } },
  { name: "bare table (no kpis/totals)", props: { title: "Sale Comps", kicker: "COMPS", columns: COLS, rows: ROWS } },
  { name: "empty row set", props: { title: "Empty", kicker: "PORTFOLIO", columns: COLS, rows: [] } },
  { name: "many rows (pagination)", props: { title: "Portfolio", kicker: "PORTFOLIO", columns: COLS,
      rows: Array.from({ length: 120 }, (_, i) => ({ property: "Center " + i, sf: 30000 + i, rent: 400000 + i })) } },
  { name: "pathological long values", props: { title: "Stress", kicker: "PORTFOLIO",
      columns: [{ header: "Name", width: 20, text: r => String(r.a) },
                { header: "Note", width: 20, text: r => String(r.b) }],
      rows: [{ a: "A".repeat(90), b: "Supercalifragilisticexpialidocious ".repeat(4) }] } },
];

const drain = s => new Promise((res, rej) => {
  const b = []; s.on("data", c => b.push(c)); s.on("end", () => res(Buffer.concat(b))); s.on("error", rej);
});

let failed = 0;
for (const c of CASES) {
  try {
    const out = await drain(await pdf(TablePDF(c.props)).toBuffer());
    const ok = out.subarray(0, 5).toString() === "%PDF-" && out.length > 1500;
    console.log((ok ? "  ok  " : " FAIL ") + c.name.padEnd(30) + " " + out.length.toLocaleString() + " bytes");
    if (process.env.PDF_OUT) {
      writeFileSync(process.env.PDF_OUT + "/" + c.name.replace(/[^a-z0-9]+/gi, "-") + ".pdf", out);
    }
    if (!ok) failed++;
  } catch (e) {
    console.log(" FAIL  " + c.name + " - " + e.message);
    failed++;
  }
}
console.log(failed ? ("\n" + failed + " case(s) failed") : "\nAll PDF render cases passed.");
process.exit(failed ? 1 : 0);
`;

// Entry + bundle live INSIDE the package so "@react-pdf/renderer" and the relative
// component imports resolve the way they do in the real app. Cleaned up after.
const entryFile = join(process.cwd(), ".verify-pdf-entry.jsx");
const outFile = join(process.cwd(), ".verify-pdf-bundle.mjs");
writeFileSync(entryFile, entry);
try {
  await build({
    entryPoints: [entryFile], bundle: true, format: "esm", platform: "node",
    outfile: outFile, jsx: "automatic", loader: { ".tsx": "tsx", ".ts": "ts" },
    absWorkingDir: process.cwd(), logLevel: "error",
    // ESM bundle + CommonJS deps (js-md5 etc. call require("crypto")) — give them a
    // real require, and stub the window the component reads its logo URL from.
    banner: { js: [
      `import { createRequire as __cr } from "node:module";`,
      `const require = __cr(import.meta.url);`,
      `globalThis.window ??= { location: { origin: "https://kpr-oms.replit.app" } };`,
    ].join("\n") },
  });
  await import(outFile + `?t=${Date.now()}`);
} finally {
  for (const f of [entryFile, outFile]) rmSync(f, { force: true });
}
