// Multi-year property-tax FORECAST — projects the bill year-by-year over the hold,
// layering the reassessment event on top of ongoing levy/millage growth. Deterministic
// (no model). Stays informational (card + flags); it does NOT change NOI/cash-flow.
//
// Growth source = each state's STATUTORY cap on annual property-tax growth, which is
// the binding constraint on year-over-year increases (assessment-value caps like CA
// Prop 13 / OR Measure 50 / MI Prop A, or levy caps like MA Prop 2½ / NJ / NY / WA).
// Where no cap exists, a documented fallback (~3%) is used and the confidence drops.
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
  holdYears?: number | null;          // from deal.acqHoldPeriod / cash flow; default 10
  growthPctOverride?: number | null;  // user override of the annual growth rate
  abatementExpiryYears?: number | null; // years until a tax abatement/PILOT expires (note only)
}
export interface TaxForecastYear { year: number; taxes: number; phase: "current" | "reassessing" | "grown"; }
export interface TaxForecast {
  years: TaxForecastYear[];
  growth: LevyGrowth;
  growthPct: number;
  reassessYear: number | null;        // year (offset) the reassessment lands
  phaseInYears: number;
  startTaxes: number;
  endTaxes: number;
  totalIncreasePct: number;
  confidence: Confidence;
  assumptions: string[];
}

const lower = (a: Confidence, b: Confidence): Confidence => {
  const o: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
  return o[a] <= o[b] ? a : b;
};

export function forecastTaxes(input: TaxForecastInput): TaxForecast | null {
  const r = estimateReassessment(input);
  const curTaxes = Number(input.currentAnnualTaxes) || 0;
  if (!curTaxes || !r.jurisdiction) return null;
  const nav = Number(input.nonAdValoremAnnual) || 0;
  const navInBill = nav > 0 && nav < curTaxes ? nav : 0;
  const baseAdVal = curTaxes - navInBill;

  // Post-reassessment ad-valorem level (at today's rate), if the estimator could size it.
  const postTotal = r.estPostSaleTaxes ?? r.estNextCycleTaxes ?? null;
  const targetAdVal = postTotal != null ? postTotal - navInBill : null;

  const cycle = r.jurisdiction.assessmentCycleYears || 0;
  // When the reassessment lands: sale reset ≈ next year; deferred ≈ next scheduled cycle.
  const reassessYear = (targetAdVal != null && targetAdVal > baseAdVal)
    ? (r.resetsOnSale ? 1 : Math.max(1, cycle || 1))
    : null;
  // Some increases phase in (e.g. triennial reassessments ramp over the cycle).
  const phaseInYears = (reassessYear != null && !r.resetsOnSale && cycle > 1) ? cycle : 1;

  const g = input.growthPctOverride != null ? input.growthPctOverride : levyGrowth(input.state).pct;
  const growth = levyGrowth(input.state);
  const horizon = Math.max(1, Math.min(40, Math.round(Number(input.holdYears) || 10)));

  const years: TaxForecastYear[] = [];
  for (let y = 0; y <= horizon; y++) {
    // Ad-valorem LEVEL for year y (today's-rate dollars): base, ramping to target.
    let level = baseAdVal;
    let phase: TaxForecastYear["phase"] = "grown";
    if (reassessYear == null || y < reassessYear) { level = baseAdVal; phase = y === 0 ? "current" : "grown"; }
    else if (y < reassessYear + phaseInYears && targetAdVal != null) {
      const stepsDone = (y - reassessYear) + 1;
      level = baseAdVal + (targetAdVal - baseAdVal) * (stepsDone / phaseInYears);
      phase = "reassessing";
    } else if (targetAdVal != null) { level = targetAdVal; phase = "grown"; }
    // Apply ongoing levy growth on top, then add the flat non-ad-valorem charge.
    const taxes = Math.round(level * Math.pow(1 + g / 100, y) + navInBill);
    years.push({ year: y, taxes, phase });
  }

  const startTaxes = years[0].taxes;
  const endTaxes = years[years.length - 1].taxes;
  const totalIncreasePct = startTaxes > 0 ? Math.round(((endTaxes - startTaxes) / startTaxes) * 100) : 0;

  const assumptions: string[] = [
    `Levy/millage growth ${g}%/yr — ${growth.note}`,
    reassessYear != null
      ? (r.resetsOnSale ? "Reassessment modeled in year 1 (sale resets the parcel)." : `Reassessment modeled at the next scheduled cycle (~year ${reassessYear})${phaseInYears > 1 ? `, phasing in over ${phaseInYears} yrs` : ""} — confirm the county's position in its cycle.`)
      : "No upward reassessment modeled (jurisdiction doesn't reset and price isn't above the implied market).",
    navInBill > 0 ? `$${navInBill.toLocaleString()}/yr of non-ad-valorem charges held flat (they don't reassess or grow with value).` : "",
    input.abatementExpiryYears != null && input.abatementExpiryYears <= horizon
      ? `NOTE: a tax abatement/PILOT expires ~year ${input.abatementExpiryYears} — the bill steps to UN-abated taxes then (not modeled; underwrite separately).`
      : "",
  ].filter(Boolean);

  return {
    years, growth, growthPct: g, reassessYear, phaseInYears,
    startTaxes, endTaxes, totalIncreasePct,
    confidence: lower(r.confidence, growth.confidence),
    assumptions,
  };
}
