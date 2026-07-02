// MOVIE-THEATER metrics. A cinema is underwritten on sales PER SCREEN (and per
// seat), NOT sales per SF — a 50,000 SF box tells you nothing; screens are the
// revenue units. This resolves a theater's screen count (from the captured field,
// else parsed from the tenant name — chains name locations by screen count, e.g.
// "Regal Trussville 14", "AMC CLASSIC 12", "Cinemark 18") and derives sales/screen.
// Deterministic, token-free.
import type { Tenant } from "./idb";

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Known cinema chains + generic cinema words. Kept distinct from the broader
// "Entertainment" retail category (which also covers bowling/arcades/trampoline).
// No trailing \b — brand/keyword fragments must match plurals & suffixes
// ("theat" → "Theatres", "cinema" → "Cinemas"). Leading \b prevents mid-word hits.
const CINEMA_BRANDS = /\b(regal|amc|cinemark|marcus theat|harkins|cinepolis|alamo drafthouse|showcase cinema|cmx cinema|studio movie grill|emagine|b&b theat|malco|megaplex|reading cinema|angelika|landmark theat|ipic|look cinema|santikos|galaxy theat|phoenix theat|movie tavern|epic theat|starplex|cobb theat|frank theat|paragon theat)/;
const CINEMA_KEYWORD = /\b(cinema|cineplex|multiplex|movie theat|theatre|theater|movies)/;

// Is this tenant a MOVIE THEATER? (Name-based; pure and synchronous.)
export function isCinema(name: unknown): boolean {
  const c = String(name || "").toLowerCase().trim();
  if (!c) return false;
  return CINEMA_BRANDS.test(c) || CINEMA_KEYWORD.test(c);
}

export type ScreenSource = "stated" | "name";

// A real multiplex tops out around 24–30 screens. Anything above ~30 (or below 3)
// is almost certainly a misread — a store number, seat count, or year — so it's
// flagged SUSPECT and must be confirmed rather than used to compute a metric.
export const SCREENS_MIN = 3;
export const SCREENS_MAX = 30;
export const isPlausibleScreens = (n: number | null | undefined): boolean =>
  n != null && Number.isFinite(n) && n >= SCREENS_MIN && n <= SCREENS_MAX;

// Resolve a theater's screen count: the captured `screens` field first (from the
// OM), else a count parsed from the tenant name. `suspect` = a value is present but
// out of the plausible band (>30 or <3) → likely an extraction error; confirm it.
export function resolveScreens(t: Tenant): { screens: number | null; source: ScreenSource | null; suspect: boolean } {
  const stated = num(t.screens);
  if (stated != null) {
    const rounded = Math.round(stated);
    return { screens: rounded, source: "stated", suspect: !isPlausibleScreens(rounded) };
  }
  const fromName = parseScreensFromName(t.name);
  // The name parser only returns in-band values, so a name-sourced count is never suspect.
  if (fromName != null) return { screens: fromName, source: "name", suspect: false };
  return { screens: null, source: null, suspect: false };
}

// Extract a screen count from a theater name. Handles "14 screens", "14-screen",
// "16-plex", and a trailing count on a recognized cinema ("Cinemark 18"). Bounded
// to the plausible band so a store number / year / seat count isn't mistaken for
// screens; the bare-trailing-number form is only trusted on an actual cinema name.
export function parseScreensFromName(name: unknown): number | null {
  const c = String(name || "").toLowerCase().trim();
  if (!c) return null;
  // Explicit "N screens / N-screen / N-plex / N auditoriums".
  const explicit = c.match(/\b(\d{1,2})\s*[-\s]?(screens?|plex|auditoriums?|theatres?|theaters?)\b/);
  if (explicit) { const n = Number(explicit[1]); if (isPlausibleScreens(n)) return n; }
  // Trailing count on a cinema name ("Regal Trussville 14"). Require ≥4 so a bare
  // "3" or a small store code doesn't slip through.
  if (isCinema(c)) {
    const trailing = c.match(/\b(\d{1,2})\s*$/);
    if (trailing) { const n = Number(trailing[1]); if (n >= 4 && n <= SCREENS_MAX) return n; }
  }
  return null;
}

// Annual sales for a tenant (salesPSF × SF), used as the numerator for per-screen.
export function tenantAnnualSales(salesPSF: number | null | undefined, sf: number | null | undefined): number | null {
  const psf = num(salesPSF), s = num(sf);
  return psf != null && s != null ? psf * s : null;
}

// Sales per screen = annual sales ÷ screens. Null when either is unknown.
export function salesPerScreen(annualSales: number | null, screens: number | null): number | null {
  if (annualSales == null || screens == null || screens <= 0) return null;
  return annualSales / screens;
}

export function fmtPerScreen(v: number | null): string {
  if (v == null) return "—";
  return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M/screen` : `$${Math.round(v / 1000)}k/screen`;
}

export interface CinemaSalesRead {
  isCinema: boolean;
  screens: number | null;
  screenSource: ScreenSource | null;
  suspect: boolean;          // a screen count is present but implausible (>30 / <3) — confirm it
  needsScreens: boolean;     // a theater with sales but no usable screen count
  annualSales: number | null;
  perScreen: number | null;  // only computed when the screen count is plausible
}

// One call for the UI: is this a theater, how many screens, and its sales/screen.
// A suspect (>30) or missing screen count does NOT silently produce a per-screen
// number — it flags for confirmation instead.
export function cinemaSalesRead(t: Tenant, effectiveSalesPSF: number | null): CinemaSalesRead {
  if (!isCinema(t.name)) return { isCinema: false, screens: null, screenSource: null, suspect: false, needsScreens: false, annualSales: null, perScreen: null };
  const { screens, source, suspect } = resolveScreens(t);
  const annualSales = tenantAnnualSales(effectiveSalesPSF, num(t.sf));
  const usable = isPlausibleScreens(screens);
  return {
    isCinema: true,
    screens,
    screenSource: source,
    suspect,
    needsScreens: annualSales != null && !usable,
    annualSales,
    perScreen: usable ? salesPerScreen(annualSales, screens) : null,
  };
}
