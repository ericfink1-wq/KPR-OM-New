import type { LeaseAbstract, Tenant } from "./idb";
import type { WatchMap } from "./useWatchlist";
import { reimbursementMethodFromAbstract } from "./utils";

// Live, token-free reconciliation of a lease abstract against the roster:
//  - fill:        roster fields the lease can supply where the roster is blank
//  - discrepancies: where the roster (broker/OM/rent-roll) disagrees with the lease
//  - risks:       co-tenancy/operating clauses leaning on a distressed/unowned/dark tenant
// The lease (abstract) is treated as authoritative; corrections are surfaced, not forced
// (except blank-fill, which only ADDS missing data and never overwrites).

export interface AbstractChecks {
  discrepancies: string[];
  risks: string[];
  fill: Partial<Tenant>;
  fillLabels: string[];
  tenantIndex: number;
}

export function pnum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Extract the FIRST number only — strings like "$750,603/yr ($62,550.25/mo)"
  // must parse to 750603, not concatenate both numbers.
  const m = String(v).match(/-?\$?\s*[\d,]*\.?\d+/);
  if (!m) return null;
  const n = Number(m[0].replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function currentAnnualRent(a: LeaseAbstract): number | null {
  const today = new Date().toISOString().slice(0, 10);
  // An option whose window covers today IS the current period (regardless of how
  // its status was tagged). Use windowEnd OR expireDate for the end — abstracts
  // use one or the other.
  for (const o of a.options ?? []) {
    const start = o.windowStart ? String(o.windowStart) : "";
    const end = o.windowEnd ? String(o.windowEnd) : (o.expireDate ? String(o.expireDate) : "");
    if (start && end && start <= today && today <= end) { const n = pnum(o.rent); if (n) return n; }
  }
  const rs = a.rentSchedule ?? [];
  for (const r of rs) {
    const s = r.periodStart ? String(r.periodStart) : ""; const e = r.periodEnd ? String(r.periodEnd) : "";
    if (s && e && s <= today && today <= e) { const n = pnum(r.annualRent); if (n) return n; }
  }
  // No dated period covers today. Prefer the curated in-place base rent — for a
  // not-yet-commenced or undated rent schedule this is the rent that will be (or is)
  // in place, which is what the roster's "current rent" reflects. Without this the
  // fallback would grab the LAST schedule row — a far-future OPTION-period rent — and
  // raise a false "roster vs lease" discrepancy (e.g. a build-to-suit not yet open).
  const base = pnum(a.baseRentAnnual);
  if (base) return base;
  // Nothing curated: if the term hasn't commenced (no dated period at/ before today),
  // the initial (FIRST) step is the in-place rent — not the last/option step.
  const starts = rs.map((r) => (r.periodStart ? String(r.periodStart) : "")).filter(Boolean).sort();
  const notCommenced = !starts.length || today < starts[0];
  if (notCommenced) { for (const r of rs) { const n = pnum(r.annualRent); if (n) return n; } }
  // Otherwise today is past all known periods (holdover) — use the last step.
  for (let i = rs.length - 1; i >= 0; i--) { const n = pnum(rs[i].annualRent); if (n) return n; }
  return null;
}

const EMPTY_WATCH: WatchMap = new Map();

export function computeAbstractChecks(a: LeaseAbstract, tenants: Tenant[], watchMap: WatchMap = EMPTY_WATCH): AbstractChecks {
  const discrepancies: string[] = []; const risks: string[] = [];
  const fill: Partial<Tenant> = {}; const fillLabels: string[] = [];
  const k = (s?: string | null) => (s || "").trim().toLowerCase();
  const tenantIndex = tenants.findIndex((x) => x.name && (k(x.name) === k(a.tenantName) || (!!a.dba && k(a.dba).includes(k(x.name)) && k(x.name).length > 3)));
  const t = tenantIndex >= 0 ? tenants[tenantIndex] : undefined;

  if (t) {
    const empty = (v: unknown) => v == null || v === "" || (typeof v === "number" && Number.isNaN(v));
    const aSF = pnum(a.premisesGLA ?? a.currentSF);
    const aRent = currentAnnualRent(a);
    const sf = pnum(t.sf) ?? aSF;
    // Blank-fill (adds only; never overwrites).
    if (empty(t.sf) && aSF) { fill.sf = aSF; fillLabels.push(`SF ${aSF.toLocaleString()}`); }
    if (empty(t.leaseStart) && a.commencement) { fill.leaseStart = String(a.commencement).slice(0, 10); fillLabels.push(`lease start ${fill.leaseStart}`); }
    if (empty(t.leaseExpiry) && a.expiration) { fill.leaseExpiry = String(a.expiration).slice(0, 10); fillLabels.push(`expiry ${fill.leaseExpiry}`); }
    if (empty(t.annualRent) && aRent) { fill.annualRent = aRent; fillLabels.push(`annual rent $${Math.round(aRent).toLocaleString()}`); }
    if (empty(t.rentPerSF) && aRent && sf) { fill.rentPerSF = Math.round((aRent / sf) * 100) / 100; fillLabels.push(`rent/SF $${fill.rentPerSF}`); }
    if (empty(t.renewalOptions) && a.options?.length) { const len = a.options[0].length || ""; fill.renewalOptions = `${a.options.length} @ ${len}`.trim(); fillLabels.push(`options "${fill.renewalOptions}"`); }
    // Reimbursement method from the executed lease's recovery structure (NNN/Gross),
    // when the OM/rent roll left it blank. This is the field the occupancy-cost
    // recovery estimate and the expense-risk flag read — so filling it here means a
    // tenant that reimburses CAM/taxes/insurance is no longer mistaken for gross just
    // because the OM didn't state recoveries. A cap or fixed OC charge stays NNN.
    if (empty(t.reimbursementMethod)) { const rm = reimbursementMethodFromAbstract(a); if (rm) { fill.reimbursementMethod = rm; fillLabels.push(`reimbursement "${rm}"`); } }
    // Discrepancies (roster has a conflicting non-blank value).
    const rSF = pnum(t.sf);
    if (aSF && rSF && Math.abs(aSF - rSF) / rSF > 0.015) discrepancies.push(`SF — roster shows ${rSF.toLocaleString()}, lease shows ${aSF.toLocaleString()}.`);
    const rRent = pnum(t.annualRent);
    if (aRent && rRent && Math.abs(aRent - rRent) / rRent > 0.02) discrepancies.push(`Current annual rent — roster shows $${Math.round(rRent).toLocaleString()}, lease shows $${Math.round(aRent).toLocaleString()}.`);
    const aExp = a.expiration ? String(a.expiration).slice(0, 10) : ""; const rExp = t.leaseExpiry ? String(t.leaseExpiry).slice(0, 10) : "";
    if (aExp && rExp && aExp !== rExp) discrepancies.push(`Lease expiration — roster shows ${rExp}, lease shows ${aExp}.`);
  }

  // Co-tenancy / operating-covenant clauses leaning on a distressed/unowned/dark tenant.
  const clause = (a.leaseNotes ?? []).filter((n) => ["COTENCY", "OPC", "KICKTN"].includes(String(n.code))).map((n) => n.value || "").join("  ").toLowerCase();
  if (clause && !/^none\.?$/.test(clause.trim())) {
    const seen = new Set<string>();
    for (const e of watchMap.values()) {
      const b = (e.brand || "").trim();
      if (b.length >= 3 && clause.includes(b.toLowerCase()) && !seen.has(b.toLowerCase())) { seen.add(b.toLowerCase()); risks.push(`Co-tenancy references ${b} — on the retailer watchlist (${e.status}). A dependence on a distressed retailer weakens this clause.`); }
    }
    for (const x of tenants) {
      const nm = (x.name || "").trim();
      if (nm.length >= 3 && (x.isNAP || x.isDark) && clause.includes(nm.toLowerCase()) && !seen.has(nm.toLowerCase())) { seen.add(nm.toLowerCase()); risks.push(`Co-tenancy references ${nm} — ${x.isNAP ? "an unowned (NAP) tenant KPR doesn't control" : "a dark store"}.`); }
    }
  }

  return { discrepancies, risks, fill, fillLabels, tenantIndex };
}
