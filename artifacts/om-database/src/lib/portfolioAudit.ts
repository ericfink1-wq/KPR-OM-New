// Portfolio-wide DATA AUDIT — runs the deterministic checks that recently caught
// real errors across EVERY deal, so issues surface as a list instead of being
// found one screen at a time. Two checks today:
//   1. Reimbursement: tenants whose recovery is FIXED CAM (landlord bears CAM
//      growth — the class the classifier was mislabeling as NNN) or GROSS.
//   2. Tax capture: deals where reconcileTaxCapture flags a problem — most
//      importantly the "market value captured as the assessed value" swap.
// Pure + deterministic (no model); reuses the exact same functions the app uses.

import type { Deal } from "./idb";
import { reimbursementFlag, isVacant, isNAPTenant } from "./utils";
import { reconcileTaxCapture } from "./taxReassessment";
import { detectDealAnomalies } from "./dealAnomalies";

const dealName = (d: Deal) => d.propertyName || d.fileName || "Untitled deal";

export interface ReimbTenant { tenant: string; text: string }
export interface ReimbDealGroup { dealId: string; dealName: string; fixedCam: ReimbTenant[]; gross: ReimbTenant[] }
export interface TaxFinding {
  dealId: string; dealName: string; severity: "high" | "medium" | "info"; message: string;
}
export interface AnomalyFinding {
  dealId: string; dealName: string; severity: "medium" | "low"; messages: string[];
}
export interface DuplicateFinding {
  severity: "high" | "low"; dealName: string; ids: string[]; addresses: string[]; message: string;
}
export interface PortfolioAudit {
  reimbDeals: ReimbDealGroup[];   // grouped by deal (only deals with ≥1 finding); fixed-CAM deals first
  fixedCamCount: number;
  grossCount: number;
  tax: TaxFinding[];
  anomalies: AnomalyFinding[];    // figures that are outliers vs the database (sharper as the DB grows)
  duplicates: DuplicateFinding[]; // same property entered twice (re-import) — a safety net
  dealsScanned: number;
}

export function auditReimbursement(deals: Deal[]): { groups: ReimbDealGroup[]; fixedCamCount: number; grossCount: number } {
  const groups: ReimbDealGroup[] = [];
  let fixedCamCount = 0, grossCount = 0;
  for (const d of deals || []) {
    if (d.trashedAt) continue;
    const fixedCam: ReimbTenant[] = [];
    const gross: ReimbTenant[] = [];
    for (const t of d.tenants || []) {
      if (isVacant(t.name) || isNAPTenant(t)) continue;
      const text = [t.leaseType, t.reimbursementMethod].filter(Boolean).join(" — ").trim();
      if (!text) continue;
      const f = reimbursementFlag(text);
      if (f?.label === "FIXED CAM") { fixedCam.push({ tenant: t.name || "(unnamed)", text }); fixedCamCount++; }
      else if (f?.label === "GROSS" || f?.label === "MOD GROSS") { gross.push({ tenant: t.name || "(unnamed)", text }); grossCount++; }
    }
    if (fixedCam.length || gross.length) groups.push({ dealId: d.id, dealName: dealName(d), fixedCam, gross });
  }
  // Deals with fixed-CAM tenants first (the real concern), then by name.
  groups.sort((a, b) => (b.fixedCam.length > 0 ? 1 : 0) - (a.fixedCam.length > 0 ? 1 : 0) || a.dealName.localeCompare(b.dealName));
  return { groups, fixedCamCount, grossCount };
}

export function auditTaxCapture(deals: Deal[]): TaxFinding[] {
  const out: TaxFinding[] = [];
  for (const d of deals || []) {
    if (d.trashedAt) continue;
    const check = reconcileTaxCapture(d);
    for (const w of check.warnings) {
      if (w.severity === "high" || w.severity === "medium") {
        out.push({ dealId: d.id, dealName: dealName(d), severity: w.severity, message: w.message });
      }
    }
  }
  const order = { high: 0, medium: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity] || a.dealName.localeCompare(b.dealName));
}

// Outliers vs the database — each deal's figures compared to the distribution of the
// same figure across the other deals (cap rate / avg rent by product type, tenant
// rent PSF by brand). Sharpens as the database grows.
export function auditAnomalies(deals: Deal[]): AnomalyFinding[] {
  const out: AnomalyFinding[] = [];
  for (const d of deals || []) {
    if (d.trashedAt) continue;
    const a = detectDealAnomalies(d, deals);
    if (a.length) {
      out.push({
        dealId: d.id, dealName: dealName(d),
        severity: a.some((x) => x.severity === "medium") ? "medium" : "low",
        messages: a.map((x) => x.message),
      });
    }
  }
  const order = { medium: 0, low: 1 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity] || a.dealName.localeCompare(b.dealName));
}

// Duplicate safety net — the same property entered twice (usually a re-import).
// Same name + same NORMALIZED address = a real duplicate (high); same name +
// different address = a "confirm these are distinct" nudge (low), because two centers
// can legitimately share a name (e.g. two "University Hills" in different cities).
// Trashed deals are excluded, so a duplicate you've already resolved never re-surfaces.
function normAddrForDup(a: unknown): string | null {
  if (typeof a !== "string") return null;
  return a.trim().toLowerCase().replace(/[.,]/g, "")
    .replace(/\broad\b/g, "rd").replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave").replace(/\bboulevard\b/g, "blvd")
    .replace(/\bdrive\b/g, "dr").replace(/\blane\b/g, "ln")
    .replace(/\bparkway\b/g, "pkwy").replace(/\s+/g, " ").trim() || null;
}
// Two same-name deals are the SAME property when they share a normalized address OR
// they share an identical building GLA in the same state. The GLA+state rule catches
// re-imports whose address STRING drifted ("921 Wolcott St" vs "921-983 Wolcott
// Street") — two centers with the same name AND the exact same SF in one state is a
// re-import, not a coincidence. This is the common KPR pattern: a Prospect OM is
// re-uploaded and marked Owned after closing, leaving a stale Prospect twin.
function sameProperty(a: Deal, b: Deal): boolean {
  const na = normAddrForDup(a.address), nb = normAddrForDup(b.address);
  if (na && nb && na === nb) return true;
  const sa = Number(a.totalSF), sb = Number(b.totalSF);
  const st = (x: unknown) => String(x ?? "").trim().toLowerCase();
  if (Number.isFinite(sa) && sa > 0 && sa === sb && st(a.state) && st(a.state) === st(b.state)) return true;
  return false;
}
export function auditDuplicates(deals: Deal[]): DuplicateFinding[] {
  const byName = new Map<string, Deal[]>();
  for (const d of deals || []) {
    if (d.trashedAt) continue;
    const n = (d.propertyName || "").trim().toLowerCase();
    if (!n) continue;
    const arr = byName.get(n) ?? [];
    arr.push(d);
    byName.set(n, arr);
  }
  const out: DuplicateFinding[] = [];
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    // Transitively cluster deals that are the same property (addr or GLA+state).
    const clusters: Deal[][] = [];
    for (const d of group) {
      const hit = clusters.find((c) => c.some((x) => sameProperty(x, d)));
      if (hit) hit.push(d); else clusters.push([d]);
    }
    const realDupe = clusters.find((c) => c.length > 1);
    if (realDupe) {
      out.push({ severity: "high", dealName: dealName(realDupe[0]), ids: realDupe.map((d) => d.id),
        addresses: [...new Set(realDupe.map((d) => d.address || "—"))],
        message: `${realDupe.length} live copies of the same property (same address or identical GLA in one state) — likely a re-import duplicate. Keep the better record and delete the other.` });
    } else {
      out.push({ severity: "low", dealName: dealName(group[0]), ids: group.map((d) => d.id),
        addresses: group.map((d) => d.address || "—"),
        message: `${group.length} deals share this name at different addresses — confirm they're genuinely different properties, not a duplicate with a mistyped address.` });
    }
  }
  return out.sort((a, b) => (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1) || a.dealName.localeCompare(b.dealName));
}

export function runPortfolioAudit(deals: Deal[]): PortfolioAudit {
  const active = (deals || []).filter((d) => !d.trashedAt);
  const reimb = auditReimbursement(active);
  return { reimbDeals: reimb.groups, fixedCamCount: reimb.fixedCamCount, grossCount: reimb.grossCount, tax: auditTaxCapture(active), anomalies: auditAnomalies(active), duplicates: auditDuplicates(active), dealsScanned: active.length };
}
