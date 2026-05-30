import { useState, useCallback } from "react";
import { EyeOff } from "lucide-react";
import type { Deal } from "../lib/idb";
import { cityState, tenantKey, tenantLabel, fmtLeaseDate, fmtTenantSales, parentCompany, tenantLogoDomain, isNAPTenant } from "../lib/utils";
import StatusTag from "./StatusTag";

interface Props {
  tenantName: string;
  deals: Deal[];
  onBack: () => void;
  onOpenDeal: (deal: Deal) => void;
  onParentClick?: (parent: string) => void;
}

// Stable id for a location row — unique enough within one tenant's list
function rowId(r: { deal: Deal; t: NonNullable<Deal["tenants"]>[number] }): string {
  return [
    r.deal.id || r.deal.fileName || "?",
    tenantKey(r.t.canonicalName || r.t.name || ""),
    r.t.sf ?? "",
    r.t.leaseExpiry ?? "",
  ].join("__");
}

export default function TenantView({ tenantName, deals, onBack, onOpenDeal, onParentClick }: Props) {
  const norm = (s: unknown) => (String(s || "")).trim().toLowerCase();
  const target = tenantKey(tenantName);
  const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);

  const allRows: { deal: Deal; t: NonNullable<Deal["tenants"]>[number] }[] = [];
  (deals || []).forEach(d =>
    (d.tenants || []).forEach(t => {
      const matchByName = tenantKey(t.name) === target;
      const matchByCanonical = t.canonicalName && tenantKey(t.canonicalName) === target;
      if (matchByName || matchByCanonical) allRows.push({ deal: d, t });
    })
  );

  type SortKey = "property"|"market"|"sf"|"rentPSF"|"annualRent"|"expiry"|"salesPSF"|"reimbursement";
  const [sortKey, setSortKey] = useState<SortKey>("sf");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");
  const [scope, setScope] = useState<"all"|"owned">("all");

  // Per-tenant location ignore state — keyed so tenants don't bleed into each other
  const storageKey = `tv-ignored-locs:${tenantKey(tenantName)}`;
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? new Set<string>(JSON.parse(stored)) : new Set<string>();
    } catch { return new Set<string>(); }
  });

  const toggleIgnore = useCallback((id: string) => {
    setIgnoredIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [storageKey]);

  const resetIgnored = useCallback(() => {
    setIgnoredIds(new Set<string>());
    try { localStorage.removeItem(storageKey); } catch {}
  }, [storageKey]);

  const rows = scope === "owned"
    ? allRows.filter(r => r.deal.status === "Owned")
    : allRows;

  // Active rows = rows minus explicitly ignored locations
  const activeRows = rows.filter(r => !ignoredIds.has(rowId(r)));
  const ignoredCount = rows.length - activeRows.length;

  const setSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(x => x === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(["property","market","expiry","reimbursement"].includes(k) ? "asc" : "desc"); }
  };

  const val = (r: typeof rows[number], k: SortKey) => {
    switch (k) {
      case "property":      return norm(r.deal.propertyName);
      case "market":        return norm(r.deal.market);
      case "sf":            return num(r.t.sf);
      case "rentPSF":       return num(r.t.rentPerSF);
      case "annualRent":    return num(r.t.annualRent);
      case "expiry":        return r.t.leaseExpiry || "";
      case "salesPSF":      return num(r.t.salesPSF);
      case "reimbursement": return norm(r.t.reimbursementMethod);
      default:              return null;
    }
  };

  const sorted = [...rows].sort((a, b) => {
    const av = val(a, sortKey), bv = val(b, sortKey);
    const dir = sortDir === "asc" ? 1 : -1;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });

  // Averages — derive from ACTIVE rows (excludes ignored locations)
  const isRentable = (r: typeof rows[number]) => {
    if (isNAPTenant(r.t)) return false;
    const name = (r.t.name || "").toLowerCase();
    return !/\b(shadow|vacant|ground.?lease|outparcel)\b/i.test(name);
  };
  const rentRows     = activeRows.filter(isRentable);
  const sfVals       = rentRows.map(r => num(r.t.sf)).filter((v): v is number => v != null);
  const rentVals     = rentRows.map(r => num(r.t.annualRent)).filter((v): v is number => v != null);
  const salesVals    = activeRows.map(r => num(r.t.salesPSF)).filter((v): v is number => v != null);
  const totalSFAll   = sfVals.reduce((s, v) => s + v, 0);
  const totalRentAll = rentVals.reduce((s, v) => s + v, 0);

  const avgSF        = sfVals.length ? Math.round(totalSFAll / sfVals.length) : null;
  const avgRentPSF   = totalSFAll ? totalRentAll / totalSFAll : null;  // SF-weighted
  const avgAnnRent   = rentVals.length ? totalRentAll / rentVals.length : null;
  const avgSales     = salesVals.length ? salesVals.reduce((a, b) => a + b, 0) / salesVals.length : null;

  const anchors = allRows.filter(r => r.t.isAnchor).length;
  const credit  = allRows.map(r => r.t.creditRating).find(Boolean);

  const arrow = (k: string) => sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const cols: [SortKey, string, boolean][] = [
    ["property","Property",false], ["market","Market",false],
    ["sf","SF",true], ["rentPSF","Rent/SF",true], ["annualRent","Ann. Rent",true],
    ["expiry","Expiry",false], ["salesPSF","Sales",true], ["reimbursement","Reimb.",false],
  ];

  const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div style={{ flex:"1 1 130px", background:"#fff", border:"1px solid #efe8da", borderRadius:12, padding:"13px 16px", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
      <div style={{ fontSize:10, letterSpacing:"0.06em", color:"#a69e91", marginBottom:6, fontWeight:500, textTransform:"uppercase" }}>{label}</div>
      <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:600, color:"#383a37", lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:9, color:"#b8b0a3", marginTop:3 }}>{sub}</div>}
    </div>
  );

  const napCount = allRows.filter(r => isNAPTenant(r.t)).length;
  const subtitle = scope === "owned"
    ? `Across ${rows.length} owned ${rows.length === 1 ? "property" : "properties"}${napCount > 0 ? ` · ${napCount} NAP` : ""}`
    : `Across ${rows.length} ${rows.length === 1 ? "property" : "properties"} in your database${napCount > 0 ? ` · ${napCount} NAP` : ""}`;

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
      <div style={{ marginBottom:16 }}>
        <button onClick={onBack} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif" }}>← BACK</button>
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:4, flexWrap:"wrap" }}>
        {(() => {
          const domain = tenantLogoDomain(tenantName);
          if (!domain) return null;
          return (
            <img
              src={`https://logo.clearbit.com/${domain}`}
              alt=""
              onError={e => {
                const img = e.target as HTMLImageElement;
                if (!img.dataset.fb) { img.dataset.fb = "1"; img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`; }
                else img.style.display = "none";
              }}
              style={{ width:36, height:36, objectFit:"contain", borderRadius:6, border:"1px solid #efe8da", background:"#fff", padding:3, flexShrink:0 }}
            />
          );
        })()}
        <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:30, fontWeight:600, color:"#26281f", margin:0 }}>{tenantLabel(tenantName)}</h1>
        {anchors > 0 && <span style={{ fontSize:10, color:"#1f2b16", background:"#6dba4322", padding:"2px 9px", borderRadius:12, fontWeight:700 }}>ANCHOR · {anchors}</span>}
        {credit && <span style={{ fontSize:11, color:"#5c5f57", background:"#f3eee3", border:"1px solid #e7e0d2", padding:"2px 9px", borderRadius:12 }}>Credit: {credit}</span>}
      </div>
      {(() => { const p = parentCompany(tenantName); return p ? (
        <button onClick={() => onParentClick?.(p)} style={{ background:"transparent", border:"none", padding:0, cursor:"pointer", fontFamily:"'Inter',sans-serif", fontSize:11, color:"#6f6a5f", marginTop:2, marginBottom:2, display:"block" }}>
          Part of <span style={{ fontWeight:600, color:"#2d4ecf", textDecoration:"underline" }}>{p}</span>
        </button>
      ) : null; })()}

      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:18, justifyContent:"space-between" }}>
        <div style={{ fontSize:13, color:"#9a917f" }}>{subtitle}</div>
        {/* Scope toggle */}
        <div style={{ display:"flex", border:"1px solid #e7e0d2", borderRadius:7, overflow:"hidden", fontFamily:"'Inter',sans-serif", fontSize:12, flexShrink:0 }}>
          {(["all","owned"] as const).map(s => (
            <button
              key={s}
              onClick={() => setScope(s)}
              style={{
                padding:"4px 13px",
                background: scope === s ? "#383a37" : "#faf7f0",
                color: scope === s ? "#f6f2ea" : "#7d766a",
                border: "none",
                cursor: "pointer",
                fontWeight: scope === s ? 600 : 400,
                fontFamily: "inherit",
                fontSize: "inherit",
                transition: "background 0.12s, color 0.12s",
              }}
            >
              {s === "all" ? "All" : "Owned"}
            </button>
          ))}
        </div>
      </div>

      {scope === "owned" && rows.length === 0 ? (
        <div style={{ fontSize:14, color:"#a69e91", padding:"24px 0" }}>No owned locations for this tenant.</div>
      ) : (
        <>
          {/* Stat boxes — recomputed from activeRows (ignoring excluded locations) */}
          <div style={{ display:"flex", gap:11, flexWrap:"wrap", marginBottom:22 }}>
            <Stat
              label="Locations"
              value={String(activeRows.length)}
              sub={ignoredCount > 0 ? `${ignoredCount} ignored` : undefined}
            />
            <Stat label="Avg Size (SF)"   value={avgSF != null ? avgSF.toLocaleString() : "—"} />
            <Stat label="Avg Rent / SF"   value={avgRentPSF != null ? `$${avgRentPSF.toFixed(2)}` : "—"} />
            <Stat label="Avg Annual Rent" value={avgAnnRent != null ? `$${Math.round(avgAnnRent).toLocaleString()}` : "—"} />
            <Stat label="Avg Sales / SF"  value={avgSales != null ? `$${Math.round(avgSales).toLocaleString()}` : "—"} />
          </div>

          <div style={{ background:"#fff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
            {/* Locations header with ignored count + reset */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:13, flexWrap:"wrap", gap:6 }}>
              <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase" }}>
                Locations — click a row to open the property
              </div>
              {ignoredCount > 0 && (
                <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:11, color:"#a89f8f" }}>
                  <EyeOff size={11} strokeWidth={1.75} style={{ color:"#d9890c" }} />
                  <span>{ignoredCount} ignored</span>
                  <button
                    onClick={resetIgnored}
                    style={{ background:"transparent", border:"none", padding:0, cursor:"pointer", fontSize:11, color:"#a89f8f", textDecoration:"underline", fontFamily:"'Inter',sans-serif" }}
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>

            <div style={{ overflowX:"auto" }}>
              <table style={{ borderCollapse:"collapse", fontSize:12.5, minWidth:820, width:"100%" }}>
                <thead>
                  <tr style={{ fontSize:10, letterSpacing:"0.03em" }}>
                    {cols.map(([k, label, right]) => (
                      <th key={k} onClick={() => setSort(k)}
                        style={{ padding:"6px 10px", textAlign:right?"right":"left", cursor:"pointer", whiteSpace:"nowrap", userSelect:"none", color:sortKey===k?"#383a37":"#a69e91", fontWeight:600 }}>
                        {label}{arrow(k)}
                      </th>
                    ))}
                    {/* Empty header for ignore button column */}
                    <th style={{ width:40, padding:"6px 6px" }} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => {
                    const id = rowId(r);
                    const ignored = ignoredIds.has(id);
                    const owned = r.deal.status === "Owned" || r.deal.status === "Sold";
                    return (
                      <tr
                        key={i}
                        onClick={() => onOpenDeal(r.deal)}
                        style={{
                          borderTop:"1px solid #f1eadc",
                          cursor:"pointer",
                          background: owned ? "#f3faef" : "transparent",
                          borderLeft: owned ? "3px solid #6dba43" : "3px solid transparent",
                          opacity: ignored ? 0.35 : 1,
                          transition: "opacity 0.15s",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = owned ? "#eaf5e2" : "#faf7f0")}
                        onMouseLeave={e => (e.currentTarget.style.background = ignored ? "transparent" : owned ? "#f3faef" : "transparent")}
                      >
                        <td style={{ padding:"9px 10px", color:"#383a37", fontWeight:600, whiteSpace:"nowrap" }}>
                          {r.deal.propertyName || "Untitled"}
                          {r.deal.status && <span style={{ marginLeft:6, display:"inline-block", verticalAlign:"middle" }}><StatusTag status={r.deal.status} size="sm" /></span>}
                          {r.t.isAnchor && <span style={{ fontSize:9, color:"#1f2b16", background:"#6dba4322", padding:"1px 6px", borderRadius:10, marginLeft:6, fontWeight:600 }}>ANCHOR</span>}
                          {isNAPTenant(r.t) && <span style={{ fontSize:9, color:"#7c6340", background:"#f5ede0", border:"1px solid #e0c9a8", padding:"1px 6px", borderRadius:10, marginLeft:6, fontWeight:600 }}>NAP</span>}
                        </td>
                        <td style={{ padding:"9px 10px", color:"#8b9097", whiteSpace:"nowrap" }}>{r.deal.market || cityState(r.deal) || "—"}</td>
                        <td style={{ padding:"9px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap" }}>{num(r.t.sf) != null ? num(r.t.sf)!.toLocaleString() : "—"}</td>
                        <td style={{ padding:"9px 10px", textAlign:"right", color:"#0f9d63", fontWeight:500, whiteSpace:"nowrap" }}>{num(r.t.rentPerSF) != null ? `$${num(r.t.rentPerSF)!.toFixed(2)}` : "—"}</td>
                        <td style={{ padding:"9px 10px", textAlign:"right", color:"#383a37", whiteSpace:"nowrap" }}>{num(r.t.annualRent) != null ? `$${num(r.t.annualRent)!.toLocaleString()}` : "—"}</td>
                        <td style={{ padding:"9px 10px", color:"#5c5f57", whiteSpace:"nowrap" }}>{fmtLeaseDate(r.t.leaseExpiry)}</td>
                        <td style={{ padding:"9px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap" }}>{fmtTenantSales(r.t.salesPSF, r.t.sf)}</td>
                        <td style={{ padding:"9px 10px", color:"#837c6e", fontSize:11, whiteSpace:"nowrap" }}>{r.t.reimbursementMethod || (r.t as any).leaseType || "—"}</td>
                        {/* Ignore button — stopPropagation so it doesn't open the deal */}
                        <td
                          style={{ padding:"4px 6px", width:40, textAlign:"center" }}
                          onClick={e => e.stopPropagation()}
                        >
                          <button
                            onClick={() => toggleIgnore(id)}
                            title={ignored ? "Re-include in averages" : "Exclude from averages"}
                            style={{
                              background:"transparent",
                              border:"none",
                              cursor:"pointer",
                              padding:0,
                              display:"inline-flex",
                              alignItems:"center",
                              justifyContent:"center",
                              minWidth:32,
                              minHeight:32,
                              color: ignored ? "#d9890c" : "#d4cdc4",
                              transition:"color 0.15s",
                            }}
                          >
                            <EyeOff size={13} strokeWidth={1.75} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && <div style={{ fontSize:13, color:"#a69e91", padding:"10px 0" }}>No locations found for this tenant.</div>}
          </div>
        </>
      )}
    </div>
  );
}
