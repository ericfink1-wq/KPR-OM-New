// INVESTMENT COMMITTEE MEMO generator. Assembles a deal's structured data into a polished,
// exportable institutional memo (Markdown — opens anywhere, pastes cleanly into Word). Pure
// and deterministic so it's free, instant, and fully testable; sections with no data are
// omitted rather than printed empty. Pulls in the retail-mix intelligence so every memo
// leads with the defensive/discretionary read an IC cares about.

import type { Deal, Tenant } from "./idb";
import { isVacant, isNAPTenant } from "./utils";
import { analyzeCenterMix } from "./retailCategory";

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

export interface ICMemoOptions { generatedOn?: Date }

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
