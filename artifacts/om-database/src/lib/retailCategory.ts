// RETAIL TENANCY INTELLIGENCE — category mix + e-commerce resilience.
// The defining lens for underwriting a shopping center: WHAT KIND of retail is the
// rent coming from, and how internet-/recession-resistant is it. Classifies every
// occupied tenant into a retail category and an e-commerce-resistance weight, then rolls
// the roster up to center-level metrics (mix by rent & SF, a 0–100 resilience score, the
// necessity/service share). Deterministic — no model, no tokens — so it's free and runs
// live on every deal. Built on a brand dictionary + keyword heuristics; both are easily
// extended as the database grows (the same operator-taught spirit as the rest of the app).

import type { Deal, Tenant } from "./idb";
import { isVacant, isNAPTenant } from "./utils";

export type RetailCategory =
  | "Grocery & Necessity"
  | "Pharmacy & Drug"
  | "Restaurant & Food"
  | "Off-Price & Discount"
  | "Health & Medical"
  | "Fitness"
  | "Personal Services"
  | "Financial & Telecom"
  | "Apparel & Soft Goods"
  | "Specialty Retail"
  | "Home & Improvement"
  | "Entertainment"
  | "Automotive"
  | "Other";

// E-commerce / internet resistance per category (0–100). High = daily-needs, experiential,
// or service tenants that REQUIRE a visit and resist online substitution; low = commodified
// goods easily bought online. Drives the center resilience score and the IC-memo narrative.
export const CATEGORY_RESISTANCE: Record<RetailCategory, number> = {
  "Health & Medical": 98,
  "Grocery & Necessity": 95,
  "Fitness": 95,
  "Personal Services": 95,
  "Restaurant & Food": 90,
  "Entertainment": 88,
  "Pharmacy & Drug": 85,
  "Automotive": 85,
  "Home & Improvement": 80,
  "Financial & Telecom": 78,
  "Off-Price & Discount": 75,
  "Specialty Retail": 55,
  "Apparel & Soft Goods": 35,
  "Other": 60,
};

// SECTOR OCCUPANCY-COST HEALTH BANDS. Occupancy cost (rent + recoveries + % rent as a
// share of a tenant's gross sales) is only meaningful RELATIVE TO THE SECTOR, because it
// tracks gross margin: a thin-margin, high-volume grocer is stressed at a level that is
// perfectly healthy for a high-margin apparel or specialty tenant. `green` = at/below is
// healthy; between green and amber is elevated/watch; above amber is stressed for that
// sector. Institutional rules of thumb — tune freely as the database teaches us more.
export const OCC_COST_BANDS: Record<RetailCategory, { green: number; amber: number }> = {
  "Grocery & Necessity": { green: 3, amber: 5 },    // grocers/clubs/supercenters run 1–3%
  "Pharmacy & Drug":     { green: 5, amber: 8 },
  "Off-Price & Discount":{ green: 6, amber: 9 },
  "Home & Improvement":  { green: 6, amber: 10 },    // big-box low; furniture higher
  "Automotive":          { green: 8, amber: 12 },
  "Restaurant & Food":   { green: 8, amber: 12 },
  "Specialty Retail":    { green: 11, amber: 16 },
  "Financial & Telecom": { green: 10, amber: 15 },   // banks = deposits, not comparable
  "Fitness":             { green: 12, amber: 18 },
  "Health & Medical":    { green: 12, amber: 18 },    // often not sales-based
  "Personal Services":   { green: 12, amber: 18 },
  "Entertainment":       { green: 12, amber: 18 },    // cinema judged per-screen
  "Apparel & Soft Goods":{ green: 14, amber: 18 },    // healthy 10–15%, stressed >18–20
  "Other":               { green: 10, amber: 15 },    // generic fallback
};

export type OccTier = "healthy" | "watch" | "stressed";
export interface OccGrade {
  tier: OccTier; category: RetailCategory;
  green: number; amber: number;
  color: string;   // roster cell color for this tier
  short: string;   // compact label, e.g. "Elevated for Grocery"
  detail: string;  // tooltip line with the sector's healthy/stressed cut-offs
}

// Grade one tenant's occupancy cost AGAINST ITS SECTOR. `name` picks the category (via
// classifyTenant); `occPct` is the occupancy-cost % (already ×100, e.g. 4.0 for 4%).
// Returns null when there's no usable occ cost. Pure + synchronous + token-free.
export function gradeOccupancyCost(name: string, occPct: number | null | undefined): OccGrade | null {
  const occ = typeof occPct === "string" ? Number(occPct) : occPct;
  if (occ == null || !Number.isFinite(occ) || occ <= 0) return null;
  const { category } = classifyTenant(name);
  const band = OCC_COST_BANDS[category];
  const tier: OccTier = occ <= band.green ? "healthy" : occ <= band.amber ? "watch" : "stressed";
  const color = tier === "healthy" ? "#0f9d63" : tier === "watch" ? "#c97a18" : "#dc2626";
  const short = tier === "healthy" ? `Healthy for ${category}`
    : tier === "watch" ? `Elevated for ${category}`
    : `Stressed for ${category}`;
  const detail = tier === "healthy"
    ? `${occ.toFixed(1)}% is healthy for ${category} (typ. ≤${band.green}%; stressed >${band.amber}%).`
    : tier === "watch"
      ? `${occ.toFixed(1)}% is elevated for ${category} — healthy is ≤${band.green}%, stressed >${band.amber}%.`
      : `${occ.toFixed(1)}% is stressed for ${category} (healthy ≤${band.green}%).`;
  return { tier, category, green: band.green, amber: band.amber, color, short, detail };
}

// The sector band + category for a tenant name — used by closure-risk (utils) to scale its
// stressed/unsustainable thresholds without a circular import of classifyTenant.
export function occCostBand(name: string): { green: number; amber: number; category: RetailCategory } {
  const { category } = classifyTenant(name);
  return { ...OCC_COST_BANDS[category], category };
}

// Categories considered "necessity / service" (daily-needs, recession-tolerant) — the
// share institutional retail buyers most want to see.
const NECESSITY_CATEGORIES = new Set<RetailCategory>([
  "Grocery & Necessity", "Pharmacy & Drug", "Restaurant & Food",
  "Health & Medical", "Fitness", "Personal Services", "Automotive",
]);

// Normalize a tenant name for matching: lowercase, drop store #, common suffixes and
// punctuation. IMPORTANT: we KEEP the words inside parentheses — the parenthetical is
// almost always the brand/DBA ("Wakefern Food Corp. (ShopRite)", "Doherty Bread, LLC
// (Panera Bread Bakery Café)"), so stripping it threw away the one recognizable name and
// dumped the tenant into "Other". We only remove the parenthesis punctuation (via the
// general punctuation strip below), leaving the brand words to match.
function clean(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/#\s*[\w-]+/g, " ")
    .replace(/\bsuite\b.*$/g, " ")
    .replace(/\b(corporation|corp|inc|llc|ltd|co|stores?|the)\b\.?/g, " ")
    .replace(/[^\w\s'&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Brand → category. Keys are matched as SUBSTRINGS of the cleaned name (so store numbers,
// banners and "Supercenter"/"Marketplace" suffixes still match). Longer keys are tried
// first so "dollar tree" wins over a bare "dollar". Not exhaustive — the keyword heuristics
// below catch the long tail, and the list is meant to grow with the portfolio.
const BRANDS: Record<string, RetailCategory> = {
  // Grocery & necessity
  "kroger": "Grocery & Necessity", "king soopers": "Grocery & Necessity", "ralphs": "Grocery & Necessity",
  "fred meyer": "Grocery & Necessity", "smith's": "Grocery & Necessity", "publix": "Grocery & Necessity",
  "safeway": "Grocery & Necessity", "albertsons": "Grocery & Necessity", "vons": "Grocery & Necessity",
  "jewel": "Grocery & Necessity", "acme": "Grocery & Necessity", "shaw's": "Grocery & Necessity",
  "stop & shop": "Grocery & Necessity", "giant": "Grocery & Necessity", "food lion": "Grocery & Necessity",
  "harris teeter": "Grocery & Necessity", "wegmans": "Grocery & Necessity", "whole foods": "Grocery & Necessity",
  "trader joe": "Grocery & Necessity", "sprouts": "Grocery & Necessity", "aldi": "Grocery & Necessity",
  "lidl": "Grocery & Necessity", "heb": "Grocery & Necessity", "h-e-b": "Grocery & Necessity",
  "meijer": "Grocery & Necessity", "hy-vee": "Grocery & Necessity", "winn-dixie": "Grocery & Necessity",
  "food 4 less": "Grocery & Necessity", "grocery outlet": "Grocery & Necessity", "save-a-lot": "Grocery & Necessity",
  "piggly wiggly": "Grocery & Necessity", "ingles": "Grocery & Necessity", "weis": "Grocery & Necessity",
  "tops": "Grocery & Necessity", "price chopper": "Grocery & Necessity", "market basket": "Grocery & Necessity",
  "stater bros": "Grocery & Necessity", "schnucks": "Grocery & Necessity", "dierbergs": "Grocery & Necessity",
  "raley's": "Grocery & Necessity", "shoprite": "Grocery & Necessity", "cub foods": "Grocery & Necessity",
  "giant eagle": "Grocery & Necessity", "wertheimer": "Grocery & Necessity", "natural grocers": "Grocery & Necessity",
  "99 ranch": "Grocery & Necessity", "h mart": "Grocery & Necessity", "fareway": "Grocery & Necessity",
  "hannaford": "Grocery & Necessity", "food city": "Grocery & Necessity", "vallarta": "Grocery & Necessity",
  "hy vee": "Grocery & Necessity", "star market": "Grocery & Necessity", "the fresh market": "Grocery & Necessity",
  // Big-box / supercenter (necessity-anchored)
  "walmart": "Grocery & Necessity", "target": "Grocery & Necessity", "costco": "Grocery & Necessity",
  "sam's club": "Grocery & Necessity", "bj's wholesale": "Grocery & Necessity",
  // Pharmacy & drug
  "walgreens": "Pharmacy & Drug", "cvs": "Pharmacy & Drug", "rite aid": "Pharmacy & Drug", "duane reade": "Pharmacy & Drug",
  // Off-price & discount / value
  "tj maxx": "Off-Price & Discount", "t.j. maxx": "Off-Price & Discount", "marshalls": "Off-Price & Discount",
  "homegoods": "Off-Price & Discount", "home goods": "Off-Price & Discount", "sierra": "Off-Price & Discount",
  "ross": "Off-Price & Discount", "dd's discounts": "Off-Price & Discount", "burlington": "Off-Price & Discount",
  "nordstrom rack": "Off-Price & Discount", "saks off": "Off-Price & Discount", "five below": "Off-Price & Discount",
  "dollar tree": "Off-Price & Discount", "dollar general": "Off-Price & Discount", "family dollar": "Off-Price & Discount",
  "big lots": "Off-Price & Discount", "ollie's": "Off-Price & Discount", "tuesday morning": "Off-Price & Discount",
  "99 cents": "Off-Price & Discount", "dollar store": "Off-Price & Discount",
  "ocean state job lot": "Off-Price & Discount", "ocean state": "Off-Price & Discount",
  "gabe's": "Off-Price & Discount", "gabes": "Off-Price & Discount", "citi trends": "Off-Price & Discount",
  // Home & improvement / furniture
  "home depot": "Home & Improvement", "lowe's": "Home & Improvement", "menards": "Home & Improvement",
  "ace hardware": "Home & Improvement", "tractor supply": "Home & Improvement", "harbor freight": "Home & Improvement",
  "floor & decor": "Home & Improvement", "sherwin-williams": "Home & Improvement", "ikea": "Home & Improvement",
  "ashley": "Home & Improvement", "bob's discount furniture": "Home & Improvement", "rooms to go": "Home & Improvement",
  "at home": "Home & Improvement", "container store": "Home & Improvement", "bed bath": "Home & Improvement",
  // Specialty retail (mid-resistance hard goods)
  "petsmart": "Specialty Retail", "petco": "Specialty Retail", "pet supplies plus": "Specialty Retail",
  "hobby lobby": "Specialty Retail", "michaels": "Specialty Retail", "jo-ann": "Specialty Retail", "joann": "Specialty Retail",
  "best buy": "Specialty Retail", "gamestop": "Specialty Retail", "barnes & noble": "Specialty Retail",
  "books-a-million": "Specialty Retail", "dick's": "Specialty Retail", "academy sports": "Specialty Retail",
  "ulta": "Specialty Retail", "sephora": "Specialty Retail", "bath & body works": "Specialty Retail",
  "total wine": "Specialty Retail", "abc fine wine": "Specialty Retail", "party city": "Specialty Retail",
  "guitar center": "Specialty Retail", "michael's": "Specialty Retail", "world market": "Specialty Retail",
  "five and below": "Off-Price & Discount", "lens crafters": "Health & Medical",
  // Apparel & soft goods (low resistance)
  "old navy": "Apparel & Soft Goods", "gap": "Apparel & Soft Goods", "banana republic": "Apparel & Soft Goods",
  "h&m": "Apparel & Soft Goods", "zara": "Apparel & Soft Goods", "forever 21": "Apparel & Soft Goods",
  "victoria's secret": "Apparel & Soft Goods", "american eagle": "Apparel & Soft Goods", "express": "Apparel & Soft Goods",
  "foot locker": "Apparel & Soft Goods", "famous footwear": "Apparel & Soft Goods", "dsw": "Apparel & Soft Goods",
  "shoe carnival": "Apparel & Soft Goods", "rack room": "Apparel & Soft Goods", "journeys": "Apparel & Soft Goods",
  "lane bryant": "Apparel & Soft Goods", "carter's": "Apparel & Soft Goods", "osh kosh": "Apparel & Soft Goods",
  "j crew": "Apparel & Soft Goods", "j.crew": "Apparel & Soft Goods", "loft": "Apparel & Soft Goods",
  "kohl's": "Apparel & Soft Goods", "macy's": "Apparel & Soft Goods", "jcpenney": "Apparel & Soft Goods",
  "dillard's": "Apparel & Soft Goods", "nordstrom": "Apparel & Soft Goods", "lululemon": "Apparel & Soft Goods",
  // Restaurant & food
  "mcdonald": "Restaurant & Food", "starbucks": "Restaurant & Food", "chipotle": "Restaurant & Food",
  "chick-fil-a": "Restaurant & Food", "wingstop": "Restaurant & Food", "panera": "Restaurant & Food",
  "subway": "Restaurant & Food", "taco bell": "Restaurant & Food", "wendy's": "Restaurant & Food",
  "burger king": "Restaurant & Food", "panda express": "Restaurant & Food", "five guys": "Restaurant & Food",
  "raising cane": "Restaurant & Food", "dunkin": "Restaurant & Food", "jersey mike": "Restaurant & Food",
  "jimmy john": "Restaurant & Food", "popeyes": "Restaurant & Food", "kfc": "Restaurant & Food",
  "olive garden": "Restaurant & Food", "chili's": "Restaurant & Food", "applebee": "Restaurant & Food",
  "buffalo wild wings": "Restaurant & Food", "texas roadhouse": "Restaurant & Food", "ihop": "Restaurant & Food",
  "crumbl": "Restaurant & Food", "sonic": "Restaurant & Food", "arby's": "Restaurant & Food",
  "domino": "Restaurant & Food", "pizza hut": "Restaurant & Food", "papa john": "Restaurant & Food",
  "qdoba": "Restaurant & Food", "moe's": "Restaurant & Food", "smoothie king": "Restaurant & Food",
  "tropical smoothie": "Restaurant & Food", "dutch bros": "Restaurant & Food", "scooter's coffee": "Restaurant & Food",
  // Fitness
  "planet fitness": "Fitness", "la fitness": "Fitness", "crunch fitness": "Fitness", "orangetheory": "Fitness",
  "anytime fitness": "Fitness", "lifetime fitness": "Fitness", "life time": "Fitness", "esporta": "Fitness",
  "f45": "Fitness", "club pilates": "Fitness", "9round": "Fitness", "burn boot camp": "Fitness",
  "ymca": "Fitness", "gold's gym": "Fitness", "eos fitness": "Fitness",
  // Health & medical
  "aspen dental": "Health & Medical", "heartland dental": "Health & Medical", "pacific dental": "Health & Medical",
  "myeyedr": "Health & Medical", "america's best": "Health & Medical", "visionworks": "Health & Medical",
  "pearle vision": "Health & Medical", "quest diagnostics": "Health & Medical", "labcorp": "Health & Medical",
  "fresenius": "Health & Medical", "davita": "Health & Medical", "concentra": "Health & Medical",
  "gohealth": "Health & Medical", "carbon health": "Health & Medical", "the joint": "Health & Medical",
  // Personal services
  "great clips": "Personal Services", "sport clips": "Personal Services", "supercuts": "Personal Services",
  "european wax": "Personal Services", "regis": "Personal Services", "h&r block": "Personal Services",
  "jackson hewitt": "Personal Services", "the ups store": "Personal Services", "fedex office": "Personal Services",
  "postal": "Personal Services", "massage envy": "Personal Services", "hand & stone": "Personal Services",
  "tide cleaners": "Personal Services", "zips": "Personal Services",
  // Financial & telecom
  "verizon": "Financial & Telecom", "at&t": "Financial & Telecom", "t-mobile": "Financial & Telecom",
  "metropcs": "Financial & Telecom", "cricket wireless": "Financial & Telecom", "boost mobile": "Financial & Telecom",
  "bank of america": "Financial & Telecom", "wells fargo": "Financial & Telecom", "chase": "Financial & Telecom",
  "pnc bank": "Financial & Telecom", "us bank": "Financial & Telecom", "td bank": "Financial & Telecom",
  "regions bank": "Financial & Telecom", "fifth third": "Financial & Telecom", "truist": "Financial & Telecom",
  "citizens bank": "Financial & Telecom", "navy federal": "Financial & Telecom",
  // Automotive
  "autozone": "Automotive", "o'reilly": "Automotive", "advance auto": "Automotive", "napa auto": "Automotive",
  "pep boys": "Automotive", "discount tire": "Automotive", "firestone": "Automotive", "midas": "Automotive",
  "jiffy lube": "Automotive", "valvoline": "Automotive", "take 5": "Automotive", "caliber collision": "Automotive",
  // Entertainment
  "amc": "Entertainment", "regal cinemas": "Entertainment", "cinemark": "Entertainment", "marcus theatres": "Entertainment",
  "dave & buster": "Entertainment", "main event": "Entertainment", "round1": "Entertainment", "topgolf": "Entertainment",
  "bowlero": "Entertainment", "chuck e cheese": "Entertainment", "urban air": "Entertainment", "sky zone": "Entertainment",
};

// Keyword heuristics for the long tail of regional / independent tenants. Checked in order;
// first hit wins. Tuned to be conservative — a miss falls to "Other" (resistance 60).
const KEYWORDS: [RegExp, RetailCategory][] = [
  [/\b(dental|dentist|orthodont|endodont)\b/, "Health & Medical"],
  [/\b(medical|clinic|urgent care|physician|health|hospital|pediatric|dermatolog|cardiolog|imaging|radiology|physical therapy|chiropract|vision|optical|optometr|eye care|eyecare|hearing|pharmacy|wellness|family practice|psych)\b/, "Health & Medical"],
  [/\b(fitness|gym|crossfit|yoga|pilates|cycle|barre|martial arts|karate|taekwondo|dance studio)\b/, "Fitness"],
  [/\b(nails?|salon|barber|spa|massage|hair|beauty|brows?|lash|waxing|tan|tanning|cleaners?|laundr|dry clean|tailor|cobbler|notary|tax|insurance|realty|real estate|title|attorney|law office|postal|ship|mailbox|key|locksmith)\b/, "Personal Services"],
  [/\b(restaurant|cafe|café|coffee|grill|kitchen|pizza|pizzeria|sushi|taco|taqueria|burger|bbq|barbecue|deli|bakery|bagel|donut|doughnut|diner|bistro|cantina|noodle|ramen|pho|thai|chinese|mexican|italian|steakhouse|sandwich|sub shop|ice cream|frozen yogurt|smoothie|juice|bar & grill|eatery|wings|chicken|seafood|creamery|gelato|tea|boba)\b/, "Restaurant & Food"],
  [/\b(wireless|mobile|cellular|phone repair)\b/, "Financial & Telecom"],
  [/\b(bank|credit union|financial|atm)\b/, "Financial & Telecom"],
  [/\b(auto parts|automotive|tire|tires|lube|oil change|car wash|collision|muffler|transmission|brake)\b/, "Automotive"],
  [/\b(liquor|wine|spirits|beer|smoke shop|vape|cigar|tobacco)\b/, "Specialty Retail"],
  [/\b(pet|veterinar|\bvet\b|grooming|aquarium)\b/, "Specialty Retail"],
  [/\b(furniture|mattress|sleep|flooring|carpet|tile|lighting|appliance|hardware|paint|cabinet|kitchen & bath|home improvement)\b/, "Home & Improvement"],
  [/\b(grocer|grocery|supermarket|market|food mart|fresh|produce|meat|butcher|farmers)\b/, "Grocery & Necessity"],
  [/\b(theat|cinema|bowl|arcade|entertainment|trampoline|escape room|laser tag|amusement)\b/, "Entertainment"],
  [/\b(apparel|clothing|boutique|fashion|shoes?|footwear|jewelr|accessor|menswear|womenswear)\b/, "Apparel & Soft Goods"],
  [/\b(dollar|discount|outlet|bargain|thrift|consignment)\b/, "Off-Price & Discount"],
  [/\b(daycare|childcare|learning center|tutoring|academy|preschool|montessori|kumon)\b/, "Personal Services"],
];

export interface TenantClass { category: RetailCategory; resistance: number }

// Classify one tenant by name. Dictionary (longest brand match) → keyword heuristics →
// "Other". Pure and synchronous.
export function classifyTenant(name: string): TenantClass {
  const c = clean(name);
  if (c) {
    // Longest brand key matched on WORD BOUNDARIES wins (so "dollar tree" beats "dollar",
    // and "ross" matches "Ross Dress For Less" but NOT "Crossroads"). Padding both sides
    // with spaces makes ".includes(' key ')" a whole-word-sequence match.
    const padded = ` ${c} `;
    let best: RetailCategory | null = null, bestLen = 0;
    for (const key in BRANDS) {
      if (key.length > bestLen && padded.includes(` ${key} `)) { best = BRANDS[key]; bestLen = key.length; }
    }
    if (best) return { category: best, resistance: CATEGORY_RESISTANCE[best] };
    for (const [re, cat] of KEYWORDS) {
      if (re.test(c)) return { category: cat, resistance: CATEGORY_RESISTANCE[cat] };
    }
  }
  return { category: "Other", resistance: CATEGORY_RESISTANCE["Other"] };
}

export interface CategorySlice {
  category: RetailCategory;
  resistance: number;
  count: number;
  sf: number; sfPct: number;
  rent: number; rentPct: number;
}
export interface CenterRetailMix {
  slices: CategorySlice[];        // sorted by rent share, descending
  resilienceScore: number;        // 0–100, rent-weighted average resistance (SF-weighted fallback)
  resistantRentPct: number;       // % of classified rent in resistance ≥ 80 categories
  necessityRentPct: number;       // % of classified rent in necessity/service categories
  classifiedRentPct: number;      // share of rent we could classify (confidence in the read)
  characterization: string;       // one-line institutional summary
  tenantCount: number;            // occupied tenants analyzed
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Roll the occupied roster up to the center-level retail mix + resilience. Vacant and NAP
// rows are excluded (they aren't paying retail rent). Rent-weighted where rent exists,
// else SF-weighted, so it degrades gracefully on a thin roster.
export function analyzeCenterMix(deal: Pick<Deal, "tenants">): CenterRetailMix | null {
  const tenants = (deal.tenants || []) as Tenant[];
  const occ = tenants.filter((t) => !isVacant(t.name) && !isNAPTenant(t));
  if (!occ.length) return null;

  const by = new Map<RetailCategory, CategorySlice>();
  let totalSF = 0, totalRent = 0;
  for (const t of occ) {
    const { category, resistance } = classifyTenant(t.canonicalName || t.name || "");
    const sf = num(t.sf);
    const rent = num(t.annualRent) || num(t.rentPerSF) * sf;
    totalSF += sf; totalRent += rent;
    const s = by.get(category) || { category, resistance, count: 0, sf: 0, sfPct: 0, rent: 0, rentPct: 0 };
    s.count++; s.sf += sf; s.rent += rent;
    by.set(category, s);
  }

  const slices = [...by.values()];
  const wTotal = totalRent > 0 ? totalRent : totalSF; // weight basis
  for (const s of slices) {
    s.sfPct = totalSF > 0 ? Math.round((s.sf / totalSF) * 1000) / 10 : 0;
    s.rentPct = totalRent > 0 ? Math.round((s.rent / totalRent) * 1000) / 10 : 0;
  }
  // Resilience = weighted average resistance. Weight by rent when present, else SF, else count.
  const weightOf = (s: CategorySlice) => totalRent > 0 ? s.rent : totalSF > 0 ? s.sf : s.count;
  const wSum = slices.reduce((a, s) => a + weightOf(s), 0) || 1;
  const resilienceScore = Math.round(slices.reduce((a, s) => a + s.resistance * weightOf(s), 0) / wSum);

  // Share of weight that is high-resistance / necessity. "Other" is excluded from the
  // numerator (unknown) but counted in classifiedRentPct so the reader sees the confidence.
  const classifiedW = slices.filter((s) => s.category !== "Other").reduce((a, s) => a + weightOf(s), 0);
  const resistantW = slices.filter((s) => s.resistance >= 80).reduce((a, s) => a + weightOf(s), 0);
  const necessityW = slices.filter((s) => NECESSITY_CATEGORIES.has(s.category)).reduce((a, s) => a + weightOf(s), 0);
  const pct = (w: number) => Math.round((w / wSum) * 1000) / 10;

  slices.sort((a, b) => (b.rentPct - a.rentPct) || (b.sfPct - a.sfPct));

  const resistantRentPct = pct(resistantW);
  const necessityRentPct = pct(necessityW);
  const classifiedRentPct = pct(classifiedW);

  return {
    slices, resilienceScore, resistantRentPct, necessityRentPct, classifiedRentPct,
    tenantCount: occ.length,
    characterization: characterize(resilienceScore, resistantRentPct, necessityRentPct, slices),
  };
}

function characterize(score: number, resistantPct: number, necessityPct: number, slices: CategorySlice[]): string {
  const top = slices.filter((s) => s.category !== "Other").slice(0, 2).map((s) => s.category);
  const lead = top.length ? top.join(" + ") : "Mixed";
  if (score >= 85) return `Highly defensive — ${resistantPct}% of rent is internet-resistant (${lead}-led, ${necessityPct}% necessity/service).`;
  if (score >= 72) return `Defensive, necessity-weighted — ${resistantPct}% internet-resistant (${lead}-led).`;
  if (score >= 58) return `Balanced mix — ${resistantPct}% internet-resistant; some discretionary exposure (${lead}-led).`;
  return `Discretionary-weighted — only ${resistantPct}% internet-resistant; watch e-commerce/soft-goods exposure (${lead}-led).`;
}
