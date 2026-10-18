import { useState } from "react";
import type { Deal, PropertyHistoryEntry } from "../lib/idb";

// Running property history (Eric, 10/17/26): the newest document sets every figure, but
// what changed between documents — departures, backfills, renewals, anchor rent moves,
// NOI / occupancy then vs now — is kept here, dated by each document.
const KIND: Record<string, { label: string; color: string; bg: string }> = {
  backfill: { label: "Backfill", color: "#1d5f8a", bg: "#e8f1f8" },
  left: { label: "Left", color: "#a1361f", bg: "#fbece8" },
  arrived: { label: "New", color: "#2f6b1c", bg: "#ecf6e5" },
  renewed: { label: "Renewed", color: "#2f6b1c", bg: "#ecf6e5" },
  rent: { label: "Rent", color: "#6b5a1c", bg: "#f6f1e0" },
  dark: { label: "Dark", color: "#a1361f", bg: "#fbece8" },
  metric: { label: "Metric", color: "#4f5560", bg: "#eef0f2" },
};
const fmtDate = (v: string | null) => v ? new Date(v + "T00:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "undated";

export default function PropertyHistoryCard({ deal }: { deal: Deal }) {
  const hist = (deal.propertyHistory || []) as PropertyHistoryEntry[];
  const [open, setOpen] = useState(false);
  if (!hist.length) return null;
  const shown = open ? hist : hist.slice(0, 1);
  return (
    <div style={{ background: "#fff", border: "1px solid #dfddd6", borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 700, color: "#6b6a65" }}>Property history</div>
        <div style={{ fontSize: 11, color: "#9b9992" }}>Current figures come from the newest document; this is what changed before it.</div>
      </div>
      {shown.map(h => {
        const events = open ? h.events : h.events.slice(0, 6);
        return (
          <div key={h.id} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#232422" }}>
              {fmtDate(h.fromAsOf)} → {fmtDate(h.toAsOf)}
              <span style={{ fontWeight: 400, color: "#9b9992", fontSize: 11 }}> · {h.events.length} change{h.events.length === 1 ? "" : "s"}{h.fromSource ? ` · earlier: ${h.fromSource}` : ""}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>
              {events.map((e, i) => {
                const k = KIND[e.kind] ?? KIND.metric;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.45, color: "#383a37" }}>
                    <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: k.color, background: k.bg, borderRadius: 5, padding: "2px 6px", marginTop: 1, minWidth: 54, textAlign: "center" }}>{k.label}</span>
                    <span style={{ minWidth: 0 }}>{e.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {(hist.length > 1 || hist[0].events.length > 6) && (
        <button onClick={() => setOpen(o => !o)} style={{ marginTop: 10, background: "none", border: "none", padding: "6px 0", color: "#3e8a2f", fontWeight: 600, fontSize: 12, cursor: "pointer", minHeight: 32 }}>
          {open ? "Show less" : `Show all${hist.length > 1 ? ` (${hist.length} earlier documents)` : ""}`} ›
        </button>
      )}
    </div>
  );
}
