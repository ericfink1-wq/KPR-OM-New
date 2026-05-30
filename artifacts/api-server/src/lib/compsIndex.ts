import { db } from "@workspace/db";
import { compsIndexTable, dealsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { parseLeaseDate } from "./tenantIndex";
import { toFloat, toStr } from "./parsers";

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

// ---------------------------------------------------------------------------
// Sync own-transaction comps (acquisition / disposition) for one deal.
// Idempotent — delete-then-insert pattern; safe to call fire-and-forget.
// ---------------------------------------------------------------------------
export async function syncOwnTransactionComps(
  dealId: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {

    const status      = toStr(data.status);
    const propertyName = toStr(data.propertyName);
    const address     = toStr(data.address);
    const market      = toStr(data.market) ?? toStr(data.state);
    const sf          = toFloat(data.totalSF);
    const occupancy   = toFloat(data.occupancy);
    const propertyType = toStr(data.propertyType);

    // Top-3 tenant names as anchor string
    const tenantList = Array.isArray(data.tenants) ? (data.tenants as Record<string, unknown>[]) : [];
    const anchorNames = tenantList
      .slice(0, 3)
      .map(t => toStr(t.name))
      .filter((n): n is string => n !== null);
    const anchor = anchorNames.length > 0 ? anchorNames.join(", ") : null;

    // ── ACQUISITION ──
    const acqCondition =
      status === "Owned" || status === "Sold" ||
      (data.txnPurchasePrice != null && data.txnCloseDate != null);

    await db.delete(compsIndexTable).where(
      and(eq(compsIndexTable.sourceDealId, dealId), eq(compsIndexTable.txnKind, "acquisition"))
    );

    if (acqCondition) {
      const acqSalePrice = toFloat(data.txnPurchasePrice);
      const acqSaleDate  = parseSaleDate(data.txnCloseDate);
      if (acqSalePrice && acqSalePrice > 0 && acqSaleDate) {
        const acqCapRate = toFloat(data.acqCapRate) ?? toFloat(data.capRate);
        const acqPsf     = sf && sf > 0 ? Math.round(acqSalePrice / sf) : toFloat(data.pricePerSF);
        const seller     = toStr(data.txnSeller);
        const dealState = toStr(data.state);
        await db.insert(compsIndexTable).values({
          sourceDealId: dealId, sourceDealName: propertyName, sourceDealMarket: market,
          name: propertyName, address, market, state: dealState,
          saleDateRaw: toStr(data.txnCloseDate), saleDate: acqSaleDate,
          salePrice: acqSalePrice, capRate: acqCapRate, pricePerSf: acqPsf,
          sf, occupancy, isManual: false, isOwnTransaction: true, txnKind: "acquisition",
          anchor, propertyType,
          seller, buyer: null,
          sourceNotes: "KPR acquisition" + (seller ? `, seller: ${seller}` : ""),
        });
      }
    }

    // ── DISPOSITION ──
    const dispCondition =
      status === "Sold" ||
      (data.txnSalePrice != null && data.txnSaleDate != null);

    await db.delete(compsIndexTable).where(
      and(eq(compsIndexTable.sourceDealId, dealId), eq(compsIndexTable.txnKind, "disposition"))
    );

    if (dispCondition) {
      const dispSalePrice = toFloat(data.txnSalePrice);
      const dispSaleDate  = parseSaleDate(data.txnSaleDate);
      if (dispSalePrice && dispSalePrice > 0 && dispSaleDate) {
        const dispCapRate = toFloat(data.dispExitCap);
        const dispPsf     = sf && sf > 0 ? Math.round(dispSalePrice / sf) : null;
        const buyer       = toStr(data.txnBuyer);
        const dealState = toStr(data.state);
        await db.insert(compsIndexTable).values({
          sourceDealId: dealId, sourceDealName: propertyName, sourceDealMarket: market,
          name: propertyName, address, market, state: dealState,
          saleDateRaw: toStr(data.txnSaleDate), saleDate: dispSaleDate,
          salePrice: dispSalePrice, capRate: dispCapRate, pricePerSf: dispPsf,
          sf, occupancy, isManual: false, isOwnTransaction: true, txnKind: "disposition",
          anchor, propertyType,
          buyer, seller: null,
          sourceNotes: "KPR disposition" + (buyer ? `, buyer: ${buyer}` : ""),
        });
      }
    }
  } catch {
    // Non-fatal
  }
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
    // Only wipe OM-derived rows; manual and own-transaction rows survive
    await db.delete(compsIndexTable).where(
      and(
        eq(compsIndexTable.sourceDealId, dealId),
        eq(compsIndexTable.isOwnTransaction, false),
        eq(compsIndexTable.isManual, false),
      )
    );

    const comps = data.comparableSales as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(comps) && comps.length > 0) {
      const sourceDealName = typeof data.propertyName === "string" ? data.propertyName : null;
      const sourceDealMarket = typeof data.market === "string" ? data.market : null;

      const rows = comps.map((c) => {
        const saleDateRaw = typeof c.saleDate === "string" && c.saleDate ? c.saleDate : null;
        const market =
          (typeof c.market === "string" && c.market.trim() ? c.market.trim() : null)
          ?? sourceDealMarket;
        const compState =
          (typeof c.state === "string" && c.state.trim() ? c.state.trim() : null)
          ?? (market ? (/,\s*([A-Z]{2})\s*$/.exec(market)?.[1] ?? null) : null);
        return {
          sourceDealId: dealId,
          sourceDealName,
          sourceDealMarket,
          name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : null,
          address: typeof c.address === "string" && c.address.trim() ? c.address.trim() : null,
          market,
          state: compState,
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
    }

    // Refresh own-transaction comps after OM comps are updated
    await syncOwnTransactionComps(dealId, data);
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
