import { describe, it, expect } from "vitest";
import { robustParseJSON, escapeStrayQuotesAndControls } from "../jsonRepair";

describe("complete-but-invalid AI replies (end_turn parse failures, 10/17/26)", () => {
  it("unescaped quotes inside a narrative", () => {
    const raw = '{"notes": "Kroger has a 12" sign band and a "go dark" right, which matters.", "redFlags": [{"severity": "high", "description": "The "Major Tenant" estoppel"}]}';
    const p = robustParseJSON(raw) as { notes: string; redFlags: Array<{ description: string }> };
    expect(p.notes).toBe('Kroger has a 12" sign band and a "go dark" right, which matters.');
    expect(p.redFlags[0].description).toBe('The "Major Tenant" estoppel');
  });
  it("raw line breaks and tabs inside strings", () => {
    const p = robustParseJSON('{"notes": "Line one.\nLine two.\tTabbed.", "dealScore": {"grade": "B"}}') as { notes: string; dealScore: { grade: string } };
    expect(p.notes).toBe("Line one.\nLine two.\tTabbed.");
    expect(p.dealScore.grade).toBe("B");
  });
  it("a quoted word right before a JSON comma still closes the value", () => {
    const p = robustParseJSON('{"a": "the "x" here", "b": "said "ok"", "c": 1}') as Record<string, unknown>;
    expect(p).toEqual({ a: 'the "x" here', b: 'said "ok"', c: 1 });
  });
  it("leaves valid JSON exactly as it was", () => {
    const ok = '{"a": "has \\"escaped\\" quotes", "b": [1, 2, {"c": "d"}], "e": true}';
    expect(escapeStrayQuotesAndControls(ok)).toBe(ok);
    expect(robustParseJSON(ok)).toEqual(JSON.parse(ok));
  });
  it("prose after a quoted phrase and comma is still prose", () => {
    const p = robustParseJSON('{"notes": "Tenant may "go dark", which would trip co-tenancy."}') as { notes: string };
    expect(p.notes).toBe('Tenant may "go dark", which would trip co-tenancy.');
  });
});
