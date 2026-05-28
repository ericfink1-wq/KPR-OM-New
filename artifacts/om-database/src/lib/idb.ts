// IndexedDB storage layer — deals, sources (PDF text), images

const DB_NAME = "om_database";
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("deals")) db.createObjectStore("deals", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sources")) db.createObjectStore("sources", { keyPath: "id" });
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
  occupancyCost?: number | string | null;
  creditRating?: string | null;
  isAnchor?: boolean;
  assumptionNote?: string | null;
  salesNotes?: string | null;
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

export interface Deal {
  id: string;
  fileName?: string;
  propertyName?: string;
  address?: string;
  city?: string;
  state?: string;
  market?: string;
  submarket?: string;
  assetType?: string;
  centerType?: string;
  status?: string;
  uploadedAt?: string;
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
  keyAssumptions?: string | string[] | null;
  shadowAnchors?: string | null;
  // Tenants
  tenants?: Tenant[];
  tenantsAsOf?: string | null;
  tenantsSource?: "om" | "rent-roll" | null;
  // Cash flow
  cashFlowProjection?: CashFlowRow[];
  // Income/expense breakdown
  incomeBreakdown?: Record<string, number | null>;
  expenseBreakdown?: Record<string, number | null>;
  // Roof
  roofData?: RoofData | null;
  // Images meta
  imageMeta?: { cover?: boolean; sitePlan?: number; needsSitePlanPick?: boolean } | null;
  // Staleness
  analysisStale?: boolean;
  // User data
  userNotes?: string | null;
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
  // My underwriting
  myUnderwriting?: MyUnderwritingInputs | null;
  // Trash
  trashedAt?: string | null;
  // Benchmark scoring metadata
  lastScoredAt?: string | null;
  lastScoredDealCount?: number | null;
}

export interface MyUnderwritingInputs {
  myNoi?: number | null;
  vacancyPct?: number | null;
  mgmtFeePct?: number | null;
  reservesPerSF?: number | null;
  marketRentPSF?: number | null;
  targetCapRate?: number | null;
}
