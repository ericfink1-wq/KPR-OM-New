import { apiAiMessages } from "./api";
import { tenantKey } from "./utils";

// ── Tenant / parent-company descriptions ─────────────────────────────────────
// Curated 2-3 sentence blurbs for the major retail brands & parents the app
// commonly sees, with an AI fallback (cached) for the long tail. Used in the
// header of the Tenant and Parent-Company analytics pages.

// Curated set. Keys are normalized via tenantKey() at lookup time, so write the
// key here already normalized (lowercase, no punctuation) to match.
const CURATED: Record<string, string> = {
  // Off-price / discount apparel
  "tj maxx": "TJ Maxx is an off-price apparel and home-goods retailer operated by TJX Companies, selling brand-name and designer merchandise at a discount. It is a high-traffic destination anchor known for its 'treasure-hunt' format and resilient, recession-tolerant performance.",
  "marshalls": "Marshalls is an off-price apparel and home retailer under TJX Companies, sister banner to TJ Maxx with a similar treasure-hunt model and footwear emphasis. It is a durable traffic-driving anchor with investment-grade parent credit.",
  "homegoods": "HomeGoods is TJX Companies' off-price home-furnishings banner, selling furniture, décor, and housewares at a discount. It draws steady destination traffic and frequently co-tenants with TJ Maxx and Marshalls.",
  "ross dress for less": "Ross Dress for Less is the largest U.S. off-price apparel and home chain, operated by Ross Stores. With a no-frills, low-cost format and investment-grade credit, it is a powerful value anchor that performs well across economic cycles.",
  "burlington": "Burlington (formerly Burlington Coat Factory) is a national off-price retailer of apparel, home, and baby goods. It competes directly with TJ Maxx and Ross as a value-oriented junior anchor.",
  "nordstrom rack": "Nordstrom Rack is the off-price banner of Nordstrom, offering discounted designer and brand apparel, footwear, and accessories. It targets a higher-income shopper than typical off-price and is a desirable mid-box anchor.",

  // Value / dollar / discount
  "five below": "Five Below is a fast-growing specialty value retailer targeting teens and pre-teens, with most merchandise priced at or below $5 (now extending to higher 'Five Beyond' price points). It is a high-growth inline/junior-anchor tenant with strong unit economics.",
  "dollar tree": "Dollar Tree is a national single-price-point discount retailer under Dollar Tree, Inc., historically selling most items at $1.25. It is a consistent traffic driver in value-oriented and rural centers.",
  "dollar general": "Dollar General is the largest U.S. dollar-store chain by store count, serving primarily rural and small-town markets with consumables and household basics. It is an investment-grade, recession-resilient small-box tenant.",
  "family dollar": "Family Dollar is a neighborhood discount chain owned by Dollar Tree, Inc., offering consumables, apparel, and household goods in smaller-format stores. It typically serves lower-income and urban convenience trade areas.",
  "big lots": "Big Lots is a discount retailer of closeout furniture, home goods, and consumables. It operates as a value-oriented junior-box anchor, though it has faced financial pressure and store rationalization in recent years.",

  // Grocery
  "kroger": "Kroger is one of the largest U.S. supermarket operators, anchoring grocery-anchored centers with strong, stable foot traffic. As an investment-grade grocer it is among the most sought-after anchors for necessity-based retail.",
  "publix": "Publix is a leading, employee-owned supermarket chain in the Southeast, known for high sales productivity and customer loyalty. A Publix anchor is considered a premium, traffic-generating necessity tenant.",
  "whole foods market": "Whole Foods Market is a premium natural and organic grocer owned by Amazon. It anchors higher-income trade areas and signals strong demographics, making it a desirable necessity anchor.",
  "trader joes": "Trader Joe's is a privately held specialty grocer known for curated private-label products, small footprints, and exceptional sales per square foot. Its stores draw destination traffic and rarely become available.",
  "aldi": "ALDI is a fast-growing limited-assortment discount grocer with a small-format, private-label-heavy model and industry-leading low prices. It is an increasingly popular necessity anchor expanding aggressively across the U.S.",
  "sprouts farmers market": "Sprouts Farmers Market is a specialty grocer focused on fresh, natural, and organic produce and health-oriented products. It anchors health-conscious, higher-income trade areas.",
  "stop and shop": "Stop & Shop is a Northeast supermarket banner owned by Ahold Delhaize, providing necessity-based grocery anchoring across the region. It carries investment-grade parent credit.",
  "food lion": "Food Lion is a Southeast U.S. supermarket chain under Ahold Delhaize, serving value-oriented grocery trade areas. Its investment-grade parent makes it a stable necessity anchor.",
  "safeway": "Safeway is a national supermarket banner owned by Albertsons Companies, anchoring grocery-anchored centers across the West and beyond.",

  // Home / hardware / pets
  "the home depot": "The Home Depot is the largest U.S. home-improvement retailer and an investment-grade big-box anchor. It generates exceptionally high traffic and sales, often anchoring power and community centers.",
  "lowes": "Lowe's is the second-largest U.S. home-improvement chain, an investment-grade big-box anchor comparable to Home Depot in drawing power.",
  "petsmart": "PetSmart is the largest U.S. specialty pet retailer, offering supplies, grooming, and veterinary services. It is a steady junior-box anchor in the resilient pet category.",
  "petco": "Petco is a national pet-specialty retailer of supplies, food, and services. It competes with PetSmart as a destination junior-box tenant in the durable pet sector.",
  "michaels": "Michaels is the largest U.S. arts-and-crafts specialty retailer, anchoring the hobby category with a junior-box format. It draws consistent destination traffic from crafters and DIY shoppers.",
  "hobby lobby": "Hobby Lobby is a privately held arts-and-crafts superstore chain known for large footprints and below-market occupancy costs. It is a strong destination anchor in the crafts category.",

  // Beauty / specialty
  "ulta beauty": "Ulta Beauty is the largest U.S. specialty beauty retailer, combining mass and prestige cosmetics with in-store salon services. It is a high-performing destination junior-box tenant drawing a loyal, frequent shopper.",
  "best buy": "Best Buy is the leading U.S. consumer-electronics retailer and an investment-grade big-box anchor. It remains a category destination despite e-commerce competition.",
  "tractor supply": "Tractor Supply is the largest U.S. rural-lifestyle retailer, serving farmers, ranchers, and homeowners. It is an investment-grade, recession-resilient anchor concentrated in rural and exurban markets.",

  // Apparel / footwear
  "old navy": "Old Navy is a value-oriented apparel brand under Gap Inc., offering affordable family clothing. It is a popular mall and power-center inline/junior tenant.",
  "dsw": "DSW (Designer Shoe Warehouse) is a leading off-price footwear retailer operated by Designer Brands. It anchors the value footwear category as a junior-box tenant.",
  "foot locker": "Foot Locker is a global athletic footwear and apparel retailer. It is a mall and inline specialty tenant tied closely to the sneaker and athletic-lifestyle market.",

  // Pharmacy / convenience
  "cvs": "CVS is one of the largest U.S. pharmacy chains, typically occupying freestanding or end-cap pad sites with strong corner visibility. As an investment-grade tenant on long net leases, it is a stable, necessity-based occupant.",
  "walgreens": "Walgreens is a national pharmacy chain, usually on freestanding pad sites with drive-thru pharmacy. It is a long-net-lease, necessity tenant, though the sector faces reimbursement and store-rationalization pressure.",

  // Fitness / service
  "planet fitness": "Planet Fitness is the largest U.S. gym franchise by membership, with a high-volume, low-price model. It is a popular junior-box traffic anchor that backfills former retail space.",
  "orange theory fitness": "Orangetheory Fitness is a boutique heart-rate-based group fitness franchise. It is a daily-needs service tenant that drives repeat inline traffic.",

  // QSR / coffee
  "starbucks": "Starbucks is the world's largest coffeehouse chain and a premier drive-thru pad and inline tenant. Its presence signals strong traffic and demographics, and corporate-leased locations carry investment-grade credit.",
  "chick fil a": "Chick-fil-A is the highest-grossing U.S. fast-food chain per unit, generating exceptional drive-thru volume. As a pad tenant it is a powerful traffic generator and one of the most coveted QSR occupants.",
  "mcdonalds": "McDonald's is the world's largest fast-food chain and an investment-grade pad tenant. Its locations are durable, high-traffic, long-net-lease net-lease assets.",
  "chipotle": "Chipotle Mexican Grill is a leading fast-casual chain known for high unit volumes and strong development demand. It is a sought-after inline and end-cap tenant.",
};

// Curated parent-company blurbs. Keyed by the exact parent string the app uses
// (case-insensitive match at lookup).
const CURATED_PARENTS: Record<string, string> = {
  "tjx companies": "TJX Companies is the largest off-price apparel and home retailer in the world, operating TJ Maxx, Marshalls, HomeGoods, HomeSense, and Sierra. It is an investment-grade, highly resilient operator whose treasure-hunt model performs across economic cycles.",
  "ross stores": "Ross Stores operates Ross Dress for Less and dd's DISCOUNTS, the largest U.S. off-price apparel and home business by store count. It is investment-grade with a low-cost model that thrives in value-seeking environments.",
  "dollar tree inc.": "Dollar Tree, Inc. operates the Dollar Tree and Family Dollar banners, among the largest U.S. discount-variety chains. It is an investment-grade operator serving value and convenience trade areas nationwide.",
  "gap inc.": "Gap Inc. is an apparel holding company operating Old Navy, Gap, Banana Republic, and Athleta across value and mid-market price points.",
  "ahold delhaize": "Ahold Delhaize is a global grocery operator whose U.S. banners include Stop & Shop, Food Lion, Giant, and Hannaford. It is an investment-grade necessity-retail operator anchoring grocery-anchored centers across the East.",
  "albertsons companies": "Albertsons Companies is one of the largest U.S. grocery operators, with banners including Safeway, Albertsons, Jewel-Osco, and Vons. It is a major necessity-retail anchor operator.",
  "yum! brands": "Yum! Brands is a global quick-service restaurant company operating KFC, Taco Bell, and Pizza Hut. Its franchised pad and inline locations are common net-lease QSR tenants.",
  "restaurant brands intl.": "Restaurant Brands International operates Burger King, Tim Hortons, Popeyes, and Firehouse Subs. Its franchised locations are widespread QSR pad and inline tenants.",
  "designer brands": "Designer Brands operates DSW (Designer Shoe Warehouse), a leading off-price footwear retailer, anchoring the value shoe category.",
};

const LS_PREFIX = "tenant-desc:";

function cacheGet(key: string): string | null {
  try { return localStorage.getItem(LS_PREFIX + key); } catch { return null; }
}
function cacheSet(key: string, val: string): void {
  try { localStorage.setItem(LS_PREFIX + key, val); } catch { /* ignore */ }
}

/** Synchronous curated lookup — instant, no network. */
export function curatedTenantDescription(name: string): string | null {
  return CURATED[tenantKey(name)] ?? null;
}
export function curatedParentDescription(parent: string): string | null {
  return CURATED_PARENTS[parent.toLowerCase().trim()] ?? null;
}

// AI fallback — generate a 2-3 sentence blurb for a brand/parent not in the
// curated set. Cached in localStorage so each name is only generated once.
async function aiDescription(name: string, kind: "tenant" | "parent"): Promise<string | null> {
  const cacheKey = `${kind}:${kind === "tenant" ? tenantKey(name) : name.toLowerCase().trim()}`;
  const cached = cacheGet(cacheKey);
  if (cached != null) return cached || null; // empty string = "tried, nothing"

  const subject = kind === "parent"
    ? `the parent/holding company "${name}"`
    : `the retail brand/tenant "${name}"`;
  const prompt = `In 2-3 sentences, describe ${subject} for a commercial real estate retail underwriter. Cover: what they sell / their format and typical store size (anchor, junior-box, inline, pad), their market position, and anything relevant to their value as a shopping-center tenant (credit quality, traffic-driving ability, sector resilience). Be factual and concise. If you are not confident this is a real, identifiable retail company, reply with exactly "UNKNOWN" and nothing else.`;

  try {
    const res = await apiAiMessages({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 220,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (res.content?.find(c => c.type === "text")?.text ?? "").trim();
    if (!text || /^UNKNOWN/i.test(text)) { cacheSet(cacheKey, ""); return null; }
    cacheSet(cacheKey, text);
    return text;
  } catch {
    return null; // don't cache failures — allow a retry next visit
  }
}

/** Resolve a tenant description: curated first, else AI fallback (cached). */
export async function getTenantDescription(name: string): Promise<string | null> {
  return curatedTenantDescription(name) ?? await aiDescription(name, "tenant");
}
/** Resolve a parent-company description: curated first, else AI fallback (cached). */
export async function getParentDescription(parent: string): Promise<string | null> {
  return curatedParentDescription(parent) ?? await aiDescription(parent, "parent");
}
