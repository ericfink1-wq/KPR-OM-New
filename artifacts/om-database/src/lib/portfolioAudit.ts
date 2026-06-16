// Portfolio-wide DATA AUDIT — runs the deterministic checks that recently caught
// real errors across EVERY deal, so issues surface as a list instead of being
// found one screen at a time. Two checks today:
//   1. Reimbursement: tenants whose recovery is FIXED CAM / GROSS (landlord bears
//      expense growth) — the class the classifier was mislabeling as NNN.
//   2. Tax capture: deals where reconcileTaxCapture flags a problem — most
//      importantly the "market value captured as the assessed value" swap.
// Pure + deterministic (no model); reuses the exact same functions the app uses.

import type { Deal } from "./idb";
import { reimbursementFlag, isVacant, isNAPTenant } from "./utils";
import { reconcileTaxCapture } from "./taxReassessment";

const dealName = (d: Deal) => d.propertyName || d.fileName || "Untitled deal";

export interface ReimbFinding {
  dealId: string; dealName: string; tenant: string; label: "FIXED CAM" | "GROSS"; method: string;
}
export interface TaxFinding {
  dealId: string; dealName: string; severity: "high" | "medium" | "info"; message: string;
}
export interface PortfolioAudit {
  reimbursement: ReimbFinding[];
  tax: TaxFinding[];
  dealsScanned: number;
}

export function auditReimbursement(deals: Deal[]): ReimbFinding[] {
  const out: ReimbFinding[] = [];
  for (const d of deals || []) {
    if (d.trashedAt) continue;
    for (const t of d.tenants || []) {
      if (isVacant(t.name) || isNAPTenant(t)) continue;
      const text = [t.leaseType, t.reimbursementMethod].filter(Boolean).join(" ").trim();
      if (!text) continue;
      const f = reimbursementFlag(text);
      if (f && (f.label === "FIXED CAM" || f.label === "GROSS")) {
        out.push({ dealId: d.id, dealName: dealName(d), tenant: t.name || "(unnamed)", label: f.label, method: t.reimbursementMethod || t.leaseType || "" });
      }
    }
  }
  // Landlord-expense-risk first, then by deal.
  return out.sort((a, b) => (a.label === b.label ? a.dealName.localeCompare(b.dealName) : a.label === "GROSS" ? -1 : 1));
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
  return { reimbursement: auditReimbursement(active), tax: auditTaxCapture(active), dealsScanned: active.length };
}
