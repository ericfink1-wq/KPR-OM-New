import type { Deal, DealScore } from "./idb";
import { isVacant, tenantLabel } from "./utils";
import { lookupWatch, type WatchMap, WATCH_STATUS_META } from "./useWatchlist";

// How much each status contributes, before weighting by income share.
const STATUS_WEIGHT: Record<string, number> = {
  liquidating: 1.0,   // closed / GOB — the space is going dark
  bankruptcy: 0.9,    // in Ch.11, closing stores
  distressed: 0.55,   // downgraded / mass closures, no filing
  watch: 0.3,         // pressure / negative outlook
};

// Grade ladder, best → worst. We step DOWN by N notches rather than re-deriving
// a numeric→grade table (which could disagree with the engine's own grade).
const GRADE_LADDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "D-", "F"];
function stepGrade(grade: string, notches: number): string {
  const i = GRADE_LADDER.indexOf(grade);
  if (i < 0 || notches <= 0) return grade;
  return GRADE_LADDER[Math.min(i + notches, GRADE_LADDER.length - 1)];
}

export interface WatchImpactMatch {
  brand: string;
  status: string;
  note: string | null;
  rent: number;
  sf: number;
  share: number;          // 0..1 of base rent (or SF if rent unknown)
  shareBasis: "rent" | "sf";
  isAnchor: boolean;
  cotenancy: boolean;
  severity: "high" | "medium" | "low";
  description: string;
}

export interface WatchImpact {
  matches: WatchImpactMatch[];
  totalImpact: number;                 // weighted 0..~1 severity units
  notches: number;                     // grades to drop
  flags: { severity: string; description: string }[];
  summary: string;                     // short rationale addendum
  hasImpact: boolean;                  // any matched distressed tenant
  adjustScore: (orig: DealScore | null | undefined) => DealScore | null | undefined;
}

const pct = (x: number) => (x * 100 < 1 ? "<1" : Math.round(x * 100).toString());

/**
 * Cross-reference a deal's roster against the watchlist and translate exposure
 * into a grade adjustment + red flags — weighted by each tenant's share of base
 * rent, and amplified when the tenant is an anchor or a co-tenancy trigger.
 * Computed live (the watchlist changes over time) so it's always current.
 */
export function computeWatchlistImpact(deal: Deal, watchMap: WatchMap): WatchImpact {
  const tenants = deal.tenants || [];
  const rentOf = (t: { annualRent?: number | string | null }) => Number(t.annualRent) || 0;
  const sfOf = (t: { sf?: number | string | null }) => Number(t.sf) || 0;

  // Denominators: total in-place base rent (preferred), else total SF.
  let totalRent = 0, totalSF = 0;
  for (const t of tenants) {
    if (isVacant(t.name)) continue;
    totalRent += rentOf(t);
    totalSF += sfOf(t);
  }
  if (totalRent <= 0 && (deal.grossPotentialRent || 0) > 0) totalRent = deal.grossPotentialRent!;

  const cotenantsText = (deal.retailCotenants || "").toLowerCase();

  const matches: WatchImpactMatch[] = [];
  let totalImpact = 0;
  const seen = new Set<string>();

  for (const t of tenants) {
    if (!t.name || isVacant(t.name)) continue;
    const w = lookupWatch(watchMap, t.name);
    if (!w) continue;
    const label = tenantLabel(t.name).toLowerCase();
    const key = label;
    if (seen.has(key)) continue;   // count a brand once per deal
    seen.add(key);

    const rent = rentOf(t);
    const sf = sfOf(t);
    const shareBasis: "rent" | "sf" = totalRent > 0 ? "rent" : "sf";
    const share = shareBasis === "rent"
      ? (totalRent > 0 ? rent / totalRent : 0)
      : (totalSF > 0 ? sf / totalSF : 0);

    const sw = STATUS_WEIGHT[w.status] ?? 0.3;
    const isAnchor = t.isAnchor === true;
    // Co-tenancy tied if the OM's co-tenancy text names this brand, or it's an
    // anchor and the deal has co-tenancy provisions at all (anchors are the
    // usual trigger). A co-tenancy failure can cut inline rents / grant kickouts.
    const namedInCotenancy = !!cotenantsText && (cotenantsText.includes(label) || cotenantsText.includes(w.brand.toLowerCase()));
    const cotenancy = namedInCotenancy || (isAnchor && !!cotenantsText);

    const anchorMult = isAnchor ? 1.6 : 1;
    const cotenancyMult = cotenancy ? 1.4 : 1;
    const contribution = Math.min(0.6, sw * share * anchorMult * cotenancyMult);
    totalImpact += contribution;

    const sevScore = sw * share * (isAnchor ? 1.5 : 1) * (cotenancy ? 1.3 : 1);
    const severity: "high" | "medium" | "low" =
      sevScore >= 0.1 || ((w.status === "liquidating" || w.status === "bankruptcy") && (share >= 0.07 || isAnchor))
        ? "high"
        : sevScore >= 0.03
          ? "medium"
          : "low";

    const m = WATCH_STATUS_META[w.status] || WATCH_STATUS_META.watch;
    const shareTxt = shareBasis === "rent" ? `${pct(share)}% of base rent` : `${pct(share)}% of GLA`;
    const tags = [isAnchor ? "ANCHOR" : null, cotenancy ? "co-tenancy trigger" : null].filter(Boolean).join(" · ");
    const description =
      `${tenantLabel(t.name)} (${m.label.toLowerCase()}) — ${shareTxt}` +
      (sf > 0 ? `, ${Math.round(sf).toLocaleString()} SF` : "") +
      (tags ? ` · ${tags}` : "") +
      (w.note ? `. ${w.note}` : "") +
      (cotenancy ? " Watch co-tenancy clauses — a going-dark here can trigger inline rent reductions or termination rights." : "");

    matches.push({ brand: w.brand, status: w.status, note: w.note, rent, sf, share, shareBasis, isAnchor, cotenancy, severity, description });
  }

  totalImpact = Math.min(1, totalImpact);

  // Grade notches from total weighted impact. Thresholds chosen so a small inline
  // tenant (e.g. 2% of rent on watch ≈ 0.006) drops 0 notches.
  const notches =
    totalImpact < 0.025 ? 0 :
    totalImpact < 0.06 ? 1 :
    totalImpact < 0.12 ? 2 :
    totalImpact < 0.2 ? 3 :
    totalImpact < 0.32 ? 4 : 5;

  // Sort flags worst-first.
  const sevRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const flags = matches
    .slice()
    .sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.share - a.share)
    .map(m => ({ severity: m.severity, description: m.description }));

  const top = matches.slice().sort((a, b) => b.share - a.share).slice(0, 3).map(m => tenantLabel(m.brand));
  const summary = notches > 0
    ? ` Grade adjusted ${notches} notch${notches > 1 ? "es" : ""} down for at-risk tenant exposure (${top.join(", ")}), weighted by share of income.`
    : "";

  const adjustScore = (orig: DealScore | null | undefined): DealScore | null | undefined => {
    if (!orig) return orig;
    if (notches <= 0) return orig;
    const newGrade = stepGrade(orig.grade, notches);
    const penaltyPts = Math.min(30, Math.round(totalImpact * 40));
    return {
      ...orig,
      grade: newGrade,
      score: Math.max(5, Math.round((orig.score ?? 0) - penaltyPts)),
      rationale: (orig.rationale || "") + summary,
    };
  };

  return { matches, totalImpact, notches, flags, summary, hasImpact: matches.length > 0, adjustScore };
}
