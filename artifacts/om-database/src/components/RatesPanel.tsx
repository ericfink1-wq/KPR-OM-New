import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiGetRates, type RatesPayload, type RateRow } from "../lib/api";

// "Today's Rates" panel — benchmark interest rates from free official sources
// (Treasury par yields, NY Fed SOFR) plus indicative SOFR swaps. Each section
// shows its own as-of date so the freshness is always clear.
export default function RatesPanel({ onClose }: { onClose: () => void }) {
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
  const fmtAsOf = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
    if (isNaN(d.getTime())) return iso;
    // Date-only sources → show the date; timestamped → date + time.
    return iso.length <= 10
      ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
              <Section title="Treasury Yields" rows={data.treasuries.rows} asOf={data.treasuries.asOf} source={data.treasuries.source} />
              <Section title="SOFR" rows={data.sofr.rows} asOf={data.sofr.asOf} source={data.sofr.source} />
              <Section title="SOFR Swaps" rows={data.swaps.rows} asOf={data.swaps.asOf} source={data.swaps.source} note="estimate = matching Treasury + spread; not a live swap quote" />
              <div style={{ fontSize: 10.5, color: "#a89f8f", lineHeight: 1.5, marginTop: 4 }}>
                Treasury & SOFR are official daily figures (free public APIs). Swap rates are indicative estimates — there is no free real-time SOFR swap feed; for live swaps a paid data feed would be needed.
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
