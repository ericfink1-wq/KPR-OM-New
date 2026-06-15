// Multi-year property-tax FORECAST — projects the bill year-by-year over the hold,
// layering the reassessment event (and any abatement burn-off) on top of ongoing
// levy/millage growth. Deterministic (no model). Stays informational (card + flags);
// it does NOT change NOI/cash-flow.
//
// Growth source = each state's STATUTORY cap on annual property-tax growth, which is
// the binding constraint on year-over-year increases (assessment-value caps like CA
// Prop 13 / OR Measure 50 / MI Prop A, or levy caps like MA Prop 2½ / NJ / NY / WA).
// Where no cap exists, a documented fallback (~3%) is used and the confidence drops.
//
// Three events can move the bill mid-hold, each modeled here:
//   1. Reassessment   — a sale reset (yr 1) or the next scheduled cycle steps the
//                       ad-valorem base toward the purchase price (with phase-in).
//   2. Abatement      — an in-place break holds the bill low, then steps UP to the
//                       un-abated (stabilized) figure at expiry (cliff or phase-out).
//   3. Levy growth    — ongoing millage/levy creep applied on top every year.
// A cross-check then validates the projection against the OM's own pro-forma tax line.
import { estimateReassessment, type ReassessInput, type Confidence } from "./taxReassessment";

export interface LevyGrowth { pct: number; basis: "assessed_cap" | "levy_cap" | "typical"; note: string; confidence: Confidence; }

// Annual BILL-growth ceiling by state. Caps are the most defensible "historical" rate
// because they legally bound year-over-year growth between reassessments.
export const STATE_LEVY_GROWTH: Record<string, LevyGrowth> = {
  CA: { pct: 2,   basis: "assessed_cap", note: "Prop 13 caps assessed-value growth at 2%/yr between sales.", confidence: "high" },
  OR: { pct: 3,   basis: "assessed_cap", note: "Measure 50 caps the maximum assessed value at 3%/yr.", confidence: "high" },
  MI: { pct: 3,   basis: "assessed_cap", note: "Proposal A caps taxable-value growth at the lesser of 5% or CPI (~2–3%); resets to SEV on transfer.", confidence: "high" },
  AZ: { pct: 5,   basis: "assessed_cap", note: "Limited Property Value grows ≤5%/yr.", confidence: "medium" },
  FL: { pct: 10,  basis: "assessed_cap", note: "Non-homestead (commercial) assessment increases capped at 10%/yr (excludes school levies).", confidence: "high" },
  NM: { pct: 3,   basis: "assessed_cap", note: "Value increases generally limited to 3%/yr.", confidence: "medium" },
  MA: { pct: 2.5, basis: "levy_cap", note: "Prop 2½ caps total levy growth at 2.5%/yr (plus certified new growth).", confidence: "high" },
  NJ: { pct: 2,   basis: "levy_cap", note: "2% property-tax levy cap (with statutory exceptions).", confidence: "high" },
  NY: { pct: 2,   basis: "levy_cap", note: "~2% (or CPI, whichever is less) levy cap for taxing units outside NYC.", confidence: "high" },
  WA: { pct: 1,   basis: "levy_cap", note: "1% annual regular-levy growth limit (RCW 84.55).", confidence: "high" },
  CO: { pct: 4,   basis: "typical", note: "No simple cap; biennial reassessment with statutory ratio adjustments — recent growth elevated.", confidence: "low" },
  IL: { pct: 3,   basis: "levy_cap", note: "PTELL (collar counties + Cook) caps aggregate extension growth at the lesser of 5% or CPI.", confidence: "medium" },
  TX: { pct: 3.5, basis: "levy_cap", note: "No commercial assessment cap; most taxing units' levy growth is limited to ~3.5% without voter approval.", confidence: "medium" },
};
const FALLBACK: LevyGrowth = { pct: 3, basis: "typical", note: "No statutory growth cap sourced for this state — assumes ~3%/yr typical levy/budget growth (confirm locally).", confidence: "low" };

export function levyGrowth(state: string | null | undefined): LevyGrowth {
  return STATE_LEVY_GROWTH[(state || "").trim().toUpperCase()] ?? FALLBACK;
}

export interface TaxForecastInput extends ReassessInput {
  holdYears?: number | null;            // from deal.acqHoldPeriod / cash flow; default 10
  growthPctOverride?: number | null;    // user override of the annual growth rate
  abatementExpiryYears?: number | null; // years until a tax abatement/PILOT expires
  unabatedAnnualTaxes?: number | null;  // the FULL bill once the break ends (OM-disclosed)
  abatementPct?: number | null;         // % the break cuts off the full bill (gross-up path)
  abatementPhaseOutYears?: number | null; // burns off over N yrs ending at expiry (else a cliff)
  proformaAnnualTaxes?: number | null;  // OM's underwritten RE-tax line — for the cross-check
}
export interface TaxForecastYear { year: number; taxes: number; phase: "current" | "reassessing" | "unabating" | "grown"; }
export interface TaxForecastValidation { kind: "match" | "understated" | "overstated"; message: string; }
export interface TaxForecast {
  years: TaxForecastYear[];
  growth: LevyGrowth;
  growthPct: number;
  reassessYear: number | null;          // year (offset) the reassessment lands
  phaseInYears: number;
  abatementStepYear: number | null;     // year the abatement burns off (bill steps up)
  abatementStepTo: number | null;       // the un-abated bill at that step (today's-rate $)
  startTaxes: number;
  endTaxes: number;
  totalIncreasePct: number;
  confidence: Confidence;
  validation: TaxForecastValidation | null;  // forecast vs the OM's pro-forma tax line
  assumptions: string[];
}

const lower = (a: Confidence, b: Confidence): Confidence => {
  const o: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
  return o[a] <= o[b] ? a : b;
};
const num = (v: unknown): number => Number(v) || 0;
const fmt$ = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;

export function forecastTaxes(input: TaxForecastInput): TaxForecast | null {
  const r = estimateReassessment(input);
  const curTaxes = num(input.currentAnnualTaxes);
  if (!curTaxes || !r.jurisdiction) return null;
  const nav = num(input.nonAdValoremAnnual);
  const navInBill = nav > 0 && nav < curTaxes ? nav : 0;
  const baseAdVal = curTaxes - navInBill;

  // Post-reassessment ad-valorem level (today's rate), if the estimator could size it.
  const postTotal = r.estPostSaleTaxes ?? r.estNextCycleTaxes ?? null;
  const targetAdVal = postTotal != null ? postTotal - navInBill : null;

  const cycle = r.jurisdiction.assessmentCycleYears || 0;
  // When a reassessment lands: sale reset ≈ next year; deferred ≈ next scheduled cycle.
  const reassessYear = (targetAdVal != null && targetAdVal > baseAdVal)
    ? (r.resetsOnSale ? 1 : Math.max(1, cycle || 1))
    : null;
  // Phase-in: a county transitional schedule (NYC Class 4 = 5 yrs) wins; otherwise a
  // multi-year cycle ramps the deferred step over the cycle; otherwise it's immediate.
  const phaseInYears = (reassessYear != null && r.jurisdiction.countyPhaseInYears)
    ? r.jurisdiction.countyPhaseInYears
    : (reassessYear != null && !r.resetsOnSale && cycle > 1) ? cycle : 1;

  // ── Abatement burn-off ──────────────────────────────────────────────────────
  // An in-place abatement/PILOT keeps the bill low until expiry, then it steps to the
  // un-abated ("stabilized") figure. Size that figure from the OM-disclosed full bill,
  // else by grossing the abated bill up by the stated abatement %. When sized, this
  // SUPERSEDES the sale-reset target (the un-abated bill already reflects full
  // assessment). When NOT sizeable, we only NOTE it (never fabricate the step).
  const abExpiry = input.abatementExpiryYears != null && input.abatementExpiryYears >= 0
    ? Math.round(input.abatementExpiryYears) : null;
  const pct = num(input.abatementPct);
  const unabatedTotal = num(input.unabatedAnnualTaxes) > curTaxes
    ? num(input.unabatedAnnualTaxes)
    : (pct > 0 && pct < 100 && curTaxes > 0 ? curTaxes / (1 - pct / 100) : 0);
  const unabatedAdVal = unabatedTotal > baseAdVal ? unabatedTotal - navInBill : 0;
  const abActive = abExpiry != null && unabatedAdVal > baseAdVal;
  const abPhaseOut = Math.max(1, Math.round(num(input.abatementPhaseOutYears)) || 1);
  const abRampStart = abActive ? (abExpiry as number) - abPhaseOut + 1 : 0;

  const g = input.growthPctOverride != null ? input.growthPctOverride : levyGrowth(input.state).pct;
  const growth = levyGrowth(input.state);
  const horizon = Math.max(1, Math.min(40, Math.round(num(input.holdYears) || 10)));

  const years: TaxForecastYear[] = [];
  for (let y = 0; y <= horizon; y++) {
    let level = baseAdVal;
    let phase: TaxForecastYear["phase"] = "grown";
    if (abActive) {
      // Abatement track takes precedence when sized.
      if (y < abRampStart) { level = baseAdVal; phase = y === 0 ? "current" : "grown"; }
      else if (y < (abExpiry as number)) {
        const stepsDone = (y - abRampStart) + 1;
        level = baseAdVal + (unabatedAdVal - baseAdVal) * (stepsDone / abPhaseOut);
        phase = "unabating";
      } else { level = unabatedAdVal; phase = y === (abExpiry as number) ? "unabating" : "grown"; }
    } else if (reassessYear == null || y < reassessYear) {
      level = baseAdVal; phase = y === 0 ? "current" : "grown";
    } else if (y < reassessYear + phaseInYears && targetAdVal != null) {
      const stepsDone = (y - reassessYear) + 1;
      level = baseAdVal + (targetAdVal - baseAdVal) * (stepsDone / phaseInYears);
      phase = "reassessing";
    } else if (targetAdVal != null) { level = targetAdVal; phase = "grown"; }
    // Ongoing levy growth on top, then add the flat non-ad-valorem charge back.
    const taxes = Math.round(level * Math.pow(1 + g / 100, y) + navInBill);
    years.push({ year: y, taxes, phase });
  }

  const startTaxes = years[0].taxes;
  const endTaxes = years[years.length - 1].taxes;
  const totalIncreasePct = startTaxes > 0 ? Math.round(((endTaxes - startTaxes) / startTaxes) * 100) : 0;

  // ── Cross-check: the projected STABILIZED bill vs the OM's pro-forma tax line ──
  // The "stabilized" figure is the end-state ad-valorem target at today's rate (the
  // un-abated bill, the reassessed bill, or — if neither steps — the current bill),
  // plus the flat non-ad-valorem charge. A broker who already underwrote the higher
  // tax VALIDATES our forecast; one still carrying in-place taxes understates NOI.
  const stabilized = abActive ? unabatedTotal
    : targetAdVal != null ? targetAdVal + navInBill
    : curTaxes;
  const proforma = num(input.proformaAnnualTaxes);
  let validation: TaxForecastValidation | null = null;
  if (proforma > 0 && stabilized > 0) {
    const ratio = proforma / stabilized;
    if (ratio >= 0.9 && ratio <= 1.1) {
      validation = { kind: "match", message: `Cross-check: the OM's pro-forma tax line (${fmt$(proforma)}/yr) ≈ our stabilized estimate (${fmt$(stabilized)}/yr) — the broker already underwrote the reassessed/un-abated bill, which corroborates the forecast.` };
    } else if (ratio < 0.9 && stabilized - proforma > Math.max(0.05 * curTaxes, 2500)) {
      validation = { kind: "understated", message: `Cross-check: the OM's pro-forma tax line (${fmt$(proforma)}/yr) is below our stabilized estimate (${fmt$(stabilized)}/yr) — it appears to carry roughly in-place taxes and UNDERSTATES the go-forward bill by ~${fmt$(stabilized - proforma)}/yr, so the quoted NOI is likely overstated by about that much.` };
    } else if (ratio > 1.1) {
      validation = { kind: "overstated", message: `Cross-check: the OM's pro-forma tax line (${fmt$(proforma)}/yr) is ABOVE our stabilized estimate (${fmt$(stabilized)}/yr) — conservative, or it folds in charges we net out (special districts) or a different assessment view. Reconcile before crediting the higher figure.` };
    }
  }

  const assumptions: string[] = [
    `Levy/millage growth ${g}%/yr — ${growth.note}`,
    abActive
      ? `Abatement modeled: the bill steps from the in-place ${fmt$(curTaxes)} to the un-abated ${fmt$(unabatedTotal)}${abPhaseOut > 1 ? ` phasing over ${abPhaseOut} yrs to` : ` at`} ~year ${abExpiry}${num(input.unabatedAnnualTaxes) > curTaxes ? " (OM-disclosed un-abated figure)" : ` (grossed up from the ${pct}% abatement)`}.`
      : (input.abatementExpiryYears != null && input.abatementExpiryYears <= horizon
          ? `NOTE: a tax abatement/PILOT expires ~year ${input.abatementExpiryYears}, but the un-abated bill wasn't sized (no disclosed stabilized figure or abatement %) — the step UP is NOT modeled; underwrite it separately.`
          : ""),
    abActive ? "" : (reassessYear != null
      ? (r.resetsOnSale ? "Reassessment modeled in year 1 (sale resets the parcel)." : `Reassessment modeled at the next scheduled cycle (~year ${reassessYear})${phaseInYears > 1 ? `, phasing in over ${phaseInYears} yrs` : ""} — confirm the county's position in its cycle.`)
      : "No upward reassessment modeled (jurisdiction doesn't reset and price isn't above the implied market)."),
    navInBill > 0 ? `${fmt$(navInBill)}/yr of non-ad-valorem charges held flat (they don't reassess or grow with value).` : "",
    validation ? validation.message : "",
  ].filter(Boolean);

  // A corroborating pro-forma match nudges confidence up; a contradiction holds it down.
  let confidence = lower(r.confidence, growth.confidence);
  if (validation?.kind === "match" && confidence === "low") confidence = "medium";

  return {
    years, growth, growthPct: g, reassessYear, phaseInYears,
    abatementStepYear: abActive ? abExpiry : null,
    abatementStepTo: abActive ? Math.round(unabatedTotal) : null,
    startTaxes, endTaxes, totalIncreasePct,
    confidence, validation, assumptions,
  };
}
