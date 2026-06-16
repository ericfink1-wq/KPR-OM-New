import { useState, useMemo } from "react";
import type { Deal } from "../lib/idb";
import { estimateReassessment, resolveJurisdiction, reconcileTaxCapture, assessTaxTriggers } from "../lib/taxReassessment";
import { forecastTaxes } from "../lib/taxForecast";
import { benchmarkEffectiveTaxRate, effectiveTaxRatePct, crossCheckTaxRate } from "../lib/taxRateBenchmark";

// Property-tax reassessment estimator. Answers "if we buy this center, do the
// taxes reset — and by how much?" from the per-state ruleset, grounded in the
// property's ACTUAL current bill (assessed value + taxes). All inputs are
// editable; every figure carries a confidence tier + source.

interface Props { deal: Deal; allDeals?: Deal[]; }

const C = {
  ink: "#383a37", sub: "#6f6a5f", faint: "#a69e91", line: "#efe8da", panel: "#faf7f0", panelBd: "#e7e0d2",
  green: "#3f7a1f", greenBg: "#eef3e6", greenBd: "#b8d49a",
  amber: "#c97a18", amberBg: "#fbf1e4", amberBd: "#e0c9a8",
  red: "#b3261e", redBg: "#fdecec", redBd: "#f3c0c0",
};

const fmt$ = (n: number | null | undefined) => n == null ? "—" : `$${Math.round(n).toLocaleString()}`;
const commaFmt = (v: string): string => {
  const s = v.replace(/,/g, ""); const n = parseFloat(s);
  return !s || isNaN(n) ? v : Math.round(n).toLocaleString("en-US");
};
const parseNum = (v: string): number | null => {
  const s = v.replace(/[^0-9.]/g, ""); const n = parseFloat(s);
  return s && !isNaN(n) && n > 0 ? n : null;
};

const confMeta = (c: "high" | "medium" | "low") =>
  c === "high" ? { t: "HIGH CONFIDENCE", fg: C.green, bg: C.greenBg, bd: C.greenBd }
  : c === "medium" ? { t: "MEDIUM — VERIFY", fg: C.amber, bg: C.amberBg, bd: C.amberBd }
  : { t: "LOW — CONFIRM LOCALLY", fg: C.red, bg: C.redBg, bd: C.redBd };

function NumIn({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: "1 1 150px", minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", color: C.sub, textTransform: "uppercase" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.panelBd}`, borderRadius: 8, background: "#fff", padding: "0 8px" }}>
        <span style={{ color: C.faint, fontSize: 13 }}>$</span>
        <input value={value} onChange={(e) => onChange(commaFmt(e.target.value))} inputMode="numeric"
          style={{ border: "none", outline: "none", padding: "8px 6px", fontSize: 13, color: C.ink, width: "100%", background: "transparent", fontFamily: "'Inter',sans-serif" }} />
      </div>
      {hint && <span style={{ fontSize: 9.5, color: C.faint }}>{hint}</span>}
    </label>
  );
}

export default function TaxReassessmentCard({ deal, allDeals }: Props) {
  const county = deal.marketGeo?.county ?? null;
  const j = resolveJurisdiction(deal.state, county);
  // Reconcile the captured tax figures deterministically — prefer the SUM of the
  // parcel rows (added in code, not by the model) and surface completeness/sanity
  // warnings (missing parcel, market-vs-assessed swap, abatement).
  const check = useMemo(() => reconcileTaxCapture(deal), [deal]);
  const defaultPrice = Number(deal.txnPurchasePrice ?? deal.askingPrice ?? 0) || 0;
  const defaultAssessed = Number(check.assessed ?? 0) || 0;
  const defaultTaxes = Number(check.taxes ?? deal.expenseBreakdown?.realEstateTax ?? 0) || 0;

  const defaultNav = Number(check.nonAdValorem ?? 0) || 0;
  const [price, setPrice] = useState(defaultPrice ? Math.round(defaultPrice).toLocaleString("en-US") : "");
  const [assessed, setAssessed] = useState(defaultAssessed ? Math.round(defaultAssessed).toLocaleString("en-US") : "");
  const [taxes, setTaxes] = useState(defaultTaxes ? Math.round(defaultTaxes).toLocaleString("en-US") : "");
  const [nav, setNav] = useState(defaultNav ? Math.round(defaultNav).toLocaleString("en-US") : "");
  const [ati, setAti] = useState(false);

  const r = useMemo(() => estimateReassessment({
    state: deal.state, county, acquisitionPrice: parseNum(price),
    currentAssessedValue: parseNum(assessed), currentAnnualTaxes: parseNum(taxes),
    nonAdValoremAnnual: parseNum(nav), applyScAtiExemption: ati,
  }), [deal.state, county, price, assessed, taxes, nav, ati]);

  // Multi-year forecast (informational): hold period from the deal, growth from the
  // state's statutory cap (editable), abatement burn-off + pro-forma cross-check.
  const [growthPct, setGrowthPct] = useState("");
  const holdYears = Number(deal.acqHoldPeriod) || (Array.isArray(deal.cashFlowProjection) ? deal.cashFlowProjection.length : 0) || 10;
  const abatementExpiryYears = (() => {
    const exp = deal.taxAbatement?.expiry; if (!exp) return null;
    const m = String(exp).match(/\b(20\d{2})\b/); if (!m) return null;
    return Math.max(0, Number(m[1]) - new Date().getFullYear());
  })();
  // Un-abated ("stabilized") bill — editable so the step-up at expiry can be modeled
  // even when the OM only states the abated figure.
  const defaultUnabated = Number(deal.taxAbatement?.unabatedAnnualTaxes ?? 0) || 0;
  const [unabated, setUnabated] = useState(defaultUnabated ? Math.round(defaultUnabated).toLocaleString("en-US") : "");
  const proformaTax = Number(deal.expenseBreakdown?.realEstateTax ?? 0) || 0;
  const fc = useMemo(() => forecastTaxes({
    state: deal.state, county, acquisitionPrice: parseNum(price),
    currentAssessedValue: parseNum(assessed), currentAnnualTaxes: parseNum(taxes),
    nonAdValoremAnnual: parseNum(nav), applyScAtiExemption: ati,
    holdYears, growthPctOverride: parseNum(growthPct), abatementExpiryYears,
    unabatedAnnualTaxes: parseNum(unabated),
    abatementPct: deal.taxAbatement?.abatementPct ?? null,
    abatementPhaseOutYears: deal.taxAbatement?.phaseOutYears ?? null,
    proformaAnnualTaxes: proformaTax || null,
  }), [deal.state, county, price, assessed, taxes, nav, ati, holdYears, growthPct, abatementExpiryYears, unabated, deal.taxAbatement?.abatementPct, deal.taxAbatement?.phaseOutYears, proformaTax]);

  // Forward-looking triggers beyond the sale reset (exemption loss, ag rollback,
  // renovation, abatement expiry, scheduled law changes).
  const triggers = useMemo(() => assessTaxTriggers({
    state: deal.state, county, acquisitionPrice: parseNum(price),
    currentAnnualTaxes: parseNum(taxes), currentAssessedValue: parseNum(assessed),
    nonAdValoremAnnual: parseNum(nav),
    sellerName: deal.txnSeller ?? deal.seller ?? null,
    sellerTaxExempt: deal.sellerTaxExempt ?? null,
    agOrGreenbeltAssessed: deal.agOrGreenbeltAssessed ?? null,
    taxAbatement: deal.taxAbatement ?? null,
    specialAssessments: deal.specialAssessments ?? null,
    renovationYear: deal.renovationYear ?? null,
    acqStrategy: deal.acqStrategy ?? null,
    notes: deal.notes ?? null,
    holdYears,
  }), [deal.state, county, price, taxes, assessed, nav, deal.txnSeller, deal.seller, deal.sellerTaxExempt, deal.agOrGreenbeltAssessed, deal.taxAbatement, deal.specialAssessments, deal.renovationYear, deal.acqStrategy, deal.notes, holdYears]);

  // Database cross-check: the subject's effective tax rate vs comparable same-state
  // deals in the portfolio (an independent second read on the forecast's tax basis).
  const crossCheck = useMemo(() => {
    const subjectRatePct = effectiveTaxRatePct({
      state: deal.state,
      currentAnnualTaxes: parseNum(taxes),
      currentMarketValue: deal.currentMarketValue ?? null,
      currentAssessedValue: parseNum(assessed),
      nonAdValoremAnnual: parseNum(nav),
    });
    const benchmark = benchmarkEffectiveTaxRate(allDeals ?? [], deal.state, deal.id);
    return crossCheckTaxRate({ ratePct: subjectRatePct }, benchmark);
  }, [allDeals, deal.id, deal.state, deal.currentMarketValue, taxes, assessed, nav]);

  const cm = confMeta(r.confidence);
  // Color the headline by outcome: a real step-up is red; a no-reset / protective
  // outcome is green; everything else neutral amber.
  const stepUp = r.estAnnualStepUp ?? r.estNextCycleStepUp ?? 0;
  const headTone = (r.resetsOnSale && (r.estAnnualStepUp ?? 0) > 0) ? C.red
    : (!r.resetsOnSale && (r.estNextCycleStepUp ?? 0) > 0) ? C.amber
    : C.green;
  const headBg = headTone === C.red ? C.redBg : headTone === C.amber ? C.amberBg : C.greenBg;
  const headBd = headTone === C.red ? C.redBd : headTone === C.amber ? C.amberBd : C.greenBd;

  return (
    <div id="section-tax-reassessment" data-jump="Tax Reassessment" style={{ background: C.panel, border: `1px solid ${C.panelBd}`, borderRadius: 8, padding: "14px 16px", marginTop: 14, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 8, letterSpacing: "0.1em", color: "#958d80", marginBottom: 2 }}>PROPERTY TAX · REASSESSMENT ON SALE</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{j ? j.stateName : (deal.state || "Unknown state")}{county ? ` · ${county.replace(/\s+county$/i, "")} County` : j?.countyDriven ? " · county-administered" : ""}</div>
        </div>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.04em", color: cm.fg, background: cm.bg, border: `1px solid ${cm.bd}`, borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap" }}>{cm.t}</span>
      </div>

      {/* Headline answer */}
      <div style={{ marginTop: 10, background: headBg, border: `1px solid ${headBd}`, borderRadius: 8, padding: "10px 12px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, lineHeight: 1.45 }}>{r.headline}</div>
      </div>

      {/* Capture-completeness / sanity warnings — the fringe-case guards */}
      {check.warnings.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
          {check.warnings.map((w, i) => {
            const t = w.severity === "high" ? { fg: C.red, bg: C.redBg, bd: C.redBd, icon: "⚠" }
              : w.severity === "medium" ? { fg: C.amber, bg: C.amberBg, bd: C.amberBd, icon: "⚠" }
              : { fg: C.sub, bg: "#fff", bd: C.line, icon: "ℹ" };
            return (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 7, padding: "7px 9px" }}>
                <span style={{ color: t.fg, fontWeight: 800, fontSize: 11, flexShrink: 0 }}>{t.icon}</span>
                <span style={{ fontSize: 11.5, color: C.ink, lineHeight: 1.45 }}>{w.message}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Parcel reconciliation — proves we summed every parcel, not just one */}
      {check.parcelCount > 0 && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: C.green }}>
          ✓ {check.parcelCount} parcel{check.parcelCount > 1 ? "s" : ""} captured, summed in code{check.parcelSumTaxes != null ? ` to $${Math.round(check.parcelSumTaxes).toLocaleString()} in taxes` : ""}.
        </div>
      )}

      {/* Step-up math */}
      {(r.estPostSaleTaxes != null || r.estNextCycleTaxes != null) && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            ["Current taxes", fmt$(parseNum(taxes))],
            [r.resetsOnSale ? "Est. post-sale taxes" : "If reassessed to your price", fmt$(r.estPostSaleTaxes ?? r.estNextCycleTaxes)],
            [r.resetsOnSale ? "Annual step-up" : "Deferred step-up (next cycle)", `${stepUp > 0 ? "+" : ""}${fmt$(stepUp)}/yr${r.stepUpPct != null ? ` · ${r.stepUpPct}%` : ""}`],
          ].map(([l, v], i) => (
            <div key={i} style={{ flex: "1 1 120px", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", minWidth: 0 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", color: C.sub, textTransform: "uppercase" }}>{l}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: i === 2 && stepUp > 0 ? (r.resetsOnSale ? C.red : C.amber) : C.ink, lineHeight: 1.15, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Forward-looking triggers beyond the sale reset */}
      {triggers.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, letterSpacing: "0.08em", color: "#958d80", marginBottom: 5 }}>OTHER REASSESSMENT TRIGGERS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {triggers.map((t, i) => {
              const tone = t.severity === "high" ? { fg: C.red, bg: C.redBg, bd: C.redBd }
                : t.severity === "medium" ? { fg: C.amber, bg: C.amberBg, bd: C.amberBd }
                : { fg: C.sub, bg: "#fff", bd: C.line };
              return (
                <div key={i} style={{ background: tone.bg, border: `1px solid ${tone.bd}`, borderRadius: 7, padding: "7px 9px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: tone.fg }}>{t.title}</span>
                    <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.04em", color: tone.fg, textTransform: "uppercase", whiteSpace: "nowrap" }}>{t.severity} · {t.confidence} conf</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.ink, lineHeight: 1.45, marginTop: 2 }}>{t.message}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Multi-year forecast (informational) */}
      {fc && (
        <div style={{ marginTop: 12, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", color: C.sub, textTransform: "uppercase" }}>Multi-year forecast · through year {fc.years.length - 1}</div>
            <div style={{ fontSize: 9.5, color: C.sub }}>confidence: {fc.confidence}</div>
          </div>

          {(() => {
            // VERDICT — the actionable conclusion + a prominent flag when a big
            // increase is coming. stepUp = stabilized (go-forward) bill vs today.
            const stepUp = fc.stabilizedTaxes - fc.startTaxes;
            const stepPct = fc.startTaxes > 0 ? Math.round((stepUp / fc.startTaxes) * 100) : 0;
            const stepYear = fc.reassessYear ?? fc.abatementStepYear;
            const hasStep = stepYear != null && stepUp > 0;
            const major = hasStep && stepPct >= 15;
            const tone = major ? { fg: C.red, bg: C.redBg, bd: C.redBd } : hasStep ? { fg: C.amber, bg: C.amberBg, bd: C.amberBd } : { fg: C.green, bg: C.greenBg, bd: C.greenBd };
            const whenWord = fc.reassessYear != null
              ? (r.resetsOnSale ? "on close (the sale resets it)" : `at the ~year ${stepYear} reassessment${fc.phaseInYears > 1 ? `, phasing in over ${fc.phaseInYears} yrs` : ""}`)
              : `when the abatement burns off ~year ${stepYear}`;
            return (
              <div style={{ marginTop: 8, background: tone.bg, border: `1px solid ${tone.bd}`, borderRadius: 7, padding: "8px 10px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, lineHeight: 1.45 }}>
                  {hasStep
                    ? `${major ? "⚠ Major tax increase ahead" : "Tax step ahead"} — the bill jumps ~+${stepPct}% to ${fmt$(fc.stabilizedTaxes)}/yr ${whenWord}.`
                    : `No reassessment step — you're already assessed at ~market${r.impliedCurrentMarket != null ? ` (implied ~${fmt$(r.impliedCurrentMarket)} ≈ your price)` : ""}, so no sale surprise. Just ~${fc.growthPct}%/yr levy drift.`}
                </div>
                <div style={{ fontSize: 11.5, color: C.sub, marginTop: 3 }}>
                  <b style={{ color: C.ink }}>Model:</b> {hasStep
                    ? `underwrite ${fmt$(fc.stabilizedTaxes)}/yr stabilized (today's $) — NOT the in-place ${fmt$(fc.startTaxes)} — then ~${fc.growthPct}%/yr. By year ${fc.years.length - 1}: ${fmt$(fc.endTaxes)}.`
                    : `${fmt$(fc.startTaxes)}/yr growing ~${fc.growthPct}%/yr → ${fmt$(fc.endTaxes)} by year ${fc.years.length - 1} (+${fc.totalIncreasePct}%).`}
                </div>
              </div>
            );
          })()}

          {fc.validation && (
            <div style={{ marginTop: 8, background: fc.validation.kind === "match" ? C.greenBg : fc.validation.kind === "understated" ? C.redBg : C.amberBg,
              border: `1px solid ${fc.validation.kind === "match" ? C.greenBd : fc.validation.kind === "understated" ? C.redBd : C.amberBd}`,
              borderRadius: 7, padding: "7px 9px", fontSize: 11, color: C.ink, lineHeight: 1.45 }}>
              {fc.validation.kind === "match" ? "✓ " : "⚠ "}{fc.validation.message}
            </div>
          )}

          {/* Year-by-year ramp — shows HOW the bill phases in over the hold. */}
          {(() => {
            const ys = fc.years;
            const maxT = Math.max(...ys.map(y => y.taxes), 1);
            const minT = Math.min(...ys.map(y => y.taxes));
            const colorFor = (p: string) => p === "reassessing" || p === "unabating" ? C.amber : p === "current" ? C.ink : "#bcd3a3";
            return (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 44 }}>
                  {ys.map((y) => {
                    const h = 8 + 34 * ((y.taxes - minT) / ((maxT - minT) || 1));
                    return <div key={y.year} title={`Year ${y.year}: ${fmt$(y.taxes)}/yr${y.phase !== "grown" && y.phase !== "current" ? ` (${y.phase})` : ""}`}
                      style={{ flex: 1, height: h, minWidth: 4, background: colorFor(y.phase), borderRadius: "2px 2px 0 0", opacity: y.phase === "grown" ? 0.85 : 1 }} />;
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 9, color: C.faint }}>
                  <span>Today {fmt$(fc.startTaxes)}</span>
                  {(fc.reassessYear != null || fc.abatementStepYear != null) && <span style={{ color: C.amber, fontWeight: 700 }}>▲ step ~yr {fc.reassessYear ?? fc.abatementStepYear}</span>}
                  <span>Yr {fc.years.length - 1} {fmt$(fc.endTaxes)}</span>
                </div>
              </div>
            );
          })()}
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: C.sub }}>Annual growth</span>
            <input value={growthPct} onChange={e => setGrowthPct(e.target.value)} placeholder={`${fc.growth.pct}`} inputMode="decimal"
              style={{ width: 52, padding: "3px 6px", border: `1px solid ${C.line}`, borderRadius: 5, fontSize: 12, textAlign: "right", background: C.panel, color: C.ink }} />
            <span style={{ fontSize: 11, color: C.sub }}>%/yr · {fc.growth.basis.replace(/_/g, " ")}</span>
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 16, color: C.sub, fontSize: 11, lineHeight: 1.5 }}>
            {fc.assumptions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}

      {/* Database cross-check — effective rate vs comparable same-state portfolio deals */}
      {crossCheck && (
        <div style={{ marginTop: 10, background: crossCheck.verdict === "in_line" ? C.greenBg : crossCheck.verdict === "below" ? C.amberBg : "#fff",
          border: `1px solid ${crossCheck.verdict === "in_line" ? C.greenBd : crossCheck.verdict === "below" ? C.amberBd : C.line}`,
          borderRadius: 8, padding: "9px 11px" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.08em", color: "#958d80", marginBottom: 3 }}>DATABASE CROSS-CHECK · EFFECTIVE TAX RATE</div>
          <div style={{ fontSize: 11.5, color: C.ink, lineHeight: 1.45 }}>{crossCheck.verdict === "in_line" ? "✓ " : "⚠ "}{crossCheck.message}</div>
        </div>
      )}

      {/* Supporting detail */}
      {r.detail.length > 0 && (
        <ul style={{ margin: "10px 0 0", paddingLeft: 16, color: C.sub, fontSize: 12, lineHeight: 1.55 }}>
          {r.detail.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}

      {/* Facts row */}
      {j && (
        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            ["Resets on sale", j.saleTriggersReassessment === "yes" ? "Yes" : j.saleTriggersReassessment === "partial" ? "Partial" : "No"],
            ["Reset basis", j.reassessmentBasis.replace(/_/g, " ")],
            ["Assessment ratio", j.assessmentRatioCommercialPct != null ? `${j.assessmentRatioCommercialPct}% of market` : "varies (local)"],
            ["Cycle", j.assessmentCycleYears === 0 ? "no fixed cycle" : j.assessmentCycleYears === 1 ? "annual" : `every ${j.assessmentCycleYears} yrs`],
            ...(j.annualCapPctCommercial != null ? [["Cap", `${j.annualCapPctCommercial}% / yr (${j.capType === "tax_bill" ? "tax bill" : "assessment"})`]] : []),
          ].map(([l, v], i) => (
            <span key={i} title={String(l)} style={{ fontSize: 10.5, color: C.sub, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 6, padding: "3px 8px" }}>
              <b style={{ color: C.ink }}>{v}</b> · {String(l).toLowerCase()}
            </span>
          ))}
        </div>
      )}

      {/* Inputs */}
      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <NumIn label="Acquisition price" value={price} onChange={setPrice} hint={defaultPrice ? undefined : "from this deal, or type one"} />
        <NumIn label="Current assessed value" value={assessed} onChange={setAssessed} hint={defaultAssessed ? `OM ${deal.assessmentYear || ""}`.trim() : "from the OM tax page"} />
        <NumIn label="Current annual taxes" value={taxes} onChange={setTaxes} hint={defaultTaxes ? undefined : "from the OM tax page"} />
        <NumIn label="Non-ad-valorem $ (in bill)" value={nav} onChange={setNav} hint="CDD/Mello-Roos/BID — netted from the reassessing base" />
      </div>
      {parseNum(assessed) == null || parseNum(taxes) == null ? (
        <div style={{ marginTop: 6, fontSize: 11, color: C.amber }}>Enter the current assessed value and taxes (from the OM's tax page) to size the dollar step-up.</div>
      ) : null}

      {deal.taxAbatement?.present && (
        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <NumIn label="Un-abated (stabilized) taxes" value={unabated} onChange={setUnabated}
            hint={`abatement${deal.taxAbatement.expiry ? ` expires ${deal.taxAbatement.expiry}` : ""} — full bill once it ends, to model the step-up`} />
          {!parseNum(unabated) && !deal.taxAbatement.abatementPct && (
            <div style={{ flex: "2 1 200px", fontSize: 10.5, color: C.amber, paddingBottom: 6 }}>
              Enter the un-abated bill (or capture the abatement %) so the step UP at expiry is modeled, not just noted.
            </div>
          )}
        </div>
      )}

      {j?.scAtiExemption && (
        <label style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: C.sub, cursor: "pointer" }}>
          <input type="checkbox" checked={ati} onChange={(e) => setAti(e.target.checked)} />
          Model the SC 25% ATI exemption (must be applied for)
        </label>
      )}

      {/* Source + caveat */}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.line}`, fontSize: 10.5, color: C.faint, lineHeight: 1.5 }}>
        {j?.caveat && <div style={{ color: C.amber, marginBottom: 3 }}>⚠ {j.caveat}</div>}
        Commercial treatment; a careful estimate grounded in this property's bill — verify with the assessor / counsel for a live deal.
        {j?.sources?.[0] && (
          <> · <a href={j.sources[0].url} target="_blank" rel="noreferrer" style={{ color: C.green }}>{j.sources[0].title}</a></>
        )}
      </div>
    </div>
  );
}
