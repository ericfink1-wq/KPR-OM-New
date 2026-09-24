// ─────────────────────────────────────────────────────────────────────────────
// Closing-cost / transfer-tax ENGINE. Pure functions, no data. The per-state data
// lives in closingCosts.ts (state level) and ./transferTaxLocal/* (local tables).
//
// THE RULE THIS ENGINE ENFORCES (Eric, 9/24/26): the estimate is either right for
// the EXACT locality, or it loudly says it can't verify it. It must NEVER silently
// fall back to a default local rate. So:
//   • A state declares the level where local taxes are set (none / county /
//     municipality / municipality+school / county+municipality) — with a citation.
//   • After geocoding, the county / town must be EXPLICITLY in that state's local
//     table. If it isn't — and the table can't positively prove "no tax here" —
//     the local tax is reported as UNVERIFIED and shown as a RANGE, never a number.
//   • "No local tax" is only ever applied where it has been positively confirmed:
//     a listed entry with no lines, or a table flagged complete for that layer
//     (absent ⇒ none) AND the property's location actually resolved.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  JurisdictionRates, LocalEntry, LocalTaxTable, Party, ResolvedJurisdiction, TaxLineItem, TaxTier, TitleSchedule,
} from "./closingCostTypes";

// ── name normalization (Census spellings vs official lists) ──────────────────
export function normName(s?: string | null): string {
  if (!s) return "";
  return s.toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/&/g, " and ")
    .replace(/\bsaint\b/g, "st")
    .replace(/\btwp\b/g, "township")
    .replace(/\bboro\b/g, "borough")
    .replace(/\bmt\b/g, "mount")
    .replace(/[^a-z0-9 -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const TYPE_SUFFIX = /\s+(city|town|township|village|borough|municipality|charter township|plantation|cdp|ccd|city and borough|consolidated government|metro government|unified government|urban county)$/;
export function stripType(s: string): string {
  let out = s;
  for (let i = 0; i < 2; i++) out = out.replace(TYPE_SUFFIX, "");
  return out.trim();
}

// ── rate math ─────────────────────────────────────────────────────────────────
/** Resolve a CLIFF tier rate (whole-base method): highest tier whose threshold the base exceeds. */
export function resolveTierRate(tiers: TaxTier[], base: number): number {
  let rate = 0;
  for (const t of tiers) if (base > t.over) rate = t.rate;
  return rate;
}

/** Graduated (marginal) tax: each tier's rate applies only to the slice within that bracket. */
export function resolveMarginalTax(tiers: TaxTier[], base: number): number {
  if (base <= 0) return 0;
  let tax = 0;
  for (let i = 0; i < tiers.length; i++) {
    const lo = tiers[i].over;
    const hi = i + 1 < tiers.length ? tiers[i + 1].over : Infinity;
    if (base > lo) tax += (Math.min(base, hi) - lo) * tiers[i].rate;
  }
  return tax;
}

/** Marginal-bracket title premium. */
export function resolveTitlePremium(schedule: TitleSchedule, price: number): number {
  if (price <= 0) return 0;
  let bracket = schedule.brackets[0];
  for (const b of schedule.brackets) if (price > b.over) bracket = b;
  const premium = bracket.base + ((price - bracket.over) / 1000) * bracket.per1000;
  return Math.max(premium, schedule.minPremium ?? 0);
}

export function lineAmount(tx: Pick<TaxLineItem, "rate" | "tiers" | "marginalTiers" | "base" | "flatAmount">, price: number, loan: number): number {
  const b = tx.base === "loan" ? loan : price;
  if (b <= 0) return 0;
  if (tx.flatAmount != null) return tx.flatAmount;
  if (tx.marginalTiers) return resolveMarginalTax(tx.marginalTiers, b);
  if (tx.tiers) return b * resolveTierRate(tx.tiers, b);
  return b * tx.rate;
}

export const splitOf = (amt: number, party: Party) =>
  party === "buyer" ? { buyer: amt, seller: 0 }
  : party === "seller" ? { buyer: 0, seller: amt }
  : { buyer: amt / 2, seller: amt / 2 };

/** Format a rate for display: single %, sliding/tiered range, or flat fee. */
export function formatRate(item: { rate: number; rateMin?: number; rateMax?: number; tiers?: TaxTier[]; marginalTiers?: TaxTier[]; base?: "price" | "loan" }): string {
  const pct = (r: number) => `${(r * 100).toFixed(r > 0 && r < 0.001 ? 4 : r < 0.01 ? 3 : 2).replace(/\.?0+$/, "")}%`;
  const baseLabel = item.base === "loan" ? " of loan" : item.base === "price" ? " of price" : "";
  const lo = item.rateMin ?? (item.tiers ? Math.min(...item.tiers.map((t) => t.rate)) : item.marginalTiers ? Math.min(...item.marginalTiers.map((t) => t.rate)) : undefined);
  const hi = item.rateMax ?? (item.tiers ? Math.max(...item.tiers.map((t) => t.rate)) : item.marginalTiers ? Math.max(...item.marginalTiers.map((t) => t.rate)) : undefined);
  if (lo != null && hi != null && lo !== hi) {
    const tag = item.marginalTiers ? " (graduated)" : item.tiers ? " (tiered, whole price)" : " (range)";
    return `${pct(lo)}–${pct(hi)}${baseLabel}${tag}`;
  }
  if (item.rate === 0 && hi == null) return "flat fee";
  return `${pct(hi ?? item.rate)}${baseLabel}`;
}

// ── staleness (annual refresh) ────────────────────────────────────────────────
export const STALE_AFTER_MONTHS = 12;
export function monthsSince(isoDate: string, today: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
}
export function isStale(isoDate: string, today: Date = new Date()): boolean {
  const mo = monthsSince(isoDate, today);
  return mo == null || mo > STALE_AFTER_MONTHS;
}

// ── local-jurisdiction resolution ─────────────────────────────────────────────
export interface LocalSelection { countyId?: string | null; muniId?: string | null }

export interface UnverifiedLayer {
  layer: "county" | "municipal";
  reason: string;
  candidates: LocalEntry[];
  /** true when "no local tax" is one of the possible outcomes (so the range floor is $0). */
  canBeNone: boolean;
  /** Came from a knownGaps entry (its own range) rather than an unresolved lookup. */
  fromGap?: boolean;
}

export interface LocalResolution {
  status: "none" | "verified" | "unverified";
  basis: "geocoded" | "manual" | "unresolved" | "n/a";
  applied: LocalEntry[];
  /** Layers positively confirmed to carry no tax at this location (for display). */
  confirmedNone: Array<"county" | "municipal">;
  unverified: UnverifiedLayer[];
  where: string;
}

function hasCountyLayer(j: JurisdictionRates): boolean {
  return !!j.local?.entries.some((e) => e.kind === "county") || j.localLevel === "county" || j.localLevel === "county+municipality";
}
function hasMuniLayer(j: JurisdictionRates): boolean {
  return !!j.local?.entries.some((e) => e.kind === "municipal") || j.localLevel === "municipality" || j.localLevel === "municipality+school" || j.localLevel === "county+municipality";
}

// County names: "Baltimore County" and "Baltimore city" are DIFFERENT jurisdictions
// (as are VA's county/independent-city pairs), so only county-type words are dropped.
const COUNTY_WORD = / (county|parish|borough|census area|planning region)$/;
export const sameCounty = (a?: string | null, b?: string | null) => {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  return x === y || x.replace(COUNTY_WORD, "") === y.replace(COUNTY_WORD, "");
};

/** Candidate municipal entries for a geocoded location (before school-district disambiguation). */
function matchMunicipal(table: LocalTaxTable, geo: ResolvedJurisdiction): LocalEntry[] {
  const keys = table.placeBased
    ? (geo.place ? [normName(geo.place)] : ["unincorporated"])
    : [normName(geo.place), normName(geo.municipality)].filter(Boolean);
  const muni = table.entries.filter((e) => e.kind === "municipal" && (!e.county || !geo.county || sameCounty(e.county, geo.county)));
  const namesOf = (e: LocalEntry) => [normName(e.name), ...(e.match ?? []).map(normName)];
  // Pass 1: exact (type-qualified) name.
  let hits = muni.filter((e) => namesOf(e).some((n) => keys.includes(n)));
  if (hits.length) return hits;
  // Pass 2: bare name (type stripped) — accepted only when it identifies ONE
  // jurisdiction, so "X borough" can never be confused with "X township".
  const bare = keys.map(stripType);
  hits = muni.filter((e) => namesOf(e).some((n) => bare.includes(stripType(n))));
  const distinct = new Set(hits.map((e) => stripType(normName(e.name)) + "|" + normName(e.county)));
  const distinctFull = new Set(hits.map((e) => normName(e.name) + "|" + normName(e.county)));
  return distinct.size === 1 && distinctFull.size === 1 ? hits : [];
}

/** A known-but-unconfirmed local tax at this location → an UNVERIFIED layer (range 0–maxRate). */
function findGap(j: JurisdictionRates, table: LocalTaxTable, geo: ResolvedJurisdiction, kind: "county" | "municipal"): UnverifiedLayer | null {
  for (const g of table.knownGaps ?? []) {
    if ((g.kind ?? "municipal") !== kind) continue;
    const hit = kind === "county"
      ? sameCounty(g.county ?? g.name, geo.county)
      : (!g.county || !geo.county || sameCounty(g.county, geo.county)) &&
        [geo.place, geo.municipality].filter(Boolean).some((n) => normName(n) === normName(g.name) || stripType(normName(n)) === stripType(normName(g.name)));
    if (!hit) continue;
    const synthetic: LocalEntry = {
      id: `gap-${normName(g.name)}`, kind, name: g.name, county: g.county,
      lines: [{ name: `${g.name} local transfer tax (unconfirmed)`, rate: g.maxRate, base: "price", party: g.party, source: j.localLevelSource.source, asOf: j.localLevelSource.asOf }],
    };
    return { layer: kind, reason: `${g.name}: ${g.reason}`, candidates: [synthetic], canBeNone: true, fromGap: true };
  }
  return null;
}

export function resolveLocal(
  j: JurisdictionRates,
  geo: ResolvedJurisdiction | null | undefined,
  manual: LocalSelection = {},
): LocalResolution {
  const out: LocalResolution = { status: "none", basis: "n/a", applied: [], confirmedNone: [], unverified: [], where: "" };
  if (j.localLevel === "none") return out;
  const table: LocalTaxTable = j.local ?? { countyAbsentMeansNone: false, muniAbsentMeansNone: false, entries: [] };
  const located = !!geo?.matched;
  const usedManual = !!(manual.countyId || manual.muniId);
  out.basis = usedManual ? "manual" : located ? "geocoded" : "unresolved";
  const byId = (id?: string | null) => (id ? table.entries.find((e) => e.id === id) : undefined);
  const whereParts: string[] = [];

  // County layer.
  let countyName: string | null = geo?.county ?? null;
  if (hasCountyLayer(j)) {
    const countyEntries = table.entries.filter((e) => e.kind === "county");
    const pick = byId(manual.countyId);
    if (pick) { out.applied.push(pick); countyName = pick.county ?? pick.name; }
    else if (located && geo?.county) {
      const hit = countyEntries.find((e) => sameCounty(e.county ?? e.name, geo.county));
      const gap = hit ? null : findGap(j, table, geo, "county");
      if (hit) out.applied.push(hit);
      else if (gap) out.unverified.push(gap);
      else if (table.countyAbsentMeansNone) out.confirmedNone.push("county");
      else out.unverified.push({ layer: "county", reason: `${geo.county} is not in our ${j.stateName} county table`, candidates: countyEntries, canBeNone: false });
    } else {
      out.unverified.push({ layer: "county", reason: "the property's county could not be resolved from the address", candidates: countyEntries, canBeNone: table.countyAbsentMeansNone });
    }
  }

  // Municipal layer.
  if (hasMuniLayer(j)) {
    const muniEntries = table.entries.filter((e) => e.kind === "municipal" && (!e.county || !countyName || sameCounty(e.county, countyName)));
    const pick = byId(manual.muniId);
    if (pick) out.applied.push(pick);
    else if (located) {
      let hits = matchMunicipal(table, geo!);
      if (hits.length > 1 && geo?.schoolDistrict) {
        const sd = normName(geo.schoolDistrict).replace(/ school district$/, "");
        const narrowed = hits.filter((e) => e.schoolDistrict && normName(e.schoolDistrict).replace(/ school district$/, "") === sd);
        if (narrowed.length) hits = narrowed;
      }
      const town = geo?.place || geo?.municipality || "this location";
      const gap = !hits.length ? findGap(j, table, geo!, "municipal") : null;
      if (gap) out.unverified.push(gap);
      else if (!hits.length && table.placeBased && table.unincorporatedMeansNone && !geo?.place) {
        out.confirmedNone.push("municipal"); // outside every incorporated place — no municipal tax
      } else if (hits.length === 1) out.applied.push(hits[0]);
      else if (hits.length > 1) {
        out.unverified.push({ layer: "municipal", reason: `${town} spans more than one local taxing jurisdiction (school district not resolved)`, candidates: hits, canBeNone: false });
      } else if (table.muniAbsentMeansNone) {
        out.confirmedNone.push("municipal");
      } else {
        out.unverified.push({ layer: "municipal", reason: `${town} is not in our ${j.stateName} local rate table`, candidates: muniEntries, canBeNone: false });
      }
    } else {
      out.unverified.push({ layer: "municipal", reason: "the property's town could not be resolved from the address", candidates: muniEntries, canBeNone: table.muniAbsentMeansNone });
    }
  }

  const muniApplied = out.applied.find((e) => e.kind === "municipal");
  if (muniApplied) whereParts.push(muniApplied.name);
  else if (geo?.place || geo?.municipality) whereParts.push((geo.place || geo.municipality)!);
  if (countyName) whereParts.push(countyName);
  out.where = whereParts.join(", ") || "an unresolved location";
  out.status = out.unverified.length ? "unverified" : "verified";
  return out;
}

// ── the calculation ──────────────────────────────────────────────────────────
export interface ClosingCostLine extends Partial<TaxLineItem> {
  name: string; rate: number; base: "price" | "loan"; party: Party;
  inactive?: boolean;
  /** A local tax we could NOT verify for this exact locality — shown as a range. */
  unverified?: boolean;
  range?: { buyerMin: number; buyerMax: number; sellerMin: number; sellerMax: number };
  scope?: "state" | "local" | "title" | "fees";
  amount: number; buyer: number; seller: number;
}

export interface ClosingCostBreakdown {
  jurisdiction: JurisdictionRates;
  price: number; loan: number;
  lines: ClosingCostLine[];
  local: LocalResolution;
  /** Low end (unverified local taxes at their minimum). */
  totals: { buyer: number; seller: number; combined: number };
  /** High end (unverified local taxes at their maximum). Equal to `totals` when everything is verified. */
  totalsMax: { buyer: number; seller: number; combined: number };
}

export interface CalcOptions {
  includeEntityTaxes?: boolean;
  residential?: boolean;
  /** Pre-computed local resolution; if omitted, the location is treated as unresolved. */
  local?: LocalResolution;
  /** YYYY-MM-DD expected closing date — selects between scheduled rate changes. Defaults to today. */
  closingDate?: string;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
/** Is a line in force for a closing on `date`? */
export function inForce(l: Pick<TaxLineItem, "effectiveFrom" | "effectiveUntil">, date: string): boolean {
  if (l.effectiveFrom && date < l.effectiveFrom) return false;
  if (l.effectiveUntil && date >= l.effectiveUntil) return false;
  return true;
}

function entryCost(e: LocalEntry, price: number, loan: number, opts: CalcOptions) {
  let buyer = 0, seller = 0;
  const date = opts.closingDate || todayIso();
  for (const l of e.lines) {
    if (!inForce(l, date)) continue;
    if (l.entitySaleOnly && !opts.includeEntityTaxes) continue;
    if (l.residentialOnly && !opts.residential) continue;
    const sp = splitOf(lineAmount(l, price, loan), l.party);
    buyer += sp.buyer; seller += sp.seller;
  }
  return { buyer, seller };
}

export function calculateClosingCosts(j: JurisdictionRates, price: number, loan: number, opts: CalcOptions = {}): ClosingCostBreakdown {
  const { includeEntityTaxes = false, residential = false } = opts;
  const local = opts.local ?? resolveLocal(j, null);
  const lines: ClosingCostLine[] = [];

  // Title.
  const sched = j.titleSchedule;
  const titleAmt = sched ? resolveTitlePremium(sched, price) : price * j.titleInsuranceRate;
  const ts = splitOf(titleAmt, j.titleInsuranceParty);
  lines.push(sched
    ? {
        name: "Title Insurance (Owner's Policy)", scope: "title",
        rate: sched.brackets[sched.brackets.length - 1].per1000 / 1000,
        rateMin: sched.brackets[sched.brackets.length - 1].per1000 / 1000,
        rateMax: Math.max(...sched.brackets.map((b) => b.per1000)) / 1000,
        base: "price", party: j.titleInsuranceParty, verify: !sched.promulgated,
        source: sched.source, asOf: sched.asOf,
        amount: titleAmt, buyer: ts.buyer, seller: ts.seller,
        notes: `${sched.promulgated ? "Promulgated/filed-bureau schedule" : "REPRESENTATIVE schedule (not a filed per-state rate) — confirm an underwriter quote"}. Rate shown is the sliding range.${sched.minPremium ? ` Min premium $${sched.minPremium.toLocaleString()}.` : ""}`,
      }
    : {
        name: "Title Insurance (Owner's Policy)", scope: "title",
        rate: j.titleInsuranceRate, base: "price", party: j.titleInsuranceParty, verify: true,
        source: "National-average placeholder — no schedule configured", asOf: j.ratesAsOf,
        amount: titleAmt, buyer: ts.buyer, seller: ts.seller,
      });

  const replaced = new Set(local.applied.flatMap((e) => e.replaces ?? []));
  const closingDate = opts.closingDate || todayIso();
  const pushTax = (tx: TaxLineItem, scope: "state" | "local") => {
    if (!inForce(tx, closingDate)) return; // a scheduled rate not in force for this closing date — omit entirely
    if (tx.id && replaced.has(tx.id)) { lines.push({ ...tx, scope, amount: 0, buyer: 0, seller: 0, inactive: true, notes: `${tx.notes ?? ""} (Superseded by the local rate for this locality.)`.trim() }); return; }
    if (tx.entitySaleOnly && !includeEntityTaxes) { lines.push({ ...tx, scope, amount: 0, buyer: 0, seller: 0 }); return; }
    if (tx.residentialOnly && !residential) { lines.push({ ...tx, scope, amount: 0, buyer: 0, seller: 0, inactive: true }); return; }
    const amt = lineAmount(tx, price, loan);
    const sp = splitOf(amt, tx.party);
    lines.push({ ...tx, scope, amount: amt, buyer: sp.buyer, seller: sp.seller });
  };

  for (const tx of j.transferTaxes) pushTax(tx, "state");
  for (const e of local.applied) for (const tx of e.lines) pushTax(tx, "local");

  // Unverified local layers → a RANGE line, never a single default number.
  for (const u0 of local.unverified) {
    const hint = j.local?.unverifiedRange?.[u0.layer];
    const u: UnverifiedLayer = hint && !u0.fromGap ? {
      ...u0, canBeNone: hint.minRate === 0,
      candidates: [hint.minRate, hint.maxRate].map((r, i) => ({ id: `range-${i}`, kind: u0.layer, name: hint.note,
        lines: [{ name: hint.note, rate: r, base: "price" as const, party: hint.party, source: j.localLevelSource.source, asOf: j.localLevelSource.asOf }] })),
    } : u0;
    const costs = u.candidates.map((e) => entryCost(e, price, loan, opts));
    if (u.canBeNone || !costs.length) costs.push({ buyer: 0, seller: 0 });
    const r = {
      buyerMin: Math.min(...costs.map((c) => c.buyer)), buyerMax: Math.max(...costs.map((c) => c.buyer)),
      sellerMin: Math.min(...costs.map((c) => c.seller)), sellerMax: Math.max(...costs.map((c) => c.seller)),
    };
    // Rate range across the candidates (nominal top rates of each candidate's price-based lines).
    const nominal = u.candidates.map((e) => e.lines.filter((l) => l.base === "price" && !l.residentialOnly && !l.entitySaleOnly && inForce(l, closingDate))
      .reduce((s, l) => s + (l.tiers ? Math.max(...l.tiers.map((t) => t.rate)) : l.marginalTiers ? Math.max(...l.marginalTiers.map((t) => t.rate)) : l.rate), 0));
    if (u.canBeNone || !nominal.length) nominal.push(0);
    const layerName = u.layer === "county" ? "County" : j.localLevel === "municipality+school" ? "Municipal + school district" : "Municipal";
    lines.push({
      name: `${layerName} transfer tax — NOT VERIFIED for ${local.where}`,
      scope: "local", unverified: true, rate: 0,
      rateMin: Math.min(...nominal), rateMax: Math.max(...nominal),
      base: "price", party: "split", range: r,
      source: j.localLevelSource.source, sourceUrl: j.localLevelSource.sourceUrl, asOf: j.localLevelSource.asOf,
      amount: 0, buyer: 0, seller: 0,
      notes: u.fromGap
        ? `Local rate not verified: ${u.reason}. Shown from $0 up to the highest rate it could be. Confirm the exact local rate with title.`
        : hint && u !== u0
        ? `Local rate not verified: ${u.reason}. ${hint.note}. Confirm the exact local rate with title.`
        : `Local rate not verified: ${u.reason}. Shown as the range across ${u.candidates.length} ${j.stateName} ${u.layer === "county" ? "counties" : "localities"} in our table${u.canBeNone ? " (or none)" : ""}. Confirm the exact local rate with title.`,
    });
  }

  if (j.mortgageRecordingTax) pushTax(j.mortgageRecordingTax, "state");

  lines.push({ name: "Document Recording Fees (est.)", scope: "fees", rate: 0, base: "price", party: "buyer",
    source: "Estimate — typical county recording fees for a commercial deed + mortgage", asOf: j.ratesAsOf,
    amount: j.recordingFeesFlat, buyer: j.recordingFeesFlat, seller: 0 });

  const active = lines.filter((l) => !l.inactive);
  const buyer = active.reduce((s, l) => s + l.buyer + (l.range?.buyerMin ?? 0), 0);
  const seller = active.reduce((s, l) => s + l.seller + (l.range?.sellerMin ?? 0), 0);
  const buyerMax = active.reduce((s, l) => s + l.buyer + (l.range?.buyerMax ?? 0), 0);
  const sellerMax = active.reduce((s, l) => s + l.seller + (l.range?.sellerMax ?? 0), 0);
  return {
    jurisdiction: j, price, loan, lines, local,
    totals: { buyer, seller, combined: buyer + seller },
    totalsMax: { buyer: buyerMax, seller: sellerMax, combined: buyerMax + sellerMax },
  };
}

/** Convenience: resolve + calculate in one step (tests, server-side use). */
export function estimateClosingCosts(
  j: JurisdictionRates, price: number, loan: number,
  geo: ResolvedJurisdiction | null, opts: Omit<CalcOptions, "local"> & { manual?: LocalSelection } = {},
): ClosingCostBreakdown {
  const local = resolveLocal(j, geo, opts.manual ?? {});
  return calculateClosingCosts(j, price, loan, { ...opts, local });
}
