// IndexedDB storage layer — deals, sources (PDF text), images

const DB_NAME = "om_database";
const DB_VERSION = 3;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("deals")) db.createObjectStore("deals", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sources")) db.createObjectStore("sources", { keyPath: "id" });
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images", { keyPath: "id" });
      if (!db.objectStoreNames.contains("tenant_decisions")) db.createObjectStore("tenant_decisions", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface TenantDecision {
  id: string;
  type: "merge" | "dismiss" | "parent";
  nameA: string;        // for type="parent": the parent-company name
  nameB: string;
  variants?: string[]; // merge: all variant names · parent: the brands under it
}

export async function getTenantDecisions(): Promise<TenantDecision[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tenant_decisions", "readonly");
    const req = tx.objectStore("tenant_decisions").getAll();
    req.onsuccess = () => resolve(req.result as TenantDecision[]);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTenantDecision(d: TenantDecision): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tenant_decisions", "readwrite");
    tx.objectStore("tenant_decisions").put(d);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeTenantDecision(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tenant_decisions", "readwrite");
    tx.objectStore("tenant_decisions").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbSaveDeals(deals: Deal[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("deals", "readwrite");
    const store = tx.objectStore("deals");
    for (const d of deals) store.put(d);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbLoadDeals(): Promise<Deal[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("deals", "readonly");
    const req = tx.objectStore("deals").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function idbDeleteDeal(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["deals","sources","images"], "readwrite");
    tx.objectStore("deals").delete(id);
    tx.objectStore("sources").delete(id);
    tx.objectStore("images").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbSaveSource(id: string, text: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sources", "readwrite");
    tx.objectStore("sources").put({ id, text });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbLoadSource(id: string): Promise<string | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sources", "readonly");
    const req = tx.objectStore("sources").get(id);
    req.onsuccess = () => resolve(req.result?.text ?? null);
    req.onerror = () => reject(req.error);
  });
}

export interface ImageBundle {
  cover?: string | null;
  coverThumb?: string | null;
  sitePlan?: string[] | null;
  pagePicks?: { page: number; img: string }[];
  needsSitePlanPick?: boolean;
}

export async function idbSaveImages(id: string, bundle: ImageBundle): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").put({ id, ...bundle });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbLoadImages(id: string): Promise<ImageBundle | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readonly");
    const req = tx.objectStore("images").get(id);
    req.onsuccess = () => {
      if (!req.result) { resolve(null); return; }
      const { id: _id, ...rest } = req.result;
      resolve(rest as ImageBundle);
    };
    req.onerror = () => reject(req.error);
  });
}

// Types
export interface Tenant {
  name?: string;
  canonicalName?: string | null;
  parentCompany?: string | null;
  suite?: string | null;          // suite / unit id from the rent roll (e.g. "020", "14-WALM", "B")
  sf?: number | string | null;
  rentPerSF?: number | string | null;
  annualRent?: number | string | null;
  leaseStart?: string | null;
  leaseExpiry?: string | null;
  remainingTermYears?: number | string | null;
  reimbursementMethod?: string | null;
  // Structured recovery detail parsed from the OM's detailed-rent-roll "Recovery
  // Type/Method" + "Comments/Encumbrances" columns (when disclosed). These refine
  // the free-text reimbursementMethod and feed the expense-recovery risk flag.
  // Null when the OM doesn't state them.
  camCapPct?: number | null;                            // annual cap on (controllable) CAM growth, % — e.g. 5
  camCapBasis?: "cumulative" | "non-cumulative" | null; // how the CAM cap accrues
  adminFeePct?: number | null;                          // administrative fee as a % of CAM
  mgmtFeeInCam?: boolean | null;                        // management fee recoverable within CAM (true=included, false=excluded)
  grossUpPct?: number | null;                           // CAM gross-up %, e.g. 95
  recoverySF?: number | null;                           // SF used to BILL recoveries when it differs from leased sf
  leaseType?: string | null;
  rentBumps?: string | null;
  rentSchedule?: string | null;
  renewalOptions?: string | null;
  recentlyExercisedRenewal?: string | null;
  salesPSF?: number | string | null;
  salesYear?: number | null;        // year the salesPSF figure is from (from OM extraction)
  occupancyCost?: number | string | null;
  expenseReimbursements?: number | null;  // annual CAM + RE-tax + insurance recoveries (OM-stated dollars)
  percentageRent?: number | null;         // annual overage/percentage rent (OM-stated dollars)
  otherRent?: number | null;              // annual marketing fund, storage, specialty, other (OM-stated dollars)
  creditRating?: string | null;
  isAnchor?: boolean;
  isNAP?: boolean | null;
  isDark?: boolean | null;                 // "dark" store — closed/not operating but still paying rent under the lease
  assumptionNote?: string | null;
  salesNotes?: string | null;
}

// ---- Lease abstracts ----------------------------------------------------------
// A structured, reconciled summary of one tenant's FULL lease document set
// (original lease + amendments + assignments + guaranties + option exercises +
// waivers). Reconciled by Claude (latest-controlling-document-wins) and stored
// per deal + tenant. Source PDFs are NOT stored — every fact cites its document
// name, section, and page so the original can be found on the user's own server.

// A precise pointer back to the source document for one fact.
export interface AbstractCitation {
  doc?: string | null;      // document name, e.g. "Cub Foods Lease"
  section?: string | null;  // e.g. "§9.6" or "Recital C"
  page?: string | null;     // e.g. "20 of 49" or "1"
}

// A single reconciled value plus its citation (used for the prose-style fields).
export interface AbstractField {
  value?: string | null;
  cite?: AbstractCitation | null;
}

// One guarantor in the guaranty stack (a lease can accumulate several across
// successive assignments — e.g. a corporate parent guaranty plus later personal
// guaranties from each assignee).
export interface GuarantyEntry {
  guarantor?: string | null;
  scope?: string | null;            // e.g. "All financial obligations; payment not collection"
  cap?: string | null;              // any dollar/scope cap, else null
  inForce?: boolean | null;         // best understanding of whether it still applies
  cite?: AbstractCitation | null;
}

// One link in a tenant- or landlord-succession chain.
export interface PartyChainEntry {
  entity?: string | null;
  role?: string | null;             // "tenant" | "landlord" | free note
  effectiveDate?: string | null;    // ISO
  instrument?: string | null;       // the assignment/merger/deed doc that effected it
  cite?: AbstractCitation | null;
}

// One renewal/extension option and its current status. The MRI-style fields
// (optionType…expireDate) mirror the Options table in Eric's per-tenant abstract
// tab; the high-level fields drive the on-screen viewer and chat.
export interface AbstractOption {
  ordinal?: number | null;          // 1, 2, 3...
  number?: string | null;           // tab label, e.g. "3rd", "4th"
  length?: string | null;           // "5 years"
  status?: "exercised" | "available" | "expired" | null;
  optionType?: string | null;       // MRI "Type", e.g. "REN" (renewal)
  windowStart?: string | null;      // ISO — term start if/when this option runs ("Option Date")
  windowEnd?: string | null;        // ISO
  noticeDate?: string | null;       // ISO — last date to give notice
  suiteId?: string | null;
  squareFeet?: number | string | null;
  termMonths?: number | string | null;
  ratePSF?: number | string | null; // rate per SF for the option period
  rateDescriptor?: string | null;   // "PSF", "FMV", etc.
  expireDate?: string | null;       // ISO — option period expiration
  rent?: string | null;             // annual rent for this option period
  exerciseConditions?: string | null; // e.g. notice window, net-worth tests from assignments
  exercisedDate?: string | null;    // ISO, when exercised
  cite?: AbstractCitation | null;
}

// One step in the base-rent schedule (mirrors the "Billing / Recurring Charges"
// table in the tab: income category, effective/end, $/SF, annual, monthly).
export interface AbstractRentStep {
  incomeCategory?: string | null;   // e.g. "RNT"
  periodStart?: string | null;      // ISO ("Effective Date")
  periodEnd?: string | null;        // ISO ("End Date")
  amountPerSF?: number | string | null; // annual $/SF
  annualRent?: number | string | null;  // annual total
  monthlyRent?: number | string | null;
  psf?: number | string | null;     // alias kept for back-compat
  note?: string | null;             // "Option 3", "flat", etc.
  cite?: AbstractCitation | null;
}

// One exclusive/use covenant plus any later waivers/modifications to it.
export interface AbstractExclusive {
  description?: string | null;
  modifications?: { change?: string | null; date?: string | null; cite?: AbstractCitation | null }[] | null;
  cite?: AbstractCitation | null;
}

// One entry in the premises-size history (anchor footprints grow via expansions).
export interface AbstractSizeHistory {
  sf?: number | string | null;
  asOf?: string | null;             // ISO or year
  cite?: AbstractCitation | null;
}

// A reconciliation/defect flag surfaced for the user's attention.
export interface AbstractFlag {
  severity?: "info" | "watch" | "defect" | null;
  issue?: string | null;
  detail?: string | null;
}

// One source document in the reconciled set (name + date + type only).
export interface AbstractSourceDoc {
  name?: string | null;
  date?: string | null;             // ISO
  type?: string | null;             // lease | amendment | guaranty | assignment | option | waiver | letter | license | other
}

// ---- MRI-style blocks (mirror Eric's detailed per-tenant abstract tab) --------

// "Lease & Amendments" — each document with its date and a one-line description.
export interface AbstractDocRef {
  name?: string | null;
  date?: string | null;             // ISO
  description?: string | null;      // e.g. "Confirms the Lease Dates and certain other terms"
  type?: string | null;
}

// "Lease Dates" block — each a cited value.
export interface AbstractLeaseDates {
  leaseDate?: AbstractField | null;
  openDate?: AbstractField | null;
  leaseCommencement?: AbstractField | null;
  cancelDate?: AbstractField | null;
  leaseExpiration?: AbstractField | null;
  rentStartDate?: AbstractField | null;
}

// "Deposit Information" block.
export interface AbstractDeposit {
  cashDeposit?: string | null;
  nonCashDeposit?: string | null;
  interestBearing?: string | null;
  interestStartDate?: string | null;
  lastInterestEarnedDate?: string | null;
  vendorId?: string | null;
  insuranceCertExp?: string | null;
  cite?: AbstractCitation | null;
}

// "Notice Address" — one block per address type (Tenant Legal, Guarantor, …).
export interface AbstractNoticeAddress {
  type?: string | null;             // "Legal" | "Guarantor" | "Billing" | …
  name?: string | null;
  attn?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  cite?: AbstractCitation | null;
}

// One row of the percentage-rent breakpoint table.
export interface AbstractBreakpoint {
  startDate?: string | null;
  percentage?: string | null;       // e.g. "1%"
  breakpoint?: number | string | null;
}

// "Retail – Percentage Rent" block.
export interface AbstractPercentageRentDetail {
  summary?: string | null;
  reportingFrequency?: string | null;
  naturalBreakpoint?: boolean | null;
  inLieuOfMinimum?: boolean | null;
  salesYearEnd?: string | null;
  paymentTiming?: string | null;    // e.g. "Within 120 days after the end of each Lease Year"
  breakpoints?: AbstractBreakpoint[] | null;
  cite?: AbstractCitation | null;
}

// One section of the section-keyed "Lease Notes" block.
export interface LeaseNote {
  code?: string | null;             // SECDEP, USE, RADIUS, EXCLUSI, COTENCY, …
  label?: string | null;            // "Security Deposit", "Use Clause", …
  value?: string | null;
  cite?: AbstractCitation | null;
}

// Canonical order + labels of the Lease-Notes sections, matching the tab so the
// export renders them in the same sequence.
export const LEASE_NOTE_SECTIONS: { code: string; label: string }[] = [
  { code: "SECDEP", label: "Security Deposit" },
  { code: "USE", label: "Use Clause" },
  { code: "RADIUS", label: "Radius" },
  { code: "LL RADIUS", label: "LL Radius" },
  { code: "EXCLUSI", label: "Exclusive Use" },
  { code: "COTENCY", label: "Co-tenancy" },
  { code: "KICKLL", label: "Kickout/Termination (LL)" },
  { code: "KICKTN", label: "Kickout/Termination (Tenant)" },
  { code: "NBNC", label: "LL Restrictions" },
  { code: "TRSTR", label: "Tenant Restrictions" },
  { code: "CAM", label: "CAM Method" },
  { code: "RETX", label: "Tax Method" },
  { code: "INS", label: "Insurance Method" },
  { code: "ASSNSUB", label: "Assignment & Sublet" },
  { code: "ALTERTN", label: "Alterations" },
  { code: "OPC", label: "Operating Covenant" },
  { code: "GO DARK", label: "Go Dark Option" },
  { code: "LATECHG", label: "Late Fee" },
  { code: "DEFAULT", label: "Default" },
  { code: "GUARANT", label: "Guaranty" },
  { code: "OTPRCL", label: "Outparcel Restrictions" },
  { code: "PURCHSE", label: "Purchase Option" },
  { code: "DUES", label: "Merchant's Association" },
  { code: "HOLDOVR", label: "Holdover" },
  { code: "PYLON", label: "Pylon Sign" },
  { code: "ESTOPPEL", label: "Estoppel" },
  { code: "SUBORD", label: "Subordination" },
  { code: "RELOCAT", label: "Relocation" },
  { code: "UTILITY", label: "Utilities" },
  { code: "HVAC", label: "HVAC" },
];

// ---- Lease risk (deal-killer clauses) -----------------------------------------
// Co-tenancy, sales kickouts, go-dark, and related anchor-dependency clauses are
// invisible in a rent roll — they only live in the lease stack (and sometimes an
// OM's rent-roll footnotes / lease-summary section). They can cut or stop a
// tenant's rent when an anchor leaves, so they are captured as STRUCTURED data,
// separate from the roster, at two levels:
//   (1) OM-disclosed — rides the existing OM extraction pass; source "OM",
//       verifiedAgainstExecutedDoc:false (a summary, never auto-trusted).
//   (2) Lease-abstract — reconciled from the executed docs and pasted in; it
//       OVERRIDES the OM value for that tenant and flips verified true.
// The exposure engine runs off the RESOLVED (merged) view and works off OM-only
// data when no abstract exists. Co-tenancy ANCHOR NAMES live ONLY here — they are
// never added to the tenant roster (a co-tenancy reference is not an occupant).

export type RiskProvenance = "extracted" | "inferred";

// Per-field source + verification metadata carried by every risk clause. A clause
// sourced only from an OM/abstract summary is UNVERIFIED — the system never
// auto-clears a co-tenancy/kickout off it; it flags for counsel review.
export interface RiskFieldMeta {
  sourceDocument?: string | null;       // e.g. "Carter's Lease (executed)" or "OM rent-roll footnote"
  controllingDocument?: string | null;  // the latest amendment that controls this field, when known
  sectionRef?: string | null;           // e.g. "§24.33"
  verbatimQuote?: string | null;        // exact lease/OM text the value came from
  provenance?: RiskProvenance | null;   // "extracted" = read verbatim; "inferred" = derived (never present an inferred value as extracted)
  verifiedAgainstExecutedDoc?: boolean | null; // true ONLY when sourced from an executed lease document
}

// One leaf condition in a co-tenancy trigger tree.
export interface TriggerCondition {
  type: string;                       // "named_anchor_dark" | "occupancy_threshold" | "anchor_replacement_failed" | "named_anchor_gone" | "anchor_count_below" | ...
  anchor?: string | null;             // for named_anchor_* — the anchor brand
  // for "anchor_count_below" ("X of N" co-tenancy): the FULL named list and how many
  // must stay open. The clause fails only when fewer than openRequired stay open —
  // i.e. when (anchors.length − openRequired + 1) of them go dark. Losing ONE named
  // store does NOT trip it (unless openRequired === anchors.length).
  anchors?: string[] | null;
  openRequired?: number | null;       // how many of `anchors` must remain open
  totalNamed?: number | null;         // informational: N (usually anchors.length)
  scope?: string | null;              // for occupancy_threshold — e.g. "inline <15000 SF"
  direction?: "above" | "below" | null;
  pct?: number | null;                // threshold percent (occupancy_threshold)
  note?: string | null;
}

// A nested AND/OR branch, OR a leaf condition. (operator+conditions) ⇒ branch; else leaf.
export type TriggerNode =
  | { operator: "AND" | "OR"; conditions: TriggerNode[] }
  | TriggerCondition;

export interface CoTenancyRemedy {
  mechanism?: string | null;          // "alternate_rent_pct_sales" | "percent_rent_reduction" | "fixed_reduction" | ...
  value?: number | null;              // e.g. 5 (=5% of gross sales) or 50 (=50% rent reduction)
  cap?: string | null;                // e.g. "minimum_annual_rent"
  additionalRentTreatment?: "tenant_continues" | "swept" | "unknown" | null;
}

export interface CoTenancyClause extends RiskFieldMeta {
  type?: "opening" | "operating" | null;
  triggerLogic?: TriggerNode | null;
  remedy?: CoTenancyRemedy | null;
  reliefPeriodMonthsBeforeTermination?: number | null;
  terminationNoticeDays?: number | null;
  cureCondition?: string | null;
  suitableReplacementDefinition?: string | null;
}

export interface SalesKickout extends RiskFieldMeta {
  salesThresholdAmount?: number | null;
  salesThresholdPSF?: number | null;
  measurementPeriod?: string | null;
  noticeWindowDays?: number | null;
  terminationFee?: number | null;
  unamortizedTiRepayment?: number | null;
}

// A single "other risk" clause. present=false/null means the clause is absent;
// when present, summary holds the short description. Each carries its own meta.
export interface RiskClauseNote extends RiskFieldMeta {
  present?: boolean | null;
  summary?: string | null;
}

export interface OtherRiskClauses {
  goDarkRight?: RiskClauseNote | null;
  continuousOperationCovenant?: RiskClauseNote | null;
  exclusiveUse?: RiskClauseNote | null;
  rofrRofo?: RiskClauseNote | null;             // right of first refusal / offer (e.g. McDonald's-type)
  recaptureAssignment?: RiskClauseNote | null;
  earlyTerminationOption?: RiskClauseNote | null;
}

// One tenant's structured lease-risk clause set. tenant/suite/baseRentAnnual mirror
// the per-lease shape so the OM pass and a pasted abstract produce the same object.
export interface TenantLeaseRisk {
  tenant?: string | null;             // tenant name (matches roster Tenant.name)
  suite?: string | null;
  baseRentAnnual?: number | null;     // base rent put at risk if a clause trips
  coTenancy?: CoTenancyClause[] | null;
  salesKickout?: SalesKickout[] | null;
  otherRiskClauses?: OtherRiskClauses | null;
}

// Deal-level container for OM-disclosed lease risk (one entry per tenant with a
// disclosed clause). coTenancyDisclosed records whether the OM disclosed co-tenancy
// AT ALL — when false, the diligence list emits "co-tenancy not disclosed in OM —
// pull leases" rather than implying there is no co-tenancy risk.
export interface DealLeaseRisk {
  tenants?: TenantLeaseRisk[] | null;
  coTenancyDisclosed?: boolean | null;
  source?: "OM" | null;
}

// One row of the editable anchor-status table that powers the exposure engine.
export interface AnchorStatus {
  anchor: string;                     // anchor brand name
  status?: "in_place" | "shadow" | "NAP" | "departing" | null;
  termExpiration?: string | null;     // ISO
  relocating?: boolean | null;
}

export interface LeaseAbstract {
  id?: string;                      // abstract id (la_...)
  dealId?: string;                  // owning deal id
  tenantName?: string;              // links to roster Tenant.name
  dba?: string | null;             // operating banner if different from tenant of record
  status?: "draft" | "final" | null;
  version?: number | null;
  asOf?: string | null;            // reconciliation date (ISO)

  // Identity / premises (tab header block)
  center?: string | null;           // shopping center name
  suite?: string | null;            // site-plan suite #
  mriNumber?: string | null;
  premisesGLA?: number | string | null; // GLA as shown on the tab (usually == currentSF)
  currentSF?: number | string | null;
  sizeHistory?: AbstractSizeHistory[] | null;

  // Lease & Amendments (the document stack, with descriptions)
  documents?: AbstractDocRef[] | null;

  // Parties / succession
  tenantChain?: PartyChainEntry[] | null;
  landlordChain?: PartyChainEntry[] | null;

  // Guaranty stack
  guaranties?: GuarantyEntry[] | null;

  // Lease dates / deposit / notice addresses (MRI blocks)
  dates?: AbstractLeaseDates | null;
  deposit?: AbstractDeposit | null;
  noticeAddresses?: AbstractNoticeAddress[] | null;

  // Term & options
  commencement?: string | null;     // ISO
  expiration?: string | null;       // ISO (current controlling expiration)
  term?: AbstractField | null;      // prose summary of the term
  options?: AbstractOption[] | null;
  optionNotes?: string | null;      // free-text note under the options table

  // Rent / billing
  rentSchedule?: AbstractRentStep[] | null;
  percentageRent?: AbstractField | null;          // short prose (kept for chat/back-compat)
  percentageRentDetail?: AbstractPercentageRentDetail | null;  // full MRI block
  securityDeposit?: AbstractField | null;

  // Covenants (high-level convenience fields; the full set lives in leaseNotes)
  exclusives?: AbstractExclusive[] | null;
  goDark?: AbstractField | null;
  assignment?: AbstractField | null;
  camTax?: AbstractField | null;
  defaultTerms?: AbstractField | null;
  governingLaw?: string | null;

  // Full section-keyed Lease Notes block (Use, Radius, Exclusive, Co-tenancy,
  // Kickout, CAM, Tax, Insurance, Assignment, Go Dark, Default, Guaranty,
  // Holdover, Estoppel, Subordination, Relocation, Utilities, HVAC, …).
  leaseNotes?: LeaseNote[] | null;

  // Structured deal-killer risk clauses, reconciled from the EXECUTED documents.
  // When present these OVERRIDE any OM-level capture for this tenant in the
  // resolved view and are treated as verifiedAgainstExecutedDoc:true.
  coTenancy?: CoTenancyClause[] | null;
  salesKickout?: SalesKickout[] | null;
  otherRiskClauses?: OtherRiskClauses | null;
  baseRentAnnual?: number | null;   // base rent at risk (mirrors TenantLeaseRisk)

  // Meta
  flags?: AbstractFlag[] | null;
  narrative?: string | null;        // short plain-English summary the Analyst chat can lean on
  sourceDocuments?: AbstractSourceDoc[] | null;

  createdAt?: string | null;
  updatedAt?: string | null;
}

// ---- Site agreements / REAs (center-level) -----------------------------------
// A structured abstract of a CENTER-LEVEL recorded agreement that binds the land
// rather than a single tenant: Operating Agreement, OEA, Reciprocal Easement, Pad
// Declaration, use-restriction, cost-share/maintenance agreement, or utility
// easement. Stored in its own collection (site_agreements), keyed to a deal and an
// agreementName — the parallel of LeaseAbstract for property-level documents.
export interface SiteAgreementDoc {
  name?: string | null;
  date?: string | null;            // ISO
  recording?: string | null;       // Book/Page or Instrument #
  role?: string | null;            // original | amendment | supplement | restatement | assignment | memo | estoppel
}
export interface SiteAgreementFlag {
  severity?: "critical" | "watch" | "info" | string | null;
  issue?: string | null;
  detail?: string | null;
  verifiedAgainstExecutedDoc?: boolean | null;
}
export interface SiteAgreementSourceDoc {
  name?: string | null;
  date?: string | null;
  fileId?: string | null;
  read?: boolean | null;
  readNote?: string | null;
}
export interface SiteAgreement {
  id?: string;                      // record id (sa_...)
  dealId?: string;                  // owning deal id
  agreementName: string;            // unique key within a deal
  version?: number | null;

  center?: string | null;           // "Rockaway Commons" | "Multiple (cross-center)" | …
  type?: string | null;             // operating_agreement | reciprocal_easement_OEA | pad_declaration | maintenance_easement | use_restriction | developer_agreement | drainage_easement | utility_easement | other
  documentChain?: SiteAgreementDoc[] | null;
  parties?: string[] | null;
  parcelsCovered?: string | null;
  effectiveTerm?: string | null;    // "perpetual" | "YYYY-MM-DD to YYYY-MM-DD"
  runsWithLand?: boolean | null;
  summary?: string | null;

  // Substantive dimensions (each an array of cited prose findings, or "None").
  useRestrictions?: string[] | null;
  buildingRestrictions?: string[] | null;
  operatingCovenants?: string[] | null;
  approvalRights?: string[] | null;
  easements?: string[] | null;
  maintenanceObligations?: string[] | null;
  costSharing?: string[] | null;
  purchaseRightsROFR?: string[] | null;   // the deal-defining dimension
  terminationRecapture?: string[] | null;
  assignmentTransfer?: string | null;
  defaultRemedies?: string | null;

  kprImpact?: string | null;              // what KPR inherits as owner
  materialityAssessment?: string | null;  // material | minor | boilerplate + why
  crossCheckVsEricSummary?: string | null;

  flags?: SiteAgreementFlag[] | null;
  sourceDocuments?: SiteAgreementSourceDoc[] | null;
  verifiedAgainstExecutedDoc?: boolean | null;

  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface OccBreakdown {
  base: number;
  reimbursements: number;
  percentRent: number;
  other: number;
  total: number;
  sales: number;
  reimbEstimated?: boolean; // true when recoveries were estimated, not OM-disclosed
}

// One row of a loan amortization schedule (generated or lender-provided).
export interface AmortRow {
  date: string;                 // ISO payment date, or "M1"/"M2"… when no origination date
  payment?: number | null;
  interest?: number | null;
  principal?: number | null;
  balance: number;             // ending balance after this payment
}

// Interest-rate swap hedging a (usually floating-rate) loan, captured from a
// dealer swap confirmation (e.g. an ISDA confirmation). Drives the swap-breakage
// (early-termination mark-to-market) estimate in the prepay calculator.
export interface InterestRateSwap {
  counterparty?: string | null;      // dealer bank, e.g. "BankUnited, N.A."
  notional?: number | null;          // notional amount ($)
  fixedRatePct?: number | null;      // the contracted fixed rate, e.g. 5.10
  payFixed?: boolean | null;         // true = client pays fixed / receives floating (the usual hedge)
  floatingIndex?: string | null;     // e.g. "USD-SOFR CME Term 1M"
  floatingSpreadBps?: number | null; // spread over the floating index, in bps
  tradeDate?: string | null;         // ISO
  effectiveDate?: string | null;     // ISO
  terminationDate?: string | null;   // ISO — swap maturity
  dayCount?: string | null;          // e.g. "30/360"
  confirmationRef?: string | null;   // dealer confirmation number
  notes?: string | null;
}

// Structured prepayment terms for the prepay calculator.
export interface PrepayTerms {
  type: "stepdown" | "yield_maintenance" | "defeasance" | "lockout_open" | "none" | "other";
  // Step-down: declining penalty %s by loan year (index 0 = year 1).
  stepdown?: number[] | null;
  // Lockout / open dates (ISO). lockoutEnd = first day prepay is allowed (post-
  // lockout, possibly with a penalty); openDate = first day prepayable at par.
  lockoutEnd?: string | null;
  openDate?: string | null;
  // Yield maintenance / defeasance reference: the spread (bps) over the matching
  // Treasury used as the floor/discount rate, plus any minimum penalty %.
  reinvestmentSpreadBps?: number | null;
  floorPenaltyPct?: number | null;
  prepayPremiumPct?: number | null;   // flat premium when applicable
  notes?: string | null;              // verbatim language for reference
}

// One tenant's data within a TenantSalesYear snapshot
export interface TenantSalesRecord {
  name: string;
  salesPSF?: number | null;
  annualSales?: number | null;   // total $ volume
  sf?: number | null;
  occupancyCost?: number | null;
  occIsEst?: boolean;            // legacy — kept for type compat; no longer set to true
  occSource?: "stated" | "computed"; // how occupancyCost was resolved
  occBreakdown?: OccBreakdown | null; // breakdown for computed values
  removed?: boolean | null;     // soft-deleted (tenant no longer at the property) — shown struck-through, re-addable
}

// A year's worth of per-tenant sales data for a deal
export interface TenantSalesYear {
  year: number;                  // the reporting year the sales belong to (e.g. 2023)
  uploadedAt: string;            // ISO timestamp of upload
  source: "om" | "upload";
  tenants: TenantSalesRecord[];
}

export interface DealScore {
  score: number;
  grade: string;
  rationale?: string;
  strengths?: string[];
  risks?: string[];
}

export interface MarketSale {
  price?: number | null;
  soldDate?: string | null;
  capRate?: number | null;
  buyer?: string | null;
  seller?: string | null;
  pricePerSF?: number | null;
  summary?: string | null;
  sources?: { url: string; title?: string }[];
  lookedUpAt?: string;
}

// Address-derived market (metro/MSA) + submarket proxy, from the free Census
// geocoder. Authoritative public data, but surfaced as "derived from address" so
// it's distinguishable from an OM-stated market.
export interface MarketGeo {
  market?: string | null;      // trimmed MSA, e.g. "Allentown, PA"
  cbsa?: string | null;        // full CBSA name, e.g. "Allentown-Bethlehem-Easton, PA-NJ Metro Area"
  submarket?: string | null;
  county?: string | null;
  matchedAddress?: string | null;
  source?: string;
  lookedUpAt?: string;
}

export interface MarketDemographics {
  pop1mi?: number | null;
  pop3mi?: number | null;
  pop5mi?: number | null;
  avgHHI1mi?: number | null;
  avgHHI3mi?: number | null;
  avgHHI5mi?: number | null;
  confidence?: "high" | "medium" | "low";
  source?: string;
  asOf?: string;
  note?: string;
  sources?: { url: string; title?: string }[];
  lookedUpAt?: string;
}

export interface CashFlowRow {
  label?: string;
  totalBaseRent?: number | null;
  reimbursements?: number | null;
  egr?: number | null;
  operatingExpenses?: number | null;
  noi?: number | null;
}

export interface RoofSection {
  area?: number | null;
  installedYear?: number | null;
  ageYears?: number | null;
  condition?: string | null;
  material?: string | null;
  replacementCost?: number | null;
}

export interface RoofData {
  summary?: string | null;
  concern?: string | null;
  sections?: RoofSection[];
  warrantyInfo?: string | null;
}

export interface ReviewQuestion {
  id: string;                          // stable id (e.g. "calc-cap-price" or "ai-<field>")
  source: "check" | "ai";             // deterministic integrity check vs AI low-confidence flag
  severity: "high" | "medium" | "low";
  field?: string | null;              // related deal/tenant field, when applicable
  question: string;                   // plain-English question to confirm
  detail?: string | null;             // supporting context (the numbers / why it's uncertain)
  suggestedValue?: string | null;     // what was captured, for a confirm/fix prompt
  // Structured edit target — lets the review overlay write a correction back
  // deterministically (no free-form parsing). Set by the extractor when the
  // question concerns a specific, editable value.
  target?: {
    kind: "deal" | "tenant";          // a top-level deal field, or a field on one tenant
    fieldKey: string;                 // exact Deal/Tenant key, e.g. "totalSF", "noi", "sf", "annualRent"
    tenantName?: string | null;       // for kind:"tenant" — the tenant whose field this is
    valueType?: "number" | "text";    // how to coerce the user's input (default number)
  } | null;
  resolvedAt?: string | null;         // ISO timestamp once the user confirms/dismisses/fixes
  resolution?: "confirmed" | "dismissed" | "fixed" | null;
}

export interface Deal {
  id: string;
  fileName?: string;
  propertyName?: string;
  aka?: string[] | null;   // "also known as" — alternate names/entities (e.g. borrowing LLC, broker's phase name) that should route to THIS deal
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  market?: string;
  submarket?: string;
  assetType?: string;
  centerType?: string;
  status?: string;
  uploadedAt?: string;
  updatedAt?: string | null;   // server-maintained: any save to this deal
  lastUploadAt?: string | null; // last time a FILE (OM/rent roll/sales/lease options) was uploaded to this deal
  refreshedAt?: string | null; // last time an OM re-upload / merge refreshed this deal
  omDate?: string;
  pdfPages?: number;
  // Financials
  askingPrice?: number | null;
  capRate?: number | null;
  noi?: number | null;
  pricePerSF?: number | null;
  totalSF?: number | null;
  occupancy?: number | null;
  grossPotentialRent?: number | null;
  effectiveGrossIncome?: number | null;
  operatingExpenses?: number | null;
  nnnRecoveries?: number | null;
  weightedAvgRentPSF?: number | null;
  walt?: number | null;
  // Property
  yearBuilt?: number | null;
  renovationYear?: number | null;
  lotSizeAcres?: number | null;
  parkingRatio?: number | null;
  numberOfBuildings?: number | null;
  // Debt
  assumableDebt?: boolean | null;
  loanBalance?: number | null;
  loanRate?: number | null;
  loanMaturity?: string | null;
  loanType?: string | null;
  // Demographics
  trafficCountVPD?: number | null;
  population3mi?: number | null;
  medianHHIncome3mi?: number | null;
  avgHHIncome3mi?: number | null;
  proximityHighways?: string | null;
  retailCotenants?: string | null;
  // Info
  broker?: string | null;
  seller?: string | null;
  lastSaleDate?: string | null;
  lastSalePrice?: number | null;
  // AI
  notes?: string | null;
  dealScore?: DealScore | null;
  redFlags?: { severity: string; description: string }[];
  upsideItems?: { priority: string; item: string; detail: string }[];
  keyAssumptions?: string | string[] | null;
  shadowAnchors?: string | null;
  // Structured lease-risk clauses disclosed by the OM (co-tenancy / sales kickout /
  // go-dark / etc.). Unverified (source "OM"); a pasted lease abstract overrides per
  // tenant. Drives the co-tenancy exposure engine even when no abstract exists.
  leaseRisk?: DealLeaseRisk | null;
  // Editable anchor-status table powering the exposure engine ("what if Dick's leaves").
  anchorStatus?: AnchorStatus[] | null;
  // Tenants
  tenants?: Tenant[];
  tenantsAsOf?: string | null;
  tenantsSource?: "om" | "rent-roll" | null;
  tenantsManual?: boolean;
  // Tenant sales history (uploaded year-by-year snapshots)
  tenantSalesHistory?: TenantSalesYear[];
  // Cash flow
  cashFlowProjection?: CashFlowRow[];
  // Income/expense breakdown
  incomeBreakdown?: Record<string, number | null>;
  expenseBreakdown?: Record<string, number | null>;
  // Roof
  roofData?: RoofData | null;
  // Images meta. coverConfirmed / sitePlanConfirmed remember that the user has
  // verified the image so the confirmation box stays hidden on future opens.
  imageMeta?: { cover?: boolean; thumb?: boolean; sitePlan?: number; needsSitePlanPick?: boolean; coverConfirmed?: boolean; sitePlanConfirmed?: boolean } | null;
  // Staleness
  analysisStale?: boolean;
  analysisVersion?: number | null;  // scoring-logic version this deal's saved AI analysis was produced under
  // Import review — data-integrity questions flagged after the most recent upload
  // (deterministic arithmetic/missing-field checks + AI low-confidence captures).
  // Resolved items keep resolvedAt set so they aren't re-asked.
  reviewQuestions?: ReviewQuestion[] | null;
  // User data
  userNotes?: string | null;
  // KPR's own thesis / assumptions for this deal — free text the acquisitions team
  // writes. Folded into the AI grade/narrative (advisory) on re-grade.
  dealThesis?: string | null;
  // KPR's overall human REVIEW of this deal — our honest take (what we like / don't
  // like, our read on broker pricing / cap rate). Folds into THIS deal's grade &
  // narrative, AND is distilled across all reviewed deals into the global "House
  // View" that teaches the analyst how we think and shapes every future analysis.
  dealReview?: string | null;
  verified?: Record<string, { by?: string; ts?: number }>;
  autoPassed?: boolean;
  autoPassedAt?: string;
  propertyGroupId?: string | null;
  // Market intel
  marketSale?: MarketSale | null;
  marketSaleChecked?: string | null;
  marketDemographics?: MarketDemographics | null;
  demoChecked?: string | null;
  // Address-derived market/submarket (free Census geocoder) + when last checked.
  marketGeo?: MarketGeo | null;
  marketGeoChecked?: string | null;
  // Transaction fields (user-entered)
  txnPurchasePrice?: number | null;
  txnSeller?: string | null;
  txnLoiDate?: string | null;
  txnCloseDate?: string | null;
  txnSalePrice?: number | null;
  txnBuyer?: string | null;
  txnSaleDate?: string | null;
  txnBroker?: string | null;
  // Disposition
  dispExitCap?: number | null;
  dispCosts?: number | null;
  dispLoanPayoff?: number | null;
  dispNotes?: string | null;
  // Acquisition
  acqCapRate?: number | null;
  acqNOIAtClose?: number | null;
  acqEntity?: string | null;
  acqBroker?: string | null;
  acqContractDate?: string | null;
  acqDDExpiration?: string | null;
  acqDeposit?: number | null;
  acqClosingCosts?: number | null;
  acqFee?: number | null;
  acqTitleCo?: string | null;
  acqCounsel?: string | null;
  acqPropManager?: string | null;
  acqStrategy?: string | null;
  acqHoldPeriod?: number | null;
  acqTargetIRR?: number | null;
  acqNotes?: string | null;
  // Debt tracking
  debtLender?: string | null;
  debtType?: string | null;
  debtLoanAmount?: number | null;
  debtRate?: number | null;
  debtRateType?: string | null;
  debtIndex?: string | null;
  debtSpread?: number | null;
  debtOriginationDate?: string | null;
  debtMaturityDate?: string | null;
  debtTermYears?: number | null;
  debtAmortYears?: number | null;
  debtIOPeriod?: number | null;
  debtLTV?: number | null;
  debtDSCR?: number | null;
  debtRecourse?: string | null;
  debtPrepay?: string | null;
  debtExtensions?: string | null;
  debtEscrows?: string | null;
  debtAssumable?: string | null;
  debtLoanNumber?: string | null;
  debtContact?: string | null;
  debtNotes?: string | null;
  // Structured prepayment terms — drives the prepay calculator. Extracted from a
  // loan doc / term sheet, or entered by hand.
  prepayTerms?: PrepayTerms | null;
  // Interest-rate swap hedging this loan (captured from a dealer swap confirmation).
  // Drives the swap-breakage estimate in the prepay calculator.
  interestRateSwap?: InterestRateSwap | null;
  // Lender-provided amortization schedule (uploaded). When present it drives the
  // current-balance read instead of the generated schedule.
  customAmortSchedule?: AmortRow[] | null;
  // Preferred-equity accrual schedule (uploaded). The running ending balance shows
  // the current accrued/unreturned preferred balance over time.
  prefSchedule?: AmortRow[] | null;
  // Preferred equity (second tranche, acts like a second loan)
  prefLender?: string | null;
  prefAmount?: number | null;
  prefRateCurrent?: number | null;  // current pay rate e.g. 8.0
  prefRateAllIn?: number | null;    // all-in / catch-up rate at sale/refi e.g. 9.25
  prefReturnType?: string | null;
  prefOriginationDate?: string | null;
  prefMaturityDate?: string | null;
  prefTermYears?: number | null;
  prefRecourse?: string | null;
  prefNotes?: string | null;
  // My underwriting
  myUnderwriting?: MyUnderwritingInputs | null;
  // Trash
  trashedAt?: string | null;
  // Benchmark scoring metadata
  lastScoredAt?: string | null;
  lastScoredDealCount?: number | null;
  // KPR ownership / cap table — members of the purchasing entity and their
  // capital balances. Ownership % is derived (capital ÷ total), never stored.
  ownershipStructure?: OwnerStake[] | null;
}

// One member/owner of the purchasing entity. Ownership % is computed from the
// capital balances, so it is intentionally NOT stored here.
export interface OwnerStake {
  name?: string;            // member / owner name
  capital?: number | null;  // capital balance in THIS JV ($) — drives ownership %
  note?: string | null;     // optional role / class (e.g. "GP", "LP", "Class A")
  kpMemberBalance?: number | null; // KP only: KP's capital balance OUTSIDE this JV
}

export interface MyUnderwritingInputs {
  myNoi?: number | null;
  vacancyPct?: number | null;
  mgmtFeePct?: number | null;
  reservesPerSF?: number | null;
  marketRentPSF?: number | null;
  targetCapRate?: number | null;
}
