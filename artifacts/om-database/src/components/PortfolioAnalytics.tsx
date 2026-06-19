import { useState, useEffect, useCallback, useMemo } from "react";
import { useIsMobile } from "../hooks/use-mobile";
import { startAiTask, finishAiTask } from "../lib/aiProgress";

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
  summary: AnalyticsSummary;
  leaseExpiration: ExpirationBucket[];
  tenantConcentration: TenantConcentration;
  creditMix: MixItem[];
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
  if (delta <= 2) return "#dc6347";
  if (delta <= 4) return "#e8a631";
  if (delta <= 6) return "#a3c45a";
  return "#6dba43";
}

const CREDIT_COLORS: Record<string, string> = {
  "Investment Grade": "#6dba43",
  "Non-Investment Grade": "#e8a631",
  "Unrated": "#c9c2b8",
};

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
    <div style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 12, padding: "20px 22px", boxSizing: "border-box", ...style }}>
      {children}
    </div>
  );
}

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 10, padding: "14px 18px", flex: "1 1 140px", minWidth: 0, boxSizing: "border-box" }}>
      <div style={{ fontSize: 9.5, letterSpacing: "0.13em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 500, color: "#26281f", lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#a89f8f", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

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
// Expiration Waterfall — rows are clickable
// ---------------------------------------------------------------------------

function ExpirationWaterfall({ data, onYearClick }: { data: ExpirationBucket[]; onYearClick?: (year: string) => void }) {
  const maxPct = Math.max(...data.map(d => d.pct), 1);
  const clickable = !!onYearClick;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {data.map(d => (
        <div
          key={d.year}
          onClick={() => onYearClick?.(d.year)}
          style={{ display: "flex", alignItems: "center", gap: 10, cursor: clickable ? "pointer" : "default", borderRadius: 6, padding: clickable ? "0 0" : undefined }}
          title={clickable ? `View ${d.year === "Unknown" ? "unknown expiry" : d.year} rollover detail` : undefined}
        >
          <div style={{ width: 40, textAlign: "right", fontSize: 11, fontWeight: 600, color: d.year === "Unknown" ? "#a89f8f" : (clickable ? "#2d4ecf" : "#383a37"), flexShrink: 0, textDecoration: clickable ? "underline" : "none", textDecorationColor: "#a8b8f0", textUnderlineOffset: 2 }}>
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
          {clickable && (
            <div style={{ width: 14, textAlign: "center", fontSize: 10, color: "#c9c2b8", flexShrink: 0 }}>›</div>
          )}
        </div>
      ))}
      {data.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginTop: 4, paddingTop: 8, borderTop: "1px solid #f1eadc" }}>
          <div style={{ width: 40 }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
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
          {clickable && <div style={{ width: 14 }} />}
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

interface Props {
  filterDealIds?: string[];
  ownedDealIds?: string[];
  isAdmin?: boolean;
  onYearClick?: (year: string, scope: "all" | "owned") => void;
  onTenantAudit?: () => void;
  onTenantAnalytics?: () => void;
  onDataAudit?: (checkKey?: string) => void;
}

export default function PortfolioAnalytics({ filterDealIds, ownedDealIds, isAdmin, onYearClick, onTenantAudit, onTenantAnalytics, onDataAudit }: Props) {
  const isMobile = useIsMobile();
  const [data, setData] = useState<PortfolioAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);
  const [rebuildingComps, setRebuildingComps] = useState(false);
  const [rebuildCompsMsg, setRebuildCompsMsg] = useState<string | null>(null);
  const [scoring, setScoring] = useState(false);
  const [scoreMsg, setScoreMsg] = useState<string | null>(null);
  const [staleCount, setStaleCount] = useState(0);
  const [refreshingStale, setRefreshingStale] = useState(false);
  const [staleMsg, setStaleMsg] = useState<string | null>(null);
  const [auditStats, setAuditStats] = useState<{ deals: number; issues: number; high: number; breakdown: { key: string; label: string; count: number }[] }>({ deals: 0, issues: 0, high: 0, breakdown: [] });
  const [maintaining, setMaintaining] = useState(false);
  const [maintainMsg, setMaintainMsg] = useState<string | null>(null);
  const [showAuditBreakdown, setShowAuditBreakdown] = useState(false);
  const [scope, setScope] = useState<"all" | "owned">("all");

  // Effective deal IDs: when Owned, use ownedDealIds intersected with any Deal Library filter
  const effectiveDealIds = useMemo<string[] | undefined>(() => {
    if (scope === "owned") {
      const base = ownedDealIds ?? [];
      if (filterDealIds && filterDealIds.length > 0) {
        const s = new Set(filterDealIds);
        return base.filter(id => s.has(id));
      }
      return base;
    }
    return filterDealIds;
  }, [scope, ownedDealIds, filterDealIds]);

  const noDeals = effectiveDealIds !== undefined && effectiveDealIds.length === 0;

  const load = useCallback((dealIds?: string[]) => {
    setLoading(true);
    setError(null);
    let url = "/api/analytics/portfolio";
    if (dealIds && dealIds.length > 0) {
      // Send repeated dealId= (no brackets) so it parses to an array under both
      // Express 5's default "simple" query parser and the "extended" (qs) parser.
      url += "?" + dealIds.map(id => `dealId=${encodeURIComponent(id)}`).join("&");
    }
    fetch(url, { credentials: "include" })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PortfolioAnalyticsData>;
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => {
    if (noDeals) { setLoading(false); setData(null); return; }
    load(effectiveDealIds);
  }, [effectiveDealIds, noDeals, load]);

  const handleRebuild = () => {
    setRebuilding(true);
    setRebuildMsg(null);
    fetch("/api/tenant-index/rebuild-all", { method: "POST", credentials: "include" })
      .then(r => r.json() as Promise<{ ok: boolean; rebuilt?: number; error?: string }>)
      .then(d => {
        if (!d.ok) throw new Error(d.error || "Rebuild failed");
        setRebuildMsg(`✓ ${d.rebuilt ?? "?"} tenants indexed`);
        load(effectiveDealIds);
      })
      .catch(e => setRebuildMsg(`⚠ ${e.message}`))
      .finally(() => setRebuilding(false));
  };

  useEffect(() => {
    fetch("/api/deals/stale-analysis-count", { credentials: "include" })
      .then(r => r.json() as Promise<{ count?: number }>)
      .then(d => setStaleCount(d.count ?? 0))
      .catch(() => {});
  }, []);

  const loadAuditStats = () => {
    fetch("/api/deals/audit-stats", { credentials: "include" })
      .then(r => r.json() as Promise<{ deals?: number; issues?: number; high?: number; breakdown?: { key: string; label: string; count: number }[] }>)
      .then(d => setAuditStats({ deals: d.deals ?? 0, issues: d.issues ?? 0, high: d.high ?? 0, breakdown: d.breakdown ?? [] }))
      .catch(() => {});
  };
  useEffect(() => { loadAuditStats(); }, []);

  // One sweep over the whole library: auto-fix the safe issues, THEN re-audit every
  // deal. Going forward each write self-maintains, so this is the one-click catch-up for
  // existing deals (and a manual "clean everything now"). Token-free; snapshots first
  // (reversible via Backup → Restore a snapshot); leaves judgement calls flagged, not changed.
  const handleCleanAndReaudit = async () => {
    if (!window.confirm("Clean & re-audit ALL deals now? Token-free and reversible (it snapshots first). It auto-fixes the issues with a single right answer — occupancy-cost units, cap-rate units, price-PSF, a rentPerSF that doesn't reconcile to a reliable annual, duplicate roster rows, and stale occupancy / WALT / avg-rent — then re-checks every deal's numbers and posts any contradictions to that deal's Import Review. Ambiguous figures are LEFT for you to review; anything you've already resolved is untouched.")) return;
    setMaintaining(true); setMaintainMsg("Cleaning…");
    try {
      const a = await fetch("/api/deals/autofix", { method: "POST", credentials: "include" })
        .then(r => r.json() as Promise<{ ok: boolean; occCostFixed?: number; occUnitFixed?: number; capUnitFixed?: number; ppsfFixed?: number; rentFixed?: number; dupeFixed?: number; metricFixes?: number; changedDeals?: number; cleared?: number; error?: string }>);
      if (!a.ok) throw new Error(a.error || "Auto-fix failed");
      setMaintainMsg("Re-auditing…");
      const b = await fetch("/api/deals/reaudit", { method: "POST", credentials: "include" })
        .then(r => r.json() as Promise<{ ok: boolean; flagged?: number; added?: number; cleared?: number; error?: string }>);
      if (!b.ok) throw new Error(b.error || "Audit failed");
      const parts = ([
        [a.occCostFixed, "occ-cost"], [a.occUnitFixed, "occupancy units"], [a.capUnitFixed, "cap-rate units"],
        [a.ppsfFixed, "price-PSF"], [a.rentFixed, "rent"], [a.dupeFixed, "dup rows"], [a.metricFixes, "metrics"],
      ] as [number | undefined, string][]).filter(([n]) => (n ?? 0) > 0).map(([n, label]) => `${n} ${label}`);
      setMaintainMsg(`✓ Cleaned ${a.changedDeals ?? 0} deal${(a.changedDeals ?? 0) === 1 ? "" : "s"}${parts.length ? ` · ${parts.join(", ")}` : ""} · audit ${b.added ?? 0} new / ${(a.cleared ?? 0) + (b.cleared ?? 0)} cleared — reloading…`);
      loadAuditStats();
      setTimeout(() => window.location.reload(), 1800);
    } catch (e) {
      setMaintainMsg(`⚠ ${e instanceof Error ? e.message : "failed"}`);
    } finally {
      setMaintaining(false);
    }
  };

  const handleRefreshStale = () => {
    if (!window.confirm(`Refresh the written analysis for ${staleCount} deal${staleCount === 1 ? "" : "s"} that predate the latest scoring logic? This runs the cheap AI roster-analysis pass on each and may take a bit. (Your badges and score adjustments are already current — this only updates the written narrative and benchmark notes.)`)) return;
    setRefreshingStale(true);
    setStaleMsg(null);
    const taskId = startAiTask(`Refreshing ${staleCount} outdated analysis${staleCount === 1 ? "" : "es"}`);
    fetch("/api/deals/refresh-stale-analysis", { method: "POST", credentials: "include" })
      .then(r => r.json() as Promise<{ ok: boolean; refreshed?: number; failed?: number; error?: string }>)
      .then(d => {
        if (!d.ok) throw new Error(d.error || "Refresh failed");
        const n = d.refreshed ?? 0;
        setStaleMsg(`✓ Refreshed ${n} deal${n === 1 ? "" : "s"}${d.failed ? `, ${d.failed} failed` : ""} — reloading…`);
        setStaleCount(0);
        finishAiTask(taskId, "done", `Refreshed ${n} deal${n === 1 ? "" : "s"}${d.failed ? `, ${d.failed} failed` : ""}`);
        setTimeout(() => window.location.reload(), 1200);
      })
      .catch(e => { setStaleMsg(`⚠ ${e.message}`); finishAiTask(taskId, "error", `Refresh failed — ${e.message}`); })
      .finally(() => setRefreshingStale(false));
  };

  const handleScoreUnscored = () => {
    if (!window.confirm("Score every deal that doesn't have a grade yet? This runs the AI roster analysis on each ungraded deal and may take up to a minute.")) return;
    setScoring(true);
    setScoreMsg(null);
    const taskId = startAiTask("Scoring all unscored deals");
    fetch("/api/deals/score-unscored", { method: "POST", credentials: "include" })
      .then(r => r.json() as Promise<{ ok: boolean; scored?: number; failed?: number; total?: number; error?: string }>)
      .then(d => {
        if (!d.ok) throw new Error(d.error || "Scoring failed");
        const n = d.scored ?? 0;
        setScoreMsg(`✓ Scored ${n} deal${n === 1 ? "" : "s"}${d.failed ? `, ${d.failed} failed` : ""} — reloading…`);
        finishAiTask(taskId, "done", `Scored ${n} deal${n === 1 ? "" : "s"}${d.failed ? `, ${d.failed} failed` : ""}`);
        setTimeout(() => window.location.reload(), 1200);
      })
      .catch(e => { setScoreMsg(`⚠ ${e.message}`); finishAiTask(taskId, "error", `Scoring failed — ${e.message}`); })
      .finally(() => setScoring(false));
  };

  const handleRebuildComps = () => {
    setRebuildingComps(true);
    setRebuildCompsMsg(null);
    fetch("/api/comps/rebuild-all", { method: "POST", credentials: "include" })
      .then(r => r.json() as Promise<{ ok: boolean; rebuilt?: number; error?: string }>)
      .then(d => {
        if (!d.ok) throw new Error(d.error || "Rebuild failed");
        setRebuildCompsMsg(`✓ ${d.rebuilt ?? "?"} comps indexed`);
        load(effectiveDealIds);
      })
      .catch(e => setRebuildCompsMsg(`⚠ ${e.message}`))
      .finally(() => setRebuildingComps(false));
  };

  const pad = isMobile ? "16px" : "28px 32px";

  return (
    <div style={{ padding: pad, maxWidth: 1100, margin: "0 auto", boxSizing: "border-box", width: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, fontWeight: 500, color: "#26281f", letterSpacing: "-0.02em" }}>Portfolio Analytics</div>
          <div style={{ fontSize: 12, color: "#a89f8f", marginTop: 3 }}>Computed live from the tenant index</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", columnGap: 12, rowGap: 14, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {/* All / Owned scope toggle */}
          <div style={{ display:"flex", background:"#ede8df", borderRadius:7, padding:2, flexShrink:0 }}>
            {(["all", "owned"] as const).map(opt => (
              <button
                key={opt}
                onClick={() => setScope(opt)}
                style={{
                  padding:"5px 12px", borderRadius:5, border:"none", cursor:"pointer",
                  fontSize:11, fontWeight:600, fontFamily:"'Inter',sans-serif",
                  background:scope === opt ? "#383a37" : "transparent",
                  color:scope === opt ? "#fff" : "#7d766a",
                  transition:"background 0.15s, color 0.15s",
                  whiteSpace:"nowrap",
                }}
              >
                {opt === "all" ? "All" : "Owned"}
              </button>
            ))}
          </div>
          {onTenantAnalytics && (
            <button onClick={onTenantAnalytics} style={{ background: "transparent", border: "1px solid #ddd4c2", color: "#52554e", padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 600 }}>
              Tenant Analytics
            </button>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <button onClick={handleScoreUnscored} disabled={scoring} style={{ background: scoring ? "#eef3e6" : "transparent", border: "1px solid #6dba43", color: scoring ? "#a89f8f" : "#3f7a1f", padding: "6px 12px", borderRadius: 7, cursor: scoring ? "default" : "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 600, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
              <span style={{ fontSize: 12 }}>★</span>
              {scoring ? "Scoring…" : "Score unscored deals"}
            </button>
            {scoreMsg && <span style={{ fontSize: 10.5, color: scoreMsg.startsWith("✓") ? "#0f9d63" : "#dc2626", fontFamily: "'Inter',sans-serif" }}>{scoreMsg}</span>}
          </div>
          {staleCount > 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <button onClick={handleRefreshStale} disabled={refreshingStale} title="These deals' written analysis was produced under older scoring logic. Refreshing re-runs the cheap AI roster pass to bring the narrative + benchmark notes up to date." style={{ background: refreshingStale ? "#fff7e6" : "transparent", border: "1px solid #f59e0b", color: refreshingStale ? "#a89f8f" : "#92400e", padding: "6px 12px", borderRadius: 7, cursor: refreshingStale ? "default" : "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 600, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 12 }}>⚠</span>
                {refreshingStale ? "Refreshing…" : `Refresh ${staleCount} outdated analys${staleCount === 1 ? "is" : "es"}`}
              </button>
              {staleMsg && <span style={{ fontSize: 10.5, color: staleMsg.startsWith("✓") ? "#0f9d63" : "#dc2626", fontFamily: "'Inter',sans-serif" }}>{staleMsg}</span>}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <button onClick={() => onDataAudit?.()} title="Open the Data Audit worklist — the deals whose numbers don't tie out (SF vs GLA, NOI ÷ cap vs price, rent roll-ups, cash-flow subtotals…). Click any deal there to open it and fix the value."
              style={{ background: "transparent", border: `1px solid ${auditStats.deals > 0 ? "#f59e0b" : "#b8d49a"}`, color: auditStats.deals > 0 ? "#92400e" : "#3f7a1f", padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 600, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
              <span style={{ fontSize: 12 }}>{auditStats.deals > 0 ? "⚠" : "✓"}</span>
              {auditStats.deals > 0 ? `Review ${auditStats.deals} deal${auditStats.deals === 1 ? "" : "s"} w/ data issues (${auditStats.issues}) ›` : "Data integrity ✓"}
            </button>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {auditStats.breakdown.length > 0 && (
                <button onClick={() => setShowAuditBreakdown(s => !s)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 9.5, color: "#a69e91", fontFamily: "'Inter',sans-serif" }}>
                  {showAuditBreakdown ? "▴ hide breakdown" : "▾ what's flagged"}
                </button>
              )}
              <button onClick={handleCleanAndReaudit} disabled={maintaining} title="One pass over every deal: auto-fix the issues with a single right answer (occ-cost/cap/price-PSF units, rentPerSF from a reliable annual, duplicate rows, stale occupancy/WALT/avg-rent), then re-check all the numbers and post any contradictions to each deal's Import Review. Token-free, snapshots first (reversible), leaves judgement calls alone. New imports/edits self-maintain, so this is the one-click catch-up for existing deals." style={{ background: "none", border: "none", padding: 0, cursor: maintaining ? "default" : "pointer", fontSize: 9.5, color: "#3f7a1f", fontFamily: "'Inter',sans-serif", fontWeight: 600 }}>
                {maintaining ? (maintainMsg ?? "working…") : "🧹 Clean & re-audit all"}
              </button>
            </div>
            {maintainMsg && <span style={{ fontSize: 10.5, color: maintainMsg.startsWith("✓") ? "#0f9d63" : maintainMsg.startsWith("⚠") ? "#dc2626" : "#a69e91", fontFamily: "'Inter',sans-serif" }}>{maintainMsg}</span>}
            {showAuditBreakdown && auditStats.breakdown.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end", maxWidth: 360 }}>
                {auditStats.breakdown.map(b => (
                  <button key={b.key} onClick={() => onDataAudit?.(b.key)} title={`Show the deals flagged for: ${b.label}`}
                    style={{ fontSize: 9.5, color: "#6f6a5f", background: "#f6f1e7", border: "1px solid #e7e0d2", borderRadius: 10, padding: "2px 8px", fontFamily: "'Inter',sans-serif", whiteSpace: "nowrap", cursor: "pointer" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#efe7d6"; e.currentTarget.style.borderColor = "#d8cdb4"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "#f6f1e7"; e.currentTarget.style.borderColor = "#e7e0d2"; }}>
                    {b.label} · <b style={{ color: "#383a37" }}>{b.count}</b> ›
                  </button>
                ))}
              </div>
            )}
          </div>
          {isAdmin && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={handleRebuildComps} disabled={rebuildingComps} style={{ background: rebuildingComps ? "#f1eadc" : "transparent", border: "1px solid #c9c2b8", color: rebuildingComps ? "#a89f8f" : "#6f6a5f", padding: "6px 12px", borderRadius: 7, cursor: rebuildingComps ? "default" : "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 500, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 12 }}>↺</span>
                  {rebuildingComps ? "Rebuilding…" : "Rebuild comps"}
                </button>
                <button onClick={handleRebuild} disabled={rebuilding} style={{ background: rebuilding ? "#f1eadc" : "transparent", border: "1px solid #c9c2b8", color: rebuilding ? "#a89f8f" : "#6f6a5f", padding: "6px 12px", borderRadius: 7, cursor: rebuilding ? "default" : "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 500, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 12 }}>↺</span>
                  {rebuilding ? "Rebuilding…" : "Rebuild index"}
                </button>
              </div>
              {rebuildCompsMsg && <span style={{ fontSize: 10.5, color: rebuildCompsMsg.startsWith("✓") ? "#0f9d63" : "#dc2626", fontFamily: "'Inter',sans-serif" }}>{rebuildCompsMsg}</span>}
              {rebuildMsg && <span style={{ fontSize: 10.5, color: rebuildMsg.startsWith("✓") ? "#0f9d63" : "#dc2626", fontFamily: "'Inter',sans-serif" }}>{rebuildMsg}</span>}
            </div>
          )}
        </div>
      </div>

      {/* No deals match filter */}
      {noDeals && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#a89f8f", fontSize: 13 }}>
          No deals match the selected filters.
        </div>
      )}

      {!noDeals && loading && (
        <div style={{ textAlign: "center", padding: "80px 0", color: "#a89f8f" }}>
          <div style={{ fontSize: 13 }}>Computing…</div>
        </div>
      )}

      {!noDeals && error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "14px 18px", color: "#b91c1c", fontSize: 13 }}>
          Failed to load analytics: {error}
        </div>
      )}

      {!noDeals && !loading && !error && data && (
        <>
          {/* Summary stat boxes */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
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

          {/* Waterfall + Tenant Concentration — stack on mobile */}
          <div style={{
            display: isMobile ? "flex" : "grid",
            flexDirection: "column",
            gridTemplateColumns: "1fr 340px",
            gap: 14,
            marginBottom: 14,
          }}>
            <Card>
              <div id="section-lease-rollover" style={{ scrollMarginTop: 80 }} />
              <SectionLabel>Lease Expiration Waterfall — % of Rent by Year</SectionLabel>
              {data.leaseExpiration.length === 0 ? (
                <div style={{ color: "#a89f8f", fontSize: 13, padding: "20px 0" }}>No lease expiry data available.</div>
              ) : (
                <ExpirationWaterfall data={data.leaseExpiration} onYearClick={onYearClick ? (year => onYearClick(year, scope)) : undefined} />
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

          {/* Credit Mix — full width (Lease Type Mix removed) */}
          <Card style={{ width: "100%" }}>
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
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {data.creditMix.map(item => (
                      <div key={item.label} style={{ flex: "1 1 120px", textAlign: "center", background: "#faf7f0", borderRadius: 8, padding: "10px 6px" }}>
                        <div style={{ fontFamily: "'Fraunces',serif", fontSize: 20, color: "#26281f", fontWeight: 500 }}>{item.pct}%</div>
                        <div style={{ fontSize: 9.5, color: "#a89f8f", marginTop: 2 }}>{item.count} tenants</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </Card>

          {data.summary.totalAnnualRent === 0 && (
            <div style={{ marginTop: 20, padding: "16px 20px", background: "#faf7f0", border: "1px solid #ece5d7", borderRadius: 10, fontSize: 13, color: "#a89f8f" }}>
              The tenant index is empty. Try uploading some deals or run Rebuild Index to backfill.
            </div>
          )}
        </>
      )}
    </div>
  );
}
