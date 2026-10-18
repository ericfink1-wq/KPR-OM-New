import { useMemo } from "react";
import type { Deal } from "../lib/idb";
import { getOwnedProperties } from "../lib/ownedPortfolio";
import { buildDebtRows, buildSwapRows, debtTotals } from "../lib/assetMgmt";
import { useAmData } from "./AssetMgmt";

// Home hero live KPIs (Eric, 10/18/26): owned occupancy from Datex, NOI trailing-12 vs budget,
// total debt + weighted rate, next maturity. Lazy-loaded (it pulls the Asset Mgmt records),
// so the first screen never waits on it. Every figure says where it came from.
const fmtM = (v: number) => Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`;
const fmtD = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export function heroDatexKpis(owned: Deal[]): { occPct: number | null; occN: number; noiTtm: number | null; noiBudget: number | null; ytdVarPct: number | null; noiN: number } {
  let occ = 0, gla = 0, occN = 0, ttm = 0, bud = 0, ytdA = 0, ytdB = 0, noiN = 0;
  for (const d of owned) {
    const dx = d.datexLive as unknown as Record<string, unknown> | null | undefined;
    if (!dx) continue;
    const g = Number(dx.totalGLA), o = Number(dx.occupiedGLA), p = Number(dx.occupancyPct);
    if (g > 0 && (o >= 0 || p >= 0)) { gla += g; occ += o >= 0 && Number.isFinite(o) ? o : (g * p) / 100; occN++; }
    const f = dx.financials as Record<string, unknown> | undefined;
    if (f && Number.isFinite(Number(f.noiTtmActual))) {
      ttm += Number(f.noiTtmActual); noiN++;
      if (Number.isFinite(Number(f.noiYearBudget))) bud += Number(f.noiYearBudget);
      if (Number.isFinite(Number(f.noiYtdActual)) && Number(f.noiYtdBudget)) { ytdA += Number(f.noiYtdActual); ytdB += Number(f.noiYtdBudget); }
    }
  }
  return { occPct: gla > 0 ? Math.round((occ / gla) * 1000) / 10 : null, occN, noiTtm: noiN ? ttm : null, noiBudget: bud || null, ytdVarPct: ytdB ? Math.round((ytdA / ytdB - 1) * 1000) / 10 : null, noiN };
}

function Tile({ v, l, s }: { v: string; l: string; s?: string }) {
  return (
    <div className="kpr-stat dark" style={{ padding: "12px 14px" }}>
      <div className="kpr-stat-v" style={{ fontSize: "clamp(19px,1.8vw,25px)" }}>{v}</div>
      <div className="kpr-stat-l" style={{ fontSize: 10.5 }}>{l}</div>
      {s && <div className="kpr-stat-s" style={{ fontSize: 11.5 }}>{s}</div>}
    </div>
  );
}

export default function HomeHeroKpis({ deals }: { deals: Deal[] }) {
  const owned = useMemo(() => getOwnedProperties(deals), [deals]);
  const { records, rates } = useAmData(owned.length > 0);
  const today = useMemo(() => new Date(), []);
  const dx = useMemo(() => heroDatexKpis(owned), [owned]);
  const debt = useMemo(() => {
    if (!records) return null;
    const rows = buildDebtRows(records, owned, rates, today);
    const t = debtTotals(rows, buildSwapRows(records, new Map(), rates, today));
    const next = rows.filter(r => !r.superseded && r.maturity && (r.daysToMaturity ?? -1) >= 0).sort((a, b) => a.maturity!.localeCompare(b.maturity!))[0] ?? null;
    return { t, next };
  }, [records, owned, rates, today]);
  if (!owned.length) return null;
  return (
    <div className="kpr-hero-panel" aria-label="Owned portfolio, live">
      <div className="kpr-eyebrow kpr-eyebrow-dark" style={{ marginBottom: 8 }}>Owned portfolio · live</div>
      <div className="kpr-rule-grid kpr-rule-grid-dark" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
        <Tile v={dx.occPct != null ? `${dx.occPct.toFixed(1)}%` : "—"} l="Occupancy" s={dx.occN ? `Datex · ${dx.occN} propert${dx.occN === 1 ? "y" : "ies"}` : "no Datex snapshot yet"} />
        <Tile v={dx.noiTtm != null ? fmtM(dx.noiTtm) : "—"} l="NOI trailing 12" s={dx.ytdVarPct != null ? `${dx.ytdVarPct >= 0 ? "+" : ""}${dx.ytdVarPct}% vs budget YTD` : dx.noiN ? "Datex" : "needs Datex financials"} />
        <Tile v={debt ? fmtM(debt.t.totalDebt) : "…"} l="Total debt" s={debt?.t.weightedRatePct != null ? `${debt.t.weightedRatePct.toFixed(2)}% weighted all-in` : debt ? "rates not on file" : "loading"} />
        <Tile v={debt?.next ? fmtD(debt.next.maturity!) : debt ? "—" : "…"} l="Next maturity" s={debt?.next ? `${debt.next.property}${debt.next.balance ? ` · ${fmtM(debt.next.balance)}` : ""}` : undefined} />
      </div>
    </div>
  );
}
