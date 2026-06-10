import { useEffect, useMemo, useState } from "react";
import type { Deal } from "../lib/idb";
import { isVacant, isNAPTenant, tenantKey } from "../lib/utils";
import { apiLoadTenantBenchmarks, type AnalystTenantBenchmark } from "../lib/api";

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
}

interface DealMtm {
  dealId: string;
  dealName: string;
  belowUpside: number;  // sum of annual upside for below-market leases past threshold
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

  useEffect(() => { apiLoadTenantBenchmarks().then(setBenchmarks).catch(() => setBenchmarks([])); }, []);

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
    for (const d of deals) {
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
        rows.push({ name: t.canonicalName || t.name || "Tenant", inPlace, median, sf, gapPct, annual, locations: b.locations, years: b.recencyYears });
      }
      const below = rows.filter(r => r.gapPct >= threshold).sort((a, b) => (b.annual ?? 0) - (a.annual ?? 0));
      const belowUpside = below.reduce((s, r) => s + (r.annual ?? 0), 0);
      if (below.length > 0) {
        out.push({ dealId: d.id, dealName: d.propertyName || d.address || "Untitled deal", belowUpside, belowCount: below.length, rows: below });
      }
    }
    out.sort((a, b) => b.belowUpside - a.belowUpside);
    return out;
  }, [deals, benchByKey, threshold]);

  const totalUpside = perDeal.reduce((s, d) => s + d.belowUpside, 0);
  const totalLeases = perDeal.reduce((s, d) => s + d.belowCount, 0);

  return (
    <div style={{ padding: "20px 18px 80px", maxWidth: 940, margin: "0 auto", width: "100%", boxSizing: "border-box", fontFamily: "'Inter',sans-serif" }}>
      <h2 style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: 22, fontWeight: 600, color: "#26281f", margin: "0 0 4px" }}>Mark-to-Market Upside</h2>
      <p style={{ fontSize: 12.5, color: "#7d766a", margin: "0 0 16px", lineHeight: 1.5 }}>
        In-place rents that sit below the same brand's portfolio-median rent — the rent you could recapture at rollover.
        Benchmarks are recency-weighted medians across your database (2+ locations), not third-party market data, so treat them as directional.
      </p>

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
              <div style={{ fontSize: 10.5, color: "#7a8a68", fontWeight: 600, marginBottom: 3 }}>Total potential upside / yr</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#2f6b1f", fontFamily: "'Fraunces',Georgia,serif", lineHeight: 1 }}>{fmtMoney(totalUpside)}</div>
            </div>
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
              No leases are {threshold}%+ below their brand benchmark. Lower the threshold, or this may mean rents are at/above market —
              or that few tenants have a 2+ location benchmark yet.
            </p>
          ) : perDeal.map(dm => (
            <div key={dm.dealId} style={{ background: "#fff", border: "1px solid #e7e0d2", borderRadius: 12, padding: "12px 16px", marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                <button onClick={() => onOpenDeal(dm.dealId)}
                  style={{ background: "none", border: "none", padding: 0, color: "#26281f", cursor: "pointer", fontWeight: 700, fontSize: 15, fontFamily: "'Fraunces',Georgia,serif", textAlign: "left" }}>
                  {dm.dealName}
                </button>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#2f6b1f" }}>
                  {fmtMoney(dm.belowUpside)}/yr · {dm.belowCount} lease{dm.belowCount === 1 ? "" : "s"}
                </span>
              </div>
              {dm.rows.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: i === 0 ? "none" : "1px solid #f4efe4", fontSize: 12.5 }}>
                  <div style={{ flex: 1, minWidth: 0, fontWeight: 600, color: "#2a2c28", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                  <div style={{ color: "#7d766a", whiteSpace: "nowrap" }}>
                    ${r.inPlace.toFixed(2)} vs ${r.median.toFixed(2)} median
                    <span style={{ color: "#a89f8f" }}> ({r.locations} locs)</span>
                  </div>
                  <div style={{ width: 56, textAlign: "right", fontWeight: 700, color: "#b3711a" }}>{Math.round(r.gapPct)}%</div>
                  <div style={{ width: 70, textAlign: "right", fontWeight: 700, color: "#2f6b1f" }}>{r.annual != null ? `${fmtMoney(r.annual)}/yr` : "—"}</div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
