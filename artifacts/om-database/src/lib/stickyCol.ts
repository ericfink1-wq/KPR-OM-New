import type { CSSProperties } from "react";

// Freeze a wide table's first (name / identifier) column so it stays visible when
// the table is scrolled horizontally. Apply the returned styles to the FIRST
// <th>/<td> of every row, passing the cell's OPAQUE background (matching its row)
// so the scrolled-under columns don't show through the frozen cell.
//
// Mirrors the sticky-RIGHT action columns already used in CompsSearch / TenantView
// and the frozen label column in DetailView's cash-flow table, so the look (hairline
// divider + soft shadow on the frozen edge) is consistent across the app.
//
// DESKTOP ONLY: pair this with className="freeze-col" on the cell. The `.freeze-col`
// rule in index.css releases the freeze below 768px (useIsMobile's breakpoint), because
// on a phone a frozen column eats most of the width and blocks horizontal scrolling.
export function stickyFirstCol(bg: string, isHeader = false): CSSProperties {
  return {
    position: "sticky",
    left: 0,
    zIndex: isHeader ? 3 : 2,
    background: bg,
    borderRight: "1px solid #efe8da",
    boxShadow: "6px 0 6px -6px rgba(0,0,0,0.12)",
  };
}
