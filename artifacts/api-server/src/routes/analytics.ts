import { Router } from "express";
import { db } from "@workspace/db";
import { tenantIndexTable } from "@workspace/db";
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

    const rows = dealIds
      ? await db.select().from(tenantIndexTable).where(inArray(tenantIndexTable.dealId, dealIds))
      : await db.select().from(tenantIndexTable);

    res.json(computeAnalytics(rows));
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
