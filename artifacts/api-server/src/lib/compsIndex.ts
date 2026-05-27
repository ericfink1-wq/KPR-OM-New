import { db } from "@workspace/db";
import { compsIndexTable, dealsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { parseLeaseDate } from "./tenantIndex";

// ---------------------------------------------------------------------------
// Sale-date parser — extends parseLeaseDate with year-only and quarter formats
// ---------------------------------------------------------------------------
export function parseSaleDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Qn YYYY  (e.g. "Q2 2022", "Q4-2019")
  const quarter = s.match(/^Q([1-4])[\s\-](\d{4})$/i);
  if (quarter) {
    const qMonth = ["01", "04", "07", "10"][parseInt(quarter[1]) - 1];
    return `${quarter[2]}-${qMonth}-01`;
  }

  // YYYY only (e.g. "2022")
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;

  // Delegate remaining formats (YYYY-MM-DD, YYYY-MM, MM/DD/YYYY, Mon-YYYY, etc.)
  return parseLeaseDate(s);
}

function toFloat(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Rebuild all comps_index rows for one deal.
// Safe to call fire-and-forget — errors are caught internally.
// ---------------------------------------------------------------------------
export async function rebuildCompsIndex(
  dealId: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await db.delete(compsIndexTable).where(eq(compsIndexTable.sourceDealId, dealId));

    const comps = data.comparableSales as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(comps) || comps.length === 0) return;

    const sourceDealName = typeof data.propertyName === "string" ? data.propertyName : null;
    const sourceDealMarket = typeof data.market === "string" ? data.market : null;

    const rows = comps.map((c) => {
      const saleDateRaw = typeof c.saleDate === "string" && c.saleDate ? c.saleDate : null;
      // market: use comp's own market if present, else fall back to source deal's market
      const market =
        (typeof c.market === "string" && c.market.trim() ? c.market.trim() : null)
        ?? sourceDealMarket;
      return {
        sourceDealId: dealId,
        sourceDealName,
        sourceDealMarket,
        name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : null,
        address: typeof c.address === "string" && c.address.trim() ? c.address.trim() : null,
        market,
        saleDateRaw,
        saleDate: parseSaleDate(saleDateRaw),
        salePrice: toFloat(c.salePrice),
        capRate: toFloat(c.capRate),
        pricePerSf: toFloat(c.pricePerSF),
        sf: toFloat(c.sf),
        occupancy: toFloat(c.occupancy),
      };
    });

    await db.insert(compsIndexTable).values(rows);
  } catch {
    // Non-fatal — mirror table; don't break deal writes
  }
}

// ---------------------------------------------------------------------------
// Full backfill — rebuilds comps_index from all deals in the DB
// ---------------------------------------------------------------------------
export async function rebuildAllComps(): Promise<number> {
  const deals = await db.select().from(dealsTable);
  let count = 0;
  for (const deal of deals) {
    const data = deal.data as Record<string, unknown>;
    if (data._processing) continue;
    await rebuildCompsIndex(deal.id, data);
    const comps = data.comparableSales;
    if (Array.isArray(comps)) count += comps.length;
  }
  return count;
}
