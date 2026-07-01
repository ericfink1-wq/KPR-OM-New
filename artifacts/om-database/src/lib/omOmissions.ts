// OM OMISSION FLAGS — the executed lease is the truth; the OM is the seller's
// story. When a pasted lease abstract carries a tenant right that can cut rent or
// end a lease (sales kickout, early-termination option, co-tenancy relief, go-dark
// right, ROFR/ROFO, recapture, exclusive) and the OM's own lease-risk disclosures
// carry NO such clause for that tenant, that gap is itself a finding — the broker
// didn't tell you, the documents did. Surface it prominently, with urgency when
// the trigger is near (kickout threshold vs current sales, clause already in
// effect). Deterministic, token-free.
import type { Deal, LeaseAbstract, OtherRiskClauses, Tenant, TenantLeaseRisk } from "./idb";
import type { DerivedFlag } from "./expenseRisk";
import { tenantKey, isVacant } from "./utils";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type OmissionKind =
  | "co-tenancy" | "sales-kickout" | "early-termination" | "go-dark"
  | "rofr-rofo" | "recapture" | "exclusive";

export interface OmOmission {
  tenant: string;
  kind: OmissionKind;
  summary: string;        // what the executed lease says, briefly
  urgent: boolean;        // trigger near / already in effect
}

const KIND_LABEL: Record<OmissionKind, string> = {
  "co-tenancy": "co-tenancy relief",
  "sales-kickout": "sales kickout / termination right",
  "early-termination": "early-termination option",
  "go-dark": "go-dark right",
  "rofr-rofo": "ROFR/ROFO",
  recapture: "landlord recapture on assignment",
  exclusive: "exclusive-use restriction",
};

// Kinds that can take rent away mid-term — these drive high severity.
const RENT_LEVER: Set<OmissionKind> = new Set(["co-tenancy", "sales-kickout", "early-termination", "go-dark"]);

function omEntryFor(deal: Deal, key: string): TenantLeaseRisk | undefined {
  for (const t of deal.leaseRisk?.tenants ?? []) {
    if (t?.tenant && tenantKey(t.tenant) === key) return t;
  }
  return undefined;
}

function rosterTenant(deal: Deal, key: string): Tenant | undefined {
  return (deal.tenants || []).find((t) => t && !isVacant(t.name) && tenantKey(t.canonicalName || t.name || "") === key);
}

// Compare every abstract's structured risk clauses against the OM's lease-risk
// capture for the same tenant. Only STRUCTURED clauses count (leaseNotes prose is
// too fuzzy to diff); an explicit "None"/absent abstract group never flags.
export function findOmOmissions(deal: Deal, abstracts: LeaseAbstract[]): OmOmission[] {
  const out: OmOmission[] = [];
  for (const a of abstracts || []) {
    if (!a?.tenantName) continue;
    const key = tenantKey(a.tenantName);
    const om = omEntryFor(deal, key);
    const rt = rosterTenant(deal, key);
    const name = a.tenantName;

    // Co-tenancy: in the executed lease, absent from the OM capture.
    const absCo = Array.isArray(a.coTenancy) ? a.coTenancy.filter(Boolean) : [];
    if (absCo.length > 0 && !(om?.coTenancy?.length)) {
      const inEffect = absCo.some((c) => c.currentlyInEffect === true);
      out.push({
        tenant: name, kind: "co-tenancy",
        summary: inEffect
          ? "co-tenancy relief and the lease notes it is ALREADY in effect"
          : "co-tenancy relief (reduced/alternate rent, possible termination) if named anchors or occupancy fail",
        urgent: inEffect,
      });
    }

    // Sales kickout: urgency from the roster's own sales vs the threshold.
    const absKick = Array.isArray(a.salesKickout) ? a.salesKickout.filter(Boolean) : [];
    if (absKick.length > 0 && !(om?.salesKickout?.length)) {
      let urgent = false;
      let detail = "right to terminate if sales miss a threshold";
      const k = absKick[0];
      const thrPSF = num(k.salesThresholdPSF);
      const thrAmt = num(k.salesThresholdAmount);
      const sales = num(rt?.salesPSF);
      const sf = num(rt?.sf);
      const gross = sales != null && sf != null ? sales * sf : null;
      if (thrPSF != null) detail = `right to terminate if sales fall below $${thrPSF}/SF`;
      else if (thrAmt != null) detail = `right to terminate if sales fall below $${Math.round(thrAmt).toLocaleString()}`;
      // Within 10% of the trigger (or under it) = the lever is live, not theoretical.
      if (thrPSF != null && sales != null) urgent = sales <= thrPSF * 1.1;
      else if (thrAmt != null && gross != null) urgent = gross <= thrAmt * 1.1;
      out.push({
        tenant: name, kind: "sales-kickout",
        summary: urgent && sales != null ? `${detail} — current sales sit at/near the trigger` : detail,
        urgent,
      });
    }

    // Other structured mid-term levers.
    const abO = a.otherRiskClauses;
    const omO = om?.otherRiskClauses;
    const pairs: Array<[OmissionKind, keyof OtherRiskClauses]> = [
      ["early-termination", "earlyTerminationOption"],
      ["go-dark", "goDarkRight"],
      ["rofr-rofo", "rofrRofo"],
      ["recapture", "recaptureAssignment"],
      ["exclusive", "exclusiveUse"],
    ];
    for (const [kind, field] of pairs) {
      const abClause = abO?.[field];
      const omClause = omO?.[field];
      if (abClause?.present === true && omClause?.present !== true) {
        const s = (abClause.summary || "").trim();
        out.push({
          tenant: name, kind,
          summary: s ? s.slice(0, 160) : KIND_LABEL[kind],
          urgent: false,
        });
      }
    }

    // Exclusives can also live in the abstract's exclusives[] table.
    const absExcl = Array.isArray(a.exclusives) ? a.exclusives.filter(Boolean) : [];
    if (absExcl.length > 0 && omO?.exclusiveUse?.present !== true && !out.some((o) => o.tenant === name && o.kind === "exclusive")) {
      out.push({ tenant: name, kind: "exclusive", summary: `${absExcl.length} exclusive-use restriction${absExcl.length === 1 ? "" : "s"} binding the landlord's leasing`, urgent: false });
    }
  }
  return out;
}

// One red flag per tenant with omissions (clustered so a tenant with three
// undisclosed levers reads as one story, not three rows).
export function deriveOmOmissionFlags(deal: Deal, abstracts: LeaseAbstract[]): DerivedFlag[] {
  const omissions = findOmOmissions(deal, abstracts);
  if (omissions.length === 0) return [];

  const totalRent = (deal.tenants || []).filter((t) => t && !isVacant(t.name)).reduce((s, t) => s + (num(t.annualRent) || 0), 0);
  const byTenant = new Map<string, OmOmission[]>();
  for (const o of omissions) {
    if (!byTenant.has(o.tenant)) byTenant.set(o.tenant, []);
    byTenant.get(o.tenant)!.push(o);
  }

  const flags: DerivedFlag[] = [];
  for (const [tenant, list] of byTenant) {
    const rt = rosterTenant(deal, tenantKey(tenant));
    const rent = num(rt?.annualRent) || 0;
    const rentShare = totalRent > 0 ? (rent / totalRent) * 100 : null;
    const hasRentLever = list.some((o) => RENT_LEVER.has(o.kind));
    const urgent = list.some((o) => o.urgent);
    const severity: DerivedFlag["severity"] =
      urgent || (hasRentLever && (rt?.isAnchor || (rentShare != null && rentShare >= 10))) ? "high"
      : hasRentLever ? "medium" : "low";
    const items = list.map((o) => `${KIND_LABEL[o.kind]} — ${o.summary}`).join("; ");
    flags.push({
      severity,
      description: `NOT IN THE OM: the executed ${tenant} lease contains ${list.length === 1 ? "a right" : "rights"} the OM's disclosures do not mention — ${items}. Found only in the lease abstract${rent > 0 ? ` (${tenant} pays $${Math.round(rent).toLocaleString()}/yr${rentShare != null ? `, ~${Math.round(rentShare)}% of base rent` : ""})` : ""}. Price the risk and ask the broker why it wasn't disclosed.`,
    });
  }
  const sevOrder = { high: 0, medium: 1, low: 2 } as const;
  flags.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
  return flags;
}
