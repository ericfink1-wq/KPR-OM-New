import { getRecency } from "../lib/utils";
import type { Deal } from "../lib/idb";

export default function RecencyBadge({ deal }: { deal: Deal }) {
  const r = getRecency(deal);
  if (!r) return null;
  return (
    <span style={{
      fontSize: 8.5, fontWeight: 700, letterSpacing: "0.1em",
      color: r.color, background: r.bg,
      padding: "2px 7px", borderRadius: 3, textTransform: "uppercase",
    }}>
      {r.label}
    </span>
  );
}
