// Deterministic, token-free AUTO-CORRECTION sweep — the single source of truth for
// "fix the data issues that have one right answer." Called by BOTH the manual
// Portfolio-Analytics button (POST /deals/autofix) and the weekly self-improvement
// scheduler, so the two never diverge. Snapshots first (fully reversible) and leaves
// anything ambiguous for human review.

import { db, dealsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { auditExtraction, AUDIT_ID_PREFIX } from "./extractionAudit";
import { createSnapshot } from "../routes/snapshots";
import { normalizeDate, deriveRents } from "./importFixes";
import { repairCoTenancyTrigger, type CoTenancyLike } from "./coTenancyStructure";
import { logger } from "./logger";
import type { Logger } from "pino";

export interface AutofixResult {
  scanned: number; occCostFixed: number; occUnitFixed: number; capUnitFixed: number;
  ppsfFixed: number; rentFixed: number; rentFilled: number; dupeFixed: number;
  dateFixed: number; metricFixes: number; changedDeals: number; cleared: number;
  coTenancyFixed: number;
  snapshot: unknown;
}

const nA = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[$,%\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const isVacA = (name: unknown): boolean => {
  const s = String(name ?? "").trim().toLowerCase();
  return !s || s === "-" || /^(vacant|available|avail|spec(ulative)?|white\s*box|tbd|to\s+be\s+leased)\b/.test(s);
};
const isNAPA = (t: Record<string, unknown>): boolean => {
  if (t.isNAP === true) return true;
  if (isVacA(t.name)) return false;
  const hasLease = !!((typeof t.leaseStart === "string" && t.leaseStart.trim()) || (typeof t.leaseExpiry === "string" && t.leaseExpiry.trim()) || (typeof t.rentSchedule === "string" && t.rentSchedule.trim()));
  if (hasLease) return false;
  const sf = nA(t.sf), r = nA(t.annualRent), rp = nA(t.rentPerSF);
  return sf != null && sf > 0 && (r == null || r === 0) && (rp == null || rp === 0);
};
const parseD = (s: unknown): Date | null => {
  const str = String(s ?? "").trim(); if (!str) return null;
  const d = new Date(str + (/^\d{4}-\d{2}-\d{2}$/.test(str) ? "T12:00:00" : ""));
  return isNaN(d.getTime()) ? null : d;
};
// Faithful port of recomputeRosterMetrics (om-database/src/lib/utils.ts) — keep in sync.
const recompute = (tenants: Record<string, unknown>[], asOf: unknown, deal: Record<string, unknown>) => {
  const ver = (deal.verified || {}) as Record<string, unknown>;
  const out: { occupancy?: number; walt?: number; weightedAvgRentPSF?: number } = {};
  const ref = parseD(asOf) ?? new Date();
  const occ = tenants.filter(t => !isVacA(t.name) && !isNAPA(t));
  const totalSF = nA(deal.totalSF);
  if (!ver.occupancy && totalSF && totalSF > 0) {
    const o = Math.round(occ.reduce((s, t) => s + (nA(t.sf) ?? 0), 0) / totalSF * 1000) / 10;
    if (o > 0 && o <= 100) out.occupancy = o;
  }
  if (!ver.walt) {
    let sf = 0, w = 0;
    for (const t of occ) { const s = nA(t.sf); if (!s) continue; const e = parseD(t.leaseExpiry); const yr = e ? Math.max(0, (e.getTime() - ref.getTime()) / (365.25 * 86_400_000)) : nA(t.remainingTermYears); if (yr == null) continue; sf += s; w += s * yr; }
    if (w > 0 && sf > 0) out.walt = Math.round(w / sf * 10) / 10;
  }
  if (!ver.weightedAvgRentPSF) {
    let sf = 0, w = 0;
    for (const t of occ) { const s = nA(t.sf), r = nA(t.rentPerSF); if (s && s > 0 && r && r > 0) { sf += s; w += s * r; } }
    if (sf > 0) out.weightedAvgRentPSF = Math.round(w / sf * 100) / 100;
  }
  return out;
};

export async function runAutofixSweep(log: Logger = logger): Promise<AutofixResult> {
  const snap = await createSnapshot("before-autofix");
  const rows = await db.select().from(dealsTable);
  let scanned = 0, occCostFixed = 0, rentFixed = 0, dupeFixed = 0, metricFixes = 0, changedDeals = 0, cleared = 0;
  let coTenancyFixed = 0;
  let occUnitFixed = 0, capUnitFixed = 0, ppsfFixed = 0, dateFixed = 0, rentFilled = 0;
  for (const r of rows) {
    const data = r.data as Record<string, unknown>;
    if (data.trashedAt || data._processing || data._processingError) continue;
    scanned++;
    let changed = false;
    // 1. Per-tenant deterministic fixes
    const tenants = (Array.isArray(data.tenants) ? data.tenants : []).map((raw) => {
      const t = { ...(raw as Record<string, unknown>) };
      const oc = nA(t.occupancyCost);
      if (oc != null && oc > 0 && oc < 1) { t.occupancyCost = Math.round(oc * 100 * 100) / 100; occCostFixed++; changed = true; }
      for (const f of ["leaseStart", "leaseExpiry", "originalLeaseDate", "rentCommencement", "rentStart"] as const) {
        const iso = normalizeDate(t[f]);
        if (iso) { t[f] = iso; dateFixed++; changed = true; }
      }
      const sf = nA(t.sf), psf = nA(t.rentPerSF), ann = nA(t.annualRent);
      if (sf && psf && ann && ann > 1000 && !isVacA(t.name) && !isNAPA(t)) {
        const implied = psf * sf, rel = Math.abs(implied - ann) / ann, realPSF = ann / sf;
        if (rel > 0.15 && Math.abs(implied - ann) > 10000 && realPSF >= 2 && realPSF <= 80) {
          t.rentPerSF = Math.round(realPSF * 100) / 100; rentFixed++; changed = true;
        }
      }
      return t;
    });
    // Dedupe true duplicate rows that double-count SF (keep the LATER lease expiry).
    const dedup: Record<string, unknown>[] = [];
    const seen = new Map<string, number>();
    for (const t of tenants) {
      if (isVacA(t.name)) { dedup.push(t); continue; }
      const name = String(t.name ?? "").trim().toLowerCase();
      const suite = String(t.suite ?? "").trim().toLowerCase();
      const exp = String(t.leaseExpiry ?? "").trim();
      const key = suite ? `${name}|s:${suite}` : (exp ? `${name}|e:${exp}` : null);
      const at = key != null ? seen.get(key) : undefined;
      if (key != null && at != null) {
        const prev = dedup[at];
        const sfPrev = nA(prev.sf), sfCur = nA(t.sf);
        const sfOk = !!suite || sfPrev == null || sfCur == null || sfPrev === 0 ||
          Math.abs(sfPrev - sfCur) / Math.max(sfPrev, sfCur) <= 0.25;
        if (sfOk) {
          const prevExp = parseD(prev.leaseExpiry), curExp = parseD(t.leaseExpiry);
          if (curExp && (!prevExp || curExp > prevExp)) dedup[at] = t;
          dupeFixed++; changed = true;
          continue;
        }
      }
      if (key != null) seen.set(key, dedup.length);
      dedup.push(t);
    }
    const { tenants: withRents, filled: rf } = deriveRents(dedup);
    if (rf > 0) { rentFilled += rf; changed = true; }
    const updated: Record<string, unknown> = { ...data, tenants: withRents };
    // 1b. Deal-level UNAMBIGUOUS unit fixes.
    {
      const oc = nA(updated.occupancy);
      if (oc != null && oc > 0 && oc <= 1.0) { updated.occupancy = Math.round(oc * 100 * 10) / 10; occUnitFixed++; changed = true; }
      const cap = nA(updated.capRate);
      if (cap != null && cap >= 100) { updated.capRate = Math.round(cap) / 100; capUnitFixed++; changed = true; }
      else if (cap != null && cap > 0 && cap < 1) { updated.capRate = Math.round(cap * 100 * 100) / 100; capUnitFixed++; changed = true; }
      const price = nA(updated.askingPrice) ?? nA(updated.txnPurchasePrice);
      const tsf = nA(updated.totalSF);
      const ppsf = nA(updated.pricePerSF);
      if (ppsf != null && ppsf > 0 && price != null && price > 0 && tsf != null && tsf > 0) {
        const real = Math.round(price / tsf);
        if (real > 0 && Math.abs(real - ppsf) / ppsf > 0.05) { updated.pricePerSF = real; ppsfFixed++; changed = true; }
      }
    }
    // 1c. Restructure an "X of N" co-tenancy that was stored as a per-anchor OR.
    // Safe by construction: the repair fires ONLY when the clause's own verbatim
    // quote names the same store set the trigger already carries, so no store is
    // added or removed — only the count the quote states verbatim is applied. A
    // clause whose quote and trigger disagree is left untouched and stays flagged.
    {
      const lr = updated.leaseRisk as { tenants?: Array<{ coTenancy?: CoTenancyLike[] | null }> } | null | undefined;
      if (lr?.tenants?.length) {
        let anyFixed = false;
        const nextTenants = lr.tenants.map((t) => {
          if (!t?.coTenancy?.length) return t;
          let touched = false;
          const clauses = t.coTenancy.map((c) => {
            const { clause, repaired } = repairCoTenancyTrigger(c);
            if (repaired) { touched = true; coTenancyFixed++; }
            return clause;
          });
          if (!touched) return t;
          anyFixed = true;
          return { ...t, coTenancy: clauses };
        });
        if (anyFixed) { updated.leaseRisk = { ...lr, tenants: nextTenants }; changed = true; }
      }
    }
    // 2. Recompute roster-derived metrics (honors verified locks)
    const m = recompute(withRents, updated.tenantsAsOf, updated);
    for (const k of ["occupancy", "walt", "weightedAvgRentPSF"] as const) {
      if (m[k] != null && nA(updated[k]) !== m[k]) { updated[k] = m[k]; metricFixes++; changed = true; }
    }
    // 3. Self-heal audit questions (same rules as reaudit)
    const fresh = auditExtraction(updated);
    const freshIds = new Set(fresh.map(q => q.id));
    const existing = Array.isArray(updated.reviewQuestions) ? (updated.reviewQuestions as Array<Record<string, unknown>>) : [];
    const kept = existing.filter(q => { const id = String(q?.id || ""); if (!id.startsWith(AUDIT_ID_PREFIX)) return true; if (q?.resolvedAt) return true; return freshIds.has(id); });
    const keptIds = new Set(kept.map(q => String(q?.id || "")));
    const next = [...kept, ...fresh.filter(q => !keptIds.has(q.id))];
    const clearedHere = existing.length - kept.length;
    if (clearedHere || next.length !== existing.length) { updated.reviewQuestions = next; cleared += clearedHere; changed = changed || clearedHere > 0; }
    if (changed) { changedDeals++; await db.update(dealsTable).set({ data: updated, updatedAt: new Date() }).where(eq(dealsTable.id, r.id)); }
  }
  log.info({ scanned, occCostFixed, occUnitFixed, capUnitFixed, ppsfFixed, rentFixed, rentFilled, dupeFixed, dateFixed, metricFixes, coTenancyFixed, changedDeals, cleared }, "Auto-fix sweep complete");
  return { scanned, occCostFixed, occUnitFixed, capUnitFixed, ppsfFixed, rentFixed, rentFilled, dupeFixed, dateFixed, metricFixes, coTenancyFixed, changedDeals, cleared, snapshot: snap };
}
