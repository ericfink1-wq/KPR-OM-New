// Address-bar routes (Eric, 10/16/26: "the URL stays / on every page — refresh loses
// your place, Back doesn't work, and you can't send someone a link to a deal").
// Pure mapping between the app's screen state and a path, both directions, so a
// refresh or a pasted link lands on the same screen. The production server already
// rewrites every path to index.html, so any of these can be opened directly.

export type RouteTab = "analyst" | "portfolio" | "analytics" | "comps" | "assetmgmt";
export type AmTab = "debt" | "dates" | "properties" | "credit";
const AM_SLUG: Record<AmTab, string> = { debt: "debt", dates: "dates", properties: "properties", credit: "credit-watch" };
export type AnalyticsView = "portfolio" | "tenant" | "watchlist" | "calendar" | "marktomarket" | "cotenancy" | "audit" | "feedback" | "learning";
export type RouteView =
  | { type: "list" }
  | { type: "detail"; dealId: string }
  | { type: "compare"; dealIds: string[] }
  | { type: "tenant"; tenantName: string }
  | { type: "parent"; parentName: string }
  | { type: "tenant-audit" }
  | { type: "tenant-link" }
  | { type: "tenant-analytics" }
  | { type: "lender"; lenderName: string }
  | { type: "rollover-year"; year: string; scope: "all" | "owned" };

export interface RouteState { tab: RouteTab; analyticsView: AnalyticsView; view: RouteView; amTab?: AmTab }

// Readable slugs for the analytics pages (the internal ids are terse).
const AV_SLUG: Record<AnalyticsView, string> = {
  portfolio: "portfolio", tenant: "tenants", watchlist: "watchlist", calendar: "critical-dates",
  marktomarket: "mtm", cotenancy: "co-tenancy", audit: "data-audit", feedback: "feedback", learning: "learning",
};
const SLUG_AV: Record<string, AnalyticsView> = Object.fromEntries(
  Object.entries(AV_SLUG).map(([k, v]) => [v, k as AnalyticsView]),
) as Record<string, AnalyticsView>;
// Aliases people will type or that Eric named in the review.
SLUG_AV["owned"] = "portfolio";
SLUG_AV["overview"] = "portfolio";

const enc = encodeURIComponent;

export function routeToPath(s: RouteState): string {
  const v = s.view;
  switch (v.type) {
    case "detail": return `/deals/${enc(v.dealId)}`;
    case "compare": return `/compare?ids=${v.dealIds.map(enc).join(",")}`;
    case "tenant": return `/tenants/${enc(v.tenantName)}`;
    case "parent": return `/parents/${enc(v.parentName)}`;
    case "lender": return `/lenders/${enc(v.lenderName)}`;
    case "tenant-audit": return "/analytics/tenant-name-audit";
    case "tenant-link": return "/analytics/link-tenants";
    case "tenant-analytics": return "/analytics/tenants";
    case "rollover-year": return `/analytics/rollover/${enc(v.year)}${v.scope === "owned" ? "?scope=owned" : ""}`;
    case "list": break;
  }
  if (s.tab === "portfolio") return "/deals";
  if (s.tab === "comps") return "/comps";
  if (s.tab === "assetmgmt") return `/asset-mgmt/${AM_SLUG[s.amTab ?? "debt"]}`;
  if (s.tab === "analytics") return `/analytics/${AV_SLUG[s.analyticsView] ?? "portfolio"}`;
  return "/";
}

/** null = not one of our paths (leave the defaults alone). */
export function pathToRoute(pathname: string, search = ""): Partial<RouteState> | null {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch { return p; } });
  const q = new URLSearchParams(search);
  const [a, b, c] = parts;
  if (!a) return { tab: "analyst", view: { type: "list" } };
  if (a === "deals") return b ? { tab: "portfolio", view: { type: "detail", dealId: b } } : { tab: "portfolio", view: { type: "list" } };
  if (a === "comps") return { tab: "comps", view: { type: "list" } };
  if (a === "asset-mgmt") {
    const t = (Object.keys(AM_SLUG) as AmTab[]).find(k => AM_SLUG[k] === b || k === b) ?? "debt";
    return { tab: "assetmgmt", amTab: t, view: { type: "list" } };
  }
  if (a === "compare") {
    const ids = (q.get("ids") || "").split(",").filter(Boolean);
    return ids.length ? { tab: "portfolio", view: { type: "compare", dealIds: ids } } : { tab: "portfolio", view: { type: "list" } };
  }
  if (a === "tenants" && b) return { tab: "portfolio", view: { type: "tenant", tenantName: b } };
  if (a === "parents" && b) return { tab: "portfolio", view: { type: "parent", parentName: b } };
  if (a === "lenders" && b) return { tab: "portfolio", view: { type: "lender", lenderName: b } };
  if (a === "analytics") {
    if (b === "tenant-name-audit") return { tab: "analytics", view: { type: "tenant-audit" } };
    if (b === "link-tenants") return { tab: "analytics", view: { type: "tenant-link" } };
    if (b === "rollover" && c) return { tab: "analytics", view: { type: "rollover-year", year: c, scope: q.get("scope") === "owned" ? "owned" : "all" } };
    const av = SLUG_AV[b || "portfolio"];
    return av ? { tab: "analytics", analyticsView: av, view: { type: "list" } } : { tab: "analytics", analyticsView: "portfolio", view: { type: "list" } };
  }
  return null;
}
