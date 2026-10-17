import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiGetRates, apiLoadComps, type RatesPayload, type RateRow } from "../lib/api";

// "Today's Rates" panel — benchmark interest rates from free official sources
// (Treasury par yields, NY Fed SOFR) plus indicative SOFR swaps. Each section
// shows its own as-of date so the freshness is always clear.

// Treasury tenors shown in the panel. The backend feed still returns the full
// curve (1-Mo … 30-Yr) — the prepayment calc relies on it — but the panel only
// displays the tenors that matter for retail-center loans.
const TREASURY_TENORS_SHOWN = ["1-Yr", "2-Yr", "3-Yr", "5-Yr", "7-Yr", "10-Yr"];

// ── Debt sizing (Eric, 10/16/26: "SOFR swaps show Unavailable") ───────────────
// All-in fixed = 10-Yr Treasury + an adjustable spread. Cap-rate spread = median sale-comp
// cap (trailing 12 months, real single-asset sales only) − 10-Yr, month by month. Loan
// sizing for the deal that's open: the lower of the 1.30x DSCR and 9% debt-yield loans.
const mortgageConstant = (rate: number, years: number) => {
  if (years <= 0) return rate;                     // interest-only
  const r = rate / 12, n = years * 12;
  return (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) * 12;
};
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const usd = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;

function DebtSizing({ data, deal }: { data: RatesPayload; deal?: { name: string; noi: number | null } | null }) {
  const [spreadBps, setSpreadBps] = useState(200);
  const [dscr, setDscr] = useState(1.3);
  const [debtYield, setDebtYield] = useState(9);
  const [amortYrs, setAmortYrs] = useState(30);
  const [noiInput, setNoiInput] = useState<string>(deal?.noi ? String(Math.round(deal.noi)) : "");
  const [comps, setComps] = useState<Array<{ capRate?: number | null; saleDate?: string | null; isCompetitiveSet?: boolean; isPortfolioAllocation?: boolean }> | null>(null);
  useEffect(() => { apiLoadComps().then(r => setComps(r as never)).catch(() => setComps([])); }, []);
  const t10 = data.treasuries.rows.find(r => r.label === "10-Yr")?.value ?? null;
  const allIn = t10 != null ? t10 + spreadBps / 100 : null;

  // Monthly cap spread: median cap of sales in the 12 months ending that month − that month's 10-Yr.
  const spreadSeries = (() => {
    if (!comps || !data.tenYearMonthly?.length) return [] as Array<{ month: string; spread: number; n: number }>;
    const sales = comps.filter(c => !c.isCompetitiveSet && !c.isPortfolioAllocation && c.saleDate && typeof c.capRate === "number" && c.capRate >= 3 && c.capRate <= 12);
    return data.tenYearMonthly.map(p => {
      const end = new Date(p.month + "-01T00:00:00Z"); end.setUTCMonth(end.getUTCMonth() + 1);
      const start = new Date(end); start.setUTCFullYear(start.getUTCFullYear() - 1);
      const caps = sales.filter(c => { const t = Date.parse(String(c.saleDate)); return t >= start.getTime() && t < end.getTime(); }).map(c => c.capRate as number);
      return caps.length >= 4 ? { month: p.month, spread: median(caps) - p.value, n: caps.length } : null;
    }).filter(Boolean) as Array<{ month: string; spread: number; n: number }>;
  })();
  const latest = spreadSeries[spreadSeries.length - 1];

  const noi = Number(noiInput.replace(/[$,\s]/g, ""));
  const k = allIn != null ? mortgageConstant(allIn / 100, amortYrs) : null;
  const dscrLoan = noi > 0 && k ? noi / dscr / k : null;
  const dyLoan = noi > 0 ? noi / (debtYield / 100) : null;
  const binding = dscrLoan != null && dyLoan != null ? Math.min(dscrLoan, dyLoan) : null;

  const field = (label: string, value: number, set: (n: number) => void, step: number, suffix: string) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10, color: "#7d766a", fontWeight: 600 }}>
      {label}
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input type="number" inputMode="decimal" step={step} value={value} onChange={e => set(Number(e.target.value))} aria-label={label}
          style={{ width: 70, padding: "6px 8px", border: "1px solid #e3dccd", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }} />
        <span style={{ fontSize: 11 }}>{suffix}</span>
      </span>
    </label>
  );

  const spark = (() => {
    if (spreadSeries.length < 2) return null;
    const W = 160, H = 36, xs = spreadSeries.map(p => p.spread), lo = Math.min(...xs), hi = Math.max(...xs), rng = hi - lo || 1;
    const pts = spreadSeries.map((p, i) => `${(i / (spreadSeries.length - 1)) * W},${H - ((p.spread - lo) / rng) * (H - 4) - 2}`).join(" ");
    return <svg width={W} height={H} aria-label="Cap rate spread over the last 12 months" role="img"><polyline points={pts} fill="none" stroke="#3f7a1f" strokeWidth="1.8" /></svg>;
  })();

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5c5047", marginBottom: 8 }}>Debt sizing</div>
      <div style={{ border: "1px solid #ece5d7", borderRadius: 10, background: "#fff", padding: "12px 12px 10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
          {field("Spread over 10-Yr", spreadBps, setSpreadBps, 5, "bps")}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#7d766a", fontWeight: 600 }}>All-in fixed rate</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#26281f", fontVariantNumeric: "tabular-nums" }}>{allIn != null ? `${allIn.toFixed(2)}%` : "—"}</div>
            <div style={{ fontSize: 10, color: "#a89f8f" }}>{t10 != null ? `10-Yr ${t10.toFixed(2)}% + ${spreadBps} bps` : "10-Yr unavailable"}</div>
          </div>
        </div>
        <div style={{ borderTop: "1px solid #f3eee3", margin: "10px 0", paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, color: "#7d766a", fontWeight: 600 }}>Cap-rate spread (comp median cap − 10-Yr)</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#26281f" }}>{latest ? `${Math.round(latest.spread * 100)} bps` : "—"}</div>
            <div style={{ fontSize: 10, color: "#a89f8f" }}>{latest ? `${latest.n} sales in the 12 months to ${latest.month}` : comps == null ? "Loading comps…" : "Not enough recent sales"}</div>
          </div>
          {spark}
        </div>
        <div style={{ borderTop: "1px solid #f3eee3", paddingTop: 10 }}>
          <div style={{ fontSize: 10, color: "#7d766a", fontWeight: 600, marginBottom: 6 }}>Size a loan{deal?.name ? ` — ${deal.name}` : ""}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10, color: "#7d766a", fontWeight: 600 }}>
              NOI
              <input value={noiInput} onChange={e => setNoiInput(e.target.value)} inputMode="numeric" placeholder="e.g. 2,100,000" aria-label="NOI"
                style={{ width: 110, padding: "6px 8px", border: "1px solid #e3dccd", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }} />
            </label>
            {field("DSCR", dscr, setDscr, 0.05, "x")}
            {field("Debt yield", debtYield, setDebtYield, 0.25, "%")}
            {field("Amortization", amortYrs, setAmortYrs, 5, "yrs (0 = IO)")}
          </div>
          {binding != null ? (
            <div style={{ marginTop: 10, fontSize: 12.5, color: "#383a37", lineHeight: 1.6 }}>
              <div>At {dscr}x DSCR: <b>{usd(dscrLoan!)}</b> <span style={{ color: "#a89f8f" }}>(constant {(k! * 100).toFixed(2)}%)</span></div>
              <div>At {debtYield}% debt yield: <b>{usd(dyLoan!)}</b></div>
              <div style={{ marginTop: 3, fontWeight: 700, color: "#1f5d2b" }}>Max loan ≈ {usd(binding)} <span style={{ fontWeight: 500, color: "#7d766a" }}>({dscrLoan! <= dyLoan! ? "DSCR" : "debt yield"} binds)</span></div>
            </div>
          ) : (
            <div style={{ marginTop: 8, fontSize: 11.5, color: "#a89f8f" }}>{allIn == null ? "Needs the 10-Yr Treasury." : "Enter an NOI to size the loan."}</div>
          )}
        </div>
      </div>
      <div style={{ fontSize: 9.5, color: "#bcae97", marginTop: 5 }}>Indicative only — a lender's quote, reserves and their own NOI underwriting will differ.</div>
    </div>
  );
}

export default function RatesPanel({ onClose, deal }: { onClose: () => void; deal?: { name: string; noi: number | null } | null }) {
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

  const fmtPct = (v: number | null) => v == null ? "—" : `${v.toFixed(2)}%`;
  // Benchmark rates are quoted in market (Eastern) time. Render every timestamp
  // explicitly in America/New_York and label it "ET" so it never shifts with the
  // viewer's own time zone (and there's no ambiguity about what 10:33 means).
  const ET = "America/New_York";
  const fmtAsOf = (iso: string | null) => {
    if (!iso) return "—";
    // Date-only sources (e.g. Treasury "2026-06-01") have no clock time → show the
    // date. Anchor at noon UTC so the calendar date can't roll under tz conversion.
    if (iso.length <= 10) {
      const d = new Date(iso + "T12:00:00Z");
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: ET });
    }
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: ET }) + " ET";
  };

  const Section = ({ title, rows, asOf, source, note }: { title: string; rows: RateRow[]; asOf: string | null; source: string; note?: string }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5c5047" }}>{title}</span>
        <span style={{ fontSize: 10, color: "#a89f8f" }}>as of {fmtAsOf(asOf)}</span>
      </div>
      <div style={{ border: "1px solid #ece5d7", borderRadius: 10, overflow: "hidden" }}>
        {rows.map((r, i) => (
          <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: i % 2 ? "#faf7f0" : "#fff", borderTop: i ? "1px solid #f3eee3" : "none" }}>
            <span style={{ fontSize: 12.5, color: "#383a37" }}>{r.label}{r.note && <span style={{ fontSize: 10, color: "#b08a4e", marginLeft: 6 }}>({r.note})</span>}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#26281f", fontVariantNumeric: "tabular-nums" }}>{fmtPct(r.value)}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9.5, color: "#bcae97", marginTop: 5 }}>Source: {source}{note ? ` · ${note}` : ""}</div>
    </div>
  );

  // Trim the Treasury panel to the tenors Eric tracks, without touching the
  // backend feed (the prepay calc reads the full Treasury curve). SOFR and swaps
  // come back from the server already shaped (Iron Hound, NY Fed fallback), so
  // render those rows as-is.
  const treasuryRows = data ? data.treasuries.rows.filter(r => TREASURY_TENORS_SHOWN.includes(r.label)) : [];
  const sofrRows: RateRow[] = data?.sofr.rows ?? [];

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9400, background: "rgba(38,40,31,0.42)", backdropFilter: "blur(2px)" }} />
      <div role="dialog" aria-label="Today's Rates" style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 9401, width: "min(440px, 100vw)", background: "#faf7f0", borderLeft: "1px solid #d8d2c1", boxShadow: "-8px 0 40px rgba(38,40,31,0.18)", display: "flex", flexDirection: "column", animation: "slideInRight 0.2s ease both" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #ece5d7", background: "#fff", flexShrink: 0 }}>
          <span style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 600, color: "#26281f" }}>Today's Rates</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => load(true)} disabled={loading} title="Refresh"
              style={{ background: "transparent", border: "1px solid #e3dccd", color: "#7d766a", padding: "5px 10px", borderRadius: 7, cursor: loading ? "default" : "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>↻ Refresh</button>
            <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "1px solid #e3dccd", color: "#7d766a", width: 30, height: 30, borderRadius: 7, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          {loading && !data && <div style={{ color: "#a89f8f", fontSize: 13, padding: "30px 0", textAlign: "center" }}>Fetching rates…</div>}
          {error && !data && <div style={{ color: "#c0392b", fontSize: 13, padding: "20px 0" }}>{error}</div>}
          {data && (
            <>
              <DebtSizing data={data} deal={deal} />
              <Section title="SOFR" rows={sofrRows} asOf={data.sofr.asOf} source={data.sofr.source} />
              <Section title="SOFR Swaps" rows={data.swaps.rows} asOf={data.swaps.asOf} source={data.swaps.source} />
              <Section title="Treasury Yields" rows={treasuryRows} asOf={data.treasuries.asOf} source={data.treasuries.source} />
              <div style={{ fontSize: 10.5, color: "#a89f8f", lineHeight: 1.5, marginTop: 4 }}>
                Treasury yields are official daily figures from the U.S. Treasury. 1-Month Term SOFR and the 5- & 10-yr SOFR swaps are pulled from Iron Hound's market board (ironhound.com). Iron Hound doesn't quote a 3-yr swap, so it's estimated from the 3-yr Treasury plus the live 5-yr swap spread (shown as "est."). If Iron Hound is unreachable, the 1-month figure falls back to the NY Fed 30-day average and swaps are hidden. Hit Refresh to re-pull.
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
