// INVESTMENT COMMITTEE MEMO generator. Assembles a deal's structured data into a polished,
// exportable institutional memo (Markdown — opens anywhere, pastes cleanly into Word). Pure
// and deterministic so it's free, instant, and fully testable; sections with no data are
// omitted rather than printed empty. Pulls in the retail-mix intelligence so every memo
// leads with the defensive/discretionary read an IC cares about.

import type { Deal, Tenant } from "./idb";
import { isVacant, isNAPTenant, tenantKey } from "./utils";
import { analyzeCenterMix } from "./retailCategory";
import { isInvestmentGrade } from "./tenantCredit";

// Median sales/rent PSF per brand across OTHER deals in the database — so an anchor's
// rent and sales can be shown relative to that chain's own norm (a Best Buy vs other
// Best Buys), not a meaningless cross-brand average. One observation per (deal, brand).
const MIN_OTHER = 2;
function medianOf(a: number[]): number { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function buildBrandMedians(allDeals: Deal[], field: "salesPSF" | "rentPerSF"): Map<string, { dealId: string; v: number }[]> {
  const idx = new Map<string, { dealId: string; v: number }[]>();
  for (const d of allDeals || []) {
    if (!d || d.trashedAt) continue;
    const perBrand = new Map<string, number>();
    for (const t of d.tenants || []) {
      if (!t || isVacant(t.name) || isNAPTenant(t)) continue;
      const key = tenantKey(t.canonicalName || t.name);
      const v = n((t as Record<string, unknown>)[field]);
      if (!key || v == null || v <= 0) continue;
      perBrand.set(key, Math.max(perBrand.get(key) ?? 0, v));   // dedupe multi-suite chains within one center
    }
    for (const [key, v] of perBrand) { if (!idx.has(key)) idx.set(key, []); idx.get(key)!.push({ dealId: d.id, v }); }
  }
  return idx;
}
// % difference of a value vs the brand median across OTHER centers (null when too few).
function vsChain(idx: Map<string, { dealId: string; v: number }[]>, brandKey: string, dealId: string, val: number | null): number | null {
  if (val == null || val <= 0 || !brandKey) return null;
  const others = (idx.get(brandKey) ?? []).filter((o) => o.dealId !== dealId).map((o) => o.v);
  if (others.length < MIN_OTHER) return null;
  const med = medianOf(others);
  return med > 0 ? Math.round((val / med - 1) * 100) : null;
}

const n = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const x = typeof v === "string" ? Number(v.replace(/[$,%\s]/g, "")) : Number(v);
  return Number.isFinite(x) ? x : null;
};
const money = (v: unknown): string | null => {
  const x = n(v); if (x == null) return null;
  if (Math.abs(x) >= 1_000_000) return `$${(x / 1_000_000).toFixed(2)}M`;
  if (Math.abs(x) >= 1_000) return `$${Math.round(x).toLocaleString()}`;
  return `$${x.toLocaleString()}`;
};
const sfFmt = (v: unknown): string | null => { const x = n(v); return x == null ? null : `${Math.round(x).toLocaleString()} SF`; };
const pctFmt = (v: unknown, d = 1): string | null => { const x = n(v); return x == null ? null : `${x.toFixed(d)}%`; };
const yr = (iso: unknown): number | null => {
  const s = String(iso ?? ""); const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? Number(m[1]) : null;
};

function refDate(deal: Deal): Date {
  const s = (typeof deal.tenantsAsOf === "string" && deal.tenantsAsOf) || "";
  const d = s ? new Date(s) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

export interface MemoMetric { label: string; value: string }
export interface AnchorRow {
  name: string;
  sf: number | null;
  rentPSF: number | null;
  termYears: number | null;        // remaining lease term
  salesPSF: number | null;
  rentVsChain: number | null;      // % vs this brand's median rent PSF across the DB
  salesVsChain: number | null;     // % vs this brand's median sales PSF across the DB
}
export interface ICMemoModel {
  name: string;
  addressLine: string | null;
  typeLine: string | null;
  generatedOn: string;
  asOf: string | null;
  grade: { grade: string; score: number | null; rationale: string | null } | null;
  metrics: MemoMetric[];          // headline boxes (price, cap, NOI, GLA, occ, WALT, rent)
  demographics: MemoMetric[];     // pop, income, traffic
  anchors: string[];
  anchorDetail: AnchorRow[];        // per-anchor rent / term / sales vs chain (needs allDeals)
  highlights: string[];             // data-driven positives (occupancy, WALT, IG, demos…)
  topTenants: { name: string; pct: number }[];
  concentration: { top1: number; top3: number } | null;
  mix: ReturnType<typeof analyzeCenterMix>;
  rollover: { count: number; pct: number | null; throughYear: number } | null;
  rolloverByYear: { year: number; count: number; pct: number }[];   // next ~6 yrs, for the bar chart
  financials: MemoMetric[];
  risks: string[];
  upside: string[];
  narrative: string | null;
}

// Structured model behind the memo — consumed by the branded one-page PDF (and available
// for any other rendering). Same data the Markdown export assembles, in typed form.
export function buildICMemoModel(deal: Deal, opts: ICMemoOptions = {}): ICMemoModel {
  const today = opts.generatedOn ?? new Date();
  const tenants = (deal.tenants || []) as Tenant[];
  const occ = tenants.filter((t) => !isVacant(t.name) && !isNAPTenant(t));
  const rentOf = (t: Tenant) => n(t.annualRent) ?? (n(t.rentPerSF) != null && n(t.sf) != null ? n(t.rentPerSF)! * n(t.sf)! : 0);

  const metrics: MemoMetric[] = [];
  const pushM = (label: string, value: string | null) => { if (value) metrics.push({ label, value }); };
  pushM("Asking Price", money(deal.askingPrice));
  pushM("Price / SF", money(deal.pricePerSF) ? `${money(deal.pricePerSF)}` : null);
  pushM("Cap Rate", pctFmt(deal.capRate, 2));
  pushM("NOI", money(deal.noi));
  pushM("GLA", sfFmt(deal.totalSF));
  pushM("Occupancy", pctFmt(deal.occupancy));
  pushM("WALT", n(deal.walt) != null ? `${n(deal.walt)!.toFixed(1)} yrs` : null);
  pushM("Avg Rent", n(deal.weightedAvgRentPSF) != null ? `$${n(deal.weightedAvgRentPSF)!.toFixed(2)}` : null);

  const demographics: MemoMetric[] = [];
  const demo = deal.marketDemographics;
  const pop3 = n(demo?.pop3mi) ?? n(deal.population3mi);
  const inc3 = n(demo?.avgHHI3mi) ?? n(deal.avgHHIncome3mi) ?? n(deal.medianHHIncome3mi);
  const traffic = n(deal.trafficCountVPD);
  if (pop3 != null) demographics.push({ label: "Population (3-mi)", value: Math.round(pop3).toLocaleString() });
  if (inc3 != null) demographics.push({ label: "Avg HH Income (3-mi)", value: money(inc3) ?? "—" });
  if (traffic != null) demographics.push({ label: "Traffic", value: `${Math.round(traffic).toLocaleString()} VPD` });

  const anchorTenants = occ.filter((t) => t.isAnchor === true || (n(t.sf) ?? 0) >= 20000).slice(0, 6);
  const anchors = anchorTenants.map((t) => `${t.name}${sfFmt(t.sf) ? ` (${sfFmt(t.sf)})` : ""}`);
  // Per-anchor detail with rent/sales relative to each chain's own DB median.
  const rentIdx = buildBrandMedians(opts.allDeals ?? [], "rentPerSF");
  const salesIdx = buildBrandMedians(opts.allDeals ?? [], "salesPSF");
  const refYearMs = refDate(deal).getTime();
  const anchorDetail: AnchorRow[] = anchorTenants.map((t) => {
    const key = tenantKey(t.canonicalName || t.name);
    const rentPSF = n(t.rentPerSF) ?? (n(t.annualRent) != null && n(t.sf) ? n(t.annualRent)! / n(t.sf)! : null);
    const salesPSF = n(t.salesPSF);
    // Remaining term: prefer an explicit field, else derive from the lease expiry.
    let termYears = n(t.remainingTermYears);
    if (termYears == null) { const e = /^\d{4}-\d{2}-\d{2}/.test(String(t.leaseExpiry ?? "")) ? new Date(String(t.leaseExpiry).slice(0, 10)).getTime() : NaN; if (Number.isFinite(e)) termYears = Math.max(0, Math.round((e - refYearMs) / (365.25 * 86_400_000) * 10) / 10); }
    return {
      name: String(t.canonicalName || t.name || "Anchor"),
      sf: n(t.sf), rentPSF: rentPSF != null ? Math.round(rentPSF * 100) / 100 : null, termYears, salesPSF,
      rentVsChain: vsChain(rentIdx, key, deal.id, rentPSF),
      salesVsChain: vsChain(salesIdx, key, deal.id, salesPSF),
    };
  });
  const ranked = occ.map((t) => ({ t, rent: rentOf(t) })).filter((x) => x.rent > 0).sort((a, b) => b.rent - a.rent);
  const totalRent = ranked.reduce((s, x) => s + x.rent, 0);
  const topTenants = totalRent > 0 ? ranked.slice(0, 5).map((x) => ({ name: String(x.t.name ?? ""), pct: Math.round((x.rent / totalRent) * 100) })) : [];
  const concentration = totalRent > 0 && ranked.length
    ? { top1: Math.round((ranked[0].rent / totalRent) * 100), top3: Math.round(ranked.slice(0, 3).reduce((s, x) => s + x.rent, 0) / totalRent * 100) }
    : null;

  let rollover: ICMemoModel["rollover"] = null;
  const rolloverByYear: ICMemoModel["rolloverByYear"] = [];
  if (occ.length) {
    const horizon = refDate(deal).getFullYear() + 3;
    const expiring = occ.filter((t) => { const y = yr(t.leaseExpiry); return y != null && y <= horizon; });
    if (expiring.length) {
      const rollRent = expiring.reduce((s, t) => s + (n(t.annualRent) ?? 0), 0);
      const tot = occ.reduce((s, t) => s + (n(t.annualRent) ?? 0), 0);
      rollover = { count: expiring.length, pct: tot > 0 ? Math.round((rollRent / tot) * 100) : null, throughYear: horizon };
    }
    // Per-year expiration schedule for the bar chart — this year through +5 yrs.
    const baseYear = refDate(deal).getFullYear();
    const totRent = occ.reduce((s, t) => s + rentOf(t), 0);
    for (let i = 0; i < 6; i++) {
      const y = baseYear + i;
      const inYear = occ.filter((t) => yr(t.leaseExpiry) === y);
      if (inYear.length === 0) { rolloverByYear.push({ year: y, count: 0, pct: 0 }); continue; }
      const yrRent = inYear.reduce((s, t) => s + rentOf(t), 0);
      rolloverByYear.push({ year: y, count: inYear.length, pct: totRent > 0 ? Math.round((yrRent / totRent) * 100) : 0 });
    }
  }

  const financials: MemoMetric[] = [];
  const pushF = (label: string, v: unknown) => { const m = money(v); if (m) financials.push({ label, value: m }); };
  pushF("Gross Potential Rent", deal.grossPotentialRent);
  pushF("Effective Gross Income", deal.effectiveGrossIncome);
  pushF("Operating Expenses", deal.operatingExpenses);
  pushF("NNN Recoveries", deal.nnnRecoveries);
  pushF("Net Operating Income", deal.noi);
  pushF("Real Estate Taxes", deal.currentAnnualTaxes);

  const risks: string[] = [];
  for (const f of (deal.redFlags || [])) if (f?.description) risks.push(f.description.trim());
  for (const r of (deal.dealScore?.risks || [])) if (r) risks.push(r.trim());
  const upside: string[] = [];
  for (const u of (deal.upsideItems || [])) if (u?.item) upside.push(`${u.item}${u.detail ? ` — ${u.detail}` : ""}`.trim());
  for (const s of (deal.dealScore?.strengths || [])) if (s) upside.push(s.trim());

  // Data-driven HIGHLIGHTS — punchy, scannable positives pulled straight from the
  // numbers (never invented). These give the teaser its "why this deal" at a glance.
  const mixData = analyzeCenterMix(deal);
  let igSF = 0, occSFt = 0;
  for (const t of occ) { const sf = n(t.sf) ?? 0; occSFt += sf; if (isInvestmentGrade(t.canonicalName || t.name || "", t.creditRating)) igSF += sf; }
  const igGLApct = occSFt > 0 ? Math.round((igSF / occSFt) * 100) : null;
  const occN = n(deal.occupancy), waltN = n(deal.walt);
  const highlights: string[] = [];
  if (occN != null && occN >= 96) highlights.push(`${occN >= 99.5 ? "Fully leased (100%)" : `${occN.toFixed(0)}% leased`} — minimal vacancy exposure`);
  if (waltN != null && waltN >= 5.5) highlights.push(`${waltN.toFixed(1)}-yr WALT — durable, long-dated income`);
  if (igGLApct != null && igGLApct >= 25) highlights.push(`Investment-grade anchors — ${igGLApct}% of occupied GLA`);
  if (mixData && mixData.resilienceScore >= 58) highlights.push(`${mixData.resilienceScore}/100 e-commerce resilience · ${mixData.necessityRentPct}% necessity/service`);
  if (inc3 != null && inc3 >= 90000) highlights.push(`Affluent trade area — $${Math.round(inc3 / 1000)}k avg HH income (3-mi)`);
  else if (pop3 != null && pop3 >= 100000) highlights.push(`Dense trade area — ${Math.round(pop3 / 1000)}k population (3-mi)`);
  const strongAnchors = anchorDetail.filter((a) => a.salesVsChain != null && a.salesVsChain >= 15).slice(0, 2);
  if (strongAnchors.length) highlights.push(`Anchors outproducing chain: ${strongAnchors.map((a) => `${a.name} +${a.salesVsChain}%`).join(", ")}`);

  const score = deal.dealScore;
  return {
    name: (deal.propertyName || "Untitled Deal").trim(),
    addressLine: [deal.address, [deal.city, deal.state].filter(Boolean).join(", "), deal.zip].filter(Boolean).join(" · ") || null,
    typeLine: [deal.centerType, deal.assetType].filter(Boolean).join(" / ") || null,
    generatedOn: today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    asOf: deal.tenantsAsOf ?? null,
    grade: score && (score.grade || score.score != null) ? { grade: score.grade ?? "—", score: score.score ?? null, rationale: score.rationale?.trim() || null } : null,
    metrics, demographics, anchors, anchorDetail, highlights, topTenants, concentration,
    mix: mixData, rollover, rolloverByYear, financials,
    risks: dedupeLines(risks).slice(0, 5),
    upside: dedupeLines(upside).slice(0, 5),
    narrative: typeof deal.notes === "string" && deal.notes.trim() ? deal.notes.trim() : null,
  };
}

export interface ICMemoOptions { generatedOn?: Date; allDeals?: Deal[] }

export function buildICMemo(deal: Deal, opts: ICMemoOptions = {}): string {
  const L: string[] = [];
  const today = opts.generatedOn ?? new Date();
  const tenants = (deal.tenants || []) as Tenant[];
  const occ = tenants.filter((t) => !isVacant(t.name) && !isNAPTenant(t));

  // ── Header ──────────────────────────────────────────────────────────────────
  const name = (deal.propertyName || "Untitled Deal").trim();
  L.push(`# Investment Committee Memo — ${name}`);
  const loc = [deal.address, [deal.city, deal.state].filter(Boolean).join(", "), deal.zip].filter(Boolean).join(" · ");
  const type = [deal.centerType, deal.assetType].filter(Boolean).join(" / ");
  const sub = [loc, type].filter(Boolean).join("  |  ");
  if (sub) L.push(`*${sub}*`);
  L.push(`*Generated ${today.toLocaleDateString()} · KPR OM Database*`);

  // ── Recommendation / grade ───────────────────────────────────────────────────
  const score = deal.dealScore;
  if (score && (score.grade || score.score != null)) {
    L.push(``, `## Recommendation`);
    const head = `**Grade: ${score.grade ?? "—"}${score.score != null ? ` (${score.score}/100)` : ""}**`;
    L.push(score.rationale ? `${head} — ${score.rationale.trim()}` : head);
  }

  // ── Investment overview ──────────────────────────────────────────────────────
  const ov: string[] = [];
  const price = money(deal.askingPrice), ppsf = money(deal.pricePerSF);
  if (price) ov.push(`- **Asking Price:** ${price}${ppsf ? ` (${ppsf}/SF)` : ""}`);
  if (n(deal.capRate) != null) ov.push(`- **In-Place Cap Rate:** ${pctFmt(deal.capRate, 2)}`);
  if (money(deal.noi)) ov.push(`- **NOI:** ${money(deal.noi)}`);
  const glaOcc = [sfFmt(deal.totalSF) && `GLA ${sfFmt(deal.totalSF)}`, pctFmt(deal.occupancy) && `Occupancy ${pctFmt(deal.occupancy)}`, n(deal.walt) != null && `WALT ${n(deal.walt)!.toFixed(1)} yrs`].filter(Boolean);
  if (glaOcc.length) ov.push(`- **${glaOcc.join("  |  ")}**`);
  if (n(deal.weightedAvgRentPSF) != null) ov.push(`- **Avg In-Place Rent:** $${n(deal.weightedAvgRentPSF)!.toFixed(2)}/SF`);
  const built = n(deal.yearBuilt), reno = n(deal.renovationYear);
  if (built != null || reno != null) ov.push(`- **Year Built${reno != null ? " / Renovated" : ""}:** ${built ?? "—"}${reno != null ? ` / ${reno}` : ""}`);
  if (ov.length) { L.push(``, `## Investment Overview`, ...ov); }

  // ── Location & demographics ──────────────────────────────────────────────────
  const demo = deal.marketDemographics;
  const pop3 = n(demo?.pop3mi) ?? n(deal.population3mi);
  const inc3 = n(demo?.avgHHI3mi) ?? n(deal.avgHHIncome3mi) ?? n(deal.medianHHIncome3mi);
  const traffic = n(deal.trafficCountVPD);
  if (pop3 != null || inc3 != null || traffic != null) {
    L.push(``, `## Location & Demographics`);
    const d: string[] = [];
    if (pop3 != null) d.push(`Population (3-mi): **${Math.round(pop3).toLocaleString()}**`);
    if (inc3 != null) d.push(`Avg HH Income (3-mi): **${money(inc3)}**`);
    if (traffic != null) d.push(`Traffic: **${Math.round(traffic).toLocaleString()} VPD**`);
    L.push(d.join("  ·  "));
    if (demo?.confidence) L.push(`*Demographics confidence: ${demo.confidence}${demo.source ? ` (${demo.source})` : ""}.*`);
  }

  // ── Tenancy + retail mix ─────────────────────────────────────────────────────
  if (occ.length) {
    L.push(``, `## Tenancy`);
    if (deal.tenantsAsOf) L.push(`*Rent roll as of ${deal.tenantsAsOf}${deal.tenantsSource ? ` (${deal.tenantsSource})` : ""}.*`);

    const rentOf = (t: Tenant) => n(t.annualRent) ?? (n(t.rentPerSF) != null && n(t.sf) != null ? n(t.rentPerSF)! * n(t.sf)! : 0);
    const anchors = occ.filter((t) => t.isAnchor === true || (n(t.sf) ?? 0) >= 20000);
    if (anchors.length) {
      const a = anchors.slice(0, 6).map((t) => `${t.name}${sfFmt(t.sf) ? ` (${sfFmt(t.sf)})` : ""}`).join(", ");
      L.push(`**Anchor(s):** ${a}.`);
    }
    // Top tenants by rent + concentration
    const ranked = [...occ].map((t) => ({ t, rent: rentOf(t) })).filter((x) => x.rent > 0).sort((a, b) => b.rent - a.rent);
    const totalRent = ranked.reduce((s, x) => s + x.rent, 0);
    if (ranked.length && totalRent > 0) {
      const top = ranked.slice(0, 5).map((x) => `${x.t.name} (${pctFmt((x.rent / totalRent) * 100, 0)})`).join(", ");
      L.push(`**Top tenants by rent:** ${top}.`);
      const top1 = (ranked[0].rent / totalRent) * 100;
      const top3 = ranked.slice(0, 3).reduce((s, x) => s + x.rent, 0) / totalRent * 100;
      L.push(`**Rent concentration:** top tenant ${pctFmt(top1, 0)} of base rent; top 3 ${pctFmt(top3, 0)}.`);
    }

    // Retail mix & resilience
    const mix = analyzeCenterMix(deal);
    if (mix) {
      L.push(``, `**Retail mix & resilience:** ${mix.characterization}`);
      L.push(`*Resilience score ${mix.resilienceScore}/100 · ${mix.resistantRentPct}% internet-resistant rent · ${mix.necessityRentPct}% necessity/service.*`);
      for (const s of mix.slices.slice(0, 8)) {
        L.push(`- ${s.category}: **${s.rentPct}%** of rent (${s.sfPct}% GLA, ${s.count} tenant${s.count === 1 ? "" : "s"})`);
      }
    }
  }

  // ── Lease rollover ───────────────────────────────────────────────────────────
  if (occ.length) {
    const ref = refDate(deal);
    const horizon = ref.getFullYear() + 3;
    const rentOf = (t: Tenant) => n(t.annualRent) ?? 0;
    const totalRent = occ.reduce((s, t) => s + rentOf(t), 0);
    const expiring = occ.filter((t) => { const y = yr(t.leaseExpiry); return y != null && y <= horizon; });
    if (expiring.length) {
      const rollRent = expiring.reduce((s, t) => s + rentOf(t), 0);
      const pct = totalRent > 0 ? ` (${pctFmt((rollRent / totalRent) * 100, 0)} of base rent)` : "";
      L.push(``, `## Lease Rollover`);
      L.push(`**${expiring.length} lease${expiring.length === 1 ? "" : "s"}${pct} expire through ${horizon}.**${n(deal.walt) != null ? ` Portfolio WALT ${n(deal.walt)!.toFixed(1)} yrs.` : ""}`);
    }
  }

  // ── Financial summary ────────────────────────────────────────────────────────
  const fin: string[] = [];
  const addFin = (label: string, v: unknown) => { const m = money(v); if (m) fin.push(`- **${label}:** ${m}`); };
  addFin("Gross Potential Rent", deal.grossPotentialRent);
  addFin("Effective Gross Income", deal.effectiveGrossIncome);
  addFin("Operating Expenses", deal.operatingExpenses);
  addFin("NNN Recoveries", deal.nnnRecoveries);
  addFin("Net Operating Income", deal.noi);
  addFin("Real Estate Taxes", deal.currentAnnualTaxes);
  if (fin.length) { L.push(``, `## Financial Summary`, ...fin); }

  // ── Risks ────────────────────────────────────────────────────────────────────
  const risks: string[] = [];
  for (const f of (deal.redFlags || [])) if (f?.description) risks.push(`- ${f.severity ? `**[${f.severity}]** ` : ""}${f.description}`);
  for (const r of (score?.risks || [])) if (r) risks.push(`- ${r}`);
  if (risks.length) { L.push(``, `## Risks`, ...dedupeLines(risks).slice(0, 12)); }

  // ── Upside / value-add ───────────────────────────────────────────────────────
  const ups: string[] = [];
  for (const u of (deal.upsideItems || [])) if (u?.item) ups.push(`- ${u.priority ? `**[${u.priority}]** ` : ""}${u.item}${u.detail ? ` — ${u.detail}` : ""}`);
  for (const s of (score?.strengths || [])) if (s) ups.push(`- ${s}`);
  if (ups.length) { L.push(``, `## Upside / Value-Add`, ...dedupeLines(ups).slice(0, 12)); }

  // ── Narrative + KPR view ─────────────────────────────────────────────────────
  if (typeof deal.notes === "string" && deal.notes.trim()) { L.push(``, `## Underwriting Narrative`, deal.notes.trim()); }
  const kpr = [typeof deal.dealReview === "string" ? deal.dealReview.trim() : "", typeof deal.dealThesis === "string" ? deal.dealThesis.trim() : ""].filter(Boolean);
  if (kpr.length) { L.push(``, `## KPR View`, kpr.join("\n\n")); }

  L.push(``, `---`, `*Auto-generated from captured OM data. Figures reflect the offering memorandum / rent roll as extracted; verify against source documents before committee.*`);
  return L.join("\n");
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const l of lines) { const k = l.toLowerCase().replace(/\s+/g, " ").trim(); if (!seen.has(k)) { seen.add(k); out.push(l); } }
  return out;
}
