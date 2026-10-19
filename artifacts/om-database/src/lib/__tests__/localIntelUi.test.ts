import { describe, it, expect } from "vitest";
import { intelRedFlags, intelUpside, intelMeta, fmtDistance, safeHref, groupByCategory, searchAudit } from "../localIntel";
import type { IntelFinding } from "../api";

const base: IntelFinding = { id: "a", category: "competing_supply", headline: "Trader Joe's plans second Bend store", whyItMatters: "Competes with Fred Meyer's grocery.", distanceMiles: 1, distanceBasis: "estimated", location: null, date: "2026-06", forwardLooking: true, impact: "negative", severity: "high", tenant: "Fred Meyer", sources: [{ title: "The Bulletin", url: "https://bendbulletin.com/x" }], firstSeenAt: "2026-10-19" };

describe("Local Intel on the deal page", () => {
  it("high-severity negatives become red flags with distance, date and source", () => {
    const f = intelRedFlags([base, { ...base, id: "b", severity: "medium" }, { ...base, id: "c", dismissed: true }]);
    expect(f).toHaveLength(1);
    expect(f[0].description).toContain("Trader Joe's");
    expect(f[0].description).toContain("~1 mi · Jun 2026 · upcoming; per The Bulletin");
  });
  it("positives become upside items; low-severity positives don't", () => {
    expect(intelUpside([{ ...base, impact: "positive", severity: "medium" }, { ...base, id: "x", impact: "positive", severity: "low" }])).toHaveLength(1);
  });
  it("geocoded distances drop the ~; links are http(s) only", () => {
    expect(fmtDistance({ distanceMiles: 2.34, distanceBasis: "geocoded" })).toBe("2.3 mi");
    expect(intelMeta({ ...base, distanceMiles: null, forwardLooking: false })).toBe("Jun 2026");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("https://a.com")).toBe("https://a.com");
  });
  it("the raw box lists EVERY finding (low and positive too), grouped by category in a fixed order", () => {
    const all = [
      { ...base, id: "p", category: "property" as const, impact: "positive" as const, severity: "low" as const },
      { ...base, id: "t", category: "tenant_health" as const, severity: "medium" as const, date: "2025-06" },
      { ...base, id: "c2", severity: "low" as const, date: "2026-09" },
      base,
    ];
    const g = groupByCategory(all);
    expect(g.map(([c]) => c)).toEqual(["competing_supply", "tenant_health", "property"]);
    expect(g[0][1].map(f => f.id)).toEqual(["a", "c2"]);
    expect(g.flatMap(([, x]) => x)).toHaveLength(4);
  });
  it("search audit: what ran, and planned searches the model skipped (rewording allowed)", () => {
    const a = searchAudit({ queries: ["Bend Oregon new grocery store", `"Trader Joe's" Bend Oregon new store`, "Bend Oregon property tax reassessment 2026"],
      queriesRun: ["new grocery store Bend Oregon", "Bend OR property tax reassessment 2026"] });
    expect(a.ran).toHaveLength(2);
    expect(a.skipped).toEqual([`"Trader Joe's" Bend Oregon new store`]);
    expect(searchAudit({ queries: ["x"] }).known).toBe(false);
  });
});
