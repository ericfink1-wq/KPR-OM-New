export const IG_TENANTS = [
  "Walmart", "Sam's Club", "Target", "Costco",
  "Home Depot", "Lowe's", "Tractor Supply", "Sherwin-Williams",
  "Kroger", "King Soopers", "Publix", "Stop & Shop",
  "Whole Foods", "Trader Joe's", "Aldi", "Sprouts Farmers Market",
  "Walgreens", "CVS",
  "TJ Maxx", "Marshalls", "HomeGoods", "Sierra",
  "Ross Dress For Less", "DD's Discounts",
  "Dollar General", "Dollar Tree", "Five Below",
  "AutoZone", "O'Reilly Auto Parts", "Advance Auto Parts",
  "Best Buy",
  "McDonald's", "Starbucks", "Chipotle", "Wingstop", "Chick-fil-A",
  "Verizon", "AT&T", "T-Mobile",
  "Bank of America", "Wells Fargo", "JPMorgan Chase", "Chase",
  "Ulta Beauty", "Ulta", "Sephora",
  "FedEx", "UPS", "USPS",
  "7-Eleven", "Wawa",
  "IKEA", "Hobby Lobby",
];

// Major operators that are NOT investment grade despite being large/well-known.
// These override a tenant's recorded creditRating, because deal data is often
// wrong (e.g. an Albertsons banner mistakenly tagged "BBB"/"Investment Grade").
// Albertsons Companies (ACI) is rated ~BB+/Ba1 — one notch below IG.
export const NON_IG_TENANTS = [
  "Albertsons", "Safeway", "Vons", "Jewel-Osco", "Jewel", "Acme", "Shaw's",
  "Star Market", "Tom Thumb", "Randalls", "Pavilions", "Carrs",
  "United Supermarkets", "Haggen", "Andronico's", "Balducci's", "Kings Food Markets",
];

// Normalize a tenant name for brand matching (lowercase, drop store #, suffixes, punctuation).
function cleanName(name: string): string {
  return name
    .toLowerCase()
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
  for (const brand of IG_TENANTS) {
    const b = brand.toLowerCase();
    if (cleaned === b) return true;
    const padded = " " + cleaned + " ";
    if (padded.includes(" " + b + " ")) return true;
    if (!b.includes(" ") && b.length >= 4 && cleaned.includes(b)) return true;
  }
  return false;
}
