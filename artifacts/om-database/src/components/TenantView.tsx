import { useState, useCallback, useMemo } from "react";
import { EyeOff, Unlink } from "lucide-react";
import { useTopScrollbar } from "../lib/useTopScrollbar";
import type { Deal } from "../lib/idb";
import { DETAIL_MAX_WIDTH } from "../lib/constants";
import { cityState, tenantKey, tenantLabel, fmtLeaseDate, fmtTenantSales, fmtUSD, parentCompany, tenantLogoDomain, isNAPTenant, unlinkTenantName, buildSalesByDeal, resolveSalesPSF } from "../lib/utils";
import StatusTag from "./StatusTag";
import EntityDescription from "./EntityDescription";
import PortfolioStressTest from "./PortfolioStressTest";
import { cinemaSalesRead, fmtPerScreen } from "../lib/theaterMetrics";
import { stickyFirstCol } from "../lib/stickyCol";

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
  const scrollRef = useTopScrollbar<HTMLDivElement>();
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

  // Resolve sales the same way the deal page does — uploaded sales (tenantSalesHistory)
  // win over the raw roster salesPSF, which uploads never write back.
  const salesByDeal = useMemo(() => buildSalesByDeal(deals || []), [deals]);
  const effSales = (r: { deal: Deal; t: NonNullable<Deal["tenants"]>[number] }) => resolveSalesPSF(salesByDeal, r.deal, r.t);

  type SortKey = "property"|"recorded"|"market"|"sf"|"rentPSF"|"annualRent"|"expiry"|"salesPSF"|"reimbursement";
  const [sortKey, setSortKey] = useState<SortKey>("annualRent");
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

  // Force a re-render after an unlink so the grouping (tenantKey) recomputes and
  // the split-out row drops from this tenant immediately.
  const [, forceUpdate] = useState(0);
  const handleUnlink = useCallback((rawName: string | undefined) => {
    const name = rawName?.trim();
    if (!name) return;
    if (!window.confirm(`Unlink "${tenantLabel(name)}" from ${tenantLabel(tenantName)}?\n\nIt will split back out into its own tenant across the whole app. You can re-link it later from Tenant Analytics → Link Tenants.`)) return;
    unlinkTenantName(name);
    forceUpdate(n => n + 1);
  }, [tenantName]);

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
      case "recorded":      return norm(r.t.name);
      case "market":        return norm(r.deal.market);
      case "sf":            return num(r.t.sf);
      case "rentPSF":       return num(r.t.rentPerSF);
      case "annualRent":    return num(r.t.annualRent);
      case "expiry":        return r.t.leaseExpiry || "";
      case "salesPSF":      return effSales(r);
      case "reimbursement": return norm(r.t.reimbursementMethod);
      default:              return null;
    }
  };

  const sorted = [...rows].sort((a, b) => {
    const av = val(a, sortKey), bv = val(b, sortKey);
    const dir = sortDir === "asc" ? 1 : -1;
    let cmp = 0;
    if (av == null && bv == null) cmp = 0;
    else if (av == null) return 1;
    else if (bv == null) return -1;
    else if (typeof av === "number" && typeof bv === "number") cmp = (av - bv) * dir;
    else cmp = String(av).localeCompare(String(bv)) * dir;
    // Tiebreak by property name (always ascending) so ties are stably ordered.
    if (cmp === 0 && sortKey !== "property") cmp = norm(a.deal.propertyName).localeCompare(norm(b.deal.propertyName));
    return cmp;
  });

  // Averages — derive from ACTIVE rows (excludes ignored locations).
  //
  // 0-SF rows used to leak in and distort these. Methodology now:
  //  • SF metrics (Avg Size; the SF denominator of Rent/SF) only count rows with
  //    real leasable SF (> 0).
  //  • Rent metrics (Avg Annual Rent) only count rows with real base rent (> 0) —
  //    which KEEPS a true ground lease (base rent, no SF, e.g. a pad) but DROPS
  //    unowned $0 NAP / shadow markers.
  //  • Rent/SF is SF-weighted over rows that have BOTH SF and rent, so a ground
  //    lease's rent can't enter the numerator without SF in the denominator (which
  //    previously inflated $/SF).
  //  • A row with neither SF nor rent is an unowned marker (NAP / shadow pad) and
  //    is dropped from every average. (isNAPTenant only catches occupied $0-rent
  //    space, so 0-SF markers are caught here by the no-SF-and-no-rent test.)
  const sfOf   = (r: typeof rows[number]) => { const v = num(r.t.sf); return v != null && v > 0 ? v : null; };
  const rentOf = (r: typeof rows[number]) => { const v = num(r.t.annualRent); return v != null && v > 0 ? v : null; };
  const isMarker = (r: typeof rows[number]) =>
    isNAPTenant(r.t)
    || /\b(shadow|vacant|outparcel)\b/i.test((r.t.name || "").toLowerCase())
    || (sfOf(r) == null && rentOf(r) == null);
  const isGroundLease = (r: typeof rows[number]) => !isMarker(r) && sfOf(r) == null && rentOf(r) != null;

  const metricRows = activeRows.filter(r => !isMarker(r));
  const sfVals     = metricRows.map(sfOf).filter((v): v is number => v != null);
  const rentVals   = metricRows.map(rentOf).filter((v): v is number => v != null);
  const psfRows    = metricRows.filter(r => sfOf(r) != null && rentOf(r) != null);
  const salesVals  = metricRows.map(r => effSales(r)).filter((v): v is number => v != null);
  const psfSF      = psfRows.reduce((s, r) => s + sfOf(r)!, 0);
  const psfRent    = psfRows.reduce((s, r) => s + rentOf(r)!, 0);

  const avgSF      = sfVals.length ? Math.round(sfVals.reduce((s, v) => s + v, 0) / sfVals.length) : null;
  const avgRentPSF = psfSF ? psfRent / psfSF : null;  // SF-weighted, SF + rent paired
  const avgAnnRent = rentVals.length ? rentVals.reduce((s, v) => s + v, 0) / rentVals.length : null;
  const avgSales   = salesVals.length ? salesVals.reduce((a, b) => a + b, 0) / salesVals.length : null;

  const anchors = allRows.filter(r => r.t.isAnchor).length;
  const credit  = allRows.map(r => r.t.creditRating).find(Boolean);

  const arrow = (k: string) => sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const cols: [SortKey, string, boolean][] = [
    ["property","Property",false], ["recorded","Recorded As",false], ["market","Market",false],
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

  const napCount    = rows.filter(isMarker).length;
  const groundCount = rows.filter(isGroundLease).length;
  const extra = `${napCount > 0 ? ` · ${napCount} NAP` : ""}${groundCount > 0 ? ` · ${groundCount} ground lease` : ""}`;
  const subtitle = scope === "owned"
    ? `Across ${rows.length} owned ${rows.length === 1 ? "property" : "properties"}${extra}`
    : `Across ${rows.length} ${rows.length === 1 ? "property" : "properties"} in your database${extra}`;

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
      {/* Centered max-width column — same DETAIL_MAX_WIDTH as the deal page, so a
          property's subpages all read at one consistent width on a big monitor. */}
      <div style={{ maxWidth: DETAIL_MAX_WIDTH, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
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

      <EntityDescription name={tenantName} kind="tenant" />

      {/* "This chain just filed" — portfolio-wide direct rent + co-tenancy knock-on */}
      <PortfolioStressTest tenantName={tenantName} deals={deals} onOpenDeal={onOpenDeal} />

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
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(130px, 1fr))", gap:11, marginBottom:22 }}>
            <Stat
              label="Locations"
              value={String(activeRows.length)}
              sub={ignoredCount > 0 ? `${ignoredCount} ignored` : undefined}
            />
            <Stat label="Avg Size (SF)"   value={avgSF != null ? avgSF.toLocaleString() : "—"}
              sub={avgSF != null && sfVals.length < activeRows.length ? `over ${sfVals.length} of ${activeRows.length}` : undefined} />
            <Stat label="Avg Rent / SF"   value={avgRentPSF != null ? `$${avgRentPSF.toFixed(2)}` : "—"}
              sub={avgRentPSF != null && psfRows.length < activeRows.length ? `over ${psfRows.length} of ${activeRows.length}` : undefined} />
            <Stat label="Avg Annual Rent" value={avgAnnRent != null ? `$${Math.round(avgAnnRent).toLocaleString()}` : "—"}
              sub={avgAnnRent != null && rentVals.length < activeRows.length ? `over ${rentVals.length} of ${activeRows.length}` : undefined} />
            <Stat label="Avg Sales / SF"  value={avgSales != null ? `$${Math.round(avgSales).toLocaleString()}` : "—"}
              sub={avgSales != null && salesVals.length < activeRows.length ? `over ${salesVals.length} of ${activeRows.length}` : undefined} />
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

            <div ref={scrollRef} style={{ overflowX:"auto" }}>
              <table style={{ borderCollapse:"collapse", fontSize:12.5, minWidth:820, width:"100%" }}>
                <thead>
                  <tr style={{ fontSize:10, letterSpacing:"0.03em" }}>
                    {cols.map(([k, label, right], idx) => (
                      <th key={k} onClick={() => setSort(k)} className={idx === 0 ? "freeze-col" : undefined}
                        style={{ padding:"6px 10px", textAlign:right?"right":"left", cursor:"pointer", whiteSpace:"nowrap", userSelect:"none", color:sortKey===k?"#383a37":"#a69e91", fontWeight:600, ...(idx === 0 ? stickyFirstCol("#fff", true) : null) }}>
                        {label}{arrow(k)}
                      </th>
                    ))}
                    {/* Ignore + Unlink buttons column — sticky right */}
                    <th className="freeze-col" style={{
                      width:76, padding:"6px 6px",
                      position:"sticky", right:0, zIndex:3,
                      background:"#fff",
                      borderLeft:"1px solid #efe8da",
                      boxShadow:"-6px 0 6px -6px rgba(0,0,0,0.12)",
                    }} />
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
                        onMouseEnter={e => {
                          const bg = owned ? "#eaf5e2" : "#faf7f0";
                          e.currentTarget.style.background = bg;
                          (e.currentTarget.firstElementChild as HTMLElement).style.background = bg;
                          (e.currentTarget.lastElementChild as HTMLElement).style.background = bg;
                        }}
                        onMouseLeave={e => {
                          const bg = ignored ? "transparent" : owned ? "#f3faef" : "transparent";
                          e.currentTarget.style.background = bg;
                          // Frozen cells must rest on an OPAQUE colour (not "transparent")
                          // or the scrolled-under columns bleed through them.
                          (e.currentTarget.firstElementChild as HTMLElement).style.background = owned ? "#f3faef" : "#fff";
                          (e.currentTarget.lastElementChild as HTMLElement).style.background = owned ? "#f3faef" : "#fff";
                        }}
                      >
                        <td className="freeze-col" style={{ padding:"9px 10px", color:"#383a37", fontWeight:600, whiteSpace:"nowrap", ...stickyFirstCol(owned ? "#f3faef" : "#fff") }}>
                          {r.deal.propertyName || "Untitled"}
                          {r.deal.status && <span style={{ marginLeft:6, display:"inline-block", verticalAlign:"middle" }}><StatusTag status={r.deal.status} size="sm" /></span>}
                          {r.t.isAnchor && <span style={{ fontSize:9, color:"#1f2b16", background:"#6dba4322", padding:"1px 6px", borderRadius:10, marginLeft:6, fontWeight:600 }}>ANCHOR</span>}
                          {isGroundLease(r) && <span style={{ fontSize:9, color:"#3a5b7c", background:"#e8eff5", border:"1px solid #b8cce0", padding:"1px 6px", borderRadius:10, marginLeft:6, fontWeight:600 }}>GROUND LEASE</span>}
                          {(isNAPTenant(r.t) || (!isGroundLease(r) && sfOf(r) == null && rentOf(r) == null)) && <span style={{ fontSize:9, color:"#7c6340", background:"#f5ede0", border:"1px solid #e0c9a8", padding:"1px 6px", borderRadius:10, marginLeft:6, fontWeight:600 }}>NAP</span>}
                        </td>
                        {(() => {
                          // The tenant name actually recorded at this property — its own column,
                          // amber when it differs from the grouped tenant (likely a mismatch).
                          const used = r.t.name || "";
                          const differs = !!used && tenantLabel(used).toLowerCase() !== tenantLabel(tenantName).toLowerCase();
                          return (
                            <td style={{ padding:"9px 10px", whiteSpace:"nowrap", fontSize:12, fontWeight:differs ? 600 : 400, color: differs ? "#b3593b" : "#8b9097" }}>
                              {used ? <>{differs ? "⚠ " : ""}{used}</> : "—"}
                            </td>
                          );
                        })()}
                        <td style={{ padding:"9px 10px", color:"#8b9097", whiteSpace:"nowrap" }}>{r.deal.market || cityState(r.deal) || "—"}</td>
                        <td style={{ padding:"9px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap" }}>{num(r.t.sf) != null ? num(r.t.sf)!.toLocaleString() : "—"}</td>
                        <td style={{ padding:"9px 10px", textAlign:"right", color:"#0f9d63", fontWeight:500, whiteSpace:"nowrap" }}>{num(r.t.rentPerSF) != null ? `$${num(r.t.rentPerSF)!.toFixed(2)}` : "—"}</td>
                        <td style={{ padding:"9px 10px", textAlign:"right", color:"#383a37", whiteSpace:"nowrap" }}>{fmtUSD(r.t.annualRent)}</td>
                        <td style={{ padding:"9px 10px", color:"#5c5f57", whiteSpace:"nowrap" }}>{fmtLeaseDate(r.t.leaseExpiry)}</td>
                        <td style={{ padding:"9px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap" }}>
                          {fmtTenantSales(effSales(r), r.t.sf)}
                          {(() => {
                            // Theater: sales PER SCREEN is the comparable metric across locations.
                            const cin = cinemaSalesRead(r.t, effSales(r));
                            return cin.isCinema && cin.perScreen != null
                              ? <span style={{ marginLeft:6, fontSize:9.5, fontWeight:700, color:"#6b4fa0" }} title={`${cin.screens} screens${cin.screenSource === "name" ? " (from the name — confirm)" : ""}. Theaters compare on sales per screen, not PSF.`}>· {fmtPerScreen(cin.perScreen)}</span>
                              : null;
                          })()}
                        </td>
                        <td style={{ padding:"9px 10px", color:"#837c6e", fontSize:11, whiteSpace:"nowrap" }}>{r.t.reimbursementMethod || (r.t as any).leaseType || "—"}</td>
                        {/* Ignore + Unlink — sticky right, stopPropagation so they don't open the deal */}
                        <td
                          className="freeze-col"
                          style={{
                            padding:"4px 4px", width:76, textAlign:"center",
                            position:"sticky", right:0, zIndex:2,
                            background: owned ? "#f3faef" : "#fff",
                            borderLeft:"1px solid #efe8da",
                            boxShadow:"-6px 0 6px -6px rgba(0,0,0,0.10)",
                          }}
                          onClick={e => e.stopPropagation()}
                        >
                          <div style={{ display:"inline-flex", alignItems:"center", gap:2 }}>
                            <button
                              onClick={() => toggleIgnore(id)}
                              title={ignored ? "Re-include in averages" : "Exclude from averages"}
                              style={{
                                background:"transparent", border:"none", cursor:"pointer", padding:0,
                                display:"inline-flex", alignItems:"center", justifyContent:"center",
                                minWidth:30, minHeight:32,
                                color: ignored ? "#d9890c" : "#d4cdc4", transition:"color 0.15s",
                              }}
                            >
                              <EyeOff size={13} strokeWidth={1.75} />
                            </button>
                            <button
                              onClick={() => handleUnlink(r.t.canonicalName || r.t.name)}
                              title={`Unlink "${tenantLabel(r.t.canonicalName || r.t.name || "")}" — split it out if it was wrongly grouped here`}
                              style={{
                                background:"transparent", border:"none", cursor:"pointer", padding:0,
                                display:"inline-flex", alignItems:"center", justifyContent:"center",
                                minWidth:30, minHeight:32,
                                color:"#d4cdc4", transition:"color 0.15s",
                              }}
                              onMouseEnter={e => (e.currentTarget.style.color = "#c0392b")}
                              onMouseLeave={e => (e.currentTarget.style.color = "#d4cdc4")}
                            >
                              <Unlink size={13} strokeWidth={1.75} />
                            </button>
                          </div>
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
    </div>
  );
}
