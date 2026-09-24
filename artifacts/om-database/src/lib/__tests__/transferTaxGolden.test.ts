// Golden cases for the transfer-tax engine: the tricky jurisdictions Eric named
// (9/24/26), plus the behavioural guarantees — never a silent default local rate.
import { describe, it, expect } from "vitest";
import {
  getJurisdiction, getJurisdictionFull, estimateClosingCosts, transferTaxPct, isStale,
  CLOSING_COSTS_BY_STATE, type ResolvedJurisdiction,
} from "../closingCosts";

const geo = (state: string, county: string, municipality: string | null, place: string | null = null, schoolDistrict: string | null = null): ResolvedJurisdiction =>
  ({ matched: true, state, county, municipality, place, schoolDistrict });

const TODAY = "2026-09-24";
async function pct(state: string, g: ResolvedJurisdiction | null, price: number, closingDate = TODAY) {
  const b = estimateClosingCosts(await getJurisdictionFull(state), price, 0, g, { closingDate });
  return { ...transferTaxPct(b), b };
}
const near = (a: number, b: number, tol = 0.001) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);

describe("tricky jurisdictions", () => {
  it("Waterbury CT = 1.75% seller (1.25% state + 0.50% targeted-town municipal)", async () => {
    const r = await pct("CT", geo("CT", "Naugatuck Valley Planning Region", "Waterbury town", "Waterbury city"), 25e6);
    near(r.seller, 1.75); near(r.buyer, 0);
  });
  it("Glastonbury CT = 1.5% seller", async () => {
    const r = await pct("CT", geo("CT", "Capitol Planning Region", "Glastonbury town"), 25e6);
    near(r.seller, 1.5);
  });
  it("Blue Bell PA (Whitpain Twp / Wissahickon SD) = 2% split", async () => {
    const r = await pct("PA", geo("PA", "Montgomery County", "Whitpain township", null, "Wissahickon School District"), 25e6);
    near(r.seller, 1); near(r.buyer, 1);
  });
  it("Philadelphia = 4.578% split", async () => {
    const r = await pct("PA", geo("PA", "Philadelphia County", "Philadelphia city", "Philadelphia city", "Philadelphia City School District"), 25e6);
    near(r.seller, 2.289); near(r.buyer, 2.289);
  });
  it("Pittsburgh city (Pittsburgh SD) = 5% vs an Allegheny suburb (Ross Twp) = 2%", async () => {
    const pgh = await pct("PA", geo("PA", "Allegheny County", "Pittsburgh city", "Pittsburgh city", "Pittsburgh School District"), 25e6);
    near(pgh.seller + pgh.buyer, 5);
    const ross = await pct("PA", geo("PA", "Allegheny County", "Ross township", null, "North Hills School District"), 25e6);
    near(ross.seller + ross.buyer, 2);
  });
  it("City of Reading PA = 5% split (not the 2% suburban default)", async () => {
    const r = await pct("PA", geo("PA", "Berks County", "Reading city", "Reading city", "Reading School District"), 25e6);
    near(r.seller, 2.5); near(r.buyer, 2.5);
  });
  it("Chicago = buyer 0.75%, seller 0.45% (state 0.10 + Cook 0.05 + CTA 0.30)", async () => {
    const r = await pct("IL", geo("IL", "Cook County", "Chicago city", "Chicago city"), 25e6);
    near(r.buyer, 0.75); near(r.seller, 0.45);
  });
  it("Evanston is tiered on the whole price: 0.9% above $5M", async () => {
    const r = await pct("IL", geo("IL", "Cook County", "Evanston township", "Evanston city"), 25e6);
    near(r.seller, 1.05); near(r.buyer, 0);
    const small = await pct("IL", geo("IL", "Cook County", "Evanston township", "Evanston city"), 1_000_000);
    near(small.seller, 0.65);
  });
  it("City of LA: 0.56% ≤ $5.4M, 4.56% at $7M, 6.06% at $15M — ULA tiers never stack", async () => {
    const g = geo("CA", "Los Angeles County", "Los Angeles CCD", "Los Angeles city");
    near((await pct("CA", g, 5_000_000)).seller, 0.56);
    near((await pct("CA", g, 7_000_000)).seller, 4.56);
    near((await pct("CA", g, 15_000_000)).seller, 6.06);
  });
  it("San Francisco = 6.0% at $30M (official total; no separate county 0.11%)", async () => {
    const r = await pct("CA", geo("CA", "San Francisco County", "San Francisco CCD", "San Francisco city"), 30e6);
    near(r.seller, 6.0);
  });
  it("Beverly Hills (no city DTT) = county base 0.11% only, positively confirmed", async () => {
    const r = await pct("CA", geo("CA", "Los Angeles County", "Beverly Hills CCD", "Beverly Hills city"), 30e6);
    near(r.seller, 0.11); expect(r.b.local.status).toBe("verified");
  });
  it("Seattle: graduated state REET + 0.5% local; the 2027 thresholds switch on by closing date", async () => {
    const g = geo("WA", "King County", "Seattle CCD", "Seattle city");
    const now = await pct("WA", g, 25e6);
    near(now.seller, (525000 * 0.011 + 1e6 * 0.0128 + 1.5e6 * 0.0275 + (25e6 - 3.025e6) * 0.03) / 25e6 * 100 + 0.5);
    const y27 = await pct("WA", g, 25e6, "2027-02-01");
    near(y27.seller, (551000 * 0.011 + 1e6 * 0.0128 + 1.5e6 * 0.0275 + (25e6 - 3.051e6) * 0.03) / 25e6 * 100 + 0.5);
  });
  it("Hamilton OH = 0.3% vs Cuyahoga/Stark = 0.4% (county-by-county, not a statewide max)", async () => {
    near((await pct("OH", geo("OH", "Hamilton County", "Cincinnati city", "Cincinnati city"), 25e6)).seller, 0.3);
    near((await pct("OH", geo("OH", "Cuyahoga County", "Rocky River city", "Rocky River city"), 25e6)).seller, 0.4);
    near((await pct("OH", geo("OH", "Stark County", "Canton city", "Canton city"), 25e6)).seller, 0.4);
  });
  it("Nashville TN = 0.37% buyer, plus the 0.115% mortgage tax on the loan", async () => {
    const j = await getJurisdictionFull("TN");
    const b = estimateClosingCosts(j, 25e6, 16e6, geo("TN", "Davidson County", null, "Nashville-Davidson metropolitan government (balance)"), { closingDate: TODAY });
    near(transferTaxPct(b).buyer, 0.37);
    const mrt = b.lines.find((l) => l.base === "loan" && /mortgage|indebtedness/i.test(l.name));
    expect(mrt, "TN mortgage tax line").toBeTruthy();
    near(mrt!.amount, (16e6 - 2000) * 0.00115, 1);
  });
  it("Minnesota: Hennepin adds the 0.01% surcharge; a non-metro county does not", async () => {
    near((await pct("MN", geo("MN", "Hennepin County", "St. Louis Park city", "St. Louis Park city"), 25e6)).seller, 0.34);
    near((await pct("MN", geo("MN", "Olmsted County", "Rochester city", "Rochester city"), 25e6)).seller, 0.33);
  });
});

describe("never a silent default", () => {
  it("The Point: a Harrisburg MAILING address in Lower Paxton Twp gets Lower Paxton's 2%, not Harrisburg's", async () => {
    const r = await pct("PA", geo("PA", "Dauphin County", "Lower Paxton township", null, "Central Dauphin School District"), 25e6);
    near(r.seller + r.buyer, 2);
    expect(r.b.local.applied[0].name).toBe("Lower Paxton township");
  });
  it("Maryland with no resolved county is UNVERIFIED (range), never Montgomery by default", async () => {
    const r = await pct("MD", null, 25e6);
    expect(r.b.local.status).toBe("unverified");
    expect(r.b.totalsMax.combined).toBeGreaterThan(r.b.totals.combined);
    expect(r.b.lines.some((l) => /Montgomery/.test(l.name) && !l.inactive && !l.unverified)).toBe(false);
  });
  it("Rosedale / Windsor Mill resolve to Baltimore County, not Baltimore City", async () => {
    const r = await pct("MD", geo("MD", "Baltimore County", "District 15"), 25e6);
    expect(r.b.local.status).toBe("verified");
    near(r.seller, 1.25); near(r.buyer, 1.25);
  });
  it("PA with no resolved town is UNVERIFIED and shown as a range", async () => {
    const r = await pct("PA", null, 25e6);
    expect(r.b.local.status).toBe("unverified");
    const line = r.b.lines.find((l) => l.unverified)!;
    expect(line.range!.buyerMax).toBeGreaterThan(line.range!.buyerMin);
  });
  it("a PA town missing from the table (Hermitage — conflicting official data) is UNVERIFIED", async () => {
    const r = await pct("PA", geo("PA", "Mercer County", "Hermitage city", "Hermitage city", "Hermitage School District"), 25e6);
    expect(r.b.local.status).toBe("unverified");
  });
  it("a manual pick resolves an unresolved address", async () => {
    const j = await getJurisdictionFull("PA");
    const entry = j.local!.entries.find((e) => e.name === "Reading city")!;
    const b = estimateClosingCosts(j, 25e6, 0, null, { manual: { muniId: entry.id }, closingDate: TODAY });
    expect(b.local.status).toBe("verified");
    near(transferTaxPct(b).seller, 2.5);
  });
  it("a state with no local tax needs no locality at all", async () => {
    const r = await pct("NH", null, 25e6);
    expect(r.b.local.status).toBe("none");
    near(r.seller, 0.75); near(r.buyer, 0.75);
  });
  it("the local table must be loaded — a lazy state without its table is unverified, not zero", () => {
    const b = estimateClosingCosts(getJurisdiction("PA"), 25e6, 0, geo("PA", "Montgomery County", "Whitpain township", null, "Wissahickon School District"));
    expect(b.local.status).toBe("unverified");
  });
});

describe("annual refresh", () => {
  it("flags rates older than 12 months as stale", () => {
    expect(isStale("2025-08-01", new Date("2026-09-24"))).toBe(true);
    expect(isStale("2026-05-01", new Date("2026-09-24"))).toBe(false);
    expect(isStale("not a date", new Date("2026-09-24"))).toBe(true);
  });
  it("every configured state carries a valid ratesAsOf date", () => {
    for (const j of Object.values(CLOSING_COSTS_BY_STATE)) {
      expect(j.ratesAsOf, j.state).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
