// Lazy loaders for the per-state LOCAL transfer-tax tables. The big tables (PA has a
// row for every municipality × school district) are split into their own chunks so
// they only download when a deal in that state is opened. While a table is loading
// the engine treats the locality as UNVERIFIED (range, red flag) — never a default.
import type { LocalTaxTable } from "../closingCostTypes";

const LOADERS: Record<string, () => Promise<LocalTaxTable>> = {
  AK: () => import("./ak").then((m) => m.AK_LOCAL),
  CA: () => import("./ca").then((m) => m.CA_LOCAL),
  CO: () => import("./co").then((m) => m.CO_LOCAL),
  CT: () => import("./ct").then((m) => m.CT_LOCAL),
  DE: () => import("./de").then((m) => m.DE_LOCAL),
  FL: () => import("./fl").then((m) => m.FL_LOCAL),
  IL: () => import("./il").then((m) => m.IL_LOCAL),
  LA: () => import("./la").then((m) => m.LA_LOCAL),
  MA: () => import("./ma").then((m) => m.MA_LOCAL),
  MD: () => import("./md").then((m) => m.MD_LOCAL),
  MN: () => import("./mn").then((m) => m.MN_LOCAL),
  NC: () => import("./nc").then((m) => m.NC_LOCAL),
  NV: () => import("./nv").then((m) => m.NV_LOCAL),
  NY: () => import("./ny").then((m) => m.NY_LOCAL),
  OH: () => import("./oh").then((m) => m.OH_LOCAL),
  OR: () => import("./or").then((m) => m.OR_LOCAL),
  PA: () => import("./pa").then((m) => m.PA_LOCAL),
  VA: () => import("./va").then((m) => m.VA_LOCAL),
  WA: () => import("./wa").then((m) => m.WA_LOCAL),
  WV: () => import("./wv").then((m) => m.WV_LOCAL),
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
