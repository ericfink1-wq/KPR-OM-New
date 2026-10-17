import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Star, Info } from "lucide-react";
import { createPortal } from "react-dom";
import { apiGetRates, apiLoadComps, apiSaveSwapCurve, apiGetLoanSizerPrefs, apiSaveLoanSizerPrefs, apiPreviewChathamMark, apiSaveChathamMark, type ChathamMarkParse, type RatesPayload, type RateRow, type SwapCurveView } from "../lib/api";
import { baseRateOptions, sizeLoan, BASE_GROUPS, DEFAULT_BASE_ID } from "../lib/loanSizing";

// "Today's Rates" panel. SOFR swaps are read off DTCC's public swap-trade data (every
// reported trade — median per tenor, with the trade count and range), or a curve someone
// pasted from Chatham when that's newer. Treasuries are Treasury.gov's official par curve;
// SOFR overnight is the NY Fed's. Every section shows its own source and as-of time.

const TREASURY_TENORS_SHOWN = ["1-Yr", "2-Yr", "3-Yr", "5-Yr", "7-Yr", "10-Yr"];
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const usd = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n).toLocaleString()}`;
const ET = "America/New_York";
const fmtAsOf = (iso: string | null | undefined) => {
  if (!iso) return "—";
  if (iso.length <= 10) {
    const d = new Date(iso + "T12:00:00Z");
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: ET });
  }
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: ET }) + " ET";
};

const label: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5, color: "#6b6356", fontWeight: 600 };
const input: React.CSSProperties = { padding: "7px 8px", border: "1px solid #e3dccd", borderRadius: 6, fontSize: 13, fontFamily: "inherit", minHeight: 34, boxSizing: "border-box" };
const cap: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5c5047" };

function NumField({ name, value, onChange, step, suffix, width = 72 }: { name: string; value: number; onChange: (n: number) => void; step: number; suffix: string; width?: number }) {
  return (
    <label style={label}>
      {name}
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input type="number" inputMode="decimal" step={step} value={Number.isFinite(value) ? value : ""} onChange={e => onChange(Number(e.target.value))} aria-label={name} style={{ ...input, width }} />
        <span style={{ fontSize: 11 }}>{suffix}</span>
      </span>
    </label>
  );
}

function Sparkline({ series, title }: { series: Array<{ month: string; value: number }>; title: string }) {
  if (series.length < 2) return null;
  const W = 150, H = 34, xs = series.map(p => p.value), lo = Math.min(...xs), hi = Math.max(...xs), rng = hi - lo || 1;
  const pts = series.map((p, i) => `${(i / (series.length - 1)) * W},${H - ((p.value - lo) / rng) * (H - 4) - 2}`).join(" ");
  return (
    <svg width={W} height={H} role="img" aria-label={title}>
      <title>{`${title}: ${series.map(p => `${p.month} ${p.value.toFixed(2)}%`).join(", ")}`}</title>
      <polyline points={pts} fill="none" stroke="#3f7a1f" strokeWidth="1.8" />
    </svg>
  );
}

// ── Loan sizing ────────────────────────────────────────────────────────────────
function LoanSizing({ data, deal }: { data: RatesPayload; deal?: { name: string; noi: number | null; price?: number | null } | null }) {
  const options = useMemo(() => baseRateOptions(data), [data]);
  // No star → the 5Y 1M Term SOFR swap (what KPR's swapped loans price off), then the 10Y OIS.
  const firstAvailable = options.find(o => o.id === DEFAULT_BASE_ID && o.value != null) ?? options.find(o => o.id === "swap-10" && o.value != null) ?? options.find(o => o.value != null);
  const [baseId, setBaseIdRaw] = useState<string>(firstAvailable?.id ?? DEFAULT_BASE_ID);
  const [spreadBps, setSpreadBps] = useState(200);
  const [premiumBps, setPremiumBps] = useState(0);
  const [cushionBps, setCushionBps] = useState(0);
  const [dscr, setDscr] = useState(1.3);
  const [debtYield, setDebtYield] = useState(9);
  const [ltv, setLtv] = useState(65);
  const [io, setIo] = useState(false);
  const [amortYrs, setAmortYrs] = useState(30);
  // Per-user settings saved on the server (Eric, 10/17/26): a starred default base rate and
  // the last-used inputs, so the sizer opens the same way on any device after any publish.
  const [defaultBase, setDefaultBase] = useState<string | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [prefsNote, setPrefsNote] = useState<string | null>(null);
  const touched = useRef(false);
  const setBaseId = (id: string) => { touched.current = true; setBaseIdRaw(id); };
  useEffect(() => {
    let alive = true;
    apiGetLoanSizerPrefs().then(p => {
      if (!alive) return;
      setDefaultBase(p.defaultBase ?? null);
      if (!touched.current) {
        const starred = p.defaultBase ? options.find(o => o.id === p.defaultBase && o.value != null) : null;
        if (starred) setBaseIdRaw(starred.id);
        if (p.spreadBps != null) setSpreadBps(p.spreadBps);
        if (p.premiumBps != null) setPremiumBps(p.premiumBps);
        if (p.cushionBps != null) setCushionBps(p.cushionBps);
        if (p.dscr != null) setDscr(p.dscr);
        if (p.debtYieldPct != null) setDebtYield(p.debtYieldPct);
        if (p.ltvPct != null) setLtv(p.ltvPct);
        if (p.io != null) setIo(p.io);
        if (p.amortYears != null) setAmortYrs(p.amortYears);
      }
    }).catch(() => { /* signed out / offline: keep today's defaults */ })
      .finally(() => { if (alive) setPrefsLoaded(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Remember the last-used inputs (debounced). Skipped until the stored ones have loaded, so
  // the built-in defaults never overwrite what the user saved on another device.
  const lastSaved = useRef<string | null>(null);
  useEffect(() => {
    if (!prefsLoaded) return;
    const patch = { spreadBps, premiumBps, cushionBps, dscr, debtYieldPct: debtYield, ltvPct: ltv, io, amortYears: amortYrs };
    const key = JSON.stringify(patch);
    if (lastSaved.current === null) { lastSaved.current = key; return; }
    if (key === lastSaved.current) return;
    const t = setTimeout(() => { lastSaved.current = key; apiSaveLoanSizerPrefs(patch).catch(() => { /* best-effort */ }); }, 900);
    return () => clearTimeout(t);
  }, [prefsLoaded, spreadBps, premiumBps, cushionBps, dscr, debtYield, ltv, io, amortYrs]);
  const isDefault = defaultBase != null && defaultBase === baseId;
  const toggleDefault = () => {
    const prev = defaultBase, next = isDefault ? null : baseId;
    setDefaultBase(next); setPrefsNote(null);
    apiSaveLoanSizerPrefs({ defaultBase: next })
      .then(() => setPrefsNote(next ? "Saved as your default" : "Default cleared"))
      .catch(() => { setDefaultBase(prev); setPrefsNote("Couldn't save — are you signed in?"); });
  };
  const [noiInput, setNoiInput] = useState(deal?.noi ? String(Math.round(deal.noi)) : "");
  const [priceInput, setPriceInput] = useState(deal?.price ? String(Math.round(deal.price)) : "");
  const base = options.find(o => o.id === baseId) ?? null;
  const num = (s: string) => { const n = Number(s.replace(/[$,\s]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
  const sizing = base?.value != null ? sizeLoan({ basePct: base.value, spreadBps, premiumBps, cushionBps, noi: num(noiInput), price: num(priceInput), dscr, debtYieldPct: debtYield, ltvPct: ltv, amortYears: io ? null : amortYrs }) : null;
  const groups = BASE_GROUPS;

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ ...cap, marginBottom: 8 }}>Size a loan{deal?.name ? ` — ${deal.name}` : ""}</div>
      <div style={{ border: "1px solid #ece5d7", borderRadius: 10, background: "#fff", padding: 12 }}>
        <label style={label}>
          Base rate
          <span style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
          <select value={baseId} onChange={e => { setBaseId(e.target.value); setPrefsNote(null); }} aria-label="Base rate" style={{ ...input, flex: 1, minWidth: 0 }}>
            {groups.map(g => (
              <optgroup key={g} label={g}>
                {options.filter(o => o.group === g).map(o => (
                  <option key={o.id} value={o.id} disabled={o.value == null}>{o.label}{o.value != null ? ` — ${o.value.toFixed(3)}%` : " — not available"}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button type="button" onClick={e => { e.preventDefault(); toggleDefault(); }} aria-pressed={isDefault}
            aria-label={isDefault ? "Your default base rate — tap to clear" : "Set as my default base rate"}
            title={isDefault ? "Your default base rate (tap to clear)" : "Set as my default base rate"}
            style={{ flexShrink: 0, width: 40, minHeight: 36, border: `1px solid ${isDefault ? "#C9A227" : "#e3dccd"}`, borderRadius: 8, background: isDefault ? "#fbf4dc" : "#fff", color: isDefault ? "#b08a14" : "#8d8577", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Star size={17} strokeWidth={1.9} fill={isDefault ? "currentColor" : "none"} aria-hidden />
          </button>
          </span>
          {(prefsNote || isDefault) && <span style={{ fontSize: 11, fontWeight: 500, color: "#8d8577", marginTop: 3 }}>{prefsNote ?? "Your default — opens here on any device"}</span>}
        </label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <NumField name="Lender spread" value={spreadBps} onChange={setSpreadBps} step={5} suffix="bps" />
          <NumField name="Swap / credit premium" value={premiumBps} onChange={setPremiumBps} step={5} suffix="bps" />
          <NumField name="Stress cushion" value={cushionBps} onChange={setCushionBps} step={5} suffix="bps" />
        </div>
        <div style={{ marginTop: 10, padding: "10px 12px", background: "#f6f9f2", border: "1px solid #dfe9d3", borderRadius: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#3f5a2a" }}>All-in rate</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: "#1f2a17", fontVariantNumeric: "tabular-nums" }}>{sizing ? `${sizing.allIn.toFixed(3)}%` : "—"}</span>
          </div>
          <div style={{ fontSize: 11, color: "#6b6356", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {base?.value != null
              ? `${base.label} ${base.value.toFixed(3)}% + spread ${spreadBps} + premium ${premiumBps} + cushion ${cushionBps} bps${base.asOf ? ` · base as of ${fmtAsOf(base.asOf)}` : ""}`
              : "Pick a base rate that's available today."}
          </div>
        </div>
        <div style={{ borderTop: "1px solid #f3eee3", marginTop: 12, paddingTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={label}>NOI
            <input value={noiInput} onChange={e => setNoiInput(e.target.value)} inputMode="numeric" placeholder="e.g. 2,100,000" aria-label="NOI" style={{ ...input, width: 118 }} />
          </label>
          <label style={label}>Purchase price
            <input value={priceInput} onChange={e => setPriceInput(e.target.value)} inputMode="numeric" placeholder="e.g. 32,000,000" aria-label="Purchase price" style={{ ...input, width: 128 }} />
          </label>
          <NumField name="DSCR" value={dscr} onChange={setDscr} step={0.05} suffix="x" width={64} />
          <NumField name="Debt yield" value={debtYield} onChange={setDebtYield} step={0.25} suffix="%" width={64} />
          <NumField name="LTV" value={ltv} onChange={setLtv} step={5} suffix="%" width={64} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <div role="radiogroup" aria-label="Amortization" style={{ display: "inline-flex", border: "1px solid #e3dccd", borderRadius: 8, overflow: "hidden" }}>
            {[{ v: false, t: "Amortizing" }, { v: true, t: "Interest only" }].map(o => (
              <button key={o.t} role="radio" aria-checked={io === o.v} onClick={() => setIo(o.v)}
                style={{ padding: "7px 12px", minHeight: 34, border: "none", background: io === o.v ? "#3f7a1f" : "#fff", color: io === o.v ? "#fff" : "#5c5047", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{o.t}</button>
            ))}
          </div>
          {!io && <NumField name="Amortization" value={amortYrs} onChange={setAmortYrs} step={5} suffix="yrs" width={60} />}
        </div>
        {sizing && sizing.loans.length ? (
          <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
            {sizing.loans.map(l => {
              const binds = l.by === sizing.binding;
              return (
                <div key={l.by} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8,
                  background: binds ? "#eaf3e1" : "#faf7f0", border: `1px solid ${binds ? "#9cc47c" : "#efe8da"}` }}>
                  <span style={{ fontSize: 12.5, color: "#383a37" }}>
                    {l.by === "DSCR" ? `At ${dscr}x DSCR` : l.by === "Debt yield" ? `At ${debtYield}% debt yield` : `At ${ltv}% LTV`}
                    {binds && <b style={{ marginLeft: 6, fontSize: 10.5, color: "#1f5d2b", textTransform: "uppercase", letterSpacing: "0.05em" }}>binds</b>}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: binds ? "#1f5d2b" : "#383a37", fontVariantNumeric: "tabular-nums" }}>{usd(l.amount)}</span>
                </div>
              );
            })}
            <div style={{ fontSize: 11, color: "#7d766a" }}>Loan constant {(sizing.constant * 100).toFixed(2)}% ({io ? "interest only" : `${amortYrs}-yr amortization`}). Max loan ≈ <b style={{ color: "#1f5d2b" }}>{usd(sizing.max!)}</b>.</div>
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 11.5, color: "#a89f8f" }}>{!sizing ? "Needs a base rate." : "Enter an NOI (and a price for LTV) to size the loan."}</div>
        )}
      </div>
      <div style={{ fontSize: 9.5, color: "#bcae97", marginTop: 5 }}>Indicative only — a lender's quote, reserves and their own NOI underwriting will differ.</div>
    </div>
  );
}

// ── Cap-rate spread (comp median cap − 10-Yr) ──────────────────────────────────
function CapSpread({ data }: { data: RatesPayload }) {
  const [comps, setComps] = useState<Array<{ capRate?: number | null; saleDate?: string | null; isCompetitiveSet?: boolean; isPortfolioAllocation?: boolean }> | null>(null);
  useEffect(() => { apiLoadComps().then(r => setComps(r as never)).catch(() => setComps([])); }, []);
  const series = (() => {
    if (!comps || !data.tenYearMonthly?.length) return [] as Array<{ month: string; value: number; n: number }>;
    const sales = comps.filter(c => !c.isCompetitiveSet && !c.isPortfolioAllocation && c.saleDate && typeof c.capRate === "number" && c.capRate >= 3 && c.capRate <= 12);
    return data.tenYearMonthly.map(p => {
      const end = new Date(p.month + "-01T00:00:00Z"); end.setUTCMonth(end.getUTCMonth() + 1);
      const start = new Date(end); start.setUTCFullYear(start.getUTCFullYear() - 1);
      const caps = sales.filter(c => { const t = Date.parse(String(c.saleDate)); return t >= start.getTime() && t < end.getTime(); }).map(c => c.capRate as number);
      return caps.length >= 4 ? { month: p.month, value: median(caps) - p.value, n: caps.length } : null;
    }).filter(Boolean) as Array<{ month: string; value: number; n: number }>;
  })();
  const latest = series[series.length - 1];
  return (
    <div style={{ marginBottom: 18, border: "1px solid #ece5d7", borderRadius: 10, background: "#fff", padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 10.5, color: "#6b6356", fontWeight: 600 }}>Cap-rate spread (comp median cap − 10-Yr)</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#26281f" }}>{latest ? `${Math.round(latest.value * 100)} bps` : "—"}</div>
        <div style={{ fontSize: 10.5, color: "#a89f8f" }}>{latest ? `${latest.n} sales in the 12 months to ${latest.month}` : comps == null ? "Loading comps…" : "Not enough recent sales"}</div>
      </div>
      <Sparkline series={series} title="Cap rate spread, last 12 months" />
    </div>
  );
}

// ── Rate tables ────────────────────────────────────────────────────────────────
function Section({ title, rows, asOf, source, info, badge }: { title: string; rows: RateRow[]; asOf: string | null; source: string; info?: string; badge?: string }) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={cap}>{title}</span>
          {badge && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", color: "#7a5b0c", background: "#fbf4dc", border: "1px solid #e8d48f", borderRadius: 20, padding: "1px 7px", whiteSpace: "nowrap" }}>{badge}</span>}
          {info && (
            <button type="button" onClick={() => setShowInfo(v => !v)} aria-expanded={showInfo} aria-label="About this curve" title={info}
              style={{ background: "transparent", border: "none", padding: 4, margin: -4, color: "#8a7f6d", cursor: "pointer", display: "inline-flex" }}>
              <Info size={14} strokeWidth={2} aria-hidden />
            </button>
          )}
        </span>
        <span style={{ fontSize: 10, color: "#a89f8f" }}>as of {fmtAsOf(asOf)}</span>
      </div>
      {info && showInfo && <div style={{ fontSize: 11.5, color: "#4a4d46", background: "#fff", border: "1px solid #ece5d7", borderRadius: 8, padding: "8px 10px", marginBottom: 8, lineHeight: 1.45 }}>{info}</div>}
      <div style={{ border: "1px solid #ece5d7", borderRadius: 10, overflow: "hidden" }}>
        {rows.map((r, i) => (
          <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: i % 2 ? "#faf7f0" : "#fff", borderTop: i ? "1px solid #f3eee3" : "none" }}>
            <span style={{ fontSize: 12.5, color: "#383a37" }}>{r.label}{r.note && <span style={{ fontSize: 10, color: "#8a7f6d", marginLeft: 6 }}>({r.note})</span>}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#26281f", fontVariantNumeric: "tabular-nums" }}>{r.value == null ? "—" : `${r.value.toFixed((String(r.value).split(".")[1]?.length ?? 0) > 2 ? 3 : 2)}%`}</span>
          </div>
        ))}
        {!rows.length && <div style={{ padding: "10px 12px", fontSize: 12, color: "#a89f8f", background: "#fff" }}>Nothing available right now.</div>}
      </div>
      <div style={{ fontSize: 9.5, color: "#8a7f6d", marginTop: 5, lineHeight: 1.45 }}>Source: {source}</div>
    </div>
  );
}

function SwapCurveSection({ data, onSaved }: { data: RatesPayload; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [src, setSrc] = useState("Chatham");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const c: SwapCurveView | null | undefined = data.swapCurve;
  const hist = (data.swapHistory ?? []).filter(h => h.y10 != null).map(h => ({ month: h.month, value: h.y10 as number }));
  const save = async () => {
    setBusy(true); setMsg(null);
    try { const r = await apiSaveSwapCurve(text, src); setMsg(`Saved ${r.points.length} tenors — shown until DTCC has newer trades.`); setText(""); onSaved(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save"); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ marginBottom: 18 }}>
      <Section title={c?.kind === "manual" ? "SOFR OIS (annual/annual) — pasted" : "SOFR OIS (annual/annual)"} badge={c?.kind === "chatham" ? "Chatham mark" : undefined} rows={data.swaps.rows} asOf={data.swaps.asOf} source={data.swaps.source} />
      {hist.length >= 2 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, margin: "-8px 0 10px", padding: "8px 12px", border: "1px solid #ece5d7", borderRadius: 10, background: "#fff", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10.5, color: "#6b6356", fontWeight: 600 }}>10Y SOFR OIS swap, month-end</div>
            <div style={{ fontSize: 11, color: "#a89f8f" }}>{hist[0].month} {hist[0].value.toFixed(2)}% → {hist[hist.length - 1].month} {hist[hist.length - 1].value.toFixed(2)}%</div>
          </div>
          <Sparkline series={hist} title="10-year SOFR swap, month-end, last 12 months" />
        </div>
      )}
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ background: "transparent", border: "1px solid #e3dccd", color: "#5c5047", padding: "7px 12px", minHeight: 34, borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
        {open ? "Close" : "Paste today's SOFR OIS curve (e.g. Chatham)"}
      </button>
      {open && (
        <div style={{ marginTop: 8, padding: 10, border: "1px solid #ece5d7", borderRadius: 10, background: "#fff" }}>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder={"1Y 4.495\n2Y 4.620\n5Y 4.628\n10Y 4.708"} aria-label="Pasted swap curve"
            style={{ ...input, width: "100%", resize: "vertical", fontFamily: "ui-monospace, Menlo, monospace" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input value={src} onChange={e => setSrc(e.target.value)} aria-label="Where it's from" placeholder="Source" style={{ ...input, width: 140 }} />
            <button onClick={save} disabled={busy || text.trim().length < 4}
              style={{ background: "#3f7a1f", color: "#fff", border: "none", padding: "8px 14px", minHeight: 34, borderRadius: 8, cursor: busy ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", opacity: busy || text.trim().length < 4 ? 0.6 : 1 }}>Use this curve</button>
          </div>
          <div style={{ fontSize: 10.5, color: "#8a7f6d", marginTop: 6 }}>Paste the SOFR (annual/annual) column. Stamped with your name and the time. It replaces the DTCC curve for everyone until DTCC reports newer trades, and the 1M Term curve is derived from it.</div>
          {msg && <div style={{ fontSize: 11.5, color: "#3f5a2a", marginTop: 6 }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}

// Chatham mark: an admin pastes the text copied from cf.com/rates/us (1M Term + annual/annual
// tables, 1M Term SOFR spot). Never scraped (login wall + CME licensing notice). The site
// parses it, SHOWS what it read, and saves only on confirm — then it's the primary curve,
// recalibrates the Term basis, and DTCC's error vs it is logged per day.
function ChathamMarkBox({ data, isAdmin, onSaved }: { data: RatesPayload; isAdmin: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ChathamMarkParse | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const log = (data.chathamLog ?? []).slice(0, 8);
  const preview = async () => {
    setBusy(true); setMsg(null);
    try { setParsed(await apiPreviewChathamMark(text)); } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't read it"); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setMsg(null);
    try { const r = await apiSaveChathamMark(text); setMsg(`Saved as the Chatham mark for ${r.date}.`); setText(""); setParsed(null); onSaved(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save"); } finally { setBusy(false); }
  };
  const tenors = parsed ? [...new Set([...parsed.ois, ...parsed.term].map(p => p.tenor))].sort((a, b) => a - b) : [];
  const at = (arr: Array<{ tenor: number; rate: number }>, t: number) => arr.find(p => p.tenor === t)?.rate;
  if (!isAdmin && !log.length) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      {log.length > 0 && (
        <div style={{ border: "1px solid #ece5d7", borderRadius: 10, background: "#fff", padding: "8px 12px", marginBottom: 8 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#6b6356", marginBottom: 4 }}>DTCC vs Chatham mark (worst miss at 2Y–10Y)</div>
          {log.map(l => (
            <div key={l.date} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, color: "#4a4d46", padding: "2px 0", fontVariantNumeric: "tabular-nums" }}>
              <span>{l.date}{l.enteredBy ? ` · ${l.enteredBy}` : ""}</span>
              <span style={{ color: l.maxAbsErrorBp2to10 == null ? "#a89f8f" : l.maxAbsErrorBp2to10 <= 1 ? "#3f7a1f" : "#b45309", fontWeight: 600 }}>
                {l.maxAbsErrorBp2to10 == null ? "no DTCC close that day" : `${l.maxAbsErrorBp2to10.toFixed(1)} bp`}
              </span>
            </div>
          ))}
        </div>
      )}
      {isAdmin && (
        <>
          <button onClick={() => setOpen(o => !o)} aria-expanded={open}
            style={{ background: "transparent", border: "1px solid #e8d48f", color: "#7a5b0c", padding: "7px 12px", minHeight: 34, borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
            {open ? "Close" : "Paste a Chatham mark"}
          </button>
          {open && (
            <div style={{ marginTop: 8, padding: 10, border: "1px solid #ece5d7", borderRadius: 10, background: "#fff" }}>
              <div style={{ fontSize: 11, color: "#6b6356", marginBottom: 6, lineHeight: 1.45 }}>On cf.com/rates/us, select the 1M Term SOFR and SOFR (annual/annual) swap tables (and the 1-Month Term SOFR rate), copy, and paste here. Nothing is saved until you check the preview.</div>
              <textarea value={text} onChange={e => { setText(e.target.value); setParsed(null); }} rows={6} aria-label="Pasted Chatham rates"
                style={{ ...input, width: "100%", resize: "vertical", fontFamily: "ui-monospace, Menlo, monospace" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button onClick={preview} disabled={busy || text.trim().length < 10}
                  style={{ background: "#fff", color: "#383a37", border: "1px solid #d8d2c1", padding: "8px 14px", minHeight: 34, borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", opacity: busy || text.trim().length < 10 ? 0.6 : 1 }}>Preview</button>
                {parsed && parsed.ois.length >= 2 && (
                  <button onClick={save} disabled={busy}
                    style={{ background: "#383A37", color: "#fff", border: "none", padding: "8px 14px", minHeight: 34, borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>Save as Chatham mark{parsed.date ? ` for ${parsed.date}` : ""}</button>
                )}
              </div>
              {parsed && (
                <div style={{ marginTop: 10, fontSize: 12, color: "#383a37" }}>
                  <div style={{ marginBottom: 4 }}><b>Date:</b> {parsed.date ?? "not found (today)"} · <b>1M Term SOFR:</b> {parsed.termSofr1m != null ? `${parsed.termSofr1m}%` : "not found"}</div>
                  {tenors.length > 0 ? (
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "2px 12px", fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ fontWeight: 700, color: "#6b6356" }}>Tenor</span><span style={{ fontWeight: 700, color: "#6b6356" }}>1M Term</span><span style={{ fontWeight: 700, color: "#6b6356" }}>annual/annual</span>
                      {tenors.map(t => (<span key={t} style={{ display: "contents" }}><span>{t}Y</span><span>{at(parsed.term, t)?.toFixed(3) ?? "—"}</span><span>{at(parsed.ois, t)?.toFixed(3) ?? "—"}</span></span>))}
                    </div>
                  ) : <div style={{ color: "#b45309" }}>No tenors read.</div>}
                  {parsed.warnings.map(w => <div key={w} style={{ color: "#b45309", marginTop: 4 }}>⚠ {w}</div>)}
                  {parsed.ois.length < 2 && <div style={{ color: "#b45309", marginTop: 4 }}>Needs at least two annual/annual tenors to save.</div>}
                </div>
              )}
              {msg && <div style={{ fontSize: 11.5, color: "#3f5a2a", marginTop: 6 }}>{msg}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function RatesPanel({ onClose, deal, isAdmin = false }: { onClose: () => void; deal?: { name: string; noi: number | null; price?: number | null } | null; isAdmin?: boolean }) {
  const [data, setData] = useState<RatesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError(null);
    try { setData(await apiGetRates(refresh)); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't fetch rates"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(false); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const treasuryRows = data ? data.treasuries.rows.filter(r => TREASURY_TENORS_SHOWN.includes(r.label)) : [];
  const term = data?.termSwapCurve;
  const bp = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}bp`;
  const termRows: RateRow[] = term ? term.points.map(p => ({ label: `SOFR Swap – 1M Term – ${p.tenor} Year`, value: p.rate, asOf: term.asOf,
    note: p.basisSource === "chatham" && term.fromKind === "chatham" && Math.abs(p.rate - (p.monthly + p.basisBp / 100)) < 0.0006
      ? `Chatham 1M Term · OIS ${p.oisRate.toFixed(3)} → ${p.monthly.toFixed(3)} ${bp(p.basisBp)}`
      : `OIS ${p.oisRate.toFixed(3)} → monthly ${p.monthly.toFixed(3)} ${bp(p.basisBp)}${p.basisSource === "measured" ? ` measured, ${p.basisPrints} prints` : p.basisSource === "chatham" ? " Chatham basis" : ""}` })) : [];

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9400, background: "rgba(38,40,31,0.42)", backdropFilter: "blur(2px)" }} />
      <div role="dialog" aria-label="Today's Rates" style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 9401, width: "min(460px, 100vw)", background: "#faf7f0", borderLeft: "1px solid #d8d2c1", boxShadow: "-8px 0 40px rgba(38,40,31,0.18)", display: "flex", flexDirection: "column", animation: "slideInRight 0.2s ease both" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #ece5d7", background: "#fff", flexShrink: 0 }}>
          <span style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 600, color: "#26281f" }}>Today's Rates</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => load(true)} disabled={loading} title="Refresh"
              style={{ background: "transparent", border: "1px solid #e3dccd", color: "#7d766a", padding: "5px 10px", minHeight: 32, borderRadius: 7, cursor: loading ? "default" : "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>{loading ? "Refreshing…" : "Refresh"}</button>
            <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "1px solid #e3dccd", color: "#7d766a", width: 32, height: 32, borderRadius: 7, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          {loading && !data && <div style={{ color: "#a89f8f", fontSize: 13, padding: "30px 0", textAlign: "center" }}>Fetching rates…</div>}
          {error && !data && <div style={{ color: "#c0392b", fontSize: 13, padding: "20px 0" }}>{error}</div>}
          {data && (
            <>
              <LoanSizing data={data} deal={deal} />
              <CapSpread data={data} />
              <Section title="SOFR" rows={data.sofr.rows} asOf={data.sofr.asOf} source={`${data.sofr.source}${data.sofrOvernight ? " · overnight SOFR: NY Fed" : ""}`} />
              {termRows.length > 0 && <Section title="SOFR Swap – 1M Term (monthly)" rows={termRows} asOf={term!.asOf} source={term!.source} badge={term!.fromKind === "chatham" ? "Chatham mark" : undefined}
                info="KPR's swapped loans hedge 1M CME Term SOFR. Overland (ONB) uses Daily Simple SOFR — use the OIS curve for that type of loan." />}
              <ChathamMarkBox data={data} isAdmin={isAdmin} onSaved={() => load(true)} />
              <SwapCurveSection data={data} onSaved={() => load(true)} />
              <Section title="Treasury yields" rows={treasuryRows} asOf={data.treasuries.asOf} source={data.treasuries.source} />
              <div style={{ fontSize: 10.5, color: "#8a7f6d", lineHeight: 1.5, marginTop: 4 }}>
                SOFR swap rates are read off every swap trade reported to DTCC's public price-dissemination feed: plain, spot-starting USD SOFR swaps, the median at each tenor of the trades done 3:00–5:00pm ET (or the latest 2 hours, or the whole day, when the close is thin), leaving out prints more than 10 bp from the day's pack and duplicate reports. Since 10/17/26 only trades executed on the curve date count (the DTCC file for a day also carries the prior day's late reports), and the close is 3:00–5:00pm ET — within 0.8 bp of Chatham at 2Y–10Y on 10/15 and 10/16. The 1M Term SOFR swap curve is derived from it: each OIS rate converted from annual to monthly compounding, plus a Term-vs-OIS basis by tenor (Chatham-measured: 1Y −1.2 bp to 30Y −0.2 bp; recalibrated from the latest pasted Chatham mark; DTCC's own Term prints only count when at least 5 clean ones exist at a tenor in the last 20 business days, capped at ±5 bp). A pasted Chatham mark is shown as the primary curve until DTCC has a newer close. It's market data for internal reference, not a dealer quote. Treasuries are the U.S. Treasury's official par curve; SOFR overnight is the NY Fed's.
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
