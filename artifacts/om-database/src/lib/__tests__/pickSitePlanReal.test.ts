import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pickSitePlanPages, unspaceLetters } from "../pdfExtract";

// 15 REAL OMs from Eric's Drive (11/12/26), ground truth checked by eye page by page.
// The fixtures hold LAYOUT FEATURES ONLY — per page: text-item count, the page's largest
// type (font size + only a fixed vocabulary of plan/table words), and the body text reduced
// to that same vocabulary with every other word masked as "w" and every "<n> SF" label as
// "1,000 SF". No OM prose or figures are stored (the repo is public).
const DIR = path.join(__dirname, "fixtures/siteplan-oms");
const load = (name: string) => {
  const j = JSON.parse(readFileSync(path.join(DIR, `${name}.json`), "utf8")) as { pages: Array<{ page: number; text: string; itemCount: number; items: { s: string; h: number }[] }> };
  return j.pages.filter(p => p.page >= 2 && p.page <= 40);
};
// Each entry lists every acceptable answer (a set of PDF page numbers).
const TRUTH: Array<[string, number[][], string]> = [
  ["BoltonPlaza", [[13]], "C&W — 'SITE PLAN' at 20pt under a 39pt property-name banner"],
  ["CobblerCrossing_CBRE", [[13]], "CBRE — disclaimer prose on p2 mentions 'site plan'; p9/10 are aerials"],
  ["DarienTowneCenter_CBRE", [[16]], "CBRE — p17 'PARCEL MAP' is the same plan with parcel ids"],
  ["FredMeyerBend", [[11], []], "single-tenant net lease — an untitled half-page plan; none is acceptable"],
  ["FrederickCountySquare_NMRK", [[10, 11], [10]], "Newmark — titled 'Tenant Roster', the plan runs onto an untitled page 11"],
  ["LillyGardens", [[]], "apartments, not retail — the 'Aerial View' page must not be taken"],
  ["OverlandPlaza", [[13], [7]], "CBRE — LETTER-SPACED 'S I T E P L A N'; p16-18 roof/HVAC/redevelopment maps"],
  ["PaddockShops", [[28]], "Eastdil — 'Retail Site Plan'; the tenant table is on the next page"],
  ["ProjectEvergreen", [[]], "portfolio teaser — no property plan"],
  ["ShopsAtCrossroads", [[13]], "CBRE — p14 'PROPERTY OVERVIEW' is the same plan with roof callouts"],
  ["ShortPumpTownCenter_Eastdil", [[20], [22], [24], [22, 24]], "Eastdil — overall plan + level floor plans; TOC page numbers are off by 2"],
  ["SunshinePlaza_2011", [[4]], "CBRE 2011 — title sits mid-page under a running header"],
  ["TownNCountry_BCA", [[6]], "BCA — p7 'ROOF REPORT' reuses the plan; p18-20 aerials"],
  ["TrussvillePromenade_JLL", [[9, 10]], "JLL — Phase I / Phase II plans on adjacent pages"],
  ["VillageSquare_CBRE", [[16]], "CBRE — titled 'SITE LAYOUT', image-only plan + tenant roster"],
];

describe("pickSitePlanPages on 15 real OMs", () => {
  for (const [name, ok, why] of TRUTH) {
    it(`${name}: ${why}`, () => {
      const got = pickSitePlanPages(load(name));
      expect(ok.map(o => JSON.stringify(o)), `picked ${JSON.stringify(got)}`).toContain(JSON.stringify(got));
    });
  }
  it("collapses letter-spaced titles", () => {
    expect(unspaceLetters("S I T E P L A N")).toBe("SITEPLAN");
    expect(unspaceLetters("T E N A N T  R O S T E R")).toContain("TENANT");
    expect(unspaceLetters("Suite A 1,200 SF")).toBe("Suite A 1,200 SF");
  });
});
