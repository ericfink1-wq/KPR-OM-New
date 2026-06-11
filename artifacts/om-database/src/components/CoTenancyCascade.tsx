import { useEffect, useMemo, useState } from "react";
import type { Deal, LeaseAbstract } from "../lib/idb";
import { resolveTenantRisk, computeExposure, anchorsReferenced, type ExposureResult } from "../lib/leaseRisk";
import { apiListAllLeaseAbstracts } from "../lib/api";
import { isVacant } from "../lib/utils";
import ScopeToggle, { scopeDeals, type Scope } from "./ScopeToggle";

interface Props {
  deals: Deal[];
  onOpenDeal: (dealId: string) => void;
}

interface DealHit {
  dealId: string;
  dealName: string;
  exposure: ExposureResult;
}

interface AnchorRow {
  anchor: string;
  tier1Rent: number;   // trips if THIS anchor alone goes dark
  tier3Rent: number;   // any linkage (may need other events too)
  dealCount: number;
  tenantCount: number;
  hits: DealHit[];
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

const TIER_LABEL: Record<number, string> = {
  1: "trips on this anchor alone",
  2: "needs a second event",
  3: "linked (needs other events)",
};

export default function CoTenancyCascade({ deals, onOpenDeal }: Props) {
  const [abstracts, setAbstracts] = useState<LeaseAbstract[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<Scope>("owned");
  const [query, setQuery] = useState("");

  const ownedCount = useMemo(() => deals.filter(d => !d.trashedAt && d.status === "Owned").length, [deals]);
  const allCount = useMemo(() => deals.filter(d => !d.trashedAt).length, [deals]);

  useEffect(() => { apiListAllLeaseAbstracts().then(setAbstracts).catch(() => setAbstracts([])); }, []);

  const abstractsByDeal = useMemo(() => {
    const m = new Map<string, LeaseAbstract[]>();
    for (const a of abstracts || []) {
      const id = (a as { dealId?: string }).dealId;
      if (!id) continue;
      if (!m.has(id)) m.set(id, []);
      m.get(id)!.push(a);
    }
    return m;
  }, [abstracts]);

  const rows = useMemo<AnchorRow[]>(() => {
    const byAnchor = new Map<string, AnchorRow>();
    for (const d of scopeDeals(deals, scope)) {
      if (d.trashedAt) continue;
      const resolved = resolveTenantRisk(d, abstractsByDeal.get(d.id) || []);
      const anchors = anchorsReferenced(resolved);
      if (!anchors.length) continue;
      const dealName = d.propertyName || d.address || "Untitled deal";
      for (const anchor of anchors) {
        const exposure = computeExposure(resolved, anchor);
        if (exposure.tier3Count === 0) continue;
        const key = anchor.toLowerCase().trim();
        let row = byAnchor.get(key);
        if (!row) { row = { anchor, tier1Rent: 0, tier3Rent: 0, dealCount: 0, tenantCount: 0, hits: [] }; byAnchor.set(key, row); }
        row.tier1Rent += exposure.tier1Rent;
        row.tier3Rent += exposure.tier3Rent;
        row.dealCount += 1;
        row.tenantCount += exposure.tier3Count;
        row.hits.push({ dealId: d.id, dealName, exposure });
      }
    }
    const out = [...byAnchor.values()];
    for (const r of out) r.hits.sort((a, b) => b.exposure.tier1Rent - a.exposure.tier1Rent || b.exposure.tier3Rent - a.exposure.tier3Rent);
    // Most portfolio-wide single-anchor exposure first; fall back to any-linkage rent.
    out.sort((a, b) => b.tier1Rent - a.tier1Rent || b.tier3Rent - a.tier3Rent);
    return out;
  }, [deals, abstractsByDeal, scope]);

  const toggle = (k: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  // Every tenant/anchor name across the scoped deals — powers the typeahead so you can
  // model ANY tenant going dark, not just the auto-detected co-tenancy anchors.
  const allTenantNames = useMemo(() => {
    const set = new Set<string>();
    for (const d of scopeDeals(deals, scope)) {
      if (d.trashedAt) continue;
      for (const t of d.tenants || []) {
        const nm = (t.canonicalName || t.name || "").trim();
        if (nm && !isVacant(nm)) set.add(nm);
      }
      for (const a of anchorsReferenced(resolveTenantRisk(d, abstractsByDeal.get(d.id) || []))) {
        if (a.trim()) set.add(a.trim());
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [deals, scope, abstractsByDeal]);

  // Cascade for the exact tenant the user typed/picked — computed even when there are
  // zero dependent leases (a $0 result usefully CONFIRMS no co-tenancy exposure).
  const customRow = useMemo<AnchorRow | null>(() => {
    const q = query.trim();
    if (!q) return null;
    const row: AnchorRow = { anchor: q, tier1Rent: 0, tier3Rent: 0, dealCount: 0, tenantCount: 0, hits: [] };
    for (const d of scopeDeals(deals, scope)) {
      if (d.trashedAt) continue;
      const resolved = resolveTenantRisk(d, abstractsByDeal.get(d.id) || []);
      const exposure = computeExposure(resolved, q);
      if (exposure.tier3Count === 0) continue;
      row.tier1Rent += exposure.tier1Rent;
      row.tier3Rent += exposure.tier3Rent;
      row.dealCount += 1;
      row.tenantCount += exposure.tier3Count;
      row.hits.push({ dealId: d.id, dealName: d.propertyName || d.address || "Untitled deal", exposure });
    }
    row.hits.sort((a, b) => b.exposure.tier1Rent - a.exposure.tier1Rent || b.exposure.tier3Rent - a.exposure.tier3Rent);
    return row;
  }, [query, deals, scope, abstractsByDeal]);

  const renderRow = (row: AnchorRow, forceOpen = false) => {
    const key = row.anchor.toLowerCase().trim();
    const open = forceOpen || expanded.has(key);
    return (
      <div key={key} style={{ background: "#fff", border: "1px solid #e7e0d2", borderRadius: 12, marginBottom: 12, overflow: "hidden" }}>
        <button onClick={() => toggle(key)}
          style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "13px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: "#a89f8f", width: 12 }}>{open ? "▾" : "▸"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: 16, fontWeight: 700, color: "#26281f" }}>
              If {row.anchor} goes dark
            </div>
            <div style={{ fontSize: 11.5, color: "#7d766a", marginTop: 2 }}>
              {row.dealCount} center{row.dealCount === 1 ? "" : "s"} · {row.tenantCount} dependent lease{row.tenantCount === 1 ? "" : "s"}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: row.tier1Rent > 0 ? "#b3403f" : "#9a6a12", fontFamily: "'Fraunces',Georgia,serif", lineHeight: 1.1 }}>
              {fmtMoney(row.tier1Rent)}/yr
            </div>
            <div style={{ fontSize: 10, color: "#a89f8f" }}>single-anchor · {fmtMoney(row.tier3Rent)} any-linkage</div>
          </div>
        </button>

        {open && (
          <div style={{ borderTop: "1px solid #f1eadc", padding: "4px 16px 12px" }}>
            {row.hits.length === 0 ? (
              <div style={{ fontSize: 12, color: "#7d766a", padding: "10px 0", lineHeight: 1.55 }}>
                No co-tenancy clause across your {scope === "owned" ? "owned " : ""}centers names <strong>{row.anchor}</strong> — <strong>$0</strong> inline rent is exposed if it goes dark. (Dependencies come from disclosed OM co-tenancy clauses + lease abstracts; if you expected exposure here, the clause may not be captured yet.)
              </div>
            ) : row.hits.map((h, hi) => (
              <div key={hi} style={{ padding: "10px 0", borderBottom: hi < row.hits.length - 1 ? "1px solid #f4efe4" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={() => onOpenDeal(h.dealId)}
                    style={{ background: "none", border: "none", padding: 0, color: "#3f7a1f", cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: "inherit" }}>
                    {h.dealName}
                  </button>
                  <span style={{ fontSize: 11.5, color: "#7d766a" }}>
                    {h.exposure.tier1Rent > 0 ? `${fmtMoney(h.exposure.tier1Rent)}/yr trips alone` : `${fmtMoney(h.exposure.tier3Rent)}/yr linked`}
                  </span>
                </div>
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                  {h.exposure.clauses.map((c, ci) => (
                    <div key={ci} style={{ fontSize: 11.5, color: "#52554e", display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: c.tier === 1 ? "#b3403f" : "#9a6a12", background: c.tier === 1 ? "#fdecec" : "#fff3df", border: `1px solid ${c.tier === 1 ? "#f0bcbc" : "#f2d4a0"}`, borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>
                        T{c.tier}
                      </span>
                      <span style={{ fontWeight: 600, color: "#2a2c28" }}>{c.tenant}</span>
                      <span>{c.baseRentAnnual != null ? `${fmtMoney(c.baseRentAnnual)}/yr` : "rent n/a"}</span>
                      <span style={{ color: "#8b8578" }}>· {TIER_LABEL[c.tier]}</span>
                      {!c.verified && <span style={{ color: "#b08", fontStyle: "italic" }}>· unverified (OM-disclosed)</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: "20px 18px 80px", maxWidth: 980, margin: "0 auto", width: "100%", boxSizing: "border-box", fontFamily: "'Inter',sans-serif" }}>
      <h2 style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: 22, fontWeight: 600, color: "#26281f", margin: "0 0 4px" }}>Co-Tenancy Cascade</h2>
      <p style={{ fontSize: 12.5, color: "#7d766a", margin: "0 0 16px", lineHeight: 1.5 }}>
        If an anchor goes dark, which co-tenancy clauses trip and how much inline rent is exposed — across every center at once.
        The headline number is rent that trips on <strong>that anchor alone</strong> (a single-anchor dependency); "any linkage" also
        counts clauses that need additional events (e.g. an X-of-N occupancy test), so it's an upper bound, not a single-anchor figure.
      </p>

      <div style={{ marginBottom: 12 }}>
        <ScopeToggle scope={scope} onChange={setScope} ownedCount={ownedCount} allCount={allCount} />
      </div>

      {/* Pick or type ANY tenant to model it going dark — not just the auto-detected anchors. */}
      <div style={{ marginBottom: 14 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          list="cascade-tenant-list"
          placeholder="Model ANY tenant going dark — type or pick a name…"
          style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: "9px 12px", border: "1px solid #e3dccd", borderRadius: 9, color: "#26281f", background: "#fff", fontFamily: "'Inter',sans-serif" }}
        />
        <datalist id="cascade-tenant-list">
          {allTenantNames.map(n => <option key={n} value={n} />)}
        </datalist>
        {query.trim() && (
          <button onClick={() => setQuery("")}
            style={{ marginTop: 7, background: "none", border: "none", color: "#3f7a1f", cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: 0 }}>
            ← Back to all detected anchors
          </button>
        )}
      </div>

      {abstracts == null ? (
        <p style={{ fontSize: 13, color: "#a89f8f", fontStyle: "italic" }}>Loading lease-risk data…</p>
      ) : query.trim() ? (
        renderRow(customRow!, true)
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: "#a89f8f", fontStyle: "italic" }}>
          No co-tenancy dependencies found yet. These come from each deal's disclosed co-tenancy clauses and lease abstracts —
          add them on the deal pages and they'll roll up here. (You can also type a tenant above to check a specific anchor.)
        </p>
      ) : rows.map(row => renderRow(row))}
    </div>
  );
}
