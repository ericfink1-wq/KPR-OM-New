import { useState, useMemo, useCallback } from "react";
import { EyeOff } from "lucide-react";
import type { Deal } from "../lib/idb";
import { tenantKey, isVacant, isNAPTenant, tenantLabel, parentCompany } from "../lib/utils";
import { isInvestmentGrade } from "../lib/tenantCredit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtRent(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const x = Number(v);
  return isFinite(x) ? x : null;
}

function fmtPSF(v: number): string {
  return `$${Math.round(v)} PSF`;
}

// ---------------------------------------------------------------------------
// Aggregation types
// ---------------------------------------------------------------------------

interface SalesOccurrence {
  tenantKey: string;
  displayName: string;
  dealName: string;
  salesPSF: number;
  grossSales: number | null;
  salesYear: number | null;
}

interface TenantRow {
  key: string;
  displayName: string;
  locationCount: number;
  ownedCount: number;
  totalAnnualRent: number;
  totalSF: number;
  rentPSFValues: number[];
  isAnchor: boolean;
  creditRating: string | null;
  isIG: boolean;
  salesOccurrences: SalesOccurrence[];
  parentCo?: string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, marginBottom: 14 }}>
      {children}
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 12, padding: "20px 22px", ...style }}>
      {children}
    </div>
  );
}

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 10, padding: "14px 18px", minWidth: 0 }}>
      <div style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, marginBottom: 5, lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 500, color: "#26281f", lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "#a69e91", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function TenantLink({ name, onClick }: { name: string; onClick?: (name: string) => void }) {
  if (!onClick) return <span style={{ fontWeight: 600, color: "#383a37" }}>{name}</span>;
  return (
    <span
      onClick={() => onClick(name)}
      style={{ fontWeight: 600, color: "#383a37", cursor: "pointer", textDecoration: "underline", textDecorationColor: "#d8cfbd", textUnderlineOffset: "2px" }}
    >
      {name}
    </span>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ flex: 1, height: 8, background: "#f5f1ea", borderRadius: 4, overflow: "hidden", minWidth: 60 }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width 0.3s ease" }} />
    </div>
  );
}

function StackedBar({ igPct, notRatedPct }: { igPct: number; notRatedPct: number }) {
  return (
    <div style={{ display: "flex", height: 28, borderRadius: 8, overflow: "hidden", gap: 1.5, marginTop: 12 }}>
      {igPct > 0 && (
        <div
          title={`Investment Grade: ${igPct.toFixed(1)}% of rent`}
          style={{ flex: igPct, background: "#3f7a1f", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {igPct >= 10 && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}>{igPct.toFixed(0)}%</span>}
        </div>
      )}
      {notRatedPct > 0 && (
        <div
          title={`Not Rated / Non-IG: ${notRatedPct.toFixed(1)}% of rent`}
          style={{ flex: notRatedPct, background: "#c9c2b8", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {notRatedPct >= 10 && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}>{notRatedPct.toFixed(0)}%</span>}
        </div>
      )}
    </div>
  );
}

function PillToggle<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: "flex", background: "#f1eadc", borderRadius: 9, padding: 3, gap: 2 }}>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: "6px 14px",
            borderRadius: 7,
            border: "none",
            background: value === opt.value ? "#2a2c27" : "transparent",
            color: value === opt.value ? "#f6f2ea" : "#8a8579",
            fontSize: 12,
            fontWeight: value === opt.value ? 600 : 500,
            cursor: "pointer",
            fontFamily: "'Inter',sans-serif",
            letterSpacing: "-0.01em",
            boxShadow: value === opt.value ? "0 4px 14px -6px rgba(42,44,39,0.55)" : "none",
            whiteSpace: "nowrap",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ignore-toggle button
// ---------------------------------------------------------------------------

function IgnoreBtn({ ignored, onToggle }: { ignored: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(); }}
      title={ignored ? "Excluded from totals — click to re-include" : "Click to exclude from totals"}
      style={{
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 32,
        minHeight: 32,
        flexShrink: 0,
        color: ignored ? "#d9890c" : "#d4cdc4",
        transition: "color 0.15s",
      }}
    >
      <EyeOff size={13} strokeWidth={1.75} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  deals: Deal[];
  filter?: "all" | "owned";
  onTenantClick?: (name: string) => void;
  onParentClick?: (parent: string) => void;
  onTenantAudit?: () => void;
  onBack?: () => void;
}

export default function TenantAnalytics({ deals, filter: filterProp, onTenantClick, onParentClick, onTenantAudit, onBack }: Props) {
  const filter = filterProp ?? "all";
  const [salesMetric, setSalesMetric] = useState<"psf" | "gross">("psf");
  const [showAllParents, setShowAllParents] = useState(false);
  const [tenantSearch, setTenantSearch] = useState("");

  // Ignored tenants — persisted across refreshes
  const [ignoredKeys, setIgnoredKeys] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("ta-ignored-tenants");
      return stored ? new Set<string>(JSON.parse(stored)) : new Set<string>();
    } catch { return new Set<string>(); }
  });

  const toggleIgnore = useCallback((key: string) => {
    setIgnoredKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try { localStorage.setItem("ta-ignored-tenants", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const resetIgnored = useCallback(() => {
    setIgnoredKeys(new Set<string>());
    try { localStorage.removeItem("ta-ignored-tenants"); } catch {}
  }, []);

  // Aggregate tenants from all filtered deals
  const { rows, allOccurrences } = useMemo(() => {
    const filtered = filter === "owned"
      ? deals.filter(d => d.status === "Owned" || d.status === "Sold")
      : deals;

    const map = new Map<string, TenantRow>();

    for (const deal of filtered) {
      if (!deal.tenants) continue;
      const dealName = deal.propertyName || deal.fileName || "Unnamed";
      for (const t of deal.tenants) {
        const rawName = t.canonicalName || t.name;
        if (!rawName || isVacant(rawName)) continue;
        if (isNAPTenant(t)) continue;
        const key = tenantKey(rawName);
        const annualRent = num(t.annualRent) ?? 0;
        const rentPSF = num(t.rentPerSF);
        const salesPSF = num(t.salesPSF);
        const sf = num(t.sf);
        const ig = isInvestmentGrade(rawName, t.creditRating);

        if (!map.has(key)) {
          map.set(key, {
            key,
            displayName: rawName,
            locationCount: 0,
            ownedCount: 0,
            totalAnnualRent: 0,
            totalSF: 0,
            rentPSFValues: [],
            isAnchor: false,
            creditRating: t.creditRating ?? null,
            isIG: ig,
            salesOccurrences: [],
            parentCo: parentCompany(rawName, t.parentCompany) ?? undefined,
          });
        }
        const row = map.get(key)!;
        row.locationCount += 1;
        if (deal.status === "Owned" || deal.status === "Sold") row.ownedCount += 1;
        row.totalAnnualRent += annualRent;
        if (sf != null && sf > 0) row.totalSF += sf;
        if (rentPSF != null && rentPSF > 0) row.rentPSFValues.push(rentPSF);
        if (t.isAnchor) row.isAnchor = true;
        if (ig) row.isIG = true;

        if (salesPSF != null && salesPSF > 0) {
          const grossSales = sf != null && sf > 0 ? salesPSF * sf : null;
          row.salesOccurrences.push({
            tenantKey: key,
            displayName: rawName,
            dealName,
            salesPSF,
            grossSales,
            salesYear: t.salesYear ?? null,
          });
        }
      }
    }

    const rows = Array.from(map.values());
    const allOccurrences = rows.flatMap(r => r.salesOccurrences);
    return { rows, allOccurrences };
  }, [deals, filter]);

  // Active rows = all rows minus ignored
  const activeRows = useMemo(() => rows.filter(r => !ignoredKeys.has(r.key)), [rows, ignoredKeys]);

  // Totals derived from activeRows (so ignored tenants are excluded from stat boxes)
  const totalRent = useMemo(() => activeRows.reduce((s, r) => s + r.totalAnnualRent, 0), [activeRows]);

  // Derived lists — full rows so ignored appear dimmed but still in list
  const byRent  = useMemo(() => [...rows].sort((a, b) => b.totalAnnualRent - a.totalAnnualRent).slice(0, 10), [rows]);
  const byCount = useMemo(() => [...rows].sort((a, b) => b.locationCount - a.locationCount || b.totalAnnualRent - a.totalAnnualRent).slice(0, 10), [rows]);
  const bySF    = useMemo(() => [...rows].filter(r => r.totalSF > 0).sort((a, b) => b.totalSF - a.totalSF).slice(0, 10), [rows]);

  // All tenants sorted by rent desc — searchable full list
  const allTenantsSorted = useMemo(() => [...rows].sort((a, b) => b.totalAnnualRent - a.totalAnnualRent), [rows]);
  const filteredAllTenants = useMemo(() => {
    const q = tenantSearch.trim().toLowerCase();
    if (!q) return allTenantsSorted;
    return allTenantsSorted.filter(r => tenantLabel(r.displayName).toLowerCase().includes(q));
  }, [allTenantsSorted, tenantSearch]);
  const maxSF   = bySF[0]?.totalSF ?? 1;

  // Parent company exposure (excludes ignored tenants)
  const parentRows = useMemo(() => {
    const map = new Map<string, { parent: string; brands: Set<string>; totalAnnualRent: number; locationCount: number }>();
    for (const row of activeRows) {
      const p = row.parentCo;
      if (!p) continue;
      if (!map.has(p)) map.set(p, { parent: p, brands: new Set(), totalAnnualRent: 0, locationCount: 0 });
      const pr = map.get(p)!;
      pr.brands.add(row.displayName);
      pr.totalAnnualRent += row.totalAnnualRent;
      pr.locationCount += row.locationCount;
    }
    return [...map.values()].sort((a, b) => b.totalAnnualRent - a.totalAnnualRent);
  }, [activeRows]);

  // Credit / anchor — derived from activeRows
  const igCount = useMemo(() => activeRows.filter(r => r.isIG).length, [activeRows]);
  const igRent = useMemo(() => activeRows.filter(r => r.isIG).reduce((s, r) => s + r.totalAnnualRent, 0), [activeRows]);
  const anchorRent = useMemo(() => activeRows.filter(r => r.isAnchor).reduce((s, r) => s + r.totalAnnualRent, 0), [activeRows]);

  const igPct = totalRent > 0 ? (igRent / totalRent) * 100 : 0;
  const notRatedPct = 100 - igPct;
  const anchorPct = totalRent > 0 ? (anchorRent / totalRent) * 100 : 0;
  const inlinePct = 100 - anchorPct;

  const avgRentPSF = useMemo(() => {
    let weightedSum = 0, weightSum = 0;
    for (const row of activeRows) {
      if (row.rentPSFValues.length > 0) {
        const avg = row.rentPSFValues.reduce((a, b) => a + b, 0) / row.rentPSFValues.length;
        weightedSum += avg * row.totalAnnualRent;
        weightSum += row.totalAnnualRent;
      }
    }
    return weightSum > 0 ? weightedSum / weightSum : null;
  }, [activeRows]);

  // Sales — top individual stores
  const topStores = useMemo(() => {
    const valid = salesMetric === "psf"
      ? allOccurrences
      : allOccurrences.filter(o => o.grossSales != null);
    return [...valid]
      .sort((a, b) =>
        salesMetric === "psf"
          ? b.salesPSF - a.salesPSF
          : (b.grossSales ?? 0) - (a.grossSales ?? 0)
      )
      .slice(0, 10);
  }, [allOccurrences, salesMetric]);

  // Sales — top chains (≥2 reporting stores) by average metric
  const topChains = useMemo(() => {
    type ChainStat = {
      key: string;
      displayName: string;
      values: number[];
    };
    const chainMap = new Map<string, ChainStat>();

    for (const occ of allOccurrences) {
      const metricVal = salesMetric === "psf" ? occ.salesPSF : occ.grossSales;
      if (metricVal == null) continue;
      if (!chainMap.has(occ.tenantKey)) {
        chainMap.set(occ.tenantKey, { key: occ.tenantKey, displayName: occ.displayName, values: [] });
      }
      chainMap.get(occ.tenantKey)!.values.push(metricVal);
    }

    return Array.from(chainMap.values())
      .filter(c => c.values.length >= 2)
      .map(c => {
        const avg = c.values.reduce((a, b) => a + b, 0) / c.values.length;
        const min = Math.min(...c.values);
        const max = Math.max(...c.values);
        return { ...c, avg, min, max };
      })
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 10);
  }, [allOccurrences, salesMetric]);

  const hasSalesData = allOccurrences.length > 0;
  const maxRent = byRent[0]?.totalAnnualRent ?? 1;
  const maxCount = byCount[0]?.locationCount ?? 1;
  const maxStoreVal = topStores.length > 0
    ? (salesMetric === "psf" ? topStores[0].salesPSF : (topStores[0].grossSales ?? 1))
    : 1;
  const maxChainVal = topChains.length > 0 ? topChains[0].avg : 1;

  const salesOpts = [
    { value: "psf" as const, label: "Sales PSF" },
    { value: "gross" as const, label: "Gross Sales" },
  ];

  return (
    <div style={{ padding:"20px 24px", maxWidth:1100, margin:"0 auto" }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            {onBack && (
              <button onClick={onBack} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif" }}>← Back</button>
            )}
            <div>
              <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:500, color:"#26281f", letterSpacing:"-0.02em" }}>Tenant Analytics</div>
              <div style={{ fontSize:12, color:"#a89f8f", marginTop:3 }}>Aggregated from all deals in memory</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            {ignoredKeys.size > 0 && (
              <button
                onClick={resetIgnored}
                style={{ background:"transparent", border:"none", padding:"0 4px", cursor:"pointer", fontSize:11, color:"#a89f8f", textDecoration:"underline", fontFamily:"'Inter',sans-serif" }}
              >
                Reset ignored ({ignoredKeys.size})
              </button>
            )}
            {onTenantAudit && (
              <button onClick={onTenantAudit} style={{ background:"transparent", border:"1px solid #ddd4c2", color:"#52554e", padding:"6px 12px", borderRadius:7, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif", fontWeight:600 }}>
                Tenant Name Audit
              </button>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 0", color: "#a89f8f" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🏢</div>
          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 20, color: "#383a37", marginBottom: 6 }}>No tenants found</div>
          <div style={{ fontSize: 13 }}>{filter === "owned" ? "No Owned or Sold deals in the database." : "Upload OMs to see tenant analytics."}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Stat tiles — computed from activeRows, so ignored tenants are excluded */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            <StatBox label="Unique Tenants" value={activeRows.length.toLocaleString()} sub={ignoredKeys.size > 0 ? `${ignoredKeys.size} ignored` : undefined} />
            <StatBox label="Total Annual Rent" value={fmtRent(totalRent)} />
            <StatBox label="Avg Rent PSF" value={avgRentPSF != null ? `$${avgRentPSF.toFixed(2)}` : "—"} sub="rent-weighted" />
            <StatBox label="Investment Grade" value={igCount.toString()} sub={`${igPct.toFixed(0)}% of rent`} />
            {(() => {
              const totalGLA = activeRows.reduce((s, r) => s + r.totalSF, 0);
              const sfRows = activeRows.filter(r => r.totalSF > 0);
              const avgSF = sfRows.length > 0 ? Math.round(sfRows.reduce((s, r) => s + r.totalSF, 0) / sfRows.reduce((s, r) => s + r.locationCount, 0)) : null;
              return (
                <>
                  {totalGLA > 0 && <StatBox label="Total GLA" value={totalGLA >= 1000000 ? `${(totalGLA/1000000).toFixed(1)}M SF` : `${(totalGLA/1000).toFixed(0)}K SF`} sub="across active tenants" />}
                  {avgSF != null && <StatBox label="Avg Tenant SF" value={avgSF.toLocaleString()} sub="per location" />}
                </>
              );
            })()}
          </div>

          {/* Top 10 by Annual Rent */}
          <Card>
            <SectionLabel>Top 10 by Annual Rent</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {byRent.map((row, i) => {
                const ignored = ignoredKeys.has(row.key);
                return (
                  <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 10, opacity: ignored ? 0.35 : 1, transition: "opacity 0.15s" }}>
                    <div style={{ width: 18, textAlign: "right", fontSize: 10.5, color: "#b8b0a3", flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ flex:"1 1 0", minWidth:0, overflow:"hidden" }}>
                      <div style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                        <TenantLink name={tenantLabel(row.displayName)} onClick={onTenantClick} />
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:1, flexWrap:"nowrap" }}>
                        <span style={{ fontSize:10, color:"#b8b0a3", whiteSpace:"nowrap" }}>
                          {row.locationCount} loc{row.locationCount !== 1 ? "s" : ""}
                          {filter === "all" && row.ownedCount > 0 && row.ownedCount < row.locationCount ? <span style={{ color:"#6dba43", marginLeft:3 }}>({row.ownedCount} owned)</span> : null}
                          {filter === "all" && row.ownedCount === 0 ? <span style={{ color:"#c8b89a", marginLeft:3, fontStyle:"italic" }}>unowned</span> : null}
                        </span>
                        {row.parentCo && <button onClick={() => onParentClick?.(row.parentCo!)} style={{ background:"transparent", border:"none", padding:"1px 5px", borderRadius:3, cursor:onParentClick?"pointer":"default", fontSize:9, color:"#a69e91", fontWeight:500, whiteSpace:"nowrap", backgroundColor:"#f1ece1" }}>{row.parentCo}</button>}
                      </div>
                    </div>
                    <MiniBar value={row.totalAnnualRent} max={maxRent} color="#6dba43" />
                    <div style={{ width: 70, textAlign: "right", fontSize: 11, color: "#5c5850", fontWeight: 600, flexShrink: 0 }}>{fmtRent(row.totalAnnualRent)}</div>
                    <IgnoreBtn ignored={ignored} onToggle={() => toggleIgnore(row.key)} />
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Top 10 by Location Count */}
          <Card>
            <SectionLabel>Top 10 by Location Count</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {byCount.map((row, i) => {
                const ignored = ignoredKeys.has(row.key);
                return (
                  <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 10, opacity: ignored ? 0.35 : 1, transition: "opacity 0.15s" }}>
                    <div style={{ width: 18, textAlign: "right", fontSize: 10.5, color: "#b8b0a3", flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ flex:"1 1 0", minWidth:0, overflow:"hidden" }}>
                      <div style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                        <TenantLink name={tenantLabel(row.displayName)} onClick={onTenantClick} />
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:1, flexWrap:"nowrap" }}>
                        <span style={{ fontSize:10, color:"#b8b0a3", whiteSpace:"nowrap" }}>
                          {row.locationCount} loc{row.locationCount !== 1 ? "s" : ""}
                          {filter === "all" && row.ownedCount > 0 && row.ownedCount < row.locationCount ? <span style={{ color:"#6dba43", marginLeft:3 }}>({row.ownedCount} owned)</span> : null}
                          {filter === "all" && row.ownedCount === 0 ? <span style={{ color:"#c8b89a", marginLeft:3, fontStyle:"italic" }}>unowned</span> : null}
                        </span>
                        {row.parentCo && <button onClick={() => onParentClick?.(row.parentCo!)} style={{ background:"transparent", border:"none", padding:"1px 5px", borderRadius:3, cursor:onParentClick?"pointer":"default", fontSize:9, color:"#a69e91", fontWeight:500, whiteSpace:"nowrap", backgroundColor:"#f1ece1" }}>{row.parentCo}</button>}
                      </div>
                    </div>
                    <MiniBar value={row.locationCount} max={maxCount} color="#6baed6" />
                    <div style={{ width: 52, textAlign: "right", fontSize: 11, color: "#5c5850", fontWeight: 600, flexShrink: 0 }}>
                      {row.locationCount} loc{row.locationCount !== 1 ? "s" : ""}
                      {filter === "all" && row.ownedCount > 0 && row.ownedCount < row.locationCount && (
                        <div style={{ color:"#6dba43", fontSize:9, fontWeight:400 }}>({row.ownedCount} owned)</div>
                      )}
                      {filter === "all" && row.ownedCount === 0 && (
                        <div style={{ color:"#a69e91", fontSize:9, fontWeight:400, fontStyle:"italic" }}>unowned</div>
                      )}
                    </div>
                    <div style={{ width: 60, textAlign: "right", fontSize: 10.5, color: "#a89f8f", flexShrink: 0 }}>{fmtRent(row.totalAnnualRent)}</div>
                    <IgnoreBtn ignored={ignored} onToggle={() => toggleIgnore(row.key)} />
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Top 10 by GLA */}
          {bySF.length > 0 && (
            <Card>
              <SectionLabel>Top 10 by GLA</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {bySF.map((row, i) => {
                  const ignored = ignoredKeys.has(row.key);
                  return (
                    <div key={row.key} style={{ display:"flex", alignItems:"center", gap:8, opacity: ignored ? 0.35 : 1, transition: "opacity 0.15s" }}>
                      <span style={{ width:16, textAlign:"right", fontSize:11, color:"#c8b89a", flexShrink:0 }}>{i+1}</span>
                      <div style={{ flex:"1 1 0", minWidth:0, overflow:"hidden" }}>
                        <div style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                          <TenantLink name={tenantLabel(row.displayName)} onClick={onTenantClick} />
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:1, flexWrap:"nowrap" }}>
                          <span style={{ fontSize:10, color:"#b8b0a3", whiteSpace:"nowrap" }}>
                            {row.locationCount} loc{row.locationCount !== 1 ? "s" : ""}
                            {filter === "all" && row.ownedCount > 0 && row.ownedCount < row.locationCount ? <span style={{ color:"#6dba43", marginLeft:3 }}>({row.ownedCount} owned)</span> : null}
                            {filter === "all" && row.ownedCount === 0 ? <span style={{ color:"#c8b89a", marginLeft:3, fontStyle:"italic" }}>unowned</span> : null}
                          </span>
                          {row.parentCo && <button onClick={() => onParentClick?.(row.parentCo!)} style={{ background:"transparent", border:"none", padding:"1px 5px", borderRadius:3, cursor:onParentClick?"pointer":"default", fontSize:9, color:"#a69e91", fontWeight:500, whiteSpace:"nowrap", backgroundColor:"#f1ece1" }}>{row.parentCo}</button>}
                        </div>
                      </div>
                      <div style={{ flex:1, background:"#f1ece1", borderRadius:4, height:6, overflow:"hidden" }}>
                        <div style={{ width:`${(row.totalSF/maxSF)*100}%`, background:"#b08968", height:"100%", borderRadius:4 }} />
                      </div>
                      <span style={{ width:70, textAlign:"right", fontSize:11, color:"#5c5850", fontWeight:600, flexShrink:0 }}>
                        {row.totalSF >= 1000 ? `${(row.totalSF/1000).toFixed(0)}K SF` : `${row.totalSF.toLocaleString()} SF`}
                      </span>
                      <span style={{ width:40, textAlign:"right", fontSize:10, color:"#b8b0a3", flexShrink:0 }}>
                        {row.locationCount} loc{row.locationCount !== 1 ? "s" : ""}
                      </span>
                      <IgnoreBtn ignored={ignored} onToggle={() => toggleIgnore(row.key)} />
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* All Tenants — searchable full list */}
          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700 }}>
                All Tenants ({rows.length})
              </div>
              <input
                value={tenantSearch}
                onChange={e => setTenantSearch(e.target.value)}
                placeholder="Search tenants…"
                style={{ fontSize: 12, padding: "5px 10px", border: "1px solid #e3dccd", borderRadius: 7, color: "#383a37", background: "#f9f6f0", fontFamily: "'Inter',sans-serif", maxWidth: 220, width: "100%", minWidth: 0, boxSizing: "border-box" }}
              />
            </div>
            <div style={{ maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column" }}>
              {filteredAllTenants.length === 0 ? (
                <div style={{ padding: "20px 0", textAlign: "center", color: "#a89f8f", fontSize: 12 }}>
                  No tenants match &ldquo;{tenantSearch}&rdquo;
                </div>
              ) : (
                filteredAllTenants.map((row, i) => {
                  const ignored = ignoredKeys.has(row.key);
                  return (
                    <div
                      key={row.key}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "7px 2px",
                        borderBottom: i < filteredAllTenants.length - 1 ? "1px solid #f5f1ea" : "none",
                        opacity: ignored ? 0.35 : 1,
                        transition: "opacity 0.15s",
                      }}
                    >
                      <div style={{ width: 32, textAlign: "right", fontSize: 10, color: "#c8b8a3", flexShrink: 0 }}>
                        {i + 1}
                      </div>
                      <div style={{ flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>
                        <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          <TenantLink name={tenantLabel(row.displayName)} onClick={onTenantClick} />
                        </div>
                        <div style={{ fontSize: 10, color: "#b8b0a3", marginTop: 1, display: "flex", alignItems: "center", gap: 4, flexWrap: "nowrap" }}>
                          <span>{row.locationCount} loc{row.locationCount !== 1 ? "s" : ""}</span>
                          {filter === "all" && row.ownedCount > 0 && row.ownedCount < row.locationCount && (
                            <span style={{ color: "#6dba43" }}>({row.ownedCount} owned)</span>
                          )}
                          {filter === "all" && row.ownedCount === 0 && (
                            <span style={{ color: "#c8b89a", fontStyle: "italic" }}>unowned</span>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "#5c5850", fontWeight: 600, flexShrink: 0, minWidth: 54, textAlign: "right" }}>
                        {fmtRent(row.totalAnnualRent)}
                      </div>
                      <IgnoreBtn ignored={ignored} onToggle={() => toggleIgnore(row.key)} />
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          {/* Parent Company Exposure */}
          {parentRows.length > 0 && (
            <div style={{ background:"#fff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
              <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:6 }}>Parent Company Exposure</div>
              <div style={{ fontSize:10, color:"#a69e91", marginBottom:12 }}>Combined portfolio exposure across brands sharing a parent corporation</div>
              {(showAllParents ? parentRows : parentRows.slice(0, 10)).map(pr => (
                <div key={pr.parent} style={{ borderTop:"1px solid #f1ece1", padding:"10px 0" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:3 }}>
                    <button onClick={() => onParentClick?.(pr.parent)} style={{ background:"transparent", border:"none", padding:0, cursor:onParentClick?"pointer":"default", fontFamily:"'Fraunces',serif", fontSize:14, fontWeight:600, color:"#383a37", textDecoration:onParentClick?"underline":"none" }}>
                      {pr.parent}
                    </button>
                    <span style={{ fontSize:12, color:"#0f7a4e", fontWeight:600 }}>{fmtRent(pr.totalAnnualRent)}</span>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:11, color:"#6f6a5f" }}>{[...pr.brands].join(" · ")}</span>
                    <span style={{ fontSize:10, color:"#a89f8f", flexShrink:0, marginLeft:8 }}>{pr.locationCount} loc{pr.locationCount !== 1 ? "s" : ""}</span>
                  </div>
                </div>
              ))}
              {parentRows.length > 10 && (
                <div style={{ borderTop:"1px solid #f1ece1", paddingTop:10, textAlign:"center" }}>
                  <button onClick={() => setShowAllParents(v => !v)}
                    style={{ background:"transparent", border:"none", cursor:"pointer", fontSize:11, color:"#2d4ecf", fontFamily:"'Inter',sans-serif", textDecoration:"underline" }}>
                    {showAllParents ? "Show less ↑" : `See all ${parentRows.length} parent companies →`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Credit Quality + Anchor vs Inline */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Card style={{ flex: 1, minWidth: 260 }}>
              <SectionLabel>Credit Quality</SectionLabel>
              <div style={{ fontSize: 11, color: "#5c5850" }}>
                <span style={{ fontWeight: 600, color: "#3f7a1f" }}>Investment Grade</span>
                <span style={{ color: "#a89f8f", marginLeft: 8 }}>{igPct.toFixed(1)}% · {fmtRent(igRent)}</span>
              </div>
              <div style={{ fontSize: 11, color: "#5c5850", marginTop: 4 }}>
                <span style={{ fontWeight: 600, color: "#8a8579" }}>Not Rated / Non-IG</span>
                <span style={{ color: "#a89f8f", marginLeft: 8 }}>{notRatedPct.toFixed(1)}% · {fmtRent(totalRent - igRent)}</span>
              </div>
              <StackedBar igPct={igPct} notRatedPct={notRatedPct} />
            </Card>

            <Card style={{ flex: 1, minWidth: 260 }}>
              <SectionLabel>Anchor vs Inline</SectionLabel>
              <div style={{ fontSize: 11, color: "#5c5850" }}>
                <span style={{ fontWeight: 600, color: "#26281f" }}>Anchor</span>
                <span style={{ color: "#a89f8f", marginLeft: 8 }}>{anchorPct.toFixed(1)}% of rent · {fmtRent(anchorRent)}</span>
              </div>
              <div style={{ fontSize: 11, color: "#5c5850", marginTop: 4 }}>
                <span style={{ fontWeight: 600, color: "#8a8579" }}>Inline</span>
                <span style={{ color: "#a89f8f", marginLeft: 8 }}>{inlinePct.toFixed(1)}% of rent · {fmtRent(totalRent - anchorRent)}</span>
              </div>
              <div style={{ display: "flex", height: 28, borderRadius: 8, overflow: "hidden", gap: 1.5, marginTop: 12 }}>
                {anchorPct > 0 && (
                  <div title={`Anchor: ${anchorPct.toFixed(1)}%`} style={{ flex: anchorPct, background: "#6dba43", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {anchorPct >= 10 && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}>{anchorPct.toFixed(0)}%</span>}
                  </div>
                )}
                {inlinePct > 0 && (
                  <div title={`Inline: ${inlinePct.toFixed(1)}%`} style={{ flex: inlinePct, background: "#c9c2b8", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {inlinePct >= 10 && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}>{inlinePct.toFixed(0)}%</span>}
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Sales Performance — two boxes with shared PSF/Gross toggle */}
          {hasSalesData && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700 }}>
                  Sales Performance
                </div>
                <PillToggle options={salesOpts} value={salesMetric} onChange={v => setSalesMetric(v)} />
              </div>

              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <Card style={{ flex: 1, minWidth: 300 }}>
                  <SectionLabel>Top Individual Stores</SectionLabel>
                  {topStores.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#a89f8f" }}>No {salesMetric === "gross" ? "gross sales" : "sales PSF"} data available.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                      {topStores.map((occ, i) => {
                        const metricVal = salesMetric === "psf" ? occ.salesPSF : (occ.grossSales ?? 0);
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 18, textAlign: "right", fontSize: 10.5, color: "#b8b0a3", flexShrink: 0 }}>{i + 1}</div>
                            <div style={{ flex: "0 0 190px", minWidth: 0 }}>
                              <TenantLink name={tenantLabel(occ.displayName)} onClick={onTenantClick} />
                              <div style={{ fontSize: 10, color: "#b8b0a3", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{occ.dealName}</div>
                            </div>
                            <MiniBar value={metricVal} max={maxStoreVal as number} color="#e8a631" />
                            <div style={{ textAlign: "right", flexShrink: 0, minWidth: 80 }}>
                              <div style={{ fontSize: 11, color: "#5c5850", fontWeight: 600 }}>
                                {salesMetric === "psf" ? fmtPSF(occ.salesPSF) : fmtRent(occ.grossSales ?? 0)}
                              </div>
                              {occ.salesYear && <div style={{ fontSize: 9.5, color: "#b8b0a3" }}>{occ.salesYear}</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>

                <Card style={{ flex: 1, minWidth: 300 }}>
                  <SectionLabel>Top Chains by Average <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: 9, color: "#c9c2b8" }}>· 2+ reporting stores</span></SectionLabel>
                  {topChains.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#a89f8f" }}>No chains with 2+ reporting stores found.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                      {topChains.map((chain, i) => (
                        <div key={chain.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 18, textAlign: "right", fontSize: 10.5, color: "#b8b0a3", flexShrink: 0 }}>{i + 1}</div>
                          <div style={{ flex: "0 0 190px", minWidth: 0 }}>
                            <TenantLink name={tenantLabel(chain.displayName)} onClick={onTenantClick} />
                            <div style={{ fontSize: 10, color: "#b8b0a3", marginTop: 1 }}>{chain.values.length} stores</div>
                          </div>
                          <MiniBar value={chain.avg} max={maxChainVal as number} color="#6baed6" />
                          <div style={{ textAlign: "right", flexShrink: 0, minWidth: 100 }}>
                            <div style={{ fontSize: 11, color: "#5c5850", fontWeight: 600 }}>
                              {salesMetric === "psf" ? fmtPSF(chain.avg) : fmtRent(chain.avg)}
                            </div>
                            <div style={{ fontSize: 9.5, color: "#b8b0a3" }}>
                              {salesMetric === "psf"
                                ? `$${Math.round(chain.min)}–$${Math.round(chain.max)}`
                                : `${fmtRent(chain.min)}–${fmtRent(chain.max)}`}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </>
          )}

        </div>
      )}
    </div>
  );
}
