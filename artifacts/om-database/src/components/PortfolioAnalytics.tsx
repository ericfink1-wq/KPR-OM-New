import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function barColor(year: string): string {
  if (year === "Unknown") return "#c9c2b8";
  if (year === "Expired") return "#a39a8c";
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

// Years before this one are leases that already expired as of TODAY (the OM was older
// than its roll). They're one "Expired" bucket, not a stack of past-year bars.
export const EXPIRED_LABEL = "Expired";
export function collapsePastYears(data: ExpirationBucket[], nowYear = NOW_YEAR): ExpirationBucket[] {
  const past = data.filter(d => /^\d{4}$/.test(d.year) && parseInt(d.year) < nowYear);
  if (!past.length) return data;
  const rest = data.filter(d => !past.includes(d));
  const sum = (k: "pct" | "annualRent" | "tenantCount") => past.reduce((a, d) => a + (Number(d[k]) || 0), 0);
  const expired = { ...past[0], year: EXPIRED_LABEL, pct: Math.round(sum("pct") * 10) / 10, annualRent: sum("annualRent"), tenantCount: sum("tenantCount") };
  return [expired, ...rest];
}

function ExpirationWaterfall({ data: raw, onYearClick }: { data: ExpirationBucket[]; onYearClick?: (year: string) => void }) {
  const data = collapsePastYears(raw);
  const maxPct = Math.max(...data.map(d => d.pct), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {data.map(d => {
        const isExpired = d.year === EXPIRED_LABEL;
        const clickable = !!onYearClick && !isExpired;
        return (
        <div
          key={d.year}
          onClick={() => { if (clickable) onYearClick?.(d.year); }}
          className={clickable ? "kpr-row-hover" : undefined}
          style={{ display: "flex", alignItems: "center", gap: 10, cursor: clickable ? "pointer" : "default", borderRadius: 6 }}
          title={isExpired ? `Leases whose expiry date (before ${NOW_YEAR}) has already passed — expired or in holdover as of today` : clickable ? `View ${d.year === "Unknown" ? "unknown expiry" : d.year} rollover detail` : undefined}
        >
          <div style={{ width: 52, textAlign: "right", fontSize: 11, fontWeight: 600, color: d.year === "Unknown" || isExpired ? "#a89f8f" : "#383a37", flexShrink: 0 }}>
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
          {onYearClick && (
            <div style={{ width: 14, textAlign: "center", fontSize: 10, color: "#c9c2b8", flexShrink: 0 }}>{clickable ? "›" : ""}</div>
          )}
        </div>
        );
      })}
      {data.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginTop: 4, paddingTop: 8, borderTop: "1px solid #f1eadc" }}>
          <div style={{ width: 52 }} />
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
          {onYearClick && <div style={{ width: 14 }} />}
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
  onFeedback?: () => void;
}

export default function PortfolioAnalytics({ filterDealIds, ownedDealIds, isAdmin, onYearClick, onTenantAudit, onTenantAnalytics, onDataAudit, onFeedback }: Props) {
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
  const [maintMenuOpen, setMaintMenuOpen] = useState(false);
  const [staleMsg, setStaleMsg] = useState<string | null>(null);
  // Batch (½-cost) stale-analysis refresh. The pending batch id is persisted to
  // localStorage so the page can keep polling/apply across reloads until it's done.
  const [batchInfo, setBatchInfo] = useState<{ id: string; count: number } | null>(() => {
    try { const s = localStorage.getItem("kpr_analysis_batch"); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const [auditStats, setAuditStats] = useState<{ deals: number; issues: number; high: number; breakdown: { key: string; label: string; count: number }[] }>({ deals: 0, issues: 0, high: 0, breakdown: [] });
  const [maintaining, setMaintaining] = useState(false);
  const [maintainMsg, setMaintainMsg] = useState<string | null>(null);
  const [showAuditBreakdown, setShowAuditBreakdown] = useState(false);
  // Opens on Owned: "All" is the whole market corpus (mostly deals KPR passed on), and its
  // rent total / top tenant read like KPR's own exposure when shown first (Eric, 10/16/26).
  const [scope, setScope] = useState<"all" | "owned">("owned");

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

  // Clear the stored AI-capture questions the data can now ANSWER. Audit questions
  // self-heal; these never did, so they pile up until the real contradictions are buried
  // (1,469 open across 231 of 301 deals, only ~60 of them genuine). It runs a DRY RUN
  // first and shows the real count before writing anything, because "this will clear
  // some questions" is not something to approve blind. Nothing is deleted: a cleared
  // question keeps its text and gains the reasoning that resolved it.
  const handleTriageQuestions = async () => {
    setMaintaining(true); setMaintainMsg("Checking what can be answered…");
    try {
      const post = (apply: boolean) => fetch("/api/deals/triage-questions", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      }).then(r => r.json() as Promise<{ ok: boolean; resolved?: number; dealsTouched?: number; byReason?: Record<string, number>; error?: string }>);

      const dry = await post(false);
      if (!dry.ok) throw new Error(dry.error || "Triage failed");
      if (!dry.resolved) { setMaintainMsg("Nothing to clear — every open question still needs a person."); return; }

      const reasons = Object.entries(dry.byReason || {})
        .map(([k, v]) => `  • ${({
          "walt-matches-roster": "WALT confirmed against the rent roll",
          "asof-now-recorded": "rent-roll as-of date now recorded",
          "roster-sf-ties": "roster SF reconciles to building GLA",
        } as Record<string, string>)[k] || k}: ${v}`)
        .join("\n");
      const ok = window.confirm(
        `Clear ${dry.resolved} question${dry.resolved === 1 ? "" : "s"} across ${dry.dealsTouched} deal${dry.dealsTouched === 1 ? "" : "s"}?\n\n${reasons}\n\n` +
        `These are questions the data now answers on its own. Each one keeps its original ` +
        `text and records why it was cleared, so nothing is lost — and anything the data ` +
        `can't settle is left open for you.`,
      );
      if (!ok) { setMaintainMsg(""); return; }

      setMaintainMsg("Clearing…");
      const applied = await post(true);
      if (!applied.ok) throw new Error(applied.error || "Triage failed");
      setMaintainMsg(`Cleared ${applied.resolved} answered question${applied.resolved === 1 ? "" : "s"} across ${applied.dealsTouched} deals.`);
    } catch (e) {
      setMaintainMsg(e instanceof Error ? e.message : "Triage failed");
    } finally {
      setMaintaining(false);
    }
  };

  // One sweep over the whole library: auto-fix the safe issues, THEN re-audit every
  // deal. Going forward each write self-maintains, so this is the one-click catch-up for
  // existing deals (and a manual "clean everything now"). Token-free; snapshots first
  // (reversible via Backup → Restore a snapshot); leaves judgement calls flagged, not changed.
  const handleCleanAndReaudit = async () => {
    if (!window.confirm("Clean & re-audit ALL deals now? Token-free and reversible (it snapshots first). It auto-fixes the issues with a single right answer — occupancy-cost units, cap-rate units, price-PSF, a rentPerSF that doesn't reconcile to a reliable annual, duplicate roster rows, non-ISO lease dates, a co-tenancy \u201cX of N\u201d clause stored as a single-anchor trigger, and stale occupancy / WALT / avg-rent — then re-checks every deal's numbers and posts any contradictions to that deal's Import Review. Ambiguous figures are LEFT for you to review; anything you've already resolved is untouched.")) return;
    setMaintaining(true); setMaintainMsg("Cleaning…");
    try {
      const a = await fetch("/api/deals/autofix", { method: "POST", credentials: "include" })
        .then(r => r.json() as Promise<{ ok: boolean; occCostFixed?: number; occUnitFixed?: number; capUnitFixed?: number; ppsfFixed?: number; rentFixed?: number; rentFilled?: number; dupeFixed?: number; dateFixed?: number; metricFixes?: number; coTenancyFixed?: number; nameFixed?: number; changedDeals?: number; cleared?: number; error?: string }>);
      if (!a.ok) throw new Error(a.error || "Auto-fix failed");
      setMaintainMsg("Re-auditing…");
      const b = await fetch("/api/deals/reaudit", { method: "POST", credentials: "include" })
        .then(r => r.json() as Promise<{ ok: boolean; flagged?: number; added?: number; cleared?: number; error?: string }>);
      if (!b.ok) throw new Error(b.error || "Audit failed");
      const parts = ([
        [a.occCostFixed, "occ-cost"], [a.occUnitFixed, "occupancy units"], [a.capUnitFixed, "cap-rate units"],
        [a.ppsfFixed, "price-PSF"], [a.rentFixed, "rent"], [a.rentFilled, "rent filled"], [a.dupeFixed, "dup rows"], [a.dateFixed, "dates→ISO"], [a.metricFixes, "metrics"], [a.coTenancyFixed, "co-tenancy \u201cX of N\u201d triggers"], [a.nameFixed, "missing property names"],
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

  // Bulk-load purchase price/date, seller, NOI-at-close and going-in cap onto existing
  // deals from a JSON file ({ "rows": [{ propertyName, txnPurchasePrice, txnCloseDate,
  // txnSeller, acqNOIAtClose, acqCapRate }, ...] }). Matched by property name (+address);
  // ONLY those fields are set — roster, financials and notes are untouched.
  const txnFileRef = useRef<HTMLInputElement>(null);
  const handleImportTransactions = async (file: File) => {
    setMaintaining(true); setMaintainMsg("Importing transactions…");
    try {
      const text = await file.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new Error("That file isn't valid JSON"); }
      const rows = Array.isArray(parsed) ? parsed : (parsed as { rows?: unknown })?.rows;
      if (!Array.isArray(rows)) throw new Error('Expected { "rows": [ ... ] } or a JSON array');
      const r = await fetch("/api/deals/import-transactions", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      }).then(x => x.json() as Promise<{ ok: boolean; matchedCount?: number; unmatchedCount?: number; unmatched?: string[]; error?: string }>);
      if (!r.ok) throw new Error(r.error || "Import failed");
      const um = (r.unmatched && r.unmatched.length) ? ` · unmatched: ${r.unmatched.join(", ")}` : "";
      setMaintainMsg(`✓ Set transactions on ${r.matchedCount ?? 0} deal${(r.matchedCount ?? 0) === 1 ? "" : "s"}${r.unmatchedCount ? ` · ${r.unmatchedCount} unmatched` : ""}${um} — reloading…`);
      setTimeout(() => window.location.reload(), 2400);
    } catch (e) {
      setMaintainMsg(`⚠ ${e instanceof Error ? e.message : "failed"}`);
    } finally {
      setMaintaining(false);
    }
  };

  // Import a Datex snapshot produced by a Claude session. Datex's auth server has no
  // machine-to-machine grant, so the site cannot pull for itself — a person authenticated to
  // Datex generates the JSON and it lands here.
  //
  // It DRY RUNS first and shows exactly what would change, because the file is generated
  // rather than typed: a payload built against the wrong building looks entirely plausible
  // in its own output. Nothing is written until that summary is accepted. The acquisition-era
  // figures are never touched either way — the server only ever writes the live block.
  const datexFileRef = useRef<HTMLInputElement>(null);
  const handleDatexImport = async (file: File) => {
    setMaintaining(true); setMaintainMsg("Checking the Datex file…");
    try {
      const text = await file.text();
      let payload: unknown;
      try { payload = JSON.parse(text); } catch { throw new Error("That file isn't valid JSON"); }

      type Row = { dealId: string; propertyName: string; problem?: string; reason?: string };
      type Div = { propertyName: string; rows: Array<{ field: string; acquisition: number; live: number; deltaPct: number | null; note?: string }> };
      type Resp = { ok: boolean; counts?: { wouldUpdate: number; skipped: number; rejected: number }; rejected?: Row[]; skipped?: Row[]; divergences?: Div[]; error?: string };
      const post = (apply: boolean) => fetch("/api/deals/datex-import", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply, payload }),
      }).then(r => r.json() as Promise<Resp>);

      const dry = await post(false);
      if (!dry.ok) throw new Error(dry.error || "Datex import failed");
      const c = dry.counts ?? { wouldUpdate: 0, skipped: 0, rejected: 0 };
      if (!c.wouldUpdate) {
        const why = (dry.rejected ?? []).slice(0, 4).map(r => `  • ${r.propertyName || r.dealId}: ${r.problem}`).join("\n");
        throw new Error(`Nothing to import.${why ? `\n\n${why}` : ""}`);
      }

      // Lead with the divergences: the gap between the frozen acquisition figure and what
      // the asset does today is the reason for holding both, so it belongs in the decision.
      const moves = (dry.divergences ?? []).flatMap(d =>
        d.rows.filter(r => r.note || (r.deltaPct != null && Math.abs(r.deltaPct) >= 2))
          .map(r => `  • ${d.propertyName} — ${r.note ? r.note : `${r.field}: ${r.acquisition} → ${r.live} (${r.deltaPct}%)`}`),
      ).slice(0, 12);
      const rejected = (dry.rejected ?? []).slice(0, 5).map(r => `  • ${r.propertyName || r.dealId}: ${r.problem}`);

      const ok = window.confirm(
        `Import live Datex data for ${c.wouldUpdate} deal${c.wouldUpdate === 1 ? "" : "s"}?\n` +
        `${c.skipped ? `${c.skipped} skipped (not in Datex yet). ` : ""}${c.rejected ? `${c.rejected} REJECTED.` : ""}\n` +
        (moves.length ? `\nNotable differences vs the acquisition snapshot:\n${moves.join("\n")}\n` : "") +
        (rejected.length ? `\nRejected:\n${rejected.join("\n")}\n` : "") +
        `\nThis writes a separate live block. Your original OM figures are not touched, and the ` +
        `library is snapshotted first, so it's reversible from Backup.`,
      );
      if (!ok) { setMaintainMsg(""); return; }

      setMaintainMsg("Importing…");
      const done = await post(true);
      if (!done.ok) throw new Error(done.error || "Datex import failed");
      setMaintainMsg(`✓ Live Datex data on ${done.counts?.wouldUpdate ?? 0} deals — reloading…`);
      setTimeout(() => window.location.reload(), 2400);
    } catch (e) {
      setMaintainMsg(`⚠ ${e instanceof Error ? e.message : "failed"}`);
    } finally {
      setMaintaining(false);
    }
  };

  // Admin: permanently remove soft-deleted (trashed) deals whose data lingers in the
  // DB. Snapshots first on the server, so a mistaken purge is restorable from Backup.
  const handlePurgeTrashed = async () => {
    if (!window.confirm("Permanently remove all DELETED deals?\n\nThese are deals you sent to the trash — their data still lives in the database (which is why deleted deals can reappear in exports/analytics). This removes them for good. It snapshots the whole library first, so it's reversible from Backup → Restore if needed.")) return;
    setMaintaining(true);
    setMaintainMsg("Removing deleted deals…");
    try {
      const r = await fetch("/api/deals/purge-trashed", { method: "POST", credentials: "include" })
        .then(r => r.json() as Promise<{ ok: boolean; purged?: number; error?: string }>);
      if (!r.ok) throw new Error(r.error || "Purge failed");
      setMaintainMsg(`✓ Removed ${r.purged ?? 0} deleted deal${(r.purged ?? 0) === 1 ? "" : "s"} — reloading…`);
      setTimeout(() => window.location.reload(), 1600);
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

  const saveBatch = (info: { id: string; count: number } | null) => {
    setBatchInfo(info);
    try { if (info) localStorage.setItem("kpr_analysis_batch", JSON.stringify(info)); else localStorage.removeItem("kpr_analysis_batch"); } catch { /* ignore */ }
  };

  // Submit ALL stale deals as one Anthropic Message Batch (~½ the token cost). It runs
  // in the background and applies automatically when ready (the effect below polls).
  const handleBatchRefresh = () => {
    if (!window.confirm(`Submit ${staleCount} deal${staleCount === 1 ? "" : "s"} as ONE background batch at about HALF the AI cost? It processes asynchronously (usually minutes, occasionally up to ~1 hour) and applies automatically when ready — you can leave this page. The regular "Refresh" button is faster but full price.`)) return;
    setBatchBusy(true); setBatchMsg("Submitting…");
    fetch("/api/deals/refresh-stale-analysis-batch", { method: "POST", credentials: "include" })
      .then(r => r.json() as Promise<{ ok: boolean; batchId?: string | null; count?: number; error?: string }>)
      .then(d => {
        if (!d.ok) throw new Error(d.error || "Batch submit failed");
        if (!d.batchId || !d.count) { setBatchMsg("Nothing to refresh."); return; }
        saveBatch({ id: d.batchId, count: d.count });
        setBatchMsg(`✓ Submitted ${d.count} deal${d.count === 1 ? "" : "s"} at ~½ cost — processing in the background. Applies automatically; safe to leave this page.`);
      })
      .catch(e => setBatchMsg(`⚠ ${e.message}`))
      .finally(() => setBatchBusy(false));
  };

  // While a batch is pending, poll apply (on mount + every 60s). When ENDED, it applies
  // the results, clears the stored batch, and reloads. Re-runs whenever batchInfo changes.
  useEffect(() => {
    if (!batchInfo) return;
    let cancelled = false;
    const poll = () => {
      fetch("/api/deals/apply-analysis-batch", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: batchInfo.id }) })
        .then(r => r.json() as Promise<{ ok: boolean; status?: string; applied?: number; failed?: number; error?: string }>)
        .then(d => {
          if (cancelled) return;
          if (!d.ok) return;
          if (d.status !== "ended") { setBatchMsg(`⏳ Batch processing (${batchInfo.count} deal${batchInfo.count === 1 ? "" : "s"}) — applies automatically when ready.`); return; }
          const n = d.applied ?? 0;
          saveBatch(null);
          setBatchMsg(`✓ Applied ${n} refreshed analys${n === 1 ? "is" : "es"}${d.failed ? `, ${d.failed} failed` : ""} — reloading…`);
          setStaleCount(0);
          setTimeout(() => window.location.reload(), 1400);
        })
        .catch(() => { /* transient; next tick retries */ });
    };
    poll();
    const iv = setInterval(poll, 60000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [batchInfo]);

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
          <h1 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 22, fontWeight: 500, color: "#26281f", letterSpacing: "-0.02em" }}>
            {scope === "owned" ? "Portfolio Analytics — Owned" : `Market Corpus${data ? ` (${data.summary.dealCount} OMs)` : ""}`}
          </h1>
          <div style={{ fontSize: 12, color: "#a89f8f", marginTop: 3 }}>{scope === "owned" ? "KPR's owned properties — each counted once" : "Every deal in the library — the market, not KPR's exposure"}</div>
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
                {opt === "all" ? "All deals (market)" : `Owned${ownedDealIds ? ` (${ownedDealIds.length})` : ""}`}
              </button>
            ))}
          </div>
          {onTenantAnalytics && (
            <button onClick={onTenantAnalytics} style={{ background: "transparent", border: "1px solid #ddd4c2", color: "#52554e", padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 600 }}>
              Tenant Analytics
            </button>
          )}
          {/* One Maintenance menu for every admin-type action (Eric, 10/16/26: five buttons
              crowded the title). The badge counts what needs attention. */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div style={{ position: "relative" }}>
              <button onClick={() => setMaintMenuOpen(o => !o)} disabled={maintaining || rebuilding || rebuildingComps}
                aria-label={`Maintenance${staleCount + auditStats.deals > 0 ? ` — ${staleCount + auditStats.deals} need attention` : ""}`}
                style={{ position: "relative", background: "transparent", border: "1px solid #d9d2c4", color: "#6f6a5f", padding: "7px 13px", borderRadius: 7, cursor: "pointer", fontSize: 11.5, fontFamily: "'Inter',sans-serif", fontWeight: 600, whiteSpace: "nowrap" }}>
                ⚙ Maintenance <span style={{ fontSize: 9, color: "#a69e91" }}>▾</span>
                {staleCount + auditStats.deals > 0 && (
                  <span title={`${auditStats.deals} deal${auditStats.deals === 1 ? "" : "s"} with data issues · ${staleCount} outdated analys${staleCount === 1 ? "is" : "es"}`}
                    style={{ position: "absolute", top: -7, right: -7, minWidth: 18, height: 18, padding: "0 5px", boxSizing: "border-box", borderRadius: 9, background: "#c97a18", color: "#fff", fontSize: 10, fontWeight: 700, lineHeight: "18px", textAlign: "center", boxShadow: "0 0 0 2px #f6f2ea" }}>
                    {staleCount + auditStats.deals > 99 ? "99+" : staleCount + auditStats.deals}
                  </span>
                )}
              </button>
              {maintMenuOpen && (
                <>
                  <div onClick={() => setMaintMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9000 }} />
                  <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, zIndex: 9001, background: "#fff", border: "1px solid #e6dfd0", borderRadius: 10, boxShadow: "0 8px 28px rgba(56,58,55,0.16)", minWidth: 250, maxWidth: "calc(100vw - 32px)", overflow: "hidden", padding: "4px 0", fontFamily: "'Inter',sans-serif" }}>
                    {([
                      [auditStats.deals > 0 ? `⚠ Review ${auditStats.deals} deal${auditStats.deals === 1 ? "" : "s"} with data issues (${auditStats.issues})` : "✓ Data integrity — nothing flagged", () => { setMaintMenuOpen(false); onDataAudit?.(); }, auditStats.deals > 0 ? "#92400e" : "#3f7a1f", false, "Open the Data Audit worklist — the deals whose numbers don't tie out."],
                      ...(onFeedback ? [["🧠 Feedback & Trends", () => { setMaintMenuOpen(false); onFeedback(); }, "#6b3f8f", false, "Every open data issue across the library, grouped by type; answer in plain English to create guardrails for future extractions."] as const] : []),
                      ["★ Score unscored deals", () => { setMaintMenuOpen(false); handleScoreUnscored(); }, "#3f7a1f", scoring, "Run the AI grade on every deal that has no grade yet."],
                      ...(staleCount > 0 ? [[`⚠ Refresh ${staleCount} outdated analys${staleCount === 1 ? "is" : "es"}`, () => { setMaintMenuOpen(false); handleRefreshStale(); }, "#92400e", refreshingStale || !!batchInfo, "Re-run the AI write-up on deals analyzed under older scoring logic."] as const] : []),
                      ...(staleCount > 0 && !batchInfo ? [["💸 …or batch them at ~½ cost", () => { setMaintMenuOpen(false); handleBatchRefresh(); }, "#3f7a1f", batchBusy, "Same refresh as one background batch — about half the AI cost; applies automatically when ready."] as const] : []),
                        ["🧹 Clean & re-audit all", () => { setMaintMenuOpen(false); handleCleanAndReaudit(); }, "#383a37", maintaining, "Auto-fix the unambiguous issues across every deal, then re-check all the numbers. Token-free, snapshots first (reversible)."],
                        ["✅ Clear answered questions", () => { setMaintMenuOpen(false); handleTriageQuestions(); }, "#383a37", maintaining, "Close the import questions the data now answers by itself (e.g. a WALT the rent roll confirms), so the real contradictions aren't buried. Shows you the count first; nothing is deleted."],
                        ["↺ Rebuild comps index", () => { setMaintMenuOpen(false); handleRebuildComps(); }, "#383a37", rebuildingComps, "Rebuild the comparable-sales index from every deal's owned/manual/OM comps."],
                        ["↺ Rebuild tenant index", () => { setMaintMenuOpen(false); handleRebuild(); }, "#383a37", rebuilding, "Rebuild the tenant search index across all deals."],
                        ["📡 Import Datex snapshot (JSON)", () => { setMaintMenuOpen(false); datexFileRef.current?.click(); }, "#383a37", maintaining, "Load live occupancy, rent and tenant data exported from Datex by Claude. Shows you what would change before writing, never touches the original OM figures, and snapshots first."],
                        ...(isAdmin ? [["💲 Import transactions (JSON)", () => { setMaintMenuOpen(false); txnFileRef.current?.click(); }, "#383a37", maintaining, "Bulk-set purchase price/date, seller, NOI-at-close and going-in cap on existing deals from a JSON file (matched by property name). ONLY those fields change — roster, financials and notes are untouched."] as const] : []),
                        ...(isAdmin ? [["🗑 Remove deleted deals", () => { setMaintMenuOpen(false); handlePurgeTrashed(); }, "#b06a4e", maintaining, "Permanently remove trashed deals whose data still sits in the DB. Snapshots first."] as const] : []),
                                          ] as [string, () => void, string, boolean, string][]).map(([label, fn, color, busy, tip], i) => (
                      <button key={label} onClick={fn} disabled={busy} title={tip}
                        style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderTop: i > 0 && (label.startsWith("★") || label.startsWith("🧹")) ? "1px solid #f1eadc" : "none", padding: "10px 14px", cursor: busy ? "default" : "pointer", fontSize: 12.5, fontWeight: 600, color, whiteSpace: "normal", opacity: busy ? 0.5 : 1 }}
                        onMouseEnter={e => { if (!busy) e.currentTarget.style.background = "#f9f6f0"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                        {label}
                      </button>
                    ))}
                    {auditStats.breakdown.length > 0 && (
                      <div style={{ borderTop: "1px solid #f1eadc", padding: "8px 12px 10px" }}>
                        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: "#a69e91", textTransform: "uppercase", marginBottom: 5 }}>What's flagged</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {auditStats.breakdown.map(b => (
                            <button key={b.key} onClick={() => { setMaintMenuOpen(false); onDataAudit?.(b.key); }} title={`Show the deals flagged for: ${b.label}`}
                              style={{ fontSize: 10, color: "#6f6a5f", background: "#f6f1e7", border: "1px solid #e7e0d2", borderRadius: 10, padding: "2px 8px", fontFamily: "'Inter',sans-serif", whiteSpace: "nowrap", cursor: "pointer" }}>
                              {b.label} · <b style={{ color: "#383a37" }}>{b.count}</b> ›
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
                <input ref={datexFileRef} type="file" accept=".json,application/json" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleDatexImport(f); e.currentTarget.value = ""; }} />
                <input ref={txnFileRef} type="file" accept=".json,application/json" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImportTransactions(f); e.currentTarget.value = ""; }} />
            </div>
            {[scoreMsg, staleMsg, batchMsg, maintainMsg].filter(Boolean).map((m, i) => (
              <span key={i} style={{ fontSize: 10.5, color: m!.startsWith("✓") ? "#0f9d63" : m!.startsWith("⚠") ? "#dc2626" : "#a69e91", fontFamily: "'Inter',sans-serif", maxWidth: 300, textAlign: "right" }}>{m}</span>
            ))}
          </div>
          {(rebuildCompsMsg || rebuildMsg) && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              {rebuildCompsMsg && <span style={{ fontSize: 10.5, color: rebuildCompsMsg.startsWith("✓") ? "#0f9d63" : "#dc2626", fontFamily: "'Inter',sans-serif" }}>{rebuildCompsMsg}</span>}
              {rebuildMsg && <span style={{ fontSize: 10.5, color: rebuildMsg.startsWith("✓") ? "#0f9d63" : "#dc2626", fontFamily: "'Inter',sans-serif" }}>{rebuildMsg}</span>}
            </div>
          )}
        </div>
      </div>

      {/* No deals match filter */}
      {scope === "all" && (
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "#7a4a10", background: "#fdf4e7", border: "1px solid #f0d9b5", borderRadius: 9, padding: "9px 12px", marginBottom: 14 }}>
          <strong>Market view.</strong> This is every deal in the library, mostly ones KPR looked at and didn't buy. Totals, top tenants and concentration here describe the market, <strong>not KPR's exposure</strong>. Switch to <strong>Owned</strong> for the portfolio.
        </div>
      )}
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
              <div style={{ fontSize: 10.5, color: "#a89f8f", marginTop: 8, lineHeight: 1.45 }}>
                Expiry dates come from each deal's OM or rent roll, so these are as of each document's date, not live.{scope === "owned" ? " For today's rollover on owned centers, Datex is the source of record." : ""}
              </div>
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
