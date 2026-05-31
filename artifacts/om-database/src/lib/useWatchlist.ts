import { useState, useEffect } from "react";
import { tenantKey } from "./utils";

export interface WatchEntry {
  brand: string;
  status: "watch" | "distressed" | "bankruptcy" | "liquidating" | string;
  note: string | null;
  sourceUrl: string | null;
}

// Map keyed by canonical tenantKey(brand) -> entry. Used to flag distressed
// tenants in the roster / detail view. Same brand-grouping as the Watchlist tab.
export type WatchMap = Map<string, WatchEntry>;

// Module-level cache so every roster/detail view shares one fetch per session.
let cache: WatchMap | null = null;
let inflight: Promise<WatchMap> | null = null;
const subscribers = new Set<(m: WatchMap) => void>();

function load(): Promise<WatchMap> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch("/api/watchlist", { credentials: "include" })
    .then(r => (r.ok ? r.json() : []))
    .then((rows: WatchEntry[]) => {
      const m: WatchMap = new Map();
      if (Array.isArray(rows)) {
        for (const r of rows) {
          const k = tenantKey(r.brand);
          if (k) m.set(k, r);
        }
      }
      cache = m;
      subscribers.forEach(fn => fn(m));
      return m;
    })
    .catch(() => {
      const m: WatchMap = new Map();
      cache = m;
      return m;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Force a refetch (e.g. after editing the watchlist) so badges stay in sync. */
export function invalidateWatchlist() {
  cache = null;
  load();
}

/** Returns a Map<canonicalKey, WatchEntry>; empty until the first fetch resolves. */
export function useWatchlist(): WatchMap {
  const [map, setMap] = useState<WatchMap>(() => cache ?? new Map());
  useEffect(() => {
    let active = true;
    const fn = (m: WatchMap) => { if (active) setMap(m); };
    subscribers.add(fn);
    load().then(m => { if (active) setMap(m); });
    return () => { active = false; subscribers.delete(fn); };
  }, []);
  return map;
}

/** Look up one tenant name against the watchlist. */
export function lookupWatch(map: WatchMap, name: unknown): WatchEntry | undefined {
  const k = tenantKey(name);
  return k ? map.get(k) : undefined;
}

export const WATCH_STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  liquidating: { label: "Liquidating", color: "#fff",     bg: "#b3261e", border: "#b3261e" },
  bankruptcy:  { label: "Bankruptcy",  color: "#fff",     bg: "#d9534f", border: "#d9534f" },
  distressed:  { label: "Distressed",  color: "#7a4a00",  bg: "#fbe6cf", border: "#e8c49a" },
  watch:       { label: "Watchlist",   color: "#5a5340",  bg: "#f1eadc", border: "#ddd4c2" },
};
