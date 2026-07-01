// LEASE VINTAGE — when was this rent roll actually PRICED? A lease's economics are
// set the day it's signed, so a roster dominated by old paper (or by 2020–2021
// COVID-era deals cut when landlords had no leverage) is systematically below
// today's market — a mark-to-market story the OM won't spell out. Conversely the
// center's own RECENT signings are the best market-rent evidence there is: better
// than any third-party survey, because it's the same property. Uses the leaseStart
// dates the extraction already captures. Deterministic, token-free.
import type { Deal, Tenant } from "./idb";
import type { DerivedFlag } from "./expenseRisk";
import { isVacant, isNAPTenant, parseLeaseDate } from "./utils";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface VintageBucket {
  key: "legacy" | "pre-covid" | "covid" | "recent";
  label: string;
  rent: number;          // annual base rent signed in this era
  count: number;
  sharePct: number;      // % of covered rent
}

export interface RecentLeasingSpread {
  newMedianPSF: number;   // inline leases signed in the last ~24 months
  oldMedianPSF: number;   // inline leases signed 5+ years ago
  spreadPct: number;      // + = newer leases priced higher (embedded MTM evidence)
  newCount: number;
  oldCount: number;
}

export interface LeaseVintageAnalysis {
  coveragePct: number;              // % of occupied base rent with a parseable leaseStart
  coveredRent: number;
  totalRent: number;
  buckets: VintageBucket[];         // legacy → recent, only non-empty shares meaningful
  covidSharePct: number | null;     // % of covered rent signed 2020–2021
  staleSharePct: number | null;     // % signed 8+ years before the as-of date
  recentSpread: RecentLeasingSpread | null;
}

const COVID_START = 2020, COVID_END = 2021;
const STALE_YEARS = 8;     // signed this long ago = "legacy" paper
const RECENT_MONTHS = 24;  // signings inside this window = current market evidence
const INLINE_MAX_SF = 15_000; // spread compares inline-to-inline (anchor rents are a different market)

export function analyzeLeaseVintage(deal: Deal): LeaseVintageAnalysis | null {
  const tenants = (deal.tenants || []).filter((t): t is Tenant => !!t && !isVacant(t.name) && !isNAPTenant(t));
  if (tenants.length === 0) return null;
  const asOf = (deal.tenantsAsOf && parseLeaseDate(deal.tenantsAsOf)) || new Date();
  const asOfYear = asOf.getFullYear();

  const totalRent = tenants.reduce((s, t) => s + (num(t.annualRent) || 0), 0);
  if (totalRent <= 0) return null;

  const buckets: Record<VintageBucket["key"], { rent: number; count: number }> = {
    legacy: { rent: 0, count: 0 }, "pre-covid": { rent: 0, count: 0 }, covid: { rent: 0, count: 0 }, recent: { rent: 0, count: 0 },
  };
  let coveredRent = 0;
  const newInline: number[] = [], oldInline: number[] = [];

  for (const t of tenants) {
    const start = parseLeaseDate(t.leaseStart);
    const rent = num(t.annualRent) || 0;
    if (!start || rent <= 0) continue;
    coveredRent += rent;
    const y = start.getFullYear();
    const ageYears = (asOf.getTime() - start.getTime()) / (365.25 * 86_400_000);
    const key: VintageBucket["key"] =
      y >= COVID_START && y <= COVID_END ? "covid"
      : ageYears >= STALE_YEARS ? "legacy"
      : ageYears <= RECENT_MONTHS / 12 ? "recent"
      : "pre-covid";
    buckets[key].rent += rent;
    buckets[key].count += 1;

    // Recent-leasing spread: same-center inline PSF, new signings vs old paper.
    const sf = num(t.sf), psf = num(t.rentPerSF);
    const inline = !t.isAnchor && sf != null && sf > 0 && sf <= INLINE_MAX_SF && psf != null && psf > 0;
    if (inline && ageYears <= RECENT_MONTHS / 12) newInline.push(psf!);
    else if (inline && ageYears >= 5) oldInline.push(psf!);
  }

  if (coveredRent <= 0) return null;
  const coveragePct = Math.round((coveredRent / totalRent) * 100);
  const share = (r: number) => (r / coveredRent) * 100;

  const labels: Record<VintageBucket["key"], string> = {
    legacy: `Signed ${STALE_YEARS}+ yrs ago`,
    "pre-covid": "Mid-vintage",
    covid: `COVID era (${COVID_START}–${COVID_END})`,
    recent: "Signed last 24 mo",
  };
  const outBuckets: VintageBucket[] = (Object.keys(buckets) as VintageBucket["key"][]).map((k) => ({
    key: k, label: labels[k], rent: buckets[k].rent, count: buckets[k].count, sharePct: share(buckets[k].rent),
  }));

  // COVID share only counts when the COVID window is actually in the past-signing
  // range being analyzed (it always is for now, but guard against far-future asOf).
  const covidSharePct = asOfYear >= COVID_START ? share(buckets.covid.rent) : null;
  const staleSharePct = share(buckets.legacy.rent);

  let recentSpread: RecentLeasingSpread | null = null;
  if (newInline.length >= 2 && oldInline.length >= 2) {
    const nm = median(newInline), om = median(oldInline);
    if (om > 0) {
      recentSpread = {
        newMedianPSF: nm, oldMedianPSF: om,
        spreadPct: ((nm - om) / om) * 100,
        newCount: newInline.length, oldCount: oldInline.length,
      };
    }
  }

  return { coveragePct, coveredRent, totalRent, buckets: outBuckets, covidSharePct, staleSharePct, recentSpread };
}

const FLAG_MIN_COVERAGE = 50;
const STALE_FLAG_PCT = 35;
const COVID_FLAG_PCT = 30;

// Red flag when the roster is dominated by stale-vintage or COVID-era pricing —
// worded as what it is: likely below-market rents, i.e. an underwriting story in
// BOTH directions (upside if capturable, risk if the OM's NOI already assumes it).
export function deriveLeaseVintageFlag(deal: Deal): DerivedFlag | null {
  const v = analyzeLeaseVintage(deal);
  if (!v || v.coveragePct < FLAG_MIN_COVERAGE) return null;
  const stale = v.staleSharePct ?? 0;
  const covid = v.covidSharePct ?? 0;
  if (stale < STALE_FLAG_PCT && covid < COVID_FLAG_PCT) return null;

  const parts: string[] = [];
  if (stale >= STALE_FLAG_PCT) parts.push(`~${Math.round(stale)}% of base rent was priced on leases signed 8+ years ago`);
  if (covid >= COVID_FLAG_PCT) parts.push(`~${Math.round(covid)}% was signed in 2020–2021, when landlords had little leverage`);
  let evidence = "";
  if (v.recentSpread && v.recentSpread.spreadPct >= 10) {
    evidence = ` The center's own recent signings prove the gap: inline leases from the last 24 months run ~$${v.recentSpread.newMedianPSF.toFixed(2)}/SF vs ~$${v.recentSpread.oldMedianPSF.toFixed(2)} on 5+ year-old paper (+${Math.round(v.recentSpread.spreadPct)}%).`;
  }
  return {
    severity: "medium",
    description: `Stale-vintage rent roll — ${parts.join("; ")}. In-place rents likely trail today's market; size the mark-to-market on rollover (and check renewal options before counting it).${evidence} Based on ${v.coveragePct}% lease-start coverage.`,
  };
}
