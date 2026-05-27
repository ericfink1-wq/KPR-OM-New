import { Router } from "express";
import { db } from "@workspace/db";
import { tenantIndexTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { TenantIndexRow } from "@workspace/db";

const router = Router();

function requireAuth(req: Parameters<Router>[0], res: Parameters<Router>[1], next: Parameters<Router>[2]) {
  if (!req.session.authenticated) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumRent(rows: TenantIndexRow[]): number {
  return rows.reduce((s, r) => s + (r.annualRent ?? 0), 0);
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function computeAnalytics(rows: TenantIndexRow[], filter: "all" | "owned") {
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
      // leaseExpiryDate is a string "YYYY-MM-DD" from Drizzle date column
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
  const byTenant = new Map<string, number>();
  for (const r of withRent) {
    const name = r.canonicalName || r.rawName || "Unknown";
    byTenant.set(name, (byTenant.get(name) ?? 0) + (r.annualRent ?? 0));
  }
  const topTenants = [...byTenant.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, annualRent]) => ({ name, annualRent, pct: pct(annualRent, totalRent) }));

  const anchors = withRent.filter(r => r.isAnchor === true);
  const anchorRent = sumRent(anchors);
  const anchorNames = new Set(anchors.map(r => r.canonicalName || r.rawName));

  // ---- Credit Mix ---------------------------------------------------------
  const CREDIT_ORDER = ["Investment Grade", "Non-Investment Grade", "Unrated"] as const;
  const creditMap = new Map<string, { annualRent: number; count: number }>();
  for (const r of withRent) {
    const label =
      r.creditRating === "Investment Grade" ? "Investment Grade"
      : r.creditRating === "Non-Investment Grade" ? "Non-Investment Grade"
      : "Unrated";
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

  // ---- Lease Type Mix -----------------------------------------------------
  const ltMap = new Map<string, { annualRent: number; count: number }>();
  for (const r of withRent) {
    const raw = (r.leaseType ?? "").trim();
    const label = raw || "Unknown";
    const e = ltMap.get(label) ?? { annualRent: 0, count: 0 };
    ltMap.set(label, { annualRent: e.annualRent + (r.annualRent ?? 0), count: e.count + 1 });
  }
  const leaseTypeMix = [...ltMap.entries()]
    .sort(([, a], [, b]) => b.annualRent - a.annualRent)
    .map(([label, v]) => ({
      label,
      annualRent: v.annualRent,
      pct: pct(v.annualRent, totalRent),
      count: v.count,
    }));

  return {
    filter,
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
    leaseTypeMix,
  };
}

// ---------------------------------------------------------------------------
// GET /api/analytics/portfolio
// Query params:
//   filter=owned   — only status='Owned' rows
//   (default)      — all statuses
// ---------------------------------------------------------------------------
router.get("/analytics/portfolio", requireAuth, async (req, res) => {
  try {
    const filter = req.query.filter === "owned" ? "owned" : "all";

    const rows = filter === "owned"
      ? await db.select().from(tenantIndexTable).where(eq(tenantIndexTable.dealStatus, "Owned"))
      : await db.select().from(tenantIndexTable);

    res.json(computeAnalytics(rows, filter));
  } catch (err) {
    req.log.error({ err }, "Failed to compute portfolio analytics");
    res.status(500).json({ error: "Failed to compute portfolio analytics" });
  }
});

export default router;
