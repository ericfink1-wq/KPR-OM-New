import { useState, useEffect } from "react";
import type { Deal, MyUnderwritingInputs } from "../lib/idb";

interface Props {
  deal: Deal;
  onUpdate: (id: string, patch: Partial<Deal>) => void;
}

const BLUE = "#2563eb";
const BLUE_BG = "#eff6ff";
const BLUE_BORDER = "#bfdbfe";

function n(v: unknown): number | null {
  if (v == null || v === "") return null;
  const x = Number(v);
  return isNaN(x) ? null : x;
}

function fmt$(val: number | null, decimals = 0): string {
  if (val == null) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  return "$" + val.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(val: number | null, decimals = 2): string {
  if (val == null) return "—";
  return val.toFixed(decimals) + "%";
}

function deltaColor(delta: number | null): string {
  if (delta == null) return "#a69e91";
  if (delta > 0.005) return "#0f9d63";
  if (delta < -0.005) return "#dc2626";
  return "#383a37";
}

function DeltaCell({ delta, fmt }: { delta: number | null; fmt: (v: number) => string }) {
  if (delta == null) return <td style={tdRight}>—</td>;
  const color = deltaColor(delta);
  const sign = delta > 0.005 ? "+" : "";
  return (
    <td style={{ ...tdRight, color, fontWeight: 600 }}>
      {sign}{fmt(delta)}
    </td>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: "#6f6a5f", whiteSpace: "nowrap", paddingRight: 8,
};
const inputStyle: React.CSSProperties = {
  fontSize: 12, border: "1px solid #d8d0c4", borderRadius: 5, padding: "5px 8px",
  fontFamily: "'Inter',sans-serif", color: "#383a37", background: "#fff",
  width: "100%", boxSizing: "border-box",
};
const tdRight: React.CSSProperties = {
  textAlign: "right", padding: "7px 10px", fontSize: 12, color: "#383a37", whiteSpace: "nowrap",
};
const tdLabel: React.CSSProperties = {
  textAlign: "left", padding: "7px 10px", fontSize: 11, color: "#a69e91",
  fontWeight: 600, letterSpacing: "0.04em", whiteSpace: "nowrap",
};

function InputRow({
  label, value, onChange, onBlur, suffix, prefix, placeholder, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  suffix?: string;
  prefix?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ fontSize: 10, color: "#7d766a", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>
        {label}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        {prefix && <span style={{ fontSize: 12, color: "#6f6a5f", flexShrink: 0 }}>{prefix}</span>}
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          style={inputStyle}
          onFocus={e => (e.target.style.borderColor = BLUE)}
          onBlurCapture={e => (e.target.style.borderColor = "#d8d0c4")}
        />
        {suffix && <span style={{ fontSize: 12, color: "#6f6a5f", flexShrink: 0 }}>{suffix}</span>}
      </div>
      {hint && <div style={{ fontSize: 10, color: "#a69e91" }}>{hint}</div>}
    </div>
  );
}

export default function MyUnderwritingPanel({ deal: d, onUpdate }: Props) {
  const saved = d.myUnderwriting ?? {};

  const [open, setOpen]               = useState(() => Object.values(saved).some(v => v != null));
  const [myNoi, setMyNoi]             = useState(saved.myNoi         != null ? String(saved.myNoi)         : "");
  const [vacancy, setVacancy]         = useState(saved.vacancyPct    != null ? String(saved.vacancyPct)    : "");
  const [mgmt, setMgmt]               = useState(saved.mgmtFeePct    != null ? String(saved.mgmtFeePct)    : "");
  const [reserves, setReserves]       = useState(saved.reservesPerSF != null ? String(saved.reservesPerSF) : "");
  const [mktRent, setMktRent]         = useState(saved.marketRentPSF != null ? String(saved.marketRentPSF) : "");
  const [targetCap, setTargetCap]     = useState(saved.targetCapRate != null ? String(saved.targetCapRate) : "");

  useEffect(() => {
    const u = d.myUnderwriting ?? {};
    setMyNoi    (u.myNoi         != null ? String(u.myNoi)         : "");
    setVacancy  (u.vacancyPct    != null ? String(u.vacancyPct)    : "");
    setMgmt     (u.mgmtFeePct    != null ? String(u.mgmtFeePct)    : "");
    setReserves (u.reservesPerSF != null ? String(u.reservesPerSF) : "");
    setMktRent  (u.marketRentPSF != null ? String(u.marketRentPSF) : "");
    setTargetCap(u.targetCapRate != null ? String(u.targetCapRate) : "");
    setOpen(Object.values(u).some(v => v != null));
  }, [d.id]);

  const persist = () => {
    const patch: MyUnderwritingInputs = {
      myNoi:         n(myNoi),
      vacancyPct:    n(vacancy),
      mgmtFeePct:    n(mgmt),
      reservesPerSF: n(reserves),
      marketRentPSF: n(mktRent),
      targetCapRate: n(targetCap),
    };
    onUpdate(d.id, { myUnderwriting: patch });
  };

  // ── OM figures ──────────────────────────────────────────────────────────
  const omGPR    = n(d.grossPotentialRent);
  const omEGI    = n(d.effectiveGrossIncome);
  const omOpex   = n(d.operatingExpenses);
  const omNoi    = n(d.noi);
  const omCap    = n(d.capRate);          // %
  const omPrice  = n(d.askingPrice);
  const omTotalSF = n(d.totalSF);
  const omWtAvgRent = n(d.weightedAvgRentPSF);

  // ── Live computation ────────────────────────────────────────────────────
  const uwVacancy  = n(vacancy);
  const uwMgmt     = n(mgmt);
  const uwReserves = n(reserves);
  const uwMktRent  = n(mktRent);
  const uwTarget   = n(targetCap);
  const uwMyNoi    = n(myNoi);

  // EGI: apply user vacancy to GPR if available
  const computedEGI: number | null =
    omGPR != null && uwVacancy != null ? omGPR * (1 - uwVacancy / 100)
    : omGPR ?? omEGI;

  const mgmtAmt:  number = computedEGI != null && uwMgmt     != null ? computedEGI * (uwMgmt / 100)     : 0;
  const resAmt:   number = omTotalSF   != null && uwReserves != null ? omTotalSF   * uwReserves         : 0;

  // Final NOI: direct override wins; else component-based
  const finalNoi: number | null =
    uwMyNoi != null ? uwMyNoi
    : computedEGI != null
      ? computedEGI - (omOpex ?? 0) - mgmtAmt - resAmt
      : null;

  // Is the NOI from components (not direct)?
  const noiIsComputed = uwMyNoi == null && finalNoi != null;

  // Derived comparisons (only if OM has corresponding anchor)
  const myCapRate: number | null    = finalNoi != null && omPrice != null && omPrice > 0
    ? (finalNoi / omPrice) * 100 : null;

  const myValueAtOmCap: number | null = finalNoi != null && omCap != null && omCap > 0
    ? finalNoi / (omCap / 100) : null;

  const myValueAtTarget: number | null = finalNoi != null && uwTarget != null && uwTarget > 0
    ? finalNoi / (uwTarget / 100) : null;

  const noiDelta:      number | null = finalNoi != null && omNoi  != null ? finalNoi - omNoi  : null;
  const capRateDelta:  number | null = myCapRate != null && omCap  != null ? myCapRate - omCap : null;
  const valueDelta:    number | null = myValueAtOmCap != null && omPrice != null ? myValueAtOmCap - omPrice : null;

  const rentGap: number | null = uwMktRent != null && omWtAvgRent != null && omWtAvgRent > 0
    ? ((uwMktRent - omWtAvgRent) / omWtAvgRent) * 100 : null;

  const hasAnyInput = [myNoi, vacancy, mgmt, reserves, mktRent, targetCap].some(v => v !== "");
  const hasComparison = finalNoi != null && (omNoi != null || omCap != null || omPrice != null);

  // Placeholder hints
  const vacancyHint = omGPR ? (uwVacancy != null ? `EGI: ${fmt$(computedEGI)}` : `GPR: ${fmt$(omGPR)}`) : undefined;
  const mgmtHint    = computedEGI != null && uwMgmt != null ? `Fee: ${fmt$(mgmtAmt)}` : undefined;
  const resHint     = omTotalSF != null && uwReserves != null ? `Total: ${fmt$(resAmt)}` : undefined;
  const rentHint    = omWtAvgRent != null ? `In-place wtavg: $${omWtAvgRent.toFixed(2)}/SF` : undefined;
  const noiComputedHint = noiIsComputed ? `Computed: ${fmt$(finalNoi)}` : undefined;

  const headerHasData = hasAnyInput || hasComparison;

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Header toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%",
          background: open ? BLUE_BG : "#fff",
          border: `1px solid ${open ? BLUE_BORDER : "#e7e0d2"}`,
          borderRadius: open ? "12px 12px 0 0" : 12,
          padding: "11px 16px", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 700, color: BLUE }}>
          ✎ My Underwriting
        </span>
        {!open && headerHasData && (
          <span style={{ fontSize: 10, color: "#7d766a", fontFamily: "'Inter',sans-serif" }}>
            {finalNoi != null ? `My NOI: ${fmt$(finalNoi)}` : ""}
            {myCapRate != null ? `  ·  My Cap: ${fmtPct(myCapRate)}` : ""}
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#a69e91", fontFamily: "'Inter',sans-serif" }}>
          {open ? "▴ HIDE" : "▾ EDIT"}
        </span>
      </button>

      {open && (
        <div style={{
          background: BLUE_BG,
          border: `1px solid ${BLUE_BORDER}`,
          borderTop: "none",
          borderRadius: "0 0 12px 12px",
          padding: "16px 18px",
        }}>

          {/* Input grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "14px 18px", marginBottom: 18 }}>
            <InputRow
              label="My NOI"
              value={myNoi}
              onChange={setMyNoi}
              onBlur={persist}
              prefix="$"
              placeholder={noiIsComputed ? fmt$(finalNoi) : "e.g. 850,000"}
              hint={myNoi === "" && noiComputedHint ? `Auto-computed: ${fmt$(finalNoi)}` : undefined}
            />
            <InputRow
              label="Vacancy"
              value={vacancy}
              onChange={setVacancy}
              onBlur={persist}
              suffix="%"
              placeholder={d.occupancy ? `${(100 - Number(d.occupancy)).toFixed(1)}` : "e.g. 5.0"}
              hint={vacancyHint}
            />
            <InputRow
              label="Mgmt Fee"
              value={mgmt}
              onChange={setMgmt}
              onBlur={persist}
              suffix="% of EGI"
              placeholder="e.g. 3.0"
              hint={mgmtHint}
            />
            <InputRow
              label="Reserves"
              value={reserves}
              onChange={setReserves}
              onBlur={persist}
              prefix="$"
              suffix="/SF/yr"
              placeholder="e.g. 0.25"
              hint={resHint}
            />
            <InputRow
              label="Market Rent"
              value={mktRent}
              onChange={setMktRent}
              onBlur={persist}
              prefix="$"
              suffix="/SF"
              placeholder="e.g. 18.00"
              hint={rentHint}
            />
            <InputRow
              label="Target Cap Rate"
              value={targetCap}
              onChange={setTargetCap}
              onBlur={persist}
              suffix="%"
              placeholder="e.g. 6.50"
              hint={myValueAtTarget != null ? `Value: ${fmt$(myValueAtTarget)}` : undefined}
            />
          </div>

          {/* Source note */}
          {uwMyNoi == null && (computedEGI != null || finalNoi == null) && (
            <div style={{ fontSize: 10, color: "#4a7cc9", marginBottom: 14, lineHeight: 1.5 }}>
              {finalNoi != null
                ? `My NOI is auto-computed from ${omGPR ? "GPR" : "EGI"}${uwVacancy != null ? ` @ ${uwVacancy}% vacancy` : ""}${uwMgmt != null ? `, ${uwMgmt}% mgmt` : ""}${uwReserves != null ? `, $${uwReserves}/SF reserves` : ""}${omOpex ? ", OM opex" : ""}. Enter My NOI above to override.`
                : "Enter My NOI directly, or fill Vacancy + Mgmt Fee + Reserves to compute it automatically (requires OM income data)."}
            </div>
          )}

          {/* Comparison table */}
          {hasComparison && (
            <div style={{ background: "#fff", border: "1px solid #dbeafe", borderRadius: 9, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#eff6ff", borderBottom: "1px solid #dbeafe" }}>
                    <th style={{ ...tdLabel, color: "#3b82f6", paddingLeft: 12 }}></th>
                    <th style={{ ...tdRight, color: BLUE, fontWeight: 700, fontSize: 10, letterSpacing: "0.06em" }}>MY UW</th>
                    <th style={{ ...tdRight, color: "#a69e91", fontWeight: 700, fontSize: 10, letterSpacing: "0.06em" }}>OM STATED</th>
                    <th style={{ ...tdRight, color: "#6f6a5f", fontWeight: 700, fontSize: 10, letterSpacing: "0.06em", paddingRight: 12 }}>DELTA</th>
                  </tr>
                </thead>
                <tbody>
                  {/* NOI row */}
                  {(finalNoi != null || omNoi != null) && (
                    <tr style={{ borderBottom: "1px solid #f1eadc" }}>
                      <td style={{ ...tdLabel, paddingLeft: 12 }}>NOI</td>
                      <td style={{ ...tdRight, color: BLUE, fontWeight: 600 }}>{fmt$(finalNoi)}</td>
                      <td style={{ ...tdRight }}>{fmt$(omNoi)}</td>
                      <DeltaCell delta={noiDelta} fmt={v => {
                        const pct = omNoi ? (v / omNoi * 100) : null;
                        return `${fmt$(v)} ${pct != null ? `(${v > 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}`;
                      }}/>
                    </tr>
                  )}

                  {/* Cap rate at asking price */}
                  {(myCapRate != null || omCap != null) && (
                    <tr style={{ borderBottom: "1px solid #f1eadc" }}>
                      <td style={{ ...tdLabel, paddingLeft: 12 }}>
                        Cap Rate
                        {omPrice && <div style={{ fontSize: 9, color: "#c4bba7", fontWeight: 400 }}>at asking price</div>}
                      </td>
                      <td style={{ ...tdRight, color: BLUE, fontWeight: 600 }}>{fmtPct(myCapRate)}</td>
                      <td style={{ ...tdRight }}>{fmtPct(omCap)}</td>
                      <DeltaCell delta={capRateDelta} fmt={v => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`}/>
                    </tr>
                  )}

                  {/* Implied value at OM cap rate */}
                  {(myValueAtOmCap != null || omPrice != null) && (
                    <tr style={{ borderBottom: myValueAtTarget != null ? "1px solid #f1eadc" : "none" }}>
                      <td style={{ ...tdLabel, paddingLeft: 12 }}>
                        Implied Value
                        {omCap && <div style={{ fontSize: 9, color: "#c4bba7", fontWeight: 400 }}>at OM cap ({omCap}%)</div>}
                      </td>
                      <td style={{ ...tdRight, color: BLUE, fontWeight: 600 }}>{fmt$(myValueAtOmCap)}</td>
                      <td style={{ ...tdRight }}>{fmt$(omPrice)}</td>
                      <DeltaCell delta={valueDelta} fmt={v => {
                        const pct = omPrice ? (v / omPrice * 100) : null;
                        return `${fmt$(v)} ${pct != null ? `(${v > 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}`;
                      }}/>
                    </tr>
                  )}

                  {/* Value at target cap rate */}
                  {myValueAtTarget != null && (
                    <tr>
                      <td style={{ ...tdLabel, paddingLeft: 12 }}>
                        Value at Target
                        <div style={{ fontSize: 9, color: "#c4bba7", fontWeight: 400 }}>{uwTarget}% cap</div>
                      </td>
                      <td style={{ ...tdRight, color: BLUE, fontWeight: 600 }}>{fmt$(myValueAtTarget)}</td>
                      <td style={{ ...tdRight }}>—</td>
                      <DeltaCell delta={omPrice != null ? myValueAtTarget - omPrice : null} fmt={v => {
                        const pct = omPrice ? (v / omPrice * 100) : null;
                        return `${fmt$(v)} ${pct != null ? `(${v > 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}`;
                      }}/>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Market rent comparison */}
          {uwMktRent != null && omWtAvgRent != null && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "#4a7cc9", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600 }}>Market rent vs. in-place:</span>
              <span>${uwMktRent.toFixed(2)}/SF market</span>
              <span style={{ color: "#c4bba7" }}>vs.</span>
              <span>${omWtAvgRent.toFixed(2)}/SF wtavg in-place</span>
              {rentGap != null && (
                <span style={{ fontWeight: 700, color: deltaColor(rentGap) }}>
                  ({rentGap > 0 ? "+" : ""}{rentGap.toFixed(1)}% gap)
                </span>
              )}
            </div>
          )}

          {/* Empty state */}
          {!hasAnyInput && (
            <div style={{ fontSize: 11, color: "#93acd4", textAlign: "center", padding: "8px 0" }}>
              Fill in any field above to begin. All inputs are per-deal and never touch the OM figures.
            </div>
          )}

        </div>
      )}
    </div>
  );
}
