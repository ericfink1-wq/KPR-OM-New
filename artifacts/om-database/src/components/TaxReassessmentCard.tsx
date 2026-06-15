import { useState, useMemo } from "react";
import type { Deal } from "../lib/idb";
import { estimateReassessment, getTaxJurisdiction } from "../lib/taxReassessment";

// Property-tax reassessment estimator. Answers "if we buy this center, do the
// taxes reset — and by how much?" from the per-state ruleset, grounded in the
// property's ACTUAL current bill (assessed value + taxes). All inputs are
// editable; every figure carries a confidence tier + source.

interface Props { deal: Deal; }

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

export default function TaxReassessmentCard({ deal }: Props) {
  const j = getTaxJurisdiction(deal.state);
  const defaultPrice = Number(deal.txnPurchasePrice ?? deal.askingPrice ?? 0) || 0;
  const defaultAssessed = Number(deal.currentAssessedValue ?? 0) || 0;
  const defaultTaxes = Number(deal.currentAnnualTaxes ?? deal.expenseBreakdown?.realEstateTax ?? 0) || 0;

  const [price, setPrice] = useState(defaultPrice ? Math.round(defaultPrice).toLocaleString("en-US") : "");
  const [assessed, setAssessed] = useState(defaultAssessed ? Math.round(defaultAssessed).toLocaleString("en-US") : "");
  const [taxes, setTaxes] = useState(defaultTaxes ? Math.round(defaultTaxes).toLocaleString("en-US") : "");
  const [ati, setAti] = useState(false);

  const r = useMemo(() => estimateReassessment({
    state: deal.state, acquisitionPrice: parseNum(price),
    currentAssessedValue: parseNum(assessed), currentAnnualTaxes: parseNum(taxes), applyScAtiExemption: ati,
  }), [deal.state, price, assessed, taxes, ati]);

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
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{j ? j.stateName : (deal.state || "Unknown state")}{j?.countyDriven ? " · county-administered" : ""}</div>
        </div>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.04em", color: cm.fg, background: cm.bg, border: `1px solid ${cm.bd}`, borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap" }}>{cm.t}</span>
      </div>

      {/* Headline answer */}
      <div style={{ marginTop: 10, background: headBg, border: `1px solid ${headBd}`, borderRadius: 8, padding: "10px 12px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, lineHeight: 1.45 }}>{r.headline}</div>
      </div>

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
      </div>
      {parseNum(assessed) == null || parseNum(taxes) == null ? (
        <div style={{ marginTop: 6, fontSize: 11, color: C.amber }}>Enter the current assessed value and taxes (from the OM's tax page) to size the dollar step-up.</div>
      ) : null}

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
