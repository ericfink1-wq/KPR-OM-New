// OM ROSTER SCRUB (Eric, 10/18/26): "once we have the OM, the most important thing is
// scrubbing the tenant roster — rents, sales, lease term, SF — and the site should output
// every OM in the SAME standardized format regardless of broker format."
//
// Pure + deterministic (no AI). One pass over the roster produces, per tenant, a set of
// flags and a market benchmark, and for the center a fixed set of scrub KPIs. The roster
// table, the summary band and both standard exports (Excel rent roll, one-page PDF) all
// read THIS, so they can never disagree.
//
// Doctrine kept from CLAUDE.md: above-market rent is DOWNSIDE (it can reset at renewal),
// never "upside"; below-market rent locked by options is secure income, not capturable
// mark-to-market — so the two are reported SEPARATELY and never netted.
import type { Deal, Tenant } from "./idb";
import { isVacant, isNAPTenant, isNonGLA, isHoldover, isProposedTenant, tenantKey, toStepString, brandBenchmarkKey, statedReimbursementFlag } from "./utils";
export { isProposedTenant };
import { isInvestmentGrade } from "./tenantCredit";
import { classifyTenant } from "./retailCategory";

export type FlagKey = "below" | "above" | "expiring" | "noOptions" | "kickout" | "cotenancy" | "highOcc" | "proposed" | "holdover" | "gross" | "dark";
export const FLAG_META: Record<FlagKey, { label: string; icon: string; tone: "good" | "bad" | "warn" | "info"; tip: string }> = {
  below: { label: "Below mkt", icon: "▼", tone: "good", tip: "In-place rent ≥15% below the market benchmark — a favorable basis; capturable only at expiry if no fixed options lock it." },
  above: { label: "Above mkt", icon: "▲", tone: "bad", tip: "In-place rent ≥15% above the market benchmark — a premium that can reset down at renewal; verify sales support it." },
  expiring: { label: "Expiring ≤24mo", icon: "⏳", tone: "warn", tip: "Lease expires within 24 months." },
  noOptions: { label: "No options", icon: "∅", tone: "warn", tip: "The roll states no remaining renewal options." },
  kickout: { label: "Kickout", icon: "⇥", tone: "bad", tip: "Sales kickout or early-termination right." },
  cotenancy: { label: "Co-tenancy", icon: "⛓", tone: "bad", tip: "Co-tenancy clause — rent relief or termination if named tenants / occupancy fall away." },
  highOcc: { label: "High occ cost", icon: "%", tone: "bad", tip: "Occupancy cost above 12% (anchors) / 15% (shops)." },
  proposed: { label: "Proposed/Unsigned", icon: "✎", tone: "warn", tip: "Not an executed lease (LOI / proposed / unsigned) — excluded from occupancy, in-place rent and NOI by default." },
  holdover: { label: "Holdover/MTM", icon: "↻", tone: "warn", tip: "Expired or month-to-month — not a firm lease." },
  gross: { label: "Gross", icon: "G", tone: "info", tip: "Gross lease — the landlord carries CAM / taxes / insurance." },
  dark: { label: "Dark", icon: "◐", tone: "warn", tip: "Closed but still paying rent." },
};
export const FLAG_ORDER: FlagKey[] = ["proposed", "below", "above", "expiring", "noOptions", "kickout", "cotenancy", "highOcc", "holdover", "gross", "dark"];

const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const MKT_BAND = 0.15;


/** The next FUTURE rent step from a free-text schedule, compactly: "→ $27.00 Jan-27". */
const monYY = (iso: string) => { const d = new Date(iso + "T12:00:00Z"); return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}-${String(d.getUTCFullYear()).slice(2)}`; };
export function nextRentStep(t: Pick<Tenant, "rentSchedule" | "rentBumps" | "sf" | "rentPerSF">, today: Date = new Date()): { date: string; psf: number | null; label: string } | null {
  const sched = toStepString(t.rentSchedule) || toStepString(t.rentBumps);
  if (!sched) return null;
  const t0 = today.toISOString().slice(0, 10);
  const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const sf = num(t.sf), cur = num(t.rentPerSF);
  let flatTo: string | null = null;
  for (const seg of sched.split(/;|\n/).map(x => x.trim()).filter(Boolean)) {
    let iso: string | null = null, m: RegExpMatchArray | null;
    if ((m = seg.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/))) iso = `${m[1]}-${m[2]}-${m[3] ?? "01"}`;
    else if ((m = seg.match(/\b([A-Za-z]{3})[a-z]*[- .](\d{4})\b/)) && MON[m[1].toLowerCase()]) iso = `${m[2]}-${String(MON[m[1].toLowerCase()]).padStart(2, "0")}-01`;
    else if ((m = seg.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/))) iso = `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    if (!iso || iso <= t0) continue;
    const r = seg.match(/\$\s?([\d,]+(?:\.\d+)?)/);
    let psf = r ? Number(r[1].replace(/,/g, "")) : null;
    if (psf != null && psf > 500 && sf) psf = Math.round((psf / sf) * 100) / 100;   // an annual $ figure
    if (psf != null && psf > 500) psf = null;
    const when = monYY(iso);
    // A "step" to the rent already being paid is no step: a flat lease's roll often prints
    // its current rate through expiry ("$10.96 to Mar-30"). Keep looking for a real change.
    if (psf != null && cur && Math.abs(psf - cur) / cur < 0.005) { flatTo = iso; continue; }
    return { date: iso, psf, label: psf != null ? `→ $${psf.toFixed(2)} ${when}` : `→ step ${when}` };
  }
  if (flatTo) return { date: flatTo, psf: cur, label: `Flat to ${monYY(flatTo)}` };
  return null;
}

/** Renewal options: "none" only when the roll SAYS none; null text = unknown, not none. */
export function optionsState(t: Pick<Tenant, "renewalOptions">): "none" | "some" | "unknown" {
  const s = (toStepString(t.renewalOptions) || "").trim();
  if (!s) return "unknown";
  if (/^(none|no|n\/a|-|—|0)\b|no (remaining )?(renewal )?options|^0 x|none remaining/i.test(s)) return "none";
  return "some";
}

const sizeBand = (sf: number | null) => sf == null ? "?" : sf < 2500 ? "<2.5k" : sf < 10000 ? "2.5–10k" : sf < 25000 ? "10–25k" : "25k+";
function median(v: number[]): number { const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

export interface MarketIndex { brand: Map<string, Array<{ dealId: string; v: number }>>; brandSales: Map<string, Array<{ dealId: string; v: number }>>; category: Map<string, Array<{ dealId: string; v: number }>>; market: Map<string, Array<{ dealId: string; v: number }>> }
/** One observation per deal per key, from the WHOLE library (the comparable set). */
export function buildMarketIndex(allDeals: Deal[]): MarketIndex {
  const idx: MarketIndex = { brand: new Map(), brandSales: new Map(), category: new Map(), market: new Map() };
  const push = (m: Map<string, Array<{ dealId: string; v: number }>>, k: string, dealId: string, v: number) => { const a = m.get(k) ?? []; if (!a.some(x => x.dealId === dealId)) a.push({ dealId, v }); m.set(k, a); };
  for (const d of allDeals ?? []) {
    if (!d || d.trashedAt) continue;
    for (const t of d.tenants ?? []) {
      if (!t || isVacant(t.name) || isNAPTenant(t) || isNonGLA(t) || isProposedTenant(t)) continue;
      const psf = num(t.rentPerSF), sf = num(t.sf), key = brandBenchmarkKey(t.canonicalName || t.name, t.sf);
      if (psf != null && psf > 0 && key) push(idx.brand, key, d.id, psf);
      const sales = num(t.salesPSF);
      if (sales != null && sales > 0 && key) push(idx.brandSales, key, d.id, sales);
      if (psf != null && psf > 0) {
        push(idx.category, `${classifyTenant(t.canonicalName || t.name || "").category}|${sizeBand(sf)}`, `${d.id}:${t.name}`, psf);
        if (d.state) push(idx.market, `${String(d.state).toUpperCase()}|${sizeBand(sf)}`, `${d.id}:${t.name}`, psf);
      }
    }
  }
  return idx;
}

/** "Category benchmark (Grocery, 10–25K SF) · 36 leases" — the basis + sample size behind a Mkt rent figure,
 *  for a tooltip (the cell itself shows only the dollar value). */
export function benchmarkBasisText(b: Benchmark): string {
  if (b.rentMedian == null || !b.basis) return "No market benchmark";
  const s = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  const head = b.basis === "brand" ? `Same-brand benchmark, ${s(b.rentN, "other center")}`
    : `${b.basis === "category" ? "Category" : "Market"} benchmark (${b.basisLabel}), ${s(b.rentN, "lease")}`;
  const sales = b.salesMedian != null ? ` · chain median sales $${b.salesMedian}/SF (${b.salesN} reporting)` : "";
  return `${head} · median $${b.rentMedian.toFixed(2)}/SF${sales}`;
}
export interface Benchmark { rentMedian: number | null; rentN: number; basis: "brand" | "category" | "market" | null; basisLabel: string; salesMedian: number | null; salesN: number }
export function benchmarkFor(t: Tenant, deal: Deal, idx: MarketIndex): Benchmark {
  const key = brandBenchmarkKey(t.canonicalName || t.name, t.sf), sf = num(t.sf);
  const others = (a: Array<{ dealId: string; v: number }> | undefined) => (a ?? []).filter(x => !x.dealId.startsWith(deal.id)).map(x => x.v);
  const sales = key ? others(idx.brandSales.get(key)) : [];
  const out: Benchmark = { rentMedian: null, rentN: 0, basis: null, basisLabel: "no benchmark", salesMedian: sales.length >= 2 ? Math.round(median(sales)) : null, salesN: sales.length };
  const brand = key ? others(idx.brand.get(key)) : [];
  if (brand.length >= 2) return { ...out, rentMedian: Math.round(median(brand) * 100) / 100, rentN: brand.length, basis: "brand", basisLabel: `same brand, ${brand.length} other centers` };
  const cat = classifyTenant(t.canonicalName || t.name || "").category;
  const c = others(idx.category.get(`${cat}|${sizeBand(sf)}`));
  if (c.length >= 5 && cat !== "Other") return { ...out, rentMedian: Math.round(median(c) * 100) / 100, rentN: c.length, basis: "category", basisLabel: `${cat}, ${sizeBand(sf)} SF` };
  const mk = deal.state ? others(idx.market.get(`${String(deal.state).toUpperCase()}|${sizeBand(sf)}`)) : [];
  if (mk.length >= 5) return { ...out, rentMedian: Math.round(median(mk) * 100) / 100, rentN: mk.length, basis: "market", basisLabel: `${String(deal.state).toUpperCase()} ${sizeBand(sf)} SF` };
  return out;
}

export interface ScrubRow { tenant: Tenant; key: string; flags: FlagKey[]; bench: Benchmark; mtm: number | null; nextStep: ReturnType<typeof nextRentStep>; occCost: number | null; options: "none" | "some" | "unknown" }
export interface ScrubSummary {
  gla: number; leasedSF: number; openSF: number; leasedPct: number | null; openPct: number | null;
  inPlaceRent: number; igRentPct: number | null; top5Pct: number | null; top5: Array<{ name: string; rent: number; pct: number }>;
  walt: number | null; roll12Pct: number | null; roll24Pct: number | null; roll36Pct: number | null;
  belowN: number; belowAnnual: number; aboveN: number; aboveAnnual: number; benchmarked: number;
  salesReporting: number; wtdOccCost: number | null; noOptionsN: number; optionsUnknownN: number; kickoutN: number; cotenancyN: number;
  mix: { nnn: number; gross: number; mg: number; unknown: number };
  proposed: { n: number; sf: number; rent: number }; tenantCount: number;
}

type RiskTenant = { tenantName?: string | null; name?: string | null; coTenancy?: unknown[] | null; salesKickout?: unknown[] | null; otherRiskClauses?: { earlyTerminationOption?: { present?: boolean } | null } | null };
export function scrubRoster(deal: Deal, idx: MarketIndex, opts: { includeProposed?: boolean; today?: Date } = {}): { rows: ScrubRow[]; summary: ScrubSummary } {
  const today = opts.today ?? new Date(), t0 = today.toISOString().slice(0, 10);
  const plus = (m: number) => { const d = new Date(today); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };
  const risk = new Map<string, RiskTenant>();
  for (const r of ((deal.leaseRisk as { tenants?: RiskTenant[] } | null | undefined)?.tenants ?? [])) risk.set(tenantKey(String(r.tenantName ?? r.name ?? "")), r);
  const rows: ScrubRow[] = [];
  for (const t of deal.tenants ?? []) {
    if (!t || isVacant(t.name) || isNAPTenant(t)) continue;
    const key = tenantKey(t.canonicalName || t.name), flags: FlagKey[] = [];
    const proposed = isProposedTenant(t);
    if (proposed) flags.push("proposed");
    const bench = benchmarkFor(t, deal, idx), psf = num(t.rentPerSF), sf = num(t.sf);
    let mtm: number | null = null;
    if (!isNonGLA(t) && bench.rentMedian && psf && sf) {
      const ratio = psf / bench.rentMedian;
      if (ratio <= 1 - MKT_BAND) flags.push("below");
      if (ratio >= 1 + MKT_BAND) flags.push("above");
      mtm = Math.round((bench.rentMedian - psf) * sf);
    }
    const exp = t.leaseExpiry && /^\d{4}-\d{2}-\d{2}/.test(t.leaseExpiry) ? t.leaseExpiry.slice(0, 10) : null;
    const holdover = isHoldover(t, today) || /\b(mtm|month[- ]to[- ]month|holdover)\b/i.test(`${t.leaseType ?? ""} ${t.leaseExpiry ?? ""}`);
    if (holdover) flags.push("holdover");
    else if (exp && exp <= plus(24)) flags.push("expiring");
    const options = optionsState(t);
    if (options === "none") flags.push("noOptions");
    const r = risk.get(key);
    if (r && ((r.salesKickout?.length ?? 0) > 0 || r.otherRiskClauses?.earlyTerminationOption?.present)) flags.push("kickout");
    if (r && (r.coTenancy?.length ?? 0) > 0) flags.push("cotenancy");
    const occ = num(t.occupancyCost);
    if (occ != null && occ > (t.isAnchor ? 12 : 15)) flags.push("highOcc");
    const rf = statedReimbursementFlag(t.reimbursementMethod || "", t.leaseType || "");
    if (rf?.label === "GROSS") flags.push("gross");
    if (t.isDark) flags.push("dark");
    rows.push({ tenant: t, key, flags, bench, mtm, nextStep: nextRentStep(t, today), occCost: occ, options });
  }

  const counted = rows.filter(r => opts.includeProposed || !r.flags.includes("proposed"));
  const prop = rows.filter(r => r.flags.includes("proposed"));
  const sfOf = (t: Tenant) => (isNonGLA(t) ? 0 : Math.max(0, num(t.sf) ?? 0));
  // GLA: the OM's stated GLA, else the roster (leased + vacant; NAP and non-GLA out).
  const glaRows = (deal.tenants ?? []).filter(t => t && !isNAPTenant(t) && !(isNonGLA(t) && isVacant(t.name)));
  const gla = num(deal.totalSF) ?? glaRows.reduce((s, t) => s + sfOf(t), 0);
  const leasedSF = counted.reduce((s, r) => s + sfOf(r.tenant), 0);
  const openSF = counted.filter(r => !r.tenant.isDark && r.tenant.leaseStatus !== "signed-not-open").reduce((s, r) => s + sfOf(r.tenant), 0);
  const rent = (r: ScrubRow) => Math.max(0, num(r.tenant.annualRent) ?? 0);
  const inPlace = counted.reduce((s, r) => s + rent(r), 0);
  const pct = (v: number) => (inPlace > 0 ? Math.round((v / inPlace) * 1000) / 10 : null);
  const ig = counted.filter(r => isInvestmentGrade(r.tenant.name ?? "", r.tenant.creditRating)).reduce((s, r) => s + rent(r), 0);
  const byRent = [...counted].sort((a, b) => rent(b) - rent(a));
  const top5 = byRent.slice(0, 5).map(r => ({ name: r.tenant.canonicalName || r.tenant.name || "", rent: rent(r), pct: pct(rent(r)) ?? 0 }));
  let wNum = 0, wDen = 0;
  for (const r of counted) { const exp = r.tenant.leaseExpiry?.slice(0, 10); const s = sfOf(r.tenant); if (exp && /^\d{4}-\d{2}-\d{2}$/.test(exp) && s > 0) { wNum += Math.max(0, (Date.parse(exp) - Date.parse(t0)) / (365.25 * 86_400_000)) * s; wDen += s; } }
  const rolling = (m: number) => pct(counted.filter(r => { const e = r.tenant.leaseExpiry?.slice(0, 10); return (e && e <= plus(m)) || r.flags.includes("holdover"); }).reduce((s, r) => s + rent(r), 0));
  const below = counted.filter(r => r.flags.includes("below")), above = counted.filter(r => r.flags.includes("above"));
  const rep = counted.filter(r => num(r.tenant.salesPSF) != null && (num(r.tenant.salesPSF) ?? 0) > 0);
  const occRows = counted.filter(r => r.occCost != null && sfOf(r.tenant) > 0);
  const occSF = occRows.reduce((s, r) => s + sfOf(r.tenant), 0);
  const mix = { nnn: 0, gross: 0, mg: 0, unknown: 0 };
  for (const r of counted) {
    const lbl = statedReimbursementFlag(r.tenant.reimbursementMethod || "", r.tenant.leaseType || "")?.label ?? "";
    const k = lbl === "GROSS" ? "gross" : /MOD|MG|PARTIAL/.test(lbl) ? "mg" : /NNN|NET|FIXED CAM/.test(lbl) ? "nnn" : "unknown";
    mix[k] += rent(r);
  }
  for (const k of Object.keys(mix) as Array<keyof typeof mix>) mix[k] = pct(mix[k]) ?? 0;
  return {
    rows,
    summary: {
      gla, leasedSF, openSF, leasedPct: gla > 0 ? Math.round((leasedSF / gla) * 1000) / 10 : null, openPct: gla > 0 ? Math.round((openSF / gla) * 1000) / 10 : null,
      inPlaceRent: Math.round(inPlace), igRentPct: pct(ig), top5Pct: pct(top5.reduce((s, x) => s + x.rent, 0)), top5,
      walt: wDen > 0 ? Math.round((wNum / wDen) * 10) / 10 : null, roll12Pct: rolling(12), roll24Pct: rolling(24), roll36Pct: rolling(36),
      belowN: below.length, belowAnnual: below.reduce((s, r) => s + (r.mtm ?? 0), 0), aboveN: above.length, aboveAnnual: above.reduce((s, r) => s + (r.mtm ?? 0), 0),
      benchmarked: counted.filter(r => r.bench.rentMedian != null).length,
      salesReporting: rep.length, wtdOccCost: occSF > 0 ? Math.round((occRows.reduce((s, r) => s + r.occCost! * sfOf(r.tenant), 0) / occSF) * 10) / 10 : null,
      noOptionsN: counted.filter(r => r.options === "none").length, optionsUnknownN: counted.filter(r => r.options === "unknown").length,
      kickoutN: counted.filter(r => r.flags.includes("kickout")).length, cotenancyN: counted.filter(r => r.flags.includes("cotenancy")).length,
      mix, proposed: { n: prop.length, sf: prop.reduce((s, r) => s + sfOf(r.tenant), 0), rent: Math.round(prop.reduce((s, r) => s + rent(r), 0)) },
      tenantCount: counted.length,
    },
  };
}
