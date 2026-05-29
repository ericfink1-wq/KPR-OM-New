import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Deal } from "./idb";
import { getTenantDecisions, saveTenantDecision, removeTenantDecision } from "./idb";
import { isInvestmentGrade } from "./tenantCredit";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getRecency(deal: Deal): { label: string; color: string; bg: string } | null {
  const date = deal.omDate || deal.uploadedAt;
  if (!date) return null;
  const months = (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (months < 2) return { label: "FRESH", color: "#0f9d63", bg: "#0f9d6318" };
  if (months < 5) return { label: "RECENT", color: "#6dba43", bg: "#6dba4318" };
  if (months < 10) return { label: "AGING", color: "#d9890c", bg: "#d9890c18" };
  return { label: "STALE", color: "#a69e91", bg: "#a69e9118" };
}

export function classifyLocation(deal: Deal) {
  const pop = deal.population3mi;
  const inc = deal.avgHHIncome3mi ?? deal.medianHHIncome3mi;
  const market = (deal.market || "").toLowerCase();
  const urbanKeys = ["new york","los angeles","chicago","houston","phoenix","philadelphia",
    "san antonio","san diego","dallas","san jose","austin","jacksonville","fort worth",
    "columbus","charlotte","indianapolis","san francisco","seattle","denver","washington"];
  const suburbanKeys = ["suburb","township","village","heights","grove","hills","lake","park","springs","station"];
  let urbanicity: string | null = null;
  if (urbanKeys.some(k => market.includes(k))) urbanicity = "Urban";
  else if (suburbanKeys.some(k => market.includes(k))) urbanicity = "Suburban";
  else if (market) urbanicity = "Suburban";
  let density: { tier: string; color: string } | null = null;
  if (pop != null) {
    if (pop >= 150000) density = { tier: "Dense Urban", color: "#0d9488" };
    else if (pop >= 80000) density = { tier: "Urban", color: "#0f9d63" };
    else if (pop >= 40000) density = { tier: "Suburban", color: "#6dba43" };
    else if (pop >= 15000) density = { tier: "Exurban", color: "#d9890c" };
    else density = { tier: "Rural", color: "#a69e91" };
  }
  let income: { tier: string; color: string } | null = null;
  if (inc != null) {
    if (inc >= 150000) income = { tier: "Affluent", color: "#0f9d63" };
    else if (inc >= 100000) income = { tier: "Upper-Middle", color: "#6dba43" };
    else if (inc >= 70000) income = { tier: "Middle", color: "#d9890c" };
    else if (inc >= 50000) income = { tier: "Lower-Middle", color: "#b45309" };
    else income = { tier: "Low Income", color: "#dc2626" };
  }
  return { urbanicity, density, income, pop, inc };
}

export function findSimilar(deal: Deal, all: Deal[]): Deal[] {
  return all.filter(d => {
    if (d.id === deal.id || d.trashedAt) return false;
    const sameType = d.assetType === deal.assetType;
    const sameMarket = d.market && deal.market && d.market.toLowerCase() === deal.market.toLowerCase();
    const sameSF = deal.totalSF && d.totalSF &&
      Math.abs(Number(d.totalSF) - Number(deal.totalSF)) / Number(deal.totalSF) < 0.25;
    return (sameType && sameMarket) || (sameType && sameSF) || (sameMarket && sameSF);
  }).slice(0, 4);
}

export function humanizeKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim();
}

// Tally fields the user has manually corrected across all deals and return
// in-context guidance to inject into the extraction prompt for new runs.
// This is NOT model training — it's a "corrections memory" in the prompt.
export function buildCorrectionsNote(deals: Deal[]): string {
  const skip = new Set(["extraction","record","propertyGroup","status","marketSale","marketDemographics","imageMeta","userNotes"]);
  const counts: Record<string, number> = {};
  for (const d of deals || []) {
    for (const h of (((d as unknown) as Record<string, unknown>).editHistory as Array<{ by?: string; changes?: Array<{ field?: string; to?: unknown }> }> || [])) {
      if (/^(AI|Auto|PDF)/i.test(h.by || "")) continue;
      for (const c of h.changes || []) {
        const f = c.field;
        if (!f || skip.has(f)) continue;
        if (c.to === "verified" || c.to === "unverified") continue;
        counts[f] = (counts[f] || 0) + 1;
      }
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([f]) => humanizeKey(f));
  if (!top.length) return "";
  return `\n\nANALYST CORRECTION HISTORY — across prior deals the user has manually corrected these fields, so the source figures or a first read were often off. Extract these with extra care: prefer the ACTUAL/in-place figures stated in the OM (not asking, pro-forma, or marketing numbers) and double-check them: ${top.join(", ")}.`;
}

export function assessExtraction(deal: Deal): { quality: "good" | "partial" | "thin"; missing: string[] } {
  const core: [keyof Deal, string][] = [
    ["propertyName","Property Name"],["totalSF","Total SF"],
    ["noi","NOI"],["occupancy","Occupancy"],["walt","WALT"],
  ];
  const missing = core.filter(([k]) => deal[k] == null || deal[k] === "").map(([,l]) => l);
  const hasTenants = (deal.tenants || []).length > 0;
  const quality = missing.length === 0 && hasTenants ? "good" : missing.length <= 2 ? "partial" : "thin";
  return { quality, missing };
}

export interface ReconcileCheck { label: string; detail: string; severity: "error" | "warn"; }
export function reconcileDeal(deal: Deal) {
  const checks: ReconcileCheck[] = [];
  const n = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const noi = n(deal.noi), cap = n(deal.capRate), price = n(deal.askingPrice);
  const sf = n(deal.totalSF), ppsf = n(deal.pricePerSF);
  const gpr = n(deal.grossPotentialRent), egi = n(deal.effectiveGrossIncome), opex = n(deal.operatingExpenses);
  if (noi && cap && price) {
    const implied = noi / (cap / 100);
    const diff = Math.abs(implied - price) / price;
    if (diff > 0.12) checks.push({ severity:"error", label:"Cap rate / price mismatch", detail:`NOI ÷ cap rate implies $${Math.round(implied).toLocaleString()}, but asking price is $${Math.round(price).toLocaleString()} (${(diff*100).toFixed(0)}% gap).` });
  }
  if (price && sf && ppsf) {
    const implied = price / sf;
    const diff = Math.abs(implied - ppsf) / ppsf;
    if (diff > 0.1) checks.push({ severity:"warn", label:"Price/SF mismatch", detail:`$${Math.round(price).toLocaleString()} ÷ ${sf.toLocaleString()} SF = $${implied.toFixed(0)}/SF, but extracted price/SF is $${ppsf}.` });
  }
  if (gpr && egi && noi) {
    if (noi > egi) checks.push({ severity:"error", label:"NOI exceeds EGI", detail:`NOI ($${noi.toLocaleString()}) should not exceed Effective Gross Income ($${egi.toLocaleString()}).` });
    if (egi && opex && noi) {
      const impliedNOI = egi - opex;
      const diff = Math.abs(impliedNOI - noi) / noi;
      if (diff > 0.08) checks.push({ severity:"warn", label:"Income statement doesn't balance", detail:`EGI ($${egi.toLocaleString()}) − OpEx ($${opex.toLocaleString()}) = $${impliedNOI.toLocaleString()}, but NOI is $${noi.toLocaleString()} (${(diff*100).toFixed(0)}% gap).` });
    }
  }
  const hadData = !!(noi || price || sf || gpr);
  return { checks, errors: checks.filter(c => c.severity==="error").length, warns: checks.filter(c => c.severity==="warn").length, hadData };
}

// ── User-defined tenant merges ────────────────────────────────────────────────
// Persisted to localStorage; checked BEFORE the hardcoded TENANT_ALIASES.

const _USER_MERGES_KEY = "kpr_user_tenant_merges";

export interface UserMerge {
  id: string;
  canonical: string;
  variants: string[];
}

let _userMerges: UserMerge[] = (() => {
  try {
    const raw = localStorage.getItem(_USER_MERGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
})();

let _userAliases: Record<string, string> = {};

function rebuildUserAliases() {
  _userAliases = {};
  for (const m of _userMerges) {
    for (const v of m.variants) {
      _userAliases[_normTenant(v)] = m.canonical;
    }
  }
}

// Bootstrap on load — runs after _normTenant is defined.
// Also seeds _userMerges from IndexedDB so decisions persist across devices.
async function _seedFromIdb() {
  try {
    const decisions = await getTenantDecisions();
    const mergeDecisions = decisions.filter(d => d.type === "merge");
    let changed = false;
    for (const d of mergeDecisions) {
      if (!_userMerges.find(m => m.id === d.id)) {
        _userMerges.push({ id: d.id, canonical: d.nameA, variants: d.variants ?? [] });
        changed = true;
      }
    }
    if (changed) {
      rebuildUserAliases();
      try { localStorage.setItem(_USER_MERGES_KEY, JSON.stringify(_userMerges)); } catch { /**/ }
    }
  } catch { /**/ }
}

Promise.resolve().then(rebuildUserAliases).then(_seedFromIdb);

export function addUserMerge(merge: UserMerge): void {
  _userMerges = _userMerges.filter(m => m.id !== merge.id);
  _userMerges.push(merge);
  rebuildUserAliases();
  try { localStorage.setItem(_USER_MERGES_KEY, JSON.stringify(_userMerges)); } catch { /**/ }
  saveTenantDecision({ id: merge.id, type: "merge", nameA: merge.canonical, nameB: "", variants: merge.variants }).catch(() => { /**/ });
}

export function removeUserMerge(id: string): void {
  _userMerges = _userMerges.filter(m => m.id !== id);
  rebuildUserAliases();
  try { localStorage.setItem(_USER_MERGES_KEY, JSON.stringify(_userMerges)); } catch { /**/ }
  removeTenantDecision(id).catch(() => { /**/ });
}

export function getUserMerges(): UserMerge[] {
  return _userMerges;
}

// ── Tenant-name normalisation ─────────────────────────────────────────────────
// These helpers ensure that spelling variants of the same brand (e.g. "T Mobile",
// "T-Mobile", "TMobile") collapse to one key in every cross-deal grouping.
//
// To merge a brand that still splits, add ONE entry to TENANT_ALIASES:
//   "normalized variant": "Canonical Display Name"
// The left side must be the *normalized* form (lowercase, no punctuation).
export const TENANT_ALIASES: Record<string, string> = {
  "ulta": "Ulta Beauty",
  "tj maxx": "TJ Maxx", "tjmaxx": "TJ Maxx",
  "t mobile": "T-Mobile", "tmobile": "T-Mobile",
  "at and t": "AT&T", "att": "AT&T", "at t": "AT&T",
  "cvs": "CVS",
  "bath and body works": "Bath & Body Works",
  "dicks sporting goods": "Dick's Sporting Goods", "dicks": "Dick's Sporting Goods",
  "jersey mikes": "Jersey Mike's",
  "chick fil a": "Chick-fil-A", "chickfila": "Chick-fil-A",
  "bjs wholesale club": "BJ's Wholesale Club", "bjs": "BJ's Wholesale Club",
  "sams club": "Sam's Club",
  "trader joes": "Trader Joe's",
  "macys": "Macy's", "kohls": "Kohl's",
  "lowes": "Lowe's", "lowes home improvement": "Lowe's",
  "raising canes": "Raising Cane's",
  "mcdonalds": "McDonald's", "wendys": "Wendy's", "dennys": "Denny's",
  "applebees": "Applebee's",
  "five guys": "Five Guys", "5 guys": "Five Guys",
  "ups": "The UPS Store", "ups store": "The UPS Store",
  "americas best": "America's Best Contacts & Eyecare",
  "americas best contacts": "America's Best Contacts & Eyecare",
  "at and t mobility": "AT&T",
  "bank of america atm": "Bank of America",
  "burlington coat": "Burlington",
  "burlington coat factory": "Burlington",
  "carters osh kosh": "Carter's",
  "carters babies and kids": "Carter's",
  "edward d jones": "Edward Jones",
  "mens warehouse": "Men's Wearhouse",
  "lets lose weight loss and wellness": "Let's Lose Weight",
  "vestavia hill nutrition": "Vestavia Hills Nutrition",
  // ── nationals ───────────────────────────────────────────────────────────────
  "stop and shop": "Stop & Shop", "stop shop": "Stop & Shop",
  "ross dress for less": "Ross Dress for Less", "ross": "Ross Dress for Less",
  "t j maxx": "TJ Maxx",
  "bed bath and beyond": "Bed Bath & Beyond",
  "barnes and noble": "Barnes & Noble",
  "dick sporting goods": "Dick's Sporting Goods",
  "nordstrom rack": "Nordstrom Rack",
  "tj maxx homegoods": "TJ Maxx / HomeGoods",
  "homegoods": "HomeGoods", "home goods": "HomeGoods",
  "petco": "Petco", "petsmart": "PetSmart",
  "old navy": "Old Navy", "five below": "Five Below",
  "dollar tree": "Dollar Tree", "family dollar": "Family Dollar", "dollar general": "Dollar General",
  "michaels": "Michaels", "hobby lobby": "Hobby Lobby",
  "jo ann": "Jo-Ann", "joann": "Jo-Ann",
  "marshalls": "Marshalls",
  "burlington": "Burlington",
  "ulta beauty": "Ulta Beauty",
  "best buy": "Best Buy",
  "home depot": "The Home Depot",
  "target": "Target", "walmart": "Walmart", "costco": "Costco",
  "whole foods": "Whole Foods Market", "whole foods market": "Whole Foods Market",
  "sprouts farmers market": "Sprouts", "sprouts": "Sprouts",
  "aldi": "ALDI", "lidl": "Lidl",
  "publix": "Publix", "kroger": "Kroger", "safeway": "Safeway",
  "giant food": "Giant", "giant": "Giant",
  "wegmans": "Wegmans", "harris teeter": "Harris Teeter",
  "heb": "H-E-B", "h e b": "H-E-B",
  "winn dixie": "Winn-Dixie", "food lion": "Food Lion",
  "jewel osco": "Jewel-Osco", "meijer": "Meijer",
  "marcs": "Marc's",
  "cub foods": "Cub Foods", "giant eagle": "Giant Eagle",
  "bank of america": "Bank of America", "wells fargo": "Wells Fargo",
  "chase bank": "Chase", "jpmorgan chase": "Chase",
  "third federal": "Third Federal Savings",
  "fedex office": "FedEx Office", "fedex kinkos": "FedEx Office",
  "great clips": "Great Clips", "sport clips": "Sport Clips",
  "supercuts": "Supercuts", "hair cuttery": "Hair Cuttery",
  "orange theory fitness": "Orangetheory Fitness",
  "orangetheory fitness": "Orangetheory Fitness", "orangetheory": "Orangetheory Fitness",
  "planet fitness": "Planet Fitness", "la fitness": "LA Fitness",
  "anytime fitness": "Anytime Fitness",
  "gold gym": "Gold's Gym", "golds gym": "Gold's Gym",
  "massage envy": "Massage Envy", "european wax center": "European Wax Center",
  "chipotle mexican grill": "Chipotle", "chipotle": "Chipotle",
  "panera bread": "Panera Bread", "panera": "Panera Bread",
  "starbucks": "Starbucks",
  "dunkin": "Dunkin'", "dunkin donuts": "Dunkin'",
  "subway": "Subway",
  "jersey mikes subs": "Jersey Mike's",
  "five guys burgers and fries": "Five Guys",
  "shake shack": "Shake Shack", "wingstop": "Wingstop",
  "tropical smoothie cafe": "Tropical Smoothie Café",
  "moes southwest grill": "Moe's Southwest Grill",
  "att mobility": "AT&T",
  "verizon wireless": "Verizon", "verizon": "Verizon", "sprint": "Sprint",
  "amc theatres": "AMC Theatres", "amc": "AMC Theatres",
  "regal cinemas": "Regal Cinemas", "cinemark": "Cinemark",
  "cvs pharmacy": "CVS", "walgreens": "Walgreens", "rite aid": "Rite Aid",
  "quest diagnostics": "Quest Diagnostics", "labcorp": "LabCorp",
  "heartland dental": "Heartland Dental", "aspen dental": "Aspen Dental",
  "my eye dr": "MyEyeDr.", "myeyedr": "MyEyeDr.",
  "vision works": "Visionworks",
  "navy federal credit union": "Navy Federal Credit Union",
  "taco bell": "Taco Bell",
  "chick fila": "Chick-fil-A",
  // ── add your own variants here (one per line) ──────────────────────────────
};

// Redundant format/descriptor words safe to strip from the END of a name.
// Only pure legal/entity suffixes that never appear in real brand names.
const _TENANT_TRAIL = new Set([
  "salon","salons","outlet","outlets","factory","factories",
  "supercenter","pharmacy","wireless",
  "inc","llc","corp","co","company","ltd","lp","plc","na",
]);

/** Lowercase, punctuation-free normalised form of a tenant name. */
export function _normTenant(name: unknown): string {
  let s = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.toLowerCase()
       .replace(/\([^)]*\)/g, " ")
       .replace(/['.]/g, "")
       .replace(/&/g, " and ")
       .replace(/#\s*[a-z0-9][\w-]*/gi, " ")
       .replace(/[^a-z0-9]+/g, " ")
       .replace(/\s+/g, " ")
       .trim();
  s = s.replace(/\s*\b(absolute\s+net|triple\s+net|modified\s+gross|ground|net|nnn|gross)\s+lease\b\s*/g, " ")
       .replace(/\s+/g, " ")
       .trim();
  if (s.startsWith("the ")) s = s.slice(4);
  let parts = s.split(" ").filter(Boolean);
  while (parts.length > 1 && (_TENANT_TRAIL.has(parts[parts.length - 1]) || /^\d+$/.test(parts[parts.length - 1]))) {
    parts.pop();
  }
  return parts.join(" ");
}

/** Returns true for any blank, vacant, available, spec, or white-box entry. */
export function isVacant(name: unknown): boolean {
  const s = String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s || s === "-" || s === "–" || s === "—" || s === "n/a" || s === "na") return true;
  const c = s.replace(/^[\s\-–—•·*"']+/, "");
  if (/^vacan/.test(c)) return true;
  if (/^availab/.test(c)) return true;
  if (/^spec\s+(suite|space|unit)/.test(c)) return true;
  if (/white\s*box/.test(c)) return true;
  return false;
}

/** Stable grouping key — every spelling of one brand collapses to the same string. */
export function tenantKey(name: unknown): string {
  const n = _normTenant(name);
  if (_userAliases[n]) return _normTenant(_userAliases[n]);
  const alias = TENANT_ALIASES[n];
  return alias ? _normTenant(alias) : n;
}

/** Clean, human-readable canonical name for labels and headers. */
export function tenantLabel(name: unknown, canonicalName?: string | null): string {
  if (canonicalName && canonicalName.trim()) return canonicalName.trim();
  const n = _normTenant(name);
  if (_userAliases[n]) return _userAliases[n];
  if (TENANT_ALIASES[n]) return TENANT_ALIASES[n];
  return n.replace(/\b\w/g, c => c.toUpperCase()) || String(name || "");
}

// ── Lender-name normalisation ─────────────────────────────────────────────────
// Mirrors the tenant canonical-name system so "BankUnited", "BankUnited, N.A.",
// and "Bank United" all collapse to the same key in cross-deal groupings.

/** Stable grouping key — strips entity suffixes and punctuation so spelling
 *  variants of the same institution collapse to one string. */
export function lenderKey(name: unknown): string {
  if (!name || typeof name !== "string") return "";
  return name.toLowerCase()
    .replace(/,?\s*(n\.?a\.?|national association|llc|l\.l\.c\.|inc\.?|corp\.?|company|co\.?|bank|f\.?s\.?b\.?)\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/** Clean, human-readable display name — strips trailing legal suffixes (e.g.
 *  ", N.A.", "National Association") while preserving the institution name. */
export function lenderLabel(name: unknown): string {
  if (!name || typeof name !== "string") return String(name || "");
  return name.replace(/\s*,?\s*(N\.?A\.?|National Association)\s*$/i, "").trim() || String(name);
}

// Month abbreviations used in fmtLeaseDate.
const _MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","June","July","Aug","Sept","Oct","Nov","Dec"];

/**
 * Format a lease date string as "Mon-YYYY" (e.g. "Sept-2027").
 * Handles ISO (2027-09-30), slash M/D/YY, MM/DD/YYYY, and M/YYYY inputs.
 * Returns "—" for empty/unparseable values.
 */
export function fmtLeaseDate(raw: unknown): string {
  const s = String(raw || "").trim();
  if (!s || s === "—") return "—";
  // ISO: YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const m = parseInt(iso[2], 10) - 1;
    if (m >= 0 && m < 12) return `${_MONTH_ABBR[m]}-${iso[1]}`;
  }
  // M/D/YY or MM/DD/YYYY or M/D/YYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const m = parseInt(slash[1], 10) - 1;
    let y = parseInt(slash[3], 10);
    if (y < 100) y += 2000;
    if (m >= 0 && m < 12) return `${_MONTH_ABBR[m]}-${y}`;
  }
  // M/YYYY (no day)
  const my = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (my) {
    const m = parseInt(my[1], 10) - 1;
    if (m >= 0 && m < 12) return `${_MONTH_ABBR[m]}-${my[2]}`;
  }
  return s;
}

/**
 * Format tenant sales volume as "$X.XM / $NNN PSF" or "$NNNk / $NNN PSF".
 * Returns "—" when salesPSF is absent; returns "$NNN PSF" when sf is absent.
 */
export function fmtTenantSales(salesPSF: unknown, sf: unknown): string {
  const psf = (salesPSF == null || salesPSF === "" || isNaN(Number(salesPSF))) ? null : Number(salesPSF);
  const sqft = (sf == null || sf === "" || isNaN(Number(sf))) ? null : Number(sf);
  if (psf == null) return "—";
  const psfStr = `$${Math.round(psf)} PSF`;
  if (sqft == null) return psfStr;
  const total = psf * sqft;
  const totalStr = total >= 1_000_000
    ? `$${(total / 1_000_000).toFixed(1)}M`
    : `$${Math.round(total / 1000)}k`;
  return `${totalStr} / ${psfStr}`;
}

export function buildSystemPrompt(deals: Deal[]): string {
  const active = deals.filter(d => !d.trashedAt);
  const statuses = ["Prospect","Under Contract","Owned","Sold","Passed"];
  const bySt = Object.fromEntries(statuses.map(s => [s, active.filter(d => d.status === s).length]));
  const portfolio = active.map(d => {
    const isPassed = d.status === "Passed";
    const tenantList = (d.tenants || []);
    // Active deals: full roster. Passed deals: anchor-only compact summary to save tokens.
    const tenants = isPassed
      ? tenantList
          .filter(t => t.isAnchor || (t.sf && Number(t.sf) >= 5000))
          .map(t => ({ name: t.name, sf: t.sf, anchor: t.isAnchor || undefined, expiry: t.leaseExpiry, isIG: isInvestmentGrade(t.name || "", t.creditRating) || undefined }))
      : tenantList.map(t => ({
          name: t.name,
          sf: t.sf,
          rentPSF: t.rentPerSF,
          annualRent: t.annualRent,
          expiry: t.leaseExpiry,
          salesPSF: t.salesPSF ?? undefined,
          anchor: t.isAnchor || undefined,
          reimb: t.reimbursementMethod ?? undefined,
          isIG: isInvestmentGrade(t.name || "", t.creditRating) || undefined,
        }));
    return {
      id: d.id, name: d.propertyName||d.fileName, market: d.market,
      assetType: d.assetType, status: d.status, totalSF: d.totalSF,
      noi: d.noi, capRate: d.capRate, askingPrice: d.askingPrice,
      occupancy: d.occupancy, walt: d.walt,
      tenants: tenants.length ? tenants : undefined,
    };
  });
  return `You are an expert commercial real estate analyst specializing in retail shopping centers (KPR Centers portfolio).

Portfolio summary: ${active.length} deals — ${statuses.map(s => `${bySt[s]} ${s}`).join(", ")}.

Full portfolio data:
${JSON.stringify(portfolio, null, 2)}

Guidelines:
- Be specific, reference actual deal names and numbers from the portfolio above.
- Format currency as $X,XXX,XXX and percentages with one decimal.
- Keep responses focused and actionable.
- Today's date: ${new Date().toLocaleDateString()}.`;
}

export function cityState(d: Deal): string {
  if (d.city || d.state) return [d.city, d.state].filter(Boolean).join(", ");
  const a = (d.address || "").trim();
  if (a) {
    const parts = a.split(",").map(s => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const sm = last.match(/\b([A-Z]{2})\b/);
    const state = sm ? sm[1] : "";
    let city = parts.length >= 2 ? parts[parts.length - 2] : "";
    if (/^\d/.test(city) || /\b[A-Z]{2}\b\s*\d{5}/.test(city)) city = "";
    const out = [city, state].filter(Boolean).join(", ");
    if (out) return out;
  }
  return d.market || "";
}

// Robust AI-response JSON parser — strips markdown fences, trailing commas, and
// recovers gracefully from truncated output (the same strategy used server-side
// in extract.ts). Use this whenever parsing a raw AI text response.
export function robustParseJSON(raw: string): unknown {
  if (!raw?.trim()) throw new Error("Empty response");
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try { return JSON.parse(s); } catch {}
  try { return JSON.parse(s.replace(/,(\s*[}\]])/g, "$1")); } catch {}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch {}
  }
  if (first !== -1) {
    try { return _repairTruncatedJSON(s.slice(first)); } catch {}
  }
  throw new Error("All parse strategies failed");
}
function _repairTruncatedJSON(s: string): unknown {
  let inStr = false, esc = false;
  const stack: string[] = [];
  let safeLen = -1, safeClosers = "";
  const closersFor = () => stack.map(b => b === "{" ? "}" : "]").reverse().join("");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") { stack.pop(); safeLen = i + 1; safeClosers = closersFor(); }
    else if (c === ",") { safeLen = i; safeClosers = closersFor(); }
  }
  if (safeLen <= 0) throw new Error("Could not repair truncated JSON");
  return JSON.parse(s.slice(0, safeLen).replace(/,\s*$/, "") + safeClosers);
}

export function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
