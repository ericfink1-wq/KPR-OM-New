import type { Deal } from "../lib/idb";
import { analyzeLeaseVintage, type VintageBucket } from "../lib/leaseVintage";

// When each lease was PRICED — a rent roll dominated by old or COVID-era paper is
// systematically below today's market, and the center's own recent signings are the
// best market-rent evidence there is. Renders nothing when lease-start coverage is
// too thin to say anything honest.
const BUCKET_COLORS: Record<VintageBucket["key"], string> = {
  legacy: "#b3541a",      // old paper — the mark-to-market story
  "pre-covid": "#c9a84c",
  covid: "#e0a93e",       // priced when landlords had no leverage
  recent: "#3f7a1f",      // current market evidence
};

function fmtRent(r: number): string {
  if (r >= 1_000_000) return `$${(r / 1_000_000).toFixed(1)}M`;
  if (r >= 1_000) return `$${Math.round(r / 1_000)}K`;
  return `$${Math.round(r)}`;
}

export default function LeaseVintageCard({ deal }: { deal: Deal }) {
  const v = analyzeLeaseVintage(deal);
  if (!v || v.coveragePct < 40) return null;
  const visible = v.buckets.filter(b => b.sharePct >= 0.5);
  if (visible.length === 0) return null;

  return (
    <div style={{ background: "#fff", border: "1px solid #e7e0d2", borderRadius: 12, padding: "16px 18px", marginBottom: 12 }}>
      <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#958d80", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
        Lease Vintage — when the rents were priced
      </div>
      <div style={{ fontSize: 11, color: "#a89f8f", marginBottom: 12, fontFamily: "'Inter',sans-serif", lineHeight: 1.45 }}>
        Share of base rent by lease-signing era. Old and 2020–21 paper usually trails today's market.
      </div>

      {/* Segmented share bar */}
      <div style={{ display: "flex", height: 22, borderRadius: 6, overflow: "hidden", border: "1px solid #eee6d8" }}>
        {visible.map(b => (
          <div key={b.key} title={`${b.label}: ${fmtRent(b.rent)} (${Math.round(b.sharePct)}%) · ${b.count} lease${b.count === 1 ? "" : "s"}`}
            style={{ width: `${b.sharePct}%`, background: BUCKET_COLORS[b.key], minWidth: 3 }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
        {visible.map(b => (
          <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: BUCKET_COLORS[b.key] }} />
            <span style={{ fontSize: 10.5, color: "#7d766a", fontFamily: "'Inter',sans-serif" }}>
              {b.label} · <strong style={{ color: "#52554e" }}>{Math.round(b.sharePct)}%</strong>
            </span>
          </div>
        ))}
      </div>

      {/* The center's own market-rent proof */}
      {v.recentSpread && (
        <div style={{ marginTop: 10, padding: "8px 11px", background: v.recentSpread.spreadPct >= 10 ? "#f2faf0" : "#faf8f2", border: `1px solid ${v.recentSpread.spreadPct >= 10 ? "#d7e6c6" : "#eee6d8"}`, borderRadius: 7, fontSize: 11.5, color: "#52554e", fontFamily: "'Inter',sans-serif", lineHeight: 1.5 }}>
        <strong style={{ color: "#2a2c28" }}>Recent leasing spread:</strong> inline leases signed in the last 24 months run{" "}
          <strong>${v.recentSpread.newMedianPSF.toFixed(2)}/SF</strong> vs <strong>${v.recentSpread.oldMedianPSF.toFixed(2)}</strong> on 5+ year-old paper
          {" "}({v.recentSpread.spreadPct >= 0 ? "+" : ""}{Math.round(v.recentSpread.spreadPct)}%, {v.recentSpread.newCount} new / {v.recentSpread.oldCount} old) —
          the center's own evidence of where market rent sits.
        </div>
      )}

      {v.coveragePct < 90 && (
        <div style={{ fontSize: 10.5, color: "#a89f8f", marginTop: 8, fontFamily: "'Inter',sans-serif" }}>
          Based on {v.coveragePct}% of base rent (leases with a start date).
        </div>
      )}
    </div>
  );
}
