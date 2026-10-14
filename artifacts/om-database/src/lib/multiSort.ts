// Multi-column sorting shared by the site's tables.
//
// A sort is an ordered list of LEVELS: sort by the first, break ties with the
// second, and so on ("Status ▲, then Last upload ▼"). Clicking a header makes that
// column the only level (or flips it if it's already first); Shift-click — or the
// "+ then by" control in SortBar, which works on touch screens — adds it as the
// next tiebreaker. Pure functions here; useMultiSort wraps them in React state.

import { useCallback, useState } from "react";

export type SortDir = "asc" | "desc";
export interface SortLevel { key: string; dir: SortDir }

/** More than this stops being readable and never changes the order in practice. */
export const MAX_SORT_LEVELS = 4;

const flip = (d: SortDir): SortDir => (d === "asc" ? "desc" : "asc");

/**
 * The new sort after a header click.
 * - plain click on the PRIMARY column → flip its direction, keep the tiebreakers
 * - plain click on any other column   → sort by that column alone
 * - additive click on a column already in the chain → flip that level only
 * - additive click on a new column    → append it as the next tiebreaker
 */
export function clickSort(levels: SortLevel[], key: string, additive: boolean, defaultDir: SortDir = "desc"): SortLevel[] {
  const at = levels.findIndex(l => l.key === key);
  if (additive) {
    if (at >= 0) return levels.map((l, i) => (i === at ? { ...l, dir: flip(l.dir) } : l));
    if (levels.length >= MAX_SORT_LEVELS) return levels;
    return [...levels, { key, dir: defaultDir }];
  }
  if (at === 0) return levels.map((l, i) => (i === 0 ? { ...l, dir: flip(l.dir) } : l));
  return [{ key, dir: defaultDir }];
}

export function removeSortLevel(levels: SortLevel[], key: string): SortLevel[] {
  return levels.filter(l => l.key !== key);
}

/** Move a level one place earlier (higher priority). */
export function promoteSortLevel(levels: SortLevel[], key: string): SortLevel[] {
  const i = levels.findIndex(l => l.key === key);
  if (i <= 0) return levels;
  const next = levels.slice();
  [next[i - 1], next[i]] = [next[i], next[i - 1]];
  return next;
}

export function flipSortLevel(levels: SortLevel[], key: string): SortLevel[] {
  return levels.map(l => (l.key === key ? { ...l, dir: flip(l.dir) } : l));
}

/**
 * Build one comparator from the chain. `ascending(key)` returns an ASCENDING
 * comparator for that column (or null for an unknown key, which is skipped);
 * `tiebreak` runs last so equal rows keep a stable, predictable order.
 */
export function chainComparator<T>(
  levels: SortLevel[],
  ascending: (key: string) => ((a: T, b: T) => number) | null,
  tiebreak?: (a: T, b: T) => number,
  /** Rows with no value for a column sink to the BOTTOM in either direction — a
   *  cap-rate sort shouldn't lead with every deal that never stated one. */
  missing?: (key: string, row: T) => boolean,
): (a: T, b: T) => number {
  const parts = levels
    .map(l => ({ key: l.key, cmp: ascending(l.key), sign: l.dir === "asc" ? 1 : -1 }))
    .filter((p): p is { key: string; cmp: (a: T, b: T) => number; sign: number } => !!p.cmp);
  return (a, b) => {
    for (const p of parts) {
      if (missing) {
        const ma = missing(p.key, a), mb = missing(p.key, b);
        if (ma !== mb) return ma ? 1 : -1;
        if (ma && mb) continue;
      }
      const r = p.cmp(a, b);
      if (r !== 0) return r * p.sign;
    }
    return tiebreak ? tiebreak(a, b) : 0;
  };
}

/** True for null / undefined / blank / non-numeric-when-numeric values. */
export function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** Header label suffix: "▲" for a single level, "▲1" / "▼2" once there's a chain. */
export function sortMarker(levels: SortLevel[], key: string): string {
  const i = levels.findIndex(l => l.key === key);
  if (i < 0) return "";
  const arrow = levels[i].dir === "asc" ? "▲" : "▼";
  return levels.length > 1 ? ` ${arrow}${i + 1}` : ` ${arrow}`;
}

function sameLevels(a: SortLevel[], b: SortLevel[]): boolean {
  return a.length === b.length && a.every((l, i) => l.key === b[i].key && l.dir === b[i].dir);
}

function loadLevels(storageKey: string | null, fallback: SortLevel[], validKeys?: string[]): SortLevel[] {
  if (!storageKey) return fallback;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as SortLevel[];
    const ok = Array.isArray(parsed) && parsed.length > 0 && parsed.length <= MAX_SORT_LEVELS
      && parsed.every(l => l && typeof l.key === "string" && (l.dir === "asc" || l.dir === "desc")
        && (!validKeys || validKeys.includes(l.key)));
    return ok ? parsed : fallback;
  } catch { return fallback; }
}

/**
 * React state for a multi-column sort. Remembers the person's chain per table in
 * this browser (a convenience only — clearing it just restores the default).
 */
export function useMultiSort(storageKey: string | null, defaults: SortLevel[], opts: { defaultDir?: SortDir; validKeys?: string[]; dirFor?: (key: string) => SortDir } = {}) {
  const [levels, setLevelsRaw] = useState<SortLevel[]>(() => loadLevels(storageKey, defaults, opts.validKeys));
  const setLevels = useCallback((next: SortLevel[]) => {
    const final = next.length ? next : defaults;
    setLevelsRaw(final);
    if (storageKey) {
      try {
        if (sameLevels(final, defaults)) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, JSON.stringify(final));
      } catch { /* storage unavailable — sort still works for this visit */ }
    }
  }, [storageKey, defaults]);

  const onHeaderClick = useCallback((key: string, e?: { shiftKey?: boolean }) => {
    setLevels(clickSort(levels, key, !!e?.shiftKey, opts.dirFor?.(key) ?? opts.defaultDir ?? "desc"));
  }, [levels, setLevels, opts.defaultDir, opts.dirFor]);

  return {
    levels,
    setLevels,
    onHeaderClick,
    marker: (key: string) => sortMarker(levels, key),
    isSorted: (key: string) => levels.some(l => l.key === key),
    isDefault: sameLevels(levels, defaults),
    reset: () => setLevels(defaults),
  };
}
