import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Brush, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiRateSeries, apiCurveOverlay, type RateSeriesView, type CurveOverlayView } from "../lib/api";
import { toChartRows, inRange, changeStats, fmtBp, compareRows, compareStart, RANGES, type RangeKey, type ChartRow, type SeriesTuple } from "../lib/rateSeries";

// TODAY'S RATES — tap-to-chart (Eric, 10/26/26). Every rate row in the panel opens a history
// chart (zoom/pan, 1W…Max, crosshair), change stats and its source; Compare overlays several
// series; Curve view overlays today's swap curve against 1 week / 1 month / 1 year ago.
// Same recharts building blocks as the rate detail panel. Gaps stay gaps; thin-close days get
// a hollow marker. Math in lib/rateSeries.ts.

const C = { ink: "#232422", gray: "#676767", line: "#ecebe6", green: "#3e8a2f", amber: "#b3711a" };
const PALETTE = ["#3e8a2f", "#2c6e9b", "#b3711a", "#7a4fa3", "#b3403f"];
const DAY = 86_400_000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtD = (iso: string) => { const [y, m, d] = iso.split("-"); return `${MON[Number(m) - 1]} ${Number(d)}, ${y}`; };
const tick = (t: number, span: number) => { const d = new Date(t); return span > 1100 ? `${d.getUTCFullYear()}` : span > 75 ? `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
const pill = (on: boolean): React.CSSProperties => ({ background: on ? "#383A37" : "#fff", color: on ? "#fff" : "#383A37", border: `1px solid ${on ? "#383A37" : "#d9d8d2"}`, borderRadius: 14, padding: "4px 9px", minHeight: 30, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Montserrat',sans-serif" });

// ── Panel-wide state: which row is open, compare picks ───────────────────────
export interface RatesUi { open: string | null; setOpen: (k: string | null) => void; compare: boolean; picked: Array<{ key: string; label: string }>; toggle: (key: string, label: string) => void }
export const RatesUiCtx = createContext<RatesUi | null>(null);
export const useRatesUi = () => useContext(RatesUiCtx);

function useSeries(key: string | null): { data: RateSeriesView | null; err: string | null } {
  const [data, setData] = useState<RateSeriesView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    let on = true; setData(null); setErr(null);
    apiRateSeries(key).then(d => on && setData(d)).catch(e => on && setErr(e instanceof Error ? e.message : "Couldn't load"));
    return () => { on = false; };
  }, [key]);
  return { data, err };
}

/** Hollow marker on a thin-close day; a dot on every point when the view is sparse. */
const dotFor = (color: string, sparse: boolean) => (p: { cx?: number; cy?: number; payload?: ChartRow; index?: number }) => {
  if (p.cx == null || p.cy == null || p.payload?.v == null) return <g key={`d${p.index}`} />;
  if (p.payload.thin) return <circle key={`d${p.index}`} cx={p.cx} cy={p.cy} r={3.4} fill="#fff" stroke={color} strokeWidth={1.6} />;
  return sparse ? <circle key={`d${p.index}`} cx={p.cx} cy={p.cy} r={2.2} fill={color} /> : <g key={`d${p.index}`} />;
};
function Tip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartRow; color?: string; name?: string; value?: number }> }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 9px", fontSize: 12, boxShadow: "0 4px 14px rgba(0,0,0,.08)", maxWidth: 230 }}>
      <div style={{ fontWeight: 700, color: C.ink }}>{fmtD(r.date)}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.color ?? C.green }}>{payload.length > 1 ? `${p.name}: ` : ""}{typeof p.value === "number" ? `${p.value.toFixed(3)}%` : "no print"}</div>)}
      {r.thin && <div style={{ color: C.amber, marginTop: 2 }}>Thin close{r.n != null ? ` — ${r.n} trade${r.n === 1 ? "" : "s"}` : ""}: too few trades in the 3:00–5:00pm ET close, so the rate is read from later or all-day trades.</div>}
    </div>
  );
}

function Ranges({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{RANGES.map(r => <button key={r} type="button" style={pill(value === r)} onClick={() => onChange(r)}>{r}</button>)}</div>;
}

// ── One series: chart + change stats + source ────────────────────────────────
export function SeriesDetail({ seriesKey }: { seriesKey: string }) {
  const { data, err } = useSeries(seriesKey);
  const [range, setRange] = useState<RangeKey>("1Y");
  const all = useMemo(() => (data ? toChartRows(data.points as SeriesTuple[]) : []), [data]);
  const rows = useMemo(() => inRange(all, range), [all, range]);
  const stats = useMemo(() => (data ? changeStats(data.points as SeriesTuple[]) : null), [data]);
  if (err) return <div style={{ fontSize: 12, color: "#b3403f", padding: "8px 12px" }}>{err}</div>;
  if (!data) return <div className="kpr-skel" style={{ height: 180, margin: "6px 12px 10px", borderRadius: 8 }} aria-busy="true" />;
  const real = rows.filter(r => r.v != null);
  const span = rows.length ? (rows[rows.length - 1].t - rows[0].t) / DAY : 0;
  const thinCount = real.filter(r => r.thin).length;
  return (
    <div style={{ padding: "8px 12px 12px", background: "#fff", borderTop: "1px solid #f3eee3" }}>
      <Ranges value={range} onChange={setRange} />
      {real.length === 0 ? <div style={{ fontSize: 12, color: C.gray, padding: "18px 0" }}>No history in this range{data.collectedSince ? ` — history collected since ${fmtD(data.collectedSince)}` : ""}.</div> : (
        <div style={{ width: "100%", height: 190, marginTop: 6 }}>
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 8, right: 6, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#f1f0ec" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={t => tick(t, span)} tick={{ fontSize: 10.5, fill: C.gray }} minTickGap={34} />
              <YAxis domain={["auto", "auto"]} tickFormatter={v => `${Number(v).toFixed(2)}`} tick={{ fontSize: 10.5, fill: C.gray }} width={40} />
              <Tooltip content={<Tip />} cursor={{ stroke: "#9b998f", strokeDasharray: "3 3" }} />
              <Line dataKey="v" stroke={C.green} strokeWidth={1.8} connectNulls={false} isAnimationActive={false} dot={dotFor(C.green, real.length < 40)} activeDot={{ r: 4 }} />
              {rows.length > 30 && <Brush dataKey="t" height={22} stroke="#b9b7b0" travellerWidth={12} tickFormatter={t => tick(t, span)} key={`${range}-${rows.length}`} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {stats?.latest && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(92px,1fr))", gap: 6, marginTop: 8 }}>
          {([["1 day", stats.d1], ["1 week", stats.w1], ["1 month", stats.m1], ["YTD", stats.ytd], ["1 year", stats.y1]] as Array<[string, number | null]>).map(([l, v]) => (
            <div key={l} style={{ background: "#faf9f5", border: "1px solid #f0eee8", borderRadius: 7, padding: "5px 8px" }}>
              <div style={{ fontSize: 10, color: C.gray, fontWeight: 600 }}>{l}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: v == null ? "#a3a19a" : v > 0 ? "#3e8a2f" : v < 0 ? "#b3403f" : C.ink, fontVariantNumeric: "tabular-nums" }}>{fmtBp(v)}</div>
            </div>
          ))}
          <div style={{ background: "#faf9f5", border: "1px solid #f0eee8", borderRadius: 7, padding: "5px 8px", gridColumn: "span 2" }}>
            <div style={{ fontSize: 10, color: C.gray, fontWeight: 600 }}>{stats.partialYear ? "High / low (all history)" : "52-week high / low"}</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{stats.hi52 ? `${stats.hi52.v.toFixed(3)}% · ${stats.lo52!.v.toFixed(3)}%` : "—"}</div>
            {stats.hi52 && <div style={{ fontSize: 10, color: C.gray }}>{fmtD(stats.hi52.date)} · {fmtD(stats.lo52!.date)}</div>}
          </div>
        </div>
      )}
      <div style={{ fontSize: 10.5, color: "#8a7f6d", marginTop: 7, lineHeight: 1.45 }}>
        {data.collected && data.collectedSince ? <div><b>History collected since {fmtD(data.collectedSince)}.</b></div> : null}
        {thinCount > 0 && <div>Hollow markers = thin-close days ({thinCount} in view) — tap one for the trade count.</div>}
        <div>Source: {data.source}{data.asOf ? ` · latest ${fmtD(data.asOf)}` : ""}. A "—" change means there's no print within a week of that date to compare with. Gaps in the data are left as gaps. Drag the bar under the chart to zoom or pan.</div>
      </div>
    </div>
  );
}

// ── Compare several series on one chart ──────────────────────────────────────
function SeriesLoader({ k, onData }: { k: string; onData: (k: string, d: RateSeriesView | null) => void }) {
  const { data } = useSeries(k);
  useEffect(() => { onData(k, data); }, [k, data, onData]);
  return null;
}
export function CompareChart() {
  const ui = useRatesUi();
  const [range, setRange] = useState<RangeKey>("1Y");
  const [got, setGot] = useState<Record<string, RateSeriesView | null>>({});
  const onData = useMemo(() => (k: string, d: RateSeriesView | null) => setGot(g => (g[k] === d ? g : { ...g, [k]: d })), []);
  if (!ui?.compare) return null;
  const picked = ui.picked;
  const loaded = picked.map(p => ({ ...p, data: got[p.key] ?? null })).filter(p => p.data);
  const from = compareStart(loaded.map(p => p.data!.points as SeriesTuple[]), range);
  const lines = loaded.map((p, i) => ({ ...p, color: PALETTE[i % PALETTE.length], rows: compareRows(p.data!.points as SeriesTuple[], "Max", from) }));
  const ts = lines.flatMap(l => l.rows.map(r => r.t));
  const span = ts.length ? (Math.max(...ts) - Math.min(...ts)) / DAY : 0;
  return (
    <div style={{ border: "1px solid #ebeae5", borderRadius: 10, background: "#fff", padding: 10, marginBottom: 14 }}>
      {picked.map(p => <SeriesLoader key={p.key} k={p.key} onData={onData} />)}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#4f4d48", marginBottom: 6 }}>Compare</div>
      {!picked.length ? <div style={{ fontSize: 12, color: C.gray }}>Tick up to 5 rates below (e.g. SOFR, the 5Y swap and the 10Y Treasury) to overlay them.</div> : (
        <>
          <Ranges value={range} onChange={setRange} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: 11.5, margin: "6px 0 2px" }}>
            {lines.map(l => <span key={l.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: C.ink }}><span style={{ width: 14, borderTop: `2px solid ${l.color}` }} />{l.label}</span>)}
            {picked.length > loaded.length && <span style={{ color: C.gray }}>loading…</span>}
          </div>
          <div style={{ width: "100%", height: 210 }}>
            <ResponsiveContainer>
              <LineChart margin={{ top: 8, right: 6, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#f1f0ec" vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} allowDuplicatedCategory={false} tickFormatter={t => tick(t, span)} tick={{ fontSize: 10.5, fill: C.gray }} minTickGap={34} />
                <YAxis domain={["auto", "auto"]} tickFormatter={v => `${Number(v).toFixed(2)}`} tick={{ fontSize: 10.5, fill: C.gray }} width={40} />
                <Tooltip content={<Tip />} cursor={{ stroke: "#9b998f", strokeDasharray: "3 3" }} />
                {/* Each series carries its OWN dates, so one series' missing day never breaks another's line. */}
                {lines.map(l => <Line key={l.key} data={l.rows} dataKey="v" name={l.label} stroke={l.color} strokeWidth={1.7} connectNulls={false} isAnimationActive={false} dot={dotFor(l.color, l.rows.length < 40)} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ fontSize: 10.5, color: "#8a7f6d", marginTop: 4 }}>Each line uses its own published dates; where one has no print the line breaks rather than being filled in. Tap a ticked row again to remove it.</div>
        </>
      )}
    </div>
  );
}

// ── Swap curve: today vs 1 week / 1 month / 1 year ago ───────────────────────
export function CurveView() {
  const [data, setData] = useState<CurveOverlayView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [which, setWhich] = useState<"term" | "ois">("term");
  const [show, setShow] = useState<Record<string, boolean>>({ Today: true, "1W": true, "1M": false, "1Y": false });
  useEffect(() => { apiCurveOverlay().then(setData).catch(e => setErr(e instanceof Error ? e.message : "Couldn't load")); }, []);
  if (err) return <div style={{ fontSize: 12, color: "#b3403f" }}>{err}</div>;
  if (!data) return <div className="kpr-skel" style={{ height: 200, borderRadius: 8 }} aria-busy="true" />;
  const colors: Record<string, string> = { Today: "#3e8a2f", "1W": "#2c6e9b", "1M": "#b3711a", "1Y": "#7a4fa3" };
  const curves = data.curves.filter(c => show[c.key] && c.curve).map(c => ({ ...c, pts: (which === "term" ? c.curve!.term : c.curve!.ois).filter(p => p.tenor <= 30).map(p => ({ tenor: p.tenor, v: p.rate })) }));
  return (
    <div style={{ border: "1px solid #ebeae5", borderRadius: 10, background: "#fff", padding: 10 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
        <button type="button" style={pill(which === "term")} onClick={() => setWhich("term")}>1M Term</button>
        <button type="button" style={pill(which === "ois")} onClick={() => setWhich("ois")}>SOFR OIS</button>
        <span style={{ width: 8 }} />
        {data.curves.map(c => (
          <button key={c.key} type="button" disabled={!c.curve} style={{ ...pill(!!show[c.key] && !!c.curve), opacity: c.curve ? 1 : 0.45 }}
            title={c.curve ? `Curve of ${c.date}` : `No stored curve within a week of ${c.target}`} onClick={() => setShow(s => ({ ...s, [c.key]: !s[c.key] }))}>
            {c.key === "Today" ? "Today" : `${c.key} ago`}
          </button>
        ))}
      </div>
      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer>
          <LineChart margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid stroke="#f1f0ec" vertical={false} />
            <XAxis dataKey="tenor" type="number" domain={[1, 30]} ticks={[1, 2, 3, 5, 7, 10, 15, 20, 30]} tickFormatter={t => `${t}Y`} tick={{ fontSize: 10.5, fill: C.gray }} allowDuplicatedCategory={false} />
            <YAxis domain={["auto", "auto"]} tickFormatter={v => `${Number(v).toFixed(2)}`} tick={{ fontSize: 10.5, fill: C.gray }} width={40} />
            <Tooltip formatter={(v: unknown, name: unknown) => [typeof v === "number" ? `${v.toFixed(3)}%` : "—", String(name)]} labelFormatter={t => `${t}-year`} />
            {curves.map(c => <Line key={c.key} data={c.pts} dataKey="v" name={c.key === "Today" ? `Today (${c.date})` : `${c.key} ago (${c.date})`} stroke={colors[c.key]} strokeWidth={c.key === "Today" ? 2.2 : 1.5} dot={{ r: 2.2 }} isAnimationActive={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ fontSize: 10.5, color: "#8a7f6d", marginTop: 4, lineHeight: 1.45 }}>
        {data.curves.filter(c => c.key !== "Today").map(c => <span key={c.key}>{c.key} ago: {c.date ? fmtD(c.date) : <i>no curve stored within a week of {fmtD(c.target)}</i>}. </span>)}
        Each past curve is the latest stored close on or before that date (never more than a week earlier). {which === "term" ? "1M Term is derived from that day's OIS the same way as today's." : ""}{data.firstDate ? ` History collected since ${fmtD(data.firstDate)}.` : ""}
      </div>
    </div>
  );
}
