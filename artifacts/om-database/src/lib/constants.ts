// Mirror of the server's ANALYSIS_VERSION (artifacts/api-server/src/lib/analysisVersion.ts).
// A deal whose analysisVersion is below this has saved AI analysis produced under
// older scoring logic — the deal page shows an "outdated" refresh badge. Keep in sync.
export const ANALYSIS_VERSION = 3;

export const ASSET_TYPES = [
  "Neighborhood Center","Community Center","Power Center","Lifestyle Center",
  "Regional Mall","Super Regional Mall","Strip Center","Mixed-Use",
  "Grocery-Anchored","Single Tenant Net Lease","Outlet Center","Festival Center","Other"
];

export const CENTER_TYPES = [
  "Grocery-Anchored","Drug Store Anchored","Junior Box Anchored","Home Improvement Anchored",
  "Value Anchor","Non-Anchored Strip","Pad Site","Power Center","Shadow-Anchored","Other"
];

export const STATUS_OPTS = ["Prospect","Under Contract","Owned","Sold","Passed"];

export const STATUS_COLORS: Record<string, string> = {
  Prospect: "#7d766a",
  "Under Contract": "#d9890c",
  Owned: "#6dba43",
  Sold: "#0d9488",
  Passed: "#a69e91",
};

export const GRADE_COLORS: Record<string, string> = {
  "A+":"#0f9d63","A":"#0f9d63","A-":"#2aab6e",
  "B+":"#6dba43","B":"#6dba43","B-":"#8ac85e",
  "C+":"#c97a18","C":"#d9890c","C-":"#e09440",
  "D":"#dc2626","D-":"#dc2626","F":"#b91c1c",
};

export const USER_DATA_FIELDS: Record<string, string> = {
  askingPrice:"Asking Price ($)",
  capRate:"Cap Rate (%)",
  noi:"NOI ($)",
  pricePerSF:"Price / SF ($)",
  totalSF:"Total SF",
  occupancy:"Occupancy (%)",
  walt:"WALT (yrs)",
  grossPotentialRent:"Gross Potential Rent ($)",
  effectiveGrossIncome:"Effective Gross Income ($)",
  operatingExpenses:"Operating Expenses ($)",
  nnnRecoveries:"NNN Recoveries ($)",
};

export const ANALYST_TOOLS = [
  { name: "web_search", description: "Search the web for up-to-date market data, comps, sale records, and news" },
  { name: "get_demographics", description: "Pull 1/3/5-mile trade area demographics (population, avg HHI) for a property address" },
];

export const SUGGESTED = [
  "What deals are approaching lease expirations in the next 2 years?",
  "Rank my deals by cap rate and explain the spread.",
  "Which assets have the highest rollover risk?",
  "Give me a market overview for my grocery-anchored centers.",
  "Which deals have assumable debt and what are the terms?",
  "What are the demographics like across my portfolio?",
];

export const PDF_JS_VERSION = "3.11.174";
export const PDF_JS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_JS_VERSION}/pdf.min.js`;
export const PDF_JS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_JS_VERSION}/pdf.worker.min.js`;

// A Prospect sitting untouched this long auto-shifts to Passed (~2 months).
export const PROSPECT_STALE_DAYS = 61;

// DORMANT (Phase 2): when true, the lease-abstract modal shows an "Auto-extract
// from PDFs" tab (admin only) that uploads a document set and has the SERVER
// reconcile it, instead of pasting Claude's JSON. Off by default — the server
// endpoint is likewise unmounted + feature-flagged, so flipping this alone does
// nothing until Phase 2 is enabled end to end (see docs/lease-abstracts-phase2.md).
export const LEASE_ABSTRACT_AUTOEXTRACT_UI = false;
