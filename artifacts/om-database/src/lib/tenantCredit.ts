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

export function isInvestmentGrade(tenantName: string, creditRating?: string | null): boolean {
  if (creditRating && typeof creditRating === "string") {
    const r = creditRating.toLowerCase();
    if (
      r.includes("investment grade") ||
      /\b(aaa|aa[+-]?|a[+-]?|bbb[+-]?)\b/i.test(creditRating)
    ) return true;
  }
  if (!tenantName) return false;
  const cleaned = tenantName
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/#\s*[\w-]+/g, "")
    .replace(/\b(corporation|corp|inc|llc|ltd|co|stores?)\b\.?/g, "")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const brand of IG_TENANTS) {
    const b = brand.toLowerCase();
    if (cleaned === b) return true;
    const padded = " " + cleaned + " ";
    if (padded.includes(" " + b + " ")) return true;
    if (!b.includes(" ") && b.length >= 4 && cleaned.includes(b)) return true;
  }
  return false;
}
