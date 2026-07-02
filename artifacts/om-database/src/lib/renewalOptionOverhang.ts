// RENEWAL-OPTION OVERHANG — the classic shopping-center trap: a tenant sitting far
// below market looks like mark-to-market upside, but if it holds FIXED-RATE renewal
// options below market, that upside is locked away for as long as the options run.
// The tenant (not the landlord) decides whether to renew, and at a below-market
// option rate it always will. This module parses the free-text `renewalOptions`
// the extraction already captures into structure, classifies each below-market
// lease's upside as capturable ("free") vs option-locked ("encumbered"), and
// derives a token-free red flag. Deterministic; no model call.
import type { Deal, Tenant } from "./idb";
import { isVacant, isNAPTenant, tenantKey } from "./utils";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[$,%\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

// How the option-period rent is set. "fixed" = stated dollar rates; "pct-bump" =
// stated % increases (economically fixed); "fmv" = fair-market-value reset (no
// overhang — the landlord marks to market either way); "cpi" = CPI-indexed;
// "flat" = same rent as today (the worst overhang).
export type OptionRentBasis = "fixed" | "pct-bump" | "fmv" | "cpi" | "flat" | "unknown";

export interface ParsedRenewalOptions {
  none: boolean;                     // the text explicitly says no options remain
  optionCount: number | null;        // number of option periods, when stated
  termYears: number | null;          // length of each period, when stated
  totalOptionYears: number | null;   // count × term, when both known
  basis: OptionRentBasis;
  optionRentsPSF: number[];          // stated fixed option rents, ascending order kept
  firstOptionRentPSF: number | null; // the first (lowest exposure) stated option rate
  bumpPct: number | null;            // stated % increase per period, when given
}

const WORD_NUMS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// Parse the OM's free-text renewal-option blurb ("Two (2) 5-year options at $14.50
// and $15.95", "4 x 5 yr @ FMV", "3 remaining, 10% bumps", "None"). Returns null
// when there's nothing to read (unknown ≠ none).
export function parseRenewalOptions(text: string | null | undefined): ParsedRenewalOptions | null {
  if (text == null) return null;
  const raw = String(text).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (/^(none|n\/a|no)\.?$/.test(lower) || /\bno (remaining )?(renewal )?options?\b/.test(lower) || /\boptions?:?\s*none\b/.test(lower) || /\bzero options\b/.test(lower)) {
    return { none: true, optionCount: 0, termYears: null, totalOptionYears: 0, basis: "unknown", optionRentsPSF: [], firstOptionRentPSF: null, bumpPct: null };
  }

  let optionCount: number | null = null;
  let termYears: number | null = null;

  // "4 x 5-year", "3x5 yr", "2 X 5"
  const byX = lower.match(/(\d{1,2})\s*[x×]\s*(\d{1,2})(?:\s*[- ]?(?:year|yr))?/);
  if (byX) { optionCount = Number(byX[1]); termYears = Number(byX[2]); }

  // "two (2) five-year options" / "three 5-year options" / "2 five year renewal options"
  if (optionCount == null) {
    const m = lower.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s*(?:\(\d{1,2}\))?\s*[,;]?\s*(?:additional\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})?[- ]?(?:year|yr)\b[^.]*?\boptions?\b/);
    if (m) {
      optionCount = WORD_NUMS[m[1]] ?? Number(m[1]);
      if (m[2]) termYears = WORD_NUMS[m[2]] ?? Number(m[2]);
    }
  }
  // "(2) remaining options", "3 options remaining", "2 renewal options"
  if (optionCount == null) {
    const m = lower.match(/\(?(\d{1,2})\)?\s*(?:remaining\s+)?(?:renewal\s+)?options?\b/) || lower.match(/\boptions?\s*(?:remaining)?:?\s*\(?(\d{1,2})\)?\b/);
    if (m) optionCount = Number(m[1]);
  }
  // Term when not already found: "5-year option(s)", "five year option"
  if (termYears == null) {
    const m = lower.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2}(?:\.\d+)?)[- ]?(?:year|yr)s?\b/);
    if (m) termYears = WORD_NUMS[m[1]] ?? Number(m[1]);
  }
  // Sanity: a 1–2 digit count, plausible term
  if (optionCount != null && (optionCount < 0 || optionCount > 12)) optionCount = null;
  if (termYears != null && (termYears <= 0 || termYears > 25)) termYears = null;

  // Stated fixed option rents: $ figures in a plausible PSF range (annual dollar
  // amounts like $150,000 are excluded by the 1–300 band).
  const optionRentsPSF: number[] = [];
  for (const m of raw.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/g)) {
    const v = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(v) && v >= 1 && v <= 300) optionRentsPSF.push(v);
  }

  // % bumps ("10% increases", "increases of 7.5%")
  let bumpPct: number | null = null;
  const pct = lower.match(/(\d{1,2}(?:\.\d+)?)\s*%\s*(?:increase|bump|escalat|step)/) || lower.match(/(?:increase|bump|escalat|step)[a-z]*\s*(?:of\s*)?(\d{1,2}(?:\.\d+)?)\s*%/);
  if (pct) bumpPct = Number(pct[1]);

  let basis: OptionRentBasis = "unknown";
  if (/\bfmv\b|fair[- ]market|market (rate|rent|value)|prevailing market/.test(lower)) basis = "fmv";
  else if (/\bcpi\b|consumer price/.test(lower)) basis = "cpi";
  else if (/\bflat\b|same rent|no increase|at (the )?current rent/.test(lower)) basis = "flat";
  else if (optionRentsPSF.length > 0) basis = "fixed";
  else if (bumpPct != null) basis = "pct-bump";

  const totalOptionYears = optionCount != null && termYears != null ? optionCount * termYears : null;
  return {
    none: false,
    optionCount,
    termYears,
    totalOptionYears,
    basis,
    optionRentsPSF,
    firstOptionRentPSF: optionRentsPSF.length ? Math.min(...optionRentsPSF) : null,
    bumpPct,
  };
}

// How a below-market lease's upside is affected by its options.
//   encumbered   — fixed/flat/bumped option rent sits materially below market: the
//                  tenant controls the space at the cheap rate; upside is locked.
//   market       — options reset to FMV (or fixed at/near market): upside capturable.
//   above-market — fixed option rent ABOVE today's market = embedded contractual growth.
//   none         — no options remain: full mark-to-market at expiry.
//   unknown      — options exist but the rate basis isn't stated (or CPI-indexed).
export type OverhangStatus = "encumbered" | "market" | "above-market" | "none" | "unknown";

export interface OptionOverhang {
  status: OverhangStatus;
  parsed: ParsedRenewalOptions;
  optionRentPSF: number | null;  // the rate used for the comparison (stated or bump-implied)
  gapPct: number | null;         // (median − optionRent) ÷ median × 100; + = option below market
}

const ENCUMBERED_GAP_PCT = 15;   // option rent ≥15% below median = locked upside
const ABOVE_MARKET_PCT = -5;     // option rent >5% ABOVE median = embedded growth

// Classify one tenant's option overhang against a market/brand-median rent PSF.
// Returns null when the OM discloses nothing about options (unknown ≠ safe —
// callers should not treat null as "no overhang", just as "not assessable").
export function assessOptionOverhang(t: Tenant, marketMedianRentPSF: number | null): OptionOverhang | null {
  const parsed = parseRenewalOptions(t.renewalOptions);
  if (!parsed) return null;
  if (parsed.none) return { status: "none", parsed, optionRentPSF: null, gapPct: null };
  if (parsed.basis === "fmv") return { status: "market", parsed, optionRentPSF: null, gapPct: null };

  // The option rate to compare: a stated fixed rate, a "flat" (= current rent), or
  // the current rent grown by the stated bump.
  const inPlace = num(t.rentPerSF);
  let optionRentPSF: number | null = null;
  if (parsed.firstOptionRentPSF != null) optionRentPSF = parsed.firstOptionRentPSF;
  else if (parsed.basis === "flat" && inPlace != null && inPlace > 0) optionRentPSF = inPlace;
  else if (parsed.basis === "pct-bump" && parsed.bumpPct != null && inPlace != null && inPlace > 0) optionRentPSF = inPlace * (1 + parsed.bumpPct / 100);

  if (optionRentPSF == null || marketMedianRentPSF == null || marketMedianRentPSF <= 0) {
    return { status: "unknown", parsed, optionRentPSF, gapPct: null };
  }
  const gapPct = ((marketMedianRentPSF - optionRentPSF) / marketMedianRentPSF) * 100;
  const status: OverhangStatus = gapPct >= ENCUMBERED_GAP_PCT ? "encumbered" : gapPct <= ABOVE_MARKET_PCT ? "above-market" : "market";
  return { status, parsed, optionRentPSF, gapPct };
}

// ---- Brand rent medians from the library itself (client-side, same discipline as
// icMemo's buildBrandMedians: one observation per deal+brand, own deal excluded at
// query time, ≥2 other locations required). ------------------------------------
export interface BrandRentIndex {
  get(brandKey: string, excludeDealId: string): { median: number; locations: number } | null;
}

export function buildBrandRentIndex(allDeals: Deal[]): BrandRentIndex {
  const idx = new Map<string, { dealId: string; v: number }[]>();
  for (const d of allDeals || []) {
    if (!d || d.trashedAt) continue;
    const perBrand = new Map<string, number>();
    for (const t of d.tenants || []) {
      if (!t || isVacant(t.name) || isNAPTenant(t)) continue;
      const key = tenantKey(t.canonicalName || t.name || "");
      const v = num(t.rentPerSF);
      if (!key || v == null || v <= 0) continue;
      perBrand.set(key, Math.max(perBrand.get(key) ?? 0, v));
    }
    for (const [key, v] of perBrand) {
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key)!.push({ dealId: d.id, v });
    }
  }
  return {
    get(brandKey: string, excludeDealId: string) {
      const rows = (idx.get(brandKey) ?? []).filter((o) => o.dealId !== excludeDealId).map((o) => o.v);
      if (rows.length < 2) return null;
      const s = [...rows].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return { median: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2, locations: rows.length };
    },
  };
}

// ---- Deal-level LEASE-ECONOMICS NOTE (NOT a red flag) ---------------------------
// Below-market rent locked in by options is NOT a risk on its own — a tenant never
// walks away from a below-market deal, so it is the STICKIEST, most secure income
// in the center (near-zero vacancy/re-leasing risk). The only thing "lost" is
// theoretical upside that was never underwritten. So this surfaces as a NEUTRAL
// data point (secure income, mark-to-market not capturable in the hold), NOT a
// red flag. It carries a CONCERN line ONLY when the low rent might not be as safe
// as it looks (the tenant shows distress) or when a dominant anchor's locked rent
// materially caps the asset's growth — the genuine risk cases (Eric, 7/2/26).
const MIN_ANNUAL_LOCKED = 25_000;  // ignore trivial encumbrances
const ANCHOR_CONCERN_SHARE = 25;   // locked anchor rent this % of base = growth-cap concern
const HIGH_OCC_COST = 15;          // occupancy cost above this = the low rent may be soft

export interface OverhangTenant {
  name: string; sf: number | null; inPlace: number; median: number;
  optionRentPSF: number; gapPct: number; lockedAnnual: number; years: number | null; isAnchor: boolean;
}
export interface OptionOverhangNote {
  tenants: OverhangTenant[];   // biggest locked $/yr first
  lockedTotal: number;         // Σ (median − option rent) × SF — upside that is NOT capturable
  summary: string;             // neutral, income-durability framing
  concern: string | null;      // set ONLY for genuine risk cases (distress / anchor growth-cap)
}

export function deriveOptionOverhangNote(deal: Deal, rentIndex: BrandRentIndex): OptionOverhangNote | null {
  const tenants = (deal.tenants || []).filter((t) => t && !isVacant(t.name) && !isNAPTenant(t));
  if (tenants.length === 0) return null;
  const totalRent = tenants.reduce((s, t) => s + (num(t.annualRent) || 0), 0);

  const hits: OverhangTenant[] = [];
  let lockedRentShare = 0;   // share of base rent from locked ANCHORS (growth-cap read)
  let distressName: string | null = null;
  for (const t of tenants) {
    const inPlace = num(t.rentPerSF);
    if (inPlace == null || inPlace <= 0) continue;
    const bench = rentIndex.get(tenantKey(t.canonicalName || t.name || ""), deal.id);
    if (!bench) continue;
    // Only leases that are themselves below market matter.
    if (inPlace >= bench.median * (1 - ENCUMBERED_GAP_PCT / 100)) continue;
    const oh = assessOptionOverhang(t, bench.median);
    if (!oh || oh.status !== "encumbered" || oh.optionRentPSF == null) continue;
    const sf = num(t.sf);
    const lockedAnnual = sf != null ? (bench.median - oh.optionRentPSF) * sf : 0;
    if (sf != null && lockedAnnual < MIN_ANNUAL_LOCKED) continue;
    hits.push({
      name: t.canonicalName || t.name || "Tenant", sf, inPlace, median: bench.median,
      optionRentPSF: oh.optionRentPSF, gapPct: oh.gapPct ?? 0,
      lockedAnnual: Math.max(0, lockedAnnual), years: oh.parsed.totalOptionYears,
      isAnchor: !!t.isAnchor,
    });
    if (t.isAnchor && totalRent > 0) lockedRentShare += (num(t.annualRent) || 0) / totalRent * 100;
    // Distress gate: a below-market lease is only a WORRY if the tenant looks shaky —
    // then even the low rent may not be secure. Occupancy cost is the tell.
    let occ = num(t.occupancyCost);
    if (occ != null && occ > 0 && occ < 1) occ = occ * 100;
    if (occ != null && occ > HIGH_OCC_COST && !distressName) distressName = t.canonicalName || t.name || "a locked tenant";
  }
  if (hits.length === 0) return null;

  hits.sort((a, b) => b.lockedAnnual - a.lockedAnnual);
  const lockedTotal = hits.reduce((s, h) => s + h.lockedAnnual, 0);
  const fmt = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}K`;
  const worst = hits.slice(0, 3).map((h) =>
    `${h.name} renews at $${h.optionRentPSF.toFixed(2)}/SF vs ~$${h.median.toFixed(2)} brand median (${Math.round(h.gapPct)}% below${h.years ? `, options run ~${h.years} yrs` : ""})`
  ).join("; ");

  const summary = `${worst}. A below-market tenant rarely leaves, so this is sticky, durable income — but the mark-to-market is not capturable in a 5–7yr hold${lockedTotal > 0 ? ` (~${fmt(lockedTotal)}/yr of below-market rent, secure but not upside)` : ""}. Brand medians are from your own library (directional).`;

  let concern: string | null = null;
  if (distressName) {
    concern = `${distressName} carries a high occupancy cost, so its below-market rent may reflect a soft location rather than pure upside — watch renewal risk, not just the rent gap.`;
  } else if (lockedRentShare >= ANCHOR_CONCERN_SHARE) {
    concern = `A dominant anchor's rent is locked below market for the long run — durable income, but it caps the center's income growth, which a buyer will price into the exit.`;
  }
  return { tenants: hits, lockedTotal, summary, concern };
}
