import { describe, it, expect } from "vitest";
import { routeToPath, pathToRoute, type RouteState } from "../routes";

const S = (p: Partial<RouteState>): RouteState => ({ tab: "analyst", analyticsView: "portfolio", view: { type: "list" }, ...p });

describe("URL routes round-trip", () => {
  const cases: RouteState[] = [
    S({}),
    S({ tab: "portfolio" }),
    S({ tab: "portfolio", view: { type: "detail", dealId: "mqp9ii8n_0_wc62m" } }),
    S({ tab: "comps" }),
    S({ tab: "analytics", analyticsView: "marktomarket" }),
    S({ tab: "analytics", analyticsView: "portfolio" }),
    S({ tab: "portfolio", view: { type: "tenant", tenantName: "Dick's Sporting Goods" } }),
    S({ tab: "analytics", view: { type: "rollover-year", year: "2027", scope: "owned" } }),
  ];
  it.each(cases.map(c => [routeToPath(c), c] as const))("%s", (path, c) => {
    const [p, q] = path.split("?");
    const back = pathToRoute(p, q ? "?" + q : "");
    expect(back?.tab).toBe(c.tab);
    expect(back?.view).toEqual(c.view);
    if (c.tab === "analytics" && c.view.type === "list") expect(back?.analyticsView).toBe(c.analyticsView);
  });
  it("names Eric used work", () => {
    expect(pathToRoute("/analytics/owned")).toMatchObject({ tab: "analytics", analyticsView: "portfolio" });
    expect(pathToRoute("/analytics/mtm")).toMatchObject({ tab: "analytics", analyticsView: "marktomarket" });
    expect(pathToRoute("/deals/abc")).toMatchObject({ view: { type: "detail", dealId: "abc" } });
  });
  it("unknown paths are left alone", () => expect(pathToRoute("/something-else")).toBeNull());
});
