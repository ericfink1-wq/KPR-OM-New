import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnalyticsSummary {
  totalAnnualRent: number;
  rentedTenantCount: number;
  totalTenantCount: number;
  dealCount: number;
}

interface ExpirationBucket {
  year: string;
  annualRent: number;
  pct: number;
  tenantCount: number;
}

interface TenantConcentration {
  topTenant: { name: string; annualRent: number; pct: number } | null;
  top5Pct: number;
  topTenants: Array<{ name: string; annualRent: number; pct: number }>;
  anchorRent: number;
  anchorPct: number;
  anchorCount: number;
}

interface MixItem {
  label: string;
  annualRent: number;
  pct: number;
  count: number;
}

interface PortfolioAnalyticsData {
  filter: "all" | "owned";
  summary: AnalyticsSummary;
  leaseExpiration: ExpirationBucket[];
  tenantConcentration: TenantConcentration;
  creditMix: MixItem[];
  leaseTypeMix: MixItem[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW_YEAR = new Date().getFullYear();

function fmtRent(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function barColor(year: string): string {
  if (year === "Unknown") return "#c9c2b8";
  const y = parseInt(year);
  if (y <= NOW_YEAR) return "#b0a898";
  const delta = y - NOW_YEAR;
  if (delta <= 2) return "#dc6347";   // near-term risk — warm red
  if (delta <= 4) return "#e8a631";   // medium — amber
  if (delta <= 6) return "#a3c45a";   // medium-stable — yellow-green
  return "#6dba43";                    // long-term stable — KPR green
}

const CREDIT_COLORS: Record<string, string> = {
  "Investment Grade": "#6dba43",
  "Non-Investment Grade": "#e8a631",
  "Unrated": "#c9c2b8",
};

const LEASE_TYPE_COLORS = ["#6dba43", "#e8a631", "#6baed6", "#c9c2b8", "#a89f8f", "#b8b0a3"];

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
    <div style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 10, padding: "14px 18px", flex: 1 }}>
      <div style={{ fontSize: 9.5, letterSpacing: "0.13em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 500, color: "#26281f", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#a89f8f", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// Horizontal proportional segment bar
function SegmentBar({ items, colorMap }: {
  items: MixItem[];
  colorMap: (label: string, idx: number) => string;
}) {
  const total = items.reduce((s, i) => s + i.annualRent, 0);
  if (total === 0) return <div style={{ height: 24, background: "#f1eadc", borderRadius: 6 }} />;
  return (
    <div style={{ display: "flex", height: 28, borderRadius: 8, overflow: "hidden", gap: 1.5 }}>
      {items.map((item, idx) => (
        <div
          key={item.label}
          title={`${item.label}: ${item.pct}% (${fmtRent(item.annualRent)}, ${item.count} tenants)`}
          style={{
            flex: item.annualRent / total,
            background: colorMap(item.label, idx),
            minWidth: item.pct > 3 ? undefined : 0,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "default",
          }}
        >
          {item.pct >= 8 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}>
              {Math.round(item.pct)}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function SegmentLegend({ items, colorMap }: {
  items: MixItem[];
  colorMap: (label: string, idx: number) => string;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 10 }}>
      {items.map((item, idx) => (
        <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 9, height: 9, borderRadius: 2, background: colorMap(item.label, idx), flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: "#5c5850" }}>
            <span style={{ fontWeight: 600 }}>{item.label}</span>
            <span style={{ color: "#a89f8f", marginLeft: 4 }}>{item.pct}% · {fmtRent(item.annualRent)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expiration Waterfall
// ---------------------------------------------------------------------------

function ExpirationWaterfall({ data }: { data: ExpirationBucket[] }) {
  const maxPct = Math.max(...data.map(d => d.pct), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {data.map(d => (
        <div key={d.year} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 40, textAlign: "right", fontSize: 11, fontWeight: 600, color: d.year === "Unknown" ? "#a89f8f" : "#383a37", flexShrink: 0 }}>
            {d.year}
          </div>
          <div style={{ flex: 1, position: "relative", height: 22, background: "#f5f1ea", borderRadius: 5, overflow: "hidden" }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                height: "100%",
                width: `${(d.pct / maxPct) * 100}%`,
                background: barColor(d.year),
                borderRadius: 5,
                transition: "width 0.4s ease",
              }}
            />
            <div style={{ position: "absolute", right: 7, top: 0, height: "100%", display: "flex", alignItems: "center", fontSize: 10.5, color: "#6b6560", fontWeight: 600 }}>
              {d.pct}%
            </div>
          </div>
          <div style={{ width: 62, textAlign: "right", fontSize: 10.5, color: "#a89f8f", flexShrink: 0 }}>
            {fmtRent(d.annualRent)}
          </div>
          <div style={{ width: 28, textAlign: "right", fontSize: 10, color: "#b8b0a3", flexShrink: 0 }}>
            {d.tenantCount}
          </div>
        </div>
      ))}
      {data.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginTop: 4, paddingTop: 8, borderTop: "1px solid #f1eadc" }}>
          <div style={{ width: 40 }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 14 }}>
              {[
                { color: "#dc6347", label: "≤2 yrs" },
                { color: "#e8a631", label: "3-4 yrs" },
                { color: "#a3c45a", label: "5-6 yrs" },
                { color: "#6dba43", label: "7+ yrs" },
                { color: "#c9c2b8", label: "Unknown" },
              ].map(item => (
                <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: item.color }} />
                  <span style={{ fontSize: 9.5, color: "#a89f8f" }}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ width: 62, textAlign: "right", fontSize: 9.5, color: "#b8b0a3" }}>Rent</div>
          <div style={{ width: 28, textAlign: "right", fontSize: 9.5, color: "#b8b0a3" }}>#</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tenant Concentration
// ---------------------------------------------------------------------------

function TopTenantsPanel({ data }: { data: TenantConcentration }) {
  const maxPct = Math.max(...data.topTenants.map(t => t.pct), 1);
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {data.topTenants.map((t, i) => (
          <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ width: 14, textAlign: "right", fontSize: 10, color: "#c9c2b8", flexShrink: 0, fontWeight: 600 }}>{i + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: "#383a37", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "72%" }}>{t.name}</span>
                <span style={{ fontSize: 10.5, color: "#a89f8f", flexShrink: 0 }}>{t.pct}%</span>
              </div>
              <div style={{ height: 5, background: "#f5f1ea", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(t.pct / maxPct) * 100}%`, background: i === 0 ? "#6dba43" : "#a3c45a", borderRadius: 3 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
      {data.topTenants.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f1eadc", display: "flex", gap: 10 }}>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, color: "#26281f", fontWeight: 500 }}>{data.topTenants[0]?.pct ?? 0}%</div>
            <div style={{ fontSize: 10, color: "#a89f8f", marginTop: 2 }}>Top tenant</div>
          </div>
          <div style={{ width: 1, background: "#f1eadc" }} />
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, color: "#26281f", fontWeight: 500 }}>{Math.round(data.top5Pct)}%</div>
            <div style={{ fontSize: 10, color: "#a89f8f", marginTop: 2 }}>Top 5 combined</div>
          </div>
          <div style={{ width: 1, background: "#f1eadc" }} />
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, color: "#26281f", fontWeight: 500 }}>{Math.round(data.anchorPct)}%</div>
            <div style={{ fontSize: 10, color: "#a89f8f", marginTop: 2 }}>{data.anchorCount} anchor{data.anchorCount !== 1 ? "s" : ""}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function PortfolioAnalytics({ onTenantAudit }: { onTenantAudit?: () => void }) {
  const [filter, setFilter] = useState<"all" | "owned">("all");
  const [data, setData] = useState<PortfolioAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);
  const [rebuildingComps, setRebuildingComps] = useState(false);
  const [rebuildCompsMsg, setRebuildCompsMsg] = useState<string | null>(null);

  const load = useCallback((f: "all" | "owned") => {
    setLoading(true);
    setError(null);
    fetch(`/api/analytics/portfolio?filter=${f}`, { credentials: "include" })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PortfolioAnalyticsData>;
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => { load(filter); }, [filter, load]);

  const handleRebuild = () => {
    setRebuilding(true);
    setRebuildMsg(null);
    fetch("/api/tenant-index/rebuild-all", { method: "POST", credentials: "include" })
      .then(r => r.json() as Promise<{ ok: boolean; rebuilt?: number; error?: string }>)
      .then(d => {
        if (!d.ok) throw new Error(d.error || "Rebuild failed");
        setRebuildMsg(`✓ ${d.rebuilt ?? "?"} tenants indexed`);
        load(filter);
      })
      .catch(e => setRebuildMsg(`⚠ ${e.message}`))
      .finally(() => setRebuilding(false));
  };

  const handleRebuildComps = () => {
    setRebuildingComps(true);
    setRebuildCompsMsg(null);
    fetch("/api/comps/rebuild-all", { method: "POST", credentials: "include" })
      .then(r => r.json() as Promise<{ ok: boolean; rebuilt?: number; error?: string }>)
      .then(d => {
        if (!d.ok) throw new Error(d.error || "Rebuild failed");
        setRebuildCompsMsg(`✓ ${d.rebuilt ?? "?"} comps indexed`);
        load(filter);
      })
      .catch(e => setRebuildCompsMsg(`⚠ ${e.message}`))
      .finally(() => setRebuildingComps(false));
  };

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
        <div>
          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, fontWeight: 500, color: "#26281f", letterSpacing: "-0.02em" }}>Portfolio Analytics</div>
          <div style={{ fontSize: 12, color: "#a89f8f", marginTop: 3 }}>Computed live from the tenant index</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {onTenantAudit && (
            <button
              onClick={onTenantAudit}
              style={{ background: "transparent", border: "1px solid #ddd4c2", color: "#52554e", padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 600 }}
            >
              Tenant Audit
            </button>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <button
              onClick={handleRebuildComps}
              disabled={rebuildingComps}
              style={{
                background: rebuildingComps ? "#f1eadc" : "transparent",
                border: "1px solid #c9c2b8",
                color: rebuildingComps ? "#a89f8f" : "#6f6a5f",
                padding: "6px 12px",
                borderRadius: 7,
                cursor: rebuildingComps ? "default" : "pointer",
                fontSize: 11,
                fontFamily: "'Inter',sans-serif",
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span style={{ fontSize: 12 }}>↺</span>
              {rebuildingComps ? "Rebuilding…" : "Rebuild comps index"}
            </button>
            {rebuildCompsMsg && (
              <span style={{ fontSize: 10.5, color: rebuildCompsMsg.startsWith("✓") ? "#0f9d63" : "#dc2626", fontFamily: "'Inter',sans-serif" }}>
                {rebuildCompsMsg}
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <button
              onClick={handleRebuild}
              disabled={rebuilding}
              style={{
                background: rebuilding ? "#f1eadc" : "transparent",
                border: "1px solid #c9c2b8",
                color: rebuilding ? "#a89f8f" : "#6f6a5f",
                padding: "6px 12px",
                borderRadius: 7,
                cursor: rebuilding ? "default" : "pointer",
                fontSize: 11,
                fontFamily: "'Inter',sans-serif",
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span style={{ fontSize: 12 }}>↺</span>
              {rebuilding ? "Rebuilding…" : "Rebuild index"}
            </button>
            {rebuildMsg && (
              <span style={{ fontSize: 10.5, color: rebuildMsg.startsWith("✓") ? "#0f9d63" : "#dc2626", fontFamily: "'Inter',sans-serif" }}>
                {rebuildMsg}
              </span>
            )}
          </div>
          <div style={{ display: "flex", background: "#f1eadc", borderRadius: 10, padding: 3, gap: 2 }}>
            {Btn("all", "All Deals")}
            {Btn("owned", "Owned Only")}
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: "80px 0", color: "#a89f8f" }}>
          <div style={{ fontSize: 13 }}>Computing…</div>
        </div>
      )}

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "14px 18px", color: "#b91c1c", fontSize: 13 }}>
          Failed to load analytics: {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Summary row */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            <StatBox
              label="Total Annual Rent"
              value={fmtRent(data.summary.totalAnnualRent)}
              sub={`${data.summary.dealCount} deal${data.summary.dealCount !== 1 ? "s" : ""}`}
            />
            <StatBox
              label="Tenants w/ Rent Data"
              value={String(data.summary.rentedTenantCount)}
              sub={`${data.summary.totalTenantCount} total incl. vacant`}
            />
            <StatBox
              label="Top Tenant Concentration"
              value={data.tenantConcentration.topTenant ? `${data.tenantConcentration.topTenant.pct}%` : "—"}
              sub={data.tenantConcentration.topTenant?.name ?? "No data"}
            />
            <StatBox
              label="Anchor Rent Share"
              value={`${Math.round(data.tenantConcentration.anchorPct)}%`}
              sub={`${data.tenantConcentration.anchorCount} anchor tenant${data.tenantConcentration.anchorCount !== 1 ? "s" : ""}`}
            />
          </div>

          {/* Waterfall + Tenant Concentration */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 14, marginBottom: 14 }}>
            <Card>
              <SectionLabel>Lease Expiration Waterfall — % of Rent by Year</SectionLabel>
              {data.leaseExpiration.length === 0 ? (
                <div style={{ color: "#a89f8f", fontSize: 13, padding: "20px 0" }}>No lease expiry data available.</div>
              ) : (
                <ExpirationWaterfall data={data.leaseExpiration} />
              )}
            </Card>

            <Card>
              <SectionLabel>Tenant Concentration — Top 5 by Rent</SectionLabel>
              {data.tenantConcentration.topTenants.length === 0 ? (
                <div style={{ color: "#a89f8f", fontSize: 13, padding: "20px 0" }}>No tenant rent data available.</div>
              ) : (
                <TopTenantsPanel data={data.tenantConcentration} />
              )}
            </Card>
          </div>

          {/* Credit Mix + Lease Type Mix */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Card>
              <SectionLabel>Credit Mix — % of Rent</SectionLabel>
              {data.creditMix.length === 0 ? (
                <div style={{ color: "#a89f8f", fontSize: 13, padding: "20px 0" }}>No credit rating data available.</div>
              ) : (
                <>
                  <SegmentBar
                    items={data.creditMix}
                    colorMap={(label) => CREDIT_COLORS[label] ?? "#c9c2b8"}
                  />
                  <SegmentLegend
                    items={data.creditMix}
                    colorMap={(label) => CREDIT_COLORS[label] ?? "#c9c2b8"}
                  />
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f1eadc" }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      {data.creditMix.map(item => (
                        <div key={item.label} style={{ flex: 1, textAlign: "center", background: "#faf7f0", borderRadius: 8, padding: "10px 6px" }}>
                          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 20, color: "#26281f", fontWeight: 500 }}>{item.pct}%</div>
                          <div style={{ fontSize: 9.5, color: "#a89f8f", marginTop: 2 }}>{item.count} tenants</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </Card>

            <Card>
              <SectionLabel>Lease Type Mix — % of Rent</SectionLabel>
              {data.leaseTypeMix.length === 0 ? (
                <div style={{ color: "#a89f8f", fontSize: 13, padding: "20px 0" }}>No lease type data available.</div>
              ) : (
                <>
                  <SegmentBar
                    items={data.leaseTypeMix}
                    colorMap={(_, idx) => LEASE_TYPE_COLORS[idx % LEASE_TYPE_COLORS.length]}
                  />
                  <SegmentLegend
                    items={data.leaseTypeMix}
                    colorMap={(_, idx) => LEASE_TYPE_COLORS[idx % LEASE_TYPE_COLORS.length]}
                  />
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f1eadc" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {data.leaseTypeMix.map((item, idx) => (
                        <div key={item.label} style={{ flex: "1 0 calc(33% - 8px)", minWidth: 80, textAlign: "center", background: "#faf7f0", borderRadius: 8, padding: "10px 6px" }}>
                          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 20, color: "#26281f", fontWeight: 500 }}>{item.pct}%</div>
                          <div style={{ fontSize: 9.5, color: "#a89f8f", marginTop: 2 }}>{item.label}</div>
                          <div style={{ fontSize: 9, color: "#c9c2b8", marginTop: 1 }}>{item.count} tenants</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </Card>
          </div>

          {data.summary.totalAnnualRent === 0 && (
            <div style={{ marginTop: 20, padding: "16px 20px", background: "#faf7f0", border: "1px solid #ece5d7", borderRadius: 10, fontSize: 13, color: "#a89f8f" }}>
              {filter === "owned"
                ? "No Owned deals found in the tenant index. Switch to \u201cAll Deals\u201d or change some deal statuses to Owned."
                : "The tenant index is empty. Try uploading some deals or run POST /api/tenant-index/rebuild-all to backfill."}
            </div>
          )}
        </>
      )}
    </div>
  );
}
