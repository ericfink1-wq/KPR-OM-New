import { describe, it, expect } from "vitest";
import { MCP_TOOLS_BY_NAME, MCP_SERVER_INSTRUCTIONS, isOwnedStatus } from "../mcpTools";

// Eric's standing rule: for anything about a property KPR OWNS, Datex is the source of
// truth and this library is the acquisition-era snapshot. The risk is not that the rule
// is missing from the doctrine — it is that a TOOL returns an owned-asset row silently,
// with a rent that reads as current. That happened: search_tenants returned Acme at
// $7.79/SF on an owned centre with no marker and no as-of date. These tests pin the
// markers in place.

describe("owned-asset rows never come back silent", () => {
  it("knows what counts as owned, and is not fooled by near-misses", () => {
    expect(isOwnedStatus("Owned")).toBe(true);
    for (const s of ["owned", "OWNED", "Under Contract", "Prospect", "Passed", "Sold", "", null, undefined]) {
      expect(isOwnedStatus(s), `${String(s)} must not count as owned`).toBe(false);
    }
  });

  it("search_tenants promises the per-row flag and the response-level note", () => {
    // The flag has to be compact: the full authority note on 150 rows would cost more
    // than the entire response budget, so the reasoning is carried once per response.
    const src = MCP_TOOLS_BY_NAME.get("search_tenants")!.handler.toString();
    expect(src).toContain("datexAuthoritative");
    expect(src).toContain("ownedAssetNotice");
  });

  it("lease_abstracts states the SPLIT, not a blanket 'Datex wins'", () => {
    // Getting this wrong in either direction is harmful. An executed lease is not
    // overridden by a management system; equally, the abstract does not know what has
    // been exercised since. The tool has to say both.
    const d = MCP_TOOLS_BY_NAME.get("lease_abstracts")!.description;
    expect(d).toMatch(/GOVERN/);
    expect(d).toMatch(/Datex does not override a signed lease/);
    expect(d).toMatch(/HAPPENED since|notice dates/);
  });

  it("does NOT stamp Datex precedence on market aggregates, where it would be wrong", () => {
    // Owned deals are legitimate data points in a corpus median. Flagging a median as
    // "Datex authoritative" would be both meaningless and misleading.
    for (const name of ["tenant_benchmarks", "portfolio_analytics", "comp_benchmark"]) {
      const src = MCP_TOOLS_BY_NAME.get(name)!.handler.toString();
      expect(src, `${name} should not carry a per-row Datex flag`).not.toContain("datexAuthoritative");
    }
  });

  it("the server instructions still lead with the source split", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/Datex/);
    // The phrase wraps across lines in the source, so tolerate the break.
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/go to Datex\s+first/i);
  });
});
