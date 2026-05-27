---
name: Portfolio Analytics + Comps Index
description: Analytics tab and Comps tab architecture — server-side computation, index tables, and extraction schema details
---

## Portfolio Analytics (`GET /api/analytics/portfolio`)
- Route: `artifacts/api-server/src/routes/analytics.ts`
- Computes all metrics server-side from `tenant_index` table; no caching
- Filter: `?filter=all` (default) or `?filter=owned`
- Returns: summary, leaseExpiration (waterfall by year), tenantConcentration, creditMix, leaseTypeMix
- Frontend: `artifacts/om-database/src/components/PortfolioAnalytics.tsx` — pure CSS bars, inline styles

## Comps Index (`comps_index` table)
- Schema: `lib/db/src/schema/compsIndex.ts`
- Fields: sourceDealId, sourceDealName, sourceDealMarket, name, address, market, saleDateRaw, saleDate (date), salePrice, capRate, pricePerSf, sf, occupancy, updatedAt
- `market` = comp's own market field if present, else falls back to source deal's `market`
- Rebuild helper: `artifacts/api-server/src/lib/compsIndex.ts` → `rebuildCompsIndex(dealId, data)`
- Auto-hooked: PUT /api/deals/:id (setImmediate), alongside `rebuildTenantIndex`
- Backfill: `POST /api/comps/rebuild-all`

## Comps API (`GET /api/comps`)
- Route: `artifacts/api-server/src/routes/comps.ts`
- Filters (AND): market (ilike), dateFrom/dateTo (sale_date range), capRateMin/capRateMax, sourceDealId
- Sort: date_desc (default), date_asc, cap_rate_asc/desc, price_per_sf_asc/desc, sale_price_asc/desc

## Extraction prompt update
- `comparableSales` schema in `artifacts/api-server/src/lib/extract.ts` now includes: name, market, occupancy
- **Why:** Existing data (pre-update) has only address+sf — no financials. New ingestions will populate all fields.

## Navigation
- 4 top-level tabs: Analyst | Portfolio | Analytics | Comps
- TabId = "analyst" | "portfolio" | "analytics" | "comps"
- `CompsSearch` accepts `onOpenDeal` callback — clicking source deal name navigates to that deal's detail view
