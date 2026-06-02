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
  type: "merge" | "dismiss";
  nameA: string;
  nameB: string;
  variants?: string[]; // only for type="merge" — stores all variant names
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
  sf?: number | string | null;
  rentPerSF?: number | string | null;
  annualRent?: number | string | null;
  leaseStart?: string | null;
  leaseExpiry?: string | null;
  remainingTermYears?: number | string | null;
  reimbursementMethod?: string | null;
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

export interface OccBreakdown {
  base: number;
  reimbursements: number;
  percentRent: number;
  other: number;
  total: number;
  sales: number;
  reimbEstimated?: boolean; // true when recoveries were estimated, not OM-disclosed
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
  imageMeta?: { cover?: boolean; sitePlan?: number; needsSitePlanPick?: boolean; coverConfirmed?: boolean; sitePlanConfirmed?: boolean } | null;
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
  verified?: Record<string, { by?: string; ts?: number }>;
  autoPassed?: boolean;
  autoPassedAt?: string;
  propertyGroupId?: string | null;
  // Market intel
  marketSale?: MarketSale | null;
  marketSaleChecked?: string | null;
  marketDemographics?: MarketDemographics | null;
  demoChecked?: string | null;
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
