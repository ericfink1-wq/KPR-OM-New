import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fmtMoney, fmtCompact } from "../money";

describe("money rolls to the next unit at 4 digits (Eric, 10/19/26)", () => {
  it("K → M at 1,000K", () => {
    expect(fmtMoney(999_990)).toBe("$1.00M");          // 999.99K rounds to 1,000K at 0 dp → rolls
    expect(fmtMoney(999_490)).toBe("$999K");
    expect(fmtMoney(999_990, { dpK: 2 })).toBe("$999.99K");
    expect(fmtMoney(1_000_000)).toBe("$1.00M");
    expect(fmtMoney(1_250_000)).toBe("$1.25M");
  });
  it("M → B at 1,000M", () => {
    expect(fmtMoney(999_990_000)).toBe("$999.99M");
    expect(fmtMoney(999_995_000)).toBe("$1.00B");      // rounds to 1,000.00M → rolls
    expect(fmtMoney(1_000_000_000)).toBe("$1.00B");
    expect(fmtMoney(1_098_760_000)).toBe("$1.10B");
    expect(fmtMoney(999_960_000, { dp: 1 })).toBe("$1.0B");
  });
  it("negatives, small, empty, options", () => {
    expect(fmtMoney(-1_250_000)).toBe("-$1.25M");
    expect(fmtMoney(-999_990)).toBe("-$1.00M");
    expect(fmtMoney(-1_098_760_000)).toBe("-$1.10B");
    expect(fmtMoney(-450)).toBe("-$450");
    expect(fmtMoney(999.6)).toBe("$1K");
    expect(fmtMoney(930_000, { below: "full" })).toBe("$930,000");
    expect(fmtMoney(2_000_000, { dp: 1, trim: true })).toBe("$2M");
    expect(fmtMoney(null)).toBe("—");
    expect(fmtMoney(12_400, { kSuffix: "k" })).toBe("$12k");
    expect(fmtCompact(1_250_000)).toBe("1.25M");
    expect(fmtCompact(999_700)).toBe("1.00M");
  });
  it("the server copy is identical", () => {
    const strip = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8").split("\n").filter(l => !/Mirrored/.test(l)).join("\n");
    expect(strip("../../../../api-server/src/lib/money.ts")).toBe(strip("../money.ts"));
  });
});
