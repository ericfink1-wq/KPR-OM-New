import { useEffect, useMemo, useState } from "react";
import type { Deal } from "../lib/idb";
import { isVacant, isNAPTenant, tenantKey } from "../lib/utils";
import { apiLoadTenantBenchmarks, type AnalystTenantBenchmark } from "../lib/api";
import { assessOptionOverhang } from "../lib/renewalOptionOverhang";
import ScopeToggle, { scopeDeals, type Scope } from "./ScopeToggle";

interface Props {
  deals: Deal[];
  onOpenDeal: (dealId: string) => void;
}

interface Gap {
  name: string;
  inPlace: number;
  median: number;
  sf: number | null;
  gapPct: number;       // + = below market (upside), − = premium
  annual: number | null; // $ /yr to market (gapPSF * sf), null if no SF
  locations: number;
  years: [number | null, number | null];
  // Renewal-option overhang: when the tenant holds fixed-rate options materially
  // below market, the upside isn't capturable — the tenant can just renew cheap.
  locked: boolean;
  lockNote: string | null;  // e.g. "options at $9.50/SF (up to 20 yrs)"
}

interface DealMtm {
  dealId: string;
  dealName: string;
  belowUpside: number;  // sum of annual upside for below-market leases past threshold (free, not option-locked)
  lockedUpside: number; // upside sitting behind below-market renewal options
  belowCount: number;
  rows: Gap[];          // below-market past threshold, biggest upside first
}

const THRESHOLDS = [10, 15, 20, 25];

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function fmtMoney(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

export default function MarkToMarket({ deals, onOpenDeal }: Props) {
  const [benchmarks, setBenchmarks] = useState<AnalystTenantBenchmark[] | null>(null);
  const [threshold, setThreshold] = useState(15);
  const [scope, setScope] = useState<Scope>("owned");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => { apiLoadTenantBenchmarks().then(setBenchmarks).catch(() => setBenchmarks([])); }, []);

  const ownedCount = useMemo(() => deals.filter(d => !d.trashedAt && d.status === "Owned").length, [deals]);
  const allCount = useMemo(() => deals.filter(d => !d.trashedAt).length, [deals]);
  const scopedDeals = useMemo(() => scopeDeals(deals, scope), [deals, scope]);
  const toggleCollapse = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const benchByKey = useMemo(() => {
    const m = new Map<string, AnalystTenantBenchmark>();
    for (const b of benchmarks || []) {
      if (b.medianRentPerSf == null || b.locations < 2) continue;
      m.set(tenantKey(b.brand), b);
    }
    return m;
  }, [benchmarks]);

  const perDeal = useMemo<DealMtm[]>(() => {
    const out: DealMtm[] = [];
    for (const d of scopedDeals) {
      if (d.trashedAt) continue;
      const rows: Gap[] = [];
      for (const t of d.tenants || []) {
        if (!t || isVacant(t.name) || isNAPTenant(t)) continue;
        const inPlace = num(t.rentPerSF);
        if (inPlace == null || inPlace <= 0) continue;
        const b = benchByKey.get(tenantKey(t.canonicalName || t.name || ""));
        if (!b || b.medianRentPerSf == null) continue;
        const median = b.medianRentPerSf;
        const sf = num(t.sf);
        const gapPct = ((median - inPlace) / median) * 100;
        const annual = sf != null ? (median - inPlace) * sf : null;
        const oh = assessOptionOverhang(t, median);
        const locked = oh?.status === "encumbered";
        const lockNote = locked && oh?.optionRentPSF != null
          ? `options at $${oh.optionRentPSF.toFixed(2)}/SF${oh.parsed.totalOptionYears ? ` (up to ${oh.parsed.totalOptionYears} yrs)` : ""}`
          : null;
        rows.push({ name: t.canonicalName || t.name || "Tenant", inPlace, median, sf, gapPct, annual, locations: b.locations, years: b.recencyYears, locked, lockNote });
      }
      const below = rows.filter(r => r.gapPct >= threshold).sort((a, b) => (b.annual ?? 0) - (a.annual ?? 0));
      const belowUpside = below.filter(r => !r.locked).reduce((s, r) => s + (r.annual ?? 0), 0);
      const lockedUpside = below.filter(r => r.locked).reduce((s, r) => s + (r.annual ?? 0), 0);
      if (below.length > 0) {
        out.push({ dealId: d.id, dealName: d.propertyName || d.address || "Untitled deal", belowUpside, lockedUpside, belowCount: below.length, rows: below });
      }
    }
    out.sort((a, b) => b.belowUpside - a.belowUpside);
    return out;
  }, [scopedDeals, benchByKey, threshold]);

  const totalUpside = perDeal.reduce((s, d) => s + d.belowUpside, 0);
  const totalLocked = perDeal.reduce((s, d) => s + d.lockedUpside, 0);
  const totalLeases = perDeal.reduce((s, d) => s + d.belowCount, 0);

  return (
    <div style={{ padding: "20px 18px 80px", maxWidth: 940, margin: "0 auto", width: "100%", boxSizing: "border-box", fontFamily: "'Inter',sans-serif" }}>
      <h2 style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: 22, fontWeight: 600, color: "#26281f", margin: "0 0 4px" }}>Mark-to-Market Upside</h2>
      <p style={{ fontSize: 12.5, color: "#7d766a", margin: "0 0 16px", lineHeight: 1.5 }}>
        In-place rents that sit below the same brand's portfolio-median rent — the rent you could recapture at rollover.
        Benchmarks are recency-weighted medians across your database (2+ locations), not third-party market data, so treat them as directional.
      </p>

      <div style={{ marginBottom: 12 }}>
        <ScopeToggle scope={scope} onChange={setScope} ownedCount={ownedCount} allCount={allCount} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: "#8b8578", fontWeight: 600 }}>At least</span>
        {THRESHOLDS.map(t => (
          <button key={t} onClick={() => setThreshold(t)}
            style={{ padding: "7px 13px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", minHeight: 34,
              border: `1px solid ${threshold === t ? "#6dba43" : "#e0d8c8"}`,
              background: threshold === t ? "#f0fae8" : "#fff",
              color: threshold === t ? "#3f7a1f" : "#8b8578" }}>
            {t}% below
          </button>
        ))}
      </div>

      {benchmarks == null ? (
        <p style={{ fontSize: 13, color: "#a89f8f", fontStyle: "italic" }}>Loading benchmarks…</p>
      ) : (
        <>
          {/* Portfolio rollup */}
          <div style={{ background: "#f4f8ef", border: "1px solid #d7e6c6", borderRadius: 12, padding: "16px 18px", marginBottom: 16, display: "flex", gap: 28, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 10.5, color: "#7a8a68", fontWeight: 600, marginBottom: 3 }}>Capturable upside / yr</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#2f6b1f", fontFamily: "'Fraunces',Georgia,serif", lineHeight: 1 }}>{fmtMoney(totalUpside)}</div>
            </div>
            {totalLocked > 0 && (
              <div title="Upside sitting behind fixed-rate renewal options priced below market — the tenant can renew at the cheap rate, so this rent isn't capturable while the options remain.">
                <div style={{ fontSize: 10.5, color: "#9a6b1f", fontWeight: 600, marginBottom: 3 }}>🔒 Locked by options / yr</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#9a6b1f", fontFamily: "'Fraunces',Georgia,serif", lineHeight: 1 }}>{fmtMoney(totalLocked)}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 10.5, color: "#7a8a68", fontWeight: 600, marginBottom: 3 }}>Below-market leases</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#2a2c28", fontFamily: "'Fraunces',Georgia,serif", lineHeight: 1 }}>{totalLeases}</div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: "#7a8a68", fontWeight: 600, marginBottom: 3 }}>Deals with upside</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#2a2c28", fontFamily: "'Fraunces',Georgia,serif", lineHeight: 1 }}>{perDeal.length}</div>
            </div>
          </div>

          {perDeal.length === 0 ? (
            <p style={{ fontSize: 13, color: "#a89f8f", fontStyle: "italic" }}>
              No leases are {threshold}%+ below their brand benchmark{scope === "owned" ? " among your owned deals" : ""}.
              {scope === "owned" ? " Switch to All deals, or l" : " L"}ower the threshold — or this may mean rents are at/above market,
              or that few tenants have a 2+ location benchmark yet.
            </p>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <button onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(perDeal.map(d => d.dealId)))}
                  style={{ background: "none", border: "none", color: "#3f7a1f", cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>
                  {collapsed.size ? "Expand all" : "Collapse all"}
                </button>
              </div>
              {perDeal.map(dm => {
            const isOpen = !collapsed.has(dm.dealId);
            return (
            <div key={dm.dealId} style={{ background: "#fff", border: "1px solid #e7e0d2", borderRadius: 12, padding: "10px 16px", marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                  <button onClick={() => onOpenDeal(dm.dealId)}
                    style={{ background: "none", border: "none", padding: 0, color: "#26281f", cursor: "pointer", fontWeight: 700, fontSize: 15, fontFamily: "'Fraunces',Georgia,serif", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                    {dm.dealName}
                  </button>
                  <button onClick={() => toggleCollapse(dm.dealId)} title={isOpen ? "Collapse" : "Expand"} aria-expanded={isOpen}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f4f1ea", border: "1px solid #e3dccd", borderRadius: 8, padding: "4px 10px", color: "#6b6356", cursor: "pointer", fontSize: 11, fontWeight: 700, flexShrink: 0, fontFamily: "'Inter',sans-serif", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    <span style={{ fontSize: 12, lineHeight: 1 }}>{isOpen ? "▾" : "▸"}</span>{isOpen ? "Collapse" : "Expand"}
                  </button>
                </div>
                <button onClick={() => toggleCollapse(dm.dealId)}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#2f6b1f", whiteSpace: "nowrap" }}>
                  {fmtMoney(dm.belowUpside)}/yr{dm.lockedUpside > 0 ? <span style={{ color: "#9a6b1f" }}> (+{fmtMoney(dm.lockedUpside)} 🔒)</span> : null} · {dm.belowCount} lease{dm.belowCount === 1 ? "" : "s"}
                </button>
              </div>
              {isOpen && (
                <div style={{ marginTop: 6 }}>
                  {dm.rows.map((r, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid #f4efe4", fontSize: 12.5 }}>
                      <div style={{ flex: 1, minWidth: 0, fontWeight: 600, color: "#2a2c28", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.name}
                        {r.locked && (
                          <span title={`Upside locked by below-market renewal ${r.lockNote ?? "options"} — the tenant can renew at the cheap rate.`}
                            style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: "#9a6b1f", background: "#fdf3e0", border: "1px solid #ecd9b4", borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>
                            🔒 {r.lockNote ?? "options below market"}
                          </span>
                        )}
                      </div>
                      <div style={{ color: "#7d766a", whiteSpace: "nowrap" }}>
                        ${r.inPlace.toFixed(2)} vs ${r.median.toFixed(2)} median
                        <span style={{ color: "#a89f8f" }}> ({r.locations} locs)</span>
                      </div>
                      <div style={{ width: 56, textAlign: "right", fontWeight: 700, color: "#b3711a" }}>{Math.round(r.gapPct)}%</div>
                      <div style={{ width: 70, textAlign: "right", fontWeight: 700, color: r.locked ? "#9a6b1f" : "#2f6b1f", textDecoration: r.locked ? "line-through" : "none" }}>{r.annual != null ? `${fmtMoney(r.annual)}/yr` : "—"}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            );
          })}
            </>
          )}
        </>
      )}
    </div>
  );
}
