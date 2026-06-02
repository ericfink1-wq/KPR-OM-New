import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiGetRates, type RatesPayload, type RateRow } from "../lib/api";

// "Today's Rates" panel — benchmark interest rates from free official sources
// (Treasury par yields, NY Fed SOFR) plus indicative SOFR swaps. Each section
// shows its own as-of date so the freshness is always clear.

// Treasury tenors shown in the panel. The backend feed still returns the full
// curve (1-Mo … 30-Yr) — the prepayment calc relies on it — but the panel only
// displays the tenors that matter for retail-center loans.
const TREASURY_TENORS_SHOWN = ["1-Yr", "2-Yr", "3-Yr", "5-Yr", "7-Yr", "10-Yr"];

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
