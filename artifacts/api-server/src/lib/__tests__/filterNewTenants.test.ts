import { describe, it, expect } from "vitest";
import { filterNewTenants } from "../tenantDedup";

// The Dawson Marketplace failure: the OM's rent-roll tenant-name column was a custom
// font (garbage text), so the model guessed/varied names round to round. Name-only dedup
// then re-added the SAME suite under a new spelling → duplicate rows, SF over GLA, and a
// continuation loop that wheel-spun to the time budget. filterNewTenants dedups by SUITE
// (the reliable key) as well as name.

describe("filterNewTenants (suite-aware continuation dedup)", () => {
  it("drops a candidate whose SUITE is already captured, even under a different name", () => {
    const existing = [{ name: "Marshalls", suite: "1-300" }];
    const candidates = [{ name: "Marshall's Inc", suite: "1-300" }]; // same suite, variant name
    expect(filterNewTenants(existing, candidates)).toEqual([]);
  });

  it("drops a candidate whose NAME is already captured", () => {
    const existing = [{ name: "Hobby Lobby", suite: "1-900" }];
    const candidates = [{ name: "Hobby Lobby", suite: "" }];
    expect(filterNewTenants(existing, candidates)).toEqual([]);
  });

  it("keeps a genuinely new tenant (new suite and new name)", () => {
    const existing = [{ name: "Marshalls", suite: "1-300" }];
    const candidates = [{ name: "Ross Dress for Less", suite: "1-400" }];
    expect(filterNewTenants(existing, candidates)).toHaveLength(1);
  });

  it("dedups duplicates WITHIN a single batch by suite", () => {
    const out = filterNewTenants([], [
      { name: "Torrid", suite: "1-620" },
      { name: "Torrid Apparel", suite: "1-620" }, // same suite again in the same response
    ]);
    expect(out).toHaveLength(1);
  });

  it("ignores rows with no name", () => {
    expect(filterNewTenants([], [{ suite: "2-100" } as { name?: unknown; suite?: unknown }])).toEqual([]);
  });
});
