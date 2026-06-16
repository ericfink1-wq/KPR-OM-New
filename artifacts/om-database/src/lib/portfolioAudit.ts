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

const dealName = (d: Deal) => d.propertyName || d.fileName || "Untitled deal";

export interface ReimbTenant { tenant: string; text: string }
export interface ReimbDealGroup { dealId: string; dealName: string; fixedCam: ReimbTenant[]; gross: ReimbTenant[] }
export interface TaxFinding {
  dealId: string; dealName: string; severity: "high" | "medium" | "info"; message: string;
}
export interface PortfolioAudit {
  reimbDeals: ReimbDealGroup[];   // grouped by deal (only deals with ≥1 finding); fixed-CAM deals first
  fixedCamCount: number;
  grossCount: number;
  tax: TaxFinding[];
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
      else if (f?.label === "GROSS") { gross.push({ tenant: t.name || "(unnamed)", text }); grossCount++; }
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

export function runPortfolioAudit(deals: Deal[]): PortfolioAudit {
  const active = (deals || []).filter((d) => !d.trashedAt);
  const reimb = auditReimbursement(active);
  return { reimbDeals: reimb.groups, fixedCamCount: reimb.fixedCamCount, grossCount: reimb.grossCount, tax: auditTaxCapture(active), dealsScanned: active.length };
}
