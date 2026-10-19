import { describe, it, expect } from "vitest";
import { sanitizeLoan, sanitizeSwap, spreadToBps } from "../assetMgmt";

describe("loan / swap spread import (Pointe: spread: 165 was dropped)", () => {
  it("reads bps or percent from any spread column, as a number or text", () => {
    expect(spreadToBps({ spread: 165 })).toBe(165);
    expect(spreadToBps({ spread: 1.65 })).toBe(165);
    expect(spreadToBps({ spread: "165 bps" })).toBe(165);
    expect(spreadToBps({ spread: "1.65%" })).toBe(165);
    expect(spreadToBps({ spreadPct: 1.75 })).toBe(175);
    expect(spreadToBps({ spreadBps: "175" })).toBe(175);
    expect(spreadToBps({ margin: "S+165" })).toBe(165);
    expect(spreadToBps({ margin: "1M Term SOFR + 165 bps" })).toBe(165);
    expect(spreadToBps({ margin: "Daily Simple SOFR + 1.75%" })).toBe(175);
    expect(spreadToBps({ margin: "1M Term SOFR" })).toBeUndefined();
    expect(spreadToBps({ spread: "" })).toBeUndefined();
    expect(spreadToBps({ spread: 0 })).toBeUndefined();
  });
  it("sanitizers keep it", () => {
    expect((sanitizeLoan({ currentBalance: 26e6, spread: 165, index: "1M Term SOFR" }) as { spreadBps?: number }).spreadBps).toBe(165);
    expect((sanitizeSwap({ notional: 23.5e6, allInFixedPct: 5.1, spread: "175 bps" }) as { spreadBps?: number }).spreadBps).toBe(175);
  });
});
