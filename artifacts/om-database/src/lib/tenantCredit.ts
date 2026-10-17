// Tenant credit + brand identity — the ONE source for "is this tenant investment
// grade?" and "are these two names the same brand?".
//
// MIRRORED VERBATIM to artifacts/api-server/src/lib/tenantCredit.ts so the server-side
// Portfolio Analytics and the browser agree (Eric, 10/16/26: home said 27% of rent was
// investment-grade, Portfolio Analytics said 11% / 87.6% "Unrated" — the server only
// trusted a typed-in rating, the browser used this brand list). A test fails if the two
// copies drift. Edit both, or neither.

export const IG_TENANTS = [
  "Walmart", "Sam's Club", "Target", "Costco",
  "Home Depot", "Lowe's", "Tractor Supply", "Sherwin-Williams",
  // Kroger Co. (BBB) and its banners
  "Kroger", "King Soopers", "Fred Meyer", "Ralphs", "Harris Teeter", "Fry's Food", "Smith's Food", "Dillons", "Mariano's", "Pick 'n Save", "QFC",
  "Publix",
  // Ahold Delhaize (BBB+) and its banners
  "Stop & Shop", "Giant Food", "Giant Food Stores", "Giant Martin's", "Martin's Food", "Food Lion", "Hannaford",
  "Whole Foods", "Trader Joe's", "Aldi", "Sprouts Farmers Market",
  "Walgreens", "CVS",
  // TJX (A)
  "TJ Maxx", "TJX", "Marshalls", "HomeGoods", "Home Goods", "Sierra",
  // Ross Stores (BBB+)
  "Ross Dress For Less", "DD's Discounts",
  "Dollar General", "Dollar Tree", "Five Below",
  "AutoZone", "O'Reilly Auto Parts", "Advance Auto Parts",
  "Best Buy", "Dick's Sporting Goods",
  "McDonald's", "Starbucks", "Chipotle", "Wingstop", "Chick-fil-A",
  "Verizon", "AT&T", "T-Mobile",
  "Bank of America", "Wells Fargo", "JPMorgan Chase", "Chase",
  "Ulta Beauty", "Ulta", "Sephora",
  "FedEx", "UPS", "USPS",
  "7-Eleven", "Wawa",
  "IKEA", "Hobby Lobby",
];

// Short names that are investment grade ONLY as the whole name. As a fragment they are
// dangerous: "Ross" sits inside "Crossroads", "Giant" inside "Giant Eagle" (private,
// unrated) and "Giant Fitness"; "Dick's" alone is the sporting-goods chain.
export const IG_EXACT_NAMES = ["Ross", "Giant", "Dick's", "Dicks", "Kroger Marketplace", "Super Stop & Shop"];

// Major operators that are NOT investment grade despite being large/well-known.
// These override a tenant's recorded creditRating, because deal data is often
// wrong (e.g. an Albertsons banner mistakenly tagged "BBB"/"Investment Grade").
// Albertsons Companies (ACI) is rated ~BB+/Ba1 — one notch below IG.
export const NON_IG_TENANTS = [
  "Albertsons", "Safeway", "Vons", "Jewel-Osco", "Jewel", "Acme", "Shaw's",
  "Star Market", "Tom Thumb", "Randalls", "Pavilions", "Carrs",
  "United Supermarkets", "Haggen", "Andronico's", "Balducci's", "Kings Food Markets",
  // Look-alikes of IG names that are different, unrated companies.
  "Giant Eagle", "Giant Fitness",
];

// Normalize a tenant name for brand matching (lowercase, drop store #, suffixes, punctuation).
// Initialisms are joined first so "T.J. Maxx" / "T J Maxx" read as "tj maxx".
function cleanName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b([a-z])\.\s?([a-z])\.(?=\s)/g, "$1$2")
    .replace(/\bt\s+j\s+maxx\b/g, "tj maxx")
    .replace(/\(.*?\)/g, "")
    .replace(/#\s*[\w-]+/g, "")
    .replace(/\b(corporation|corp|inc|llc|ltd|co|stores?)\b\.?/g, "")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isInvestmentGrade(tenantName: string, creditRating?: string | null): boolean {
  const cleaned = cleanName(tenantName || "");
  // Ground-truth override: known non-IG operators are never IG, even if a deal's
  // recorded credit field claims otherwise.
  if (cleaned) {
    for (const brand of NON_IG_TENANTS) {
      const b = cleanName(brand);
      if (!b) continue;
      if (cleaned === b || (" " + cleaned + " ").includes(" " + b + " ")) return false;
    }
  }
  if (creditRating && typeof creditRating === "string") {
    const r = creditRating.toLowerCase();
    // Negated forms first — "Non-Investment Grade", "Not/Below/Sub Investment Grade"
    if (/\b(non|not|below|sub)[\s-]*investment[\s-]*grade\b/.test(r) || r.includes("non-investment")) return false;
    if (r.includes("investment grade")) return true;
    // S&P / Fitch scale, BBB- and above — case-SENSITIVE so prose "a"/"a " never matches
    if (/\b(AAA|AA[+-]?|A[+-]?|BBB[+-]?)\b/.test(creditRating)) return true;
    // Moody's scale, Baa3 and above
    if (/\b(Aaa|Aa[123]?|A[123]?|Baa[123]?)\b/.test(creditRating)) return true;
  }
  if (!cleaned) return false;
  for (const brand of IG_EXACT_NAMES) if (cleaned === cleanName(brand)) return true;
  for (const brand of IG_TENANTS) {
    const b = cleanName(brand);
    if (!b) continue;
    if (cleaned === b) return true;
    const padded = " " + cleaned + " ";
    if (padded.includes(" " + b + " ")) return true;
    if (!b.includes(" ") && b.length >= 4 && cleaned.includes(b)) return true;
  }
  return false;
}

/** "Investment Grade" | "Non-Investment Grade" | "Unrated" — the credit-mix bucket. */
export function creditBucket(tenantName: string, creditRating?: string | null): "Investment Grade" | "Non-Investment Grade" | "Unrated" {
  if (isInvestmentGrade(tenantName, creditRating)) return "Investment Grade";
  const r = (creditRating || "").toLowerCase();
  if (/\b(non|not|below|sub)[\s-]*investment[\s-]*grade\b/.test(r) || /\b(BB[+-]?|B[+-]?|CCC[+-]?|Ba[123]|B[123])\b/.test(creditRating || "")) return "Non-Investment Grade";
  const cleaned = cleanName(tenantName || "");
  for (const brand of NON_IG_TENANTS) {
    const b = cleanName(brand);
    if (b && (cleaned === b || (" " + cleaned + " ").includes(" " + b + " "))) return "Non-Investment Grade";
  }
  return "Unrated";
}

// ── Brand identity ──────────────────────────────────────────────────────────
// Two roster names are the SAME brand when they differ only by store number,
// punctuation, capitalisation, a leading "The"/"Super", or a trailing generic word
// ("Food Stores", "Supermarket", "Inc."). So "Giant Food Stores" = "Giant Food" =
// "Giant", "HOME DEPOT" = "The Home Depot", "T.J. Maxx" = "TJ Maxx". A distinctive
// word is NEVER dropped, so "Giant Eagle" stays its own company. Hand-made links
// (Tenant Name Audit / Link Tenants) are applied BEFORE this, as the canonical name.
const GENERIC_SUFFIXES = [
  "food stores", "food store", "food markets", "food market", "supermarkets", "supermarket",
  "markets", "market", "stores", "store", "food", "inc", "llc", "corp", "corporation", "company", "co",
];
export function brandFamilyKey(name: string | null | undefined): string {
  let s = String(name || "").toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/#\s*[\w-]+/g, " ")
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|super)\s+/, "");
  for (let guard = 0; guard < 4; guard++) {
    const before = s;
    for (const suf of GENERIC_SUFFIXES) {
      if (s.endsWith(" " + suf)) { s = s.slice(0, -suf.length - 1).trim(); break; }
    }
    if (s === before) break;
  }
  return s.replace(/\s+/g, "");
}

/** A readable label: keep the roster's own casing unless it is SHOUTED, then title-case it. */
export function brandDisplayName(name: string): string {
  const n = String(name || "").trim();
  if (!n || /[a-z]/.test(n)) return n;
  return n.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/'S\b/g, "'s");
}
