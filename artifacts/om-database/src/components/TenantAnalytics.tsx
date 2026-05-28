import { useState, useMemo } from "react";
import type { Deal } from "../lib/idb";
import { tenantKey, isVacant } from "../lib/utils";
import { isInvestmentGrade } from "../lib/tenantCredit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtRent(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function n(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const x = Number(v);
  return isFinite(x) ? x : null;
}

// ---------------------------------------------------------------------------
// Aggregation types
// ---------------------------------------------------------------------------

interface TenantRow {
  key: string;
  displayName: string;
  locationCount: number;
  totalAnnualRent: number;
  rentPSFValues: number[];
  isAnchor: boolean;
  creditRating: string | null;
  isIG: boolean;
  bestSalesPSF: number | null;
  salesYear: number | null;
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
    <div style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 9.5, letterSpacing: "0.13em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 500, color: "#26281f", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#a89f8f", marginTop: 4 }}>{sub}</div>}
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

// Horizontal bar showing relative proportion of a value vs maxValue
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ flex: 1, height: 8, background: "#f5f1ea", borderRadius: 4, overflow: "hidden", minWidth: 60 }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width 0.3s ease" }} />
    </div>
  );
}

// Two-segment stacked bar (IG green vs gray)
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  deals: Deal[];
  onTenantClick?: (name: string) => void;
  onTenantAudit?: () => void;
  onBack?: () => void;
}

export default function TenantAnalytics({ deals, onTenantClick, onTenantAudit, onBack }: Props) {
  const [filter, setFilter] = useState<"all" | "owned">("all");

  // Aggregate tenants from all filtered deals
  const { rows, totalRent } = useMemo(() => {
    const filtered = filter === "owned"
      ? deals.filter(d => d.status === "Owned" || d.status === "Sold")
      : deals;

    const map = new Map<string, TenantRow>();

    for (const deal of filtered) {
      if (!deal.tenants) continue;
      for (const t of deal.tenants) {
        const rawName = t.canonicalName || t.name;
        if (!rawName || isVacant(rawName)) continue;
        const key = tenantKey(rawName);
        const annualRent = n(t.annualRent) ?? 0;
        const rentPSF = n(t.rentPerSF);
        const salesPSF = n(t.salesPSF);
        const ig = isInvestmentGrade(rawName, t.creditRating);

        if (!map.has(key)) {
          map.set(key, {
            key,
            displayName: rawName,
            locationCount: 0,
            totalAnnualRent: 0,
            rentPSFValues: [],
            isAnchor: false,
            creditRating: t.creditRating ?? null,
            isIG: ig,
            bestSalesPSF: null,
            salesYear: null,
          });
        }
        const row = map.get(key)!;
        row.locationCount += 1;
        row.totalAnnualRent += annualRent;
        if (rentPSF != null && rentPSF > 0) row.rentPSFValues.push(rentPSF);
        if (t.isAnchor) row.isAnchor = true;
        if (ig) row.isIG = true;
        if (salesPSF != null && salesPSF > 0 && (row.bestSalesPSF == null || salesPSF > row.bestSalesPSF)) {
          row.bestSalesPSF = salesPSF;
          row.salesYear = t.salesYear ?? null;
        }
      }
    }

    const rows = Array.from(map.values());
    const totalRent = rows.reduce((s, r) => s + r.totalAnnualRent, 0);
    return { rows, totalRent };
  }, [deals, filter]);

  // Derived lists
  const byRent = useMemo(() => [...rows].sort((a, b) => b.totalAnnualRent - a.totalAnnualRent).slice(0, 10), [rows]);
  const byCount = useMemo(() => [...rows].sort((a, b) => b.locationCount - a.locationCount || b.totalAnnualRent - a.totalAnnualRent).slice(0, 10), [rows]);
  const bySales = useMemo(() => rows.filter(r => r.bestSalesPSF != null).sort((a, b) => (b.bestSalesPSF ?? 0) - (a.bestSalesPSF ?? 0)).slice(0, 10), [rows]);

  const igCount = useMemo(() => rows.filter(r => r.isIG).length, [rows]);
  const igRent = useMemo(() => rows.filter(r => r.isIG).reduce((s, r) => s + r.totalAnnualRent, 0), [rows]);
  const anchorRent = useMemo(() => rows.filter(r => r.isAnchor).reduce((s, r) => s + r.totalAnnualRent, 0), [rows]);

  const igPct = totalRent > 0 ? (igRent / totalRent) * 100 : 0;
  const notRatedPct = 100 - igPct;
  const anchorPct = totalRent > 0 ? (anchorRent / totalRent) * 100 : 0;
  const inlinePct = 100 - anchorPct;

  const avgRentPSF = useMemo(() => {
    // Weighted average: total rent / total SF implied by rent+psf pairs
    // Simple approach: weight average PSF by rent
    let weightedSum = 0, weightSum = 0;
    for (const row of rows) {
      if (row.rentPSFValues.length > 0) {
        const avg = row.rentPSFValues.reduce((a, b) => a + b, 0) / row.rentPSFValues.length;
        weightedSum += avg * row.totalAnnualRent;
        weightSum += row.totalAnnualRent;
      }
    }
    return weightSum > 0 ? weightedSum / weightSum : null;
  }, [rows]);

  const maxRent = byRent[0]?.totalAnnualRent ?? 1;
  const maxCount = byCount[0]?.locationCount ?? 1;

  // Toggle button renderer
  const Btn = (f: "all" | "owned", label: string) => (
    <button
      onClick={() => setFilter(f)}
      style={{
        padding: "7px 16px",
        borderRadius: 7,
        border: "none",
        background: filter === f ? "#2a2c27" : "transparent",
        color: filter === f ? "#f6f2ea" : "#8a8579",
        fontSize: 12.5,
        fontWeight: filter === f ? 600 : 500,
        cursor: "pointer",
        fontFamily: "'Inter',sans-serif",
        letterSpacing: "-0.01em",
        boxShadow: filter === f ? "0 4px 14px -6px rgba(42,44,39,0.55)" : "none",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {onBack && (
            <button onClick={onBack} style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#7d766a", padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif" }}>← Back</button>
          )}
          <div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, fontWeight: 500, color: "#26281f", letterSpacing: "-0.02em" }}>Tenant Analytics</div>
            <div style={{ fontSize: 12, color: "#a89f8f", marginTop: 3 }}>Aggregated from all deals in memory</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {onTenantAudit && (
            <button
              onClick={onTenantAudit}
              style={{ background: "transparent", border: "1px solid #ddd4c2", color: "#52554e", padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 600 }}
            >
              Tenant Name Audit
            </button>
          )}
          <div style={{ display: "flex", background: "#f1eadc", borderRadius: 9, padding: 3, gap: 2 }}>
            {Btn("all", "All Deals")}
            {Btn("owned", "Owned")}
          </div>
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

          {/* Stat tiles */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <StatBox label="Unique Tenants" value={rows.length.toLocaleString()} />
            <StatBox label="Total Annual Rent" value={fmtRent(totalRent)} />
            <StatBox label="Avg Rent PSF" value={avgRentPSF != null ? `$${avgRentPSF.toFixed(2)}` : "—"} sub="rent-weighted" />
            <StatBox label="Investment Grade" value={igCount.toString()} sub={`${igPct.toFixed(0)}% of rent`} />
          </div>

          {/* Top 10 by Annual Rent */}
          <Card>
            <SectionLabel>Top 10 by Annual Rent</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {byRent.map((row, i) => (
                <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 18, textAlign: "right", fontSize: 10.5, color: "#b8b0a3", flexShrink: 0 }}>{i + 1}</div>
                  <div style={{ flex: "0 0 220px", minWidth: 0 }}>
                    <TenantLink name={row.displayName} onClick={onTenantClick} />
                    <span style={{ fontSize: 10, color: "#b8b0a3", marginLeft: 6 }}>{row.locationCount} loc{row.locationCount !== 1 ? "s" : ""}</span>
                  </div>
                  <MiniBar value={row.totalAnnualRent} max={maxRent} color="#6dba43" />
                  <div style={{ width: 70, textAlign: "right", fontSize: 11, color: "#5c5850", fontWeight: 600, flexShrink: 0 }}>{fmtRent(row.totalAnnualRent)}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Top 10 by Location Count */}
          <Card>
            <SectionLabel>Top 10 by Location Count</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {byCount.map((row, i) => (
                <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 18, textAlign: "right", fontSize: 10.5, color: "#b8b0a3", flexShrink: 0 }}>{i + 1}</div>
                  <div style={{ flex: "0 0 220px", minWidth: 0 }}>
                    <TenantLink name={row.displayName} onClick={onTenantClick} />
                  </div>
                  <MiniBar value={row.locationCount} max={maxCount} color="#6baed6" />
                  <div style={{ width: 52, textAlign: "right", fontSize: 11, color: "#5c5850", fontWeight: 600, flexShrink: 0 }}>{row.locationCount} loc{row.locationCount !== 1 ? "s" : ""}</div>
                  <div style={{ width: 60, textAlign: "right", fontSize: 10.5, color: "#a89f8f", flexShrink: 0 }}>{fmtRent(row.totalAnnualRent)}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Credit Quality + Anchor vs Inline — side by side */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Card style={{ flex: 1, minWidth: 260 }}>
              <SectionLabel>Credit Quality</SectionLabel>
              <div style={{ display: "flex", gap: 20 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#5c5850" }}>
                    <span style={{ fontWeight: 600, color: "#3f7a1f" }}>Investment Grade</span>
                    <span style={{ color: "#a89f8f", marginLeft: 8 }}>{igPct.toFixed(1)}% · {fmtRent(igRent)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#5c5850", marginTop: 4 }}>
                    <span style={{ fontWeight: 600, color: "#8a8579" }}>Not Rated / Non-IG</span>
                    <span style={{ color: "#a89f8f", marginLeft: 8 }}>{notRatedPct.toFixed(1)}% · {fmtRent(totalRent - igRent)}</span>
                  </div>
                </div>
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

          {/* Top Sales Performers */}
          {bySales.length > 0 && (
            <Card>
              <SectionLabel>Top Sales Performers</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {bySales.map((row, i) => (
                  <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 18, textAlign: "right", fontSize: 10.5, color: "#b8b0a3", flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ flex: "0 0 220px", minWidth: 0 }}>
                      <TenantLink name={row.displayName} onClick={onTenantClick} />
                    </div>
                    <MiniBar value={row.bestSalesPSF!} max={bySales[0].bestSalesPSF!} color="#e8a631" />
                    <div style={{ width: 80, textAlign: "right", fontSize: 11, color: "#5c5850", fontWeight: 600, flexShrink: 0 }}>
                      ${row.bestSalesPSF!.toFixed(0)} PSF
                    </div>
                    {row.salesYear && (
                      <div style={{ width: 36, textAlign: "right", fontSize: 10, color: "#b8b0a3", flexShrink: 0 }}>{row.salesYear}</div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

        </div>
      )}
    </div>
  );
}
