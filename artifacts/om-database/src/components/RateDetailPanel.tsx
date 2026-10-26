import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, Brush, CartesianGrid, Cell, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Deal } from "../lib/idb";
import type { RatesPayload, IndexHistoryView } from "../lib/api";
import { apiRateHistory } from "../lib/api";
import { fmtMoney } from "../lib/money";
import { termSofrSpot, type DebtRow, type SwapRow } from "../lib/assetMgmt";
import {
  termsFromDebtRow, termsFromSwap, rateBuild, historySeries, thin, rateMarkers, forwardView, compareInterest, fmtShortDate, fmtPeriod,
  TERM_PROXY_NOTE, GAP_FLAG_MIN, type RateTerms, type Marker, type IndexPoint,
} from "../lib/rateDetail";
import { useIsMobile } from "../hooks/use-mobile";

// RATE DETAIL PANEL (Eric, 10/26/26) — opened by clicking a Rate / All-in / swap rate cell in
// Asset Mgmt → Debt, or "Rate detail" on an owned deal's Financing tab. Four parts: how the rate
// is built (with sources on hover), the index / unhedged / effective history, the forward view
// to maturity (indicative), and Datex actual vs expected interest. Pure math in lib/rateDetail.ts.

const C = { ink: "#232422", gray: "#676767", line: "#ecebe6", page: "#FAF9F5", index: "#8a8983", unhedged: "#b3711a", effective: "#3e8a2f", red: "#b3403f", blue: "#2c6e9b", charcoal: "#383A37" };
const MARK_COLOR: Record<Marker["kind"], string> = { closing: C.charcoal, "swap-start": C.blue, "swap-end": C.blue, "cap-end": "#7a4fa3", "ext-window": C.unhedged, extension: C.unhedged, maturity: C.red };
const DAY = 86_400_000;
const head: React.CSSProperties = { fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 11.5, letterSpacing: ".1em", textTransform: "uppercase", color: C.charcoal, margin: "18px 0 8px" };
const note: React.CSSProperties = { fontSize: 11.5, color: C.gray, lineHeight: 1.5, marginTop: 6 };
const pill = (on: boolean): React.CSSProperties => ({ background: on ? C.charcoal : "#fff", color: on ? "#fff" : C.charcoal, border: `1px solid ${on ? C.charcoal : "#d9d8d2"}`, borderRadius: 16, padding: "5px 11px", minHeight: 32, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Montserrat',sans-serif" });
const p3 = (v: unknown) => (typeof v === "number" ? `${v.toFixed(3)}%` : "—");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateTick = (t: number, spanDays: number) => { const d = new Date(t); return spanDays > 1100 ? `${d.getUTCFullYear()}` : spanDays > 75 ? `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
/** Evenly spaced ticks on whole months/years so labels never repeat. */
const timeTicks = (t0: number, t1: number, max: number): number[] => {
  if (!(t1 > t0)) return [];
  const span = (t1 - t0) / DAY;
  const stepM = span > 1100 ? 12 * Math.max(1, Math.ceil(span / 365 / max)) : Math.max(1, Math.ceil(span / 30.4 / max));
  const out: number[] = [];
  if (span <= 75) { const step = Math.max(1, Math.ceil(span / max)); for (let x = t0; x <= t1; x += step * DAY) out.push(x); return out; }
  const d0 = new Date(t0); let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1;
  if (stepM >= 12) { y += 1; m = 0; }
  for (let k = 0; k < 400; k++) { const x = Date.UTC(y, m, 1); if (x > t1) break; if (x >= t0) out.push(x); m += stepM; while (m >= 12) { m -= 12; y++; } }
  return out;
};

export type RateDetailTarget = { kind: "loan"; row: DebtRow } | { kind: "swap"; swap: SwapRow };

export default function RateDetailPanel({ target, allRows, deal, rates, onClose }: { target: RateDetailTarget; allRows: DebtRow[]; deal: Deal | undefined; rates: RatesPayload | null; onClose: () => void }) {
  const isMobile = useIsMobile();
  const today = useMemo(() => new Date(), []);
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onClose]);
  // A swap linked to a loan opens that loan's panel; an unlinked swap is priced on its own.
  const { terms, row } = useMemo(() => {
    if (target.kind === "loan") return { terms: termsFromDebtRow(target.row), row: target.row };
    const owner = allRows.find(r => r.swaps.some(w => w.record.id === target.swap.record.id));
    return owner ? { terms: termsFromDebtRow(owner), row: owner } : { terms: termsFromSwap(target.swap), row: null };
  }, [target, allRows]);
  const [hist, setHist] = useState<IndexHistoryView[] | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  useEffect(() => { let on = true; apiRateHistory().then(h => on && setHist(h)).catch(e => on && setHistErr(e instanceof Error ? e.message : "Couldn't load rate history")); return () => { on = false; }; }, []);
  const sofr: IndexPoint[] = useMemo(() => hist?.find(h => h.series === "SOFR")?.points ?? [], [hist]);
  const tsy: IndexPoint[] = useMemo(() => hist?.find(h => h.series === "DGS10")?.points ?? [], [hist]);
  const build = useMemo(() => rateBuild(terms, rates, today), [terms, rates, today]);
  const title = `${terms.property}${terms.loanLabel ? ` · ${terms.loanLabel}` : ""}`;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9600, background: "rgba(35,36,34,.32)" }} />
      <aside role="dialog" aria-label={`Rate detail — ${title}`} style={{ position: "fixed", zIndex: 9601, top: 0, right: 0, bottom: 0, width: "min(880px, 100%)", overflowY: "auto", overflowX: "hidden", background: "#fff", padding: isMobile ? "14px 14px 32px" : "18px 22px 32px", boxShadow: "-12px 0 40px rgba(35,36,34,.22)", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'Montserrat',sans-serif", fontSize: 10.5, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: C.gray }}>Rate detail</div>
            <div style={{ fontFamily: "'Lora',serif", fontSize: 20, fontWeight: 600, color: C.ink, overflowWrap: "anywhere" }}>{title}</div>
            <div style={{ fontSize: 12.5, color: C.gray, marginTop: 2 }}>{[terms.lender, row?.balance != null ? fmtMoney(row.balance) : null, terms.maturity ? `matures ${fmtShortDate(terms.maturity)}` : null].filter(Boolean).join(" · ") || (target.kind === "swap" ? "Swap with no linked loan — priced as the hedge alone" : "")}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ ...pill(false), flex: "none" }}>✕</button>
        </div>

        <div style={head}>1 · Rate build</div>
        <BuildTable lines={build.lines} />
        {build.after.length > 0 && <div style={{ background: "#fff7ea", border: "1px solid #f1dfbf", borderRadius: 10, padding: "9px 12px", marginTop: 10, fontSize: 13, color: C.ink, lineHeight: 1.5 }}>
          <b style={{ fontSize: 12 }}>When the hedge ends</b>{build.after.map((x, i) => <div key={i}>{x}</div>)}
        </div>}
        <div style={note}>Hover (or tap) a figure for its source document. "Not documented" = not on the loan record — nothing is assumed in its place.</div>

        <div style={head}>2 · History</div>
        {histErr ? <div style={note}>{histErr}</div> : !hist ? <div className="kpr-skel" style={{ height: 240, borderRadius: 10 }} aria-busy="true" /> :
          <HistoryChart terms={terms} sofr={sofr} tsy={tsy} rates={rates} today={today} isMobile={isMobile} sofrAsOf={hist.find(h => h.series === "SOFR")?.asOf ?? null} />}

        <div style={head}>3 · Forward view <span style={{ fontWeight: 600, color: C.gray, letterSpacing: 0, textTransform: "none" }}>(indicative)</span></div>
        <ForwardSection terms={terms} rates={rates} today={today} isMobile={isMobile} />

        {deal?.status === "Owned" && <>
          <div style={head}>4 · Actual vs expected interest</div>
          <InterestSection deal={deal} allRows={allRows} terms={terms} sofr={sofr} histReady={!!hist} isMobile={isMobile} />
        </>}
      </aside>
    </>
  );
}

function BuildTable({ lines }: { lines: ReturnType<typeof rateBuild>["lines"] }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden" }}>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 12px", borderTop: i ? `1px solid #f3f2ee` : "none", background: l.sub ? C.page : "#fff" }}>
          <span style={{ fontSize: 12.5, color: C.gray, paddingLeft: l.sub ? 12 : 0, flex: "none", maxWidth: "45%" }}>{l.label}</span>
          <span title={l.source ?? undefined} style={{ fontSize: 13.5, color: l.missing ? "#a3a19a" : C.ink, fontStyle: l.missing ? "italic" : "normal", textAlign: "right", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere", minWidth: 0, textDecoration: l.source ? "underline dotted #b9b7b0" : "none", textUnderlineOffset: 3 }}>{l.value}</span>
        </div>
      ))}
    </div>
  );
}

type Range = "1M" | "6M" | "1Y" | "close" | "all";
function HistoryChart({ terms, sofr, tsy, rates, today, isMobile, sofrAsOf }: { terms: RateTerms; sofr: IndexPoint[]; tsy: IndexPoint[]; rates: RatesPayload | null; today: Date; isMobile: boolean; sofrAsOf: string | null }) {
  const todayIso = today.toISOString().slice(0, 10);
  const fixed = terms.rateClass === "fixed";
  const spot = termSofrSpot(rates);
  const all = useMemo(() => historySeries(terms, fixed ? tsy : sofr, { to: todayIso, termSpot: fixed ? null : spot }), [terms, fixed, tsy, sofr, todayIso, spot]);
  const [range, setRange] = useState<Range>(terms.closing ? "close" : "1Y");
  const from = range === "all" ? null : range === "close" ? terms.closing : new Date(today.getTime() - ({ "1M": 31, "6M": 183, "1Y": 366 }[range]) * DAY).toISOString().slice(0, 10);
  const data = useMemo(() => thin(from ? all.filter(r => r.date >= from) : all, isMobile ? 500 : 900), [all, from, isMobile]);
  const markers = rateMarkers(terms);
  const spanDays = data.length ? (data[data.length - 1].t - data[0].t) / DAY : 0;
  const lastIdx = [...data].reverse().find(r => r.index != null);
  if (!all.length) return <div style={note}>No index history loaded{sofrAsOf ? "" : " yet"}.</div>;
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {(["1M", "6M", "1Y", "close", "all"] as Range[]).map(r => (
          <button key={r} style={{ ...pill(range === r), opacity: r === "close" && !terms.closing ? 0.4 : 1 }} disabled={r === "close" && !terms.closing} onClick={() => setRange(r)}
            title={r === "close" && !terms.closing ? "Loan closing date not documented" : undefined}>{r === "close" ? "Since closing" : r === "all" ? "All" : r}</button>
        ))}
      </div>
      <Legend items={[[fixed ? "10-yr Treasury (reference)" : terms.daily ? "Daily SOFR" : "Daily SOFR (proxy for 1M Term)", C.index, false], ...(fixed ? [] : [["Unhedged: index + spread" + (terms.floorPct != null ? " (floored)" : ""), C.unhedged, true] as [string, string, boolean]]), ["Rate actually paid", C.effective, false]]} />
      <div style={{ width: "100%", height: isMobile ? 230 : 280 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 14, right: 8, left: isMobile ? -6 : 0, bottom: 0 }}>
            <CartesianGrid stroke="#f1f0ec" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={data.length ? timeTicks(data[0].t, data[data.length - 1].t, isMobile ? 4 : 8) : undefined} tickFormatter={t => dateTick(t, spanDays)} tick={{ fontSize: 11, fill: C.gray }} />
            <YAxis tick={{ fontSize: 11, fill: C.gray }} tickFormatter={v => `${Number(v).toFixed(1)}%`} domain={["auto", "auto"]} width={46} />
            <Tooltip content={<HistTip />} />
            {markers.filter(m => m.kind === "ext-window" && m.endDate).map((m, i) => <ReferenceArea key={`a${i}`} x1={Date.parse(m.date)} x2={Date.parse(m.endDate!)} fill={C.unhedged} fillOpacity={0.12} ifOverflow="hidden" />)}
            {markers.map((m, i) => <ReferenceLine key={i} x={Date.parse(m.date + "T00:00:00Z")} stroke={MARK_COLOR[m.kind]} strokeDasharray="3 3" ifOverflow="hidden" label={isMobile ? undefined : { value: m.label, position: "insideTopLeft", fontSize: 10, fill: MARK_COLOR[m.kind] }} />)}
            <Line dataKey="index" stroke={C.index} dot={false} strokeWidth={1.4} connectNulls={false} isAnimationActive={false} name="Index" />
            {!fixed && <Line dataKey="unhedged" stroke={C.unhedged} strokeDasharray="5 3" dot={false} strokeWidth={1.4} connectNulls={false} isAnimationActive={false} name="Unhedged" />}
            {!terms.pending && <Line dataKey="effective" stroke={C.effective} dot={false} strokeWidth={2.4} connectNulls={false} isAnimationActive={false} name="Paid" />}
            {data.length > 30 && <Brush dataKey="t" height={isMobile ? 26 : 22} stroke="#b9b7b0" travellerWidth={isMobile ? 14 : 8} tickFormatter={t => dateTick(t, spanDays)} key={`${range}-${data.length}`} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <MarkerList markers={markers} />
      <div style={note}>
        {!fixed && !terms.daily && <div><b>{TERM_PROXY_NOTE}.</b>{lastIdx?.termSpot ? ` The latest point is today's 1M Term SOFR (${p3(lastIdx.index)}).` : ""}</div>}
        {terms.pending && <div style={{ color: C.unhedged }}>No "rate actually paid" line — {terms.pending}. The build and index history are shown; nothing is priced until the terms are on file.</div>}
        <div>Index: {fixed ? "10-Year Treasury, FRED (DGS10)" : "SOFR, FRED + NY Fed"} — daily prints as published{sofrAsOf ? `, through ${fmtShortDate(sofrAsOf)}` : ""}. Gaps in the data are left as gaps. Drag the bar under the chart to zoom or pan.</div>
      </div>
    </div>
  );
}
function HistTip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Record<string, unknown> }> }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as { date?: string; index?: number | null; unhedged?: number | null; effective?: number | null; termSpot?: boolean; regime?: string | null };
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 10px", fontSize: 12, boxShadow: "0 4px 14px rgba(0,0,0,.08)" }}>
      <div style={{ fontWeight: 700, color: C.ink }}>{fmtShortDate(r.date ?? null)}{r.termSpot ? " · 1M Term SOFR" : ""}</div>
      <div style={{ color: C.index }}>Index {p3(r.index)}</div>
      {r.unhedged != null && <div style={{ color: C.unhedged }}>Unhedged {p3(r.unhedged)}</div>}
      {r.effective != null && <div style={{ color: C.effective, fontWeight: 700 }}>Paid {p3(r.effective)}{r.regime ? ` (${r.regime})` : ""}</div>}
    </div>
  );
}
function Legend({ items }: { items: Array<[string, string, boolean]> }) {
  return <div style={{ display: "flex", gap: "4px 14px", flexWrap: "wrap", fontSize: 11.5, color: C.gray, marginBottom: 4 }}>
    {items.map(([l, c, dash]) => <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 16, height: 0, borderTop: `2px ${dash ? "dashed" : "solid"} ${c}` }} />{l}</span>)}
  </div>;
}
function MarkerList({ markers }: { markers: Marker[] }) {
  if (!markers.length) return null;
  return <div style={{ display: "flex", gap: "4px 12px", flexWrap: "wrap", fontSize: 11.5, marginTop: 6 }}>
    {markers.map((m, i) => <span key={i} style={{ color: MARK_COLOR[m.kind] }}>┆ {m.label} {fmtShortDate(m.date)}{m.endDate ? `–${fmtShortDate(m.endDate)}` : ""}</span>)}
  </div>;
}

function ForwardSection({ terms, rates, today, isMobile }: { terms: RateTerms; rates: RatesPayload | null; today: Date; isMobile: boolean }) {
  const fw = useMemo(() => (rates ? forwardView(terms, rates, today) : null), [terms, rates, today]);
  if (!terms.maturity) return <div style={note}>Loan maturity not documented — no forward view.</div>;
  if (!fw) return <div style={note}>{rates ? "No forward curve available right now." : "Rates are still loading."}</div>;
  const markers = rateMarkers(terms).filter(m => m.date >= today.toISOString().slice(0, 10) || (m.endDate ?? "") >= today.toISOString().slice(0, 10));
  const spanDays = fw.months.length ? (fw.months[fw.months.length - 1].t - fw.months[0].t) / DAY : 0;
  return (
    <div>
      <Legend items={[...(terms.rateClass === "fixed" ? [] : [["Forward index", C.index, false] as [string, string, boolean], ["Unhedged", C.unhedged, true] as [string, string, boolean]]), ["Projected rate paid", C.effective, false]]} />
      <div style={{ width: "100%", height: isMobile ? 200 : 230 }}>
        <ResponsiveContainer>
          <LineChart data={fw.months} margin={{ top: 14, right: 8, left: isMobile ? -6 : 0, bottom: 0 }}>
            <CartesianGrid stroke="#f1f0ec" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={fw.months.length ? timeTicks(fw.months[0].t, fw.months[fw.months.length - 1].t, isMobile ? 4 : 7) : undefined} tickFormatter={t => dateTick(t, spanDays)} tick={{ fontSize: 11, fill: C.gray }} />
            <YAxis tick={{ fontSize: 11, fill: C.gray }} tickFormatter={v => `${Number(v).toFixed(1)}%`} domain={["auto", "auto"]} width={46} />
            <Tooltip content={<HistTip />} />
            {markers.filter(m => m.kind === "ext-window" && m.endDate).map((m, i) => <ReferenceArea key={`a${i}`} x1={Date.parse(m.date)} x2={Date.parse(m.endDate!)} fill={C.unhedged} fillOpacity={0.12} ifOverflow="hidden" />)}
            {markers.map((m, i) => <ReferenceLine key={i} x={Date.parse(m.date + "T00:00:00Z")} stroke={MARK_COLOR[m.kind]} strokeDasharray="3 3" ifOverflow="hidden" label={isMobile ? undefined : { value: m.label, position: "insideTopLeft", fontSize: 10, fill: MARK_COLOR[m.kind] }} />)}
            {terms.rateClass !== "fixed" && <Line dataKey="index" stroke={C.index} dot={false} strokeWidth={1.4} isAnimationActive={false} />}
            {terms.rateClass !== "fixed" && <Line dataKey="unhedged" stroke={C.unhedged} strokeDasharray="5 3" dot={false} strokeWidth={1.4} isAnimationActive={false} connectNulls={false} />}
            {!terms.pending && <Line dataKey="effective" stroke={C.effective} dot={false} strokeWidth={2.4} isAnimationActive={false} connectNulls={false} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <MarkerList markers={markers} />
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 320 }}>
          <thead><tr>{["Year", "Projected rate paid", "Interest (indicative)"].map(h => <th key={h} style={{ textAlign: h === "Year" ? "left" : "right", padding: "6px 8px", fontSize: 10.5, color: C.gray, textTransform: "uppercase", letterSpacing: ".05em", borderBottom: `1px solid ${C.line}` }}>{h}</th>)}</tr></thead>
          <tbody>{fw.years.map(y => (
            <tr key={y.year}>
              <td style={{ padding: "6px 8px", borderBottom: "1px solid #f3f2ee" }}>{y.year}{y.partial ? <span style={{ color: C.gray }}> · {y.months} mo</span> : null}</td>
              <td style={{ padding: "6px 8px", borderBottom: "1px solid #f3f2ee", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p3(y.avgRate)}</td>
              <td style={{ padding: "6px 8px", borderBottom: "1px solid #f3f2ee", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{y.interest != null ? fmtMoney(y.interest) : "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={note}>{fw.note}{fw.asOf ? ` Curve as of ${fmtShortDate(fw.asOf.slice(0, 10))}.` : ""} {terms.pending ? `No projected rate — ${terms.pending}.` : ""} Not a forecast — the market's implied path today, which moves daily.</div>
    </div>
  );
}

function InterestSection({ deal, allRows, terms, sofr, histReady, isMobile }: { deal: Deal; allRows: DebtRow[]; terms: RateTerms; sofr: IndexPoint[]; histReady: boolean; isMobile: boolean }) {
  const dx = deal.datexLive;
  const loans = useMemo(() => {
    const mine = allRows.filter(r => r.dealId === deal.id && !r.superseded).map(termsFromDebtRow);
    return mine.length ? mine : [terms];
  }, [allRows, deal.id, terms]);
  const cmp = useMemo(() => compareInterest(loans, dx?.interestGl ?? (dx?.interestCheckedThrough ? [] : null), sofr, { inDatex: !!dx?.bldgIds?.length, maxMonths: 24 }), [loans, dx, sofr]);
  if (cmp.status !== "ok") return <div style={{ fontSize: 13, color: C.gray }}>{cmp.notes[0]}</div>;
  if (!histReady && loans.some(t => t.rateClass !== "fixed")) return <div className="kpr-skel" style={{ height: 160, borderRadius: 10 }} aria-busy="true" />;
  const bars = cmp.months.map(m => ({ label: fmtPeriod(m.period), gap: m.gap, flagged: m.flagged }));
  const cell = (v: ReactNode, o: React.CSSProperties = {}) => <td style={{ padding: "6px 8px", borderBottom: "1px solid #f3f2ee", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", ...o }}>{v}</td>;
  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.ink, marginBottom: 6 }}>{cmp.flagged ? <><b style={{ color: C.red }}>{cmp.flagged} month{cmp.flagged === 1 ? "" : "s"} off</b> by more than {fmtMoney(GAP_FLAG_MIN, { below: "full" })} or 10%.</> : "Every month within $2,500 or 10% of what the terms imply."}</div>
      <div style={{ width: "100%", height: isMobile ? 150 : 170 }}>
        <ResponsiveContainer>
          <BarChart data={bars} margin={{ top: 6, right: 6, left: isMobile ? 0 : 4, bottom: 0 }}>
            <CartesianGrid stroke="#f1f0ec" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.gray }} interval={isMobile ? 2 : 0} angle={isMobile ? 0 : -30} textAnchor={isMobile ? "middle" : "end"} height={isMobile ? 22 : 36} />
            <YAxis tick={{ fontSize: 10.5, fill: C.gray }} tickFormatter={v => fmtMoney(Number(v), { kSuffix: "k" })} width={54} />
            <ReferenceLine y={0} stroke="#b9b7b0" />
            <Tooltip formatter={(v: unknown) => [typeof v === "number" ? fmtMoney(v, { below: "full" }) : "—", "Actual − expected"]} />
            <Bar dataKey="gap" isAnimationActive={false}>{bars.map((b, i) => <Cell key={i} fill={b.flagged ? (b.gap! < 0 ? C.red : C.unhedged) : "#c9c7c0"} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ overflowX: "auto", marginTop: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 12 : 12.5, minWidth: isMobile ? 340 : 640 }}>
          <thead><tr>{["Posted", ...(isMobile ? [] : ["Interest for"]), "Actual (Datex)", "Expected", "Gap", ...(isMobile ? [] : ["Cumulative"])].map(h => <th key={h} style={{ textAlign: h === "Posted" || h === "Interest for" ? "left" : "right", padding: "6px 8px", fontSize: 10.5, color: C.gray, textTransform: "uppercase", letterSpacing: ".05em", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap", position: h === "Posted" ? "sticky" : undefined, left: 0, background: "#fff" }}>{h}</th>)}</tr></thead>
          <tbody>{cmp.months.map(m => (
            <tr key={m.period} style={{ background: m.flagged ? "#fdf3f0" : undefined }}>
              <td style={{ padding: "6px 8px", borderBottom: "1px solid #f3f2ee", whiteSpace: "nowrap", position: "sticky", left: 0, background: m.flagged ? "#fdf3f0" : "#fff", fontWeight: m.flagged ? 700 : 400 }}>{fmtPeriod(m.period)}{m.flagged ? " ⚑" : ""}</td>
              {!isMobile && cell(fmtPeriod(m.accrual), { textAlign: "left", color: C.gray })}
              {cell(m.actual != null ? fmtMoney(m.actual, { below: "full" }) : "—", { }, )}
              {cell(m.expected != null ? fmtMoney(m.expected, { below: "full" }) : <span title={m.expectedWhy ?? undefined} style={{ color: C.gray }}>—</span>)}
              {cell(m.gap != null ? `${m.gap > 0 ? "+" : ""}${fmtMoney(m.gap, { below: "full" })}` : "—", { color: m.flagged ? (m.gap! < 0 ? C.red : C.unhedged) : C.ink, fontWeight: m.flagged ? 700 : 400 })}
              {!isMobile && cell(m.cumulativeGap != null ? fmtMoney(m.cumulativeGap, { below: "full" }) : "—", { color: C.gray })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={note}>{cmp.notes.map((x, i) => <div key={i} style={/Underbilled|catch-up/.test(x) ? { color: C.ink, fontWeight: 600 } : undefined}>{x}</div>)}
        <div>Actual = Datex 1st Mortgage Interest (81100000) plus Swap Credits (81101000), accrual book. Expected = balance × the rate the terms imply × actual/360, the swapped part at its all-in.</div>
      </div>
    </div>
  );
}
