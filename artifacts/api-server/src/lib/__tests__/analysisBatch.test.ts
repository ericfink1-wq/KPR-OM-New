import { describe, it, expect } from "vitest";
import { isValidBatchCustomId, parseBatchResultsJsonl } from "../analysisBatch";

describe("isValidBatchCustomId", () => {
  it("accepts app-generated deal ids", () => {
    expect(isValidBatchCustomId("m9k2x_a8b3c")).toBe(true);
    expect(isValidBatchCustomId("deal-123_ABC")).toBe(true);
  });
  it("rejects ids with spaces, special chars, or over 64 chars", () => {
    expect(isValidBatchCustomId("has space")).toBe(false);
    expect(isValidBatchCustomId("has/slash")).toBe(false);
    expect(isValidBatchCustomId("")).toBe(false);
    expect(isValidBatchCustomId("a".repeat(65))).toBe(false);
  });
});

describe("parseBatchResultsJsonl", () => {
  it("parses one result object per line", () => {
    const jsonl = [
      JSON.stringify({ custom_id: "d1", result: { type: "succeeded", message: { content: [{ type: "text", text: "{}" }] } } }),
      JSON.stringify({ custom_id: "d2", result: { type: "errored", error: { type: "x" } } }),
    ].join("\n");
    const out = parseBatchResultsJsonl(jsonl);
    expect(out.length).toBe(2);
    expect(out[0].custom_id).toBe("d1");
    expect((out[0].result as any).type).toBe("succeeded");
    expect((out[1].result as any).type).toBe("errored");
  });
  it("skips blank lines and malformed JSON rather than failing the whole apply", () => {
    const jsonl = [
      "",
      "{ not valid json",
      JSON.stringify({ custom_id: "d3", result: { type: "succeeded" } }),
      "   ",
    ].join("\n");
    const out = parseBatchResultsJsonl(jsonl);
    expect(out.length).toBe(1);
    expect(out[0].custom_id).toBe("d3");
  });
  it("ignores lines missing custom_id or result", () => {
    const jsonl = [
      JSON.stringify({ custom_id: "d4" }),
      JSON.stringify({ result: { type: "succeeded" } }),
    ].join("\n");
    expect(parseBatchResultsJsonl(jsonl).length).toBe(0);
  });
  it("handles empty input", () => {
    expect(parseBatchResultsJsonl("")).toEqual([]);
  });
});
