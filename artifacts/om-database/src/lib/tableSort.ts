// One-column click-to-sort for simple tables (Asset Mgmt, 10/19/26). Click a header →
// ascending, again → descending. Sorts on each column's UNDERLYING value (money, %,
// ISO dates, days as numbers — never the display text), and a blank / "—" sinks to
// the bottom in BOTH directions. State + the per-table memory reuse useMultiSort
// (localStorage, try/catch inside), limited to a single level.

import { useCallback, useMemo } from "react";
import { useMultiSort, type SortDir, type SortLevel } from "./multiSort";

export type SortValue = number | string | boolean | null | undefined;
export interface SortCol<T> { key: string; label: string; value: (row: T) => SortValue }

export const isBlankValue = (v: SortValue): boolean =>
  v == null || (typeof v === "number" && !Number.isFinite(v)) || (typeof v === "string" && (v.trim() === "" || v.trim() === "—"));

const compare = (a: SortValue, b: SortValue): number => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
};

/** Pure: a sorted copy. Stable (ties keep their incoming order); blanks last either way. */
export function sortRows<T>(rows: T[], cols: SortCol<T>[], level: SortLevel | null | undefined): T[] {
  const col = level ? cols.find(c => c.key === level.key) : undefined;
  if (!col) return rows.slice();
  const sign = level!.dir === "asc" ? 1 : -1;
  return rows.map((row, i) => ({ row, i, v: col.value(row) })).sort((a, b) => {
    const ba = isBlankValue(a.v), bb = isBlankValue(b.v);
    if (ba !== bb) return ba ? 1 : -1;
    const r = ba ? 0 : compare(a.v, b.v) * sign;
    return r || a.i - b.i;
  }).map(x => x.row);
}

export interface TableSort<T> {
  level: SortLevel;
  cols: SortCol<T>[];
  sort: (rows: T[]) => T[];
  onSort: (key: string) => void;
  set: (key: string, dir: SortDir) => void;
  /** "▲" / "▼" on the active column, "" otherwise. */
  arrow: (key: string) => string;
  ariaSort: (key: string) => "ascending" | "descending" | "none";
  sortable: (key: string) => boolean;
}

export function useTableSort<T>(storageKey: string, cols: SortCol<T>[], def: SortLevel): TableSort<T> {
  const defaults = useMemo(() => [def], [def.key, def.dir]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = useMemo(() => cols.map(c => c.key), [cols]);
  const ms = useMultiSort(`kpr_sort_${storageKey}`, defaults, { defaultDir: "asc", validKeys: keys });
  const level = ms.levels[0] ?? def;
  const sort = useCallback((rows: T[]) => sortRows(rows, cols, level), [cols, level]);
  return {
    level, cols, sort,
    onSort: (key: string) => ms.onHeaderClick(key),
    set: (key: string, dir: SortDir) => ms.setLevels([{ key, dir }]),
    arrow: (key: string) => level.key === key ? (level.dir === "asc" ? "▲" : "▼") : "",
    ariaSort: (key: string) => level.key === key ? (level.dir === "asc" ? "ascending" : "descending") : "none",
    sortable: (key: string) => keys.includes(key),
  };
}
