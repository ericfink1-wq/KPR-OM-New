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
