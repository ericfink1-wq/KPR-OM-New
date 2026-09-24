// Lazy loaders for the per-state LOCAL transfer-tax tables. The big tables (PA has a
// row for every municipality × school district) are split into their own chunks so
// they only download when a deal in that state is opened. While a table is loading
// the engine treats the locality as UNVERIFIED (range, red flag) — never a default.
import type { LocalTaxTable } from "../closingCostTypes";

const LOADERS: Record<string, () => Promise<LocalTaxTable>> = {
  CA: () => import("./ca").then((m) => m.CA_LOCAL),
  CT: () => import("./ct").then((m) => m.CT_LOCAL),
  IL: () => import("./il").then((m) => m.IL_LOCAL),
  MN: () => import("./mn").then((m) => m.MN_LOCAL),
  NY: () => import("./ny").then((m) => m.NY_LOCAL),
  OH: () => import("./oh").then((m) => m.OH_LOCAL),
  PA: () => import("./pa").then((m) => m.PA_LOCAL),
  WA: () => import("./wa").then((m) => m.WA_LOCAL),
};

export function hasLocalTable(state: string): boolean {
  return !!LOADERS[(state || "").toUpperCase()];
}

const cache = new Map<string, Promise<LocalTaxTable>>();
export function loadLocalTable(state: string): Promise<LocalTaxTable | undefined> {
  const st = (state || "").toUpperCase();
  const loader = LOADERS[st];
  if (!loader) return Promise.resolve(undefined);
  if (!cache.has(st)) cache.set(st, loader());
  return cache.get(st)!;
}

export const LAZY_LOCAL_STATES = Object.keys(LOADERS);
