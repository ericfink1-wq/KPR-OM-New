// Build gate (Eric, 9/24/26): every rate line must carry a source AND an as-of date,
// and every state must declare where its local transfer taxes are set, with a citation.
// A line without provenance fails the build.
import { describe, it, expect } from "vitest";
import { CLOSING_COSTS_BY_STATE, getJurisdictionFull, type TaxLineItem, type JurisdictionRates } from "../closingCosts";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const LEVELS = ["none", "county", "municipality", "municipality+school", "county+municipality"];

function checkLine(where: string, l: TaxLineItem) {
  expect(l.source?.trim(), `${where}: "${l.name}" has no source`).toBeTruthy();
  expect(l.asOf, `${where}: "${l.name}" has no as-of date`).toMatch(ISO);
  expect(Number.isFinite(l.rate), `${where}: "${l.name}" rate`).toBe(true);
  if (l.tiers) for (let i = 1; i < l.tiers.length; i++) expect(l.tiers[i].over, `${where}: "${l.name}" tiers ascending`).toBeGreaterThan(l.tiers[i - 1].over);
  if (l.marginalTiers) for (let i = 1; i < l.marginalTiers.length; i++) expect(l.marginalTiers[i].over, `${where}: "${l.name}" marginal tiers ascending`).toBeGreaterThan(l.marginalTiers[i - 1].over);
  expect(!!(l.tiers && l.marginalTiers), `${where}: "${l.name}" cannot be both cliff and marginal`).toBe(false);
  if (l.effectiveFrom) expect(l.effectiveFrom).toMatch(ISO);
  if (l.effectiveUntil) expect(l.effectiveUntil).toMatch(ISO);
}

/** Two lines with the same name in force on the same date = an alternative stacked on another. */
function checkNoStacking(where: string, lines: TaxLineItem[]) {
  const dates = ["2026-09-24", ...lines.flatMap((l) => [l.effectiveFrom, l.effectiveUntil].filter(Boolean) as string[])];
  for (const d of dates) {
    const inForce = lines.filter((l) => (!l.effectiveFrom || d >= l.effectiveFrom) && (!l.effectiveUntil || d < l.effectiveUntil));
    const names = inForce.map((l) => l.name);
    expect(new Set(names).size, `${where}: duplicate lines in force on ${d}: ${names.join(" | ")}`).toBe(names.length);
  }
}

const STATES = Object.keys(CLOSING_COSTS_BY_STATE);

describe("transfer-tax provenance", () => {
  it("covers all 50 states + DC", () => {
    expect(STATES.length).toBe(51);
  });

  for (const st of STATES) {
    it(`${st}: every line has a source + as-of date; local level is declared and cited`, async () => {
      const j: JurisdictionRates = await getJurisdictionFull(st);
      expect(j.ratesAsOf, `${st} ratesAsOf`).toMatch(ISO);
      expect(LEVELS).toContain(j.localLevel);
      expect(j.localLevelSource.source.trim(), `${st} local-level source`).toBeTruthy();
      expect(j.localLevelSource.asOf, `${st} local-level asOf`).toMatch(ISO);
      expect(j.localLevelSource.statement.trim(), `${st} local-level statement`).toBeTruthy();
      if (j.titleSchedule) {
        expect(j.titleSchedule.source.trim()).toBeTruthy();
        expect(j.titleSchedule.asOf, `${st} title schedule asOf`).toMatch(ISO);
      }
      for (const l of j.transferTaxes) checkLine(`${st} state`, l);
      if (j.mortgageRecordingTax) checkLine(`${st} MRT`, j.mortgageRecordingTax);
      checkNoStacking(`${st} state`, j.transferTaxes);

      if (j.localLevel === "none") {
        expect(j.local?.entries.length ?? 0, `${st} says no local tax but has a local table`).toBe(0);
      } else {
        expect(j.local, `${st} has local taxes but no local table`).toBeTruthy();
        const ids = new Set<string>();
        for (const e of j.local!.entries) {
          expect(ids.has(e.id), `${st}: duplicate entry id ${e.id}`).toBe(false);
          ids.add(e.id);
          for (const l of e.lines) checkLine(`${st} ${e.name}`, l);
          checkNoStacking(`${st} ${e.name}`, e.lines);
          for (const r of e.replaces ?? []) expect(j.transferTaxes.some((t) => t.id === r) || j.mortgageRecordingTax?.id === r, `${st} ${e.name} replaces unknown line ${r}`).toBe(true);
        }
      }
    });
  }
});
