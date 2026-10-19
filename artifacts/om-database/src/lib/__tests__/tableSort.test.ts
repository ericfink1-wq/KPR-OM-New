import { describe, it, expect } from "vitest";
import { sortRows, isBlankValue, type SortCol } from "../tableSort";

type R = { id: string; bal: number | null; mat: string | null; name: string | null; days: number | null };
const rows: R[] = [
  { id: "a", bal: 9_500_000, mat: "2030-01-01", name: "Pointe", days: 900 },
  { id: "b", bal: null, mat: null, name: "—", days: null },
  { id: "c", bal: 26_000_000, mat: "2027-03-01", name: "academy", days: 130 },
  { id: "d", bal: 1_250_000, mat: "2029-06-15", name: "Bensalem", days: -5 },
  { id: "e", bal: Number.NaN, mat: "", name: "", days: 40 },
];
const cols: SortCol<R>[] = [
  { key: "bal", label: "Balance", value: r => r.bal },
  { key: "mat", label: "Maturity", value: r => r.mat },
  { key: "name", label: "Property", value: r => r.name },
  { key: "days", label: "Days", value: r => r.days },
];
const ids = (k: string, dir: "asc" | "desc") => sortRows(rows, cols, { key: k, dir }).map(r => r.id).join("");

describe("table sort", () => {
  it("money sorts numerically, not by display text ($9.5M < $26M), blanks last both ways", () => {
    expect(ids("bal", "asc")).toBe("dacbe");
    expect(ids("bal", "desc")).toBe("cadbe");
  });
  it("ISO dates sort chronologically; blank / empty dates last both ways", () => {
    expect(ids("mat", "asc")).toBe("cdabe");
    expect(ids("mat", "desc")).toBe("adcbe");
  });
  it("days numeric incl. negatives; text case-insensitive; '—' counts as blank", () => {
    expect(ids("days", "asc")).toBe("decab");
    expect(ids("name", "asc")).toBe("cdabe");
    expect(ids("name", "desc")).toBe("adcbe");
  });
  it("unknown key leaves order alone; stable on ties; blank detector", () => {
    expect(sortRows(rows, cols, { key: "nope", dir: "asc" }).map(r => r.id).join("")).toBe("abcde");
    const tie = [{ id: "x", bal: 1, mat: null, name: null, days: null }, { id: "y", bal: 1, mat: null, name: null, days: null }];
    expect(sortRows(tie, cols, { key: "bal", dir: "desc" }).map(r => r.id).join("")).toBe("xy");
    expect([null, undefined, "", " — ", Number.NaN].every(isBlankValue)).toBe(true);
    expect([0, "0", false].some(isBlankValue)).toBe(false);
  });
});
