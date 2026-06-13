import { memo } from "react";
import { GRADE_COLORS } from "../lib/constants";
import type { Deal } from "../lib/idb";

interface Props {
  score?: Deal["dealScore"];
  size?: number;
}

// Pure presentational leaf (one per deal row) — memoized so it doesn't re-render
// when an unrelated parent state change (modal/selection) re-renders the grid.
function ScoreBadge({ score, size = 14 }: Props) {
  if (!score) return null;
  const color = GRADE_COLORS[score.grade] || "#a69e91";
  return (
    <span title={score.rationale || ""} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size * 2, height: size * 2, borderRadius: "50%",
      border: `1.5px solid ${color}55`, background: `${color}15`,
      fontFamily: "'Fraunces', serif", fontSize: size, fontWeight: 700,
      color, letterSpacing: "-0.02em", cursor: score.rationale ? "help" : "default",
      flexShrink: 0,
    }}>
      {score.grade}
    </span>
  );
}

export default memo(ScoreBadge);
