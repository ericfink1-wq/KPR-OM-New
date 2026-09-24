// KPR Transfer Tax Answer Key v01 (Eric, 9/24/26) — an audit of every KPR-owned
// property plus a few reference jurisdictions. EVERY row must match the engine within
// 0.001 percentage points, or the build fails (CI runs this suite on every push).
//
// Measured at a $25M price (the key's own convention — its Maine row is "0.585% each
// side at $25M" and NJ's 4.7% is the $25M figure), loan-based taxes excluded (the key
// is deed transfer taxes only), closing today-ish (fixed date so the test is stable).
//
// The jurisdiction for each row comes from the US Census geocoder (layers=all), exactly
// as the app resolves it — see fixtures/transfer-tax-answer-key.geo.json (a few rows the
// geocoder could not match are hand-assigned and say so in `basis`).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getJurisdictionFull, estimateClosingCosts, transferTaxPct, type ResolvedJurisdiction } from "../closingCosts";

const FIX = join(__dirname, "fixtures");

/** Minimal RFC-4180 CSV parser (quoted fields, embedded commas/quotes). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const KEY = parseCsv(readFileSync(join(FIX, "transfer-tax-answer-key.csv"), "utf8"));
const GEO = JSON.parse(readFileSync(join(FIX, "transfer-tax-answer-key.geo.json"), "utf8")) as Record<string, ResolvedJurisdiction & { basis: string }>;

const PRICE = 25_000_000;
const TOLERANCE_PCT_POINTS = 0.001;
const CLOSING = "2026-09-24";

describe("KPR Transfer Tax Answer Key v01", () => {
  it("has every row and a resolved jurisdiction for each", () => {
    expect(KEY.length).toBe(49);
    for (const r of KEY) expect(GEO[r.property], `no geo fixture for ${r.property}`).toBeTruthy();
  });

  for (const r of KEY) {
    it(`${r.property} (${r.state}, ${r.taxing_jurisdiction}) → seller ${r.seller_pct}% / buyer ${r.buyer_pct}%`, async () => {
      const j = await getJurisdictionFull(r.state);
      const b = estimateClosingCosts(j, PRICE, 0, GEO[r.property], { closingDate: CLOSING });
      // The locality must be positively resolved — a range is never an answer.
      expect(b.local.status, `local rate not verified: ${b.local.unverified.map((u) => u.reason).join("; ")}`).not.toBe("unverified");
      const { seller, buyer } = transferTaxPct(b);
      expect(Math.abs(seller - Number(r.seller_pct)), `seller ${seller.toFixed(5)}% vs key ${r.seller_pct}%`).toBeLessThanOrEqual(TOLERANCE_PCT_POINTS);
      expect(Math.abs(buyer - Number(r.buyer_pct)), `buyer ${buyer.toFixed(5)}% vs key ${r.buyer_pct}%`).toBeLessThanOrEqual(TOLERANCE_PCT_POINTS);
    });
  }
});
