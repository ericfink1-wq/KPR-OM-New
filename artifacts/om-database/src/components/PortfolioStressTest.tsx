import { useEffect, useMemo, useState } from "react";
import type { Deal, LeaseAbstract } from "../lib/idb";
import { apiListAllLeaseAbstracts } from "../lib/api";
import { runTenantStressTest } from "../lib/tenantStressTest";

// "This chain just filed" — the portfolio-wide blast radius of one tenant going
// dark: its own rent in every deal, plus other tenants' rent that converts to
// reduced/alternate rent through co-tenancy clauses naming it (the same resolved
// clause engine as the per-deal Lease Risk panel; abstracts override OM capture).
interface Props {
  tenantName: string;
  brands?: string[];      // parent-company mode: all banners to fail together
  deals: Deal[];
  onOpenDeal: (deal: Deal) => void;
}

function fmtRent(r: number): string {
  if (r >= 1_000_000) return `$${(r / 1_000_000).toFixed(2)}M`;
  if (r >= 1_000) return `$${Math.round(r / 1_000)}K`;
  return `$${Math.round(r)}`;
}

export default function PortfolioStressTest({ tenantName, brands, deals, onOpenDeal }: Props) {
  const [abstracts, setAbstracts] = useState<LeaseAbstract[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  // The box is a heavy "what-if" — default it COLLAPSED so opening a tenant/parent
  // page leads with the profile, not the stress test. The header stays a one-line
  // summary (total at risk) and clicks open to reveal the full breakdown.
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    let live = true;
    apiListAllLeaseAbstracts().then((a) => { if (live) setAbstracts(a); }).catch(() => { if (live) setAbstracts([]); });
    return () => { live = false; };
  }, []);

  const result = useMemo(() => {
    const byDeal = new Map<string, LeaseAbstract[]>();
    for (const a of abstracts || []) {
      if (!a?.dealId) continue;
      if (!byDeal.has(a.dealId)) byDeal.set(a.dealId, []);
      byDeal.get(a.dealId)!.push(a);
    }
    return runTenantStressTest(tenantName, brands?.length ? brands : [tenantName], deals, byDeal);
  }, [tenantName, brands, deals, abstracts]);

  const dealById = useMemo(() => new Map((deals || []).map((d) => [d.id, d])), [deals]);
  if (result.rows.length === 0) return null;
  const shown = expanded ? result.rows : result.rows.slice(0, 8);
  const hasKnockOn = result.totalTier1Rent > 0 || result.totalTier2Rent > 0;

  return (
    <div style={{ background: "#fff", border: "1px solid #e7d5c8", borderRadius: 12, padding: "16px 18px", marginBottom: 14 }}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
      >
        <span style={{ fontSize: 10, color: "#a0561f", lineHeight: 1, transform: collapsed ? "none" : "rotate(90deg)", transition: "transform 0.15s", display: "inline-block" }}>▶</span>
        <span style={{ fontSize: 9, letterSpacing: "0.12em", color: "#a0561f", fontWeight: 700, textTransform: "uppercase" }}>
          Stress test — if {result.target} goes dark
        </span>
        {collapsed && (
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#9a2c12", fontWeight: 700, fontFamily: "'Inter',sans-serif", whiteSpace: "nowrap" }}>
            {fmtRent(result.totalAtRisk)}/yr · {result.dealsWithPresence} deal{result.dealsWithPresence === 1 ? "" : "s"}
          </span>
        )}
      </button>

      {!collapsed && (<>
      <div style={{ fontSize: 11, color: "#a89f8f", margin: "8px 0 12px", fontFamily: "'Inter',sans-serif", lineHeight: 1.5 }}>
        Portfolio-wide blast radius: {result.target}'s own rent, plus other tenants' rent that converts to reduced/alternate
        rent through co-tenancy clauses naming it{hasKnockOn ? "" : " (no co-tenancy linkage captured yet — direct rent only)"}.
      </div>

      {/* Totals */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: "#a89f8f", marginBottom: 3, fontFamily: "'Inter',sans-serif" }}>Direct rent · {result.dealsWithPresence} deal{result.dealsWithPresence === 1 ? "" : "s"}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#2a2c28", fontFamily: "'Fraunces',Georgia,serif", lineHeight: 1 }}>{fmtRent(result.totalDirectRent)}</div>
        </div>
        {result.totalTier1Rent > 0 && (
          <div title="Other tenants' base rent whose co-tenancy clause trips on this tenant ALONE — converts to alternate/reduced rent (or opens a termination right) the day it goes dark.">
            <div style={{ fontSize: 10, color: "#a0561f", marginBottom: 3, fontFamily: "'Inter',sans-serif" }}>Co-tenancy knock-on (Tier 1)</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#b3541a", fontFamily: "'Fraunces',Georgia,serif", lineHeight: 1 }}>{fmtRent(result.totalTier1Rent)}</div>
          </div>
        )}
        {result.totalTier2Rent > 0 && (
          <div title="Needs a SECOND anchor event to trip — a watch item, not day-one exposure.">
            <div style={{ fontSize: 10, color: "#a89f8f", marginBottom: 3, fontFamily: "'Inter',sans-serif" }}>Tier 2 (needs 2nd event)</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#8a8474", fontFamily: "'Fraunces',Georgia,serif", lineHeight: 1 }}>{fmtRent(result.totalTier2Rent)}</div>
          </div>
        )}
        <div>
          <div style={{ fontSize: 10, color: "#a0561f", marginBottom: 3, fontFamily: "'Inter',sans-serif" }}>Total at risk / yr</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#9a2c12", fontFamily: "'Fraunces',Georgia,serif", lineHeight: 1 }}>{fmtRent(result.totalAtRisk)}</div>
        </div>
      </div>

      {/* Per-deal rows */}
      <div>
        {shown.map((r) => (
          <div key={r.dealId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid #f4efe4", fontSize: 12.5, flexWrap: "wrap" }}>
            <button onClick={() => { const d = dealById.get(r.dealId); if (d) onOpenDeal(d); }}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 600, color: "#26281f", textAlign: "left", flex: "1 1 160px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.dealName}{r.owned && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: "#2f6b1f", background: "#eef7e4", border: "1px solid #cfe3b8", borderRadius: 4, padding: "0 4px" }}>OWNED</span>}
            </button>
            <div style={{ color: "#7d766a", whiteSpace: "nowrap" }}>
              {r.directRent > 0 ? `direct ${fmtRent(r.directRent)}` : "no direct rent"}
              {r.tier1Rent > 0 && <span style={{ color: "#b3541a", fontWeight: 600 }}> + {fmtRent(r.tier1Rent)} knock-on ({r.dependents.slice(0, 3).join(", ")}{r.dependents.length > 3 ? "…" : ""})</span>}
            </div>
            <div style={{ width: 76, textAlign: "right", fontWeight: 700, color: "#9a2c12", whiteSpace: "nowrap" }}>
              {fmtRent(r.totalAtRisk)}
              {r.dealTotalRent > 0 && <span style={{ color: "#a89f8f", fontWeight: 500 }}> · {Math.round((r.totalAtRisk / r.dealTotalRent) * 100)}%</span>}
            </div>
          </div>
        ))}
      </div>
      {result.rows.length > 8 && (
        <button onClick={() => setExpanded(!expanded)}
          style={{ background: "none", border: "none", color: "#a0561f", cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "6px 0 0" }}>
          {expanded ? "Show fewer" : `Show all ${result.rows.length} deals`}
        </button>
      )}
      </>)}
    </div>
  );
}
