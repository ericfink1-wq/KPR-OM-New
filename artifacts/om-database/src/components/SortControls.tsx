import type { CSSProperties, ReactNode } from "react";
import type { TableSort } from "../lib/tableSort";

/** A header cell that sorts its column: click → ascending, again → descending, ▲/▼ on the active one. */
export function SortTh<T>({ sort, k, children, style, as = "th" }: { sort: TableSort<T>; k: string; children?: ReactNode; style?: CSSProperties; as?: "th" | "div" }) {
  const Cell = as;
  if (!sort.sortable(k)) return <Cell style={style}>{children}</Cell>;
  const right = style?.textAlign === "right";
  return (
    <Cell style={style} aria-sort={sort.ariaSort(k)} role={as === "div" ? "columnheader" : undefined}>
      <button type="button" onClick={() => sort.onSort(k)} title="Sort by this column"
        style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3, flexDirection: right ? "row-reverse" : "row", maxWidth: "100%" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
        <span aria-hidden style={{ fontSize: 9, minWidth: 8, color: "#383A37" }}>{sort.arrow(k)}</span>
      </button>
    </Cell>
  );
}

/** Phone card views: a small "Sort by" dropdown over the same sort state. */
export function SortSelect<T>({ sort, style }: { sort: TableSort<T>; style?: CSSProperties }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#676767", margin: "0 0 8px", ...style }}>
      Sort by
      <select value={`${sort.level.key}:${sort.level.dir}`} onChange={e => { const [k, d] = e.target.value.split(":"); sort.set(k, d === "desc" ? "desc" : "asc"); }}
        style={{ fontSize: 13, padding: "6px 8px", minHeight: 34, border: "1px solid #d9d8d2", borderRadius: 8, background: "#fff", color: "#232422", fontFamily: "inherit" }}>
        {sort.cols.flatMap(c => [
          <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label} ▲</option>,
          <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label} ▼</option>,
        ])}
      </select>
    </label>
  );
}
