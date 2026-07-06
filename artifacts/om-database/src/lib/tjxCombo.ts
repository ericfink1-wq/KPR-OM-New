// TJX COMBO ("co-branded") STORES — two TJX banners sharing ONE box on ONE lease
// (Marshalls/HomeGoods, T.J. Maxx/HomeGoods, Marshalls/Sierra, HomeGoods/HomeSense…).
// TJX is effectively the only retailer that does this at scale, so we special-case
// it here rather than building a generic multi-banner engine (Eric's scope: identify
// it for TJX, don't rewrite the site).
//
// Why it matters:
//  • A combined box is ~2× a single banner's footprint, so the brand SF benchmark
//    (built from single-banner locations) false-flags a 55K combo as "oversized /
//    possible SF error." Recognizing the combo turns that false positive into the
//    correct read: "one lease, two banners."
//  • The roster/analysis should see it as TWO anchor draws, not one oversized store.
//
// Two detection paths:
//  1. EXPLICIT — the tenant name already carries two banners ("Marshalls / HomeGoods").
//  2. BY SIZE — the name carries only ONE TJX off-price banner but the box is far
//     larger than any standalone banner (e.g. the rent roll's legal entity is just
//     "Marshalls of MA, Inc." on a 55K box). A single TJX off-price store is almost
//     never above ~45K SF, so a bigger single-banner box is very likely a combo.
//
// Deterministic, no model, no cost.

// A single TJX off-price box tops out around 40K SF; a co-branded box runs ~50–70K.
// Above this, a single-banner name is very likely a two-banner combo (flagged to verify).
const LIKELY_COMBO_SF = 45_000;

interface Banner { key: string; label: string; test: RegExp }

// Normalized (lowercase, punctuation → single spaces) banner matchers. "sierra" is
// only ever counted INSIDE a combo (it needs another banner present), because a bare
// "Sierra" can be an unrelated local tenant — see detectTjxCombo.
const BANNERS: Banner[] = [
  { key: "homegoods", label: "HomeGoods", test: /\bhome ?goods\b/ },
  { key: "homesense", label: "HomeSense", test: /\bhome ?sense\b/ },
  { key: "marshalls", label: "Marshalls", test: /\bmarshalls?\b/ },
  { key: "tjmaxx",    label: "T.J. Maxx", test: /\bt ?j ?maxx\b/ },
  { key: "sierra",    label: "Sierra",    test: /\bsierra(?: trading post)?\b/ },
];

// The banners that reliably identify a TJX off-price box ON THEIR OWN (used for the
// by-size path). Excludes "sierra" (ambiguous alone) and "homesense" (Canada-only,
// never seen solo in US rosters).
const SOLO_TJX_KEYS = new Set(["marshalls", "tjmaxx", "homegoods"]);

const norm = (s: unknown): string =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

function bannersIn(name: unknown): Banner[] {
  const n = norm(name);
  if (!n) return [];
  return BANNERS.filter((b) => b.test.test(n));
}

export interface TjxComboRead {
  isTjx: boolean;        // the box is (or contains) a TJX off-price banner
  isCombo: boolean;      // two banners are named explicitly → a known combo
  likely: boolean;       // one banner named but the box is combo-sized → probably a combo
  banners: string[];     // banner display labels found (["Marshalls","HomeGoods"])
  label: string;         // canonical combo label, e.g. "Marshalls / HomeGoods" (combos only)
  note: string;          // one-line human explanation for tooltips / notes ("" when n/a)
}

// Explicit two-banner combo from the NAME alone. Requires ≥2 DISTINCT banners.
export function detectTjxCombo(name: unknown): TjxComboRead {
  const found = bannersIn(name);
  const labels = found.map((b) => b.label);
  const isCombo = found.length >= 2;
  const isTjx = found.some((b) => SOLO_TJX_KEYS.has(b.key)) || isCombo;
  const label = isCombo ? labels.join(" / ") : "";
  return {
    isTjx,
    isCombo,
    likely: false,
    banners: labels,
    label,
    note: isCombo
      ? `${label} is a TJX co-branded box — two banners under one lease. Its footprint is ~2× a single banner, so it is not an oversized-store anomaly.`
      : "",
  };
}

// Full read used by the roster/benchmarks: explicit combo, OR a single TJX off-price
// banner on a combo-sized box (likely combo — verify). `sf` optional; without it only
// the explicit path can fire.
export function tjxComboRead(name: unknown, sf?: number | string | null): TjxComboRead {
  const explicit = detectTjxCombo(name);
  if (explicit.isCombo) return explicit;

  const found = bannersIn(name);
  const soloTjx = found.length === 1 && SOLO_TJX_KEYS.has(found[0].key);
  const n = sf == null || sf === "" ? NaN : Number(sf);
  if (soloTjx && Number.isFinite(n) && n >= LIKELY_COMBO_SF) {
    const banner = found[0].label;
    return {
      isTjx: true,
      isCombo: false,
      likely: true,
      banners: [banner],
      label: "",
      note:
        `${Math.round(n).toLocaleString()} SF is far larger than a standalone ${banner} ` +
        `(~30–40K SF), so this is very likely a TJX combo box (e.g. ${banner} + HomeGoods) — ` +
        `two banners on one lease. Verify the second banner; it is not a size error, and it ` +
        `is a dual anchor draw, not one oversized store.`,
    };
  }
  return {
    isTjx: explicit.isTjx,
    isCombo: false,
    likely: false,
    banners: explicit.banners,
    label: "",
    note: "",
  };
}

// True when a tenant is a TJX combo (explicit) or a likely combo (by size). Convenience
// wrapper for callers that only need the boolean.
export function isTjxCombo(name: unknown, sf?: number | string | null): boolean {
  const r = tjxComboRead(name, sf);
  return r.isCombo || r.likely;
}
