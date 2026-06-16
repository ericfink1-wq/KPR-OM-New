import { useMemo } from "react";
import type { Deal } from "../lib/idb";
import { buildPortfolioBenchmarks, fmtMetric, type MetricBenchmark } from "../lib/portfolioBenchmark";

// Benchmarks this deal's going-in cap, expense ratio, and in-place rent PSF against
// comparable deals in your own portfolio (same center type when there are enough peers,
// else the whole book). Informational — no stored numbers change.

interface Props { deal: Deal; allDeals?: Deal[]; }

const C = {
  ink: "#383a37", sub: "#6f6a5f", faint: "#a69e91", line: "#efe8da", panel: "#faf7f0", panelBd: "#e7e0d2",
  green: "#3f7a1f", greenBg: "#eef3e6", amber: "#c97a18", amberBg: "#fbf1e4", track: "#ece5d6",
};

// Position the subject on the p25–p75 band (clamped a touch past the ends).
function pos(b: MetricBenchmark): number {
  const lo = b.p25, hi = b.p75;
  if (hi <= lo) return 50;
  return Math.max(4, Math.min(96, ((b.subject - lo) / (hi - lo)) * 100));
}
// A higher cap rate and higher rent are "good"; a higher expense ratio is "bad".
function tone(b: MetricBenchmark): string {
  const above = b.subject > b.p75, below = b.subject < b.p25;
  if (b.metric === "expenseRatio") return above ? C.amber : C.green;
  if (b.metric === "capRate") return below ? C.amber : C.green;
  return above ? C.green : below ? C.green : C.sub; // rentPSF: below = upside (good), neutral otherwise
}

export default function PortfolioBenchmarksCard({ deal, allDeals }: Props) {
  const benchmarks = useMemo(() => buildPortfolioBenchmarks(deal, allDeals ?? []), [deal, allDeals]);
  if (benchmarks.length === 0) return null;

  return (
    <div id="section-portfolio-benchmarks" data-jump="Portfolio Benchmarks"
      style={{ background: C.panel, border: `1px solid ${C.panelBd}`, borderRadius: 8, padding: "14px 16px", marginTop: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 8, letterSpacing: "0.1em", color: "#958d80", marginBottom: 2 }}>BENCHMARKED AGAINST YOUR PORTFOLIO</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 10 }}>How this deal compares to your book</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {benchmarks.map((b) => {
          const t = tone(b);
          return (
            <div key={b.metric} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.03em", color: C.sub, textTransform: "uppercase" }}>{b.label}</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: t }}>{fmtMetric(b.metric, b.subject)}</span>
              </div>

              {/* p25 — median — p75 band with the subject marker */}
              <div style={{ marginTop: 8, position: "relative", height: 22 }}>
                <div style={{ position: "absolute", top: 9, left: 0, right: 0, height: 4, background: C.track, borderRadius: 2 }} />
                <div style={{ position: "absolute", top: 7, left: "50%", width: 2, height: 8, background: C.faint, transform: "translateX(-1px)" }} title={`median ${fmtMetric(b.metric, b.median)}`} />
                <div style={{ position: "absolute", top: 4, left: `${pos(b)}%`, width: 10, height: 10, borderRadius: "50%", background: t, border: "2px solid #fff", boxShadow: "0 0 0 1px " + t, transform: "translateX(-5px)" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: C.faint, marginTop: -2 }}>
                <span>p25 {fmtMetric(b.metric, b.p25)}</span>
                <span>median {fmtMetric(b.metric, b.median)}</span>
                <span>p75 {fmtMetric(b.metric, b.p75)}</span>
              </div>

              <div style={{ fontSize: 11, color: C.ink, lineHeight: 1.45, marginTop: 6 }}>{b.read}</div>
              <div style={{ fontSize: 9.5, color: C.faint, marginTop: 3 }}>
                n = {b.n} {b.peerGroup}{b.geoCaveat ? " · rents vary by market — directional" : ""}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: C.faint, lineHeight: 1.5 }}>
        Peer set = comparable deals in your own database; medians + p25/p75, computed in code. Informational — it changes no underwriting numbers.
      </div>
    </div>
  );
}
