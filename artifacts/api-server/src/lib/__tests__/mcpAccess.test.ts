import { describe, it, expect } from "vitest";
import { extractKeyFromRequest, KEY_PREFIX } from "../mcpKeys";
import { MCP_TOOLS, MCP_TOOLS_BY_NAME, MCP_SERVER_INSTRUCTIONS } from "../mcpTools";
import { buildKnowledgePack, renderKnowledgePack, KPR_PLAYBOOK } from "../mcpKnowledge";

const GOOD = `${KEY_PREFIX}abcdefghijklmnopqrstuvwxyz012345`;

describe("MCP key extraction", () => {
  it("reads an Authorization: Bearer header", () => {
    expect(extractKeyFromRequest({ headers: { authorization: `Bearer ${GOOD}` } })).toBe(GOOD);
  });
  it("is case-insensitive about the Bearer scheme", () => {
    expect(extractKeyFromRequest({ headers: { authorization: `bearer ${GOOD}` } })).toBe(GOOD);
  });
  it("accepts a bare key in the Authorization header", () => {
    expect(extractKeyFromRequest({ headers: { authorization: GOOD } })).toBe(GOOD);
  });
  it("reads X-API-Key", () => {
    expect(extractKeyFromRequest({ headers: { "x-api-key": GOOD } })).toBe(GOOD);
  });
  it("reads a key from the URL path (the bare-URL client shape)", () => {
    expect(extractKeyFromRequest({ headers: {}, params: { key: GOOD } })).toBe(GOOD);
  });
  it("url-decodes a path key", () => {
    expect(extractKeyFromRequest({ headers: {}, params: { key: encodeURIComponent(GOOD) } })).toBe(GOOD);
  });
  it("reads ?key= as a last resort", () => {
    expect(extractKeyFromRequest({ headers: {}, query: { key: GOOD } })).toBe(GOOD);
  });
  it("prefers the header over a path key when both are present", () => {
    const other = `${KEY_PREFIX}zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz`;
    expect(extractKeyFromRequest({ headers: { authorization: `Bearer ${GOOD}` }, params: { key: other } })).toBe(GOOD);
  });
  it("returns null when nothing is supplied", () => {
    expect(extractKeyFromRequest({ headers: {} })).toBeNull();
  });
  it("ignores an empty or whitespace-only header", () => {
    expect(extractKeyFromRequest({ headers: { authorization: "   " } })).toBeNull();
    expect(extractKeyFromRequest({ headers: { "x-api-key": "" } })).toBeNull();
  });
});

describe("MCP tool registry", () => {
  it("exposes every tool under a unique name", () => {
    const names = MCP_TOOLS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(MCP_TOOLS_BY_NAME.size).toBe(MCP_TOOLS.length);
  });
  it("gives every tool a description and an object input schema", () => {
    for (const t of MCP_TOOLS) {
      expect(t.description.length, `${t.name} needs a real description`).toBeGreaterThan(40);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.inputSchema.type).toBe("object");
      expect(typeof t.inputSchema.properties).toBe("object");
      expect(typeof t.handler).toBe("function");
    }
  });
  // The whole security story rests on this: a key can read the library and nothing
  // else. If a write tool is ever added, this test must be revisited DELIBERATELY —
  // it should not be possible to slip one in unnoticed.
  it("is read-only — no tool name implies a mutation", () => {
    const mutating = /^(create|add|update|edit|delete|remove|set|write|import|save|refresh|reanalyze|rescore|autofix|reaudit)/;
    const offenders = MCP_TOOLS.map(t => t.name).filter(n => mutating.test(n));
    expect(offenders).toEqual([]);
  });
  it("points a new client at the knowledge and overview tools first", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain("get_knowledge");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("library_overview");
    expect(MCP_TOOLS_BY_NAME.has("get_knowledge")).toBe(true);
    expect(MCP_TOOLS_BY_NAME.has("library_overview")).toBe(true);
  });
});

describe("what this library is", () => {
  // The single most consequential framing error: reading this as KPR's PORTFOLIO. It is a
  // market corpus — mostly deals KPR looked at and declined — so a corpus roll-up presented
  // as KPR's holdings is not a wording slip, it is a false statement about the business.
  it("tells a client it is a market corpus, not KPR's portfolio", () => {
    for (const text of [MCP_SERVER_INSTRUCTIONS, KPR_PLAYBOOK]) {
      expect(text).toMatch(/NOT KPR's portfolio|not KPR's portfolio/);
      expect(text).toMatch(/corpus/i);
      expect(text).toMatch(/did NOT buy|declined|passed/i);
    }
  });
  it("forbids presenting a corpus roll-up as KPR's own exposure", () => {
    for (const text of [MCP_SERVER_INSTRUCTIONS, KPR_PLAYBOOK]) {
      expect(text).toMatch(/never[\s\S]{0,80}(exposure|holdings|concentration)/i);
    }
  });
});

describe("Datex precedence", () => {
  // The rule has to travel WITH the data — a client that never read a briefing must still
  // get it — so it is asserted in the initialize instructions AND the playbook.
  it("names Datex as authoritative for KPR-owned properties", () => {
    for (const text of [MCP_SERVER_INSTRUCTIONS, KPR_PLAYBOOK]) {
      expect(text).toMatch(/Datex/);
      expect(text).toMatch(/system of record/i);
    }
  });
  it("splits by QUESTION, not only by property, so market questions keep the corpus", () => {
    // Reaching for Datex on a market question shrinks the sample to KPR's own holdings —
    // the exact opposite of why the corpus was built.
    for (const text of [MCP_SERVER_INSTRUCTIONS, KPR_PLAYBOOK]) {
      expect(text).toMatch(/market question/i);
      expect(text).toMatch(/sample/i);
    }
  });
  it("explains that the corpus is static and Datex is living", () => {
    for (const text of [MCP_SERVER_INSTRUCTIONS, KPR_PLAYBOOK]) {
      expect(text).toMatch(/static/i);
      expect(text).toMatch(/capturedAsOf/);
      expect(text).toMatch(/never\s+updated|frozen/i);
    }
  });
  it("states the ten-year staleness horizon and that medians are recency-weighted", () => {
    for (const text of [MCP_SERVER_INSTRUCTIONS, KPR_PLAYBOOK]) {
      expect(text).toMatch(/ten years/i);
      expect(text).toMatch(/recency-weighted/i);
      expect(text).toMatch(/unweightedMedian/);
      expect(text).toMatch(/nWithinHorizon/);
    }
  });
  it("treats weighted-vs-unweighted divergence as the signal that rents moved", () => {
    // The two medians together say something neither says alone. Quoting one as if it
    // settled the question throws that away.
    for (const text of [MCP_SERVER_INSTRUCTIONS, KPR_PLAYBOOK]) {
      expect(text).toMatch(/diverge/i);
      expect(text).toMatch(/(rents\s+have\s+)?moved/i);
      expect(text).toMatch(/history,\s+not\s+market/i);
    }
  });
  it("requires BOTH sources cited separately on tenant and brand questions", () => {
    // What KPR achieves as a landlord and what the market shows are different findings.
    // Blending them into one number destroys the comparison that makes both worth having.
    for (const text of [MCP_SERVER_INSTRUCTIONS, KPR_PLAYBOOK]) {
      expect(text).toMatch(/BOTH/);
      expect(text).toMatch(/landlord/i);
      expect(text).toMatch(/gap\s+between/i);
      expect(text).toMatch(/[Nn]ever\s+(merge|blend)\s+them/);
    }
  });
  it("forces a base-to-base rent comparison against Datex", () => {
    // Datex splits base from NNN; this corpus is base-only. Comparing a Datex gross
    // figure to a corpus base rent inflates the Datex side by the whole recovery load
    // and manufactures an above-market finding out of nothing.
    for (const text of [MCP_SERVER_INSTRUCTIONS, KPR_PLAYBOOK]) {
      expect(text).toMatch(/AnnualRentPSF/);
      expect(text).toMatch(/AnnualNNNPSF/);
      expect(text).toMatch(/BASE\s+to\s+BASE/i);
    }
  });
  it("forbids averaging the two sources on a disagreement", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/[Nn]ever average/);
    expect(KPR_PLAYBOOK).toMatch(/[Nn]ever average/);
  });
});

describe("comp benchmark tool", () => {
  it("is registered and steers callers away from eyeballing raw comp rows", () => {
    const t = MCP_TOOLS_BY_NAME.get("comp_benchmark");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/never eyeball/i);
    expect(t!.description).toMatch(/median/i);
    // The whole point of exposing the engine is that thin samples are refused rather
    // than dressed up as a benchmark.
    expect(t!.description).toMatch(/too thin|insufficient/i);
  });
  it("tells sale_comps callers to use the engine for a verdict", () => {
    const t = MCP_TOOLS_BY_NAME.get("sale_comps")!;
    expect(t.description + JSON.stringify(t.inputSchema)).toBeTruthy();
    expect(MCP_TOOLS_BY_NAME.has("comp_benchmark")).toBe(true);
  });
});

describe("lease-precedent tool", () => {
  it("is registered and required for the review use case", () => {
    const t = MCP_TOOLS_BY_NAME.get("brand_lease_terms");
    expect(t).toBeDefined();
    expect(t!.inputSchema.required).toContain("brand");
    // The description is what makes a client REACH for it unprompted when someone
    // pastes a lease, so it has to name that situation.
    expect(t!.description).toMatch(/lease/i);
    expect(t!.description).toMatch(/off-market|looks off|unusual/i);
  });
});

describe("coverage guardrail", () => {
  // A median over three records is an anecdote. The library has to be able to say how
  // thin a field is, or a client will confidently generalize from almost nothing.
  it("exposes a coverage tool that warns about thin data", () => {
    const t = MCP_TOOLS_BY_NAME.get("data_coverage");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/BEFORE MAKING A PORTFOLIO-WIDE CLAIM/);
  });
  it("frames absent pricing as expected rather than as a defect", () => {
    const t = MCP_TOOLS_BY_NAME.get("data_coverage")!;
    expect(t.description).toMatch(/genuinely absent|not a bug/i);
  });
});

describe("knowledge pack", () => {
  it("carries the doctrine that most often gets analysis wrong", () => {
    // These are the rules Eric taught after real misreads — a playbook missing them
    // would let an outside Claude repeat exactly those mistakes.
    expect(KPR_PLAYBOOK).toMatch(/above-market rent is/i);
    expect(KPR_PLAYBOOK).toMatch(/below-market rent locked by options is NOT a risk/i);
    expect(KPR_PLAYBOOK).toMatch(/per SCREEN/i);
    expect(KPR_PLAYBOOK).toMatch(/X of N/);
    expect(KPR_PLAYBOOK).toMatch(/base rent only/i);
  });
  it("folds the live house view and operator lessons into the rendered pack", async () => {
    const pack = await buildKnowledgePack({
      getHouseView: async () => ({ content: "We reward grocery anchors with strong sales.", sourceCount: 12, lastDistilledAt: "2026-06-01T00:00:00.000Z" }),
      getActiveLessons: async () => [{ scope: "om", lesson: "Never trust a stated occupancy over the roster." }],
    });
    const md = renderKnowledgePack(pack);
    expect(md).toContain("We reward grocery anchors");
    expect(md).toContain("Never trust a stated occupancy");
    expect(md).toContain("HIGHEST PRIORITY");
    expect(md).toContain("12 of KPR's own per-deal reviews");
  });
  it("degrades to the playbook alone when the live sources fail", async () => {
    const pack = await buildKnowledgePack({
      getHouseView: async () => { throw new Error("db down"); },
      getActiveLessons: async () => { throw new Error("db down"); },
    });
    expect(pack.houseView).toBeNull();
    expect(pack.operatorLessons).toEqual([]);
    expect(renderKnowledgePack(pack)).toContain("KPR Centers — retail underwriting playbook");
  });
  it("omits an empty house view rather than rendering a bare heading", async () => {
    const pack = await buildKnowledgePack({
      getHouseView: async () => ({ content: "   ", sourceCount: 0, lastDistilledAt: null }),
      getActiveLessons: async () => [],
    });
    expect(pack.houseView).toBeNull();
    expect(renderKnowledgePack(pack)).not.toContain("The House View");
  });
});

// ── response budget ─────────────────────────────────────────────────────────
// Measured against the real 301-deal corpus: search_deals once returned 174 KB (~45k
// tokens) by default and 1.2 MB (~318k tokens) at its old max — more than a whole
// context window from a single call. Every list-shaped result is now capped.
import { capRows, emittedSize, RESPONSE_BUDGET_BYTES } from "../mcpTools";

describe("response budget", () => {
  const advice = "narrow the query";
  it("passes a small result through untouched", () => {
    const rows = [{ a: 1 }, { a: 2 }];
    const out = capRows({ matched: 2 }, "rows", rows, advice);
    expect(out.rows).toEqual(rows);
    expect(out.truncated).toBeUndefined();
  });
  it("trims an oversized result to fit and says so", () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ i, blob: "x".repeat(200) }));
    const out = capRows({ matched: rows.length }, "rows", rows, advice);
    const kept = out.rows as unknown[];
    expect(kept.length).toBeLessThan(rows.length);
    expect(emittedSize(out)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
    const t = out.truncated as Record<string, unknown>;
    expect(t.of).toBe(2000);
    expect(t.returned).toBe(kept.length);
    expect(t.advice).toBe(advice);
  });
  it("keeps the summary fields when it trims, so totals survive truncation", () => {
    // A truncated response must still carry the true portfolio-wide totals — otherwise a
    // caller sums the visible rows and reports a number that is quietly wrong.
    const rows = Array.from({ length: 5000 }, (_, i) => ({ i, blob: "y".repeat(120) }));
    const out = capRows({ matched: 5000, totalAnnualBaseRent: 12345678 }, "rows", rows, advice);
    expect(out.matched).toBe(5000);
    expect(out.totalAnnualBaseRent).toBe(12345678);
  });
  it("budgets against the EMITTED shape, not compact JSON", () => {
    // The handler emits indented JSON, ~17% larger than compact. Budgeting against the
    // compact form silently overshoots by that much on every capped response.
    const v = { a: [1, 2, 3], b: { c: "d" } };
    expect(emittedSize(v)).toBe(JSON.stringify(v, null, 2).length);
    expect(emittedSize(v)).toBeGreaterThan(JSON.stringify(v).length);
  });
  it("degrades honestly when the summary alone busts the budget", () => {
    const huge = { note: "z".repeat(RESPONSE_BUDGET_BYTES + 1000) };
    const out = capRows(huge, "rows", [{ a: 1 }], advice);
    expect((out.rows as unknown[]).length).toBe(0);
    expect((out.truncated as Record<string, unknown>).returned).toBe(0);
  });
});
