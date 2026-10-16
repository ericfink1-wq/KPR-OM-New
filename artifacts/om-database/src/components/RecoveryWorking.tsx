import type { OccBreakdown } from "../lib/idb";

// The working behind a calculated recovery figure, shown inside the occupancy-cost
// tooltip: bucket by bucket, then the "if it were fully NNN" comparison so the number
// can be eyeballed (Eric, 10/16/26: "if a fully NNN tenant would've paid $7 and this
// modified tenant comes back $5, that makes sense").
const fmt$ = (v: number) => `$${Math.round(v).toLocaleString()}`;

export function recoveryLabel(b: OccBreakdown): string {
  switch (b.reimbMethod) {
    case "calculated": return "+ Recoveries (calc.)";
    case "gross": return "+ Recoveries (gross lease)";
    case "centerSpread": return "+ Recoveries (est.)";
    case "disclosed": return "+ Recoveries";
    default: return b.reimbEstimated ? "+ Recoveries (est.)" : "+ Recoveries";
  }
}

export default function RecoveryWorking({ b }: { b: OccBreakdown }) {
  const lines = b.reimbLines ?? [];
  const showFull = b.reimbMethod === "calculated" && b.fullNnn != null && b.fullNnn > 0;
  if (!lines.length && !showFull && b.reimbMethod !== "gross") return null;
  return (
    <div style={{ margin: "0 0 5px 8px", paddingLeft: 7, borderLeft: "2px solid #efe8d9", color: "#8b8578", fontSize: 10.5, lineHeight: 1.45 }}>
      {b.reimbMethod === "gross" && <div>Gross lease: the OM says no recoveries are billed.</div>}
      {lines.map((l, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span style={{ minWidth: 0 }}>{l.label}</span><span style={{ flexShrink: 0 }}>{fmt$(l.amount)}</span>
        </div>
      ))}
      {showFull && (
        <div style={{ marginTop: 3, color: "#6f6a5f" }}>
          If fully NNN: {fmt$(b.fullNnn!)}
          {" "}({Math.round((b.reimbursements / b.fullNnn!) * 100)}% of that)
        </div>
      )}
      {b.reimbMethod === "calculated" && <div style={{ marginTop: 2 }}>Calculated from the lease's recovery terms × the OM's expense budget, year 1, before caps/escalations.</div>}
      {b.reimbMethod === "centerSpread" && <div style={{ marginTop: 2 }}>The OM gives no expense breakdown, so this is a share of its recovery total.</div>}
    </div>
  );
}
