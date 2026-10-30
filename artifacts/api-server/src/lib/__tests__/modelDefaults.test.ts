import { describe, it, expect } from "vitest";
import { withModelDefaults } from "../extract";
import { MODEL_HAIKU, MODEL_SONNET } from "../models";

describe("withModelDefaults (Sonnet 5.5 request shape)", () => {
  it("plain Sonnet read: thinking off, effort high, safety fallback + its beta header", () => {
    const { body, headers } = withModelDefaults({ model: MODEL_SONNET, max_tokens: 100, messages: [] }, {});
    expect(body).toMatchObject({ thinking: { type: "between_tools" }, output_config: { effort: "high" }, fallbacks: "default" });
    expect(headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
  });
  it("a caller's own thinking / tools / fallbacks / headers win", () => {
    const { body, headers } = withModelDefaults(
      { model: MODEL_SONNET, tools: [{ type: "web_search_20260209" }], fallbacks: "default", output_config: { effort: "medium" } },
      { "anthropic-beta": "server-side-fallback-2026-07-01" });
    expect((body as Record<string, unknown>).thinking).toBeUndefined();
    expect((body as Record<string, unknown>).output_config).toEqual({ effort: "medium" });
    expect(headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
  });
  it("xhigh/max effort keeps adaptive thinking (between_tools would 400)", () => {
    const { body } = withModelDefaults({ model: MODEL_SONNET, output_config: { effort: "max" } }, {});
    expect((body as Record<string, unknown>).thinking).toBeUndefined();
  });
  it("appends to an existing beta header; other models untouched; idempotent", () => {
    const once = withModelDefaults({ model: MODEL_SONNET }, { "anthropic-beta": "x-1" });
    expect(once.headers["anthropic-beta"]).toBe("x-1,server-side-fallback-2026-07-01");
    expect(withModelDefaults(once.body, once.headers)).toEqual(once);
    const h = { model: MODEL_HAIKU };
    expect(withModelDefaults(h, {}).body).toBe(h);
  });
});
