import { Router } from "express";
import { db } from "@workspace/db";
import { tenantIndexTable, dealsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import type { TenantIndexRow } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { ensureTenantIndexColumns } from "../lib/tenantIndex";
import { parseDealIds } from "../lib/queryParams";
import { creditBucket, brandFamilyKey, brandDisplayName } from "../lib/tenantCredit";

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumRent(rows: TenantIndexRow[]): number {
  return rows.reduce((s, r) => s + (r.annualRent ?? 0), 0);
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

// parseDealIds lives in lib/queryParams (pure, no DB import) so it's unit-testable.

// Datex mode (Eric, 10/16/26: "Owned figures are as of each OM — ideally pull Owned
// rollover from Datex"). For a deal whose stored Datex snapshot carries its billed
// tenants, those tenants REPLACE the OM roster in the roll-up: today's rents and
// expiries. Anchor / canonical name / credit come from the OM roster row of the same
// brand when one exists (Datex doesn't carry them); a 20k+ SF box counts as an anchor.
export function datexRowsFor(
  dealId: string,
  datexTenants: Array<{ name?: string | null; sf?: number | null; annualRent?: number | null; leaseExpiry?: string | null }>,
  omRows: TenantIndexRow[],
): TenantIndexRow[] {
  const byBrand = new Map<string, TenantIndexRow>();
  for (const r of omRows) { const k = brandFamilyKey(r.canonicalName || r.rawName); if (k && !byBrand.has(k)) byBrand.set(k, r); }
  return datexTenants
    .filter(t => t && t.name && !/^(vacant|available)\b/i.test(String(t.name).trim()))
    .map(t => {
      const om = byBrand.get(brandFamilyKey(t.name));
      const sf = typeof t.sf === "number" ? t.sf : null;
      const exp = typeof t.leaseExpiry === "string" && /^\d{4}-\d{2}/.test(t.leaseExpiry) ? t.leaseExpiry.slice(0, 10) : null;
      return {
        ...(om ?? {}),
        dealId,
        rawName: String(t.name).replace(/\s*#\s*\d+\s*$/, "").trim(),   // Datex names carry store numbers
        canonicalName: om?.canonicalName ?? null,
        annualRent: typeof t.annualRent === "number" ? t.annualRent : null,
        leaseExpiryDate: exp,
        sf,
        isAnchor: om?.isAnchor ?? (sf != null && sf >= 20000),
        creditRating: om?.creditRating ?? null,
      } as TenantIndexRow;
    });
}

function computeAnalytics(rows: TenantIndexRow[]) {
  // Exclude vacant and rows with no name
  const tenantRows = rows.filter(
    r => r.rawName && !/^vacant/i.test(r.rawName.trim())
  );

  // Rows that have usable rent data
  const withRent = tenantRows.filter(r => r.annualRent != null && r.annualRent > 0);
  const totalRent = sumRent(withRent);
  const dealIds = new Set(rows.map(r => r.dealId));

  // ---- Lease Expiration Waterfall ----------------------------------------
  const byYear = new Map<string, { annualRent: number; count: number }>();
  for (const r of withRent) {
    let year = "Unknown";
    if (r.leaseExpiryDate) {
      const y = String(r.leaseExpiryDate).slice(0, 4);
      if (/^\d{4}$/.test(y)) year = y;
    }
    const existing = byYear.get(year) ?? { annualRent: 0, count: 0 };
    byYear.set(year, {
      annualRent: existing.annualRent + (r.annualRent ?? 0),
      count: existing.count + 1,
    });
  }
  const leaseExpiration = [...byYear.entries()]
    .sort(([a], [b]) => {
      if (a === "Unknown") return 1;
      if (b === "Unknown") return -1;
      return parseInt(a) - parseInt(b);
    })
    .map(([year, v]) => ({
      year,
      annualRent: v.annualRent,
      pct: pct(v.annualRent, totalRent),
      tenantCount: v.count,
    }));

  // ---- Tenant Concentration -----------------------------------------------
  // Group by BRAND, not raw roster spelling: hand-made links (canonicalName) first,
  // then brandFamilyKey, so "Giant Food Stores" and "Giant" are one tenant and
  // "HOME DEPOT" / "The Home Depot" don't split (Eric, 10/16/26). The label is the
  // highest-rent spelling, de-shouted.
  const byTenant = new Map<string, { rent: number; labels: Map<string, number> }>();
  for (const r of withRent) {
    const name = r.canonicalName || r.rawName || "Unknown";
    const key = brandFamilyKey(name) || name;
    const e = byTenant.get(key) ?? { rent: 0, labels: new Map<string, number>() };
    e.rent += r.annualRent ?? 0;
    e.labels.set(name, (e.labels.get(name) ?? 0) + (r.annualRent ?? 0));
    byTenant.set(key, e);
  }
  const topTenants = [...byTenant.values()]
    .sort((a, b) => b.rent - a.rent)
    .slice(0, 10)
    .map(e => {
      const label = [...e.labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown";
      return { name: brandDisplayName(label), annualRent: e.rent, pct: pct(e.rent, totalRent) };
    });

  const anchors = withRent.filter(r => r.isAnchor === true);
  const anchorRent = sumRent(anchors);
  const anchorNames = new Set(anchors.map(r => brandFamilyKey(r.canonicalName || r.rawName) || r.canonicalName || r.rawName));

  // ---- Credit Mix ---------------------------------------------------------
  const CREDIT_ORDER = ["Investment Grade", "Non-Investment Grade", "Unrated"] as const;
  const creditMap = new Map<string, { annualRent: number; count: number }>();
  for (const r of withRent) {
    // Same brand list + rating rules as the home page (shared tenantCredit.ts), so
    // the two can't disagree — a typed-in rating alone left TJX, Ross, Kroger etc. "Unrated".
    const label = creditBucket(r.canonicalName || r.rawName || "", r.creditRating);
    const e = creditMap.get(label) ?? { annualRent: 0, count: 0 };
    creditMap.set(label, { annualRent: e.annualRent + (r.annualRent ?? 0), count: e.count + 1 });
  }
  const creditMix = CREDIT_ORDER
    .filter(l => creditMap.has(l))
    .map(l => ({
      label: l,
      annualRent: creditMap.get(l)!.annualRent,
      pct: pct(creditMap.get(l)!.annualRent, totalRent),
      count: creditMap.get(l)!.count,
    }));

  return {
    summary: {
      totalAnnualRent: totalRent,
      rentedTenantCount: withRent.length,
      totalTenantCount: tenantRows.length,
      dealCount: dealIds.size,
    },
    leaseExpiration,
    tenantConcentration: {
      topTenant: topTenants[0] ?? null,
      top5Pct: topTenants.slice(0, 5).reduce((s, t) => s + t.pct, 0),
      topTenants: topTenants.slice(0, 5),
      anchorRent,
      anchorPct: pct(anchorRent, totalRent),
      anchorCount: anchorNames.size,
    },
    creditMix,
  };
}

// ---------------------------------------------------------------------------
// GET /api/analytics/portfolio
// Query params:
//   dealId[]=<id>  — one or more deal IDs to restrict the dataset
//   (no dealId)   — all deals
// ---------------------------------------------------------------------------
router.get("/analytics/portfolio", requireAuth, async (req, res) => {
  try {
    await ensureTenantIndexColumns();
    const dealIds = parseDealIds(req.query.dealId);

    if (dealIds && dealIds.length === 0) {
      res.json(computeAnalytics([]));
      return;
    }

    let rows = dealIds
      ? await db.select().from(tenantIndexTable).where(inArray(tenantIndexTable.dealId, dealIds))
      : await db.select().from(tenantIndexTable);

    // ?source=datex (Owned view): swap in each deal's live Datex tenants where a snapshot exists.
    let datex: { deals: number; of: number; asOf: string | null } | undefined;
    if (req.query.source === "datex" && dealIds && dealIds.length) {
      const deals = await db.select({ id: dealsTable.id, data: dealsTable.data }).from(dealsTable).where(inArray(dealsTable.id, dealIds));
      let n = 0; let latest: string | null = null;
      for (const d of deals) {
        const live = (d.data as Record<string, unknown>)?.datexLive as { tenants?: Array<Record<string, unknown>>; asOf?: string | null } | undefined;
        const ts = Array.isArray(live?.tenants) ? live!.tenants! : [];
        if (!ts.some(t => typeof t.annualRent === "number" && (t.annualRent as number) > 0)) continue;
        const om = rows.filter(r => r.dealId === d.id);
        rows = rows.filter(r => r.dealId !== d.id).concat(datexRowsFor(d.id, ts as never, om));
        n++;
        if (live?.asOf && (!latest || String(live.asOf) > latest)) latest = String(live.asOf).slice(0, 10);
      }
      datex = { deals: n, of: dealIds.length, asOf: latest };
    }

    res.json({ ...computeAnalytics(rows), ...(datex ? { datex } : {}) });
  } catch (err) {
    req.log.error({ err }, "Failed to compute portfolio analytics");
    res.status(500).json({ error: "Failed to compute portfolio analytics" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/rollover-detail
// Query params:
//   year=2027       — expiry year to drill into, or "Unknown"
//   dealId[]=<id>   — optional deal filter (same as /portfolio)
// ---------------------------------------------------------------------------
router.get("/analytics/rollover-detail", requireAuth, async (req, res) => {
  try {
    await ensureTenantIndexColumns();
    const year = typeof req.query.year === "string" ? req.query.year : null;
    if (!year) {
      res.status(400).json({ error: "year query param is required" });
      return;
    }

    const dealIds = parseDealIds(req.query.dealId);

    const baseRows = dealIds && dealIds.length > 0
      ? await db.select().from(tenantIndexTable).where(inArray(tenantIndexTable.dealId, dealIds))
      : await db.select().from(tenantIndexTable);

    const tenants = baseRows
      .filter(r => {
        // Exclude vacant / no-name
        if (!r.rawName || /^vacant/i.test(r.rawName.trim())) return false;
        if (year === "Unknown") return !r.leaseExpiryDate;
        if (!r.leaseExpiryDate) return false;
        const y = String(r.leaseExpiryDate).slice(0, 4);
        return y === year;
      })
      .map(r => ({
        name: r.canonicalName || r.rawName || "Unknown",
        dealName: r.dealName || "",
        dealId: r.dealId,
        sf: r.sf ?? null,
        annualRent: r.annualRent ?? null,
        expiryDate: r.leaseExpiryDate ? String(r.leaseExpiryDate) : null,
        dealStatus: r.dealStatus ?? null,
      }))
      .sort((a, b) => (b.annualRent ?? 0) - (a.annualRent ?? 0));

    res.json({ year, tenants });
  } catch (err) {
    req.log.error({ err }, "Failed to compute rollover detail");
    res.status(500).json({ error: "Failed to compute rollover detail" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/tenant-benchmarks — database-wide recency-weighted per-brand
// rent/sales/size medians (the SAME engine the deal-page scoring uses), for the AI
// analyst so it quotes official numbers instead of re-deriving its own.
// ---------------------------------------------------------------------------
router.get("/analytics/tenant-benchmarks", requireAuth, async (req, res) => {
  try {
    const { getAllTenantBenchmarks } = await import("../lib/tenantBenchmarks");
    res.json(await getAllTenantBenchmarks());
  } catch (err) {
    req.log.error({ err }, "Failed to compute tenant benchmarks");
    res.status(500).json({ error: "Failed to compute tenant benchmarks" });
  }
});

export default router;
