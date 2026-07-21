import type { Deal } from "./idb";

// Mirror of the server's USER_PRESERVED_KEYS (artifacts/api-server/src/routes/deals.ts).
// KEEP IN SYNC. These survive a bulk JSON import; everything else on an existing deal
// that the upload doesn't include gets overwritten/wiped. We use this to show an
// accurate "what will change" preview before committing an import.
export const PRESERVED_KEYS = new Set<string>([
  "status", "statusSince", "autoPassed",
  "userNotes", "dealThesis", "dealReview",
  "txnPurchasePrice", "txnSeller", "txnLoiDate", "txnCloseDate",
  "txnSalePrice", "txnBuyer", "txnSaleDate", "txnBroker",
  "acqCapRate", "acqNOIAtClose", "acqEntity", "acqBroker", "acqContractDate", "acqDDExpiration",
  "acqDeposit", "acqClosingCosts", "acqFee", "acqTitleCo", "acqCounsel", "acqPropManager",
  "acqStrategy", "acqHoldPeriod", "acqTargetIRR", "acqNotes",
  "debtLender", "debtType", "debtLoanAmount", "debtRate", "debtMaturityDate", "debtNotes",
  "debtRateType", "debtIndex", "debtSpread", "debtOriginationDate", "debtTermYears",
  "debtAmortYears", "debtIOPeriod", "debtLTV", "debtDSCR", "debtRecourse", "debtPrepay",
  "debtExtensions", "debtEscrows", "debtAssumable", "debtLoanNumber", "debtContact", "loanBalance",
  "prepayTerms", "interestRateSwap", "customAmortSchedule", "prefSchedule",
  "tenants", "tenantsAsOf", "tenantsManual", "tenantsSource", "occupancy", "walt", "weightedAvgRentPSF",
  "marketSale", "marketSaleChecked",
  "marketDemographics", "demoChecked",
  "marketGeo", "marketGeoChecked",
  "verified", "propertyGroupId", "editHistory", "aka",
  "trashedAt", "uploadedAt", "fileName", "pdfPages", "imageMeta", "dealScore",
  "prefLender", "prefAmount", "prefRateCurrent", "prefRateAllIn", "prefReturnType", "prefOriginationDate", "prefMaturityDate", "prefTermYears", "prefRecourse", "prefNotes",
  "tenantSalesHistory",
  "ownershipStructure",
]);

function isPreserved(k: string): boolean {
  return PRESERVED_KEYS.has(k) || k.startsWith("user_") || k.startsWith("custom_");
}

// Mirror of the server's address normalizer used for import matching.
export function normalizeAddr(a: unknown): string | null {
  if (typeof a !== "string") return null;
  return a.trim().toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\broad\b/g, "rd").replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave").replace(/\bboulevard\b/g, "blvd")
    .replace(/\bdrive\b/g, "dr").replace(/\blane\b/g, "ln")
    .replace(/\bparkway\b/g, "pkwy").replace(/\bsuite\b.*$/g, "")
    .replace(/\s+/g, " ").trim() || null;
}

function findMatch(incoming: Deal, existing: Deal[]): Deal | null {
  const name = (incoming.propertyName || "").trim().toLowerCase();
  if (!name) return null;
  const addr = normalizeAddr(incoming.address);
  for (const d of existing) {
    if ((d.propertyName || "").trim().toLowerCase() !== name) continue;
    const eAddr = normalizeAddr(d.address);
    if (addr && eAddr && addr !== eAddr) continue;
    return d;
  }
  return null;
}

export type ChangeType = "changed" | "added" | "removed";
export interface FieldChange { key: string; type: ChangeType; before: string; after: string }
export interface DealUpdate { id: string; propertyName: string; prior: Deal; changes: FieldChange[] }
export interface ImportPlan { updates: DealUpdate[]; addCount: number }

function show(v: unknown): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
  if (typeof v === "object") return "{…}";
  const s = String(v);
  return s.length > 48 ? s.slice(0, 47) + "…" : s;
}

function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

// Compute, for each incoming deal that matches an existing one, the non-preserved
// fields that will change/add/remove when the merge runs. "removed" = the existing
// deal has it but the upload doesn't, so the import wipes it (the dangerous case).
export function computeImportPlan(incoming: Deal[], existing: Deal[]): ImportPlan {
  const updates: DealUpdate[] = [];
  let addCount = 0;
  for (const inc of incoming) {
    const match = findMatch(inc, existing);
    if (!match) { addCount++; continue; }
    const keys = new Set<string>([...Object.keys(inc), ...Object.keys(match)]);
    const changes: FieldChange[] = [];
    for (const k of keys) {
      if (k === "id" || k.startsWith("__") || isPreserved(k)) continue;  // "__" = client-only staging (e.g. inline abstracts), never a deal field
      const before = (match as unknown as Record<string, unknown>)[k];
      const after = (inc as unknown as Record<string, unknown>)[k];
      const hasBefore = before != null && before !== "";
      const hasAfter = after != null && after !== "";
      if (!hasBefore && !hasAfter) continue;
      if (eq(before, after)) continue;
      const type: ChangeType = !hasBefore ? "added" : !hasAfter ? "removed" : "changed";
      changes.push({ key: k, type, before: show(before), after: show(after) });
    }
    if (changes.length > 0) {
      // Removals (data loss) first, then changes, then additions; alpha within.
      const rank: Record<ChangeType, number> = { removed: 0, changed: 1, added: 2 };
      changes.sort((a, b) => rank[a.type] - rank[b.type] || a.key.localeCompare(b.key));
      updates.push({ id: match.id, propertyName: inc.propertyName || match.propertyName || "Deal", prior: match, changes });
    }
  }
  return { updates, addCount };
}
