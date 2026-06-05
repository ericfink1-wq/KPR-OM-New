import type { Deal } from "../../idb";

// REAL Phase-A fixture — the structured leaseRisk block reconciled from the actual
// CBRE "Rockaway Centers 2026 OM" (Town Plaza section, pages 39–48), OM ONLY.
// Every clause is tagged source:"OM", verifiedAgainstExecutedDoc:false. No executed
// lease docs are used here (those arrive in Phase B). Base rents, suites and SF are
// the rent-roll figures; the co-tenancy/kickout language is quoted from the OM's
// lease-abstract notes. Verbatim quotes are trimmed for length but unaltered.

export const rockawayOmDeal: Deal = {
  id: "rockaway-2026",
  propertyName: "Rockaway Centers (Town Plaza)",
  city: "Rockaway",
  state: "NJ",
  tenants: [
    // Inline tenants with disclosed co-tenancy
    { name: "Carter's / Osh Kosh", suite: "T09", sf: 4501, annualRent: 156410, isAnchor: false },
    { name: "Ulta", suite: "T07C", sf: 10757, annualRent: 357993, isAnchor: true },
    { name: "J Crew", suite: "T08C", sf: 4603, annualRent: 148631, isAnchor: false },
    { name: "PetSmart", suite: "T11", sf: 19305, annualRent: 463320, isAnchor: true },
    { name: "Visionworks", suite: "T04", sf: 4086, annualRent: 146483, isAnchor: false },
    // Inline tenants the OM is SILENT on (co-tenancy not disclosed → pull leases)
    { name: "Crumble Cookies", suite: "T12", sf: 1588, annualRent: 84259, isAnchor: false },
    { name: "Five Guys", suite: "T15", sf: 2500, annualRent: 124950, isAnchor: false },
    { name: "Teriyaki Madness", suite: "T13", sf: 1621, annualRent: 86724, isAnchor: false },
    // Shadow / ground-lease anchors (not KPR-owned leases — the co-tenancy triggers)
    { name: "Dick's Sporting Goods", suite: "LL01", isAnchor: true, isNAP: true },
    { name: "Target", suite: "XA", isAnchor: true, isNAP: true },
  ],
  leaseRisk: {
    source: "OM",
    coTenancyDisclosed: true,
    tenants: [
      {
        tenant: "Carter's / Osh Kosh",
        suite: "T09",
        baseRentAnnual: 156410,
        coTenancy: [{
          type: "operating",
          triggerLogic: {
            operator: "OR",
            conditions: [
              { type: "named_anchor_dark", anchor: "Ulta" },
              { type: "named_anchor_dark", anchor: "PetSmart" },
              { type: "named_anchor_dark", anchor: "Dick's Sporting Goods" },
            ],
          },
          remedy: { mechanism: "alternate_rent_pct_sales", value: 5, additionalRentTreatment: "tenant_continues" },
          reliefPeriodMonthsBeforeTermination: 12,
          cureCondition: "Ulta, PetSmart, or Dick's (or a Suitable Replacement) is open and operating",
          verbatimQuote: "If at any time during the lease one of the following (i) Ulta; (ii) Petsmart; or (iii) DICK'S Sporting Goods or their Suitable Replacements are not open and operating in the Center ... TT ... shall pay, in lieu rent, five percent (5%) of TT's monthly Gross Sales (\"Alternate Rent\") ... If TT has paid Alternate Rent for 12 consecutive months, TT shall elect to (i) terminate the lease, or (ii) resume payments of full Minimum Annual Rent.",
          sourceDocument: "OM", provenance: "extracted", verifiedAgainstExecutedDoc: false,
        }],
      },
      {
        tenant: "Ulta",
        suite: "T07C",
        baseRentAnnual: 357993,
        coTenancy: [{
          type: "operating",
          triggerLogic: {
            operator: "OR",
            conditions: [
              { type: "named_anchor_dark", anchor: "Target" },
              { type: "named_anchor_dark", anchor: "Dick's Sporting Goods" },
            ],
          },
          remedy: { mechanism: "percent_rent_reduction", value: 50, additionalRentTreatment: "tenant_continues" },
          reliefPeriodMonthsBeforeTermination: 12,
          terminationNoticeDays: 60,
          cureCondition: "Target or Dick's reopens, or is replaced by a tenant with ≥100 stores opening in ≥80% of Dick's space",
          verbatimQuote: "In the event that either Target or Dick's (or Dick's replacement) close for business in the Center ... and do not reopen within 90 days, TT shall pay in lieu thereof, an amount equal to all additional rent plus one half (1/2) of the Minimum Rent (\"Alternative Rent\") until such time as: (i) Target or (ii) Dick's (or its replacement) reopens ... If the Operating Co-Tenancy Violation exists for 12 months, then TT shall ... either: (i) give LL 60 days prior written notice that TT will terminate this Lease, or (ii) resume payment of the full Minimum Rent.",
          sourceDocument: "OM", provenance: "extracted", verifiedAgainstExecutedDoc: false,
        }],
      },
      {
        tenant: "J Crew",
        suite: "T08C",
        baseRentAnnual: 148631,
        coTenancy: [{
          type: "operating",
          // "less than 2 of {Target, Dick's, Ulta} open" == at least 2 of the 3 dark.
          triggerLogic: {
            operator: "OR",
            conditions: [
              { operator: "AND", conditions: [ { type: "named_anchor_dark", anchor: "Target" }, { type: "named_anchor_dark", anchor: "Dick's Sporting Goods" } ] },
              { operator: "AND", conditions: [ { type: "named_anchor_dark", anchor: "Target" }, { type: "named_anchor_dark", anchor: "Ulta" } ] },
              { operator: "AND", conditions: [ { type: "named_anchor_dark", anchor: "Dick's Sporting Goods" }, { type: "named_anchor_dark", anchor: "Ulta" } ] },
              { type: "occupancy_threshold", scope: "Center GLA", direction: "below", pct: 80 },
            ],
          },
          remedy: { mechanism: "alternate_rent_pct_sales", value: 5, additionalRentTreatment: "tenant_continues" },
          cureCondition: "At least 2 of {Target, Dick's, Ulta} open and ≥80% of Center GLA open",
          verbatimQuote: "In the event either (i) less than 2 named TTs (Target, Dick's, and Ulta) are not open and operating for business, or (ii) less than 80% of the gross leasable area of the Center is open and operating ... TT may either (x) cease operating ... and pay Annual Minimum Rent only; or, (y) continue to operate ... and pay \"Alternate Rent\" ... (ii) 5% of TT's monthly adjusted Gross Sales.",
          sourceDocument: "OM", provenance: "extracted", verifiedAgainstExecutedDoc: false,
        }],
      },
      {
        tenant: "PetSmart",
        suite: "T11",
        baseRentAnnual: 463320,
        coTenancy: [{
          type: "operating",
          // Target-conjunctive: Target ceased AND <60% occupancy. No Dick's reference.
          triggerLogic: {
            operator: "AND",
            conditions: [
              { type: "named_anchor_dark", anchor: "Target" },
              { type: "occupancy_threshold", scope: "Shopping Center GFA (ex Tenant/Target/theatre)", direction: "below", pct: 60 },
            ],
          },
          remedy: { mechanism: "percent_rent_reduction", value: 50 },
          reliefPeriodMonthsBeforeTermination: 12,
          terminationNoticeDays: 90,
          cureCondition: "All Required Co-Tenants (Target or Comparable Replacement) reopen",
          verbatimQuote: "If at any time ... Target or a Comparable Replacement Tenant ... shall have ceased to conduct business at the Shopping Center for a period of one hundred twenty (120) days or longer, and if at that time less than sixty percent (60%) of the Gross Floor Area ... is occupied and open ... the Base Rent ... shall ... be reduced by fifty percent (50%) ... in the event that such condition shall continue for a period of one (1) year, Tenant may ... terminate the Lease ... ninety (90) days after ... notice.",
          sourceDocument: "OM", provenance: "extracted", verifiedAgainstExecutedDoc: false,
        }],
      },
      {
        tenant: "Visionworks",
        suite: "T04",
        baseRentAnnual: 146483,
        coTenancy: [{
          type: "operating",
          // Generic "fewer than 2 Major TTs" — the OM does not name which anchors, so this
          // is modelled as a major-tenant occupancy threshold, NOT a named-Dick's link.
          triggerLogic: {
            operator: "AND",
            conditions: [
              { type: "occupancy_threshold", scope: "fewer than 2 Major Tenants open", direction: "below", pct: null },
              { type: "occupancy_threshold", scope: "TT gross sales decline ≥10% over measuring period", direction: "below", pct: 10 },
            ],
          },
          remedy: { mechanism: "alternate_rent_pct_sales", value: 5 },
          reliefPeriodMonthsBeforeTermination: 12,
          terminationNoticeDays: 60,
          verbatimQuote: "In the event (a) fewer than 2 Major TTs are open for business in the Center, and (b) such Co-Tenancy condition continues for a period of 12 consecutive months, and (c) TT's Gross Sales ... decline by at least 10% ... then in lieu of Minimum Annual Rent and Percentage Rent, TT shall pay 5% of Gross Sales ... TT may elect to terminate this Lease upon sixty 60 days' notice.",
          sourceDocument: "OM", provenance: "extracted", verifiedAgainstExecutedDoc: false,
        }],
      },
    ],
  },
};
